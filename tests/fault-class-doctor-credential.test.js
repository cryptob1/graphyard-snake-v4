// GY-18 — fault class "configuration": the doctor/work principal's bearer token went stale, and
// every read and post the loop makes as that identity was refused 401 for hours while the master's
// own reads succeeded. The instances below are quoted from this installation's own master-loop
// state (the daemon state file the coordinator holds), each row exactly as recorded:
//
//   2026-10-17T05:42:31.677Z → 10:33:01.954Z  doctor:post:<run at>  failed — 25 runs of the
//     2026-10-17 night (01:59:47.212Z through 06:53:59.514Z), each retried every cycle, every
//     attempt refused with the same sentence: "The control plane did not accept the doctor run of
//     <at>; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard
//     bearer token is required". (Two older runs of 2026-10-14, 10:46:32.427Z and 11:03:46.863Z,
//     had already died the same way — the class was standing long before it was counted.)
//   2026-10-17T10:29:19.065Z  fault:configuration  failed — "Could not file the item for the
//     recurring configuration fault class: Graphyard refused work (401): A valid Graphyard bearer
//     token is required" — the work filing the loop makes as the same identity, refused the same
//     way, which is why the class itself could not be filed (the session-liveness filings GY-20
//     records as "lost to 401s" died here too).
//   The doctor run that observed it: `status GY-1` refused with 401 'A valid Graphyard bearer
//     token is required' while `master status` and `master decisions GY-1` succeeded on the same
//     host — the ambient doctor/work principal credential is stale (the master's own reads are
//     local; every plane call the doctor makes runs as the operator credential).
//   .graphyard/master.json changed credentialFile, cliPath — bound settings a running master loop
//     refuses to adopt (config.refused: 'restart master run to adopt it'): the re-provisioned
//     setup had written fresh credentials and repointed the config, and the loop kept loading the
//     stale ones until it was restarted.
//
// The cause the instances share: every doctor launch, doctor report post and work filing the loop
// makes runs as ONE credential — the operator credential doctorEffects hands each doctor session
// by path (src/daemon/doctor.ts: GRAPHYARD_TOKEN_FILE: config.operatorAgent.credentialFile,
// GRAPHYARD_DOCTOR_CLI: config.cliPath, read from the settings the loop LOADED, not the file's
// current content) — and nothing on the host ever verified that credential still authenticated.
// The post step's own remedy is only "posted again next cycle" (src/daemon/doctor.ts postRun), so
// a stale credential retries into the same 401 forever: 25 runs, ~4.5 hours of refused posts, and
// the fault that would have reported the class was itself refused.
//
// What changed (the candidate condition, delivered with this test): bin/graphyard.mjs — the
// credential pass this installation lacked. Each pass probes every credential file the
// coordinator config names plus the ambient session credential the environment holds, with the
// exact work read `status GY-N` makes (GET /api/work/:key), and exits 1 while any refuses — the
// recorded contrast (doctor 401, master reads fine) becomes one failing exit code instead of a
// silent stream. `--refresh` repairs a stale credential before re-reading: from the same role's
// authenticating file the re-provisioned config names (the recorded remedy), or through the
// control plane's own rotate route for the doctor's operator principal, and reports the master-run
// restart a loop that loaded changed bound settings still needs.
//
// The models below are faithful miniatures of the two decision paths the instances exercised —
// src/daemon/doctor.ts postRun (the 'posted again next cycle' stream) and src/master/config.ts
// masterConfigChanges/masterBoundSettings/liveMasterConfig (the refused reload) — run against a
// stub control plane over real HTTP that answers the three routes the real one did. The final test
// audits the live installation on the coordinator host (CI has no access to it and skips).
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and carries its own
// fixtures: token files, a coordinator config and the stub plane.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ambientCredential, classifyWorkRead, installationIdentities, mintToken, parseArguments, parseCredentialArguments, planCredentialRefresh } from '../bin/graphyard.mjs';

const REPOSITORY = dirname(fileURLToPath(import.meta.url));
const TOOL = join(REPOSITORY, '..', 'bin', 'graphyard.mjs');
/** The coordinator checkout of cryptob1/graphyard-snake-v4 on the coordinator host. */
const COORDINATOR = '/home/vish/code/graphyard-snake-v4';

/** The item the recorded instances read, as its control-plane document names it. */
const WORK = { id: '6e9bcc5d-99bd-4270-99f1-9732cd60f929', key: 'GY-1' };

/** The 25 refused doctor runs of 2026-10-17, as the daemon state held them: run at → recorded attempts. */
const REFUSED_RUNS = [
  ['2026-10-17T01:59:47.212Z', 2], ['2026-10-17T02:09:50.272Z', 2], ['2026-10-17T02:21:17.032Z', 2],
  ['2026-10-17T02:31:19.553Z', 2], ['2026-10-17T02:42:26.770Z', 2], ['2026-10-17T02:52:42.136Z', 2],
  ['2026-10-17T03:02:51.260Z', 2], ['2026-10-17T03:17:30.682Z', 2], ['2026-10-17T03:27:32.876Z', 2],
  ['2026-10-17T03:43:44.954Z', 3], ['2026-10-17T03:53:45.044Z', 3], ['2026-10-17T04:06:50.720Z', 2],
  ['2026-10-17T04:17:31.798Z', 4], ['2026-10-17T04:34:29.969Z', 2], ['2026-10-17T04:52:38.573Z', 2],
  ['2026-10-17T05:03:06.483Z', 2], ['2026-10-17T05:15:59.835Z', 2], ['2026-10-17T05:27:25.309Z', 3],
  ['2026-10-17T05:42:30.024Z', 4], ['2026-10-17T05:53:59.433Z', 4], ['2026-10-17T06:06:06.398Z', 3],
  ['2026-10-17T06:16:43.353Z', 2], ['2026-10-17T06:28:09.697Z', 2], ['2026-10-17T06:41:14.994Z', 2],
  ['2026-10-17T06:53:59.514Z', 4],
];
/** The plane's own 401, the exact body server/auth.ts sends and every recorded row quotes. */
const REQUIRED_TOKEN = 'A valid Graphyard bearer token is required';
/** The api refusal message the daemon's effects format (src/daemon/effects-production.ts): what the recorded rows carry after the colon. */
const planeRefusal = (path, status, error) => `Graphyard refused ${path} (${status}): ${error}`;

/** Credentials as tokens a stub plane accepts: token → principal. */
const token = (name) => `${name}-${'x'.repeat(40)}`;
const fingerprint = (value) => createHash('sha256').update(value).digest('hex').slice(0, 16);

/**
 * The daemon's doctor post step (src/daemon/doctor.ts postRun), at the fidelity the recorded rows
 * exercised: post one settled run; a refusal records a failed fault row 'posted again next cycle'
 * with the attempt count, an accepted post closes the row a refusal opened, and a post accepted on
 * its first submission records no fault row at all. `at` on every ledger row is the recording
 * instant, so rows recorded after a moment can be told apart from rows recorded before it.
 */
async function postDoctorRun(state, recordRun, runAt, at) {
  const key = `doctor:post:${runAt}`;
  try {
    await recordRun(runAt);
    if (state.actions[key]?.state === 'failed') {
      state.actions[key] = { ...state.actions[key], state: 'done', detail: `The control plane accepted the doctor run of ${runAt}` };
      state.ledger.push({ key, state: 'done', detail: `The control plane accepted the doctor run of ${runAt}`, at, attempts: state.actions[key].attempts });
    }
  } catch (error) {
    const previous = state.actions[key];
    const row = { key, state: 'failed', detail: `The control plane did not accept the doctor run of ${runAt}; it is posted again next cycle: ${error.message}`.slice(0, 2000), at, attempts: (previous?.attempts ?? 0) + 1 };
    state.actions[key] = row;
    state.ledger.push(row);
  }
}

/**
 * The master's own config reload (src/master/config.ts), at the fidelity the recorded refusal
 * exercised: masterBoundSettings cannot change under a running loop — such a reload is refused with
 * the recorded sentence and the loop keeps the settings it loaded — while a loop started after the
 * change (a fresh load) adopts them. `flatten` mirrors the real one: run settings surface as
 * `run.key`, everything else as itself.
 */
const masterBoundSettings = ['version', 'url', 'credentialFile', 'cliPath', 'repository', 'baseBranch', 'githubAppId', 'hostId', 'masterAgentName'];
function masterConfigChanges(current, next) {
  const flatten = (config) => { const { run, ...rest } = config; return { ...rest, ...Object.fromEntries(Object.entries(run ?? {}).map(([key, value]) => [`run.${key}`, value])) }; };
  const before = flatten(current), after = flatten(next);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
  return { changed, bound: changed.filter(key => masterBoundSettings.includes(key)) };
}
function liveMasterConfig(initial, load) {
  const live = {
    current: initial,
    async reload() {
      const next = await load();
      const { bound } = masterConfigChanges(live.current, next);
      if (bound.length) return { config: live.current, changed: [], refused: `.graphyard/master.json changes ${bound.join(', ')}, which a running master loop is bound to; restart master run to adopt ${bound.length === 1 ? 'it' : 'them'}. Until then the loop keeps its loaded settings, including every other change` };
      live.current = next;
      return { config: next, changed: [], refused: null };
    },
  };
  return live;
}

/**
 * A faithful miniature of the control plane the recorded instances called: the work read `status
 * GY-N` makes (GET /api/work/:key), the doctor report post (POST /api/doctor) and the operator
 * credential rotate route (POST /api/operator-agents/:id/rotate), each gated exactly as the real
 * routes are (server/auth.ts authenticate, server/doctor-route.ts, operator-agent.ts rotate: an
 * unknown bearer is the recorded 401, a non-administrator rotate is the recorded 403, an unknown
 * operator agent the recorded 404). `posted` and `rotations` record what the plane accepted.
 */
async function stubPlane({ credentials, items = { [WORK.key]: WORK }, operatorAgents = new Map() }) {
  const posted = [], rotations = [];
  const readBody = (request) => new Promise(resolve => { let body = ''; request.on('data', chunk => { body += chunk; }); request.on('end', () => resolve(body ? JSON.parse(body) : null)); });
  const plane = createServer(async (request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    const bearer = /^Bearer (.+)$/.exec(String(request.headers.authorization ?? ''))?.[1] ?? null;
    const principal = bearer ? credentials.get(bearer) ?? null : null;
    if (!principal) return send(401, { error: REQUIRED_TOKEN });
    const work = /^\/api\/work\/([^/]+)$/.exec(request.url ?? '');
    if (work && request.method === 'GET') return items[decodeURIComponent(work[1])] ? send(200, items[decodeURIComponent(work[1])]) : send(404, { error: 'Route not found' });
    if (request.url === '/api/doctor' && request.method === 'POST') {
      const body = await readBody(request);
      posted.push({ at: body?.at ?? null, principal: principal.id });
      return send(200, { recorded: true, runs: 1 });
    }
    const rotate = /^\/api\/operator-agents\/([^/]+)\/rotate$/.exec(request.url ?? '');
    if (rotate && request.method === 'POST') {
      if (principal.role !== 'admin') return send(403, { error: 'Administrator permission required' });
      const agent = operatorAgents.get(decodeURIComponent(rotate[1]));
      if (!agent) return send(404, { error: 'Operator agent not found' });
      const body = await readBody(request);
      if (typeof body?.token !== 'string' || body.token.length < 32) return send(400, { error: 'Token too short' });
      if (agent.fingerprints.includes(fingerprint(body.token))) return send(409, { error: 'Credential was already used' });
      agent.fingerprints.push(fingerprint(body.token));
      credentials.set(body.token, { id: agent.id, role: 'operator-agent' });
      rotations.push({ id: agent.id, by: principal.id, token: body.token, transitionSeconds: body.transitionSeconds, reason: body.reason });
      return send(200, { id: agent.id, revision: ++agent.revision });
    }
    return send(404, { error: 'Route not found' });
  });
  await new Promise(resolve => plane.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${plane.address().port}`, posted, rotations, close: () => plane.close() };
}

/** Runs the tool without blocking this process's event loop, so the stub plane keeps answering it. */
const runTool = (root, arguments_, environment = {}, timeoutMs = 120_000) => new Promise(resolve => {
  const child = spawn(process.execPath, [TOOL, ...arguments_], { cwd: root, env: environment });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.on('error', error => { clearTimeout(timer); resolve({ status: null, stdout, stderr: String(error) }); });
  child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
});

/**
 * The recorded installation in miniature: the re-provisioned control plane (fresh coordinator and
 * operator credentials it accepts, the stale doctor token it no longer knows), the coordinator
 * config naming the fresh files, and — the state the fault was recorded in — the loop's loaded
 * settings still naming the OLD doctor credential file, which is the ambient credential a
 * loop-launched doctor session runs as. The post step posts as that ambient credential.
 */
async function recordedInstallation() {
  const coordinatorToken = token('coordinator'), freshDoctorToken = token('doctor-fresh'), approverToken = token('approver');
  const plane = await stubPlane({ credentials: new Map([
    [coordinatorToken, { id: 'cryptob1-graphyard-snake-v4-master', role: 'coordinator' }],
    [freshDoctorToken, { id: 'graphyard-master-graphyard-snake-v4-operator', role: 'operator-agent' }],
    [approverToken, { id: 'graphyard-approver-graphyard-snake-v4', role: 'operator-agent' }],
  ]) });
  const scratch = mkdtempSync(join(tmpdir(), 'gy18-doctor-credential-'));
  const files = {
    coordinator: join(scratch, 'coordinator.token'),
    doctorNew: join(scratch, 'operator.token'),
    doctorOld: join(scratch, 'operator.stale.token'),
    approver: join(scratch, 'approver.token'),
  };
  writeFileSync(files.coordinator, coordinatorToken, { mode: 0o600 });
  writeFileSync(files.doctorNew, freshDoctorToken, { mode: 0o600 });
  writeFileSync(files.doctorOld, token('doctor-stale'), { mode: 0o600 });
  writeFileSync(files.approver, approverToken, { mode: 0o600 });
  const root = join(scratch, 'coordinator');
  mkdirSync(join(root, '.graphyard'), { recursive: true });
  /** The re-provisioned config on disk: fresh credential file, fresh CLI path. */
  const master = {
    version: 1, url: plane.url, repository: 'cryptob1/graphyard-snake-v4', baseBranch: 'main',
    credentialFile: files.coordinator, cliPath: '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs',
    operatorAgent: { id: 'graphyard-master-graphyard-snake-v4-operator', credentialFile: files.doctorNew },
    approver: { id: 'graphyard-approver-graphyard-snake-v4', credentialFile: files.approver },
  };
  writeFileSync(join(root, '.graphyard', 'master.json'), JSON.stringify(master, null, 1));
  /** The settings the running loop loaded before the re-provision: the old credential file and CLI path. */
  const loaded = { ...master, credentialFile: join(scratch, 'coordinator.stale.token'), cliPath: '/home/vish/code/graphyard/bin/graphyard.mjs', operatorAgent: { ...master.operatorAgent, credentialFile: files.doctorOld } };
  /** The doctor session's environment, as the loop's loaded settings launch it (src/daemon/doctor.ts doctorEffects env). */
  const doctorEnv = { GRAPHYARD_TOKEN_FILE: loaded.operatorAgent.credentialFile, GRAPHYARD_URL: plane.url, GRAPHYARD_DOCTOR_CLI: loaded.cliPath };
  /** The daemon's api call as the doctor identity (paths the way the daemon names them: 'doctor', 'work'): the ambient credential file's token, refreshed from disk each call. */
  const postAsDoctor = async (path, body) => {
    const response = await fetch(`${plane.url}/api/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${readFileSync(files.doctorOld, 'utf8').trim()}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const document = await response.json().catch(() => null);
    if (!response.ok) throw new Error(planeRefusal(path, response.status, document?.error ?? 'unknown'));
    return document;
  };
  return { plane, scratch, root, files, master, loaded, doctorEnv, postAsDoctor, close: () => { plane.close(); rmSync(scratch, { recursive: true, force: true }); } };
}

test('unit:doctor-credential-stale the command line: credentials [--refresh] [--json] [--key GY-N], and the reaper\'s own --status/--reap unchanged', () => {
  assert.deepEqual(parseCredentialArguments([]), { refresh: false, json: false, key: null });
  assert.deepEqual(parseCredentialArguments(['--refresh', '--json']), { refresh: true, json: true, key: null });
  assert.equal(parseCredentialArguments(['--key', 'GY-18']).key, 'GY-18');
  assert.throws(() => parseCredentialArguments(['--wipe']), /Unknown argument/);
  assert.throws(() => parseCredentialArguments(['--key']), /needs a value/);
  assert.throws(() => parseCredentialArguments(['--key', 'status']), /work key like GY-1/);
  // The reaper's own parser is untouched: exactly one of --status or --reap, an optional --json, a whole --grace-ms.
  assert.deepEqual(parseArguments(['--status']), { status: true, reap: false, json: false, graceMs: null });
  assert.deepEqual(parseArguments(['--reap', '--json']), { status: false, reap: true, json: true, graceMs: null });
  assert.equal(parseArguments(['--status', '--grace-ms', '0']).graceMs, 0);
  assert.throws(() => parseArguments([]), /exactly one/);
  assert.throws(() => parseArguments(['--status', '--reap']), /exactly one/);
});

test('unit:doctor-credential-stale the roster: every identity master.json names — coordinator, doctor, approver, workers — and the ambient session credential the environment holds', () => {
  const master = {
    credentialFile: '/etc/coordinator.token', url: 'http://127.0.0.1:4310',
    operatorAgent: { id: 'graphyard-master-graphyard-snake-v4-operator', credentialFile: '/etc/operator.token' },
    approver: { id: 'graphyard-approver-graphyard-snake-v4', credentialFile: '/etc/approver.token' },
    workers: [{ name: 'worker-1', credentialFile: '/etc/worker-1.token' }, { name: 'worker-2', credentialFile: 'relative.token' }],
  };
  assert.deepEqual(installationIdentities(master), [
    { role: 'coordinator', name: null, path: '/etc/coordinator.token' },
    { role: 'doctor', name: 'graphyard-master-graphyard-snake-v4-operator', path: '/etc/operator.token' },
    { role: 'approver', name: 'graphyard-approver-graphyard-snake-v4', path: '/etc/approver.token' },
    { role: 'worker', name: 'worker-1', path: '/etc/worker-1.token' },
  ], 'a relative path is not a credential file this host can read; a config without operatorAgent or approver simply probes fewer identities');
  assert.deepEqual(installationIdentities({}), []);
  assert.deepEqual(ambientCredential({ GRAPHYARD_TOKEN_FILE: '/etc/operator.stale.token' }), { source: 'GRAPHYARD_TOKEN_FILE', path: '/etc/operator.stale.token' });
  assert.deepEqual(ambientCredential({ GRAPHYARD_TOKEN: 't'.repeat(40) }), { source: 'GRAPHYARD_TOKEN', path: null }, 'an inline token is probed as itself and never rewritten');
  assert.equal(ambientCredential({}), null);
});

test('unit:doctor-credential-stale the reading: a 200 returns the item, a 404 still proves the reader authenticated, a 401 is stale with the plane\'s own refusal, a 403 refused', () => {
  assert.deepEqual(classifyWorkRead(200, { key: 'GY-1' }, 'GY-1'), { disposition: 'ok', item: 'GY-1', detail: 'the work read returned GY-1' });
  assert.equal(classifyWorkRead(200, { key: 'GY-2' }, 'GY-1').disposition, 'ok');
  assert.equal(classifyWorkRead(404, { error: 'Route not found' }, 'GY-1').disposition, 'authenticated', 'the plane answers 404 only for a reader it authenticated');
  assert.deepEqual(classifyWorkRead(401, { error: REQUIRED_TOKEN }, 'GY-1'), { disposition: 'stale', item: null, detail: REQUIRED_TOKEN });
  assert.equal(classifyWorkRead(401, null, 'GY-1').detail, REQUIRED_TOKEN, 'a body the plane did not parse still names the recorded refusal');
  assert.equal(classifyWorkRead(403, { error: 'Repository is outside operator-agent scope' }, 'GY-1').disposition, 'refused');
  assert.equal(classifyWorkRead(502, null, 'GY-1').disposition, 'error');
});

test('unit:doctor-credential-stale the config reload a running loop performs: a changed credentialFile or cliPath is refused until the master run restarts, and the refusal names them', async () => {
  const installation = await recordedInstallation();
  try {
    // The loop that was running through the fault: it loaded the old settings, the file on disk
    // holds the re-provisioned ones.
    const loop = liveMasterConfig(installation.loaded, async () => JSON.parse(readFileSync(join(installation.root, '.graphyard', 'master.json'), 'utf8')));
    const refused = await loop.reload();
    assert.equal(refused.refused, '.graphyard/master.json changes cliPath, credentialFile, which a running master loop is bound to; restart master run to adopt them. Until then the loop keeps its loaded settings, including every other change');
    assert.equal(loop.current.credentialFile, installation.loaded.credentialFile, 'the refused reload keeps the stale credential the loop loaded');
    assert.equal(loop.current.operatorAgent.credentialFile, installation.files.doctorOld, 'so its doctor launches keep the stale credential file');
    // A single bound change refuses with the singular the recorded sentence quotes.
    const one = liveMasterConfig(installation.loaded, async () => ({ ...installation.master, cliPath: installation.loaded.cliPath }));
    assert.match((await one.reload()).refused, /changes credentialFile, which a running master loop is bound to; restart master run to adopt it\./);
    // The restart: a loop started now loads the file as it stands, adopts it, and its doctor launches name the fresh file.
    const restarted = liveMasterConfig(JSON.parse(readFileSync(join(installation.root, '.graphyard', 'master.json'), 'utf8')), async () => JSON.parse(readFileSync(join(installation.root, '.graphyard', 'master.json'), 'utf8')));
    assert.equal((await restarted.reload()).refused, null);
    assert.equal(restarted.current.operatorAgent.credentialFile, installation.files.doctorNew);
    // An unbound change (a run setting) applies without a restart, so the refusal is not a blanket one.
    const tunable = liveMasterConfig(installation.loaded, async () => ({ ...installation.loaded, run: { intervalSeconds: 30 } }));
    assert.equal((await tunable.reload()).refused, null);
    assert.equal(tunable.current.run.intervalSeconds, 30);
  } finally {
    installation.close();
  }
});

test('unit:doctor-credential-stale the refresh plan: a same-role file that authenticates donates its token, the doctor without one rotates, the ambient session credential takes the doctor\'s then the coordinator\'s, and nothing else is minted here', () => {
  const master = { operatorAgent: { id: 'graphyard-master-graphyard-snake-v4-operator', credentialFile: '/etc/operator.token' } };
  const passing = (role, path) => ({ role, path, disposition: 'ok' });
  const stale = (role, path) => ({ role, path, disposition: 'stale' });
  assert.deepEqual(planCredentialRefresh(passing('doctor', '/a'), [], master), { action: 'none', reason: 'the credential authenticates' });
  assert.deepEqual(planCredentialRefresh(stale('doctor', '/old'), [passing('doctor', '/new')], master), { action: 'copy', from: '/new', reason: 'the doctor credential the config names at another path authenticates; its token refreshes this file' });
  assert.deepEqual(planCredentialRefresh(stale('doctor', '/only'), [], master), { action: 'rotate', id: 'graphyard-master-graphyard-snake-v4-operator', reason: 'no alternate file authenticates; the control plane\'s rotate route mints a fresh credential for the doctor principal' });
  assert.deepEqual(planCredentialRefresh(stale('ambient', '/loop-loaded'), [passing('doctor', '/new'), passing('coordinator', '/c')], master), { action: 'copy', from: '/new', reason: 'the doctor credential the config names authenticates; its token refreshes the ambient session credential\'s file, and the master run restart adopts the changed settings' }, 'the ambient session credential is the doctor\'s by construction');
  assert.equal(planCredentialRefresh(stale('ambient', '/loop-loaded'), [passing('coordinator', '/c')], master).from, '/c');
  assert.match(planCredentialRefresh(stale('ambient', '/loop-loaded'), [], master).reason, /refresh it in the file the launching session names and restart the master run/);
  assert.match(planCredentialRefresh(stale('worker', '/w'), [], master).reason, /the installation's setup provisions it/, 'a worker credential is provisioned by the setup; no route here mints it');
});

test('integration:doctor-status-read-200 the recorded run: the ambient doctor credential\'s status read is refused 401 while the coordinator\'s succeeds; the refresh rewrites the credential file from the config\'s fresh one, and the doctor identity\'s own read then returns the item', async () => {
  const installation = await recordedInstallation();
  try {
    // The recorded contrast, as one reading of the pass: the config's own credentials read fine,
    // the ambient credential a loop-launched session runs as is stale with the plane's own 401.
    const before = await runTool(installation.root, ['credentials', '--json', '--key', WORK.key], installation.doctorEnv);
    assert.equal(before.status, 1, 'a credential that refuses its work read fails the reading');
    const report = JSON.parse(before.stdout);
    const ambient = report.findings.find(finding => finding.role === 'ambient');
    assert.equal(ambient.disposition, 'stale');
    assert.equal(ambient.detail, REQUIRED_TOKEN);
    assert.equal(ambient.status, 401);
    assert.ok(report.findings.find(finding => finding.role === 'coordinator').disposition === 'ok' && report.findings.find(finding => finding.role === 'doctor').disposition === 'ok', 'the master reads succeed on the same host');
    assert.equal(report.stale, 1);

    // The doctor identity's own status read, the exact call the recorded run made: 401.
    const refused = await fetch(`${installation.plane.url}/api/work/${WORK.key}`, { headers: { Authorization: `Bearer ${readFileSync(installation.files.doctorOld, 'utf8').trim()}` } });
    assert.equal(refused.status, 401);
    assert.equal((await refused.json()).error, REQUIRED_TOKEN);

    // The refresh: the ambient stale file takes the fresh doctor token the re-provisioned config
    // names, owner-only, atomically — no rotate call is needed or made.
    const refreshed = await runTool(installation.root, ['credentials', '--refresh', '--json', '--key', WORK.key], installation.doctorEnv);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    const repair = JSON.parse(refreshed.stdout);
    assert.equal(repair.refreshed.length, 1);
    assert.equal(repair.refreshed[0].role, 'ambient');
    assert.equal(repair.refreshed[0].path, installation.files.doctorOld);
    assert.equal(repair.refreshed[0].from, installation.files.doctorNew);
    assert.equal(repair.refreshed[0].disposition, 'ok');
    assert.equal(readFileSync(installation.files.doctorOld, 'utf8').trim(), readFileSync(installation.files.doctorNew, 'utf8').trim());
    assert.equal(statSync(installation.files.doctorOld).mode & 0o777, 0o600);
    assert.deepEqual(installation.plane.rotations, [], 'the fresh token the setup had already written beside the stale one is the whole remedy');
    assert.match(repair.adoption, /restart the master run to adopt them/);

    // AC-1: `status GY-N` run by the doctor identity returns the item, not the recorded 401.
    const read = await fetch(`${installation.plane.url}/api/work/${WORK.key}`, { headers: { Authorization: `Bearer ${readFileSync(installation.files.doctorOld, 'utf8').trim()}` } });
    assert.equal(read.status, 200);
    assert.equal((await read.json()).key, WORK.key);

    // And after the restart the loop owed, its adopted settings name the fresh file — that read
    // returns the item too.
    const adopted = await fetch(`${installation.plane.url}/api/work/${WORK.key}`, { headers: { Authorization: `Bearer ${readFileSync(installation.files.doctorNew, 'utf8').trim()}` } });
    assert.equal((await adopted.json()).key, WORK.key);

    // The next audit passes clean.
    const after = await runTool(installation.root, ['credentials', '--json', '--key', WORK.key], installation.doctorEnv);
    assert.equal(after.status, 0);
    assert.equal(JSON.parse(after.stdout).stale, 0);
  } finally {
    installation.close();
  }
});

test('integration:doctor-report-accepted-first-post the recorded stream: every doctor report post is refused 401 and filed \'posted again next cycle\' while the credential is stale; the first post after the refresh is accepted once, and no such fault is recorded after it', async () => {
  const installation = await recordedInstallation();
  try {
    const state = { actions: {}, ledger: [] };
    const recordRun = (at) => installation.postAsDoctor('doctor', { at, findings: [], actions: [], filed: [] });
    // The recorded stream: three runs the night retried to four attempts each (04:17:31.798Z,
    // 05:42:30.024Z, 05:53:59.433Z — their rows in the table above), each reposted every cycle while
    // the ambient credential stayed stale. Four cycles reproduce the recorded attempt counts.
    const pending = ['2026-10-17T04:17:31.798Z', '2026-10-17T05:42:30.024Z', '2026-10-17T05:53:59.433Z'];
    const recordedAttempts = (at) => REFUSED_RUNS.find(([runAt]) => runAt === at)[1];
    for (let cycle = 0; cycle < 4; cycle++) for (const at of pending) await postDoctorRun(state, recordRun, at, `2026-10-17T10:${String(10 + cycle).padStart(2, '0')}:00.000Z`);
    for (const at of pending) {
      const row = state.actions[`doctor:post:${at}`];
      assert.equal(row.state, 'failed');
      assert.equal(row.attempts, recordedAttempts(at), `${at} was retried to its recorded attempt count`);
      assert.equal(row.detail, `The control plane did not accept the doctor run of ${at}; it is posted again next cycle: ${planeRefusal('doctor', 401, REQUIRED_TOKEN)}`);
    }
    assert.equal(installation.plane.posted.length, 0, 'the plane accepted none of them');

    // The work filing the loop makes as the same identity dies the same way — the recorded
    // fault:configuration row, which is why the class itself could not be filed.
    await assert.rejects(installation.postAsDoctor('work', { key: 'GY-18', title: 'configuration' }), { message: planeRefusal('work', 401, REQUIRED_TOKEN) });
    const filing = `Could not file the item for the recurring configuration fault class: ${planeRefusal('work', 401, REQUIRED_TOKEN)}`;
    assert.equal(filing, 'Could not file the item for the recurring configuration fault class: Graphyard refused work (401): A valid Graphyard bearer token is required');

    // The credential refresh and the restart that adopts the changed settings.
    const refreshed = await runTool(installation.root, ['credentials', '--refresh', '--json', '--key', WORK.key], installation.doctorEnv);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    const refreshAt = '2026-10-17T10:44:06.000Z';

    // The pending run's next retry is accepted, and its fault row closes the way the daemon closes it.
    await postDoctorRun(state, recordRun, pending.at(-1), refreshAt);
    assert.equal(state.actions[`doctor:post:${pending.at(-1)}`].state, 'done');
    assert.equal(state.actions[`doctor:post:${pending.at(-1)}`].detail, `The control plane accepted the doctor run of ${pending.at(-1)}`);
    assert.equal(installation.plane.posted.filter(post => post.at === pending.at(-1)).length, 1);

    // AC-2: every post after the refresh is accepted on its first submission, and the fault
    // ledger records no 'posted again next cycle' fault after it.
    for (const at of ['2026-10-17T11:14:32.000Z', '2026-10-17T11:25:48.000Z']) {
      await postDoctorRun(state, recordRun, at, at);
      assert.equal(installation.plane.posted.filter(post => post.at === at).length, 1, `${at} posted exactly once`);
      assert.equal(state.actions[`doctor:post:${at}`], undefined, 'a post accepted first try records no fault row');
    }
    const after = state.ledger.filter(row => row.at >= refreshAt);
    assert.ok(after.length > 0);
    assert.ok(after.every(row => !row.detail.includes('posted again next cycle')), 'no fault after the refresh promises a next-cycle repost');
  } finally {
    installation.close();
  }
});

test('integration:doctor-status-read-200 a doctor credential the plane rotated with no alternate file: the refresh mints a fresh one through the control plane\'s own rotate route, or reports the exact refusal when no route can', async () => {
  // The plane rotated the doctor's operator credential and the config still names the old file:
  // no alternate file can donate, so the rotate route is the remedy.
  const coordinatorToken = token('coordinator'), approverToken = token('approver-admin'), doctorToken = token('doctor-rotated-away');
  const plane = await stubPlane({
    credentials: new Map([
      [coordinatorToken, { id: 'cryptob1-graphyard-snake-v4-master', role: 'coordinator' }],
      [approverToken, { id: 'graphyard-approver-graphyard-snake-v4', role: 'admin' }],
      [doctorToken, { id: 'graphyard-master-graphyard-snake-v4-operator', role: 'operator-agent' }],
    ]),
    operatorAgents: new Map([['graphyard-master-graphyard-snake-v4-operator', { id: 'graphyard-master-graphyard-snake-v4-operator', fingerprints: [], revision: 1 }]]),
  });
  const scratch = mkdtempSync(join(tmpdir(), 'gy18-rotate-'));
  try {
    const files = { coordinator: join(scratch, 'coordinator.token'), doctor: join(scratch, 'operator.token'), approver: join(scratch, 'approver.token') };
    writeFileSync(files.coordinator, coordinatorToken, { mode: 0o600 });
    writeFileSync(files.doctor, token('doctor-stale'), { mode: 0o600 });
    writeFileSync(files.approver, approverToken, { mode: 0o600 });
    const root = join(scratch, 'coordinator');
    mkdirSync(join(root, '.graphyard'), { recursive: true });
    writeFileSync(join(root, '.graphyard', 'master.json'), JSON.stringify({
      version: 1, url: plane.url, repository: 'cryptob1/graphyard-snake-v4', baseBranch: 'main',
      credentialFile: files.coordinator, cliPath: '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs',
      operatorAgent: { id: 'graphyard-master-graphyard-snake-v4-operator', credentialFile: files.doctor },
      approver: { id: 'graphyard-approver-graphyard-snake-v4', credentialFile: files.approver },
    }, null, 1));
    const before = await runTool(root, ['credentials', '--json', '--key', WORK.key]);
    assert.equal(before.status, 1);
    assert.equal(JSON.parse(before.stdout).findings.find(finding => finding.role === 'doctor').disposition, 'stale');

    const refreshed = await runTool(root, ['credentials', '--refresh', '--json', '--key', WORK.key]);
    assert.equal(refreshed.status, 0, refreshed.stderr);
    assert.equal(plane.rotations.length, 1, 'the rotate route was called exactly once');
    const [rotation] = plane.rotations;
    assert.equal(rotation.id, 'graphyard-master-graphyard-snake-v4-operator');
    assert.equal(rotation.by, 'graphyard-approver-graphyard-snake-v4', 'the coordinator credential was refused as non-administrator (the recorded 403) and the next authorized one rotated');
    assert.ok(rotation.token.length >= 32, 'the minted token is one the plane\'s own schema accepts');
    assert.equal(rotation.transitionSeconds, 0);
    assert.ok(typeof rotation.reason === 'string' && rotation.reason.length > 0);
    assert.equal(readFileSync(files.doctor, 'utf8').trim(), rotation.token);
    assert.equal(statSync(files.doctor).mode & 0o777, 0o600);
    const repair = JSON.parse(refreshed.stdout);
    assert.equal(repair.refreshed[0].role, 'doctor');
    assert.equal(repair.refreshed[0].disposition, 'ok');
    assert.equal(repair.findings.find(finding => finding.role === 'doctor').item, WORK.key, 'the doctor identity\'s status read returns the item');

    // The same plane without the operator agent on record: the refresh reports the exact refusal,
    // rewrites nothing, and the reading still fails — the setup step provisions that credential.
    const ghost = await stubPlane({
      credentials: new Map([
        [coordinatorToken, { id: 'cryptob1-graphyard-snake-v4-master', role: 'coordinator' }],
        [approverToken, { id: 'graphyard-approver-graphyard-snake-v4', role: 'admin' }],
      ]),
    });
    try {
      const ghostRoot = join(scratch, 'ghost');
      mkdirSync(join(ghostRoot, '.graphyard'), { recursive: true });
      const ghostFiles = { coordinator: join(scratch, 'ghost-coordinator.token'), doctor: join(scratch, 'ghost-operator.token'), approver: join(scratch, 'ghost-approver.token') };
      writeFileSync(ghostFiles.coordinator, coordinatorToken, { mode: 0o600 });
      writeFileSync(ghostFiles.doctor, token('ghost-stale'), { mode: 0o600 });
      writeFileSync(ghostFiles.approver, approverToken, { mode: 0o600 });
      writeFileSync(join(ghostRoot, '.graphyard', 'master.json'), JSON.stringify({
        version: 1, url: ghost.url, repository: 'cryptob1/graphyard-snake-v4', baseBranch: 'main',
        credentialFile: ghostFiles.coordinator, cliPath: '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs',
        operatorAgent: { id: 'graphyard-master-graphyard-snake-v4-operator', credentialFile: ghostFiles.doctor },
        approver: { id: 'graphyard-approver-graphyard-snake-v4', credentialFile: ghostFiles.approver },
      }, null, 1));
      const attempted = await runTool(ghostRoot, ['credentials', '--refresh', '--json', '--key', WORK.key]);
      assert.equal(attempted.status, 1, 'an unrefreshable credential keeps the reading failing');
      const refusal = JSON.parse(attempted.stdout).unrefreshable[0];
      assert.equal(refusal.role, 'doctor');
      assert.equal(refusal.refused, true);
      assert.match(refusal.reason, /Operator agent not found/);
      assert.equal(readFileSync(ghostFiles.doctor, 'utf8').trim(), token('ghost-stale'), 'nothing was written');
    } finally {
      ghost.close();
    }
  } finally {
    plane.close();
    rmSync(scratch, { recursive: true, force: true });
  }
});

test('candidate condition, the live installation: every identity the coordinator config names reads its work item, the doctor\'s included, and its last doctor run stands reported', { skip: !existsSync(join(COORDINATOR, '.graphyard', 'master.json')) && `not on the coordinator host: ${COORDINATOR} holds no coordinator config` }, async () => {
  // The change lives on this branch until it merges, so the audit runs the branch's own pass against
  // the live control plane through a coordinator config that mirrors the coordinator checkout's —
  // same plane, same credential files — reading only (the audit writes nothing, ever).
  const master = JSON.parse(readFileSync(join(COORDINATOR, '.graphyard', 'master.json'), 'utf8'));
  const scratch = mkdtempSync(join(tmpdir(), 'gy18-live-audit-'));
  try {
    mkdirSync(join(scratch, '.graphyard'), { recursive: true });
    writeFileSync(join(scratch, '.graphyard', 'master.json'), JSON.stringify(master, null, 1));
    const reading = await runTool(scratch, ['credentials', '--json', '--key', WORK.key], {}, 180_000);
    assert.equal(reading.status, 0, `${reading.stderr || reading.stdout}\nthe live installation holds a credential that refuses its work read`);
    const report = JSON.parse(reading.stdout);
    assert.ok(report.findings.length >= 3, 'the reading reached the coordinator, doctor and worker credentials the config names');
    assert.ok(report.findings.every(finding => finding.disposition === 'ok' || finding.disposition === 'authenticated'));
    const doctor = report.findings.find(finding => finding.role === 'doctor');
    assert.equal(doctor.disposition, 'ok', 'the doctor identity\'s status read returns the item, not the recorded 401');
    assert.equal(doctor.item, WORK.key);

    // The doctor's own report posts stand accepted: the last run the plane holds (the panel is
    // newest-first) is reported, and nothing in its record still says the plane 'did not accept' a run.
    const status = await fetch(`${master.url.replace(/\/$/, '')}/api/status`, { headers: { Authorization: `Bearer ${readFileSync(master.credentialFile, 'utf8').trim()}` }, signal: AbortSignal.timeout(30_000) });
    assert.equal(status.status, 200);
    const panel = (await status.json()).doctor;
    assert.ok(Array.isArray(panel) && panel.length > 0, 'the doctor panel holds the runs the loop posted');
    assert.ok(['reported', 'running'].includes(panel[0].state), `the doctor panel's last run stands settled, not refused: ${JSON.stringify(panel[0]).slice(0, 200)}`);
    assert.ok(!JSON.stringify(panel).includes('did not accept'), 'no doctor run stands refused');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

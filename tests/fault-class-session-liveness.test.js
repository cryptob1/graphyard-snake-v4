// GY-20 — approver sessions stayed idle-live for hours after their decisions settled, and
// nothing reaped them. Three session-liveness instances on GY-1, read from this installation's
// own control plane (each row: the approver session the loop launched for the decision, its
// start, the decision's settle, and how long the session sat state=running and observed=idle
// after it):
//
//   approver session graphyard-approver-gy-1-f9162d74 (pane w2:p3H) started 2026-10-17T03:00:49Z;
//     its rework decision f9162d74-9a22-44aa-927a-80ae5dd61a55 settled refused at 03:01:31.216Z
//     — idle-live ~5h56m after the settle.
//   approver session graphyard-approver-gy-1-6ef90e68 (pane w2:p3J) started 05:49:10Z; its
//     requirements decision 6ef90e68-1f02-4824-8957-4d6248e19976 settled refused at 05:49:59.848Z
//     — ~3h06m after.
//   approver session graphyard-approver-gy-1-00a1a900 (pane w2:p3K) started 05:52:00Z; its
//     grant decision 00a1a900-4264-4390-bc73-c1c60e0b5ad9 settled refused at 05:53:57.743Z
//     — ~3h04m after.
//
// The cause the three share: dispatch's session reconcile closes a session only when its worker
// profile holds no active assignment (src/daemon/cycle-sessions.ts closeStep, step 1 — "close
// finished worker sessions"), and an approver session never belongs to a worker profile: it runs
// on the approver role, named for its decision. Dispatch observed the three idle every cycle and
// reaped nothing, because nothing in the reconcile's selection can ever name them. Session
// reaping had no sanctioned command at all — the doctor's allowlist carries none — and the
// earlier session-liveness filings were lost to 401s, so the class crossed its threshold
// (lingering-sessions: no session open 30 minutes after its decision settles) unheard.
//
// What changed (the candidate condition, delivered with this test): bin/graphyard.mjs — the
// sanctioned reaping pass this installation lacked. Each pass reads the control plane's items and
// decision histories, names every approver session the way the loop launches it, and closes each
// one whose decision has settled once its runtime sits idle or done — never a session whose
// decision is still awaited, never one still working, never a pane another workspace holds. The
// models below replay the three recorded instances against that pass: dispatch's reconcile
// closes nothing (the shared cause, reproduced), the reaper's plan marks all three reapable, and
// the end-to-end run closes their panes through Herdr itself. The final test audits the live
// installation on the coordinator host (CI has no access to it and skips).
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and carries its own
// fixtures: a stub control plane over real HTTP and a stub Herdr over a real child process.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { approverSessionNames, inScope, parseArguments, planReap, settledAt, settleGraceMs } from '../bin/graphyard.mjs';

const REPOSITORY = dirname(fileURLToPath(import.meta.url));
const REAPER = join(REPOSITORY, '..', 'bin', 'graphyard.mjs');
/** The coordinator checkout of cryptob1/graphyard-snake-v4 on the coordinator host. */
const COORDINATOR = '/home/vish/code/graphyard-snake-v4';

/** The item the three recorded instances ran against, as its control-plane document names it. */
const WORK = { id: '6e9bcc5d-99bd-4270-99f1-9732cd60f929', key: 'GY-1' };
/** The three recorded instances: the decision row as the control plane served it, the session it launched, and its pane. */
const RECORDED = [
  {
    decision: { id: 'f9162d74-9a22-44aa-927a-80ae5dd61a55', action: 'rework', state: 'refused', requestedAt: '2026-10-17T03:00:25.578Z', refusal: { approver: 'graphyard-approver-graphyard-snake-v4', reason: 'refused on the record', at: '2026-10-17T03:01:31.216Z' } },
    session: 'graphyard-approver-gy-1-f9162d74', pane: 'w2:p3H', startedAt: '2026-10-17T03:00:49Z',
  },
  {
    decision: { id: '6ef90e68-1f02-4824-8957-4d6248e19976', action: 'requirements', state: 'refused', requestedAt: '2026-10-17T05:48:00.634Z', refusal: { approver: 'graphyard-approver-graphyard-snake-v4', reason: 'refused on the record', at: '2026-10-17T05:49:59.848Z' } },
    session: 'graphyard-approver-gy-1-6ef90e68', pane: 'w2:p3J', startedAt: '2026-10-17T05:49:10Z',
  },
  {
    decision: { id: '00a1a900-4264-4390-bc73-c1c60e0b5ad9', action: 'grant', state: 'refused', requestedAt: '2026-10-17T05:49:09.817Z', refusal: { approver: 'graphyard-approver-graphyard-snake-v4', reason: 'refused on the record', at: '2026-10-17T05:53:57.743Z' } },
    session: 'graphyard-approver-gy-1-00a1a900', pane: 'w2:p3K', startedAt: '2026-10-17T05:52:00Z',
  },
];
/** When the loop read the three rows and filed the class: the first session ~5h56m past its settle. */
const FILED_AT = Date.parse('2026-10-17T08:57:31.216Z');

/** The Herdr agents the coordinator host listed: the three approvers, idle, in workspace w2. */
const recordedAgents = () => RECORDED.map(instance => ({
  name: instance.session, pane_id: instance.pane, workspace_id: 'w2', agent: 'pi', agent_status: 'idle', cwd: COORDINATOR,
}));

/**
 * The base reconcile as the daemon runs it (src/daemon/cycle-sessions.ts closeStep, step 1): a
 * listed session closes only when the worker profile that launched it holds no active assignment,
 * judged by agent_status done or an exited runtime. Approver sessions run on the approver role —
 * no worker profile ever claims their name — so the step's selection cannot name them: this is
 * the shared cause, reproduced against the recorded agents.
 */
function dispatchCloses(agents, { profileSessions = new Set(), activeProfiles = new Set() } = {}) {
  return agents.filter(agent => profileSessions.has(agent.name)
    && ![...activeProfiles].some(profile => agent.name.startsWith(profile))
    && (agent.agent_status === 'done' || agent.exited === true));
}

/** Runs the reaper without blocking this process's event loop, so the stub plane keeps answering it. */
const runReaper = (root, herdr, arguments_, timeoutMs = 120_000) => new Promise(resolve => {
  const child = spawn(process.execPath, [REAPER, ...arguments_], { cwd: root, env: { ...process.env, HERDR_BIN_PATH: herdr } });
  const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; });
  child.stderr.on('data', data => { stderr += data; });
  child.on('error', error => { clearTimeout(timer); resolve({ status: null, stdout, stderr: String(error) }); });
  child.on('close', status => { clearTimeout(timer); resolve({ status, stdout, stderr }); });
});

/**
 * A faithful miniature of the installation: a stub control plane over real HTTP serving the work
 * snapshot and the decision history, and a stub Herdr as a real child process holding its pane
 * and agent inventory in a state file `pane close` mutates. Returns the coordinator checkout the
 * reaper runs from (its .graphyard/master.json names the stub plane and credential), the Herdr
 * binary, the state file, and how to stop it.
 */
async function stubInstallation({ decisions, agents, panes }) {
  const scratch = mkdtempSync(join(tmpdir(), 'gy20-session-liveness-'));
  const state = join(scratch, 'herdr-state.json');
  writeFileSync(state, JSON.stringify({ agents, panes }, null, 1));
  const herdr = join(scratch, 'herdr');
  writeFileSync(herdr, `#!/usr/bin/env node
const { readFileSync, writeFileSync } = require('node:fs');
const state = JSON.parse(readFileSync(${JSON.stringify(state)}, 'utf8'));
const reply = (result) => { process.stdout.write(JSON.stringify({ id: 'cli:stub', result })); process.exit(0); };
const [command, subcommand, argument] = process.argv.slice(2);
if (command === 'agent' && subcommand === 'list') reply({ agents: state.agents });
if (command === 'pane' && subcommand === 'list') reply({ panes: state.panes });
if (command === 'pane' && subcommand === 'close' && argument) {
  state.panes = state.panes.filter(pane => pane.pane_id !== argument);
  state.agents = state.agents.filter(agent => agent.pane_id !== argument);
  writeFileSync(${JSON.stringify(state)}, JSON.stringify(state, null, 1));
  reply({ closed: argument });
}
process.stderr.write('stub herdr refuses: ' + process.argv.slice(2).join(' ')); process.exit(1);
`);
  chmodSync(herdr, 0o755);
  const plane = createServer((request, response) => {
    const send = (body) => { response.writeHead(200, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    if (request.url === '/api/work-snapshot?view=coordination') return send({ work: [WORK] });
    if (request.url === `/api/work/${WORK.id}/decisions`) return send({ key: WORK.key, decisions });
    response.writeHead(404, { 'content-type': 'application/json' }); response.end(JSON.stringify({ error: 'Route not found' }));
  });
  await new Promise(resolve => plane.listen(0, '127.0.0.1', resolve));
  const { port } = plane.address();
  const root = join(scratch, 'coordinator');
  mkdirSync(join(root, '.graphyard'), { recursive: true });
  const credential = join(root, '.graphyard', 'credential');
  writeFileSync(credential, 'x'.repeat(40));
  writeFileSync(join(root, '.graphyard', 'master.json'), JSON.stringify({
    url: `http://127.0.0.1:${port}`, herdrWorkspace: 'w2', repository: 'cryptob1/graphyard-snake-v4', credentialFile: credential,
  }, null, 1));
  return {
    root, herdr, state,
    run: (...arguments_) => runReaper(root, herdr, arguments_),
    close: () => { plane.close(); rmSync(scratch, { recursive: true, force: true }); },
  };
}

test('unit:session-reaped-after-settle the settle reading: refused settles at its refusal, approved at its approval, and a requested decision settles never', () => {
  assert.equal(settledAt({ state: 'requested', requestedAt: '2026-10-17T03:00:25.578Z' }), null);
  assert.equal(settledAt(null), null);
  assert.equal(settledAt({}), null, 'a record with no state reads as awaited, never settled');
  assert.equal(settledAt(RECORDED[0].decision), '2026-10-17T03:01:31.216Z');
  assert.equal(settledAt({ state: 'approved', requestedAt: '2026-10-17T03:00:25.578Z', approvedAt: '2026-10-17T03:01:00.000Z' }), '2026-10-17T03:01:00.000Z');
  assert.equal(settledAt({ state: 'stale', requestedAt: '2026-10-17T03:00:25.578Z', staleAt: '2026-10-17T03:02:00.000Z' }), '2026-10-17T03:02:00.000Z');
  assert.equal(settledAt({ state: 'withdrawn', requestedAt: '2026-10-17T03:00:25.578Z' }), '2026-10-17T03:00:25.578Z', 'a withdrawal names no instant of its own; the request time is the only bound it carries');
});

test('unit:session-reaped-after-settle the session names: the loop\'s own naming rule, from this repository\'s reaper', () => {
  assert.equal(approverSessionNames('GY-1', RECORDED[0].decision.id), 'graphyard-approver-gy-1-f9162d74');
  for (const instance of RECORDED) assert.equal(approverSessionNames(WORK.key, instance.decision.id), instance.session);
  const long = approverSessionNames('GY-123456789012345678901234567890', RECORDED[0].decision.id);
  assert.match(long, /^gy-approver-/, 'a key with no room for the full prefix shortens to the abbreviated role word, as the loop does');
  assert.ok(long.length <= 32, `a Herdr name never exceeds 32 characters, not ${long.length}`);
  assert.notEqual(long, approverSessionNames('GY-123456789012345678901234567890', RECORDED[1].decision.id), 'two decisions on one item are still two sessions');
});

test('unit:session-reaped-after-settle the command line: exactly one of --status or --reap, an optional --json, and a whole --grace-ms', () => {
  assert.deepEqual(parseArguments(['--status']), { status: true, reap: false, json: false, graceMs: null });
  assert.deepEqual(parseArguments(['--reap', '--json']), { status: false, reap: true, json: true, graceMs: null });
  assert.equal(parseArguments(['--status', '--grace-ms', '0']).graceMs, 0);
  assert.throws(() => parseArguments([]), /exactly one/);
  assert.throws(() => parseArguments(['--status', '--reap']), /exactly one/);
  assert.throws(() => parseArguments(['--wipe']), /Unknown argument/);
  assert.throws(() => parseArguments(['--grace-ms', 'thirty']), /whole number/);
  assert.throws(() => parseArguments(['--grace-ms', '-1']), /whole number/);
});

test('unit:session-reaped-after-settle the workspace scope: this installation\'s panes only, never another workspace\'s', () => {
  assert.equal(inScope({ pane_id: 'w2:p3H', workspace_id: 'w2' }, 'w2'), true);
  assert.equal(inScope({ pane_id: 'w2:p3H' }, 'w2'), true, 'the pane id\'s own W: prefix scopes it');
  assert.equal(inScope({ pane_id: 'w3:p1', workspace_id: 'w3' }, 'w2'), false);
  assert.equal(inScope({ pane_id: 'w3:p1' }, 'w2'), false);
  assert.equal(inScope({ pane_id: 'headless-run-7' }, 'w2'), true, 'a pane that names no workspace is never attributed elsewhere');
  assert.equal(inScope({ pane_id: 'w3:p1' }, null), true, 'no configured scope leaves the host unscoped');
});

test(`integration:session-reaped-after-settle the three recorded instances: dispatch's reconcile closes nothing (the shared cause), and the reaper's pass marks all three reapable`, () => {
  const agents = recordedAgents();
  // The base state, as the daemon ran it on 2026-10-17: both worker profiles held active
  // assignments, and even with none the step's selection cannot name an approver session.
  assert.deepEqual(dispatchCloses(agents, { profileSessions: new Set(['cryptob1-graphyard-snak-da53aaaf', 'cryptob1-graphyard-snak-e3f90dc7']), activeProfiles: new Set(['cryptob1-graphyard-snak-da53aaaf', 'cryptob1-graphyard-snak-e3f90dc7']) }), []);
  assert.deepEqual(dispatchCloses(agents, { profileSessions: new Set(agents.map(agent => agent.name)) }), [], 'idle is not done: the close step wants a finished runtime, and dispatch observed the three idle, not done');
  // The repair: one pass of the reaper over the same reading, at the moment the class was filed.
  const plan = planReap({ now: FILED_AT, work: [WORK], decisions: new Map([[WORK.id, RECORDED.map(instance => instance.decision)]]), agents, scope: 'w2' });
  assert.equal(plan.length, 3);
  for (const [index, entry] of plan.entries()) {
    assert.equal(entry.disposition, 'reap', `${RECORDED[index].session} is reapable: its decision settled and its runtime sits idle`);
    assert.equal(entry.name, RECORDED[index].session);
    assert.equal(entry.pane, RECORDED[index].pane);
    assert.equal(entry.work, 'GY-1');
    assert.equal(entry.decision, RECORDED[index].decision.id);
    assert.equal(entry.state, 'refused');
    assert.equal(entry.settledAt, RECORDED[index].decision.refusal.at);
    assert.equal(entry.lingering, true, 'every one of the three sits far past the 30-minute threshold');
    assert.ok(entry.settledForMs >= settleGraceMs, `past the lingering-sessions threshold of ${settleGraceMs}ms`);
  }
  assert.ok(plan[0].settledForMs >= 5 * 3_600_000 + 55 * 60_000, `the first instance was idle-live ~5h56m after its settle, not ${Math.round(plan[0].settledForMs / 60_000)} minutes`);
  assert.ok(plan[1].settledForMs >= 3 * 3_600_000, `the second ~3h06m, not ${Math.round(plan[1].settledForMs / 60_000)} minutes`);
  assert.ok(plan[2].settledForMs >= 3 * 3_600_000, `the third ~3h04m, not ${Math.round(plan[2].settledForMs / 60_000)} minutes`);
});

test('integration:session-reaped-after-settle end to end: --status exits 1 naming the three lingering sessions, --reap closes their panes through Herdr, and the next reading shows none', async () => {
  const installation = await stubInstallation({
    decisions: RECORDED.map(instance => instance.decision),
    agents: recordedAgents(),
    panes: RECORDED.map(instance => ({ pane_id: instance.pane, workspace_id: 'w2', agent: 'pi', agent_status: 'idle' })),
  });
  try {
    const before = await installation.run('--status', '--json');
    assert.equal(before.status, 1, 'a session open past the grace fails the reading, exactly as the fault class counts it');
    const report = JSON.parse(before.stdout);
    assert.equal(report.lingering, 3);
    assert.deepEqual(report.sessions.map(entry => entry.pane).sort(), ['w2:p3H', 'w2:p3J', 'w2:p3K']);
    assert.ok(report.sessions.every(entry => entry.disposition === 'reap'));

    const reaped = await installation.run('--reap', '--json');
    assert.equal(reaped.status, 0, reaped.stderr);
    const closed = JSON.parse(reaped.stdout);
    assert.deepEqual(closed.closed.map(entry => entry.pane).sort(), ['w2:p3H', 'w2:p3J', 'w2:p3K']);
    assert.ok(closed.closed.every(entry => /^graphyard-approver-gy-1-/.test(entry.name)));
    const state = JSON.parse(readFileSync(installation.state, 'utf8'));
    assert.deepEqual(state.panes, [], 'Herdr itself holds none of the three panes any more');
    assert.deepEqual(state.agents, []);

    const after = await installation.run('--status', '--json');
    assert.equal(after.status, 0, 'no session open 30 minutes or more after its decision settled');
    assert.equal(JSON.parse(after.stdout).lingering, 0);
    assert.deepEqual(JSON.parse(after.stdout).sessions, []);
  } finally {
    installation.close();
  }
});

test('integration:session-reaped-after-settle a session whose decision is still requested is never reaped, however long it has sat idle', async () => {
  const awaited = { id: 'b31b5c0e-1111-4222-8333-444455556666', action: 'release', state: 'requested', requestedAt: '2026-10-17T03:00:25.578Z' };
  const agents = [...recordedAgents(), { name: approverSessionNames(WORK.key, awaited.id), pane_id: 'w2:p3L', workspace_id: 'w2', agent_status: 'idle' }];
  const installation = await stubInstallation({
    decisions: [...RECORDED.map(instance => instance.decision), awaited],
    agents,
    panes: agents.map(agent => ({ pane_id: agent.pane_id, workspace_id: 'w2' })),
  });
  try {
    const reaped = await installation.run('--reap', '--json');
    assert.equal(reaped.status, 0, reaped.stderr);
    const report = JSON.parse(reaped.stdout);
    assert.deepEqual(report.closed.map(entry => entry.pane).sort(), ['w2:p3H', 'w2:p3J', 'w2:p3K'], 'only the settled decisions\' sessions close');
    const held = report.sessions.find(entry => entry.pane === 'w2:p3L');
    assert.equal(held.disposition, 'hold-requested');
    assert.equal(held.lingering, false, 'an awaited decision never counts as a lingering settle');
    assert.equal(JSON.parse(readFileSync(installation.state, 'utf8')).agents.length, 1, 'the awaiting session\'s pane survives the pass');
  } finally {
    installation.close();
  }
});

test('integration:session-reaped-after-settle a session whose runtime is still working is held and reported lingering past the grace, and a foreign workspace\'s pane is never named', async () => {
  const working = { ...RECORDED[0], session: approverSessionNames(WORK.key, RECORDED[0].decision.id), pane: 'w2:p3H' };
  const agents = [
    { name: working.session, pane_id: 'w2:p3H', workspace_id: 'w2', agent_status: 'working' },
    { name: approverSessionNames(WORK.key, RECORDED[1].decision.id), pane_id: 'w9:p2', workspace_id: 'w9', agent_status: 'idle' },
    { name: 'some-bare-shell', pane_id: 'w2:p9Z', workspace_id: 'w2', agent_status: 'idle' },
  ];
  const installation = await stubInstallation({
    decisions: RECORDED.map(instance => instance.decision),
    agents,
    panes: agents.map(agent => ({ pane_id: agent.pane_id, workspace_id: agent.workspace_id })),
  });
  try {
    const status = await installation.run('--status', '--json');
    assert.equal(status.status, 1, 'the working session lingers past the grace and the reading says so');
    const report = JSON.parse(status.stdout);
    const held = report.sessions.find(entry => entry.pane === 'w2:p3H');
    assert.equal(held.disposition, 'hold-working');
    assert.equal(held.lingering, true);
    assert.equal(report.sessions.some(entry => entry.pane === 'w9:p2'), false, 'another workspace\'s pane is out of scope, never named');
    const shell = report.sessions.find(entry => entry.pane === 'w2:p9Z');
    assert.equal(shell.disposition, 'unmatched', 'an agent no known decision names is never a close candidate');

    const reaped = await installation.run('--reap', '--json');
    assert.equal(reaped.status, 1, 'the working session cannot close, so it still lingers after the pass');
    assert.deepEqual(JSON.parse(reaped.stdout).closed, []);
    const state = JSON.parse(readFileSync(installation.state, 'utf8'));
    assert.equal(state.panes.length, 3, 'nothing closed: not the working session, not the foreign pane, not the unmatched shell');
  } finally {
    installation.close();
  }
});

test('candidate condition, the live installation: the reaper\'s own reading names no coordination session open past the grace', { skip: !existsSync(join(COORDINATOR, '.graphyard', 'master.json')) && `not on the coordinator host: ${COORDINATOR} holds no coordinator config` }, async () => {
  // The change lives on this branch until it merges, so the audit runs the branch's own reaper
  // against the live control plane and Herdr through a coordinator config that mirrors the
  // coordinator checkout's -- same plane, same credential file, same workspace scope -- reading
  // only (--status closes nothing).
  const master = JSON.parse(readFileSync(join(COORDINATOR, '.graphyard', 'master.json'), 'utf8'));
  const scratch = mkdtempSync(join(tmpdir(), 'gy20-live-audit-'));
  try {
    mkdirSync(join(scratch, '.graphyard'), { recursive: true });
    writeFileSync(join(scratch, '.graphyard', 'master.json'), JSON.stringify({ url: master.url, herdrWorkspace: master.herdrWorkspace, repository: master.repository, credentialFile: master.credentialFile }, null, 1));
    const reading = spawnSync(process.execPath, [REAPER, '--status', '--json'], { cwd: scratch, encoding: 'utf8', timeout: 180_000 });
    assert.equal(reading.status, 0, `${reading.stderr || reading.stdout}\nthe live installation holds a session open 30 minutes or more after its decision settled`);
    const report = JSON.parse(reading.stdout);
    assert.equal(report.lingering, 0);
    assert.ok(report.items > 0, 'the reading reached the control plane');
    assert.ok(report.agents > 0, 'the reading reached Herdr');
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});

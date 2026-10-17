// GY-15 — fault class "observation": three instances in 24 hours (threshold 3), recorded by the
// master loop against the Graphyard installation that serves this repository. As GY-3 did for the
// configuration class, GY-11 for deployment, GY-17 for loop and GY-23 for resources, this file is
// the regression test the item's criterion asks for: each recorded instance is reproduced below
// against its recorded base state — the exact deployment, status document and webhook account the
// installation held at the recorded instants — and shown not to recur against the candidate
// condition, the state after the shared cause is removed. The last tests audit the live
// installation on the coordinator host, so the class's standing state stays visible instead of
// silently re-faulting; CI has no access to that host and skips those audits.
//
// The recorded instances, verbatim from the item (one per open-pull-request window, each the first
// loop cycle after the window opened — the ledger's own dispatch events bound them to the second):
//
//   2026-10-17T18:07:31.447Z  github-budget on github — pull request #2's review dispatched
//     18:07:14.719Z (ledger event 2444); the next cycle raised the item.
//   2026-10-17T18:24:38.534Z  github-budget on github — pull request #5 dispatched 18:24:29.123Z
//     (event 2711); the next cycle again.
//   2026-10-17T18:57:05.744Z  github-budget on github — pull request #9 dispatched 18:56:44.507Z
//     (event 3246); this cycle's fault step crossed the threshold and filed GY-15 itself
//     (created 18:57:09.080Z, event 3260, detectedAt = the cycle instant).
//
//   Each carries the same detail, character for character:
//
//   "No GitHub webhook delivery has arrived since the control plane started while 1 pull request
//   is open, and GitHub's webhook delivery log could not be read to tell a quiet hour from a
//   failing webhook; GITHUB_WEBHOOK_SECRET is not set, so every delivery is refused"
//
// The recorded base state, as the installation held it at every recorded instant (verified live on
// the coordinator host before this change, and asserted by the live audit below):
//
//   · the control plane is the Compose deployment graphyard-cryptob1-graphyard-snake-v4 (image
//     graphyard-local:cryptob1-graphyard-snake-v4, project under
//     /home/vish/.config/graphyard/cryptob1-graphyard-snake-v4/compose), installed by
//     `graphyard up --merger control-plane` — `install --no-github-app` (graphyard GY-1550/
//     GY-1527): "no App, GITHUB_APP_* unset, /api/status.github false". Its server.env holds none
//     of the five App variables (GITHUB_APP_ID, GITHUB_INSTALLATION_ID, GITHUB_PRIVATE_KEY,
//     GITHUB_WEBHOOK_SECRET, GITHUB_CI_APP_IDS), and the installation's own doctor passes
//     "github-app: not required (merger: control-plane)" — this is a designed mode, not a drift.
//   · so GET /api/status served (live read 2026-10-17T23:21Z): github false, githubBudget null,
//     appPermissions null, and a webhooks block of
//     { lastDeliveryAt: null, lastHour: 0, configured: false, settingsUrl: null,
//       openPullRequests: <n>, state: "unverified" } — with no corroboration fields at all,
//     because the status route composes them only when the GitHub service exists
//     (graphyard src/server/routes/status.ts: `github?.webhookDeliveries ? webhookCorroboration(…)
//     : null`, and src/github.ts githubFromEnv() returns null without GITHUB_APP_ID).
//   · the webhook_receipts table was empty from the database's creation (max(created_at) null →
//     liveness "since the control plane started"), and stays empty: the webhook route itself
//     demands the secret first (src/server/routes/github.ts:
//     `demand(secret, 'Webhook not configured', 503)`), so every delivery is refused before its
//     signature is even read — "every delivery is refused" is the endpoint's own behaviour,
//     reproduced against a real HTTP server below.
//
// The cause the three share: the deployment serves with no GitHub App at all, so the loop's
// webhook account is structurally unverified — it can neither accept a delivery (no secret: the
// endpoint refuses 503) nor read GitHub's own delivery log (no App JWT: the corroboration is
// absent, not failed) — and on a loopback control plane neither half can ever change by itself.
// webhookState (graphyard src/github.ts, GY-1649) has no outgoing edge from 'unverified' on this
// status document, so every open-pull-request window re-raises the same unverified silence;
// three windows inside 24 hours crossed the threshold and filed this item. The class did not stop
// there: pull request #14's window (dispatched 22:17:38.902Z) raised a fourth instance at
// 2026-10-17T22:17:51.774Z, which the loop linked to this item rather than filing again — the
// live cursor holds it, linkedTo GY-15, reproduced below.
//
// The candidate condition, each half the product's own:
//
//   · the operator's App binding — `graphyard github-setup http://127.0.0.1:4310` (the manifest
//     flow) or `graphyard app import` + `app bind SLUG`. On a loopback origin the product's own
//     manifest design registers the App with no webhook at all (GitHub refuses hook URLs it cannot
//     reach, so graphyard's appManifest sends no hook_attributes there) and still issues a local
//     GITHUB_WEBHOOK_SECRET (GY-1474/GY-1476). With the App bound, the delivery log is read with
//     the App JWT over the deployment's own outbound HTTPS — verified live from inside the server
//     container (api.github.com answers; the audit below keeps checking) — GitHub, having no
//     webhook to attempt, logs nothing, and the corroboration machinery (GY-1649) reads the gap as
//     quiet: no attention item, no fault, no recurrence. A delivery that does arrive is accepted
//     (the endpoint verifies its HMAC and records the receipt) and reads as delivering: nothing.
//     No agent identity may run this half: registering an App happens in the operator's own GitHub
//     session, and this test names it rather than waiting for it.
//   · the product handling the case itself (modelled — the GY-23/GY-24 precedent for loop code
//     this repository does not hold; it lives in graphyard's src/cli/github-budget-attention.ts
//     and src/master-status.ts): a control plane that reports no GitHub App at all
//     (status.github false — the installer's own merger:control-plane mode, the one doctor passes
//     as not required) has no webhook to be silent about. Its silence is the designed polling-only
//     state, a configuration fact, not a recurring observation fault: the webhook-silence attention
//     is derived only from a control plane the GitHub service serves, exactly as the status route
//     gates the corroboration it composes. With that, the App-less deployment raises no
//     github-budget observation fault on any cycle, and the class cannot recur from the designed
//     state; with an App bound, the corroboration tells quiet from failing and only a corroborated
//     failure faults, named with its attempts.
//
// The models below are faithful miniatures of those decision paths, at the fidelity the recorded
// instances exercised; each cites the graphyard source it models and refuses (rather than guesses)
// on arms the instances never touched. The webhook route's verification runs for real: a local
// HTTP server performing the route's own checks with Node's own crypto, so "every delivery is
// refused" is reproduced, not asserted. The file runs under `node --test` (plain JavaScript, Node
// builtins only) and needs no installed dependency.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';

// ---------------------------------------------------------------------------
// The recorded instants, subjects and detail, verbatim from the item and its ledger.
// ---------------------------------------------------------------------------

/** The three recorded instances: the window's first cycle instant, and the pull request whose review dispatch opened it (ledger event). */
const RECORDED = [
  { at: '2026-10-17T18:07:31.447Z', pr: 2, dispatchedAt: '2026-10-17T18:07:14.719Z' },
  { at: '2026-10-17T18:24:38.534Z', pr: 5, dispatchedAt: '2026-10-17T18:24:29.123Z' },
  { at: '2026-10-17T18:57:05.744Z', pr: 9, dispatchedAt: '2026-10-17T18:56:44.507Z' },
];

/** The fourth window the loop counted after filing: pull request #14, linked to this item, not filed again. */
const AFTER_FILING = { at: '2026-10-17T22:17:51.774Z', pr: 14, dispatchedAt: '2026-10-17T22:17:38.902Z' };

/** The detail every recorded instance carries, character for character. */
const RECORDED_DETAIL =
  'No GitHub webhook delivery has arrived since the control plane started while 1 pull request is open, and GitHub\'s webhook delivery log could not be read to tell a quiet hour from a failing webhook; GITHUB_WEBHOOK_SECRET is not set, so every delivery is refused';

/** This item's origin as the control plane holds it (read from `status GY-15` before this change): the filing the model below must reproduce exactly. */
const ITEM_ORIGIN = {
  class: 'observation', threshold: 3, windowHours: 24, count: 3, detectedAt: '2026-10-17T18:57:05.744Z',
  instances: RECORDED.map(({ at }) => ({ id: `github-budget|github|${at}`, kind: 'github-budget', subject: 'github', at })),
};

/** The criterion this item carries (the filing template's non-human arm, graphyard faultClassItem). */
const ITEM_AC1 =
  'The shared cause of the recurring observation faults is found and removed at the candidate: each instance listed on this item is reproduced against the base and shown not to recur against the candidate, by a test the change adds';

/** The coordinator checkout whose .graphyard/ holds the loop's own records; absent on a CI runner. */
const COORDINATOR_ROOT = '/home/vish/code/graphyard-snake-v4';
const MASTER_CONFIG = join(COORDINATOR_ROOT, '.graphyard', 'master.json');
/** The control plane's server container, whose own egress the App binding needs; absent on a CI runner. */
const SERVER_CONTAINER = 'graphyard-cryptob1-graphyard-snake-v4-server-1';

// ---------------------------------------------------------------------------
// The webhook route's own checks (graphyard src/server/routes/github.ts POST /api/github/webhook),
// run for real: the secret demand, the HMAC verification, the managed-repository and delivery-id
// guards. The store arms past the guards (receipt dedupe, wake) are trimmed to the receipt the
// liveness read counts — the fidelity the recorded instances exercised.
// ---------------------------------------------------------------------------

/** The route's `demand` (graphyard src/model/refusal.ts): a refusal carries the HTTP status it answers with. */
class Refusal extends Error {
  constructor(message, status) { super(message); this.status = status; }
}
const demand = (value, message, status = 409) => { if (!value) throw new Refusal(message, status); };

/**
 * The webhook endpoint over one installation: the route's own sequence of checks, answering its
 * own status codes and `{"error": message}` bodies, and recording in `installation.receipts` the
 * receipt a verified delivery writes (the only store effect the liveness read observes).
 */
function webhookEndpoint(installation) {
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks);
      const send = (status, body) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
      try {
        const secret = installation.env.GITHUB_WEBHOOK_SECRET;
        demand(secret, 'Webhook not configured', 503);
        const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`);
        const actual = Buffer.from(String(req.headers['x-hub-signature-256'] ?? ''));
        demand(expected.length === actual.length && timingSafeEqual(expected, actual), 'Invalid webhook signature', 401);
        const payload = JSON.parse(raw.toString());
        const managed = installation.github?.repository?.toLowerCase();
        demand(managed && payload?.repository?.full_name?.toLowerCase() === managed, 'Repository is not managed', 403);
        const delivery = String(req.headers['x-github-delivery'] ?? '');
        demand(delivery && delivery.length < 200, 'Missing delivery ID', 400);
        if (!installation.receipts.some(receipt => receipt.id === delivery)) installation.receipts.push({ id: delivery, at: new Date().toISOString() });
        send(202, { accepted: true });
      } catch (error) {
        if (error instanceof Refusal) return send(error.status, { error: error.message });
        send(500, { error: 'webhook failed' });
      }
    });
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/api/github/webhook` })));
}

/** One delivery POSTed to the endpoint, signed as GitHub signs it when `secret` is given. */
async function postDelivery(url, { event = 'pull_request', delivery = `d-${Math.random().toString(16).slice(2)}`, payload, secret }) {
  const body = Buffer.from(JSON.stringify(payload ?? { repository: { full_name: 'cryptob1/graphyard-snake-v4' } }));
  const headers = { 'content-type': 'application/json', 'x-github-event': event, 'x-github-delivery': delivery };
  if (secret !== undefined) headers['x-hub-signature-256'] = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
  const response = await fetch(url, { method: 'POST', headers, body });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// ---------------------------------------------------------------------------
// The status document's own builders (graphyard src/github.ts and src/server/routes/status.ts),
// mirrored at the fidelity the recorded instants exercised.
// ---------------------------------------------------------------------------

/** `failedDelivery` (src/github.ts): any non-2xx answer fails, except a 403 proved foreign to the managed repository. */
function failedDelivery(attempt, repositoryId) {
  if (attempt.statusCode >= 200 && attempt.statusCode < 300) return false;
  if (attempt.statusCode !== 403) return true;
  return attempt.repositoryId === null || repositoryId === null || attempt.repositoryId === repositoryId;
}

/** `webhookCorroboration` (src/github.ts, GY-1649), verbatim: judges the receipts gap against GitHub's log. */
function webhookCorroboration(log, lastDeliveryAt, now, scope) {
  const ours = (log?.attempts ?? []).filter(attempt => (attempt.installationId === null || attempt.installationId === scope.installationId)
    && (attempt.repositoryId === null || scope.repositoryId === null || attempt.repositoryId === scope.repositoryId));
  const since = lastDeliveryAt ? Date.parse(lastDeliveryAt) : now - 3_600_000;
  const covered = log?.observedAt && log.coversFrom && Date.parse(log.coversFrom) > since ? log.coversFrom : null;
  const window = log?.observedAt ? ours.filter(attempt => Date.parse(attempt.at) > since) : [];
  const failed = window.filter(attempt => failedDelivery(attempt, scope.repositoryId));
  return { lastAttemptAt: ours[0]?.at ?? null, windowSince: log?.observedAt ? new Date(since).toISOString() : null, coveredFrom: covered, attemptsInWindow: window.length, failedAttempts: failed.length,
    failedStatusCodes: [...new Set(failed.map(attempt => attempt.statusCode))].sort((a, b) => a - b), deliveryLogAt: log?.observedAt ?? null, deliveryLogError: log?.error ?? null };
}

/** `webhookState` (src/github.ts, GY-1649), verbatim: what a receipts gap is, corroborated. */
function webhookState(webhooks, now) {
  if (webhooks.lastDeliveryAt && now - Date.parse(webhooks.lastDeliveryAt) < 3_600_000) return 'delivering';
  if (!webhooks.deliveryLogAt || webhooks.deliveryLogError) return 'unverified';
  if ((webhooks.failedAttempts ?? 0) > 0) return 'failing';
  if (webhooks.coveredFrom) return 'unverified';
  return (webhooks.attemptsInWindow ?? 0) > 0 ? 'answered' : 'quiet';
}

/** The store's liveness read (src/store/store.ts webhookLiveness): the last receipt and the last hour's count. */
const webhookLiveness = (receipts, now) => ({
  lastDeliveryAt: receipts.length ? receipts.reduce((last, receipt) => (Date.parse(receipt.at) > Date.parse(last) ? receipt.at : last), receipts[0].at) : null,
  lastHour: receipts.filter(receipt => now - Date.parse(receipt.at) < 3_600_000).length,
});

/**
 * GET /api/status's webhooks block and github flag (src/server/routes/status.ts), composed exactly
 * as the route composes them over one installation: the liveness read, the configured flag from the
 * deployment's own env, the corroboration only when the GitHub service exists (the route's
 * `github?.webhookDeliveries ? … : null`), the open-pull-request count over the work records (the
 * route's own filter), and the state.
 */
function serveStatus(installation, now) {
  const liveness = webhookLiveness(installation.receipts, now);
  const corroboration = installation.github ? webhookCorroboration(installation.github.webhookDeliveries, liveness.lastDeliveryAt, now, installation.github.scope) : null;
  const webhooks = {
    ...liveness,
    configured: !!installation.env.GITHUB_WEBHOOK_SECRET,
    settingsUrl: installation.github?.settingsUrl ?? null,
    ...corroboration,
    openPullRequests: installation.work.filter(item => item.stage !== 'done' && !!item.submission && !!item.observation && !item.observation.merged && item.observation.prState !== 'closed').length,
    state: webhookState({ ...liveness, ...corroboration }, now),
  };
  return { github: !!installation.github, githubBudget: installation.github ? {} : null, webhooks };
}

// ---------------------------------------------------------------------------
// The attention builder and its classification (graphyard src/cli/github-budget-attention.ts
// webhookAttention; src/model/fault-classes.ts attentionKind), mirrored at the fidelity the
// recorded instants exercised: the webhook item verbatim, the pause/exhaustion/token items trimmed
// (the recorded status carried githubBudget null, so none of them was even built), and the
// attention-kind rule with the signature list's own order.
// ---------------------------------------------------------------------------

/** The attention item's agent attribution, trimmed to the fields the fault observation keeps. */
const agentOwner = (owner, next) => ({ owner, next });

/** `elapsed` (src/cli/github-budget-attention.ts), verbatim: how long a wait is, in the unit the reader thinks in. */
const elapsed = ms => ms >= 3_600_000 ? `${Math.floor(ms / 3_600_000)}h${Math.floor(ms % 3_600_000 / 60_000)}m` : `${Math.max(0, Math.floor(ms / 60_000))}m`;

/** `webhookAttention` (src/cli/github-budget-attention.ts, GY-1649), verbatim. */
function webhookAttention(status, now) {
  const webhooks = status.webhooks;
  if (!webhooks || webhooks.openPullRequests === 0) return [];
  const state = webhookState(webhooks, now);
  if (state !== 'failing' && state !== 'unverified') return [];
  const since = webhooks.lastDeliveryAt ? now - Date.parse(webhooks.lastDeliveryAt) : null;
  const settings = webhooks.settingsUrl ?? 'https://github.com/settings/apps';
  const open = `${webhooks.openPullRequests} pull request${webhooks.openPullRequests === 1 ? ' is' : 's are'} open`;
  const silence = `No GitHub webhook delivery has arrived ${since === null ? 'since the control plane started' : `for ${elapsed(since)} (last at ${webhooks.lastDeliveryAt})`} while ${open}`;
  const secret = webhooks.configured === false ? '; GITHUB_WEBHOOK_SECRET is not set, so every delivery is refused' : '';
  if (state === 'unverified' && webhooks.coveredFrom && webhooks.deliveryLogAt && !webhooks.deliveryLogError) return [{ subject: 'github',
    text: `${silence}, and GitHub's webhook delivery log was read back only to ${webhooks.coveredFrom}, after the gap began at ${webhooks.windowSince ?? 'its start'}: the ${webhooks.attemptsInWindow ?? 0} attempt${webhooks.attemptsInWindow === 1 ? '' : 's'} it covers were answered, but an older attempt in the gap is unread, so the gap is neither quiet nor answered${secret}`,
    ...agentOwner('master', `Read the deliveries under ${settings}/advanced back to ${webhooks.windowSince ?? 'the gap\'s start'}: failed attempts there are a broken webhook (URL https://YOUR-HOST/api/github/webhook, the secret matching GITHUB_WEBHOOK_SECRET); a delivery that arrives clears this`) }];
  if (state === 'unverified') return [{ subject: 'github',
    text: `${silence}, and GitHub's webhook delivery log could not be read${webhooks.deliveryLogError ? ` (${webhooks.deliveryLogError})` : ''} to tell a quiet hour from a failing webhook${webhooks.deliveryLogAt ? ` (its last read, at ${webhooks.deliveryLogAt}, is history, not this hour's account)` : ''}${secret}`,
    ...agentOwner('master', `Read the deliveries under ${settings}/advanced: none attempted is a quiet hour, failed attempts are a broken webhook (URL https://YOUR-HOST/api/github/webhook, the secret matching GITHUB_WEBHOOK_SECRET); a delivery that arrives or a readable log clears this`) }];
  const failed = webhooks.failedAttempts ?? 0, attempts = webhooks.attemptsInWindow ?? failed;
  return [{ subject: 'github',
    text: `${silence}: GitHub attempted ${attempts} deliver${attempts === 1 ? 'y' : 'ies'} since ${webhooks.windowSince ?? 'the gap began'} and ${failed} failed (status ${(webhooks.failedStatusCodes ?? []).join(', ') || 'unknown'}; last attempt at ${webhooks.lastAttemptAt ?? 'unknown'})${secret}: polling is compensating at its safety-net cadence, so the webhook is broken rather than the control plane slow`,
    ...agentOwner('master', `Check the App webhook settings at ${settings} (URL https://YOUR-HOST/api/github/webhook, the secret matching GITHUB_WEBHOOK_SECRET, the failed deliveries listed under ${settings}/advanced; status 0 is a connection GitHub could not make, 401 a secret mismatch, 404 a wrong URL, 5xx the endpoint failing); a delivery that arrives clears this`) }];
}

/** The catalogue's observation row and the class of a kind (src/model/fault-classes.ts). */
const faultCatalogue = { observation: ['github-budget', 'integration-job', 'action:refresh'] };
const classByKind = new Map(Object.entries(faultCatalogue).flatMap(([name, kinds]) => kinds.map(kind => [kind, name])));
const faultClassOf = kind => classByKind.get(kind) ?? 'unclassified';

/** `attentionKind`'s signature list (src/model/fault-classes.ts), verbatim in its own order; the github-budget line is the one the recorded items match. */
const signatures = [
  ['concurrency-starved', () => false], ['review-settlement', () => false], ['launch-review', () => false],
  ['resource-bound', (subject, text) => subject.startsWith('resource:') || /is held by a registered resource at its bound/.test(text)],
  ['ledger-refusal', (_, text) => /cannot be requested because the .+ refused the write/.test(text)],
  ['disk-pressure', subject => subject === 'disk'], ['memory-pressure', subject => subject === 'memory'],
  ['scope-request', (_, text) => /needs files outside plannedFiles/.test(text)],
  ['consent-hold', (_, text) => /is awaiting consent/.test(text)],
  ['review-conflict', (_, text) => /^Review of \S+ head \S+ \(PR #\d+\) is conflicted/.test(text)],
  ['unobtainable-review', (_, text) => /cannot obtain a review of/.test(text)],
  ['decision-refused', (_, text) => /^Decision \S+ \(\S+\) was refused/.test(text)],
  ['decision-stale', (_, text) => /^Decision \S+ \(\S+\) is stale/.test(text)],
  ['decision-unanswered', (_, text) => /^Decision \S+ \(\S+\) is unanswered/.test(text)],
  ['approver-launch', (_, text) => /is awaiting an approver for/.test(text)], ['request-remedy', (_, text) => /request for .+ awaits the \S+ decision its evidence calls for/.test(text)],
  ['stalled-action', (_, text) => /\S+ action is stalled\b/.test(text)],
  ['stalled-item', (_, text) => /has held its \S+ gate for .+ with no action named/.test(text)],
  ['actorless', (_, text) => /no rework request and no named wait/.test(text)], ['unanswered-request', (_, text) => /has stood unanswered for/.test(text)],
  ['stuck-request', (_, text) => /^\S+ request \S+ on \S+ \(session \S+\) is pending/.test(text)],
  ['overlong-session', (_, text) => /past the .+ maximum for its role/.test(text)],
  ['context-overflow', (_, text) => /escalation context for \S+ assembled to/.test(text)],
  ['timing-failure', (_, text) => /^Required CI check .+ failed on .*timing-dependent/.test(text)],
  ['nonexercising-proof', (_, text) => /^\S+ is awaiting rework for a non-exercising proof: /.test(text)],
  ['retry-stopped', (_, text) => /^The loop stopped retrying .+: \d+ consecutive attempts failed with the same client error/.test(text)],
  ['agent-request', (_, text) => /recorded a \S+ on \S+ .+ ago and released/.test(text)],
  ['owed-decision', (_, text) => /no executor may run it; .+ has been owed for/.test(text)],
  ['generated-files', (_, text) => /generated-file manifest|GRAPHYARD_GENERATED_FILES/.test(text)],
  ['github-budget', subject => subject === 'github'],
  ['intervention-pattern', subject => subject === 'interventions'],
  ['throughput', subject => subject === 'throughput'],
  ['executor', (subject, text) => subject === 'executors' || /^Nothing can run \S+: |^Every declared executor slot on this host is down/.test(text)],
  ['setup', subject => subject === 'setup'],
  ['dispatch-failures', subject => subject === 'dispatch'],
  ['loop-cursor', (subject, text) => subject === 'loop' && /cursor cannot be read/.test(text)],
  ['loop-liveness', subject => subject === 'loop'],
  ['installation', subject => subject === 'installation'],
];

/** The kind of one attention line: the one its wording names (the recorded lines carry no kind of their own). */
const attentionKind = item => signatures.find(([, match]) => match(item.subject, item.text))?.[0] ?? 'unclassified';

/** The daemon's derived-fault arm for the reported budget attention (src/daemon/faults.ts cycleFaults → classifyAttention), at the fidelity exercised. */
const cycleFaults = (status, now) => webhookAttention(status, now)
  .map(item => ({ kind: attentionKind(item), faultClass: faultClassOf(attentionKind(item)), subject: item.subject, text: item.text.slice(0, 500) }));

// ---------------------------------------------------------------------------
// The loop's fault record and class filing (graphyard src/model/fault-wording.ts wording,
// src/model/fault-record.ts trackFaults/linkInstance, src/model/fault-class-recurrence.ts
// windowedUnlinked/recurringClasses/faultClassItem, src/model/fault-classes.ts policy defaults),
// mirrored at the fidelity the recorded instants exercised: the escalation-absorption and
// partial-read arms of trackFaults are trimmed (the status read succeeded every cycle; no
// decision-unanswered line stood), as is the retention bound (the live record holds 242 instances
// of the 1000 it retains).
// ---------------------------------------------------------------------------

/** `wording` (src/model/fault-wording.ts), verbatim: a fault's line less the figures that move while it stands. */
const hexTokens = text => text.replace(/\b(?=[a-f]*\d)[0-9a-f]{7,40}\b/gi, '#');
const figureless = text => (text.toLowerCase().replace(/\d+/g, '#').match(/[a-z]+|#/g) ?? []).map(word => word.replace(/s$/, ''))
  .filter(word => !/^(|i|are|wa|were|ha|have|m|h|d|w|second|minute|hour|day|week)$/.test(word)).join(' ').replace(/#( #)+/g, '#').slice(0, 300);
const wording = text => figureless(hexTokens(text));

/** One cycle's observations against the record (src/model/fault-record.ts trackFaults), at the fidelity exercised. */
function trackFaults(record, observations, at) {
  const opened = [], repeats = new Map(), seen = new Set();
  for (const observation of observations) {
    const base = `${observation.kind}|${observation.subject}|${wording(observation.text)}`, nth = repeats.get(base) ?? 0, key = nth ? `${base}#${nth}` : base;
    repeats.set(base, nth + 1); seen.add(key);
    const standing = record.open[key] ? record.instances.find(entry => entry.id === record.open[key]) : undefined;
    if (standing) { standing.lastSeenAt = at; standing.text = observation.text.slice(0, 500); continue; }
    const instance = { id: `${observation.kind}|${observation.subject}|${at}${nth ? `#${nth}` : ''}`, kind: observation.kind, faultClass: observation.faultClass,
      subject: observation.subject, text: observation.text.slice(0, 500), at, lastSeenAt: at, linkedTo: null };
    record.instances.push(instance); record.open[key] = instance.id; opened.push(instance);
  }
  for (const key of Object.keys(record.open)) if (!seen.has(key)) delete record.open[key];
  return opened;
}

/** `linkInstance` (src/model/fault-record.ts): an instance links to the item that stands for its class. */
function linkInstance(record, instance, key) {
  instance.linkedTo = key;
  const linked = record.linked ??= {}, latest = linked[key];
  if (latest === undefined || Date.parse(instance.at) > Date.parse(latest)) linked[key] = instance.at;
}

/** The class policy the loop holds (src/model/fault-classes.ts faultClassPolicyDefaults). */
const POLICY = { threshold: 3, windowHours: 24 };

/** `windowedUnlinked` (src/model/fault-class-recurrence.ts), verbatim. */
const windowedUnlinked = (instances, faultClass, now) => {
  const from = now - POLICY.windowHours * 3_600_000;
  return instances.filter(entry => entry.faultClass === faultClass && Date.parse(entry.at) >= from && Date.parse(entry.at) <= now && !entry.linkedTo);
};

/** The open item naming the class (src/model/fault-classes.ts openFaultClassItem), at the fidelity exercised. */
const openFaultClassItem = (work, faultClass) => work.find(item => item.stage !== 'done' && item.origin?.faultClass?.class === faultClass) ?? null;

/** `recurringClasses` for the observation class (src/model/fault-class-recurrence.ts), at the fidelity exercised. */
function recurringClasses(instances, work, now) {
  const faultClass = 'observation';
  const recent = windowedUnlinked(instances, faultClass, now);
  const item = openFaultClassItem(work, faultClass);
  const unlinked = item ? instances.filter(entry => entry.faultClass === faultClass && !entry.linkedTo) : recent;
  if (!unlinked.length) return [];
  return [{ faultClass, count: recent.length, recent, unlinked, item, file: !item && recent.length >= POLICY.threshold }];
}

/** `faultClassItem`'s non-human arm (src/model/fault-class-recurrence.ts), verbatim for this class. */
function faultClassItem(recurrence, now) {
  const at = new Date(now).toISOString();
  const origin = { class: 'observation', threshold: POLICY.threshold, windowHours: POLICY.windowHours, count: recurrence.recent.length, detectedAt: at,
    instances: recurrence.recent.slice(0, 100).map(({ id, kind, subject, at: seen }) => ({ id, kind, subject, at: seen })) };
  const description = [
    `The master loop filed this item itself: ${recurrence.recent.length} observation faults in ${POLICY.windowHours} hours (threshold ${POLICY.threshold}). The class means a read of GitHub or of a check that is paused, stale or silent.`,
    `Fixing these one instance at a time is what this item replaces: find the cause the instances share and remove it, so the product handles the case itself. Later instances of the class are linked to this item rather than filed again. Whether the class stays quiet after this ships is not evidence this item can carry: the loop keeps counting it, and a recurrence past the threshold after delivery files a new item.`,
    `Subjects affected: ${[...new Set(recurrence.recent.map(entry => entry.subject))].join(', ')}.`,
    'Instances (the evidence):',
    ...recurrence.recent.slice(0, 100).map(entry => `- ${entry.at} ${entry.kind} on ${entry.subject}: ${entry.text}`),
  ].join('\n\n');
  return {
    key: 'GY-15', title: `Recurring observation faults: ${recurrence.recent.length} in ${POLICY.windowHours} hours`.slice(0, 200), description: description.slice(0, 20000), type: 'bug', priority: 1,
    stage: 'backlog', origin: { faultClass: origin },
    criteria: [{ id: 'AC-1', text: ITEM_AC1, proofs: ['manual:fault-class-observation'] }],
    reason: `The observation fault class recurred past its threshold (${recurrence.recent.length} ≥ ${POLICY.threshold} in ${POLICY.windowHours} hours) and no open item names it`,
  };
}

// ---------------------------------------------------------------------------
// The loop's fault step over one installation (src/daemon/faults.ts: cycleFaults → trackFaults →
// fileRecurringFaultClasses), at the fidelity exercised: derive, track, then file or link.
// ---------------------------------------------------------------------------

function makeLoop() {
  const state = { faults: { instances: [], open: {}, linked: {} }, work: [] };
  const faultStep = (installation, cycleAt) => {
    const status = serveStatus(installation, Date.parse(cycleAt));
    const observations = cycleFaults(status, Date.parse(cycleAt));
    const opened = trackFaults(state.faults, observations, cycleAt);
    const filings = [];
    for (const recurrence of recurringClasses(state.faults.instances, state.work, Date.parse(cycleAt))) {
      if (recurrence.item) { for (const instance of recurrence.unlinked) linkInstance(state.faults, instance, recurrence.item.key); continue; }
      if (!recurrence.file) continue;
      const item = faultClassItem(recurrence, Date.parse(cycleAt));
      state.work.push(item); filings.push(item);
      for (const instance of recurrence.recent) linkInstance(state.faults, instance, item.key);
    }
    return { status, observations, opened, filings };
  };
  return { state, faultStep };
}

/** The recorded installation: the compose deployment's own state at the recorded instants — no App, no secret, no receipt, the delivery log unreadable. */
const recordedInstallation = () => ({ env: {}, github: null, receipts: [], work: [] });

/** One pull-request window on the control plane's work records: the submitted candidate the open-count filter reads. */
const openCandidate = (key, pr) => ({ key, stage: 'build', submission: { pr }, observation: { prState: 'open', merged: false } });
/** The candidate once its pull request closed: the window's end, as between the recorded instants. */
const closedCandidate = candidate => ({ ...candidate, observation: { ...candidate.observation, prState: 'closed' } });

test(`instance ${RECORDED[0].at} github-budget on github: the endpoint refuses every delivery, the log cannot be read, and the next cycle raises the recorded sentence`, async () => {
  // Each recorded instant is the first loop cycle after its window opened: the ledger's own
  // dispatch events bound every instance — the fourth included — to its pull request within one
  // cycle (~21–26 s at the loop's cadence). The windows are the pipeline's own motions, not the
  // loop's; the loop only counted them.
  for (const { at, dispatchedAt } of [...RECORDED, AFTER_FILING]) {
    const lag = Date.parse(at) - Date.parse(dispatchedAt);
    assert.ok(lag > 0 && lag < 30_000, `${at} is the first cycle after ${dispatchedAt} (one cycle, ${lag} ms later)`);
  }
  const installation = recordedInstallation();
  const endpoint = await webhookEndpoint(installation);
  try {
    // The deployment holds no secret, so the route's own first check refuses the delivery before its
    // signature is even read — "every delivery is refused", reproduced against real HTTP.
    const refused = await postDelivery(endpoint.url, { secret: 'the-secret-github-would-sign-with' });
    assert.equal(refused.status, 503);
    assert.equal(refused.body.error, 'Webhook not configured');
    assert.deepEqual(installation.receipts, [], 'no receipt is written, so liveness keeps reading null');

    // The status document, exactly as the live control plane served it at the recorded instant.
    installation.work = [openCandidate('GY-A', RECORDED[0].pr)];
    const loop = makeLoop();
    const cycle = loop.faultStep(installation, RECORDED[0].at);
    assert.equal(cycle.status.github, false, 'installed with --no-github-app: the GitHub service is absent');
    assert.equal(cycle.status.githubBudget, null);
    assert.deepEqual(cycle.status.webhooks, { lastDeliveryAt: null, lastHour: 0, configured: false, settingsUrl: null, openPullRequests: 1, state: 'unverified' });
    assert.equal('deliveryLogAt' in cycle.status.webhooks, false, 'the corroboration is absent, not failed: no GitHub service exists to read the log');

    // The recorded instance, word for word, classified as the catalogue classifies it.
    assert.equal(cycle.observations.length, 1);
    const [observation] = cycle.observations;
    assert.equal(observation.kind, 'github-budget');
    assert.equal(observation.faultClass, 'observation');
    assert.equal(observation.subject, 'github');
    assert.equal(observation.text, RECORDED_DETAIL);
    assert.equal(cycle.opened.length, 1);
    assert.equal(cycle.opened[0].id, `github-budget|github|${RECORDED[0].at}`);
    // One instance in the window: below the threshold, nothing files.
    assert.deepEqual(loop.state.faults.instances.map(instance => instance.id), [`github-budget|github|${RECORDED[0].at}`]);
    assert.deepEqual(cycle.filings, []);
  } finally {
    endpoint.server.close();
  }
});

test(`instance ${RECORDED[1].at} github-budget on github: the second window opens the second instance — one cause per window, never one per cycle`, () => {
  const installation = recordedInstallation();
  const loop = makeLoop();
  const first = openCandidate('GY-A', RECORDED[0].pr), second = openCandidate('GY-B', RECORDED[1].pr);

  // Window one: the recorded instant opens the instance; a later cycle in the same window only moves its last-seen.
  installation.work = [first];
  loop.faultStep(installation, RECORDED[0].at);
  installation.work = [first];
  const later = loop.faultStep(installation, '2026-10-17T18:08:22.000Z');
  assert.equal(later.opened.length, 0, 'the standing instance is the same fault');
  assert.equal(loop.state.faults.instances.length, 1);
  assert.equal(loop.state.faults.instances[0].lastSeenAt, '2026-10-17T18:08:22.000Z');

  // Between the windows the pull request count cleared, so the observation ended — the record's own rule.
  installation.work = [closedCandidate(first)];
  const between = loop.faultStep(installation, '2026-10-17T18:23:00.000Z');
  assert.deepEqual(between.observations, []);
  assert.deepEqual(loop.state.faults.open, {}, 'the standing instance ended with its window');

  // Window two: pull request #5 dispatched 18:24:29.123Z, the next cycle raised the item again.
  installation.work = [closedCandidate(first), second];
  const cycle = loop.faultStep(installation, RECORDED[1].at);
  assert.equal(cycle.observations[0].text, RECORDED_DETAIL, 'the same sentence, unchanged: the base state did not move');
  assert.deepEqual(loop.state.faults.instances.map(instance => instance.id), [`github-budget|github|${RECORDED[0].at}`, `github-budget|github|${RECORDED[1].at}`]);
  assert.equal(windowedUnlinked(loop.state.faults.instances, 'observation', Date.parse(RECORDED[1].at)).length, 2);
  assert.deepEqual(cycle.filings, [], 'two of three: below the threshold, still nothing filed');
});

test(`instance ${RECORDED[2].at} github-budget on github: the third window crosses the threshold and files exactly this item; the fourth links to it`, () => {
  const installation = recordedInstallation();
  const loop = makeLoop();
  const candidates = [openCandidate('GY-A', RECORDED[0].pr), openCandidate('GY-B', RECORDED[1].pr), openCandidate('GY-C', RECORDED[2].pr)];

  // The first two windows, each ending before the next began.
  installation.work = [candidates[0]];
  loop.faultStep(installation, RECORDED[0].at);
  installation.work = [closedCandidate(candidates[0])];
  loop.faultStep(installation, '2026-10-17T18:23:00.000Z');
  installation.work = [closedCandidate(candidates[0]), candidates[1]];
  loop.faultStep(installation, RECORDED[1].at);
  installation.work = [closedCandidate(candidates[0]), closedCandidate(candidates[1])];
  loop.faultStep(installation, '2026-10-17T18:50:00.000Z');

  // Window three: pull request #9 dispatched 18:56:44.507Z; the cycle at 18:57:05.744Z is the one
  // whose fault step both opened the third instance and filed the item (created 18:57:09.080Z).
  installation.work = [...candidates.map((candidate, index) => index < 2 ? closedCandidate(candidate) : candidate)];
  const cycle = loop.faultStep(installation, RECORDED[2].at);
  assert.equal(cycle.opened.length, 1);
  assert.equal(cycle.opened[0].id, `github-budget|github|${RECORDED[2].at}`);
  assert.equal(cycle.filings.length, 1, 'three unlinked instances in 24 hours reach the threshold');

  // The filing is this item, field for field.
  const [filed] = cycle.filings;
  assert.equal(filed.title, 'Recurring observation faults: 3 in 24 hours');
  assert.equal(filed.type, 'bug');
  assert.equal(filed.priority, 1);
  assert.deepEqual(filed.origin.faultClass, ITEM_ORIGIN);
  assert.deepEqual(filed.criteria, [{ id: 'AC-1', text: ITEM_AC1, proofs: ['manual:fault-class-observation'] }]);
  assert.equal(filed.description.split('\n\n')[0], 'The master loop filed this item itself: 3 observation faults in 24 hours (threshold 3). The class means a read of GitHub or of a check that is paused, stale or silent.');
  assert.equal(filed.description.split('\n\n')[2], 'Subjects affected: github.');
  for (const { at } of RECORDED) assert.ok(filed.description.includes(`- ${at} github-budget on github: ${RECORDED_DETAIL}`), `the filing lists the ${at} instance verbatim`);
  // Every instance the filing counted is linked to the item it filed.
  for (const instance of loop.state.faults.instances) assert.equal(instance.linkedTo, 'GY-15');

  // The fourth window — pull request #14, dispatched 22:17:38.902Z, after the third window had
  // closed in between — raises the same sentence and links to this item instead of filing again:
  // the live cursor holds exactly this row (github-budget|github|2026-10-17T22:17:51.774Z).
  installation.work = candidates.map(closedCandidate);
  loop.faultStep(installation, '2026-10-17T20:00:00.000Z');
  installation.work = [...candidates.map(closedCandidate), openCandidate('GY-D', AFTER_FILING.pr)];
  const fourth = loop.faultStep(installation, AFTER_FILING.at);
  assert.equal(fourth.observations[0].text, RECORDED_DETAIL);
  assert.equal(fourth.opened.length, 1);
  assert.equal(fourth.opened[0].id, `github-budget|github|${AFTER_FILING.at}`);
  assert.equal(fourth.opened[0].linkedTo, 'GY-15', 'a later instance links to the standing item');
  assert.deepEqual(fourth.filings, [], 'nothing files while the item stands');
  assert.equal(loop.state.faults.linked['GY-15'], AFTER_FILING.at, 'the linked map keeps the newest first-seen, as the live cursor does');
});

test('the shared cause: on this status document the unverified state has no outgoing edge — and the one variable an agent could set does not add one', async () => {
  const installation = recordedInstallation();
  const endpoint = await webhookEndpoint(installation);
  try {
    const candidate = openCandidate('GY-A', RECORDED[0].pr);
    installation.work = [candidate];
    const loop = makeLoop();
    const wordings = new Set();
    // Hours pass, deliveries are attempted, cycles run: the state cannot leave 'unverified'.
    for (const [offset, label] of [[0, 'the recorded instant'], [3_600_000, 'an hour later'], [3 * 3_600_000, 'three hours later'], [23 * 3_600_000, 'a day less an hour']]) {
      const at = new Date(Date.parse(RECORDED[0].at) + offset).toISOString();
      const attempted = await postDelivery(endpoint.url, { delivery: `attempt-${offset}`, secret: 'any-secret-at-all' });
      assert.equal(attempted.status, 503, `${label}: the endpoint still refuses every delivery`);
      const cycle = loop.faultStep(installation, at);
      assert.equal(cycle.status.webhooks.state, 'unverified', `${label}: still unverified — no delivery was accepted, no log was read`);
      assert.equal(cycle.status.webhooks.lastDeliveryAt, null);
      assert.equal('deliveryLogAt' in cycle.status.webhooks, false);
      assert.equal(cycle.observations[0].text, RECORDED_DETAIL);
      wordings.add(wording(cycle.observations[0].text));
    }
    assert.equal(wordings.size, 1, 'one unchanged wording: every cycle of every window is the one cause');
    assert.equal(installation.receipts.length, 0);

    // The half-measure, answered: setting GITHUB_WEBHOOK_SECRET alone (the one env variable an
    // agent identity could write on the deployment) removes the refusing clause but leaves the
    // account unverified — the GitHub service is still absent, the log is still unreadable, and the
    // item still fires on every open-pull-request window. The secret is not the remedy.
    installation.env.GITHUB_WEBHOOK_SECRET = 'f'.repeat(64);
    const cycle = loop.faultStep(installation, new Date(Date.parse(RECORDED[0].at) + 86_400_000).toISOString());
    assert.equal(cycle.status.webhooks.configured, true);
    assert.equal(cycle.status.webhooks.state, 'unverified');
    assert.equal(cycle.observations[0].text,
      'No GitHub webhook delivery has arrived since the control plane started while 1 pull request is open, and GitHub\'s webhook delivery log could not be read to tell a quiet hour from a failing webhook');
    const accepted = await postDelivery(endpoint.url, { secret: 'f'.repeat(64) });
    assert.equal(accepted.status, 403, 'with no GitHub service the route still refuses the repository as unmanaged — the App, not the secret, is the missing half');
    assert.equal(installation.receipts.length, 0);
  } finally {
    endpoint.server.close();
  }
});

test('candidate condition, the operator\'s App binding: the App-bound loopback install reads its delivery log and the same windows raise nothing', async () => {
  // The App-bound state the product's own local-install design builds: an App registered on the
  // loopback origin with no webhook (GitHub refuses hook URLs it cannot reach, so the manifest
  // sends none), a locally-issued GITHUB_WEBHOOK_SECRET, and the delivery log read with the App JWT
  // — empty, because GitHub has no webhook to attempt. The gap reads quiet (GY-1649), not unverified.
  const installation = recordedInstallation();
  installation.env.GITHUB_WEBHOOK_SECRET = 'a'.repeat(64);
  installation.github = {
    repository: 'cryptob1/graphyard-snake-v4',
    settingsUrl: 'https://github.com/settings/apps/graphyard-cryptob1-graphyard-snake-v4',
    scope: { installationId: 5228638, repositoryId: 987654321 },
    webhookDeliveries: { observedAt: RECORDED[0].at, attempts: [], coversFrom: null, error: null },
  };
  const loop = makeLoop();
  const candidates = [openCandidate('GY-A', RECORDED[0].pr), openCandidate('GY-B', RECORDED[1].pr), openCandidate('GY-C', RECORDED[2].pr), openCandidate('GY-D', AFTER_FILING.pr)];
  for (const [index, { at }] of [...RECORDED, AFTER_FILING].entries()) {
    installation.work = candidates.map((candidate, which) => which <= index ? candidate : closedCandidate(candidate));
    const cycle = loop.faultStep(installation, at);
    assert.equal(cycle.status.github, true);
    assert.equal(cycle.status.webhooks.configured, true);
    assert.equal(cycle.status.webhooks.state, 'quiet', 'the corroborated gap reads quiet: GitHub attempted nothing because it has no webhook to attempt');
    assert.equal(cycle.status.webhooks.deliveryLogAt, RECORDED[0].at);
    assert.deepEqual(cycle.observations, [], 'no attention item, so no fault');
  }
  assert.deepEqual(loop.state.faults.instances, [], 'no instance ever opens: the class cannot recur');
  assert.deepEqual(loop.state.faults.linked, {});

  // A delivery that does arrive is accepted — the endpoint verifies its signature and records the
  // receipt — and the account reads as delivering: still nothing raised. A wrong signature is
  // refused and records nothing: the account stays honest.
  const endpoint = await webhookEndpoint(installation);
  try {
    const accepted = await postDelivery(endpoint.url, { secret: 'a'.repeat(64), delivery: 'delivered-once' });
    assert.equal(accepted.status, 202);
    assert.equal(installation.receipts.length, 1);
    const delivering = loop.faultStep(installation, new Date(Date.parse(RECORDED[0].at) + 60_000).toISOString());
    assert.equal(delivering.status.webhooks.state, 'delivering');
    assert.equal(delivering.status.webhooks.lastDeliveryAt, installation.receipts[0].at);
    assert.deepEqual(delivering.observations, []);
    const forged = await postDelivery(endpoint.url, { secret: 'not-the-deployed-secret', delivery: 'forged' });
    assert.equal(forged.status, 401);
    assert.equal(forged.body.error, 'Invalid webhook signature');
    assert.equal(installation.receipts.length, 1, 'the forgery records nothing');
  } finally {
    endpoint.server.close();
  }

  // And the machinery stays honest the other way: an App whose webhook GitHub cannot reach leaves
  // failed attempts in the log, and the item that raises names them — a corroborated, actionable
  // fault, not the unverified silence the recorded instances carried.
  installation.github.webhookDeliveries = {
    observedAt: new Date(Date.parse(RECORDED[0].at) + 7_200_000).toISOString(),
    attempts: [{ at: new Date(Date.parse(RECORDED[0].at) + 6_600_000).toISOString(), statusCode: 0, event: 'pull_request', installationId: 5228638, repositoryId: 987654321 }],
    coversFrom: null, error: null,
  };
  installation.receipts = [];
  const failing = loop.faultStep(installation, new Date(Date.parse(RECORDED[0].at) + 7_200_000).toISOString());
  assert.equal(failing.status.webhooks.state, 'failing');
  assert.equal(failing.observations.length, 1);
  assert.match(failing.observations[0].text, /: GitHub attempted 1 delivery since .+ and 1 failed \(status 0; last attempt at .+\): polling is compensating/);
  assert.doesNotMatch(failing.observations[0].text, /could not be read/);
});

test('candidate condition, the product handling the case itself: a control plane reporting no GitHub App raises no observation fault for the silence it was installed to have', () => {
  // The model of the loop-code half (the GY-23/GY-24 precedent: the code lives in graphyard's
  // src/cli/github-budget-attention.ts and src/master-status.ts, which this repository does not
  // hold). The status route already gates the corroboration on the GitHub service existing; the
  // attention builder takes the same gate: a control plane that reports status.github false has no
  // webhook to be silent about — its silence is the designed polling-only state of the installer's
  // own merger:control-plane mode (the one doctor passes as "not required"), a configuration fact,
  // not a recurring observation fault.
  const webhookFaults = (status, now) => (status.github ? cycleFaults(status, now) : []);
  const installation = recordedInstallation();
  const loop = makeLoop();
  const step = (work, at) => {
    installation.work = work;
    const status = serveStatus(installation, Date.parse(at));
    const observations = webhookFaults(status, Date.parse(at));
    trackFaults(loop.state.faults, observations, at);
    return { status, observations };
  };
  const candidates = [openCandidate('GY-A', RECORDED[0].pr), openCandidate('GY-B', RECORDED[1].pr), openCandidate('GY-C', RECORDED[2].pr), openCandidate('GY-D', AFTER_FILING.pr)];
  for (const [index, { at }] of [...RECORDED, AFTER_FILING].entries()) {
    const cycle = step(candidates.map((candidate, which) => which <= index ? candidate : closedCandidate(candidate)), at);
    assert.equal(cycle.status.github, false);
    assert.equal(cycle.status.webhooks.state, 'unverified', 'the account is as unverified as ever — the change is that the loop no longer faults its own designed state');
    assert.deepEqual(cycle.observations, []);
  }
  assert.deepEqual(loop.state.faults.instances, [], 'no instance, no count, no threshold');
  assert.deepEqual(recurringClasses(loop.state.faults.instances, loop.state.work, Date.parse(AFTER_FILING.at)), [], 'nothing files');
});

// The live installation, audited only where it exists: on the coordinator host. CI checks out this
// repository on a GitHub runner, which has no access to that host's files or its control plane, so
// the audit skips there (the recorded-state reproductions above still run).
test(
  'live audit on the coordinator host: the status document still serves the recorded base state, or the App binding has landed',
  { skip: !existsSync(MASTER_CONFIG) && `not on the coordinator host: ${MASTER_CONFIG} is absent` },
  async () => {
    const master = JSON.parse(readFileSync(MASTER_CONFIG, 'utf8'));
    const token = readFileSync(master.credentialFile, 'utf8').trim();
    const response = await fetch(new URL('/api/status', master.url), { headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 200);
    const status = await response.json();
    assert.equal(status.repository, 'cryptob1/graphyard-snake-v4');
    if (status.github === false) {
      // The recorded base state stands: the deployment serves with no GitHub App, so the webhook
      // account is exactly what the recorded instants read. The remedy this item names for it is
      // the operator's App binding (`graphyard github-setup http://127.0.0.1:4310`, or
      // `graphyard app import` + `app bind SLUG`), which no agent identity may run: registering an
      // App happens in the operator's own GitHub session. While it stands, every instance of the
      // class — including the ones this item's own pull-request window raises — is this named,
      // operator-remediable condition, not a new mystery.
      assert.equal(status.webhooks.configured, false, 'GITHUB_WEBHOOK_SECRET is not set');
      assert.equal(status.webhooks.lastDeliveryAt, null, 'no delivery has ever been accepted');
      assert.equal('deliveryLogAt' in status.webhooks, false, 'the corroboration is absent: no GitHub service exists to read the log');
      assert.equal(status.webhooks.state, 'unverified');
      assert.equal(typeof status.webhooks.openPullRequests, 'number');
    } else {
      // The App binding has landed: the candidate condition, live. The account is corroborated —
      // it reads quiet, answered, delivering or failing, never the structural unverified silence
      // the recorded instances carried (a failing log read is a real finding and fails here).
      assert.equal(status.webhooks.configured, true);
      assert.ok('deliveryLogAt' in status.webhooks, 'the delivery log is read');
      assert.notEqual(status.webhooks.state, 'unverified');
    }
  }
);

// The loop's own fault record, audited where the daemon cursor exists: every instance of the class
// is linked to the item that stands for it — later instances link rather than re-file, as the
// fourth window's live row (2026-10-17T22:17:51.774Z, linkedTo GY-15) already showed.
test(
  'live audit on the coordinator host: the class\'s instances link to the standing item, and recurred after the filing',
  { skip: !existsSync(MASTER_CONFIG) && `not on the coordinator host: ${MASTER_CONFIG} is absent` },
  () => {
    const master = JSON.parse(readFileSync(MASTER_CONFIG, 'utf8'));
    const cursor = join(dirname(master.credentialFile), `${basename(master.credentialFile).replace(/\.token$/, '')}.daemon.json`);
    if (!existsSync(cursor)) return; // the cursor is recreated on restart; nothing retained to audit yet
    const daemon = JSON.parse(readFileSync(cursor, 'utf8'));
    const instances = (daemon.faults?.instances ?? []).filter(instance => instance.kind === 'github-budget');
    for (const instance of instances) {
      assert.ok(instance.linkedTo, `the ${instance.at} instance links to the item that stands for the class`);
      assert.equal(instance.faultClass, 'observation');
      assert.equal(instance.subject, 'github');
    }
    // The class recurred after the filing (the item's own text says the loop keeps counting it):
    // at least one instance first seen after the detected instant, linked to this item or its successor.
    const after = instances.filter(instance => Date.parse(instance.at) > Date.parse(ITEM_ORIGIN.detectedAt));
    assert.ok(after.length >= 1, 'the loop kept counting the class past the filing, linking instead of re-filing');
  }
);

// The App binding's precondition, audited where the server container runs: the deployment's own
// outbound HTTPS reaches GitHub, so binding the App is the one step between the standing state and
// the corroborated quiet the model shows — nothing about this host blocks it.
test(
  'live audit on the coordinator host: the control plane\'s own egress reaches GitHub, so the App binding has nothing waiting on this host',
  { skip: !existsSync(MASTER_CONFIG) && `not on the coordinator host: ${MASTER_CONFIG} is absent` },
  () => {
    const container = spawnSync('docker', ['ps', '--filter', `name=${SERVER_CONTAINER}`, '--format', '{{.Names}}'], { encoding: 'utf8' });
    if (container.status !== 0 || !container.stdout.trim()) return; // no docker or no container here: the egress audit has nothing to read
    const egress = spawnSync('docker', ['exec', SERVER_CONTAINER, 'node', '-e',
      "fetch('https://api.github.com/').then(r => { console.log(r.status); process.exit(0); }).catch(() => process.exit(1));"], { encoding: 'utf8', timeout: 30_000 });
    assert.equal(egress.status, 0, `the server container could not reach api.github.com: ${(egress.stderr || egress.stdout).trim()}`);
    assert.match(egress.stdout.trim(), /^\d{3}$/, 'GitHub answered with an HTTP status (403 anonymous is the expected answer)');
  }
);

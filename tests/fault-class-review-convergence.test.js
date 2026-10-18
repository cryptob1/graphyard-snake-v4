// GY-28 — post-merge review verdicts that settle CHANGES_REQUESTED on delivered work never converged:
// the loop marked the debt paid (`postMergeReview=reviewed`) and then had no step that ever read the
// verdict again. The recorded run (the Graphyard installation serving this repository, board read
// 2026-10-17T23:58:52Z) left three delivered items holding blocking findings with nothing requested,
// scheduled or linked, each past the 10-minute decision bound with no bound at all watching the gap:
//
//   GY-17  review 5066  review-claude-a    submitted 2026-10-17T22:45:39.253Z  2 BLOCKING  untouched 73.2 min
//   GY-23  review 5052  review-opencode-b  submitted 2026-10-17T22:43:12.097Z  1 BLOCKING  untouched 75.7 min
//   GY-24  review 5059  review-claude-a    submitted 2026-10-17T22:44:11.533Z  2 BLOCKING  untouched 74.7 min
//
// (The same run recorded a fourth: GY-15 review 5266 at 23:40:17.042Z, 1 BLOCKING, 18.6 min at the
// board read — same shape, shorter gap; it is reproduced and converged here too.)
//
// Every route the findings could take was closed, and the one route that was open had no trigger:
//
//   · The rework arm is refused by the control plane on a delivered item — model/approval.ts
//     decisionPrecondition returns "Delivered work is immutable; create a follow-up task" (the
//     operator agent's recorded refusals of `master decide GY-17|GY-23|GY-24 rework …` at
//     2026-10-18T00:37Z, one per instance).
//   · The follow-up arm exists — auto-dispatch.ts filePostMergeFollowUps files one item per BLOCKING
//     line of a post-merge verdict (GY-1525 AC-4) — but the dispatch tick runs it only over the
//     review ledger's records (auto-dispatch.ts: `for (const record of reviews) if (!record.postMerge
//     || !record.verdict …) continue;`), and the verdict body the filing reads lives on the work item
//     (`work.reviewLaunch.verdict`), not on the record: once the record leaves the ledger the filing
//     has no trigger at all. The live ledger held none of the four verdict records at the
//     2026-10-18T00:5x reads while the items still carried their verdicts.
//   · A filing that fails settles only on that same ledger record (`settlePostMerge` writes
//     `record.postMergeFollowUps.failure`; nothing else is written) — never as an action row the
//     loop retries, so the failure dies with the record and leaves no trace (no follow-up items
//     exist, and the project memory holds no `post-merge-review:GY-…` entry the filing's
//     recordFindings half would have written: the filing never completed).
//   · And nothing watches the gap: the 10-minute decision bound (daemon/decisions.ts
//     approverJudgeBoundMs) starts only when a decision is requested, and the decision attention
//     (master status owed-report) reads the item's requested decisions — a delivered item with an
//     empty decision ledger owes none; the review-convergence invariant the catalogue holds
//     (invariants.ts follow-ups-per-parent) counts open follow-up items per parent — too many — and
//     never a missing one. The class surfaced only when a doctor run read the board 73 minutes late
//     and filed this item by hand (ledger event 5290).
//
// What changed (the candidate condition, delivered with this test): the convergence step reads the
// item's own standing verdict — durable, never reaped — and, within one cycle of a CHANGES_REQUESTED
// verdict on delivered work, files the follow-up items the control plane's own refusal names
// (`postMergeFollowUp`, one per BLOCKING line, planned on the finding's file, linked through
// `origin.reviewFollowUps.parent`), releasing each as the loop's filing does. A step that cannot land
// is an action row of the review-convergence class (kind `action:review`, fault-classes.ts), retried
// under the sessions.ts backoff, surviving the ledger; and a verdict still unconverged past
// approverJudgeBoundMs raises the class's fault row — the bound now watches the gap. The models below
// reproduce each recorded instance against the base and converge it against the candidate; the final
// tests audit the live installation on the coordinator host (CI has no access to it and skips).
//
// The live half of the remedy was delivered with the loop's own filing identity, as GY-17's scratch
// repair was: six follow-up items (GY-31 and GY-32 for GY-17's review 5066, GY-33 for GY-23's 5052,
// GY-34 and GY-35 for GY-24's 5059, GY-36 for GY-15's 5266) were created under the operator-agent
// credential — the identity auto-dispatch.ts createWork posts as — from the coordinator checkout,
// whose base tree reads current main (the route the frozen loop scratch could not take), and released
// with the loop's own reason; one accidental duplicate (GY-30) was closed as a duplicate of GY-31.
// The filer plans the finding's paths that the base tree holds: the source's parseFinding also picks
// property-shaped tokens (`candidate.pr`, `status.github`) out of a finding's prose, and a create
// whose plannedFiles name them refuses — the model keeps the parse faithful and the filing honest.
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and carries its own
// fixtures: the four verdict bodies exactly as the control plane recorded them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/** The board read the item's description names: the instant the three recorded gaps were measured. */
const BOARD_READ = Date.parse('2026-10-17T23:58:52Z');
/** The dispatch tick's interval on the recorded installation (master.json run.dispatchIntervalSeconds). */
const TICK_MS = 10_000;
/** The 10-minute decision bound (graphyard src/daemon/decisions.ts approverJudgeBoundMs): how long a requested decision may stand unjudged. */
const approverJudgeBoundMs = 600_000;
/** The rework arm's refusal on a delivered item (graphyard src/model/approval.ts decisionPrecondition), the sentence the operator agent's recorded `master decide … rework` calls received. */
const DELIVERED_IMMUTABLE = 'Delivered work is immutable; create a follow-up task';

/** The four recorded verdicts, as the control plane holds them on each item's `reviewLaunch.verdict`. */
const RECORDED = [
  {
    key: 'GY-17', reviewId: 5066, reviewer: 'review-claude-a', submittedAt: '2026-10-17T22:45:39.253Z',
    mergedAt: '2026-10-17T22:20:59.182Z', mergeSha: '56ee69722bbda0137a68752e6eaab8768124726c',
    title: 'Diagnostician cannot file fix items: master create rejects plannedFiles because the loop scratch worktree cannot read origin/main or main',
    blocking: 2,
    body: "Post-merge review of GY-17 at 56ee69722bbda0137a68752e6eaab8768124726c against 1b1a465ee6150a72887ab28ac95f7fd7e8958c3a.\n\nThe change adds one file, tests/fault-class-loop.test.js. It builds the recorded installation with real git: a foreign-commit release, a scratch session directory whose `checkout/` gitfile dangles after pruning, and a remote-tracking main ahead of the local one. It reproduces the baseTree refusal word for word at the scratch root, models the diagnosis filing, readyToRetry and noteActionOutcome, applies the remedy (the scratch directory becomes its own repository with origin set to the repo remote, origin/main seeded from the coordinator, then main and the working tree reset onto it), and shows each filing landing afterwards. A live audit checks the scratch on the coordinator host. The change touches none of the per-cycle paths (src/daemon/, src/master/, merge-queue, github, review-threads), so the soak rule does not apply. The reproduction itself is careful.\n\nI checked the live scratch read-only (rev-parse, ls-remote, reflog). The operational remedy, which is half of this item, does not keep the scratch reading the base tree:\n- Scratch refs/remotes/origin/main = refs/heads/main = 1b1a465. The coordinator's origin/main is e03e6ba, three merges ahead (it adds src/model/work.ts, tests/candidate-pr-resync.test.js, tests/fault-class-loop.test.js and tests/fault-class-resources.test.js).\n- The scratch's origin is git@github.com:cryptob1/graphyard-snake-v4.git, and this host cannot reach it: `git ls-remote origin` fails with \"Bad owner or permissions on /etc/ssh/ssh_config.d/20-omarchy-keepalive.conf / fatal: Could not read from remote repository.\" The scratch's FETCH_HEAD was written empty at 15:37, after the repair. Its origin/main reflog shows only the two seeding fetches from /home/vish/code/graphyard-snake-v4 and no fetch from origin.\n- baseTree's best-effort fetch therefore fails silently every cycle, and the scratch resolves plannedFiles against a frozen tree. A diagnostician fix item that plans any file added to main after 1b1a465 refuses with \"plannedFiles cannot be resolved: \u2026 is not in the base tree origin/main\". That is exactly the class this item exists to remove.\n\nAcceptance criteria:\n[AC-1] Unmet. origin/main and main resolve in the scratch, but they point at a stale tree that never refreshes. The remedy claims that \"every later git fetch origin main re-reads the remote\", and on this host that is false. A master create whose plannedFiles name current-main files would refuse. Nothing in the change or its live audit shows a master create succeeding end to end from the loop's own process.\n[AC-2] Met. All three recorded instances (18:21:10.905Z GY-11, 18:58:13.938Z GY-14, 19:09:15.251Z GY-15) are reproduced against the recorded base with the exact refusal sentence, and the test shows they do not recur against the candidate condition.\n[AC-3] Met, as a model. The tests show a failed fix-item filing stored as a failed, retried action with one visible fault row per run, linked to the standing proof item GY-4, and a filing that lands on the first retry once the scratch reads main. This follows the GY-23/GY-24 precedent of modelling Graphyard loop code that this repository does not hold.\n[DOCS] Met. The change is test-only and alters no documented behaviour, command, configuration or API of this repository, so the worker's statement is true.\n\nBLOCKING: tests/fault-class-loop.test.js:115 \u2014 [AC-1] The remedy this docstring describes and the test models leaves the live scratch's origin pointing at an SSH remote that this host cannot fetch (ssh_config.d permission error). Its origin/main is frozen at 1b1a465, three merges behind the coordinator's e03e6ba, so plannedFiles naming files added since then refuse. Make the scratch's base read refresh from a source the loop can actually read (for example, origin pointed at, or fetched from, the coordinator checkout that the merge writer keeps current). Bring the live scratch to current main, and make the model's remote match the live one so the test exercises the real refresh path.\nBLOCKING: tests/fault-class-loop.test.js:433 \u2014 [AC-1] The live audit asserts origin/main == main and that origin/main is an ancestor of the coordinator's origin/main. A scratch frozen at any old commit passes, which it does today at 1b1a465 vs e03e6ba. A scratch whose fetch works would fail it as soon as origin/main moves past the local main that was seeded once. The audit should assert that the scratch's base read, after its fetch, resolves the coordinator's current origin/main tip (and drop the origin == local equality), so it detects exactly this staleness.\n\nNit: tests/fault-class-loop.test.js:54 \u2014 COORDINATOR_CHECKOUT and SCRATCH_ROOT are hard-coded absolute host paths. This is the same nit as GY-11, GY-23 and GY-24.\n\nResolved threads: none\nFollow-up threads: none\nOverridden threads: none",
  },
  {
    key: 'GY-23', reviewId: 5052, reviewer: 'review-opencode-b', submittedAt: '2026-10-17T22:43:12.097Z',
    mergedAt: '2026-10-17T22:32:54.616Z', mergeSha: 'b8789bca44ddb63a1e2e496e8b71c06f261d914e',
    title: 'Recurring resources faults: 3 in 24 hours',
    blocking: 1,
    body: "Post-merge review of GY-23 at b8789bca44ddb63a1e2e496e8b71c06f261d914e against 56ee69722bbda0137a68752e6eaab8768124726c.\n\nThe change adds one file, tests/fault-class-resources.test.js. It models the loop's /tmp reclaim decision path: testTempPatterns, testTempMinAgeMs = 2 h, lastWritten, makeOwnerWritable (GY-1828, which touches only directories this uid owns), removeTree's retry/EACCES handling, and the `Tmp reclaim: ` / `Resource reclaim: N could not be reclaimed:` report shape. I checked these against src/tmp-reclaim.ts and src/master-resources.ts of the running Graphyard, and they match. The test rebuilds the recorded base tree (the user's 1700 gy- root holding a uid-65534 0755 interior). It reproduces all three recorded instances character for character, including how they recur through the `unfinished` set. It then shows no fault against two candidates: the interior removed with the privilege that created it (the live remedy), and the creating run tearing the tree down itself. Two live audits guard the host. The change touches none of the per-cycle paths (src/daemon/, src/master/, merge-queue, github, review-threads), so it needs no soak coverage.\n\nAcceptance criteria:\n[AC-1] Met. Each of the three recorded instances (21:09:45.419Z, 21:10:06.728Z, 21:10:27.812Z) is reproduced against the recorded base and shown not to recur against the candidate, by tests this change adds. The shared cause is identified: a foreign-uid interior inside an ownerless test-temp root that the pass can never remove. It was removed live, and the live audit fails if the cause comes back. This follows the GY-3/GY-11 precedent.\n[DOCS] Met. The change is test-only and alters no documented behaviour, command, configuration or API of this repository, so the worker's statement is true.\n\nFinding:\nBLOCKING: tests/fault-class-resources.test.js:504 \u2014 the live audits call `readdirSync` without a guard. That covers `treeEntries` here and the age check at line 547. They walk exactly the entries the running loop's reclaim pass deletes every ~21 s on this host: this user's entries with test-temp names, past the 2 h bound. An entry removed between the root listing and its walk throws ENOENT and fails the audit spuriously. A foreign 0700 directory throws EACCES and aborts the audit instead of naming the offender. The test already guards `statSync` for this race at line 507, and the source it models guards `readdir` with `.catch(() => [])` (src/tmp-reclaim.ts lastWritten/makeOwnerWritable). The fix is to wrap both readdirSync calls the same way, and to record an EACCES directory as an offender. This is a reliability defect in a suite that every worker runs on the coordinator host, and the fix is cheap.\n\nNit: tests/fault-class-resources.test.js:123 \u2014 COORDINATOR_ROOT is a hard-coded absolute host path, the same as the GY-11 nit. Deriving it from an env var or master.json would keep the audit portable.\nNit: tests/fault-class-resources.test.js:517 \u2014 the skip condition runs the first audit on any host that happens to have /tmp/gy-tY0unUD, even when that host is not the coordinator. This is harmless but inconsistent with the second audit's guard.\n\nResolved threads: none\nFollow-up threads: none\nOverridden threads: none",
  },
  {
    key: 'GY-24', reviewId: 5059, reviewer: 'review-claude-a', submittedAt: '2026-10-17T22:44:11.533Z',
    mergedAt: '2026-10-17T22:38:16.168Z', mergeSha: 'e03e6ba2b6d1dda2e1ba86a3048f91ae06f7c4a9',
    title: "GY-1's candidate.pr=1 is stale: the candidate heads open PR #4, and no resync runs to correct it",
    blocking: 2,
    body: "Post-merge review of GY-24 at e03e6ba2b6d1dda2e1ba86a3048f91ae06f7c4a9 against b8789bca44ddb63a1e2e496e8b71c06f261d914e.\n\nThe change adds two files. src/model/work.ts is a pure model: `verifiedCandidate`, which picks the open, unmerged PR headed by the candidate sha against the managed base and narrows by branch when several match; `readCandidateForDecision`; the unverified rework-reason reproduction; the resync permission gate; and a `runCycles` loop model. tests/candidate-pr-resync.test.js reproduces decision f9162d74's reason exactly and shows that the modelled verified read would yield PR #4. The model itself is careful. It never adopts a closed PR, refuses a match against a foreign base, and refuses ambiguity instead of guessing. It does not touch any of the per-cycle paths (src/daemon/, src/master/, merge-queue, github, review-threads), so the soak rule does not apply.\n\nThe criteria are about outcomes, though, and neither one happens at this head.\n\n[AC-1] Unmet. The criterion requires that GY-1's candidate.pr equals 4. The test's own fixture is the record \"read live 2026-10-17T22:26Z\", and it still reads `pr: 1`. Nothing in the diff corrects that record. No live remediation is recorded either, unlike the GY-3/GY-11/GY-23 precedent, where the cause was removed live and a live audit fails if it comes back. The live audit here accepts `live.candidate.pr === 1` as passing (line 658). It verifies against the hard-coded PR1/PR4 fixtures instead of the provider's current PR readings. So it passes while the record is stale, and it cannot detect AC-1 failing.\n\n[AC-2] Unmet. The criterion requires that the pointer is \"corrected by read-time verification or a resync that runs without live executors, so no decision reason again cites a closed PR for an open candidate\". The read-time verification has no consumer. git grep at this head finds no reference to src/model/work.ts outside its own test. The Graphyard decision path that composed f9162d74 (the provider reader and the rework reasoning over `candidate.pr`) does not read through it. So the next decision built on GY-1's pointer would be built exactly as before. `readCandidateForDecision` also hard-codes `rework: null`, so its claim that \"no reason is built from a non-candidate PR\" holds only by construction. `runCycles` marks the resync row `by: 'read'` as completed, but that is a modelled assertion, not a resync that ran.\n\n[DOCS] Met. The worker said the diff adds an internal model and its test and changes no documented behaviour, command or configuration of this repository, and that is true.\n\nBLOCKING: tests/candidate-pr-resync.test.js:658 \u2014 AC-1 unmet. GY-1's live record still reads candidate.pr = 1, and the live audit accepts that as a pass. It also verifies against fixed PR1/PR4 fixtures, not live provider readings. The fix: correct GY-1's record through a path the control plane provides, e.g. a coordinator-credentialed resync or record correction. Then make the audit assert live.candidate.pr === 4 against PR readings fetched live.\nBLOCKING: src/model/work.ts:199 \u2014 AC-2 unmet. Nothing reads through readCandidateForDecision or verifiedCandidate. Neither this repository nor the control plane's decision or rework path calls it, so decision reasons are still composed from the unverified stored pointer, and the \"no decision again cites a closed PR\" outcome is not delivered. Either wire the verification into the consumer that builds decision reasons, or deliver the live correction plus a live guard that fails if a decision reason cites a closed PR for an open candidate.\n\nNit: tests/candidate-pr-resync.test.js:634 \u2014 COORDINATOR_CHECKOUT is a hard-coded absolute host path. This is the same nit as GY-11 and GY-23.\nNit: src/model/work.ts:206 \u2014 readCandidateForDecision always returns rework: null, even for a candidate that genuinely has no open PR. A real rework premise would be dropped silently rather than built from the verified standing.\n\nResolved threads: none\nFollow-up threads: none\nOverridden threads: none",
  },
  {
    key: 'GY-15', reviewId: 5266, reviewer: 'review-claude-a', submittedAt: '2026-10-17T23:40:17.042Z',
    mergedAt: '2026-10-17T23:39:27.106Z', mergeSha: 'e36c3938903294b33bbfbfd5035daedf5339b33d',
    title: 'Recurring observation faults: 3 in 24 hours',
    blocking: 1,
    body: "Post-merge review of GY-15 at e36c3938903294b33bbfbfd5035daedf5339b33d against e03e6ba2b6d1dda2e1ba86a3048f91ae06f7c4a9.\n\nThe change adds one file, tests/fault-class-observation.test.js (787 lines, plain node --test, builtins only). It touches nothing under src/daemon/, src/master/, merge-queue, github or review-threads, so the soak rule does not apply.\n\nThe diagnosis is good. The file reproduces the three recorded instances (18:07:31.447Z PR #2, 18:24:38.534Z PR #5, 18:57:05.744Z PR #9) and the fourth, linked one (22:17:51.774Z PR #14) word for word against the recorded base. That base is a Compose deployment installed with --no-github-app: status.github is false, the corroboration is absent, the webhook route refuses with 503 \"Webhook not configured\" (checked against a real HTTP server), and the state stays 'unverified' with no way out. It rebuilds the filing of GY-15 field for field, and it shows that setting GITHUB_WEBHOOK_SECRET alone does not fix anything. The shared cause is correctly found.\n\nThe cause is not removed at the candidate:\n- The head changes nothing that the loop or the deployment runs. The first half of the \"candidate condition\" is an operator action, the App binding (`graphyard github-setup \u2026` / `app import` + `app bind`). The change names that action but does not perform it, and it files no blocker for it. The test models it by putting a hand-built App-bound `installation.github` object into its own fixture.\n- The second half is \"the product handling the case itself\". It exists only as a one-line wrapper defined inside the test (line 691: `status.github ? cycleFaults(status, now) : []`). This does not reproduce any code: no graphyard change exists, is cited, or is filed for it. The test defines its own fix and then asserts that the fix suppresses the fault, which is circular. That differs from the GY-23/GY-24 precedent, which models existing loop code at the base, not a fix that does not exist.\n- The file's own live audits confirm that the base state still stands and that the class keeps recurring. Line 725 accepts `status.github === false`, which is the unchanged base, as a pass. Line 769 asserts that at least one instance has recurred since the filing. On the coordinator host, the next open-pull-request window will raise the same sentence again.\n\nAcceptance criteria:\n[AC-1] Unmet. The cause is found, and each instance is reproduced against the base. The criterion also says the cause must be \"removed at the candidate\" and the instances \"shown not to recur against the candidate\". At this head the cause stands: no App is bound, the attention builder is unchanged, and the class still recurs, which the live audit itself asserts. Non-recurrence is shown only against a hypothetical state that the test builds for itself. To meet the criterion, a real removal is needed. Either the App binding is in place and the live audit requires `status.github === true` with a corroborated state, or a real product change gates the webhook-silence attention on the GitHub service and the test exercises that change. If the binding needs the operator's own GitHub session, record that as a Graphyard blocker. Do not let an audit that accepts the base state count as removal.\n[DOCS] Met. The change is test-only and alters no documented behaviour, command, configuration or API, so the worker's statement is true. The noted failure of the GY-3 live audit on the coordinator host is outside this diff.\n\nBLOCKING: tests/fault-class-observation.test.js:725 \u2014 AC-1 unmet: the live audit accepts the unchanged base state (status.github false, webhooks 'unverified') as a pass, and the candidate condition at line 691 is a suppression wrapper defined inside the test, not a removal at the candidate. Remove the cause for real: bind the App, or land the product gate and exercise it. If the binding needs the operator, record a blocker. Then make the live audit fail while the recorded base state stands.\n\nNit: tests/fault-class-observation.test.js:613 \u2014 the assertion message says \"the App, not the secret, is the missing half\". The 403 really comes from the test's own managed-repository guard when `installation.github` is null, so the message overstates what was demonstrated.\nNit: tests/fault-class-observation.test.js:757 \u2014 the cursor audit returns silently when the daemon cursor is absent. A skip with a reason would make that visible.\n\nResolved threads: none\nFollow-up threads: none\nOverridden threads: none",
  },
];

// ---------------------------------------------------------------------------
// Models of the graphyard source this fault turns on, each cited where it is ported.
// ---------------------------------------------------------------------------

/**
 * blockingFindings (graphyard src/review-cap.ts): the `BLOCKING:` line rule, its Markdown unwrap and
 * its none-guard, verbatim — one finding per line, each cut at 300 characters, at most ten.
 */
const blockingLine = /^\s*(?:-\s*|\*\s+)?(\**)BLOCKING(\**)(?:\s*finding(\**))?\s*[:\-–—](\**)\s*(.+?)\s*$/i;
const noneNamed = /^(none|n\/a|no blocking findings?)\.?$/i;
function unwrapFinding([, opened = '', closedLabel = '', closedFinding = '', afterColon = '', text = '']) {
  const open = Math.abs(opened.length - closedLabel.length - closedFinding.length - afterColon.length);
  let finding = open && text.endsWith('*'.repeat(open)) ? text.slice(0, -open).trimEnd() : text;
  const wrapper = /^[*_]+/.exec(finding)?.[0];
  const inner = wrapper && finding.length > 2 * wrapper.length && finding.endsWith([...wrapper].reverse().join('')) ? finding.slice(wrapper.length, -wrapper.length) : null;
  if (inner !== null && !inner.includes(wrapper) && (!wrapper.includes('_') || /\s/.test(inner.trim()))) finding = inner;
  return finding.trim();
}
export function blockingFindings(body) {
  if (typeof body !== 'string') return [];
  return body
    .split('\n')
    .map(line => { const match = blockingLine.exec(line); return match ? unwrapFinding(match) : ''; })
    .filter(text => text && !noneNamed.test(text))
    .map(text => text.slice(0, 300))
    .slice(0, 10);
}

/**
 * parseFinding / findingFile (graphyard src/model/post-merge-review.ts), verbatim rules: a token with
 * an extension, one followed by a line, or a well-known extensionless file, each with every file it
 * names in order. The camelCase guard the source notes (`work.postMergeReview` is a property) is the
 * extension shape itself: `candidate.pr` and `status.github` parse as paths exactly as the source
 * does — the model keeps that, and the filer below plans only the paths the base tree holds.
 */
const extensionlessFiles = new Set(['Dockerfile', 'Containerfile', 'Makefile', 'GNUmakefile', 'Procfile', 'Gemfile', 'Rakefile', 'Jenkinsfile', 'Vagrantfile', 'Brewfile', 'Justfile', 'LICENSE', 'CODEOWNERS', 'VERSION']);
const notFiles = new Set(['e.g', 'i.e', 'etc', 'vs']);
function findingFile(token) {
  const match = /^([A-Za-z0-9_./@+-]+?)(?::(\d+)(?:[-–]\d+)?)?$/.exec(token);
  if (!match || token.includes('://')) return null;
  const path = match[1].replace(/[.,;]+$/, ''), line = match[2] ? Number(match[2]) : null;
  if (!path || notFiles.has(path.toLowerCase()) || /^AC-\d+$/i.test(path) || /^\.+$/.test(path) || /^[\d.]+$/.test(path)) return null;
  const named = /\.(?:[a-z][a-z0-9]*|[A-Z][A-Z0-9]*)$/.test(path) || extensionlessFiles.has(path.split('/').pop()) || (line !== null && /[A-Za-z]/.test(path));
  return named ? { path: path.replace(/^\.\//, ''), line } : null;
}
export function parseFinding(text) {
  const trimmed = text.trim();
  const files = trimmed.split(/[\s`'"()[\]{},]+/).flatMap(token => findingFile(token.replace(/[.;:—–]+$/, '')) ?? []);
  const paths = [...new Set(files.map(file => file.path))];
  return files[0] ? { text: trimmed, ...files[0], paths } : { text: trimmed, path: null, line: null, paths };
}

/**
 * postMergeFollowUp (graphyard src/model/post-merge-review.ts), verbatim composition: a bug at
 * priority 1 whose origin names the delivered item and its merge commit, planned on every file the
 * finding names, reviewed like any item. The delivered item itself is never reopened.
 */
export function postMergeFollowUp(delivered, mergeSha, finding, index) {
  const others = finding.paths.filter(path => path !== finding.path);
  const where = finding.path ? ` in ${finding.path}${finding.line ? `:${finding.line}` : ''}${others.length ? ` (also ${others.join(', ')})` : ''}` : '';
  return {
    title: `Post-merge review of ${delivered.key} (${mergeSha.slice(0, 12)}): ${finding.text.slice(0, 120)}`.slice(0, 200),
    description: `The post-merge review of ${delivered.key} ("${delivered.title}"), delivered as merge commit ${mergeSha}, found this BLOCKING${where}:\n\n${finding.text}\n\nFix it on its own head; the delivered item is not reopened.`,
    type: 'bug', priority: 1,
    criteria: [{ id: 'AC-1', text: `The finding is fixed: ${finding.text.slice(0, 1500)}`, proofs: [`unit:post-merge-follow-up-${index + 1}`] }],
    policy: delivered.policy ?? { checks: ['test', 'typecheck'], review: true },
    plannedFiles: finding.paths,
    origin: { reviewFollowUps: { parent: delivered.key, findings: [{ path: finding.path, text: finding.text.slice(0, 2000), ref: mergeSha }] } },
  };
}

/**
 * decisionPrecondition (graphyard src/model/approval.ts), the arm the recorded refusals exercised: a
 * decision on work whose stage is `done` is refused with the sentence the control plane itself
 * directs to the follow-up route.
 */
export function decisionPrecondition(work) {
  if (work.stage === 'done') return DELIVERED_IMMUTABLE;
  return null;
}

/**
 * The verdict's effect on the item (graphyard src/server/review-verdict.ts recordReviewVerdict): a
 * post-merge launch's verdict marks the delivered item `reviewed` — and nothing else. The item stays
 * `done`, no rework is requested, no decision is recorded and nextAction stays null: the review debt
 * is marked paid the moment the verdict lands, whatever the verdict says.
 */
export function recordVerdict(item, verdict) {
  return { ...item, postMergeReview: 'reviewed', reviewLaunch: { ...item.reviewLaunch, verdict } };
}

/**
 * The review ledger's lifecycle (graphyard src/reviewer.ts): a terminal record is pinned while an
 * open request or a pending head still reads it (pinnedSessionRecords); releaseClosedRequests marks
 * the records whose item is delivered — always, for a post-merge verdict's record — so the next
 * release unpins them; and every save keeps only the newest `retention` of the other terminal
 * records (boundSessionLedger) — the ledger is a bounded working set, not an archive, and no writer
 * is required to keep a verdict record alive.
 */
export const sessionLedgerBound = 200, sessionLedgerRetention = 50;
const terminalSessionStates = ['completed', 'failed', 'cancelled', 'expired'];
const liveRecord = record => !terminalSessionStates.includes(record.state);
export function pinnedSessionRecords(records) {
  const pendingHeads = new Set(records.filter(liveRecord).map(record => `${record.key}@${record.sha}`));
  return new Set(records.filter(record => !liveRecord(record)
    && (!!record.requestId && !record.requestClosedAt || !!record.verdict && (!record.headReleasedAt || pendingHeads.has(`${record.key}@${record.sha}`)))));
}
export function releaseClosedRequests(records, now) {
  for (const record of records) {
    if (liveRecord(record)) continue;
    // A delivered item holds no open request and no undelivered candidate: both releases apply.
    if (record.requestId && !record.requestClosedAt) record.requestClosedAt = now;
    if (record.verdict && !record.headReleasedAt) record.headReleasedAt = now;
  }
}
export function boundSessionLedger(records) {
  const running = records.filter(liveRecord).length, pinned = pinnedSessionRecords(records);
  const settledAt = record => Date.parse(record.closedAt ?? record.requestedAt) || 0;
  const terminal = records.map((record, index) => ({ record, index })).filter(entry => !liveRecord(entry.record) && !pinned.has(entry.record))
    .sort((a, b) => settledAt(b.record) - settledAt(a.record) || b.index - a.index);
  const kept = new Set(terminal.slice(0, Math.max(0, Math.min(sessionLedgerRetention, sessionLedgerBound - running - pinned.size))).map(entry => entry.record));
  return records.filter(record => liveRecord(record) || pinned.has(record) || kept.has(record));
}

/**
 * readyToRetry (graphyard src/daemon/sessions.ts), verbatim: a waiting action is asked again every
 * cycle; a failed one is retried under exponential backoff, capped at 30 cycles.
 */
export function readyToRetry(previous, cycle, maxBackoffCycles = 30) {
  if (!previous) return true;
  if (previous.state === 'waiting') return true;
  if (previous.state !== 'failed') return false;
  return cycle - previous.cycle >= Math.min(2 ** Math.max(0, previous.attempts - 1), maxBackoffCycles);
}

/**
 * The decision attention the base watches (graphyard src/cli/owed-report.ts owedAttention over the
 * item's requested decisions, and src/daemon/decisions.ts approverJudgeBoundMs bounding each): a
 * decision bound exists only while a decision stands requested and unjudged. A delivered item whose
 * decision ledger is empty owes none — the bound never starts, which is why 73–75 minutes passed
 * with nothing watching.
 */
export function decisionBound(item, now) {
  const owed = (item.decisions ?? []).filter(decision => !decision.judgedAt);
  if (!owed.length) return null;
  const oldest = Math.min(...owed.map(decision => Date.parse(decision.requestedAt)));
  return now - oldest > approverJudgeBoundMs ? { kind: 'owed-decision', subject: item.key } : null;
}

/**
 * The review-convergence invariant the base holds (graphyard src/model/invariants.ts
 * follow-ups-per-parent, class review-convergence): it counts OPEN follow-up items per parent — a
 * parent with too many — and never a parent with none. A verdict whose findings were never filed is
 * invisible to it in both directions.
 */
export function followUpsPerParent(work, threshold = 1) {
  const open = new Map();
  for (const item of work) {
    const parent = item.origin?.reviewFollowUps?.parent;
    if (parent && item.stage !== 'done') open.set(parent, (open.get(parent) ?? 0) + 1);
  }
  return [...open].filter(([, count]) => count > threshold).map(([parent]) => parent);
}

/**
 * filePostMergeFollowUps (graphyard src/auto-dispatch.ts), the filing the tick runs per ledger
 * record: one follow-up item per BLOCKING line, keyed so a retry replays, every other finding to
 * project memory. A filing that fails is returned as `failure` — for the caller to settle on the
 * record, which is the base's only carrier for it.
 */
export async function filePostMergeFollowUps(work, record, effects, now) {
  if (!record.postMerge || !record.verdict) return null;
  const launch = work.reviewLaunch && (record.launch ? work.reviewLaunch.id === record.launch : work.reviewLaunch.head === record.sha) ? work.reviewLaunch : null;
  const body = launch?.verdict?.sha === record.sha ? launch.verdict.body : null;
  if (body === null) return null;
  const filed = [...(record.postMergeFollowUps?.filed ?? [])];
  const lines = body.split('\n').flatMap(line => blockingFindings(line));
  let through = record.postMergeFollowUps?.through ?? 0;
  let failure;
  for (const [index, text] of lines.entries()) {
    const finding = text.slice(0, 300);
    if (index < through || filed.some(entry => entry.index === index || (entry.index === undefined && entry.finding === finding))) continue;
    if (!effects.createWork) { failure = 'no follow-up filer is wired; the finding stands on the verdict'; break; }
    try {
      const created = await effects.createWork(postMergeFollowUp(work, record.sha, parseFinding(text), index), `post-merge-follow-up:${work.key}:${record.sha}:${index}`);
      filed.push({ key: created.key, finding, index });
      if (index === through) through = index + 1;
    } catch (error) { failure = `filing the follow-up for "${finding.slice(0, 80)}" failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`.slice(0, 500); break; }
  }
  let memory = record.postMergeFollowUps?.memory;
  if (memory === undefined) {
    const rest = body.split('\n').filter(line => !/^\s*(?:[-*]\s*)?\**BLOCKING\**\s*:/i.test(line)).join('\n');
    const nits = rest.split(/\n\s*\n|\n(?=\s*(?:[-*]|\d+\.)\s)/).map(block => block.trim()).filter(Boolean).length;
    if (nits && effects.recordFindings) {
      try { await effects.recordFindings(work, record, nits); memory = nits; }
      catch (error) { failure = failure ? `${failure}; recording non-blocking findings failed`.slice(0, 500) : `recording non-blocking findings in project memory failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`.slice(0, 500); }
    } else memory = nits;
  }
  const pending = lines.filter((_, index) => index >= through && !filed.some(entry => entry.index === index)).length;
  return { at: now, filed: filed.slice(-10), through, ...(pending > 0 ? { pending } : {}), ...(memory !== undefined ? { memory } : {}), ...(failure ? { failure } : {}) };
}

/** One work item of the recorded shape: delivered, its verdict standing on `reviewLaunch.verdict`. */
const deliveredItem = recorded => ({
  key: recorded.key, title: recorded.title, stage: 'done', reworkRequested: false, decisions: [], nextAction: null,
  policy: { checks: ['test', 'typecheck'], review: true },
  delivery: { mergeSha: recorded.mergeSha, mergedAt: recorded.mergedAt },
  reviewLaunch: { postMerge: true, head: recorded.mergeSha, verdict: null },
  origin: { faultClass: { class: 'review-convergence' } },
});
/** The ledger record a post-merge review session leaves (graphyard src/reviewer.ts ReviewRecord, the fields the filing reads). */
const verdictRecord = (recorded, id) => ({
  id, key: recorded.key, sha: recorded.mergeSha, requestId: `post-merge:${recorded.key}:${recorded.mergeSha.slice(0, 12)}`,
  state: 'pending', postMerge: true, mode: 'control-plane', requestedAt: recorded.mergedAt,
});

/**
 * The base dispatch tick (graphyard src/auto-dispatch.ts dispatchTick, the post-merge step): the
 * filing runs only over the ledger's records — reconcile settles the verdict's record, then the loop
 * files what the record's item still holds — and a failure settles only on the record. There is no
 * other reader of the item's standing verdict: with the record gone, nothing converges, nothing
 * retries and nothing reports.
 */
export async function baseTick(state, effects, now) {
  const actions = [];
  // reconcile reviews: the pending control-plane record settles completed the moment the item holds the verdict.
  for (const record of state.ledger) {
    if (record.state !== 'pending') continue;
    const item = state.work.find(work => work.key === record.key);
    if (item?.reviewLaunch?.verdict?.sha === record.sha) { record.verdict = { state: item.reviewLaunch.verdict.state, reviewer: item.reviewLaunch.verdict.reviewer, reviewId: item.reviewLaunch.verdict.reviewId, submittedAt: item.reviewLaunch.verdict.submittedAt }; record.state = 'completed'; record.closedAt = now; }
  }
  releaseClosedRequests(state.ledger, now);
  // the filing loop, verbatim condition: post-merge records that hold a verdict and have not settled their outcome.
  for (const record of state.ledger) {
    if (!record.postMerge || !record.verdict || (record.postMergeFollowUps && !record.postMergeFollowUps.failure && !record.postMergeFollowUps.pending)) continue;
    const item = state.work.find(work => work.key === record.key);
    if (!item) continue;
    const outcome = await filePostMergeFollowUps(item, record, effects, now);
    if (!outcome) continue;
    record.postMergeFollowUps = outcome; // settlePostMerge: the record is the only carrier.
    for (const entry of outcome.filed) {
      const spec = state.filedSpecs.get(`post-merge-follow-up:${item.key}:${record.sha}:${entry.index}`);
      if (spec) state.work.push(spec.work);
    }
  }
  // every write reaps the ledger to its bound (saveReviewLedger → boundSessionLedger).
  state.ledger = boundSessionLedger(state.ledger);
  return actions;
}

/**
 * The convergence step this change delivers (the candidate): the loop reads each delivered item's own
 * standing verdict — durable on the item, never reaped — and a CHANGES_REQUESTED verdict with no
 * decision requested and no follow-up linked converges within one cycle, by the route the control
 * plane's refusal names: the follow-up items, filed under the loop's idempotency keys and released.
 * A step that cannot land is an action row of the review-convergence class (`action:review`,
 * fault-classes.ts), retried under the sessions.ts backoff and surviving the ledger; and a verdict
 * still unconverged past the decision bound raises the class's fault row, so the gap is watched.
 */
export const convergenceActionId = (item, mergeSha) => `review-converge:${item.key}:${mergeSha.slice(0, 12)}`;
export function convergenceRoute(item) {
  return item.stage === 'done' ? 'follow-up' : 'decision';
}
export async function convergePostMergeVerdicts(state, effects, now) {
  const at = Date.parse(now); // the bound reads the clock, never the string it was handed
  const faults = [];
  for (const item of state.work) {
    const verdict = item.reviewLaunch?.postMerge ? item.reviewLaunch.verdict : null;
    if (item.stage !== 'done' || verdict?.state !== 'CHANGES_REQUESTED') continue;
    const linked = state.work.filter(work => work.origin?.reviewFollowUps?.parent === item.key);
    if ((item.decisions ?? []).some(decision => !decision.judgedAt)) continue; // the decision arm is in motion
    const filed = new Set(linked.flatMap(work => work.origin.reviewFollowUps.findings.map(finding => finding.text.slice(0, 300))));
    const lines = verdict.body.split('\n').flatMap(line => blockingFindings(line));
    const missing = lines.filter(text => !filed.has(text.slice(0, 300)));
    if (!missing.length) continue; // converged: every BLOCKING line is linked to a follow-up item
    const actionId = convergenceActionId(item, item.delivery.mergeSha);
    const previous = state.actions[actionId];
    if (previous && previous.state !== 'done' && !readyToRetry(previous, state.cycle)) continue;
    if (convergenceRoute(item) !== 'follow-up') continue; // an undelivered item takes the decision arm
    try {
      for (const [index, text] of missing.entries()) {
        const requestId = `post-merge-follow-up:${item.key}:${item.delivery.mergeSha}:${lines.indexOf(text)}`;
        if (!state.filedSpecs.has(requestId)) {
          const created = await effects.createWork(postMergeFollowUp(item, item.delivery.mergeSha, parseFinding(text), lines.indexOf(text)), requestId);
          const work = { ...postMergeFollowUp(item, item.delivery.mergeSha, parseFinding(text), lines.indexOf(text)), key: created.key, id: created.id, stage: 'backlog', ready: false };
          state.filedSpecs.set(requestId, { requestId, work });
          state.work.push(work);
        }
      }
      state.actions[actionId] = { id: actionId, kind: 'action:review', faultClass: 'review-convergence', state: 'done', attempts: (previous?.attempts ?? 0), cycle: state.cycle, at: now };
    } catch (error) {
      // The failure is an action row — retried under backoff, surviving the ledger — never only a ledger record.
      state.actions[actionId] = { id: actionId, kind: 'action:review', faultClass: 'review-convergence', state: 'failed', attempts: (previous?.attempts ?? 0) + 1, cycle: state.cycle, at: now,
        detail: `converging ${item.key}'s post-merge verdict ${verdict.reviewId} failed: ${(error instanceof Error ? error.message : String(error)).split('\n')[0]}`.slice(0, 500) };
    }
  }
  // The bound the base never had: a verdict unconverged past the decision bound, with no linked
  // follow-up and no convergence action in motion, raises the review-convergence class's row.
  for (const item of state.work) {
    const verdict = item.reviewLaunch?.postMerge ? item.reviewLaunch.verdict : null;
    if (item.stage !== 'done' || verdict?.state !== 'CHANGES_REQUESTED') continue;
    const linked = state.work.some(work => work.origin?.reviewFollowUps?.parent === item.key);
    const action = state.actions[convergenceActionId(item, item.delivery.mergeSha)];
    const inMotion = action && (action.state === 'waiting' || action.state === 'done' || (action.state === 'failed' && !readyToRetry(action, state.cycle) && action.attempts < 5));
    if (!linked && !inMotion && at - Date.parse(verdict.submittedAt) > approverJudgeBoundMs)
      faults.push({ kind: 'review-settlement', faultClass: 'review-convergence', subject: item.key, text: `${item.key}'s post-merge review ${verdict.reviewId} settled CHANGES_REQUESTED at ${verdict.submittedAt} and stands unconverged past the ${approverJudgeBoundMs / 60_000}-minute decision bound with no decision requested and no follow-up linked` });
  }
  return faults;
}

/** The state one recorded instant held: the four delivered items, their verdicts landed, nothing else. */
export function recordedState(effects) {
  const state = { work: [], ledger: [], actions: {}, filedSpecs: new Map(), cycle: 0 };
  for (const [index, recorded] of RECORDED.entries()) {
    const item = deliveredItem(recorded);
    item.reviewLaunch.verdict = { sha: recorded.mergeSha, state: 'CHANGES_REQUESTED', body: recorded.body, reviewer: recorded.reviewer, reviewId: recorded.reviewId, submittedAt: recorded.submittedAt, source: 'control-plane' };
    const landed = recordVerdict(item, item.reviewLaunch.verdict);
    state.work.push(landed);
    state.ledger.push(verdictRecord(recorded, `record-${index}`));
  }
  return state;
}

/** Run `cycles` ticks of the base loop, each TICK_MS apart, from the last verdict's submission. */
export async function runBaseCycles(state, effects, cycles, fromMs) {
  for (let cycle = 1; cycle <= cycles; cycle++) { state.cycle = cycle; await baseTick(state, effects, new Date(fromMs + cycle * TICK_MS).toISOString()); }
  return state;
}

// ---------------------------------------------------------------------------
// The recorded instances against the base.
// ---------------------------------------------------------------------------

test('each recorded verdict marks the item reviewed and leaves every convergence route closed — the state the 23:58:52Z board read held', async () => {
  for (const recorded of RECORDED) {
    const item = recordVerdict(deliveredItem(recorded), { sha: recorded.mergeSha, state: 'CHANGES_REQUESTED', body: recorded.body, reviewer: recorded.reviewer, reviewId: recorded.reviewId, submittedAt: recorded.submittedAt, source: 'control-plane' });
    // The verdict's own effect (server/review-verdict.ts): the debt is marked paid, nothing else moves.
    assert.equal(item.stage, 'done');
    assert.equal(item.postMergeReview, 'reviewed');
    assert.equal(item.reworkRequested, false);
    assert.deepEqual(item.decisions, []);
    assert.equal(item.nextAction, null);
    // The findings are real and blocking: exactly as many as the review recorded.
    const findings = item.reviewLaunch.verdict.body.split('\n').flatMap(line => blockingFindings(line));
    assert.equal(findings.length, recorded.blocking, `${recorded.key}'s verdict carries ${recorded.blocking} BLOCKING findings`);
    for (const finding of findings) assert.match(finding, /\.(?:js|ts):\d+|src\/model\/work\.ts/, 'each finding names the repository file it judged');
    // The rework arm: refused on a delivered item, with the sentence the operator agent's recorded `master decide … rework` calls received.
    assert.equal(decisionPrecondition(item), DELIVERED_IMMUTABLE);
    // The decision bound: no decision stands requested, so no bound watches the gap.
    assert.equal(decisionBound(item, BOARD_READ), null);
    // The review-convergence invariant: it counts open follow-ups per parent — the item has none, and it fires on none.
    assert.deepEqual(followUpsPerParent([item, ...findings.map(() => item)]), []);
    // The gap the board read measured: 73.2, 75.7, 74.7 minutes (18.6 for GY-15), each past the 10-minute bound.
    const gapMinutes = (BOARD_READ - Date.parse(recorded.submittedAt)) / 60_000;
    assert.ok(gapMinutes > approverJudgeBoundMs / 60_000, `${recorded.key}'s gap (${gapMinutes.toFixed(1)} min) passed the decision bound with nothing watching`);
  }
  // The three instances the item names, at the gaps the board read measured.
  const gaps = Object.fromEntries(RECORDED.slice(0, 3).map(recorded => [recorded.key, (BOARD_READ - Date.parse(recorded.submittedAt)) / 60_000]));
  assert.equal(gaps['GY-17'].toFixed(1), '73.2');
  assert.equal(gaps['GY-23'].toFixed(1), '75.7');
  assert.equal(gaps['GY-24'].toFixed(1), '74.7');
});

test('the base converges a verdict only while its ledger record lives: a filing that fails dies with the record and leaves no trace', async () => {
  // The live blocker the run recorded (GY-18: "Doctor/work principal bearer token stale: work reads
  // refused"): the operator-agent bearer the filing posts as is refused, so createWork fails.
  const refused = async () => { throw new Error('401 (Unauthorized): the operator-agent bearer token is stale; work reads refused'); };
  const state = recordedState({ createWork: refused });
  const verdictAt = Date.parse('2026-10-17T22:45:39.253Z');
  // The first tick settles the verdict's record and fails the filing — on the record, the only carrier.
  await runBaseCycles(state, { createWork: refused }, 1, verdictAt);
  const record = state.ledger.find(entry => entry.key === 'GY-17');
  assert.equal(record.state, 'completed');
  assert.match(record.postMergeFollowUps?.failure ?? '', /failed: 401 \(Unauthorized\)/);
  assert.equal(state.work.filter(work => work.origin?.reviewFollowUps?.parent === 'GY-17').length, 0, 'nothing is filed');
  // Cycles to the board read — 451 ticks of 10 s: the failure repeats on the record and nothing else exists.
  await runBaseCycles(state, { createWork: refused }, 450, verdictAt);
  assert.match(state.ledger.find(entry => entry.key === 'GY-17').postMergeFollowUps?.failure ?? '', /failed: 401/);
  assert.deepEqual(Object.keys(state.actions), [], 'no action row exists for the convergence');
  // The ledger is a bounded working set (reviewer.ts boundSessionLedger): newer terminal records
  // crowd a released verdict record out of the retention window — the live ledger churns one record
  // per reviewer session and relaunch, and held none of the four verdict records at the 00:5x reads.
  releaseClosedRequests(state.ledger, new Date(BOARD_READ + 60_000).toISOString());
  for (let index = 0; index < sessionLedgerRetention + 1; index++)
    state.ledger.push({ id: `newer-${index}`, key: 'GY-20', sha: `da23bdcf4942${String(index).padStart(28, '0')}`, state: 'completed', requestedAt: new Date(BOARD_READ + 61_000 + index).toISOString(), closedAt: new Date(BOARD_READ + 61_000 + index).toISOString() });
  state.ledger = boundSessionLedger(state.ledger);
  assert.equal(state.ledger.some(entry => entry.key === 'GY-17'), false, 'the verdict record is reaped');
  // Now the filing's only trigger is gone: cycling forever changes nothing, although the item still holds its verdict.
  await runBaseCycles(state, { createWork: async spec => ({ key: 'GY-90', id: 'filed-anyway' }) }, 100, BOARD_READ);
  assert.equal(state.work.filter(work => work.origin?.reviewFollowUps?.parent === 'GY-17').length, 0, 'the base never re-reads the item\'s standing verdict');
  const gy17 = state.work.find(work => work.key === 'GY-17');
  assert.equal(gy17.reviewLaunch.verdict.state, 'CHANGES_REQUESTED', 'the verdict still stands on the item');
  assert.equal(state.work.filter(work => work.origin?.reviewFollowUps?.parent === 'GY-17').length, 0);
  assert.deepEqual(Object.keys(state.actions), []);
});

test('the base leaves all three recorded instances exactly as the board read found them: reviewed, unrequested, unlinked, unwatched', async () => {
  const refused = { createWork: async () => { throw new Error('401 (Unauthorized): the operator-agent bearer token is stale; work reads refused'); } };
  const state = recordedState(refused);
  // 75.7 minutes of base cycles from the earliest verdict — past the board read.
  await runBaseCycles(state, refused, 455, Date.parse('2026-10-17T22:43:12.097Z'));
  for (const recorded of RECORDED.slice(0, 3)) {
    const item = state.work.find(work => work.key === recorded.key);
    assert.equal(item.postMergeReview, 'reviewed');
    assert.equal(item.reworkRequested, false);
    assert.deepEqual(item.decisions, []);
    assert.equal(item.nextAction, null);
    assert.equal(state.work.some(work => work.origin?.reviewFollowUps?.parent === recorded.key), false, `${recorded.key} holds no linked follow-up`);
    assert.equal(decisionBound(item, BOARD_READ), null, 'no decision bound watches it');
  }
  assert.deepEqual(Object.keys(state.actions), []);
  assert.deepEqual(followUpsPerParent(state.work), []);
});

// ---------------------------------------------------------------------------
// The candidate: the convergence step this change delivers.
// ---------------------------------------------------------------------------

/** The filer the loop wires in production (auto-dispatch.ts createWork → POST /api/work as the operator agent, then /ready). */
const filingEffects = created => ({
  createWork: async (spec, requestId) => {
    if (created.has(requestId)) return created.get(requestId);
    const entry = { key: `GY-${30 + created.size}`, id: `${requestId}` };
    created.set(requestId, entry);
    return entry;
  },
});

test('the convergence step converges each recorded instance within one cycle, inside the decision bound', async () => {
  for (const recorded of RECORDED) {
    const created = new Map();
    const effects = filingEffects(created);
    // One recorded instance alone in the state: the step sweeps every item, so the per-instance
    // counts below say exactly what this instance's verdict filed.
    const state = recordedState(effects);
    state.work = state.work.filter(work => work.key === recorded.key);
    state.ledger = []; // the ledger holds none of the verdict records — the recorded live state at the 00:5x reads.
    const verdictAt = Date.parse(recorded.submittedAt);
    // One cycle after the verdict: the step files the follow-ups, linked through origin.reviewFollowUps —
    // from the item's own standing verdict, which is all the state holds.
    state.cycle = 1;
    const faults = await convergePostMergeVerdicts(state, effects, new Date(verdictAt + TICK_MS).toISOString());
    const linked = state.work.filter(work => work.origin?.reviewFollowUps?.parent === recorded.key);
    assert.equal(linked.length, recorded.blocking, `${recorded.key}'s ${recorded.blocking} BLOCKING finding(s) each carry a linked follow-up item`);
    const findings = recorded.body.split('\n').flatMap(line => blockingFindings(line));
    for (const [index, finding] of findings.entries()) {
      const followUp = linked[index];
      assert.equal(followUp.origin.reviewFollowUps.findings[0].text.slice(0, 300).trim(), finding.trim(), 'the follow-up carries the finding whole (the source\'s parseFinding trims the line it files)');
      assert.equal(followUp.origin.reviewFollowUps.findings[0].ref, recorded.mergeSha, 'the follow-up names the delivered merge commit');
      assert.ok(followUp.plannedFiles.includes(parseFinding(finding).paths[0]), 'the follow-up is planned on the finding\'s file');
      assert.equal(followUp.type, 'bug');
      assert.equal(followUp.priority, 1);
      assert.equal(followUp.policy.review, true, 'the follow-up is reviewed like any item');
    }
    // Converged within one cycle — 10 s, a sixtieth of the decision bound, where the base sat 73–75 minutes.
    assert.equal(approverJudgeBoundMs / TICK_MS, 60);
    assert.deepEqual(faults, [], 'no fault row: the verdict converged');
    const item = state.work.find(work => work.key === recorded.key);
    assert.ok(!(item.postMergeReview === 'reviewed' && !item.reworkRequested && !item.decisions.length && !state.work.some(work => work.origin?.reviewFollowUps?.parent === recorded.key)), 'the unconverged conjunction the criterion names is broken');
    // A second cycle files nothing more: the filings are keyed and the linked findings are skipped.
    state.cycle = 2;
    await convergePostMergeVerdicts(state, effects, new Date(verdictAt + 2 * TICK_MS).toISOString());
    assert.equal(state.work.filter(work => work.origin?.reviewFollowUps?.parent === recorded.key).length, recorded.blocking);
    assert.equal(created.size, recorded.blocking, 'one create per finding, replayed never');
  }
});

test('a convergence that cannot land is a retried action of the review-convergence class, surviving the ledger reaping that killed the base\'s only carrier', async () => {
  const created = new Map();
  const effects = filingEffects(created);
  const state = recordedState(effects);
  state.ledger = []; // the recorded live state: no verdict record at all.
  const verdictAt = Date.parse('2026-10-17T22:45:39.253Z');
  const refused = { createWork: async () => { throw new Error('401 (Unauthorized): work reads refused'); } };
  const gy17 = () => state.work.find(work => work.key === 'GY-17');
  // Cycle 1: the filer is still refused — the step records a failed action row, not a ledger field.
  state.cycle = 1;
  const faults = await convergePostMergeVerdicts(state, refused, new Date(verdictAt + TICK_MS).toISOString());
  const action = state.actions[convergenceActionId(gy17(), '56ee69722bbda0137a68752e6eaab8768124726c')];
  assert.equal(action.kind, 'action:review');
  assert.equal(action.faultClass, 'review-convergence');
  assert.equal(action.state, 'failed');
  assert.equal(action.attempts, 1);
  assert.match(action.detail, /401 \(Unauthorized\)/);
  // The bound watches while the action is in motion: no fault row yet (inside the bound, and the action stands).
  assert.deepEqual(faults, []);
  // The backoff admits the retry on the next cycle (sessions.ts readyToRetry: 1 cycle after one attempt).
  assert.equal(readyToRetry(action, 2), true);
  // Cycle 2 — the refusal stands: attempts grow, and the row survives anything the ledger does.
  state.cycle = 2;
  await convergePostMergeVerdicts(state, refused, new Date(verdictAt + 2 * TICK_MS).toISOString());
  assert.equal(state.actions[action.id].attempts, 2);
  assert.equal(state.actions[action.id].state, 'failed');
  // Cycle 3 — the backoff holds the retry (2 cycles after two attempts), and still nothing is filed.
  assert.equal(readyToRetry(state.actions[action.id], 3), false);
  state.cycle = 3;
  await convergePostMergeVerdicts(state, refused, new Date(verdictAt + 3 * TICK_MS).toISOString());
  assert.equal(state.actions[action.id].attempts, 2, 'the backoff admits no third attempt yet');
  assert.equal(state.work.filter(work => work.origin?.reviewFollowUps?.parent === 'GY-17').length, 0);
  // Cycle 4: the credential recovers (the live operator-agent rotation at 2026-10-18T00:51:35Z) — the retry lands.
  assert.equal(readyToRetry(state.actions[action.id], 4), true);
  state.cycle = 4;
  const landed = await convergePostMergeVerdicts(state, effects, new Date(verdictAt + 4 * TICK_MS).toISOString());
  assert.equal(state.actions[action.id].state, 'done', 'the retried action completes');
  assert.equal(state.work.filter(work => work.origin?.reviewFollowUps?.parent === 'GY-17').length, 2, 'both findings are filed');
  assert.deepEqual(landed, []);
});

test('a verdict nothing converges raises the review-convergence class row past the decision bound — the gap is watched', async () => {
  const state = recordedState(filingEffects(new Map()));
  state.ledger = [];
  const verdictAt = Date.parse('2026-10-17T22:45:39.253Z');
  const unwired = { createWork: async () => { throw new Error('no follow-up filer is wired'); } };
  state.cycle = 1;
  const early = await convergePostMergeVerdicts(state, unwired, new Date(verdictAt + TICK_MS).toISOString());
  assert.equal(early.length, 0, 'inside the bound, the action row is the surface, not the class row');
  // Past the 10-minute bound with nothing linked and the convergence action no longer in motion —
  // its retries exhausted, the state the base held for 73–75 minutes because it had no action
  // machinery for this at all — the class row fires.
  const gy17 = state.work.find(work => work.key === 'GY-17');
  const exhausted = convergenceActionId(gy17, '56ee69722bbda0137a68752e6eaab8768124726c');
  state.actions = { [exhausted]: { id: exhausted, kind: 'action:review', faultClass: 'review-convergence', state: 'failed', attempts: 5, cycle: 1, at: new Date(verdictAt + TICK_MS).toISOString(), detail: 'converging GY-17\'s post-merge verdict 5066 failed: no follow-up filer is wired' } };
  state.cycle = 2;
  const late = await convergePostMergeVerdicts(state, unwired, new Date(verdictAt + approverJudgeBoundMs + TICK_MS).toISOString());
  assert.equal(late.length, 1);
  assert.equal(late[0].faultClass, 'review-convergence');
  assert.equal(late[0].subject, 'GY-17');
  assert.match(late[0].text, /settled CHANGES_REQUESTED.*stands unconverged past the 10-minute decision bound/);
  // That row is the class that filed this item (ledger event 5290, GY-28's origin): the bound now
  // surfaces the gap in one bound's time, not a doctor's 73-minute-late board read.
});

// ---------------------------------------------------------------------------
// The live installation, audited only where it exists: on the coordinator host. CI checks out this
// repository on a GitHub runner, which has no access to that host's files or control plane, so the
// audits skip there (the recorded-state reproductions above still run).
// ---------------------------------------------------------------------------

const COORDINATOR_CHECKOUT = '/home/vish/code/graphyard-snake-v4';
const CONNECTION_FILE = join(COORDINATOR_CHECKOUT, '.graphyard', 'connection.json');
const REVIEW_LEDGER = join(COORDINATOR_CHECKOUT, '.graphyard', 'reviews.json');
const onCoordinatorHost = existsSync(CONNECTION_FILE);

test(
  'live audit on the coordinator host: the review ledger holds none of the recorded verdict records — the base state that left the findings with no trigger',
  { skip: !onCoordinatorHost && `not on the coordinator host: ${CONNECTION_FILE} is absent` },
  () => {
    const ledger = JSON.parse(readFileSync(REVIEW_LEDGER, 'utf8'));
    for (const recorded of RECORDED) {
      const held = ledger.reviews.filter(record => record.key === recorded.key && record.sha === recorded.mergeSha);
      assert.equal(held.length, 0, `${recorded.key}'s verdict record is not in the ledger; the filing the base runs over ledger records has no trigger for it`);
    }
    // The verdicts themselves still stand on the items — read through the control plane's own CLI below.
  }
);

test(
  'live audit on the coordinator host: every recorded instance carries its linked follow-up items, filed and released',
  { skip: !onCoordinatorHost && `not on the coordinator host: ${CONNECTION_FILE} is absent` },
  () => {
    const connection = JSON.parse(readFileSync(CONNECTION_FILE, 'utf8'));
    const read = key => {
      const run = spawnSync(process.execPath, [connection.cliPath, 'status', key], {
        env: { ...process.env, GRAPHYARD_URL: connection.url, GRAPHYARD_TOKEN: connection.token },
        encoding: 'utf8', timeout: 60_000,
      });
      assert.equal(run.status, 0, `graphyard status ${key} failed: ${(run.stderr ?? '').slice(0, 500)}`);
      return JSON.parse(run.stdout);
    };
    const snapshot = spawnSync(process.execPath, [connection.cliPath, 'list'], {
      env: { ...process.env, GRAPHYARD_URL: connection.url, GRAPHYARD_TOKEN: connection.token },
      encoding: 'utf8', timeout: 60_000,
    });
    assert.equal(snapshot.status, 0, `graphyard list failed: ${(snapshot.stderr ?? '').slice(0, 500)}`);
    const all = JSON.parse(snapshot.stdout);
    for (const recorded of RECORDED) {
      // The verdict still stands on the delivered item, exactly as recorded.
      const item = read(recorded.key);
      assert.equal(item.stage, 'done');
      assert.equal(item.postMergeReview, 'reviewed');
      assert.equal(item.reviewLaunch?.verdict?.state, 'CHANGES_REQUESTED', `${recorded.key}'s recorded verdict stands`);
      assert.equal(item.reviewLaunch.verdict.reviewId, recorded.reviewId);
      // And it is converged: follow-up items are linked to it, carrying the verdict's blocking findings.
      const findings = recorded.body.split('\n').flatMap(line => blockingFindings(line));
      const linked = all.filter(work => work.origin?.reviewFollowUps?.parent === recorded.key);
      assert.ok(linked.length >= findings.length, `${recorded.key} holds ${findings.length} linked follow-up item(s) for its ${findings.length} BLOCKING finding(s)`);
      for (const finding of findings) {
        const carrier = linked.find(work => work.origin.reviewFollowUps.findings.some(entry => entry.text.slice(0, 120) === finding.slice(0, 120)));
        assert.ok(carrier, `a linked follow-up carries the finding "${finding.slice(0, 60)}…"`);
        assert.ok(carrier.stage !== 'backlog' || carrier.ready === true, 'the follow-up is released, not stuck unreleased in backlog');
        assert.ok(parseFinding(finding).paths.some(path => (carrier.plannedFiles ?? []).includes(path)), 'the follow-up is planned on the finding\'s file');
      }
      // The unconverged conjunction the criterion names no longer holds for any recorded instance.
      assert.ok(!(item.postMergeReview === 'reviewed' && !item.reworkRequested && !(item.decisions ?? []).length && !item.nextAction && !linked.length));
    }
  }
);

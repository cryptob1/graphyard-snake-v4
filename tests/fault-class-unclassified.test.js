// GY-19 — fault class "unclassified": 97 instances in 24 hours (threshold 3), recorded by the
// master loop against the Graphyard installation that serves this repository. As GY-3 did for
// configuration, GY-11 for deployment, GY-15 for observation, GY-17 for loop, GY-20 for session
// liveness, GY-23 for resources and GY-28 for review convergence, this file is the regression
// test the item's criterion asks for: every instance the item lists is reproduced below against
// its recorded base state — the installation exactly as it stood during the recorded window —
// and shown not to recur against the candidate condition, the one state that removes the shared
// cause. The last tests audit the live installation on the coordinator host (CI has no access to
// it and skips them).
//
// The recorded instances, all 97 verbatim from the live cursor (each row: the instant the loop
// recorded it, the action key it was recorded under, and its attention line in full). Every one
// ends with the same refusal, and every one is the loop's own record of a control-plane write
// that did not land:
//
//   ... Graphyard refused work (401): A valid Graphyard bearer token is required
//   ... Graphyard refused doctor (401): A valid Graphyard bearer token is required
//
// Three call sites wrote them (Graphyard src/daemon/, as shipped):
//
//   · faults.ts fileRecurringFaultClasses — the loop files one structural item per recurring
//     fault class; the filing goes through the operator-agent identity (effects-production.ts
//     fileFaultClass → asOperatorAgent POST work), so the write is `Graphyard refused work`. Its
//     failures are the three rows under `fault:<class>`: the recurring configuration class
//     (01:59:51.434Z), the recurring unclassified class itself (02:00:12.102Z) and the recurring
//     decision class (06:24:06.278Z).
//   · doctor.ts postRun — every settled doctor run is posted to the plane through the
//     operator-agent identity (doctorEffects recordRun → POST doctor); a post the plane did not
//     accept is kept and posted again next cycle. Its failures are the 47 rows under
//     `doctor:post:<run>` — including runs from 2026-10-14 the loop had been unable to post for
//     three days.
//   · doctor.ts retryDoctorFile — a filing the plane would not take is kept on the cursor and
//     retried under a key of its own. Its failures are the 47 rows under
//     `doctor:<run>:file:<class>`, whose 44 distinct titles are the real underlying faults of the
//     window — capacity, proof, configuration, session-liveness, loop, merge, decision,
//     human-decision, resources — every one of them diagnosed and none of them filable, because
//     the very writes that would file them were being refused.
//
// The shared cause, read from the titles the doctor itself kept trying to file ("Control plane
// refused 401 on every call: loop bound to stale loaded settings while changed
// .graphyard/master.json (cliPath, credentialFile) waits for a master run restart"; "Doctor/work
// principal bearer token stale: work reads refused 401 while master reads succeed"): the
// installation was re-provisioned onto a new credential family (the credentials this
// repository's .graphyard/master.json names today, masters/5e69f79fa209a4349c51*, and a new
// cliPath), while the master loop process kept running on the settings it had loaded at its
// start. A running loop is bound to those settings — Graphyard's liveMasterConfig
// (src/master/config.ts) refuses a reload that changes any of masterBoundSettings (credentialFile
// and cliPath among them) by name and keeps the loaded ones until a master run restart — so the
// loop kept presenting the credentials it had loaded for every write, the plane kept answering
// 401, and each refused write was recorded as an action whose kind is `action:fault`. The
// catalogue parks that kind under `unclassified` on purpose (src/model/fault-classes.ts: "these
// name a step, not a cause", GY-1338), so for 8h38m (01:59:51Z–10:37:46Z on 2026-10-17) the
// class accrued one instance per failing write — 97 of them, threshold 3 — while the class's own
// item could not be filed either: its filing is row four of the ninety-seven. The window ended
// when the loop was restarted onto the re-provisioned settings (a master run restart, what the
// doctor's own findings demanded); GY-19 itself was filed at 20:53:25Z that evening, once
// writes landed again.
//
// The candidate condition — the state the installation has held since, which this test pins:
//
//   · the state half: the loop's loaded settings are the recorded ones — the coordinator and
//     operator-agent credentials .graphyard/master.json names authenticate against the plane, so
//     no write is refused 401 and no row of the recorded shapes is recorded. The replay below
//     restarts the miniature's loop onto the completed re-provisioning (the finished master.json
//     plus the master run restart that adopts it) and replays the same 97 writes: every one
//     lands, nothing is recorded, the class never crosses its threshold.
//   · the product half: the release the loop runs (49665af8eb, adopted 2026-10-17T23:41Z, and
//     every later release) carries the machinery that handles the case itself, modelled below
//     from its own source: a refused bound-settings reload is escalated once as a configuration
//     fault naming the restart (run.ts noteConfigReload), never an unclassified row; a 401
//     credential stall binds to the credential-401 remedy, which reads the coordinator
//     credential first and — refused — hands the case to the operator by name (step-stalls.ts
//     renewHostCredentials, GY-1854); and a control plane refusing a recorded credential makes
//     the next `graphyard up` re-issue every credential and restart the loop onto a fresh cursor
//     (up.ts, GY-1851), so the loop never cycles on a credential the plane refuses.
//
// The file runs under `node --test` (plain JavaScript, Node builtins only) and carries its own
// fixture: a stub control plane over real HTTP that authenticates exactly as the product's auth
// does, refusing every other bearer token with the recorded 401 body.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The coordinator checkout of cryptob1/graphyard-snake-v4 on the coordinator host. */
const COORDINATOR = '/home/vish/code/graphyard-snake-v4';

/** The auth demand every recorded refusal carries, word for word (src/server/auth.ts: `demand(actor, 'A valid Graphyard bearer token is required', 401)`). */
const REFUSAL = 'A valid Graphyard bearer token is required';

/**
 * The 97 recorded instances, verbatim from the loop's live cursor (its faults.instances retain
 * them all, every one linked to this item): the instant, the action key, the attention line.
 */
const RECORDED = [
  { at: "2026-10-17T01:59:51.434Z", subject: "fault:configuration", text: "Could not file the item for the recurring configuration fault class: Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T01:59:51.484Z", subject: "doctor:post:2026-10-14T10:46:32.427Z", text: "The control plane did not accept the doctor run of 2026-10-14T10:46:32.427Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T01:59:51.512Z", subject: "doctor:3bf19c26f0fd46c77844ce27:file:resources", text: "Still could not file \"Control plane down: ENOSPC cursor-write failure on a full volume leaves every master command with fetch failed\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:00:12.102Z", subject: "fault:unclassified", text: "Could not file the item for the recurring unclassified fault class: Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:07:12.771Z", subject: "doctor:post:2026-10-17T01:59:47.212Z", text: "The control plane did not accept the doctor run of 2026-10-17T01:59:47.212Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:07:47.419Z", subject: "doctor:3bf19c26f0fd46c77844ce27:file:session-liveness", text: "Still could not file \"Approver session for GY-38 decision 508a465b never launched: agent name taken, decision unanswered since 08:29Z\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:09:53.499Z", subject: "doctor:38b911ccb81d65d199545d47:file:configuration", text: "Still could not file \"Control plane refused 401 on every call: loop bound to stale loaded settings while changed .graphyard/master.json (cliPath, credentialFile) waits for a master run restart\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:21:05.529Z", subject: "doctor:post:2026-10-17T02:09:50.272Z", text: "The control plane did not accept the doctor run of 2026-10-17T02:09:50.272Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:30:26.627Z", subject: "doctor:post:2026-10-17T02:21:17.032Z", text: "The control plane did not accept the doctor run of 2026-10-17T02:21:17.032Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:42:16.522Z", subject: "doctor:post:2026-10-17T02:31:19.553Z", text: "The control plane did not accept the doctor run of 2026-10-17T02:31:19.553Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:50:09.049Z", subject: "doctor:post:2026-10-17T02:42:26.770Z", text: "The control plane did not accept the doctor run of 2026-10-17T02:42:26.770Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:50:57.829Z", subject: "doctor:4916c9f4caced7c6599cbe6a:file:configuration", text: "Still could not file \"Master loop runs on stale loaded settings: changed .graphyard/master.json (cliPath, credentialFile) awaits a master run restart, and every Graphyard cloud write is refused 401\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:51:18.801Z", subject: "doctor:4916c9f4caced7c6599cbe6a:file:capacity", text: "Still could not file \"No executor serves request-review: every executor stopped on 2026-10-10 and host supervision is unavailable, so GY-1's independent review of PR #4 can never be claimed\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:52:22.004Z", subject: "doctor:eb29cc49c15ba8c421ecd4be:file:capacity", text: "Still could not file \"No live executor serves request-review: GY-1 approval unserved 13m+, all three registered executors stopped\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T02:52:42.705Z", subject: "doctor:eb29cc49c15ba8c421ecd4be:file:configuration", text: "Still could not file \"Reviewer profile review-codex is unknown: GY-1 review session launch fails before start\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T03:02:27.596Z", subject: "doctor:post:2026-10-17T02:52:42.136Z", text: "The control plane did not accept the doctor run of 2026-10-17T02:52:42.136Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T03:17:21.709Z", subject: "doctor:post:2026-10-17T03:02:51.260Z", text: "The control plane did not accept the doctor run of 2026-10-17T03:02:51.260Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T03:26:01.339Z", subject: "doctor:post:2026-10-17T03:17:30.682Z", text: "The control plane did not accept the doctor run of 2026-10-17T03:17:30.682Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T03:43:27.041Z", subject: "doctor:post:2026-10-17T03:27:32.876Z", text: "The control plane did not accept the doctor run of 2026-10-17T03:27:32.876Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T03:51:33.310Z", subject: "doctor:post:2026-10-17T03:43:44.954Z", text: "The control plane did not accept the doctor run of 2026-10-17T03:43:44.954Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T03:53:45.898Z", subject: "doctor:eb29cc49c15ba8c421ecd4be:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1: approval can never converge\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T04:06:47.103Z", subject: "doctor:post:2026-10-17T03:53:45.044Z", text: "The control plane did not accept the doctor run of 2026-10-17T03:53:45.044Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T04:17:30.179Z", subject: "doctor:post:2026-10-17T04:06:50.720Z", text: "The control plane did not accept the doctor run of 2026-10-17T04:06:50.720Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T04:34:14.267Z", subject: "doctor:post:2026-10-17T04:17:31.798Z", text: "The control plane did not accept the doctor run of 2026-10-17T04:17:31.798Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T04:52:20.607Z", subject: "doctor:post:2026-10-17T04:34:29.969Z", text: "The control plane did not accept the doctor run of 2026-10-17T04:34:29.969Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:03:00.482Z", subject: "doctor:post:2026-10-17T04:52:38.573Z", text: "The control plane did not accept the doctor run of 2026-10-17T04:52:38.573Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:15:50.207Z", subject: "doctor:post:2026-10-17T05:03:06.483Z", text: "The control plane did not accept the doctor run of 2026-10-17T05:03:06.483Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:27:26.159Z", subject: "doctor:post:2026-10-17T05:15:59.835Z", text: "The control plane did not accept the doctor run of 2026-10-17T05:15:59.835Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:27:27.102Z", subject: "doctor:6d353a96c49f7fe9a7f5921e:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files: GY-1's proof request can never be answered\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:42:21.316Z", subject: "doctor:post:2026-10-17T05:27:25.309Z", text: "The control plane did not accept the doctor run of 2026-10-17T05:27:25.309Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:53:56.732Z", subject: "doctor:post:2026-10-17T05:42:30.024Z", text: "The control plane did not accept the doctor run of 2026-10-17T05:42:30.024Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:54:05.660Z", subject: "doctor:post:2026-10-14T11:03:46.863Z", text: "The control plane did not accept the doctor run of 2026-10-14T11:03:46.863Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T05:54:05.692Z", subject: "doctor:5a3f24be5d833b3da681f806:file:capacity", text: "Still could not file \"No live executor serves resolve-escalation: GY-1's test-gate escalation unanswered 31+ min while a green approved candidate waits\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:05:53.208Z", subject: "doctor:post:2026-10-17T05:53:59.433Z", text: "The control plane did not accept the doctor run of 2026-10-17T05:53:59.433Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:16:40.398Z", subject: "doctor:post:2026-10-17T06:06:06.398Z", text: "The control plane did not accept the doctor run of 2026-10-17T06:06:06.398Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:16:44.902Z", subject: "doctor:5a3f24be5d833b3da681f806:file:loop", text: "Still could not file \"master decide rejects its own trigger enum value in every accepted argument shape, leaving refused-decision escalations unresolvable through the CLI\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:24:06.278Z", subject: "fault:decision", text: "Could not file the item for the recurring decision fault class: Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:27:49.706Z", subject: "doctor:post:2026-10-17T06:16:43.353Z", text: "The control plane did not accept the doctor run of 2026-10-17T06:16:43.353Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:28:11.480Z", subject: "doctor:523076408aec2c80f0f11d2a:file:capacity", text: "Still could not file \"No live executor serves the merge/trial and dispatch steps: GY-1's green candidate 024c07784321 untrialled and unpushed since 2026-10-17T02:32Z\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:41:02.280Z", subject: "doctor:post:2026-10-17T06:28:09.697Z", text: "The control plane did not accept the doctor run of 2026-10-17T06:28:09.697Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:41:16.506Z", subject: "doctor:934c6c7bebed08084016b34f:file:session-liveness", text: "Still could not file \"Approver session for GY-1 decision f9162d74 outlives its settled decision by over an hour\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:53:53.381Z", subject: "doctor:post:2026-10-17T06:41:14.994Z", text: "The control plane did not accept the doctor run of 2026-10-17T06:41:14.994Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T06:54:01.422Z", subject: "doctor:aaa4b21a7cc5b7ef46f596f3:file:capacity", text: "Still could not file \"No live executor serves merge or escalation work: merge intent d7e3d4bd9af9 never pushed, GY-1 test-gate escalation unanswerable\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:04:35.028Z", subject: "doctor:post:2026-10-17T06:53:59.514Z", text: "The control plane did not accept the doctor run of 2026-10-17T06:53:59.514Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:04:35.528Z", subject: "doctor:4bc3224832c14bc463332a8d:file:loop", text: "Still could not file \"Decisions step silent 77+ minutes after the approver refused the wrong-premise rework; stale candidate.pr=1 never resynced\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:16:23.577Z", subject: "doctor:post:2026-10-17T07:04:33.478Z", text: "The control plane did not accept the doctor run of 2026-10-17T07:04:33.478Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:16:40.833Z", subject: "doctor:9b5ac6a2723de1de0d39eb79:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1: the proof request can never converge\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:30:42.571Z", subject: "doctor:post:2026-10-17T07:16:38.948Z", text: "The control plane did not accept the doctor run of 2026-10-17T07:16:38.948Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:30:49.687Z", subject: "doctor:0de4f411dfc001d3f971d53f:file:configuration", text: "Still could not file \"Control-plane settings drift: stale credentials refuse work reads and doctor posts, reviewer profile unknown, webhook secret unset\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:42:23.426Z", subject: "doctor:post:2026-10-17T07:30:47.788Z", text: "The control plane did not accept the doctor run of 2026-10-17T07:30:47.788Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:42:27.095Z", subject: "doctor:203e11ce6b8d9a6f2870f425:file:configuration", text: "Still could not file \"Master loop bound to stale loaded settings: every control-plane write refused 401 until a master run restart adopts the changed cliPath and credentialFile\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:51:21.426Z", subject: "doctor:post:2026-10-17T07:42:25.776Z", text: "The control plane did not accept the doctor run of 2026-10-17T07:42:25.776Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:51:41.958Z", subject: "doctor:f7585a54857220abf08bfc04:file:session-liveness", text: "Still could not file \"Approver sessions outlive their settled decisions (f9162d74 idle-live 2h42m after settle)\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T07:52:03.690Z", subject: "doctor:f7585a54857220abf08bfc04:file:human-decision", text: "Still could not file \"GITHUB_WEBHOOK_SECRET unset: every webhook delivery refused, GitHub observation dead (owner credential decision)\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:01:35.779Z", subject: "doctor:post:2026-10-17T07:52:45.518Z", text: "The control plane did not accept the doctor run of 2026-10-17T07:52:45.518Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:01:43.359Z", subject: "doctor:68816c11c9d093bc50028e12:file:session-liveness", text: "Still could not file \"Approver sessions outlive their refused decisions on GY-1\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:02:04.838Z", subject: "doctor:369a8d23dd685fc354c82fe8:file:capacity", text: "Still could not file \"No live executor serves resolve-escalation or request-review: GY-1's escalate action waits 3h+ and the merge writer never trials the green candidate\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:12:57.675Z", subject: "doctor:post:2026-10-17T08:02:46.361Z", text: "The control plane did not accept the doctor run of 2026-10-17T08:02:46.361Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:13:06.956Z", subject: "doctor:16d4e56829a80ab240ee5011:file:capacity", text: "Still could not file \"No live executor serves resolve-escalation, request-review or merge/trial: all executors stopped on release split and GY-1's escalate action has waited ~4h\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:20:53.782Z", subject: "doctor:post:2026-10-17T08:13:04.949Z", text: "The control plane did not accept the doctor run of 2026-10-17T08:13:04.949Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:21:09.636Z", subject: "doctor:16d4e56829a80ab240ee5011:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1: the proof request can never be answered and AC-1 can never be evidenced\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:21:31.903Z", subject: "doctor:16d4e56829a80ab240ee5011:file:session-liveness", text: "Still could not file \"Three approver sessions on GY-1 stay live and idle for hours after their decisions settled as refused, outside the lingering-sessions count\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:22:37.400Z", subject: "doctor:16d4e56829a80ab240ee5011:file:loop", text: "Still could not file \"master decide rejects its own trigger enum value in every accepted argument shape, leaving refused-decision escalations unresolvable through the CLI\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:22:58.879Z", subject: "doctor:3049f7661d5a6adcef65c3fe:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1: AC-1 can never be evidenced\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:33:46.634Z", subject: "doctor:post:2026-10-17T08:23:18.997Z", text: "The control plane did not accept the doctor run of 2026-10-17T08:23:18.997Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:43:59.281Z", subject: "doctor:post:2026-10-17T08:33:53.617Z", text: "The control plane did not accept the doctor run of 2026-10-17T08:33:53.617Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:44:06.055Z", subject: "doctor:2defe4049a725ce2046a6af7:file:loop", text: "Still could not file \"master decide rejects the escalation trigger enum in every accepted argument shape, leaving needsHuman escalations unresolvable through the CLI\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:57:17.115Z", subject: "doctor:post:2026-10-17T08:44:04.721Z", text: "The control plane did not accept the doctor run of 2026-10-17T08:44:04.721Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T08:57:33.635Z", subject: "doctor:e2d18c6bc169685c2d106192:file:capacity", text: "Still could not file \"No live executor serves merge, resolve-escalation, request-review or resync: all three executors stopped on split checkouts with host supervision unavailable\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:07:45.054Z", subject: "doctor:post:2026-10-17T08:57:31.468Z", text: "The control plane did not accept the doctor run of 2026-10-17T08:57:31.468Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:07:47.641Z", subject: "doctor:5b0a31610d0031f1a89e455b:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1: AC-1 can never be evidenced\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:16:29.983Z", subject: "doctor:post:2026-10-17T09:07:46.308Z", text: "The control plane did not accept the doctor run of 2026-10-17T09:07:46.308Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:16:35.066Z", subject: "doctor:dd05f265d7b27492da372cfb:file:capacity", text: "Still could not file \"No live executor serves merge, resolve-escalation, dispatch or resync: GY-1's green approved candidate untriaged and unpushed since 02:32Z\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:16:56.470Z", subject: "doctor:dd05f265d7b27492da372cfb:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1: the AC-1 proof request can never be answered until a producer principal is provisioned\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:18:01.650Z", subject: "doctor:dd05f265d7b27492da372cfb:file:scope", text: "Still could not file \"GY-1's candidate.pr still points at closed PR 1 while the candidate is the head of open PR 4; the stale pointer fed the refused rework decision and no resync runs without executors\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:25:53.197Z", subject: "doctor:post:2026-10-17T09:18:00.154Z", text: "The control plane did not accept the doctor run of 2026-10-17T09:18:00.154Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:26:08.453Z", subject: "doctor:59b5c3c8731d83b10b922fed:file:session-liveness", text: "Still could not file \"Approver sessions outlive their settled decisions: three sessions idle-live up to ~4h50m after their GY-1 decisions were refused, while the lingering-sessions invariant reads holds\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:26:30.299Z", subject: "doctor:59b5c3c8731d83b10b922fed:file:loop", text: "Still could not file \"master decide rejects its own trigger enum value in every accepted argument shape, leaving refused-decision escalations unresolvable through the CLI\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:27:36.262Z", subject: "doctor:59b5c3c8731d83b10b922fed:file:merge", text: "Still could not file \"Stale candidate record on GY-1: candidate.pr still reads 1 (PR #1 closed unmerged 2026-10-10) while the candidate heads open MERGEABLE PR #4, and the record was never resynced\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:27:57.965Z", subject: "doctor:59b5c3c8731d83b10b922fed:file:decision", text: "Still could not file \"Recurring decision-refused fault class has no open item: three consecutive GY-1 decisions refused (wrong-premise rework, no-op requirements probe, wrong-principal grant)\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:36:12.159Z", subject: "doctor:post:2026-10-17T09:28:18.090Z", text: "The control plane did not accept the doctor run of 2026-10-17T09:28:18.090Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:37:31.050Z", subject: "doctor:0211a782c0bb0df7d1d94a87:file:capacity", text: "Still could not file \"No live executor serves merge, request-review or resolve-escalation; GY-1's green candidate is never trialled or pushed\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:37:52.584Z", subject: "doctor:0211a782c0bb0df7d1d94a87:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1; the proof request can never be answered\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:47:30.182Z", subject: "doctor:post:2026-10-17T09:38:34.920Z", text: "The control plane did not accept the doctor run of 2026-10-17T09:38:34.920Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:48:14.740Z", subject: "doctor:0211a782c0bb0df7d1d94a87:file:configuration", text: "Still could not file \"Master loop bound to stale loaded settings: work reads and doctor posts refused 401 until a master run restart adopts the changed cliPath and credentialFile\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T09:48:36.504Z", subject: "doctor:0211a782c0bb0df7d1d94a87:file:session-liveness", text: "Still could not file \"Approver sessions outlive their refused decisions on GY-1 by up to 5 hours\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:00:57.152Z", subject: "doctor:post:2026-10-17T09:48:56.636Z", text: "The control plane did not accept the doctor run of 2026-10-17T09:48:56.636Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:01:09.106Z", subject: "doctor:a4bc302e709ec9053e226e72:file:session-liveness", text: "Still could not file \"Three approver sessions on GY-1 idle-live for hours past their settled refusals, outside the lingering-sessions count\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:11:44.337Z", subject: "doctor:post:2026-10-17T10:01:07.635Z", text: "The control plane did not accept the doctor run of 2026-10-17T10:01:07.635Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:11:46.037Z", subject: "doctor:bb9979d55ea68c8164cb3320:file:session-liveness", text: "Still could not file \"Three approver sessions idle-live for hours past their refused decisions on GY-1 while the lingering-sessions invariant misreports holds\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:22:52.991Z", subject: "doctor:post:2026-10-17T10:11:44.642Z", text: "The control plane did not accept the doctor run of 2026-10-17T10:11:44.642Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:30:45.856Z", subject: "doctor:post:2026-10-17T10:23:06.381Z", text: "The control plane did not accept the doctor run of 2026-10-17T10:23:06.381Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:30:50.512Z", subject: "doctor:bb9979d55ea68c8164cb3320:file:configuration", text: "Still could not file \"Doctor/work principal bearer token stale: work reads refused 401 while master reads succeed\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:31:12.965Z", subject: "doctor:bb9979d55ea68c8164cb3320:file:human-decision", text: "Still could not file \"Owner must set GITHUB_WEBHOOK_SECRET for cryptob1/graphyard-snake-v4: webhook deliveries refused, observation degraded to polling\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:32:18.752Z", subject: "doctor:6a1880f81eac4dfd82fc409b:file:proof", text: "Still could not file \"No principal is authorized to produce unit:onboarding-files on GY-1: producer role limit 0, no profiles, no ci-proofs principal\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:32:40.380Z", subject: "doctor:6a1880f81eac4dfd82fc409b:file:session-liveness", text: "Still could not file \"Approver sessions idle-live for hours after their decisions settled refused on GY-1\": Graphyard refused work (401): A valid Graphyard bearer token is required" },
  { at: "2026-10-17T10:37:46.503Z", subject: "doctor:post:2026-10-17T10:33:22.090Z", text: "The control plane did not accept the doctor run of 2026-10-17T10:33:22.090Z; it is posted again next cycle: Graphyard refused doctor (401): A valid Graphyard bearer token is required" },
];

// ---------------------------------------------------------------------------
// The shipped catalogue (src/model/fault-classes.ts), transcribed: the classes, every kind each
// lists, and the one class a kind belongs to. `action:fault` sits under `unclassified` by design
// — "these name a step, not a cause" (GY-1338) — which is why the recorded rows accrued there.
// ---------------------------------------------------------------------------
const faultClasses = ['session-liveness', 'review-convergence', 'decision', 'scope', 'overlap-hold', 'observation', 'deployment', 'configuration',
  'containment', 'merge', 'proof', 'capacity', 'resources', 'loop', 'human-decision', 'stalled-gate', 'unclassified'];
const faultCatalogue = {
  'session-liveness': ['session', 'launch-review', 'launch-producer', 'consent-hold', 'overlong-session', 'unanswered-request', 'stuck-request', 'escalation:lease-loss',
    'action:close', 'action:dispatch', 'action:session', 'action:preserve', 'action:wake'],
  'review-convergence': ['merge-base-dismissed', 'unobtainable-review', 'review-conflict', 'review-settlement', 'escalation:security-concern', 'action:review'],
  'decision': ['approver-launch', 'request-remedy', 'decision-refused', 'decision-stale', 'decision-unanswered', 'owed-decision', 'agent-request', 'context-overflow', 'intervention-pattern',
    'action:decision', 'action:escalation'],
  'scope': ['scope-request', 'scope-violation', 'escalation:requirement-weakening', 'action:scope'],
  'overlap-hold': ['hold-overdue'],
  'observation': ['github-budget', 'integration-job', 'action:refresh'],
  'deployment': ['production', 'throughput', 'plane-unavailable', 'action:deployment', 'action:smoke'],
  'configuration': ['app-permissions', 'held-jobs', 'delegation-limits', 'unrunnable-remedy', 'fleet', 'setup', 'executor', 'generated-files', 'installation', 'sandbox-blocker', 'workflow-permission', 'action:config'],
  'containment': ['containment-settleable', 'containment-grace', 'containment', 'action:settle'],
  'merge': ['base-conflict', 'base-failure', 'merged-unauthorized', 'merged-reverted', 'contaminated', 'merge-refused', 'action:merge'],
  'proof': ['proof-gap', 'timing-failure', 'nonexercising-proof', 'fix-item', 'escalation:evidence-policy-conflict', 'action:proof'],
  'capacity': ['reviewer-exhausted', 'role-capacity', 'concurrency-starved', 'fleet-capacity', 'action:failover', 'action:capacity'],
  'resources': ['disk-pressure', 'memory-pressure', 'resource-bound', 'docs-headroom', 'ledger-refusal', 'action:reclaim'],
  'loop': ['loop-liveness', 'loop-cost', 'loop-failures', 'loop-silence', 'delivery-budget', 'loop-cursor', 'dispatch-failures', 'retry-stopped', 'stalled-step'],
  'human-decision': ['human-request', 'sudo', 'action:human'],
  'stalled-gate': ['gate', 'blocker', 'stalled-item', 'stalled-action', 'actorless', 'unsubmitted-attempt', 'action:blocker'],
  'unclassified': ['unclassified', 'action:fault', 'action:diagnosis'], // GY-1338: these name a step, not a cause
};
const classByKind = new Map(faultClasses.flatMap(name => faultCatalogue[name].map(kind => [kind, name])));
/** The one class a kind belongs to; a kind the catalogue does not list is unclassified. */
const faultClassOf = kind => classByKind.get(kind) ?? 'unclassified';
/** The fault kind an action's own kind names (src/daemon/state.ts daemonActionFaultKind). */
const daemonActionFaultKind = kind => `action:${kind}`;

// ---------------------------------------------------------------------------
// The shipped refusal shapes, transcribed: whether a failed action's detail is a wait rather than
// a fault (src/model/action-kinds.ts waitReason, with blocker-class.ts planeWideFailure and
// refusal.ts's status shapes). A plane-wide failure (a 502-504 body, a timeout, the server's
// startup 503) repeats while the plane is down and files no instance; the recorded 401 body is
// none of those shapes, so every recorded row counted — that is the base behaviour, and the
// first test below asserts it row by row.
// ---------------------------------------------------------------------------
const planeWideError = /\bHTTP 50[234]\b|\(50[234]\)|\b50[234] (?:Bad Gateway|Service Unavailable|Gateway)|"(?:status|code)":\s*50[234]\b|ECONNREFUSED|ECONNRESET|socket hang up|(?<!git )fetch failed|Application failed to respond|server (?:is )?(?:down|unavailable|unreachable)|\b(?:out of memory|ENOMEM)\b/i;
const planeMemory = String.raw`\b(?:server|postgres(?:ql)?|database|control plane)\b[^.\n]*\b(?:out of memory|ENOMEM)\b|\b(?:out of memory|ENOMEM)\b[^.\n]*\b(?:on|in|from|at) (?:the )?(?:graphyard )?(?:server|postgres(?:ql)?|database|control plane)\b`;
const planeWideShape = new RegExp(planeWideError.source.replace(String.raw`|\b(?:out of memory|ENOMEM)\b`, '') + `|${planeMemory}`, 'i');
const serverCallTimeout = /\bThe operation was aborted due to timeout\b/;
const startupReadiness = /\bStartup validation has not completed\b/;
const planeWideFailure = text => !!text && (planeWideShape.test(text) || serverCallTimeout.test(text) || startupReadiness.test(text));
const planeUnavailableStatus = (status, body) => typeof status === 'number' && status >= 502 && status <= 504 && !(body && typeof body.error === 'string');
const controlPlaneCall = /\b(?:Could not record|Could not close|merge writer could not be read|rework decisions of \S+ could not be read|agent registry|control plane|Graphyard refused)\b/i;
const refusedDetailOf = reason => reason.match(/Graphyard refused \S+ \(\d{3}\): (.*)$/s)?.[1] ?? reason;
const waitReason = reason => !!reason && (controlPlaneCall.test(reason) && planeWideFailure(refusedDetailOf(reason)));
/** Whether a thrown failure is plane-wide (src/model/blocker-class.ts planeWideRefusal, over RefusedResponse). */
const planeWideRefusal = error => error instanceof RefusedResponse ? planeUnavailableStatus(error.status, error.body) || startupReadiness.test(error.message) : planeWideFailure(error instanceof Error ? error.message : typeof error === 'string' ? error : null);

// ---------------------------------------------------------------------------
// The loop's fault record and action store, transcribed from src/daemon/state-cursor.ts
// (storeAction) and src/model/fault-record.ts (noteActionOutcome, instanceOf): a failed action
// carries the class of its fault kind; an action failing opens ONE instance, its further
// failures before a success are that instance, a success ends the run. The exhaustion-escalation
// holding paths of noteActionOutcome are omitted here: they key on
// `escalation:decision-unjudged:` actions, which none of the recorded keys is, so they cannot
// fire for this replay (unansweredStands, likewise, answers false for every key below).
// ---------------------------------------------------------------------------
const instanceOf = (observation, at) => ({ id: `${observation.kind}|${observation.subject.slice(0, 200)}|${at}`, kind: observation.kind, faultClass: observation.faultClass,
  subject: observation.subject.slice(0, 200), text: observation.text.slice(0, 500), at, lastSeenAt: at, linkedTo: null });
function noteActionOutcome(record, action, outcome, observation, at) {
  if (outcome === 'done') { delete record.failing[action]; return null; }
  if (outcome === 'started' || outcome === 'waiting') return null;
  const standing = record.failing[action] ? record.instances.find(entry => entry.id === record.failing[action]) : undefined;
  if (standing) { standing.lastSeenAt = at; return null; }
  const instance = { ...instanceOf(observation, at) };
  record.instances.push(instance);
  record.failing[action] = instance.id;
  return instance;
}
const unansweredStands = () => false; // keys not under escalation:decision-unjudged: (fault-record.ts unansweredStands)
function storeAction(state, key, action, faultKind = daemonActionFaultKind(action.kind)) {
  const failed = faultKind !== null && (action.state === 'failed' || action.state === 'indeterminate');
  const fault = faultKind === null || unansweredStands(state.faults, key) || (faultKind.startsWith('action:') && waitReason(action.detail)) ? null : { kind: faultKind, faultClass: faultClassOf(faultKind) };
  const entry = { ...action, ...(failed && fault ? { faultClass: fault.faultClass } : {}) };
  state.actions[key] = entry;
  if (fault) noteActionOutcome(state.faults, key, entry.state, { ...fault, subject: entry.work ?? key, text: entry.detail }, entry.at);
  return entry;
}
/** Windowed unlinked instances of one class (src/model/fault-class-recurrence.ts windowedUnlinked) — the set the filing threshold counts. */
const windowedUnlinked = (instances, faultClass, now, windowHours) => {
  const from = now - windowHours * 3_600_000;
  return instances.filter(entry => entry.faultClass === faultClass && Date.parse(entry.at) >= from && Date.parse(entry.at) <= now && !entry.linkedTo);
};
const faultClassPolicyDefaults = { threshold: 3, windowHours: 24 };

// ---------------------------------------------------------------------------
// The production write path, modelled over real HTTP (src/daemon/effects-production.ts
// asOperatorAgent, reduced to its fetch and its refusal; the credential file is read per call —
// src/master/autonomy.ts agentToken → readCredentialFile — at the path the loop's LOADED config
// names, which is what held the stale path through the recorded window).
// ---------------------------------------------------------------------------
class RefusedResponse extends Error {
  constructor(message, status, body) { super(message); this.status = status; this.body = body; }
}
/** src/daemon/effects.ts refusedBodyDetail: the server's own error string, with any zod issues. */
function refusedBodyDetail(result) {
  if (!result || typeof result !== 'object') return JSON.stringify(result);
  if (typeof result.error !== 'string') return JSON.stringify(result);
  const issues = Array.isArray(result.issues) ? result.issues : [];
  if (!issues.length) return result.error;
  return issues.map(issue => typeof issue?.message === 'string' ? issue.message : String(issue)).join('; ');
}
const readCredentialFile = async file => {
  const value = (await readFileSync(file, 'utf8')).trim();
  if (value.length < 32 || value.length > 10_000) throw new Error('Worker credential file must contain one valid token');
  return value;
};
/** One call as the master's operator-agent identity — the identity all three recorded call sites write through. */
async function asOperatorAgentPost(config, plane, path, body = {}) {
  const token = await readCredentialFile(config.operatorAgent.credentialFile);
  const response = await plane.fetch(`/api/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const text = await response.text();
  let result; try { result = JSON.parse(text); } catch { result = response.ok ? undefined : { text: text.slice(0, 200) }; }
  if (!response.ok) throw new RefusedResponse(`Graphyard refused ${path} (${response.status}): ${refusedBodyDetail(result)}`, response.status, result);
  return result;
}
/** One status read with a credential (src/daemon/step-stalls.ts hostCredentialPorts.authenticate). */
async function authenticateWith(plane, file) {
  let token;
  try { token = await readCredentialFile(file); } catch (error) { return { state: 'unknown', principal: null, detail: String(error) }; }
  try {
    const response = await plane.fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } });
    if (response.status === 401) return { state: 'refused', principal: null, detail: '401' };
    if (!response.ok) return { state: 'unknown', principal: null, detail: String(response.status) };
    const status = await response.json();
    return { state: 'ok', principal: typeof status.actor?.id === 'string' ? status.actor.id : null, detail: 'authenticated' };
  } catch (error) { return { state: 'unknown', principal: null, detail: String(error) }; }
}

// ---------------------------------------------------------------------------
// The three call sites that wrote the recorded rows, transcribed (their catch arms; the happy
// arms record `done` and open no instance).
// ---------------------------------------------------------------------------
/** src/daemon/faults.ts fileRecurringFaultClasses: file one structural item per recurring class. */
async function fileRecurringFaultClass(state, config, plane, faultClass, at) {
  const key = `fault:${faultClass}`;
  try {
    const filed = await asOperatorAgentPost(config, plane, 'work', { origin: { faultClass } });
    return storeAction(state, key, { kind: 'fault', work: filed.key, state: 'done', at, detail: `Filed ${filed.key} for the recurring ${faultClass} fault class` });
  } catch (error) {
    const unanswered = planeWideRefusal(error);
    return storeAction(state, key, { kind: 'fault', work: null, state: 'failed', at,
      detail: `Could not file the item for the recurring ${faultClass} fault class${unanswered ? ' (the control plane did not answer, so it is filed on a later cycle)' : ''}: ${error.message}` }, unanswered ? null : undefined);
  }
}
/** src/daemon/doctor.ts postRun: post one settled doctor run; a refusal is posted again next cycle. */
async function postDoctorRun(state, config, plane, runAt, at) {
  const key = `doctor:post:${runAt}`;
  try {
    await asOperatorAgentPost(config, plane, 'doctor', { at: runAt });
    return storeAction(state, key, { kind: 'fault', work: null, state: 'done', at, detail: `The control plane accepted the doctor run of ${runAt}` });
  } catch (error) {
    return storeAction(state, key, { kind: 'fault', work: null, state: 'failed', at,
      detail: `The control plane did not accept the doctor run of ${runAt}; it is posted again next cycle: ${error.message}` }, planeWideRefusal(error) ? 'plane-unavailable' : undefined);
  }
}
/** src/daemon/doctor.ts retryDoctorFile: retry a filing the plane did not take, under its own key. */
async function retryDoctorFile(state, config, plane, key, title, at) {
  try {
    await asOperatorAgentPost(config, plane, 'work', { title });
    return storeAction(state, key, { kind: 'fault', work: null, state: 'done', at, detail: `Filed the item for the ${key.split(':').at(-1)} fault on a later cycle: ${title}` });
  } catch (error) {
    return storeAction(state, key, { kind: 'fault', work: null, state: 'failed', at, detail: `Still could not file "${title}": ${error.message}` }, planeWideRefusal(error) ? 'plane-unavailable' : undefined);
  }
}

// ---------------------------------------------------------------------------
// The shipped config binding, transcribed (src/master/config.ts): the settings a running loop is
// bound to, what changed between two configs, and the reload that refuses a bound change by name
// and keeps every loaded setting. And the loop's own record of that refusal
// (src/daemon/run.ts noteConfigReload): one escalation under the configuration class.
// ---------------------------------------------------------------------------
const masterBoundSettings = ['version', 'url', 'credentialFile', 'cliPath', 'repository', 'baseBranch', 'githubAppId', 'hostId', 'masterAgentName'];
function masterConfigChanges(current, next) {
  const flatten = config => ({ ...config, ...Object.fromEntries(Object.entries(config.run ?? {}).map(([key, value]) => [`run.${key}`, value])) });
  const before = flatten(current), after = flatten(next);
  const changed = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(key => JSON.stringify(before[key]) !== JSON.stringify(after[key])).sort();
  return { changed, bound: changed.filter(key => masterBoundSettings.includes(key)) };
}
function liveMasterConfig(initial, load) {
  const live = {
    current: initial,
    async reload() {
      const at = new Date().toISOString();
      const keep = refused => ({ config: live.current, changed: [], at, refused });
      let next;
      try { next = await load(); } catch (error) { return keep(`.graphyard/master.json could not be reloaded (${error instanceof Error ? error.message : String(error)}); the loop keeps the settings it last loaded`); }
      const { changed, bound } = masterConfigChanges(live.current, next);
      if (bound.length) return keep(`.graphyard/master.json changes ${bound.join(', ')}, which a running master loop is bound to; restart master run to adopt ${bound.length === 1 ? 'it' : 'them'}. Until then the loop keeps its loaded settings, including every other change`);
      live.current = next;
      return { config: next, changed, refused: null, at };
    },
  };
  return live;
}
/** src/daemon/run.ts noteConfigReload: a refused reload is a configuration fault, whatever kind of action reports it; an adoption names what changed. */
function noteConfigReload(state, reload) {
  const previous = state.config;
  state.config = { at: reload.at, changed: reload.changed.slice(0, 100), refused: reload.refused?.slice(0, 1000) ?? null };
  const noted = [];
  if (reload.refused && previous?.refused !== state.config.refused)
    noted.push(storeAction(state, `escalation:config:${reload.at}`, { kind: 'escalation', work: null, state: 'failed', at: reload.at, detail: state.config.refused }, 'action:config'));
  if (reload.changed.length)
    noted.push(storeAction(state, `config:${reload.at}`, { kind: 'config', work: null, state: 'done', at: reload.at, detail: `Adopted .graphyard/master.json changes without a restart: ${reload.changed.join(', ')}` }));
  return noted;
}

// ---------------------------------------------------------------------------
// The credential-401 remedy, transcribed (src/daemon/step-stalls.ts renewHostCredentials,
// GY-1854): the coordinator credential is read first; refused, renewing it is outside the loop's
// authority, so the remedy is refused and names the operator's rotation — the loop's own bound
// handling of exactly this case. The deploy-key and profile branches follow the coordinator read
// in the source and are reduced here to the port list the coordinator-first branch never reaches.
// ---------------------------------------------------------------------------
async function renewHostCredentials(stall, ports) {
  const coordinator = await ports.authenticate(ports.coordinator);
  if (coordinator.state === 'refused')
    return { outcome: 'refused', verified: false, detail: `The coordinator credential ${ports.coordinator} is refused (${coordinator.detail}): renewing it is outside the loop's authority; the operator rotates it (graphyard install --apply, or operator-agent rotate as admin)` };
  throw new Error('the recorded window refuses the coordinator credential first; the branches past that read are not reached in this replay');
}

// ---------------------------------------------------------------------------
// `up`'s credential re-issue, transcribed (src/up.ts, GY-1851): the status read with each
// credential master.json records; a refused (401) one makes the run re-issue the coordinator,
// operator-agent and approver credentials and start the loop on a fresh cursor, archiving the old
// one beside itself. Modelled at the branch's own level: the note it emits, the master.json it
// leaves, the restart it performs.
// ---------------------------------------------------------------------------
async function recordedCredentialAnswers(root, plane) {
  const config = JSON.parse(readFileSync(join(root, '.graphyard', 'master.json'), 'utf8'));
  const recorded = [['coordinator', config.credentialFile], ['operator-agent', config.operatorAgent?.credentialFile], ['approver', config.approver?.credentialFile]];
  const answers = [];
  for (const [identity, file] of recorded) {
    if (typeof file !== 'string') continue;
    let token = '';
    try { token = readFileSync(file, 'utf8').trim(); } catch { /* left out: only the plane's answer judges it */ }
    if (token.length < 32) continue;
    const status = await plane.fetch('/api/status', { headers: { Authorization: `Bearer ${token}` } }).then(response => response.status).catch(() => null);
    if (status !== null) answers.push({ identity, status });
  }
  return answers;
}
/**
 * The reissue branch of runUp: when the plane refuses a recorded credential (401), the run
 * re-issues every credential — here, the provisioning the operator's re-issue performs: fresh
 * files recorded in a rewritten master.json — archives the cursor and restarts the loop onto a
 * fresh one. Returns the note the run emits, verbatim in shape.
 */
async function upReissue(installation) {
  const answers = await recordedCredentialAnswers(installation.root, installation.plane);
  const refused = answers.filter(answer => answer.status === 401).map(answer => answer.identity);
  if (!refused.length) return { reissued: false, note: null };
  // The install re-issues the credentials and records them (the fresh family the plane accepts).
  writeFileSync(join(installation.root, '.graphyard', 'master.json'), JSON.stringify(installation.freshConfig(), null, 1));
  // The loop restarts onto a fresh cursor: its loaded config is the recorded one from now on.
  installation.restartLoop();
  return { reissued: true, refused,
    note: `The control plane refused the recorded ${refused.join(', ')} credential${refused.length > 1 ? 's' : ''} (401): it serves a fresh database, so this run re-issues the coordinator, operator-agent and approver credentials and starts the master loop on a fresh cursor, archiving the old one beside itself.` };
}

// ---------------------------------------------------------------------------
// The miniature installation: a stub control plane over real HTTP — it authenticates exactly as
// the product's auth does (a configured credential resolves to its principal; every other bearer
// token draws the recorded 401 body) and accepts the two writes the loop makes — plus the
// coordinator state the recorded window held: an on-disk master.json partway through the
// re-provisioning (the new coordinator credentialFile and cliPath recorded, the operator-agent
// block still naming the stale path — exactly the two settings the recorded reload refusal
// names), and a running loop whose loaded settings still name the stale family.
// `completeReprovision` is the finished setup and `restartLoop` the master run restart that ended
// the recorded window.
// ---------------------------------------------------------------------------
async function stubInstallation() {
  const scratch = mkdtempSync(join(tmpdir(), 'gy19-unclassified-'));
  const configHome = join(scratch, 'config-home');
  const staleFamily = join(configHome, 'masters', 'stale-family');
  const freshFamily = join(configHome, 'masters', '5e69f79fa209a4349c51');
  mkdirSync(staleFamily, { recursive: true });
  mkdirSync(freshFamily, { recursive: true });
  const staleToken = `s`.repeat(40), staleOperatorToken = `t`.repeat(40);
  const freshToken = `f`.repeat(40), freshOperatorToken = `g`.repeat(40);
  writeFileSync(join(staleFamily, 'stale.token'), `${staleToken}\n`);
  writeFileSync(join(staleFamily, 'stale-operator.token'), `${staleOperatorToken}\n`);
  writeFileSync(join(freshFamily, '5e69f79fa209a4349c51.token'), `${freshToken}\n`);
  writeFileSync(join(freshFamily, '5e69f79fa209a4349c51-operator.token'), `${freshOperatorToken}\n`);
  /** The configured credentials the plane accepts: only the re-provisioned family, as on the recorded window. */
  const accepted = new Map([[freshToken, 'cryptob1-graphyard-snake-v4-master'], [freshOperatorToken, 'graphyard-master-graphyard-snake-v4-operator']]);
  let seq = 0;
  const filed = [], postedRuns = [];
  const planeServer = createServer((request, response) => {
    const send = (status, body) => { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); };
    const token = String(request.headers.authorization ?? '').replace(/^Bearer /, '');
    const actor = accepted.get(token);
    if (!actor) return send(401, { error: REFUSAL }); // src/server/auth.ts authenticate → demand(…, 401)
    if (request.method === 'GET' && request.url === '/api/status') return send(200, { actor: { id: actor } });
    if (request.method === 'POST' && request.url === '/api/work') { seq += 1; const key = `GY-${seq}`; filed.push({ key, actor }); return send(200, { id: `work-${seq}`, key }); }
    if (request.method === 'POST' && request.url === '/api/doctor') { postedRuns.push({ actor }); return send(200, { accepted: true }); }
    return send(404, { error: 'Route not found' });
  });
  await new Promise(resolve => planeServer.listen(0, '127.0.0.1', resolve));
  const { port } = planeServer.address();
  const plane = { fetch: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init) };
  const root = join(scratch, 'coordinator');
  mkdirSync(join(root, '.graphyard'), { recursive: true });
  /** The settings the running loop loaded at its start: the stale family and the old cliPath. */
  const staleConfig = () => ({ url: `http://127.0.0.1:${port}`, repository: 'cryptob1/graphyard-snake-v4', baseBranch: 'main',
    credentialFile: join(staleFamily, 'stale.token'), cliPath: '/home/vish/code/graphyard/cli/bin/graphyard.mjs',
    operatorAgent: { id: 'graphyard-master-graphyard-snake-v4-operator', credentialFile: join(staleFamily, 'stale-operator.token') } });
  /**
   * The on-disk master.json as it stood all through the recorded window: the re-provisioning had
   * rewritten the coordinator credentialFile and the cliPath (the two settings the recorded reload
   * refusal names) while the operator-agent block still recorded the stale path — so a reload was
   * refused by name and the loop kept every loaded setting, the operator-agent credential included.
   */
  const partwayConfig = () => ({ ...staleConfig(), credentialFile: join(freshFamily, '5e69f79fa209a4349c51.token'), cliPath: '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs' });
  /** The completed re-provisioning the restart adopted: the fresh family for both identities and the new cliPath. */
  const freshConfig = () => ({ url: `http://127.0.0.1:${port}`, repository: 'cryptob1/graphyard-snake-v4', baseBranch: 'main',
    credentialFile: join(freshFamily, '5e69f79fa209a4349c51.token'), cliPath: '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs',
    operatorAgent: { id: 'graphyard-master-graphyard-snake-v4-operator', credentialFile: join(freshFamily, '5e69f79fa209a4349c51-operator.token') } });
  writeFileSync(join(root, '.graphyard', 'master.json'), JSON.stringify(partwayConfig(), null, 1));
  const installation = {
    scratch, root, plane, filed, postedRuns, freshConfig, staleConfig,
    /** The running loop: its loaded settings, its fault record, its cursor. */
    loop: { loaded: staleConfig(), state: { actions: {}, faults: { instances: [], failing: {}, open: {} }, config: null } },
    restartLoop() { installation.loop.loaded = JSON.parse(readFileSync(join(root, '.graphyard', 'master.json'), 'utf8')); }, // a master run restart loads master.json
    /** The completed setup the restart adopts: master.json as the finished re-provisioning wrote it. */
    completeReprovision() { writeFileSync(join(root, '.graphyard', 'master.json'), JSON.stringify(freshConfig(), null, 1)); },
    /** The stale coordinator credential the running loop reads. */
    staleCoordinatorCredential: () => staleConfig().credentialFile,
    close() { planeServer.close(); rmSync(scratch, { recursive: true, force: true }); },
  };
  return installation;
}

/** Which call site wrote a recorded row, and the operands its detail names — read back out of the recorded sentence itself. */
function recordedWrite(row) {
  let match = /^Could not file the item for the recurring (\S+) fault class: /.exec(row.text);
  if (match) return { site: 'class', faultClass: match[1] };
  match = /^The control plane did not accept the doctor run of (\S+?); it is posted again next cycle: /.exec(row.text);
  if (match) return { site: 'post', runAt: match[1] };
  match = /^Still could not file "(.*)": /.exec(row.text);
  if (match) return { site: 'file', key: row.subject, title: match[1] };
  return null;
}

/** Replay every recorded write against one installation, at the recorded instants, in order. */
async function replay(installation) {
  const { loop } = installation;
  const actions = [];
  for (const row of RECORDED) {
    const write = recordedWrite(row);
    assert.ok(write, `the recorded row is one of the three call sites' shapes: ${row.subject}`);
    if (write.site === 'class') actions.push(await fileRecurringFaultClass(loop.state, loop.loaded, installation.plane, write.faultClass, row.at));
    else if (write.site === 'post') actions.push(await postDoctorRun(loop.state, loop.loaded, installation.plane, write.runAt, row.at));
    else actions.push(await retryDoctorFile(loop.state, loop.loaded, installation.plane, write.key, write.title, row.at));
  }
  return actions;
}

test('unit:fault-class-unclassified the catalogue the installation ships parks the loop\'s own failed writes under the class, and no wait shape matches the recorded refusal', () => {
  assert.equal(faultClassOf('action:fault'), 'unclassified', 'GY-1338: the action kinds name a step, not a cause');
  assert.equal(faultClassOf('action:config'), 'configuration');
  assert.equal(faultClassOf('plane-unavailable'), 'deployment');
  assert.equal(planeWideFailure(REFUSAL), false, 'the 401 body is none of the plane-wide shapes (no 502-504, no timeout, no startup 503)');
  assert.equal(planeUnavailableStatus(401, { error: REFUSAL }), false, 'a 401 the server judged itself is the caller\'s credential, not the plane being down');
  for (const row of RECORDED) {
    assert.equal(waitReason(row.text), false, `the recorded refusal is no wait shape, so the base counts it: ${row.subject}`);
    assert.ok(row.text.endsWith(`Graphyard refused work (401): ${REFUSAL}`) || row.text.endsWith(`Graphyard refused doctor (401): ${REFUSAL}`), `every recorded row ends with the recorded refusal: ${row.subject}`);
    assert.ok(recordedWrite(row), `every recorded row parses as one of the three call sites: ${row.subject}`);
  }
});

test('integration:fault-class-unclassified the base: every one of the 97 recorded instances is reproduced against the recorded installation state, character for character', async () => {
  const installation = await stubInstallation();
  try {
    // The recorded base state: the loop runs on the settings it loaded (the stale family), while
    // the on-disk master.json is partway through the re-provisioning — the new coordinator
    // credentialFile and cliPath recorded, the operator-agent block still naming the stale path.
    const actions = await replay(installation);
    assert.equal(actions.length, 97);
    const failed = actions.filter(action => action.state === 'failed');
    assert.equal(failed.length, 97, 'no recorded write landed: the plane refused every one with the recorded 401');
    for (const [index, row] of RECORDED.entries()) {
      const action = installation.loop.state.actions[row.subject];
      assert.ok(action, `the row's action key exists: ${row.subject}`);
      assert.equal(action.detail, row.text, `the ${row.subject} detail is the recorded sentence, character for character`);
      assert.equal(action.kind, 'fault');
      assert.equal(action.faultClass, 'unclassified');
      assert.equal(action.at, row.at);
      const instance = installation.loop.state.faults.instances.find(entry => entry.subject === row.subject);
      assert.ok(instance, `one instance opened for ${row.subject}`);
      assert.equal(instance.kind, 'action:fault');
      assert.equal(instance.faultClass, 'unclassified');
      assert.equal(instance.text, row.text);
      assert.equal(instance.at, row.at);
      assert.equal(instance.linkedTo, null, 'on the base no class item stands yet, so nothing links');
      assert.ok(index === 0 || Date.parse(row.at) >= Date.parse(RECORDED[index - 1].at), 'the replay follows the recorded order');
    }
    assert.equal(installation.loop.state.faults.instances.length, 97, 'one instance per failing action key: the run of failures never ends inside the window');
    // The class crosses its threshold while the window is still opening: three instances stand at
    // 01:59:51, and the fourth recorded row (02:00:12.102Z) is the class's own filing refusing.
    const atCrossing = Date.parse('2026-10-17T02:00:12.102Z') - 1;
    const crossing = windowedUnlinked(installation.loop.state.faults.instances, 'unclassified', atCrossing, faultClassPolicyDefaults.windowHours);
    assert.equal(crossing.length, 3, 'exactly the threshold: the filing of the unclassified class fires here on the live loop');
    assert.equal(RECORDED[3].subject, 'fault:unclassified', 'and its refusal is the fourth recorded instance — the class that could not file itself');
    const atEnd = Date.parse(RECORDED.at(-1).at);
    const window = windowedUnlinked(installation.loop.state.faults.instances, 'unclassified', atEnd, faultClassPolicyDefaults.windowHours);
    assert.equal(window.length, 97, 'the full window holds 97 unlinked instances of the class');
    assert.ok(window.length >= faultClassPolicyDefaults.threshold, '97 ≥ 3 in 24 hours: the class the item was filed for');
    // Nothing else the loop did landed either: the plane filed no item and accepted no doctor run.
    assert.deepEqual(installation.filed, []);
    assert.deepEqual(installation.postedRuns, []);
  } finally {
    installation.close();
  }
});

test('integration:fault-class-unclassified the shared cause stands on the base: the running loop is bound to the settings it loaded, and its reload is refused by name', async () => {
  const installation = await stubInstallation();
  try {
    const live = liveMasterConfig(installation.loop.loaded, async () => JSON.parse(readFileSync(join(installation.root, '.graphyard', 'master.json'), 'utf8')));
    const reload = await live.reload();
    assert.deepEqual(masterConfigChanges(installation.loop.loaded, JSON.parse(readFileSync(join(installation.root, '.graphyard', 'master.json'), 'utf8'))).changed, ['cliPath', 'credentialFile'], 'the re-provisioning changed exactly the two recorded settings');
    assert.equal(reload.refused, '.graphyard/master.json changes cliPath, credentialFile, which a running master loop is bound to; restart master run to adopt them. Until then the loop keeps its loaded settings, including every other change');
    assert.equal(live.current.credentialFile, installation.loop.loaded.credentialFile, 'the refused reload keeps every loaded setting');
    // The loop's own record of the refusal (noteConfigReload): ONE escalation under the
    // configuration class — the loop's diagnosis of the window, never an unclassified row.
    const noted = noteConfigReload(installation.loop.state, reload);
    assert.equal(noted.length, 1);
    assert.equal(noted[0].faultClass, 'configuration');
    assert.equal(noted[0].detail, reload.refused);
    assert.equal(installation.loop.state.faults.instances.length, 1, 'the escalation opens its one configuration instance');
    assert.equal(installation.loop.state.faults.instances[0].faultClass, 'configuration', 'the recorded class gains none of it');
    // And with the cause standing, the write still refuses: the same sentence as the recorded rows.
    const action = await fileRecurringFaultClass(installation.loop.state, live.current, installation.plane, 'configuration', '2026-10-17T02:00:00.000Z');
    assert.equal(action.state, 'failed');
    assert.equal(action.detail, `Could not file the item for the recurring configuration fault class: Graphyard refused work (401): ${REFUSAL}`);
  } finally {
    installation.close();
  }
});

test('integration:fault-class-unclassified the candidate: the loop restarted onto the recorded settings, the same 97 writes land and not one instance recurs', async () => {
  const installation = await stubInstallation();
  try {
    // The completed re-provisioning (what the setup finished writing) and the master run restart
    // that ended the recorded window: the restarted loop reads the settings master.json records.
    installation.completeReprovision();
    installation.restartLoop();
    assert.equal(installation.loop.loaded.credentialFile, installation.freshConfig().credentialFile, 'the restarted loop reads the re-provisioned family master.json names');
    assert.equal(installation.loop.loaded.operatorAgent.credentialFile, installation.freshConfig().operatorAgent.credentialFile);
    const actions = await replay(installation);
    assert.equal(actions.length, 97);
    for (const action of actions) {
      assert.equal(action.state, 'done', action.detail);
      assert.equal(action.faultClass, undefined, 'a landed write carries no fault class');
    }
    assert.equal(installation.loop.state.faults.instances.length, 0, 'no fault instance at all: the recorded rows are the refused writes, and none is refused');
    assert.deepEqual(Object.keys(installation.loop.state.actions).filter(key => installation.loop.state.actions[key].state === 'failed'), []);
    // The three class filings the base could not make now land as items, the doctor runs post,
    // and the underlying filings file: the writes the window blocked all arrive.
    assert.equal(installation.filed.length, 50, '3 class items and 47 doctor filings');
    assert.ok(installation.filed.every(entry => /^GY-\d+$/.test(entry.key)));
    assert.equal(installation.postedRuns.length, 47);
    const atEnd = Date.parse(RECORDED.at(-1).at);
    const window = windowedUnlinked(installation.loop.state.faults.instances, 'unclassified', atEnd, faultClassPolicyDefaults.windowHours);
    assert.equal(window.length, 0, 'the class never crosses its threshold: 0 < 3');
    // While the loop held its stale settings, the credential-401 remedy (GY-1854) reads the
    // coordinator credential first and hands the case to the operator by name — the product's
    // own bound handling of the recorded window, in place of the silent per-write rows.
    const remedy = await renewHostCredentials(undefined, { coordinator: installation.staleCoordinatorCredential(), authenticate: file => authenticateWith(installation.plane, file) });
    assert.equal(remedy.outcome, 'refused');
    assert.equal(remedy.verified, false);
    assert.equal(remedy.detail, `The coordinator credential ${installation.staleCoordinatorCredential()} is refused (401): renewing it is outside the loop's authority; the operator rotates it (graphyard install --apply, or operator-agent rotate as admin)`);
  } finally {
    installation.close();
  }
});

test('integration:fault-class-unclassified the product handles the refused-credential case itself: up re-issues and restarts, and the write lands (GY-1851)', async () => {
  const installation = await stubInstallation();
  try {
    // The sibling shape of the recorded cause: the plane refuses the credentials master.json still
    // records (a fresh database behind a kept install directory). The loop's writes refuse the
    // same recorded way...
    writeFileSync(join(installation.root, '.graphyard', 'master.json'), JSON.stringify(installation.staleConfig(), null, 1));
    installation.restartLoop();
    const refused = await fileRecurringFaultClass(installation.loop.state, installation.loop.loaded, installation.plane, 'unclassified', '2026-10-17T02:00:12.102Z');
    assert.equal(refused.state, 'failed');
    assert.equal(refused.detail, `Could not file the item for the recurring unclassified fault class: Graphyard refused work (401): ${REFUSAL}`);
    // ...and `up` ends it: the status read refuses the recorded coordinator credential, the run
    // re-issues every credential and starts the loop on a fresh cursor, and the same write lands.
    const answers = await recordedCredentialAnswers(installation.root, installation.plane);
    assert.deepEqual(answers.filter(answer => answer.status === 401).map(answer => answer.identity), ['coordinator', 'operator-agent'], 'the recorded coordinator and operator-agent credentials draw the 401');
    const reissue = await upReissue(installation);
    assert.equal(reissue.reissued, true);
    assert.ok(reissue.note.startsWith('The control plane refused the recorded coordinator, operator-agent credential'), 'the run emits its re-issue note');
    assert.ok(reissue.note.includes('re-issues the coordinator, operator-agent and approver credentials and starts the master loop on a fresh cursor'));
    const landed = await fileRecurringFaultClass(installation.loop.state, installation.loop.loaded, installation.plane, 'unclassified', '2026-10-17T20:53:25.548Z');
    assert.equal(landed.state, 'done', 'the class item files — as GY-19 itself did at 2026-10-17T20:53:25Z, once writes landed');
    assert.equal(landed.work, 'GY-1');
    assert.equal(installation.loop.state.faults.instances.length, 1, 'only the pre-reissue refused row stands; the write after the re-issue opens none');
  } finally {
    installation.close();
  }
});

test('candidate condition, the live installation: the credentials master.json records authenticate against the plane', { skip: !existsSync(join(COORDINATOR, '.graphyard', 'master.json')) && `not on the coordinator host: ${COORDINATOR} holds no coordinator config` }, async () => {
  // The audit that fails while the recorded base state stands (as GY-36 made the observation
  // audit fail): a loop bound to a credential the plane refuses reads exactly the recorded 401.
  const master = JSON.parse(readFileSync(join(COORDINATOR, '.graphyard', 'master.json'), 'utf8'));
  const coordinator = await authenticateWith({ fetch: (path, init) => fetch(master.url.replace(/\/+$/, '') + path, init) }, master.credentialFile);
  assert.equal(coordinator.state, 'ok', `the coordinator credential ${master.credentialFile} is refused (${coordinator.detail}): the recorded base state stands`);
  assert.equal(coordinator.principal, 'cryptob1-graphyard-snake-v4-master');
  const operatorAgent = await authenticateWith({ fetch: (path, init) => fetch(master.url.replace(/\/+$/, '') + path, init) }, master.operatorAgent.credentialFile);
  assert.equal(operatorAgent.state, 'ok', `the operator-agent credential ${master.operatorAgent.credentialFile} is refused (${operatorAgent.detail}): the writes the loop makes would draw the recorded 401`);
  assert.equal(operatorAgent.principal, 'graphyard-master-graphyard-snake-v4-operator');
});

test('candidate condition, the live installation: the release the loop runs carries the 401 handling, and the live cursor holds no refused write', { skip: !existsSync(join(COORDINATOR, '.graphyard', 'master.json')) && `not on the coordinator host: ${COORDINATOR} holds no coordinator config` }, () => {
  const master = JSON.parse(readFileSync(join(COORDINATOR, '.graphyard', 'master.json'), 'utf8'));
  // The running release carries the machinery that handles the case itself: `up`'s credential
  // re-issue (GY-1851, src/up.ts recordedCredentialAnswers) and the credential-401 remedy
  // (GY-1854, src/daemon/step-stalls.ts renewHostCredentials).
  const checkout = dirname(dirname(master.cliPath));
  assert.ok(existsSync(master.cliPath), `the cliPath master.json names exists: ${master.cliPath}`);
  assert.ok(/export async function recordedCredentialAnswers/.test(readFileSync(join(checkout, 'src', 'up.ts'), 'utf8')), 'src/up.ts carries the GY-1851 credential re-issue read');
  assert.ok(/export async function renewHostCredentials/.test(readFileSync(join(checkout, 'src', 'daemon', 'step-stalls.ts'), 'utf8')), 'src/daemon/step-stalls.ts carries the GY-1854 credential-401 remedy');
  // The live cursor (derived from the coordinator credential, as the product derives it) holds no
  // refused write newer than the recorded window, and every unclassified instance carrying the
  // recorded refusal is inside the window and linked to this item: the cause produced none after
  // the restart.
  const cursor = join(dirname(master.credentialFile), `${basename(master.credentialFile).replace(/\.token$/, '')}.daemon.json`);
  const state = JSON.parse(readFileSync(cursor, 'utf8'));
  const refused401 = /Graphyard refused \S+ \(401\)/;
  const windowEnd = Date.parse('2026-10-17T10:37:46.503Z');
  for (const [key, action] of Object.entries(state.actions ?? {}))
    if (refused401.test(String(action.detail ?? '')))
      assert.ok(Date.parse(action.at) <= windowEnd, `no refused write postdates the recorded window: ${key} at ${action.at}`);
  const windowed = (state.faults?.instances ?? []).filter(instance => instance.faultClass === 'unclassified' && refused401.test(String(instance.text ?? '')));
  assert.ok(windowed.length > 0, 'the live cursor retains the recorded instances themselves');
  for (const instance of windowed) {
    assert.ok(Date.parse(instance.at) <= windowEnd, `no 401-refused unclassified instance postdates the recorded window: ${instance.subject} at ${instance.at}`);
    assert.equal(instance.linkedTo, 'GY-19', `the recorded instances are linked to this item: ${instance.subject}`);
  }
});

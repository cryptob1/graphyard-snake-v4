// GY-23 — fault class "resources": three instances in 24 hours (threshold 3), recorded by the
// master loop against the Graphyard installation that serves this repository. As GY-3 did for the
// configuration class, this file is the regression test the item's criterion asks for: each
// recorded instance is reproduced below against its recorded base state — the exact /tmp tree the
// host held at the recorded instant — and shown not to recur against the candidate condition, the
// state after the shared cause is removed. The last tests audit the live host, so a future
// instance of the class fails here instead of re-faulting the loop; CI has no access to that host
// and skips those audits.
//
// The recorded instances, one per loop cycle (~21 s apart), all with the same detail:
//
//   2026-10-17T21:09:45.419Z  action:reclaim  reclaim:resources:2026-10-17T21:09:45.391Z
//   2026-10-17T21:10:06.728Z  action:reclaim  reclaim:resources:2026-10-17T21:10:06.720Z
//   2026-10-17T21:10:27.812Z  action:reclaim  reclaim:resources:2026-10-17T21:10:27.808Z
//
//   "Resource reclaim: 1 could not be reclaimed: Tmp reclaim: /tmp/gy-tY0unUD: EACCES: permission
//   denied, rmdir '/tmp/gy-tY0unUD/graphyard-goal-compose-preview-ExM37A/worktrees'"
//
// The recorded base state, as the host held it at the first instant (verified by stat on the
// coordinator host before the remedy removed it):
//
//   /tmp/gy-tY0unUD                                              drwx-----T vish:vish   (uid 1000, mode 1700)
//   └─ graphyard-goal-compose-preview-ExM37A                     drwxr-xr-x nobody:nobody (uid 65534, mode 755)
//      └─ worktrees                                              drwxr-xr-x nobody:nobody
//         └─ merge-preview-gkiYgZ                                drwxr-xr-x nobody:nobody
//            └─ checkout                                         drwxr-xr-x nobody:nobody
//               └─ app                                          drwxr-xr-x nobody:nobody (empty)
//
//   mtimes: the interior tree 2026-10-17T18:50:55.280Z, the root 2026-10-17T19:09:13.344Z; the
//   root carries no `.owner` marker (it is ownerless to the pass), and nothing held it open.
//
// The timeline is the mechanism, exactly as the source's bounds produce it:
//
//   · 18:50:55Z — a containerized run of Graphyard's goal-compose-preview work (tests/helpers/
//     temp-dirs.ts `temporaryDirectory('goal-compose-preview')` makes `<tmpdir>/graphyard-goal-
//     compose-preview-*`; its Compose stack's merge preview makes `worktrees/merge-preview-*/`) ran
//     with its temporary directory bind-mounted from the host's /tmp/gy-tY0unUD. Every write the
//     container made appears on the host under the uid the container's user namespace maps to —
//     65534, `nobody` — so the whole interior tree belongs to a uid that is not the host user's.
//   · 19:09:13Z — the root's last write. The run ended without its after hook removing its
//     directory (tests/helpers/temp-dirs.ts disposes what it created — where it has permission).
//   · 21:09:13Z — the root passes the pass's bound for ownerless test-temp names:
//     src/tmp-reclaim.ts `testTempMinAgeMs` = 2 h over `/^gy-/` (`testTempPatterns`), judged by
//     `lastWritten` (the root's own mtime; its one entry is older).
//   · 21:09:45Z, 21:10:06Z, 21:10:27Z — three consecutive loop cycles; each cycle's /tmp reclaim
//     pass adopts the root and fails on it, recording one resources fault apiece. Three within
//     24 hours crosses the threshold and files this item (21:10:51Z).
//
// The cause the three share: the loop's /tmp reclaim pass adopts a whole ownerless, old, test-temp
// entry of this user and removes it as this user — but the entry's interior holds directories a
// containerized run created through another uid. Node's recursive rm stops at the first directory
// whose parent it cannot write — the shallowest foreign-owned directory — with `EACCES: permission
// denied, rmdir '…/worktrees'` (rmdir needs write on the parent, `nobody`'s 0755 gives the host
// user none, and the host user's supplementary `nobody` group membership grants nothing without a
// group-write bit). The pass's own repair, `makeOwnerWritable` (GY-1828), deliberately touches
// only directories this uid owns — a sticky world-writable root makes another user's entries
// theirs — so nothing is repaired, EACCES is not in the pass's retryable set, the removal fails,
// the entry joins the pass's `unfinished` set, and every later cycle adopts it again and records
// the same fault. No pass of this user can ever clear it: only the privilege that created the
// interior — a container of the same installation — can remove it. One leftover therefore faults
// the resources class on every cycle that reaches it, forever.
//
// The models below are faithful miniatures of that decision path, at the fidelity the recorded
// instances exercised; each cites the graphyard source it models (src/tmp-reclaim.ts and
// src/master-resources.ts of the running loop, and Node's own rimraf, whose message shape was
// verified against the live leftover before the remedy removed it). The candidate condition is
// the shared cause removed, twice over:
//
//   · the remedy, performed live on the coordinator host by this item's worker at
//     2026-10-17T22:26Z with the privilege that created the interior:
//
//       docker run --rm -v /tmp/gy-tY0unUD:/w alpine:latest rm -rf /w/graphyard-goal-compose-preview-ExM37A
//
//     after which the same pass removes the root whole on its next cycle and reports no error —
//     modelled below from the base tree, and audited live;
//   · the product handling the case itself: the run that creates the tree removes it while it
//     still holds the creating privilege (its own after hook, inside the container), so the pass
//     never meets a foreign-owned interior at all.
//
// The live audits confirm, on the coordinator host, that the recorded subject no longer holds
// what the pass cannot remove, and that no host tmp entry the pass would adopt (this user's,
// test-temp-named, past the 2 h bound) holds another uid's tree — so the class's precondition
// failing there fails this test first.
//
// GY-42 — the class's second recorded occurrence, one day later (2026-10-18): the identical
// mechanism through the other uid a containerized run's writes can show as. GY-23's remedy was
// live and one-off, and its candidate condition — the run that creates the tree removes it while
// it still holds the creating privilege — was never delivered on the product side, so the next
// containerized goal-compose-preview run (2026-10-17 20:02–20:07 -0700, session scratch root
// /tmp/gy-tBSJ6Su) ended at 20:07:05 without removing its tree and re-armed the class. The three
// recorded instances, one per cycle ~21 s apart, with the same EACCES refusal and, this time, the
// cycles' own context around it (what each cycle also reaped and freed, verbatim from the loop's
// resource-reclaims.json):
//
//   2026-10-18T05:07:42.973Z  action:reclaim  reclaim:resources:2026-10-18T05:07:42.973Z
//     "Resource reclaim: freed 2 MB from 51 stale /tmp entries; 1 could not be reclaimed: Tmp
//     reclaim: /tmp/gy-tBSJ6Su: EACCES: permission denied, rmdir '/tmp/gy-tBSJ6Su/graphyard-goal-
//     compose-preview-16DNmk/worktrees'"
//   2026-10-18T05:08:04.488Z  action:reclaim  reclaim:resources:2026-10-18T05:08:04.488Z
//     "Resource reclaim: reaped 1 review and 0 producer ledger record(s); 1 could not be
//     reclaimed: Tmp reclaim: /tmp/gy-tBSJ6Su: EACCES: permission denied, rmdir '/tmp/gy-tBSJ6Su/
//     graphyard-goal-compose-preview-16DNmk/worktrees'"
//   2026-10-18T05:08:25.241Z  action:reclaim  reclaim:resources:2026-10-18T05:08:25.241Z
//     "Resource reclaim: reaped 1 review and 0 producer ledger record(s); freed 1 MB from 1 stale
//     /tmp entry; 1 could not be reclaimed: Tmp reclaim: /tmp/gy-tBSJ6Su: EACCES: permission
//     denied, rmdir '/tmp/gy-tBSJ6Su/graphyard-goal-compose-preview-16DNmk/worktrees'"
//
// The recorded base state, as the item recorded it — its stat and journal name the creating uid 0;
// the host's own stat of the standing tree presented the interior as 65534:65534 `nobody`, the
// unmapped host-side view of a tree a containerized uid-0 run created and the same presentation
// GY-23's tree had. The pass refuses any uid that is not the host user's, so the recorded model
// below uses the recorded uid 0 and the live audits check uid, not which foreign uid it is:
//
//   /tmp/gy-tBSJ6Su                                              drwx-----T vish:vish   (uid 1000, mode 1700)
//   └─ graphyard-goal-compose-preview-16DNmk                     drwxr-xr-x 0:0      (uid 0, mode 755)
//      └─ worktrees                                              drwxr-xr-x 0:0
//         └─ merge-preview-HnxCiL                                drwxr-xr-x 0:0
//            └─ checkout                                         drwxr-xr-x 0:0
//               └─ app                                          drwxr-xr-x 0:0      (empty)
//
//   mtimes: the interior tree 2026-10-18T03:03:48.076Z, the root 2026-10-18T03:07:05.384Z (the
//   run's end); the pass's 2 h bound over the root crossed at 05:07:05.384Z, the first fault
//   37.6 s later, three within 24 h of GY-23's own three — the class re-armed.
//
// The remedy, again live and with the privilege that created the interior (this item's worker,
// 2026-10-18T05:23:07Z), exactly as GY-23's was:
//
//   docker run --rm -v /tmp/gy-tBSJ6Su:/w alpine:latest rm -rf /w/graphyard-goal-compose-preview-16DNmk
//
// after which every cycle's report records no 'could not be reclaimed' error again, and the root —
// empty, this user's own again, and in the pass's unfinished set since the first fault, which
// makes it due at once whatever its remedy-fresh mtime — was taken whole by a /tmp reclaim pass at
// 2026-10-18T05:32:46Z run with the loop's own module under the loop's own condition (the
// unfinished entry, and no holder: the state of the first cycle after the session whose command
// line named the path ends — which is also why the live pass had kept it until then: the pass's
// held-open rule keeps any entry a live process's command line names, kept without fault). No
// later cycle reports the entry: it is gone.
//
// The durable halves live where the product lives, and are recorded here for the operator that
// must run them: the containment — the pass settling a foreign-owned interior as another account's
// residue instead of faulting every cycle — is already merged on the product's main (GY-1967, PR
// #1339; this install's CLI predates it at 49665af8eb, PR #1338), so `graphyard upgrade --to` a
// dated release at or after that merge brings it here; and the creator-side teardown — the
// containerized run removing its scratch while it still holds the creating privilege, not only in
// its after hook on a clean end — is the product's own change, to be filed on its own control
// plane (the /home/vish/code/graphyard install). Both are operator acts by design: the upgrade
// moves the install's CLI checkout and restarts the loop and executors, and filing on another
// install's control plane needs that install's credential; a contained worker session holds
// neither, so this file records them instead of performing them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The file runs under Node's built-in test runner and needs no installed dependency: it imports
// only Node builtins and carries its own fixtures. (Plain JavaScript, like every other test of
// this repository; the GY-3 configuration twin is TypeScript only because that item planned one.)

// ---------------------------------------------------------------------------
// The recorded instants, subjects and detail, verbatim from the item.
// ---------------------------------------------------------------------------

/** The three recorded instances: the loop cycle's instant and the fault subject it was filed under. */
const INSTANCES = [
  { at: Date.parse('2026-10-17T21:09:45.419Z'), subject: 'reclaim:resources:2026-10-17T21:09:45.391Z' },
  { at: Date.parse('2026-10-17T21:10:06.728Z'), subject: 'reclaim:resources:2026-10-17T21:10:06.720Z' },
  { at: Date.parse('2026-10-17T21:10:27.812Z'), subject: 'reclaim:resources:2026-10-17T21:10:27.808Z' }
];

/** The detail every recorded instance carries, character for character. */
const RECORDED_DETAIL =
  "Resource reclaim: 1 could not be reclaimed: Tmp reclaim: /tmp/gy-tY0unUD: EACCES: permission denied, rmdir '/tmp/gy-tY0unUD/graphyard-goal-compose-preview-ExM37A/worktrees'";

/** The pass's error line for the entry, before the report prefixes it (src/tmp-reclaim.ts: `${path}: ${error.message}`). */
const RECORDED_PASS_ERROR =
  "/tmp/gy-tY0unUD: EACCES: permission denied, rmdir '/tmp/gy-tY0unUD/graphyard-goal-compose-preview-ExM37A/worktrees'";

/** The host user the loop's pass runs as, and the uid a containerized run's writes show as on the host. */
const HOST_UID = 1000, HOST_GID = 1000, CONTAINER_UID = 65534, CONTAINER_GID = 65534;

/** The recorded tree's paths and write times. */
const TMP_ROOT = '/tmp/gy-tY0unUD';
const INTERIOR = '/tmp/gy-tY0unUD/graphyard-goal-compose-preview-ExM37A';
const TMP_ROOT_MTIME = Date.parse('2026-10-17T19:09:13.344Z');
const INTERIOR_MTIME = Date.parse('2026-10-17T18:50:55.280Z');

// ---------------------------------------------------------------------------
// GY-42: the second recorded occurrence's instants, subjects, details, context and tree.
// ---------------------------------------------------------------------------

/** GY-42's three recorded instances: the reclaim report's instant, which the fault subject names (resource-reclaims.json, at 2026-10-18T05:07:42.973Z / 05:08:04.488Z / 05:08:25.241Z). */
const GY42_INSTANCES = [
  { at: Date.parse('2026-10-18T05:07:42.973Z'), subject: 'reclaim:resources:2026-10-18T05:07:42.973Z' },
  { at: Date.parse('2026-10-18T05:08:04.488Z'), subject: 'reclaim:resources:2026-10-18T05:08:04.488Z' },
  { at: Date.parse('2026-10-18T05:08:25.241Z'), subject: 'reclaim:resources:2026-10-18T05:08:25.241Z' }
];

/** The rm's own refusal at the shallowest foreign-owned directory, Node's message shape. */
const GY42_RECORDED_RM_ERROR =
  "EACCES: permission denied, rmdir '/tmp/gy-tBSJ6Su/graphyard-goal-compose-preview-16DNmk/worktrees'";
/** The pass's error line for the entry, before the report prefixes it (`${path}: ${error.message}`). */
const GY42_RECORDED_PASS_ERROR = `/tmp/gy-tBSJ6Su: ${GY42_RECORDED_RM_ERROR}`;

/** The detail each recorded instance carries, character for character — the cycle's own context (what it also reaped and freed) around the same refusal. */
const GY42_RECORDED_DETAILS = [
  `Resource reclaim: freed 2 MB from 51 stale /tmp entries; 1 could not be reclaimed: Tmp reclaim: ${GY42_RECORDED_PASS_ERROR}`,
  `Resource reclaim: reaped 1 review and 0 producer ledger record(s); 1 could not be reclaimed: Tmp reclaim: ${GY42_RECORDED_PASS_ERROR}`,
  `Resource reclaim: reaped 1 review and 0 producer ledger record(s); freed 1 MB from 1 stale /tmp entry; 1 could not be reclaimed: Tmp reclaim: ${GY42_RECORDED_PASS_ERROR}`
];

/** The uid the item recorded for this interior (its stat and journal name 0; the host presented the standing tree as 65534 `nobody` — see the header). */
const GY42_CONTAINER_UID = 0, GY42_CONTAINER_GID = 0;

/** GY-42's recorded tree: paths and write times. */
const GY42_TMP_ROOT = '/tmp/gy-tBSJ6Su';
const GY42_INTERIOR = '/tmp/gy-tBSJ6Su/graphyard-goal-compose-preview-16DNmk';
const GY42_TMP_ROOT_MTIME = Date.parse('2026-10-18T03:07:05.384Z');
const GY42_INTERIOR_MTIME = Date.parse('2026-10-18T03:03:48.076Z');

/** What else each recorded cycle's report holds (resource-reclaims.json, verbatim counts): the ledger records it reaped and the /tmp entries it removed elsewhere — the context the recorded detail lines carry around the refusal. */
const GY42_CYCLE_CONTEXT = [
  { reaped: { review: 0, producer: 0 }, otherRemoved: 51, otherBytes: 1_654_698 },
  { reaped: { review: 1, producer: 0 }, otherRemoved: 0, otherBytes: 0 },
  { reaped: { review: 1, producer: 0 }, otherRemoved: 1, otherBytes: 0 }
];

/** Both recordings' roots — GY-23's /tmp/gy-tY0unUD and GY-42's /tmp/gy-tBSJ6Su — each remedied live on the coordinator host. */
const RECORDED_ROOTS = [TMP_ROOT, GY42_TMP_ROOT];

/** The coordinator checkout whose `.graphyard/` holds the loop's records; absent on a CI runner. */
const COORDINATOR_ROOT = '/home/vish/code/graphyard-snake-v4';

// ---------------------------------------------------------------------------
// The pass's own constants, mirrored from src/tmp-reclaim.ts (the running loop's source).
// ---------------------------------------------------------------------------

/** `testTempPatterns` (GY-1074): the names test runs leave in the host's temporary directory. */
const TEST_TEMP_PATTERNS = [/^graphyard-/, /^gy-/, /^landing-merge-result/, /^native-/, /^pg-password/, /^playwright_chromiumdev_profile/];
/** `testTempMinAgeMs`: how old a test-temp entry must be before the pass removes it. */
const TEST_TEMP_MIN_AGE_MS = 2 * 3_600_000;
/** `tmpReclaimRetryMs`: how long one removal retries a tree that refills or is still being released (GY-1401). */
const TMP_RECLAIM_RETRY_MS = 2_000;
/** The codes `removeTree` retries (EACCES is not among them; its answer is the writable repair). */
const RETRYABLE = new Set(['ENOTEMPTY', 'EBUSY', 'EPERM', 'EMFILE', 'ENFILE']);
/** A tsx compile cache is never a whole-tree candidate whatever its name. */
const TSX_CACHE = /^tsx-\d+$/;
/** `hostTmpRoots` (GY-1368): this process's own tmpdir and /tmp, each once, in that order. */
const HOST_TMP_ROOTS = [tmpdir(), '/tmp'];

// ---------------------------------------------------------------------------
// A modelled filesystem: a Map of absolute path → { kind, mode, uid, gid, mtime }. A path the map
// omits does not exist. Children of a directory are the entries whose parent it is.
// ---------------------------------------------------------------------------

const parentOf = (path) => path.slice(0, path.lastIndexOf('/')) || '/';
const nameOf = (path) => path.slice(path.lastIndexOf('/') + 1);
/** The entries directly under `path`, in the order a readdir lists them. */
function childrenOf(fs, path) {
  return [...fs.keys()].filter((entry) => parentOf(entry) === path).sort();
}

/** An actor that touches the filesystem: the uid/gid its permission checks run as, and whether it holds `bypass` — root's DAC override inside its own user namespace over a filesystem it was given as a mount, which is how the container that created the recorded interior removed it where the host user cannot. */
const actor = (uid, gid, bypass = false) => ({ uid, gid, bypass });

/**
 * Whether `actor` may write `directory` (and so unlink or rmdir entries in it): the owner-write
 * bit for its owner, else the group-write bit for its group, else the other-write bit — the
 * kernel's rule the pass's rm answers to. A sticky bit on the directory changes nothing for a
 * directory the actor could already write; the recorded root's 1700 keeps it this user's alone.
 */
function writableBy(directory, who) {
  if (directory.uid === who.uid) return Boolean(directory.mode & 0o200);
  if (directory.gid === who.gid) return Boolean(directory.mode & 0o020);
  return Boolean(directory.mode & 0o002);
}

/** The coded error Node's rm surfaces, with the message shape the recorded detail carries. */
function errno(code, operation) {
  return Object.assign(new Error(`${code}: permission denied, ${operation}`), { code });
}

/**
 * Node's recursive rm over the model, at the fidelity the recorded instance exercised: it walks
 * depth-first, parents before children, and each directory's removal needs write on its parent —
 * so the first directory whose parent the actor cannot write fails as `EACCES … rmdir '<child>'`,
 * before anything beneath it is touched. (Verified against the live leftover: rm as the host user
 * on `…/worktrees/merge-preview-gkiYgZ/checkout` — whose parent is foreign-owned — fails with
 * `EACCES: permission denied, rmdir '…/checkout'`, and on the recorded root with the recorded
 * `…/worktrees` text.) `force` semantics: a path already gone is success, not an error.
 */
function modelledRm(fs, who, path) {
  const entry = fs.get(path);
  if (entry === undefined) return;
  const parent = fs.get(parentOf(path));
  if (!who.bypass && (parent === undefined || !writableBy(parent, who))) {
    throw errno('EACCES', `${entry.kind === 'directory' ? 'rmdir' : 'unlink'} '${path}'`);
  }
  if (entry.kind === 'directory') for (const child of childrenOf(fs, path)) modelledRm(fs, who, child);
  fs.delete(path);
}

/**
 * `makeOwnerWritable` (GY-1828), modelled: adds the owner-write bit to every directory under
 * `path` that `uid` owns — a stale entry holding a sandbox repository keeps `.git/worktrees/<name>`
 * mode 0555 — and deliberately touches nothing else. A directory another user owns is never
 * chmod'ed: on a sticky world-writable root it is theirs, and chmod would refuse it anyway. Answers
 * whether any mode changed, so a retry is worth the tree's read.
 */
function makeOwnerWritable(fs, uid, path) {
  let changed = false;
  const stack = [path];
  while (stack.length) {
    const directory = stack.pop();
    const entry = fs.get(directory);
    if (entry === undefined || entry.kind !== 'directory') continue;
    if (entry.uid === uid && !(entry.mode & 0o200)) {
      entry.mode |= 0o200;
      changed = true;
    }
    stack.push(...childrenOf(fs, directory));
  }
  return changed;
}

/**
 * A clock the removal's retry window reads: `now()` for the window's arithmetic, `tick()` for the
 * 10 ms the real retry sleeps between attempts.
 */
function tickingClock(startAtMs) {
  let at = startAtMs;
  return { now: () => at, tick: () => { at += 10; } };
}

/**
 * `removeTree` (src/tmp-reclaim.ts), modelled: rm, retrying while the tree refills or is still
 * being released for at most `retryMs`; a refusal read-only directories cause (`EACCES`, or the
 * `EPERM` some filesystems report) makes this user's own directories writable first and retries
 * inside the window — so an entry the pass owns is freed this pass instead of reported forever —
 * while foreign-owned directories change nothing and the error stands, as GY-1828's boundary.
 */
function removeTree(fs, who, path, clock, retryMs = TMP_RECLAIM_RETRY_MS) {
  const until = clock.now() + retryMs;
  for (;;) {
    try {
      return modelledRm(fs, who, path);
    } catch (error) {
      const code = error.code ?? '';
      const repaired = code === 'EACCES' || code === 'EPERM' ? makeOwnerWritable(fs, who.uid, path) : false;
      if ((!RETRYABLE.has(code) && !repaired) || clock.now() >= until) throw error;
      clock.tick();
    }
  }
}

/**
 * `lastWritten` (src/tmp-reclaim.ts): when a directory was last written — its own mtime, or the
 * newest of its direct entries' when later. The pass judges a test-temp entry's age by this.
 */
function lastWritten(fs, path) {
  const own = fs.get(path)?.mtime ?? 0;
  return Math.max(own, ...childrenOf(fs, path).map((child) => fs.get(child)?.mtime ?? 0));
}

/**
 * One /tmp reclaim pass over `root`, the `reclaimRoot` miniature at the fidelity the recorded
 * instances exercised (src/tmp-reclaim.ts): only this user's entries, only test-temp names (never
 * a marker, never a tsx cache), an ownerless directory removed once past `TEST_TEMP_MIN_AGE_MS`
 * and held by no live process; an entry an earlier pass began removing is due at once, whatever
 * its age, which is how one failed removal returns every cycle. Answers the pass's report:
 * `removed` paths, `kept` count and `errors` — each error exactly `${path}: ${message}`.
 */
function reclaimPass({ fs, root = '/tmp', who, now, clock, held = new Set(), unfinished = new Set() }) {
  const report = { removed: [], kept: 0, errors: [] };
  for (const path of childrenOf(fs, root)) {
    const name = nameOf(path);
    const entry = fs.get(path);
    if (name.endsWith('.owner') || TSX_CACHE.test(name) || !TEST_TEMP_PATTERNS.some((pattern) => pattern.test(name))) continue;
    if (entry.uid !== who.uid) continue; // another user's entry is theirs to clear
    if (held.has(path)) { report.kept++; continue; } // a live process holds it open or names it
    if (!unfinished.has(path) && now - lastWritten(fs, path) < TEST_TEMP_MIN_AGE_MS) { report.kept++; continue; }
    try {
      removeTree(fs, who, path, clock);
      unfinished.delete(path);
      report.removed.push(path);
    } catch (error) {
      unfinished.add(path);
      report.errors.push(`${path}: ${error.message}`);
    }
  }
  return report;
}

/** `describeTmpReclaim` (src/tmp-reclaim.ts): what a pass gave back; null when it removed nothing. */
function describeTmpReclaim(removed, bytes) {
  if (!removed) return null;
  const gb = bytes / 1e9;
  return `freed ${gb >= 0.1 ? `${gb.toFixed(1)} GB` : `${Math.max(1, Math.round(bytes / 1e6))} MB`} from ${removed} stale /tmp entr${removed === 1 ? 'y' : 'ies'}`;
}

/**
 * `describeReclaim` (src/master-resources.ts): one line for the loop's action record. The /tmp
 * pass's own errors are already prefixed `Tmp reclaim: ` by the report that gathered them
 * (`tmpErrorPrefix`, master-resources.ts), so the first surfaces as
 * `Resource reclaim: N could not be reclaimed: Tmp reclaim: <path>: <message>` — the recorded text.
 * GY-42's recorded details also carry the cycle's own context — the ledger records the same cycle
 * reaped (`reaped N review and M producer ledger record(s)`) before the /tmp pass's part — so the
 * model carries a report's `reaped` counts the same way (no recorded instance of this class closed
 * or released a session, so those parts stay unmodelled and empty).
 */
function describeReclaim(report) {
  const reaped = report.reaped ?? { review: 0, producer: 0 };
  const parts = [
    reaped.review || reaped.producer ? `reaped ${reaped.review} review and ${reaped.producer} producer ledger record(s)` : '',
    describeTmpReclaim(report.removed.length, report.bytes ?? 0),
    report.errors.length ? `${report.errors.length} could not be reclaimed: ${report.errors[0]}` : ''
  ].filter(Boolean);
  return parts.length ? `Resource reclaim: ${parts.join('; ')}` : null;
}

/** The report the loop's cycle gathers from the pass (master-resources.ts: errors prefixed `Tmp reclaim: `). */
function cycleReport(pass) {
  return { removed: pass.removed, bytes: 0, errors: pass.errors.map((error) => `Tmp reclaim: ${error}`) };
}

/** The report a GY-42 cycle gathers: the pass's own outcome beside the cycle's recorded context — what the same cycle reaped and removed elsewhere, as resource-reclaims.json holds it — so the line the model builds is the line the loop recorded. */
function gy42CycleReport(pass, context) {
  const others = Array.from({ length: context.otherRemoved }, (_, index) => `<the cycle's other stale /tmp entry ${index + 1}>`);
  return { reaped: context.reaped, removed: [...pass.removed, ...others], bytes: context.otherBytes, errors: pass.errors.map((error) => `Tmp reclaim: ${error}`) };
}

// ---------------------------------------------------------------------------
// The fixtures: the recorded base state, and the candidate conditions.
// ---------------------------------------------------------------------------

/**
 * The recorded base tree: the host's /tmp holding exactly what the recorded instant held — the
 * world-writable sticky /tmp, this user's ownerless 1700 `gy-` root last written 19:09:13.344Z,
 * and beneath it the whole container-created `graphyard-goal-compose-preview-ExM37A` interior,
 * uid 65534 mode 0755, written 18:50:55.280Z and never removed by the run that made it.
 */
function recordedBaseTree() {
  const fs = new Map();
  fs.set('/tmp', { kind: 'directory', mode: 0o1777, uid: 0, gid: 0, mtime: 0 });
  fs.set(TMP_ROOT, { kind: 'directory', mode: 0o1700, uid: HOST_UID, gid: HOST_GID, mtime: TMP_ROOT_MTIME });
  for (const path of [
    INTERIOR,
    `${INTERIOR}/worktrees`,
    `${INTERIOR}/worktrees/merge-preview-gkiYgZ`,
    `${INTERIOR}/worktrees/merge-preview-gkiYgZ/checkout`,
    `${INTERIOR}/worktrees/merge-preview-gkiYgZ/checkout/app`
  ]) {
    fs.set(path, { kind: 'directory', mode: 0o755, uid: CONTAINER_UID, gid: CONTAINER_GID, mtime: INTERIOR_MTIME });
  }
  return fs;
}

/**
 * The remedy, modelled as it was performed live on the coordinator host — GY-23's at
 * 2026-10-17T22:26Z, GY-42's at 2026-10-18T05:23:07Z — the interior removed with the privilege
 * that created it: a container of the same installation, given the root as its mount, whose uid
 * owns every directory of the interior and whose root holds the override the host user lacks
 * (verified live both times: the container's rm succeeded where the host user's failed with the
 * recorded EACCES), `docker run --rm -v <root>:/w alpine:latest rm -rf /w/<name>`. The root itself
 * is left for the pass, which is the point: the candidate is judged by the pass.
 */
function removeWithCreatingPrivilege(fs, path, uid = CONTAINER_UID, gid = CONTAINER_GID) {
  modelledRm(fs, actor(uid, gid, true), path);
}

/** The base tree after the remedy: the foreign-owned interior gone, the root still the pass's to take. */
function remediedTree() {
  const fs = recordedBaseTree();
  removeWithCreatingPrivilege(fs, INTERIOR);
  return fs;
}

/**
 * GY-42's recorded base tree: the same host /tmp, this user's ownerless 1700 `gy-` root last
 * written 2026-10-18T03:07:05.384Z, and beneath it the whole container-created
 * `graphyard-goal-compose-preview-16DNmk` interior, uid 0 mode 0755, written 03:03:48.076Z and
 * never removed by the run that made it.
 */
function gy42BaseTree() {
  const fs = new Map();
  fs.set('/tmp', { kind: 'directory', mode: 0o1777, uid: 0, gid: 0, mtime: 0 });
  fs.set(GY42_TMP_ROOT, { kind: 'directory', mode: 0o1700, uid: HOST_UID, gid: HOST_GID, mtime: GY42_TMP_ROOT_MTIME });
  for (const path of [
    GY42_INTERIOR,
    `${GY42_INTERIOR}/worktrees`,
    `${GY42_INTERIOR}/worktrees/merge-preview-HnxCiL`,
    `${GY42_INTERIOR}/worktrees/merge-preview-HnxCiL/checkout`,
    `${GY42_INTERIOR}/worktrees/merge-preview-HnxCiL/checkout/app`
  ]) {
    fs.set(path, { kind: 'directory', mode: 0o755, uid: GY42_CONTAINER_UID, gid: GY42_CONTAINER_GID, mtime: GY42_INTERIOR_MTIME });
  }
  return fs;
}

/** GY-42's base tree after the live remedy (2026-10-18T05:23:07Z): the interior removed with the privilege that created it, the root left for the pass. */
function gy42RemediedTree() {
  const fs = gy42BaseTree();
  removeWithCreatingPrivilege(fs, GY42_INTERIOR, GY42_CONTAINER_UID, GY42_CONTAINER_GID);
  return fs;
}

/**
 * GY-42's base tree had the run's own teardown removed the interior before it ended: the
 * creator-side candidate, still undelivered on the product (see the header) — the run removes its
 * directory from where it made it, with the creating privilege, so the interior never outlives it.
 */
function gy42TornDownTree(removedAtMs) {
  const fs = gy42BaseTree();
  const clock = tickingClock(removedAtMs);
  removeTree(fs, actor(GY42_CONTAINER_UID, GY42_CONTAINER_GID, true), GY42_INTERIOR, clock);
  return fs;
}

/**
 * The run's own teardown, modelled: the goal-compose-preview run's after hook
 * (tests/helpers/temp-dirs.ts `disposeTemporaryDirectories`) removes its directory before the
 * sandbox ends — from where it was made, with the creating privilege, so it succeeds. The interior
 * never outlives the run, and the pass never meets a foreign-owned tree at all.
 */
function tornDownTree(removedAtMs) {
  const fs = recordedBaseTree();
  const container = actor(CONTAINER_UID, CONTAINER_GID, true);
  const clock = tickingClock(removedAtMs);
  removeTree(fs, container, INTERIOR, clock);
  return fs;
}

/**
 * The already-working repair path this fault is not (GY-1828): an entry of this user's whose own
 * directories were left read-only — a sandbox repository's 0555 `.git/worktrees/<name>` — is made
 * writable by the pass itself and freed the same pass, never reported.
 */
function readonlyOwnTree() {
  const fs = new Map();
  fs.set('/tmp', { kind: 'directory', mode: 0o1777, uid: 0, gid: 0, mtime: 0 });
  const at = Date.parse('2026-10-17T18:00:00.000Z');
  fs.set('/tmp/graphyard-sandbox-repo-ab12Cd', { kind: 'directory', mode: 0o755, uid: HOST_UID, gid: HOST_GID, mtime: at });
  for (const path of ['/tmp/graphyard-sandbox-repo-ab12Cd/.git', '/tmp/graphyard-sandbox-repo-ab12Cd/.git/worktrees', '/tmp/graphyard-sandbox-repo-ab12Cd/.git/worktrees/voice615']) {
    fs.set(path, { kind: 'directory', mode: path.endsWith('/voice615') ? 0o555 : 0o755, uid: HOST_UID, gid: HOST_GID, mtime: at });
  }
  return fs;
}

// ---------------------------------------------------------------------------
// The recorded instances, reproduced against the base.
// ---------------------------------------------------------------------------

test('the bound holds the fault until 21:09:13Z: a pass before then keeps the entry and records nothing', () => {
  const fs = recordedBaseTree();
  const who = actor(HOST_UID, HOST_GID);
  // 21:08:45Z — before the 2 h bound over the root's 19:09:13.344Z last write crossed. The first
  // recorded instance is 32 s past the bound: cycles between the two may have spent the pass's
  // per-cycle limit on older entries first (the loop's reports of the hour show passes removing
  // the 100-per-cycle cap of older tsx-cache entries), so the entry faults on the cycles that
  // reach it — 21:09:45Z, then every ~21 s after, which is the recurrence this item counts.
  const before = Date.parse('2026-10-17T21:08:45.000Z');
  const pass = reclaimPass({ fs, who, now: before, clock: tickingClock(before) });
  assert.equal(pass.kept, 1, 'the ownerless root is kept: younger than the 2 h test-temp bound');
  assert.deepEqual(pass.removed, []);
  assert.deepEqual(pass.errors, []);
  assert.equal(describeReclaim(cycleReport(pass)), null, 'no action line, so no attention and no fault');
  assert.ok(fs.has(INTERIOR), 'the tree is untouched');
});

test('instance 2026-10-17T21:09:45.419Z action:reclaim on reclaim:resources:2026-10-17T21:09:45.391Z: the pass adopts the root at its bound and fails on the foreign-owned interior', () => {
  const fs = recordedBaseTree();
  const who = actor(HOST_UID, HOST_GID);
  const pass = reclaimPass({ fs, who, now: INSTANCES[0].at, clock: tickingClock(INSTANCES[0].at) });
  assert.deepEqual(pass.errors, [RECORDED_PASS_ERROR], 'the pass error line, character for character');
  assert.deepEqual(pass.removed, [], 'nothing was removed');
  assert.equal(pass.kept, 0);
  assert.ok(fs.has(`${INTERIOR}/worktrees/merge-preview-gkiYgZ/checkout/app`), 'the interior is untouched: rm stopped at the first foreign-owned parent');
  // The report the cycle gathers, and the action line it records — the recorded detail, exactly.
  const report = cycleReport(pass);
  assert.deepEqual(report.errors, [`Tmp reclaim: ${RECORDED_PASS_ERROR}`]);
  assert.equal(describeReclaim(report), RECORDED_DETAIL);
});

test('instances 21:10:06.728Z and 21:10:27.812Z: the failed removal returns every later cycle — the recurrence the class counts', () => {
  const fs = recordedBaseTree();
  const who = actor(HOST_UID, HOST_GID);
  // One pass per recorded cycle, sharing the pass's `unfinished` set as the loop's process does:
  // the first failure adds the entry to it, and each later pass adopts the entry again at once.
  const unfinished = new Set();
  const details = INSTANCES.map((instance) => {
    const pass = reclaimPass({ fs, who, now: instance.at, clock: tickingClock(instance.at), unfinished });
    return describeReclaim(cycleReport(pass));
  });
  assert.deepEqual(details, [RECORDED_DETAIL, RECORDED_DETAIL, RECORDED_DETAIL], 'three cycles, three identical faults: the threshold crossed');
  assert.ok(unfinished.has(TMP_ROOT), 'the entry is still unfinished: the next cycle would fault again');
  assert.ok(fs.has(INTERIOR), 'no pass removed anything: the cause stands outside the reach of the pass');
});

test('the shared cause: rm stops at the first foreign-owned parent, and the pass\'s own repair (GY-1828) deliberately leaves another uid\'s directories alone', () => {
  const fs = recordedBaseTree();
  const who = actor(HOST_UID, HOST_GID);
  // The repair the pass tries first changes nothing here: every directory missing the owner-write
  // bit belongs to another uid, and makeOwnerWritable never chmods those.
  assert.equal(makeOwnerWritable(fs, HOST_UID, TMP_ROOT), false);
  // rm as the host user fails at the shallowest foreign-owned parent, before touching anything.
  assert.throws(() => modelledRm(fs, who, TMP_ROOT), (error) => {
    assert.equal(error.code, 'EACCES');
    assert.equal(error.message, "EACCES: permission denied, rmdir '/tmp/gy-tY0unUD/graphyard-goal-compose-preview-ExM37A/worktrees'");
    return true;
  });
  // The contrast, which is the boundary of the cause: this user's own read-only directories are
  // repaired and the entry freed the same pass — never reported, let alone every cycle.
  const own = readonlyOwnTree();
  const pass = reclaimPass({ fs: own, who, now: Date.parse('2026-10-17T21:09:45.419Z'), clock: tickingClock(Date.parse('2026-10-17T21:09:45.419Z')) });
  assert.deepEqual(pass.errors, []);
  assert.deepEqual(pass.removed, ['/tmp/graphyard-sandbox-repo-ab12Cd']);
  assert.equal(own.has('/tmp/graphyard-sandbox-repo-ab12Cd'), false);
});

// ---------------------------------------------------------------------------
// The candidate: the same passes, the shared cause removed.
// ---------------------------------------------------------------------------

test('the candidate, remedy applied: the interior removed with the privilege that created it — the pass reclaims the root whole and no later cycle faults', () => {
  const fs = remediedTree();
  const who = actor(HOST_UID, HOST_GID);
  const unfinished = new Set();
  const reports = INSTANCES.map((instance) => cycleReport(reclaimPass({ fs, who, now: instance.at, clock: tickingClock(instance.at), unfinished })));
  // The first cycle that reaches the root takes it whole; the recorded instants record no fault.
  assert.deepEqual(reports[0].removed, [TMP_ROOT]);
  assert.deepEqual(reports[0].errors, []);
  assert.ok(!describeReclaim(reports[0]).includes('could not be reclaimed'), 'no fault line on the cycle that reclaimed it');
  assert.deepEqual(reports[1], { removed: [], bytes: 0, errors: [] }, 'nothing left to adopt');
  assert.deepEqual(reports[2], { removed: [], bytes: 0, errors: [] }, 'and none the cycle after: no recurrence');
  assert.equal(fs.has(TMP_ROOT), false, 'the root is gone');
  assert.equal(unfinished.size, 0);
});

test('the candidate, the product handles the case itself: the run that created the tree removes it while it still holds the creating privilege', () => {
  // The goal-compose-preview run's after hook, running where the tree was made: it has permission
  // (its uid owns every directory), so the removal succeeds — before the sandbox ends, hours
  // before the pass would ever meet the entry. Modelled from the base at the run's end, 19:11Z.
  const fs = tornDownTree(Date.parse('2026-10-17T19:11:00.000Z'));
  assert.equal(fs.has(INTERIOR), false, 'the teardown removed its own directory');
  const who = actor(HOST_UID, HOST_GID);
  const unfinished = new Set();
  const reports = INSTANCES.map((instance) => cycleReport(reclaimPass({ fs, who, now: instance.at, clock: tickingClock(instance.at), unfinished })));
  assert.deepEqual(reports[0].removed, [TMP_ROOT], 'the pass still takes the root at its bound — whole, and with no error');
  for (const report of reports) assert.deepEqual(report.errors, []);
  assert.equal(fs.has(TMP_ROOT), false);
});

// ---------------------------------------------------------------------------
// GY-42: the second occurrence — the same mechanism through uid 0, reproduced against its own
// recorded base and shown not to recur against the remedied and torn-down candidates.
// ---------------------------------------------------------------------------

test('GY-42: the bound holds the fault until 05:07:05Z: a pass before then keeps the entry and records nothing', () => {
  const fs = gy42BaseTree();
  const who = actor(HOST_UID, HOST_GID);
  // 05:06:30Z — before the 2 h bound over the root's 03:07:05.384Z last write crossed. The first
  // recorded instance is 37.6 s past the bound: the cycles between may have spent the pass's
  // per-cycle limit on older entries first (the loop's reports of the hour show passes removing
  // the 100-per-cycle cap of tsx-cache entries), so the entry faults on the cycles that reach it —
  // 05:07:42Z, then every ~21 s after, which is the recurrence this item counts.
  const before = Date.parse('2026-10-18T05:06:30.000Z');
  const pass = reclaimPass({ fs, who, now: before, clock: tickingClock(before) });
  assert.equal(pass.kept, 1, 'the ownerless root is kept: younger than the 2 h test-temp bound');
  assert.deepEqual(pass.removed, []);
  assert.deepEqual(pass.errors, []);
  assert.equal(describeReclaim(cycleReport(pass)), null, 'no action line, so no attention and no fault');
  assert.ok(fs.has(GY42_INTERIOR), 'the tree is untouched');
});

test('GY-42 instance 2026-10-18T05:07:42.973Z on reclaim:resources:2026-10-18T05:07:42.973Z: the pass adopts the root at its bound and fails on the foreign-owned interior', () => {
  const fs = gy42BaseTree();
  const who = actor(HOST_UID, HOST_GID);
  const pass = reclaimPass({ fs, who, now: GY42_INSTANCES[0].at, clock: tickingClock(GY42_INSTANCES[0].at) });
  assert.deepEqual(pass.errors, [GY42_RECORDED_PASS_ERROR], 'the pass error line, character for character');
  assert.deepEqual(pass.removed, [], 'nothing of the entry was removed');
  assert.equal(pass.kept, 0);
  assert.ok(fs.has(`${GY42_INTERIOR}/worktrees/merge-preview-HnxCiL/checkout/app`), 'the interior is untouched: rm stopped at the first foreign-owned parent');
  // The report the cycle gathers — the entry's refusal beside the cycle's own recorded context —
  // is the recorded detail, exactly.
  assert.equal(describeReclaim(gy42CycleReport(pass, GY42_CYCLE_CONTEXT[0])), GY42_RECORDED_DETAILS[0]);
});

test("GY-42 instances 05:08:04.488Z and 05:08:25.241Z: the failed removal returns every later cycle — the recurrence the class counts", () => {
  const fs = gy42BaseTree();
  const who = actor(HOST_UID, HOST_GID);
  // One pass per recorded cycle, sharing the pass's `unfinished` set as the loop's process does:
  // the first failure adds the entry to it, and each later pass adopts the entry again at once —
  // each cycle recording the same refusal inside its own context line.
  const unfinished = new Set();
  const details = GY42_INSTANCES.map((instance, index) => {
    const pass = reclaimPass({ fs, who, now: instance.at, clock: tickingClock(instance.at), unfinished });
    return describeReclaim(gy42CycleReport(pass, GY42_CYCLE_CONTEXT[index]));
  });
  assert.deepEqual(details, GY42_RECORDED_DETAILS, 'three cycles, three faults with their cycles\u2019 own context: the threshold crossed');
  assert.ok(unfinished.has(GY42_TMP_ROOT), 'the entry is still unfinished: the next cycle would fault again');
  assert.ok(fs.has(GY42_INTERIOR), 'no pass removed anything: the cause stands outside the reach of the pass');
});

test("GY-42 the shared cause: rm stops at the first foreign-owned parent, and the pass's own repair (GY-1828) deliberately leaves another uid's directories alone", () => {
  const fs = gy42BaseTree();
  const who = actor(HOST_UID, HOST_GID);
  // The repair the pass tries first changes nothing here: every directory missing the owner-write
  // bit belongs to uid 0, and makeOwnerWritable never chmods another uid's.
  assert.equal(makeOwnerWritable(fs, HOST_UID, GY42_TMP_ROOT), false);
  // rm as the host user fails at the shallowest foreign-owned parent, before touching anything.
  assert.throws(() => modelledRm(fs, who, GY42_TMP_ROOT), (error) => {
    assert.equal(error.code, 'EACCES');
    assert.equal(error.message, GY42_RECORDED_RM_ERROR);
    return true;
  });
});

test('GY-42 the candidate, remedy applied: the interior removed with the privilege that created it — the pass reclaims the root whole and no later cycle faults', () => {
  const fs = gy42RemediedTree();
  const who = actor(HOST_UID, HOST_GID);
  const unfinished = new Set();
  const passes = GY42_INSTANCES.map((instance) => reclaimPass({ fs, who, now: instance.at, clock: tickingClock(instance.at), unfinished }));
  // The first cycle that reaches the root takes it whole; the recorded instants record no fault.
  assert.deepEqual(passes[0].removed, [GY42_TMP_ROOT]);
  assert.deepEqual(passes[0].errors, []);
  for (const [index, pass] of passes.entries())
    assert.ok(!describeReclaim(gy42CycleReport(pass, GY42_CYCLE_CONTEXT[index])).includes('could not be reclaimed'), `no fault line on cycle ${index + 1}`);
  assert.deepEqual(passes[1].removed, [], 'nothing left to adopt');
  assert.deepEqual(passes[2].removed, [], 'and none the cycle after: no recurrence');
  assert.equal(fs.has(GY42_TMP_ROOT), false, 'the root is gone');
  assert.equal(unfinished.size, 0);
});

test('GY-42 the candidate, the product handles the case itself: the run that created the tree removes it while it still holds the creating privilege', () => {
  // The goal-compose-preview run's after hook, running where the tree was made: its uid owns every
  // directory, so the removal succeeds — before the run ends, hours before the pass would ever
  // meet the entry. Modelled from the base at the run's end, 03:07:30Z. This is the half GY-23's
  // item named as its candidate condition and never had delivered; until the product delivers it,
  // every containerized run's abnormal end re-arms this class (the live audits below stand guard).
  const fs = gy42TornDownTree(Date.parse('2026-10-18T03:07:30.000Z'));
  assert.equal(fs.has(GY42_INTERIOR), false, 'the teardown removed its own directory');
  const who = actor(HOST_UID, HOST_GID);
  const unfinished = new Set();
  const passes = GY42_INSTANCES.map((instance) => reclaimPass({ fs, who, now: instance.at, clock: tickingClock(instance.at), unfinished }));
  assert.deepEqual(passes[0].removed, [GY42_TMP_ROOT], 'the pass still takes the root at its bound — whole, and with no error');
  for (const pass of passes) assert.deepEqual(pass.errors, []);
  assert.equal(fs.has(GY42_TMP_ROOT), false);
});

// ---------------------------------------------------------------------------
// The live audits: on the coordinator host, where the recorded tree stood. A CI runner checks out
// this repository with no access to that host, so both audits skip there; the reproduction and
// candidate tests above still run everywhere.
// ---------------------------------------------------------------------------

/** The entries of `directory`, or none when it cannot be read. The audits walk exactly the entries the running loop's reclaim pass deletes every ~21 s on this host — this user's, test-temp-named, past the 2 h bound — so a directory an audit has just seen can be gone before it is read; a read that faults there faults the audit itself, which is the race the post-merge review filed (GY-33). */
function readdirOrNone(directory) {
  try { return readdirSync(directory); } catch { return null; } // removed while auditing: gone with the pass that reclaimed it
}

/** Every entry under `path`, breadth-bounded: the recorded class's trees are a handful deep, and a bounded walk never lets a pathological tree stall the audit. */
function treeEntries(path, bound = 10_000) {
  const found = [];
  const stack = [path];
  while (stack.length && found.length < bound) {
    const directory = stack.pop();
    const names = readdirOrNone(directory);
    if (!names) continue; // removed while walking: the audit folds it away, it does not fault
    for (const name of names) {
      const entry = `${directory === '/' ? '' : directory}/${name}`;
      let info;
      try { info = statSync(entry); } catch { continue; } // removed while walking
      found.push({ path: entry, uid: info.uid });
      if (info.isDirectory()) stack.push(entry);
    }
  }
  return found;
}

test(
  'live audit on the coordinator host: the recorded subjects no longer hold what the pass cannot remove',
  { skip: !existsSync(COORDINATOR_ROOT) && `not on the coordinator host: ${COORDINATOR_ROOT} is absent` },
  () => {
    // Both recordings' roots — GY-23's /tmp/gy-tY0unUD and GY-42's /tmp/gy-tBSJ6Su — each remedied
    // live and then taken whole by the pass.
    for (const recorded of RECORDED_ROOTS) {
      if (!existsSync(recorded)) continue; // gone: the pass reclaimed the root whole after the remedy
      // Still present (the audit runs between the remedy and the pass's next reach): every entry in
      // its tree must be this user's again, so the pass removes it whole — no fault can recur on it.
      const foreign = treeEntries(recorded).filter((entry) => entry.uid !== process.getuid());
      assert.deepEqual(foreign.map((entry) => entry.path), [],
        `another uid's directories inside ${recorded} are what faulted the resources class on every cycle: remove them with the privilege that created them — docker run --rm -v ${recorded}:/w alpine:latest rm -rf /w/<name> — leaving the pass to take the root`);
    }
  }
);

test(
  'live audit on the coordinator host: no host tmp entry the pass would adopt holds another uid\'s tree',
  { skip: !existsSync(COORDINATOR_ROOT) && `not on the coordinator host: ${COORDINATOR_ROOT} is absent` },
  () => {
    // The pass adopts this user's test-temp-named entries in its tmp roots once past the 2 h bound
    // (hostTmpRoots: this process's tmpdir and /tmp, each once). Each such entry must hold nothing
    // another uid created — the class's precondition — or the pass faults on it every cycle it is
    // reached, exactly as the recorded root did. Bound the audit as the pass bounds itself.
    const roots = [...new Set(HOST_TMP_ROOTS.map((root) => { try { return realpathSync(root); } catch { return root; } }))];
    const offenders = [];
    for (const root of roots) {
      let names;
      try { names = readdirSync(root); } catch { continue; }
      for (const name of names) {
        if (name.endsWith('.owner') || TSX_CACHE.test(name) || !TEST_TEMP_PATTERNS.some((pattern) => pattern.test(name))) continue;
        const path = `${root}/${name}`;
        let info;
        try { info = statSync(path); } catch { continue; }
        if (!info.isDirectory() || info.uid !== process.getuid()) continue; // only this user's entries are the pass's
        const children = readdirOrNone(path);
        if (!children) continue; // removed while auditing: no longer the pass's to fault
        const written = Math.max(info.mtimeMs, ...children.map((entry) => { try { return statSync(`${path}/${entry}`).mtimeMs; } catch { return 0; } }));
        if (Date.now() - written < TEST_TEMP_MIN_AGE_MS) continue; // younger than the bound: kept, not adopted
        const foreign = treeEntries(path).find((entry) => entry.uid !== process.getuid());
        if (foreign) offenders.push(`${path} (held by uid ${foreign.uid}: ${foreign.path})`);
      }
    }
    assert.deepEqual(offenders, [],
      'each of these entries faults the resources class on every cycle the pass reaches it, and no pass of this user can clear it: remove the foreign-owned tree inside each with the privilege that created it — docker run --rm -v <entry>:/w alpine:latest rm -rf /w/<name> — and have the run that creates such trees remove them before it ends');
  }
);

// ---------------------------------------------------------------------------
// The post-merge follow-up (GY-33): the audits above called `readdirSync` without a guard —
// `treeEntries` and the age check — so the very race they audit, the running loop's pass deleting
// this user's test-temp entries, could fault the audit itself and fail the file spuriously. Every
// directory read the audits make now goes through `readdirOrNone`, and this case pins that.
// ---------------------------------------------------------------------------

test('unit:post-merge-follow-up-1 the audits survive the pass reclaiming an entry under them: every directory they read is guarded, and a tree that stands still walks whole', () => {
  // The recorded race, made deterministic: an entry the audit has just statSynced is removed before
  // it is read — the base's unguarded read faults exactly there, taking the whole audit down with it.
  const gone = mkdtempSync(join(tmpdir(), 'gy-33-audit-race-'));
  rmSync(gone, { recursive: true, force: true });
  assert.equal(existsSync(gone), false);
  assert.throws(() => readdirSync(gone), (error) => error.code === 'ENOENT', 'the unguarded read the audits made at the base');
  // treeEntries, the walk both audits use: a removed directory reads as no entries, never a fault.
  assert.deepEqual(treeEntries(gone), []);
  // The age check's own read: a removed entry has no children to age, so the audit skips it.
  assert.equal(readdirOrNone(gone), null);
  // And the guard changes nothing when nothing is removed: a standing tree still walks whole.
  const live = mkdtempSync(join(tmpdir(), 'gy-33-audit-live-'));
  mkdirSync(join(live, 'child'));
  writeFileSync(join(live, 'child', 'file'), 'entry');
  const walked = treeEntries(live).map((entry) => entry.path).sort();
  rmSync(live, { recursive: true, force: true });
  assert.deepEqual(walked, [join(live, 'child'), join(live, 'child', 'file')].sort());
});

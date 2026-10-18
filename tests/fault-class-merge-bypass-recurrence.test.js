// GY-37 — the "merge outside the guarded path" pattern at the merge stage recurred: 3 in 7 days
// again (detected 2026-10-18T01:19:21.768Z), four minutes after GY-29 delivered its remedy.
//
// The three linked instances are the same fault GY-29 diagnosed (written up at the top of
// src/model/merge-bypass.ts): each is the control-plane merge writer's own `merge.reconciled` step,
// payload {mergeSha, observedTip}, written by the loop's coordinator identity between its
// merge-writer.pushed and merge-writer.delivered rows for the same merge commit, and each merge
// commit is the "Trial merge of HEAD onto BASE" commit on main:
//
//   GY-31  merge.reconciled#5991  intent#5980 pushed#5986 delivered#5992  bc5dda1d18f597b1695f975df9090e0a9f657c4f
//   GY-28  merge.reconciled#6045  intent#6031 pushed#6040 delivered#6046  34140006ec8249650fd1aac813205e31cff05150
//   GY-29  merge.reconciled#6126  intent#6121 pushed#6125 delivered#6127  83717b4f1ee6201657fbaca5e1752a2b82f6bb03
//
// Why it recurred: GY-29's remedy (`candidateDeliveredMergeRule`) exists only as this repository's
// model of the product rule. The deployed control plane's intervention fold (graphyard
// src/interventions/fold-rules.ts `deliveredMerge`, bound to 'merge.reconciled') is unchanged and
// still reads the merge writer's bare row as `{}`, so every third guarded delivery in seven days
// refiles the pattern — GY-29's own delivery was the third. The cause is removed only when that
// rule takes the shape of `candidateDeliveredMergeRule`; the pull request carries the exact patch.
//
// Below, each instance is reproduced against the base (`deliveredMergeRule`, the product's rule as
// deployed) from its recorded row, producing the recorded intervention word for word, and shown
// not to recur against the candidate. The final tests audit the live ledger and this repository's
// history on the coordinator host; CI reaches neither and skips them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import {
  bypassPattern,
  candidateDeliveredMergeRule,
  deliveredMergeRule,
  foldBypasses,
  isMergeWriterReconciliation,
} from '../src/model/merge-bypass.ts';

const master = 'cryptob1-graphyard-snake-v4-master';
const detectedAt = '2026-10-18T01:19:21.768Z';

const RECORDED = [
  { key: 'GY-31', workId: '9967ee7b-c3a2-409a-8f49-c03d54bb7f74', head: '99f86f4dfe7585f5e442e5a75a73e030882850ee', baseTip: '85156d89eb8ae42270964426432ee8b0569e180d',
    mergeSha: 'bc5dda1d18f597b1695f975df9090e0a9f657c4f', intent: 5980, pushed: 5986, seq: 5991, delivered: 5992, at: '2026-10-18T01:14:09.681Z' },
  { key: 'GY-28', workId: 'e69b7a60-710d-4faa-9ce0-839d6741fc11', head: 'e77d198fff46a3c5ad1e67e71c3b8f7ee7c449a0', baseTip: 'bc5dda1d18f597b1695f975df9090e0a9f657c4f',
    mergeSha: '34140006ec8249650fd1aac813205e31cff05150', intent: 6031, pushed: 6040, seq: 6045, delivered: 6046, at: '2026-10-18T01:14:50.102Z' },
  { key: 'GY-29', workId: '0ecd1c55-601b-4917-ae9e-b85b1eeb5898', head: '551b1399465fb27fee94a164c0a267fc63abb0c3', baseTip: '34140006ec8249650fd1aac813205e31cff05150',
    mergeSha: '83717b4f1ee6201657fbaca5e1752a2b82f6bb03', intent: 6121, pushed: 6125, seq: 6126, delivered: 6127, at: '2026-10-18T01:18:48.980Z' },
];

// GY-29's own instances, still inside this item's seven-day window.
const EARLIER = [
  { workId: 'd4847779-8d01-40da-9461-b52c48d7a450', mergeSha: 'e36c3938903294b33bbfbfd5035daedf5339b33d', seq: 5248, at: '2026-10-17T23:39:28.287Z' },
  { workId: '0ad09547-31ac-4b22-9143-74fcced8cff8', mergeSha: 'da23bdcf49420379a3e154eb62a2cbd28308c0e0', seq: 5594, at: '2026-10-18T00:50:52.281Z' },
  { workId: 'a12c1e92-f095-406b-99c1-c4cdca990668', mergeSha: '85156d89eb8ae42270964426432ee8b0569e180d', seq: 5678, at: '2026-10-18T00:55:57.338Z' },
];

/** The merge-writer reconciliation row exactly as graphyard src/server/merge-record.ts writes it. */
const writerRow = instance => ({
  seq: instance.seq, workId: instance.workId, actor: master, kind: 'merge.reconciled', at: instance.at,
  payload: { mergeSha: instance.mergeSha, observedTip: instance.mergeSha }, stageBefore: 'merge',
});
const recordedRows = RECORDED.map(writerRow);

for (const instance of RECORDED) {
  test(`${instance.key} merge.reconciled#${instance.seq}: the base folds the merge writer's own step into the recorded bypass`, () => {
    const row = writerRow(instance);
    assert.equal(isMergeWriterReconciliation(row), true);
    assert.deepEqual(foldBypasses([row], deliveredMergeRule), [{
      id: `bypass:${instance.workId}:${instance.seq}`, kind: 'bypass', work: instance.workId, stage: 'merge',
      requestedAt: instance.at, resolvedAt: instance.at, blocked: 'guarded merge of unknown: merged without a merge execution',
      resolvedBy: `${master} approved by an approver`, resolution: 'reconciled delivery', trigger: 'reconciled',
      sources: [{ seq: instance.seq, kind: 'merge.reconciled' }],
    }]);
  });

  test(`${instance.key} merge.reconciled#${instance.seq}: the candidate reads the same row as the guarded path and emits nothing`, () => {
    assert.deepEqual(foldBypasses([writerRow(instance)], candidateDeliveredMergeRule), []);
  });
}

test('the base crosses the threshold at the recorded instant with exactly this item\'s three instances', () => {
  const pattern = bypassPattern(foldBypasses(recordedRows, deliveredMergeRule), detectedAt);
  assert.equal(pattern.fires, true);
  assert.deepEqual(pattern.instances.map(entry => entry.id).sort(), [
    'bypass:0ecd1c55-601b-4917-ae9e-b85b1eeb5898:6126',
    'bypass:9967ee7b-c3a2-409a-8f49-c03d54bb7f74:5991',
    'bypass:e69b7a60-710d-4faa-9ce0-839d6741fc11:6045',
  ]);
});

test('the full seven-day window — GY-29\'s instances and this item\'s — counts six under the base and none under the candidate', () => {
  const window = [...EARLIER.map(writerRow), ...recordedRows];
  assert.equal(bypassPattern(foldBypasses(window, deliveredMergeRule), detectedAt).count, 6);
  const candidate = bypassPattern(foldBypasses(window, candidateDeliveredMergeRule), detectedAt);
  assert.equal(candidate.count, 0);
  assert.equal(candidate.fires, false);
});

test('the recurrence is the base rule refiling on every third guarded delivery: GY-29\'s own delivery was the third', () => {
  // Merge-writer deliveries after GY-29's pattern filed (2026-10-18T00:56:21.757Z), in ledger order.
  const after = recordedRows.slice();
  const counts = after.map((_, i) => foldBypasses(after.slice(0, i + 1), deliveredMergeRule).length);
  assert.deepEqual(counts, [1, 2, 3]);
  assert.equal(after.at(-1).workId, RECORDED.find(instance => instance.key === 'GY-29').workId);
  assert.deepEqual(after.map((_, i) => foldBypasses(after.slice(0, i + 1), candidateDeliveredMergeRule).length), [0, 0, 0]);
});

// ---- Live audits (coordinator host only) ----

const cli = process.env.GRAPHYARD_CLI ?? '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs';
const readEvents = key => {
  const run = spawnSync(process.execPath, [cli, 'events', key, '--kind', 'merge-writer.intent,merge-writer.pushed,merge.reconciled,merge-writer.delivered', '--order', 'asc'], { encoding: 'utf8', timeout: 20_000 });
  if (run.status !== 0) return null;
  try { return JSON.parse(run.stdout).events; } catch { return null; }
};
const live = !process.env.CI && existsSync(cli) ? readEvents(RECORDED[0].key) : null;

test('live audit: each linked instance is the merge writer completing its own intent for the same merge commit', { skip: live ? false : 'no live control plane reachable (CI, or not the coordinator host)' }, () => {
  for (const instance of RECORDED) {
    const events = readEvents(instance.key);
    assert.ok(events, `events for ${instance.key}`);
    const at = seq => events.find(row => Number(row.seq) === seq);
    const reconciled = at(instance.seq);
    assert.equal(reconciled?.kind, 'merge.reconciled', `${instance.key} holds merge.reconciled#${instance.seq}`);
    assert.equal(reconciled.actor, master);
    assert.equal(reconciled.details, null, 'the row carries no details: the fold reads it as {}');
    assert.equal(at(instance.intent)?.details?.mergeSha, instance.mergeSha);
    assert.equal(at(instance.intent)?.details?.head, instance.head);
    assert.equal(at(instance.intent)?.details?.baseTip, instance.baseTip);
    assert.equal(at(instance.pushed)?.details?.mergeSha, instance.mergeSha);
    assert.equal(at(instance.delivered)?.kind, 'merge-writer.delivered');
    assert.equal(at(instance.delivered)?.details?.mergeSha, instance.mergeSha);
    assert.equal(at(instance.delivered)?.details?.observedTip, instance.mergeSha);
  }
});

const hasCommit = sha => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { encoding: 'utf8' }).status === 0;
test('this repository\'s history holds each delivered merge as the merge writer\'s trial merge of the head onto the base tip', { skip: RECORDED.every(instance => hasCommit(instance.mergeSha)) ? false : 'merge commits not in this clone' }, () => {
  for (const instance of RECORDED) {
    const subject = spawnSync('git', ['log', '-1', '--format=%s %P', instance.mergeSha], { encoding: 'utf8' }).stdout.trim();
    assert.equal(subject, `Trial merge of ${instance.head} onto ${instance.baseTip} ${instance.baseTip} ${instance.head}`);
  }
});

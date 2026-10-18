// GY-29 — recurring "merge outside the guarded path" interventions at the merge stage: 3 in 7 days.
//
// Each linked instance is reproduced below against the base — the product's intervention fold as
// it reads the ledger today (src/model/merge-bypass.ts `deliveredMergeRule`, a mirror of graphyard
// src/interventions/fold-rules.ts `deliveredMerge`) — from its recorded ledger row, and shown not to
// recur against the candidate (`candidateDeliveredMergeRule`, the same rule reading the merge
// writer's own `merge.reconciled` step as the guarded path it is). The shared cause and the remedy
// are written up at the top of src/model/merge-bypass.ts.
//
// The recorded rows (each the merge writer's ledger step, payload {mergeSha, observedTip}, written
// by the loop's coordinator identity a second after its merge-writer.pushed row):
//
//   GY-15  merge.reconciled#5248  2026-10-17T23:39:28.287Z  e36c3938903294b33bbfbfd5035daedf5339b33d
//   GY-20  merge.reconciled#5594  2026-10-18T00:50:52.281Z  da23bdcf49420379a3e154eb62a2cbd28308c0e0
//   GY-25  merge.reconciled#5678  2026-10-18T00:55:57.338Z  85156d89eb8ae42270964426432ee8b0569e180d
//
// The last tests audit the live control plane and this repository's history on the coordinator
// host; CI reaches neither and skips them.

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
const detectedAt = '2026-10-18T00:56:21.757Z';

// Each instance: the item, its work id, the merge writer's rows (seq, instant, payload) and the
// intervention the pattern linked, as this item's origin records it.
const RECORDED = [
  { key: 'GY-15', workId: 'd4847779-8d01-40da-9461-b52c48d7a450', head: '310697ab26c29e3770bcc4b9b2193df14e2b2ee2', baseTip: 'e03e6ba2b6d1dda2e1ba86a3048f91ae06f7c4a9',
    mergeSha: 'e36c3938903294b33bbfbfd5035daedf5339b33d', intent: 5243, pushed: 5247, seq: 5248, at: '2026-10-17T23:39:28.287Z' },
  { key: 'GY-20', workId: '0ad09547-31ac-4b22-9143-74fcced8cff8', head: 'c3dd10b4a3f04a6f3a9d16db20c1ae1c66b41679', baseTip: 'e36c3938903294b33bbfbfd5035daedf5339b33d',
    mergeSha: 'da23bdcf49420379a3e154eb62a2cbd28308c0e0', intent: 5586, pushed: 5591, seq: 5594, at: '2026-10-18T00:50:52.281Z' },
  { key: 'GY-25', workId: 'a12c1e92-f095-406b-99c1-c4cdca990668', head: 'a90f1f690d800f313008ca0a8c6d0303b8578887', baseTip: 'da23bdcf49420379a3e154eb62a2cbd28308c0e0',
    mergeSha: '85156d89eb8ae42270964426432ee8b0569e180d', intent: 5673, pushed: 5677, seq: 5678, at: '2026-10-18T00:55:57.338Z' },
];
const recordedSentence = 'guarded merge of unknown: merged without a merge execution';

/** The merge-writer reconciliation row exactly as src/server/merge-record.ts writes it. */
const writerRow = (instance, overrides = {}) => ({
  seq: instance.seq, workId: instance.workId, actor: master, kind: 'merge.reconciled', at: instance.at,
  payload: { mergeSha: instance.mergeSha, observedTip: instance.mergeSha }, stageBefore: 'merge', ...overrides,
});
const recordedRows = RECORDED.map(instance => writerRow(instance));

for (const instance of RECORDED) {
  test(`${instance.key} merge.reconciled#${instance.seq}: the base folds the merge writer's own step into the recorded bypass`, () => {
    const row = writerRow(instance);
    assert.equal(isMergeWriterReconciliation(row), true, 'the recorded row is the merge ledger\'s reconciled step');
    const [intervention, ...rest] = foldBypasses([row], deliveredMergeRule);
    assert.equal(rest.length, 0);
    assert.deepEqual(intervention, {
      id: `bypass:${instance.workId}:${instance.seq}`, kind: 'bypass', work: instance.workId, stage: 'merge',
      requestedAt: instance.at, resolvedAt: instance.at, blocked: recordedSentence,
      resolvedBy: `${master} approved by an approver`, resolution: 'reconciled delivery', trigger: 'reconciled',
      sources: [{ seq: instance.seq, kind: 'merge.reconciled' }],
    });
  });

  test(`${instance.key} merge.reconciled#${instance.seq}: the candidate reads the same row as the guarded path and emits nothing`, () => {
    assert.deepEqual(foldBypasses([writerRow(instance)], candidateDeliveredMergeRule), []);
  });
}

test('the base crosses the threshold at the recorded instant and links exactly this item\'s three instances', () => {
  const pattern = bypassPattern(foldBypasses(recordedRows, deliveredMergeRule), detectedAt);
  assert.equal(pattern.fires, true);
  assert.equal(pattern.count, 3);
  assert.deepEqual(pattern.instances.map(entry => entry.id).sort(), [
    'bypass:0ad09547-31ac-4b22-9143-74fcced8cff8:5594',
    'bypass:a12c1e92-f095-406b-99c1-c4cdca990668:5678',
    'bypass:d4847779-8d01-40da-9461-b52c48d7a450:5248',
  ]);
});

test('the candidate leaves the merge stage at zero bypasses for the same window, below the threshold of 3 in 7 days', () => {
  const pattern = bypassPattern(foldBypasses(recordedRows, candidateDeliveredMergeRule), detectedAt);
  assert.equal(pattern.fires, false);
  assert.equal(pattern.count, 0);
});

test('the instances cannot recur: any number of further merge-writer deliveries in a window counts none against the candidate', () => {
  const later = Array.from({ length: 12 }, (_, i) => writerRow({
    workId: `item-${i}`, seq: 6000 + i, at: new Date(Date.parse(detectedAt) + (i + 1) * 3_600_000).toISOString(),
    mergeSha: (i.toString(16).padStart(2, '0')).repeat(20),
  }));
  const now = later.at(-1).at;
  assert.equal(bypassPattern(foldBypasses(later, deliveredMergeRule), now).fires, true, 'the base files again on every third guarded delivery');
  assert.deepEqual(foldBypasses(later, candidateDeliveredMergeRule), []);
});

test('a genuine merge outside the guarded path still counts under the candidate', () => {
  const instance = RECORDED[0];
  // The engine's reconciled delivery: a merge GitHub made that the master reconciled, facts under details.
  const reconciledDelivery = { ...writerRow(instance), seq: 7001, payload: { details: {
    requestedBy: master, approvedBy: 'cryptob1-graphyard-snake-v4-approver', judgement: 'merged on GitHub by hand; checks green',
    mergeSha: instance.mergeSha, mergedAt: '2026-10-17T23:39:20.000Z', unmet: ['Independent approval of the current commit is required'],
  } } };
  const [delivered] = foldBypasses([reconciledDelivery], candidateDeliveredMergeRule);
  assert.equal(delivered.blocked, `guarded merge of ${instance.mergeSha.slice(0, 12)}: Independent approval of the current commit is required`);
  assert.equal(delivered.resolvedBy, `${master} approved by cryptob1-graphyard-snake-v4-approver`);

  // A refused reconciliation answered by a later delivery is still one bypass citing the refusal.
  const refused = { ...writerRow(instance), seq: 7000, kind: 'merge.reconciliation.refused', payload: { details: { mergeSha: instance.mergeSha, reasons: ['review gate failed'] } } };
  const [answered] = foldBypasses([refused, reconciledDelivery], candidateDeliveredMergeRule);
  assert.deepEqual(answered.sources, [{ seq: 7000, kind: 'merge.reconciliation.refused' }, { seq: 7001, kind: 'merge.reconciled' }]);

  // An operator-authorized merge.
  const operator = { ...writerRow(instance), seq: 7002, kind: 'merge.operator-authorized', payload: { details: { operator: 'vish', reason: 'hotfix', mergeSha: instance.mergeSha } } };
  assert.equal(foldBypasses([operator], candidateDeliveredMergeRule)[0].trigger, 'operator-authorized');

  // A bare merge.reconciled that is not exactly the merge ledger's step is not exempted.
  for (const payload of [{ mergeSha: instance.mergeSha }, { mergeSha: 'unknown', observedTip: instance.mergeSha }, { mergeSha: instance.mergeSha, observedTip: instance.mergeSha, extra: 1 }, null]) {
    assert.equal(foldBypasses([{ ...writerRow(instance), payload }], candidateDeliveredMergeRule).length, 1, JSON.stringify(payload));
  }
  // A direct-merge window stays exempt in both.
  const direct = { ...writerRow(instance), payload: { details: { directMerge: true } } };
  assert.deepEqual(foldBypasses([direct], candidateDeliveredMergeRule), []);
});

test('a merge-writer step after an open refusal leaves the refusal standing for the delivery that answers it', () => {
  const instance = RECORDED[1];
  const refused = { ...writerRow(instance), seq: 1, kind: 'merge.reconciliation.refused', payload: { details: { mergeSha: instance.mergeSha } } };
  const delivery = { ...writerRow(instance), seq: 3, payload: { details: { requestedBy: master } } };
  const out = foldBypasses([refused, writerRow(instance, { seq: 2 }), delivery], candidateDeliveredMergeRule);
  assert.equal(out.length, 1);
  assert.equal(out[0].sources[0].kind, 'merge.reconciliation.refused');
});

// ---- Live audits (coordinator host only) ----

const cli = process.env.GRAPHYARD_CLI ?? '/var/tmp/claude-1000/gy-main-cli/bin/graphyard.mjs';
const readEvents = (key) => {
  const run = spawnSync(process.execPath, [cli, 'events', key, '--kind', 'merge-writer.intent,merge-writer.pushed,merge.reconciled,merge-writer.delivered', '--order', 'asc'], { encoding: 'utf8', timeout: 20_000 });
  if (run.status !== 0) return null;
  try { return JSON.parse(run.stdout).events; } catch { return null; }
};
const live = !process.env.CI && existsSync(cli) ? readEvents(RECORDED[0].key) : null;

test('live audit: each linked instance is the merge writer completing its own intent for the same merge commit', { skip: live ? false : 'no live control plane reachable (CI, or not the coordinator host)' }, () => {
  for (const instance of RECORDED) {
    const events = readEvents(instance.key);
    assert.ok(events, `events for ${instance.key}`);
    const by = kind => events.filter(row => row.kind === kind);
    const reconciled = by('merge.reconciled').find(row => Number(row.seq) === instance.seq);
    assert.ok(reconciled, `${instance.key} holds merge.reconciled#${instance.seq}`);
    assert.equal(reconciled.actor, master);
    assert.equal(reconciled.details, null, 'the row carries no details: the fold reads it as {}');
    const intent = by('merge-writer.intent').find(row => Number(row.seq) === instance.intent);
    assert.equal(intent?.details?.mergeSha, instance.mergeSha);
    assert.equal(intent?.details?.head, instance.head);
    assert.equal(by('merge-writer.pushed').find(row => Number(row.seq) === instance.pushed)?.details?.mergeSha, instance.mergeSha);
    const delivered = by('merge-writer.delivered').find(row => Number(row.seq) > instance.seq);
    assert.equal(delivered?.details?.mergeSha, instance.mergeSha);
    assert.equal(delivered?.details?.observedTip, instance.mergeSha);
  }
});

const hasCommit = sha => spawnSync('git', ['cat-file', '-e', `${sha}^{commit}`], { encoding: 'utf8' }).status === 0;
test('this repository\'s history holds each delivered merge as the merge writer\'s trial merge of the head onto the base tip', { skip: RECORDED.every(instance => hasCommit(instance.mergeSha)) ? false : 'merge commits not in this clone' }, () => {
  for (const instance of RECORDED) {
    const subject = spawnSync('git', ['log', '-1', '--format=%s %P', instance.mergeSha], { encoding: 'utf8' }).stdout.trim();
    assert.equal(subject, `Trial merge of ${instance.head} onto ${instance.baseTip} ${instance.baseTip} ${instance.head}`);
  }
});

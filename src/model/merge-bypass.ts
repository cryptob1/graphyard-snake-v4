// GY-29 — the "merge outside the guarded path" intervention, read from the ledger.
//
// The recorded pattern (2026-10-18T00:56:21.757Z, the Graphyard installation serving this
// repository): three `bypass` interventions at the merge stage in seven days, threshold 3 —
// GY-15 (ledger merge.reconciled#5248), GY-20 (#5594) and GY-25 (#5678) — each reading
//
//   "blocked guarded merge of unknown: merged without a merge execution; waited 0 min; resolved by
//    cryptob1-graphyard-snake-v4-master approved by an approver (reconciled delivery)".
//
// None of the three left the guarded path. Each item's ledger holds the control-plane merge
// writer's full run, under the loop's coordinator identity, seconds apart:
//
//   merge.intent → merge-writer.intent {key, head, baseTip, mergeSha, risk, at}
//   merge.trial  → merge-writer.trial  {outcome: verdict, build: pass, …}
//   merge.pushed → merge-writer.pushed {mergeSha, pushedAt}
//   merge.reconciled {mergeSha, observedTip} → merge-writer.delivered
//
// and the merge commits it landed (e36c3938…, da23bdcf…, 85156d89…) are the "Trial merge of HEAD
// onto BASE" commits on main. The shared cause is a kind-name collision in the product:
//
//   · the merge writer's ledger (graphyard src/model/merge-ledger.ts `mergeLedgerKinds.reconciled`,
//     written by src/server/merge-record.ts `recordMergeEvent`) records its own last step —
//     "the base branch was observed holding the merge commit", accepted only under the item's open
//     intent of its submitted head and only once the base holds the commit — as `merge.reconciled`
//     with the bare payload `{mergeSha, observedTip}`;
//   · the engine's reconciled delivery (graphyard src/engine.ts, the master's reconciliation of a
//     merge GitHub made without the record's authorization) is also `merge.reconciled`, with its
//     facts under `payload.details` (requestedBy, approvedBy, judgement, mergeSha, mergedAt, …);
//   · the intervention fold (graphyard src/interventions/fold-rules.ts `deliveredMerge`, bound to
//     both `merge.operator-authorized` and `merge.reconciled`) reads only `payload->'details'`
//     (src/interventions/ledger.ts), so the merge writer's row reaches it as `{}`: no exemption
//     applies, the merge sha reads "unknown", there are no `unmet` reasons, so it emits a bypass
//     "merged without a merge execution", resolved by the row's actor "approved by an approver"
//     as a "reconciled delivery" — the recorded sentence, word for word.
//
// Every merge the control-plane merge writer delivers is therefore counted as an intervention, so
// the pattern recurs with every third delivery in any seven days, whatever anyone does.
//
// The remedy is to read the row for what it is: a `merge.reconciled` row that carries no `details`
// and whose payload is exactly the merge ledger's reconciled step (`{mergeSha, observedTip}`, both
// full shas, nothing else) is the guarded path completing, never a delivery past the record — it
// emits nothing and leaves any open refusal standing. The engine's reconciled delivery and an
// operator-authorized merge are untouched and still count. `deliveredMergeRule` below mirrors the
// product's rule; `candidateDeliveredMergeRule` is that rule with the remedy, the shape the fix to
// graphyard src/interventions/fold-rules.ts takes. Pure functions, no imports, so the regression
// test runs it under plain `node --test`.

/** One ledger row as the intervention fold reads it (graphyard src/interventions/ledger.ts `InterventionLedgerRow`, the pieces this rule reads). */
export interface LedgerRow {
  seq: number;
  workId: string;
  actor: string;
  kind: string;
  at: string;
  /** The stored payload. The fold itself reads only `payload.details`. */
  payload: Record<string, unknown> | null;
  /** The stage the item was in when the row's command ran. */
  stageBefore: string | null;
}

/** An open refusal of a guarded merge (graphyard `WorkState.bypass`). */
export interface OpenBypass { seq: number; at: string; mergeSha: string; blocked: string; stage: string | null }

/** One emitted intervention, the fields the pattern scan and its filing read. */
export interface Intervention {
  id: string;
  kind: 'bypass';
  work: string;
  stage: string | null;
  requestedAt: string;
  resolvedAt: string;
  blocked: string;
  resolvedBy: string;
  resolution: string;
  trigger: 'reconciled' | 'operator-authorized';
  sources: { seq: number; kind: string }[];
}

export type FoldRule = (row: LedgerRow, state: { bypass: OpenBypass | null }, emit: (intervention: Intervention) => void) => void;

const text = (value: unknown, fallback: string) => (typeof value === 'string' && value.trim() ? value : fallback);
const instant = (value: unknown, fallback: string) => { const parsed = typeof value === 'string' ? Date.parse(value) : Number.NaN; return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback; };
const isObject = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const fullSha = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value);

/** A merge inside a direct-merge window is the operator's standing policy (graphyard `directMergeWindow`, the merge-stage exemption). */
const exempt = (details: Record<string, any>) => !!details.directMerge;

/**
 * Whether a `merge.reconciled` row is the merge writer's own ledger step (graphyard
 * src/model/merge-ledger.ts `mergeReconciledSchema`, strict): no `details`, and exactly
 * `{mergeSha, observedTip}` as full shas. The server accepts that step only under the item's open
 * intent of its submitted head, once the base branch holds the merge commit, so the row is the
 * guarded path's completion by construction.
 */
export function isMergeWriterReconciliation(row: LedgerRow): boolean {
  if (row.kind !== 'merge.reconciled' || !isObject(row.payload) || 'details' in row.payload) return false;
  const keys = Object.keys(row.payload).sort();
  return keys.length === 2 && keys[0] === 'mergeSha' && keys[1] === 'observedTip' && fullSha(row.payload.mergeSha) && fullSha(row.payload.observedTip);
}

/** The product's rule as it stands: a merge delivered past the record is a bypass, unless exempt (graphyard fold-rules.ts `deliveredMerge`). */
export const deliveredMergeRule: FoldRule = (row, state, emit) => {
  const details: Record<string, any> = isObject(row.payload?.details) ? row.payload!.details as Record<string, any> : {};
  if (exempt(details)) { state.bypass = null; return; }
  const mergedAt = instant(details.mergedAt, row.at);
  const open = state.bypass;
  const operator = row.kind === 'merge.operator-authorized';
  emit({
    id: `bypass:${row.workId}:${row.seq}`, kind: 'bypass', work: row.workId, stage: open?.stage ?? row.stageBefore,
    requestedAt: open?.at ?? mergedAt,
    blocked: open?.blocked ?? `guarded merge of ${text(details.mergeSha, 'unknown').slice(0, 12)}: ${Array.isArray(details.unmet) && details.unmet.length ? details.unmet.join('; ') : 'merged without a merge execution'}`,
    resolvedAt: row.at,
    resolvedBy: operator ? text(details.operator, row.actor) : `${text(details.requestedBy, row.actor)} approved by ${text(details.approvedBy, 'an approver')}`,
    resolution: text(details.judgement ?? details.reason, operator ? 'operator-authorized delivery' : 'reconciled delivery'),
    trigger: operator ? 'operator-authorized' : 'reconciled',
    sources: [...(open ? [{ seq: open.seq, kind: 'merge.reconciliation.refused' }] : []), { seq: row.seq, kind: row.kind }],
  });
  state.bypass = null;
};

/** The rule with the remedy: the merge writer's own reconciliation is the guarded path, not a delivery past it. */
export const candidateDeliveredMergeRule: FoldRule = (row, state, emit) => {
  if (isMergeWriterReconciliation(row)) return;
  deliveredMergeRule(row, state, emit);
};

/** A guarded merge the record refused opens a bypass (graphyard fold-rules.ts `mergeReconciliationRefused`). */
const refusedRule: FoldRule = (row, state) => {
  const details: Record<string, any> = isObject(row.payload?.details) ? row.payload!.details as Record<string, any> : {};
  const mergeSha = text(details.mergeSha, 'unknown');
  state.bypass = { seq: row.seq, at: instant(details.mergedAt, row.at), mergeSha, stage: row.stageBefore,
    blocked: `guarded merge of ${mergeSha.slice(0, 12)}: ${Array.isArray(details.reasons) ? details.reasons.join('; ') : 'the record refused the reconciliation'}` };
};

/** Fold the merge-stage rows of a ledger window into bypass interventions, oldest first, with the given delivered-merge rule. */
export function foldBypasses(rows: readonly LedgerRow[], delivered: FoldRule = deliveredMergeRule): Intervention[] {
  const states = new Map<string, { bypass: OpenBypass | null }>();
  const out: Intervention[] = [];
  for (const row of [...rows].sort((a, b) => a.seq - b.seq)) {
    const state = states.get(row.workId) ?? { bypass: null };
    states.set(row.workId, state);
    if (row.kind === 'merge.reconciliation.refused') refusedRule(row, state, intervention => out.push(intervention));
    else if (row.kind === 'merge.reconciled' || row.kind === 'merge.operator-authorized') delivered(row, state, intervention => out.push(intervention));
  }
  return out;
}

/** The recurring-intervention policy that filed this item: 3 of one kind at one stage in 7 days. */
export const bypassPolicy = { threshold: 3, windowDays: 7 } as const;

/** Whether the pattern scan files a recurring bypass at the merge stage at `now`, and the instances it would link. */
export function bypassPattern(interventions: readonly Intervention[], now: string, policy: { threshold: number; windowDays: number } = bypassPolicy) {
  const to = Date.parse(now), from = to - policy.windowDays * 86_400_000;
  const instances = interventions.filter(entry => entry.kind === 'bypass' && entry.stage === 'merge' && Date.parse(entry.resolvedAt) >= from && Date.parse(entry.resolvedAt) <= to);
  return { fires: instances.length >= policy.threshold, count: instances.length, instances };
}

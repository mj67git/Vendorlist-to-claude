import { applyDerivedState, scoreBelowFloor } from "../../utils/vendorState.js";

/**
 * What the server stores as a source's qualification, whatever the caller sent.
 *
 * Project rule 11c — never believe a derived value from the payload, recompute
 * it where it is stored — was written for exactly this and enforced for one
 * half of the domain only. `upsertBusinessPartner` rebuilds a partner's SOP
 * grade from its documents with `computeSupplierEvaluation`. The source path
 * had no equivalent: `applyDerivedState` knows the 80/60/40 rubric but is
 * called only in the browser, so a request could assert any grade on any
 * scores and the database kept the assertion. A source scoring 10 out of 100
 * could be filed as an approved Grade A supplier, and the spreadsheet, the
 * printed form and the dashboard all repeated it.
 *
 * Two things happen here, in this order, and the order matters.
 *
 * First the decision is read out of the payload and recorded in its own
 * column. A caller still expresses "this source is disqualified" the way it
 * always has, by sending `status: 'rejected'` — the client contract does not
 * change — but the server no longer stores that in a field the scoring rules
 * also write. A rejection the numbers already explain is not a decision, so it
 * is not recorded as one; that is what keeps a bad score reversible.
 *
 * Then the rubric runs and its answer is what gets stored.
 *
 * Call this *after* the permission guards, never before. `forbiddenVerdictChange`
 * judges what the caller was trying to do by comparing the payload with the
 * stored record; if the recompute ran first, a change the server itself made
 * would be blamed on the caller.
 */
export function settleSourceVerdict<T extends Record<string, any>>(
  incoming: T,
  options: {
    /** The stored record, for the decision already on file. */
    previous?: Record<string, any> | null;
    /**
     * The status the request itself stated, or `undefined` when it stated none.
     *
     * Read from the request body rather than from the merged record, and that
     * distinction is the whole of it. Most write routes build their update by
     * spreading the stored row, so the old `status` travels along whether the
     * caller meant anything by it or not. Treating that passenger as an
     * assertion made the scores route record a decision nobody took: a source
     * disqualified by a bad score, then rescored well, was read as "the caller
     * is asking for a rejection the score no longer explains" — which is the
     * definition of a decision — and latched again by a different route.
     */
    assertedStatus?: unknown;
  } = {},
): T {
  const { previous, assertedStatus } = options;
  const alreadyDecided = previous?.rejectedByDecision === true;

  /**
   * Was this a person's decision?
   *
   * A request that states no status changes nothing about the decision on
   * file. A request that states one is taken at its word: asking for a
   * rejection the score does not already account for is a decision, asking for
   * anything else reverses one — that is the restore box, and it has to be able
   * to undo what it did. A rejection the arithmetic already explains is not
   * recorded as a decision, which is what keeps a bad score reversible.
   */
  const rejectedByDecision =
    assertedStatus === undefined
      ? alreadyDecided
      : assertedStatus === "rejected"
        ? (!scoreBelowFloor(incoming) || alreadyDecided)
        : false;

  return applyDerivedState({ ...incoming, rejectedByDecision } as T);
}

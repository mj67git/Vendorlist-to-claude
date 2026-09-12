-- A human decision to disqualify a source, recorded in its own column.
--
-- `status` used to carry both the decision and the result of the scoring
-- rules. Because `applyDerivedState` writes that same column, a source that
-- fell below the qualification floor was stamped `rejected`, and the next pass
-- read the stamp back as a verdict before it ever reached the arithmetic — so
-- better scores could not lift it out. Splitting the decision off is what makes
-- a score-driven rejection reversible.
ALTER TABLE "vendors"
  ADD COLUMN "rejected_by_decision" BOOLEAN NOT NULL DEFAULT false;

-- Every source that is disqualified today keeps its verdict, as a decision.
--
-- The two causes cannot be told apart in the existing rows: nothing recorded
-- whether a person rejected the source or the score did. The conservative
-- reading is the only safe one here — in a GxP register, silently re-qualifying
-- a supplier is a far worse error than leaving one disqualified until somebody
-- reverses it deliberately, which the restore box already does.
--
-- Only sources are touched. A sample is decided by the laboratory, never
-- scored, and its own branch of `isVendorRejected` still reads `status`.
UPDATE "vendors" v
   SET "rejected_by_decision" = true
 WHERE v."status" = 'rejected'
   AND EXISTS (
     SELECT 1 FROM "vendor_materials" vm
      WHERE vm."vendor_id" = v."id" AND vm."is_sample" = false
   );

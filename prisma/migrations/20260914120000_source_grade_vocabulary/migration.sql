-- The grade column says what was scored. It no longer says the verdict.
--
-- Four spellings of one idea had been written into `grade` by four different
-- files: 'rejected' (the client derivation), 'black list' (the server tier
-- table), 'Blacklist' (the seller rubric, copied by mistake) and the literal
-- 'new' for «not graded yet». The first three are not grades at all —
-- «blacklisted» is the answer to a different question, and `isVendorRejected`
-- is the only thing entitled to answer it (rule 11). The fourth is the absence
-- of a grade, which is NULL.
--
-- A disqualified source that had been scored was, by the numbers, a D: the
-- verdict was written over a failing band. Mapping those rows to 'D' keeps the
-- fact the value really carried. The verdict itself is not lost — it lives in
-- `rejected_by_decision` (migration 20260912100000) for a human decision and is
-- recomputed from the score otherwise, which is why those rows keep their place
-- on the blacklist without this column saying so.
--
-- One-time, like 20260908100000 did for the permission lists: from here on the
-- code writes only the four bands, and `normalizeSourceGrade` keeps reading the
-- retired spellings for anything this migration cannot reach (a browser cache,
-- an import, a fixture).

UPDATE "vendors"
SET "grade" = 'D'
WHERE lower(trim("grade")) IN ('rejected', 'black list', 'blacklist');

UPDATE "vendors"
SET "grade" = NULL
WHERE lower(trim("grade")) IN ('new', 'unrated', 'not evaluated', '');

-- Same table of values on the evaluation rows.
UPDATE "evaluations"
SET "grade" = 'D'
WHERE lower(trim("grade")) IN ('rejected', 'black list', 'blacklist');

-- «No grade» becomes NULL here too, which is why the column has to allow it.
-- It was NOT NULL with the writer defaulting to 'C', so every source nobody had
-- scored carried a stored Grade C that no person had assigned.
ALTER TABLE "evaluations" ALTER COLUMN "grade" DROP NOT NULL;

UPDATE "evaluations"
SET "grade" = NULL
WHERE lower(trim("grade")) IN ('new', 'unrated', 'not evaluated', '');

-- What this migration deliberately does not do: it cannot tell a genuine Grade
-- C on an evaluation row from one the old default wrote. Those rows are left
-- as they are rather than guessed at — the vendor row's grade is what every
-- reader actually uses, and it is corrected above.

-- And the other half: a row still carrying a rejected `status` with no decision
-- recorded beside it.
--
-- 20260912100000 wrote the decision column for every source that was rejected
-- when it ran. A row inserted *after* that migration and *before* this one —
-- an import, a script, a fixture written straight into the table — has the old
-- stamp and no decision, and nothing reads the stamp any more (rule 11), so it
-- would quietly stop being blacklisted. The same backfill is repeated here so
-- that the verdict survives in the column that now carries it.
UPDATE "vendors" v
SET "rejected_by_decision" = true
WHERE v."rejected_by_decision" = false
  AND lower(trim(v."status")) = 'rejected'
  AND EXISTS (
    SELECT 1 FROM "vendor_materials" vm
    WHERE vm."vendor_id" = v."id" AND vm."is_sample" = false
  );

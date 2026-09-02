-- Retire the two embedded-JSON columns on `vendors`.
--
-- `risk_assessment` and `analysis_records` predate the normalized
-- `risk_assessments` and `analysis_records` tables and have been dead for some
-- time: nothing reads them, and every save has written NULL into both. They are
-- still a liability while they exist — a second place the same fact can live,
-- which is exactly what a regulated record must not have.
--
-- Rows written before the normalization may still hold JSON, so this moves what
-- is there first and only then drops the columns. If anything cannot be moved,
-- the migration RAISES and nothing is dropped: losing a risk assessment or a
-- laboratory result silently is far worse than a failed deployment.

-- 1. Risk assessments. One object per vendor, and only where the normalized
--    table has nothing for that vendor already — the normalized row is the one
--    the application has been reading, so it wins.
INSERT INTO "risk_assessments" (
  "id", "vendor_id", "material_criticality", "detectability", "probability",
  "sps", "risk_score", "sri", "risk_level", "evaluation_date", "evaluator", "created_at"
)
SELECT
  left('legacy-risk-' || v."id", 50),
  v."id",
  COALESCE((j->>'materialCriticality')::int, 1),
  COALESCE((j->>'detectability')::int, 1),
  COALESCE((j->>'probability')::int, 1),
  COALESCE((j->>'sps')::double precision, 0),
  COALESCE((j->>'riskScore')::double precision, 0),
  COALESCE((j->>'sri')::double precision, 0),
  (CASE WHEN j->>'riskLevel' IN ('Low','Medium','High') THEN j->>'riskLevel' ELSE 'Low' END)::"RiskLevel",
  NULLIF(j->>'date', ''),
  NULLIF(j->>'evaluator', ''),
  NOW()
FROM (
  SELECT "id", "risk_assessment"::jsonb AS j
  FROM "vendors"
  WHERE "risk_assessment" IS NOT NULL
    AND btrim("risk_assessment") <> ''
    AND jsonb_typeof("risk_assessment"::jsonb) = 'object'
    -- An empty object is not an assessment. Without this it became a row of
    -- default scores, and a source nobody had assessed would show up as
    -- assessed, at the lowest risk band — an invented record, which is the one
    -- thing a migration of regulated data must never produce.
    AND ("risk_assessment"::jsonb) ?| array['materialCriticality','detectability','probability','riskLevel','riskScore','sri']
) v
WHERE NOT EXISTS (SELECT 1 FROM "risk_assessments" r WHERE r."vendor_id" = v."id");

-- 2. Laboratory results. An array per vendor, so each element becomes a row.
--    `ordinality` keeps the ids unique and the original order recoverable.
INSERT INTO "analysis_records" (
  "id", "vendor_id", "record_date", "qc_code", "decision", "deviation_reason",
  "comments", "recorded_by", "created_at"
)
SELECT
  left('legacy-an-' || v."id" || '-' || e.ord, 50),
  v."id",
  NULLIF(e.j->>'date', ''),
  NULLIF(e.j->>'qcCode', ''),
  (CASE
     WHEN e.j->>'decision' = 'Reject' THEN 'Reject'
     WHEN e.j->>'decision' IN ('Approved Conditional','ApprovedConditional') THEN 'ApprovedConditional'
     ELSE 'Pass'
   END)::"AnalysisDecision",
  (CASE
     WHEN e.j->>'deviationReason' IN ('None','NCR','Deviation','OOS','CAPA','OOT','Complaint','Other')
       THEN e.j->>'deviationReason'
     ELSE 'None'
   END)::"DeviationReason",
  NULLIF(e.j->>'comments', ''),
  NULLIF(e.j->>'recordedBy', ''),
  NOW()
FROM (
  SELECT "id", "analysis_records"::jsonb AS j
  FROM "vendors"
  WHERE "analysis_records" IS NOT NULL
    AND btrim("analysis_records") <> ''
    AND jsonb_typeof("analysis_records"::jsonb) = 'array'
) v
CROSS JOIN LATERAL jsonb_array_elements(v.j) WITH ORDINALITY AS e(j, ord)
-- Same reason: an element that is not an object carries no result, and turning
-- it into a "Pass" would be inventing one. Anything skipped here trips the
-- check below rather than disappearing.
WHERE jsonb_typeof(e.j) = 'object'
  AND NOT EXISTS (SELECT 1 FROM "analysis_records" a WHERE a."vendor_id" = v."id");

-- 3. Nothing may be dropped while a source still carries data that did not
--    arrive in the normalized tables. An empty array or `{}` counts as nothing
--    to carry; anything else that produced no row stops the deployment.
DO $$
DECLARE
  stranded text;
BEGIN
  SELECT string_agg("id", ', ') INTO stranded
  FROM "vendors" v
  WHERE (
      v."risk_assessment" IS NOT NULL AND btrim(v."risk_assessment") NOT IN ('', '{}', 'null')
      AND NOT EXISTS (SELECT 1 FROM "risk_assessments" r WHERE r."vendor_id" = v."id")
    ) OR (
      v."analysis_records" IS NOT NULL AND btrim(v."analysis_records") NOT IN ('', '[]', 'null')
      AND NOT EXISTS (SELECT 1 FROM "analysis_records" a WHERE a."vendor_id" = v."id")
    );

  IF stranded IS NOT NULL THEN
    RAISE EXCEPTION
      'Legacy risk/analysis JSON could not be migrated for source(s): %. Nothing was dropped. Inspect vendors.risk_assessment and vendors.analysis_records for these rows before retrying.',
      stranded;
  END IF;
END $$;

-- 4. Now the columns carry nothing that is not also in a proper table.
ALTER TABLE "vendors" DROP COLUMN "risk_assessment";
ALTER TABLE "vendors" DROP COLUMN "analysis_records";

-- Sort audit records by the Persian alphabet, not by code point.
--
-- The audit table's "sort by user" header ordered names with the database's
-- default collation (C.UTF-8 here), which is code-point order. That order is
-- wrong for Persian in two visible ways: the letters that Unicode appends after
-- the Arabic block (پ چ ژ گ ک ی) sort after every other letter, so «پرویز»
-- landed behind «هدی»; and «آ» is not treated as a form of «ا».
--
-- Prisma cannot express COLLATE inside `orderBy`, so the collation is attached
-- to the column itself: every ORDER BY user_name — the one Prisma emits
-- included — then uses it, with no change to the query builder.
--
-- Guarded, because ICU collations are a build option: on a server without
-- `fa-x-icu` the column keeps the database default and ordering stays as it was
-- rather than failing the deploy. `fa-IR-x-icu` is tried first and `fa-x-icu`
-- second; they order Persian identically, and the regional one simply matches
-- what most managed providers register.
DO $$
DECLARE
  coll text;
BEGIN
  SELECT collname INTO coll
  FROM pg_collation
  WHERE collname IN ('fa-IR-x-icu', 'fa-x-icu')
  ORDER BY CASE collname WHEN 'fa-IR-x-icu' THEN 0 ELSE 1 END
  LIMIT 1;

  IF coll IS NOT NULL THEN
    EXECUTE format(
      -- The type is restated unchanged (VARCHAR(100), as in schema.prisma):
      -- ALTER COLUMN ... COLLATE requires a TYPE clause, and widening it to TEXT
      -- here would silently drop the length limit Prisma still believes in.
      'ALTER TABLE "audit_log" ALTER COLUMN "user_name" TYPE VARCHAR(100) COLLATE %I',
      coll
    );
  ELSE
    RAISE NOTICE 'No Persian ICU collation found; audit_log.user_name keeps the database default ordering.';
  END IF;
END
$$;

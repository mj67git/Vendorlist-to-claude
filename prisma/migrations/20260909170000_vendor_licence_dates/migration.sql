-- The source's licence issue date, which the form has always collected and the
-- record has never had anywhere to put.
--
-- `irc_expiry_date` already exists and is read back; it was simply never
-- written (see saveVendorToDb). `last_audit` had no column at all, so the value
-- travelled from the form to the API to the persistence layer and stopped
-- there, while the page printed the registration date in its place.
ALTER TABLE "vendors" ADD COLUMN "last_audit" TEXT;

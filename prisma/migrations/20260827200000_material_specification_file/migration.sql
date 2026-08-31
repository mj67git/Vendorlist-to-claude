-- The Specification attachment used to be a file name and nothing else: the
-- form recorded what the user picked, but the file itself was never stored.
-- These columns hold the actual document, alongside the name that is already
-- in `specification_file`.
ALTER TABLE "materials" ADD COLUMN "specification_file_size" INTEGER;
ALTER TABLE "materials" ADD COLUMN "specification_file_data" TEXT;
ALTER TABLE "materials" ADD COLUMN "specification_uploaded_at" TIMESTAMP(3);

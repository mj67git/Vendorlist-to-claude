-- CreateTable
CREATE TABLE "source_selections" (
    "id" TEXT NOT NULL,
    "material_key" VARCHAR(255) NOT NULL,
    "category" VARCHAR(50) NOT NULL,
    "vendor_id" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "decided_by" VARCHAR(100) NOT NULL,
    "decided_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "source_selections_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_selections_vendor_id_idx" ON "source_selections"("vendor_id");

-- CreateIndex
CREATE UNIQUE INDEX "source_selections_material_key_category_key" ON "source_selections"("material_key", "category");

-- AddForeignKey
ALTER TABLE "source_selections" ADD CONSTRAINT "source_selections_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

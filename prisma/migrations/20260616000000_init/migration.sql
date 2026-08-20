-- CreateTable
CREATE TABLE "vendors" (
    "id" VARCHAR(50) NOT NULL,
    "category" TEXT NOT NULL,
    "material" TEXT NOT NULL,
    "material_en" TEXT NOT NULL,
    "cas" TEXT NOT NULL,
    "irc" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "grade" TEXT,
    "status" TEXT NOT NULL,
    "scores" JSONB,
    "raw_scores" JSONB,
    "last_audit" TEXT,
    "rejection_reasons" JSONB,
    "contact_info" TEXT,
    "registration_date" TEXT,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "activity_logs" JSONB,
    "risk_assessment" JSONB,
    "analysis_records" JSONB,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

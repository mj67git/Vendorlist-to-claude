-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'lab', 'commercial', 'qa', 'planning', 'finance');

-- CreateEnum
CREATE TYPE "BusinessPartnerType" AS ENUM ('Manufacturer', 'Supplier');

-- CreateEnum
CREATE TYPE "BusinessPartnerStatus" AS ENUM ('Active', 'Inactive', 'Blacklisted');

-- CreateEnum
CREATE TYPE "RiskLevel" AS ENUM ('Low', 'Medium', 'High');

-- CreateEnum
CREATE TYPE "AnalysisDecision" AS ENUM ('Pass', 'Reject', 'ApprovedConditional');

-- CreateEnum
CREATE TYPE "DeviationReason" AS ENUM ('None', 'NCR', 'Deviation', 'OOS', 'CAPA', 'OOT', 'Complaint', 'Other');

-- CreateEnum
CREATE TYPE "SopDocumentKey" AS ENUM ('manufacturerLetter', 'authorizedSignatory', 'businessLicense', 'officialEnglishTranslation', 'legalization');

-- CreateEnum
CREATE TYPE "SopDocumentStatus" AS ENUM ('Approved', 'PermitApproval', 'Expired', 'NotSubmitted');

-- CreateTable
CREATE TABLE "users" (
    "username" VARCHAR(100) NOT NULL,
    "name" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'commercial',
    "password_hash" TEXT NOT NULL,
    "password_salt" VARCHAR(64) NOT NULL,
    "must_change_password" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "permissions" JSONB,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("username")
);

-- CreateTable
CREATE TABLE "materials" (
    "id" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "cas" TEXT NOT NULL,
    "irc" TEXT NOT NULL,
    "iupac" TEXT,
    "role" TEXT,
    "final_product" TEXT,
    "final_product_en" TEXT,
    "pharmacopoeia" TEXT,
    "standard_name_fa" TEXT,
    "standard_name_en" TEXT,
    "specification_file" TEXT,
    "irc_receive_date" TEXT,
    "irc_expiry_date" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_partners" (
    "id" VARCHAR(50) NOT NULL,
    "type" "BusinessPartnerType" NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT,
    "country" TEXT NOT NULL,
    "city" TEXT,
    "address" TEXT,
    "email" TEXT,
    "contact_person" TEXT,
    "phone" TEXT,
    "website" TEXT,
    "status" "BusinessPartnerStatus" NOT NULL DEFAULT 'Active',
    "manufacturer_id" VARCHAR(50),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_evaluations" (
    "id" VARCHAR(50) NOT NULL,
    "partner_id" VARCHAR(50) NOT NULL,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grade" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sop_documents" (
    "id" VARCHAR(50) NOT NULL,
    "evaluation_id" VARCHAR(50) NOT NULL,
    "key" "SopDocumentKey" NOT NULL,
    "name_fa" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "status" "SopDocumentStatus",
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "file_name" TEXT,
    "file_size" INTEGER,
    "file_data_url" TEXT,
    "uploaded_at" TIMESTAMP(3),

    CONSTRAINT "sop_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendors" (
    "id" VARCHAR(50) NOT NULL,
    "name" TEXT NOT NULL,
    "name_en" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "contact_info" TEXT,
    "registration_date" TEXT,
    "status" TEXT NOT NULL DEFAULT 'new',
    "grade" TEXT,
    "initial_sample_status" TEXT,
    "irc_expiry_date" TEXT,
    "manufacturer_id" VARCHAR(50),
    "supplier_id" VARCHAR(50),
    "risk_assessment" TEXT,
    "analysis_records" TEXT,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_materials" (
    "id" VARCHAR(50) NOT NULL,
    "vendor_id" VARCHAR(50) NOT NULL,
    "material_id" VARCHAR(50) NOT NULL,
    "is_sample" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT NOT NULL,

    CONSTRAINT "vendor_materials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" VARCHAR(50) NOT NULL,
    "vendor_id" VARCHAR(50) NOT NULL,
    "material_id" VARCHAR(50) NOT NULL,
    "period" TEXT NOT NULL,
    "commercial_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "qa_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "planning_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "finance_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "total_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grade" TEXT NOT NULL,
    "scores" TEXT,
    "raw_scores" TEXT,
    "rejection_reasons" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_assessments" (
    "id" VARCHAR(50) NOT NULL,
    "vendor_id" VARCHAR(50) NOT NULL,
    "material_criticality" INTEGER NOT NULL,
    "detectability" INTEGER NOT NULL,
    "probability" INTEGER NOT NULL,
    "sps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "risk_score" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sri" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "risk_level" "RiskLevel" NOT NULL,
    "evaluation_date" TEXT,
    "evaluator" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analysis_records" (
    "id" VARCHAR(50) NOT NULL,
    "vendor_id" VARCHAR(50) NOT NULL,
    "record_date" TEXT,
    "qc_code" TEXT,
    "decision" "AnalysisDecision" NOT NULL,
    "deviation_reason" "DeviationReason" NOT NULL DEFAULT 'None',
    "comments" TEXT,
    "recorded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analysis_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" VARCHAR(50) NOT NULL,
    "vendor_id" VARCHAR(50) NOT NULL,
    "action" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" VARCHAR(50) NOT NULL,
    "audit_id" VARCHAR(50) NOT NULL,
    "correlation_id" VARCHAR(50),
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user_id" VARCHAR(50),
    "user_name" VARCHAR(100),
    "role" VARCHAR(50),
    "module" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(100),
    "entity_id" VARCHAR(50),
    "entity_name" VARCHAR(200),
    "action" VARCHAR(50) NOT NULL,
    "severity" VARCHAR(50) NOT NULL,
    "description" TEXT,
    "reason_for_change" TEXT,
    "before_data" JSONB,
    "after_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- CreateIndex
CREATE INDEX "materials_cas_idx" ON "materials"("cas");

-- CreateIndex
CREATE INDEX "materials_irc_idx" ON "materials"("irc");

-- CreateIndex
CREATE INDEX "business_partners_type_idx" ON "business_partners"("type");

-- CreateIndex
CREATE INDEX "business_partners_status_idx" ON "business_partners"("status");

-- CreateIndex
CREATE INDEX "business_partners_manufacturer_id_idx" ON "business_partners"("manufacturer_id");

-- CreateIndex
CREATE UNIQUE INDEX "supplier_evaluations_partner_id_key" ON "supplier_evaluations"("partner_id");

-- CreateIndex
CREATE INDEX "sop_documents_evaluation_id_idx" ON "sop_documents"("evaluation_id");

-- CreateIndex
CREATE UNIQUE INDEX "sop_documents_evaluation_id_key_key" ON "sop_documents"("evaluation_id", "key");

-- CreateIndex
CREATE INDEX "vendors_status_idx" ON "vendors"("status");

-- CreateIndex
CREATE INDEX "vendors_grade_idx" ON "vendors"("grade");

-- CreateIndex
CREATE INDEX "vendors_manufacturer_id_idx" ON "vendors"("manufacturer_id");

-- CreateIndex
CREATE INDEX "vendors_supplier_id_idx" ON "vendors"("supplier_id");

-- CreateIndex
CREATE INDEX "vendor_materials_material_id_idx" ON "vendor_materials"("material_id");

-- CreateIndex
CREATE INDEX "vendor_materials_category_idx" ON "vendor_materials"("category");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_materials_vendor_id_material_id_key" ON "vendor_materials"("vendor_id", "material_id");

-- CreateIndex
CREATE INDEX "evaluations_vendor_id_idx" ON "evaluations"("vendor_id");

-- CreateIndex
CREATE INDEX "evaluations_material_id_idx" ON "evaluations"("material_id");

-- CreateIndex
CREATE INDEX "evaluations_period_idx" ON "evaluations"("period");

-- CreateIndex
CREATE INDEX "risk_assessments_vendor_id_idx" ON "risk_assessments"("vendor_id");

-- CreateIndex
CREATE INDEX "risk_assessments_risk_level_idx" ON "risk_assessments"("risk_level");

-- CreateIndex
CREATE INDEX "analysis_records_vendor_id_idx" ON "analysis_records"("vendor_id");

-- CreateIndex
CREATE INDEX "analysis_records_decision_idx" ON "analysis_records"("decision");

-- CreateIndex
CREATE INDEX "activity_logs_vendor_id_idx" ON "activity_logs"("vendor_id");

-- CreateIndex
CREATE INDEX "activity_logs_created_at_idx" ON "activity_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "audit_log_audit_id_key" ON "audit_log"("audit_id");

-- CreateIndex
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log"("timestamp");

-- CreateIndex
CREATE INDEX "audit_log_user_id_idx" ON "audit_log"("user_id");

-- CreateIndex
CREATE INDEX "audit_log_module_idx" ON "audit_log"("module");

-- CreateIndex
CREATE INDEX "audit_log_action_idx" ON "audit_log"("action");

-- CreateIndex
CREATE INDEX "audit_log_severity_idx" ON "audit_log"("severity");

-- CreateIndex
CREATE INDEX "audit_log_entity_id_idx" ON "audit_log"("entity_id");

-- CreateIndex
CREATE INDEX "audit_log_correlation_id_idx" ON "audit_log"("correlation_id");

-- AddForeignKey
ALTER TABLE "business_partners" ADD CONSTRAINT "business_partners_manufacturer_id_fkey" FOREIGN KEY ("manufacturer_id") REFERENCES "business_partners"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_evaluations" ADD CONSTRAINT "supplier_evaluations_partner_id_fkey" FOREIGN KEY ("partner_id") REFERENCES "business_partners"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sop_documents" ADD CONSTRAINT "sop_documents_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "supplier_evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_materials" ADD CONSTRAINT "vendor_materials_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_materials" ADD CONSTRAINT "vendor_materials_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_assessments" ADD CONSTRAINT "risk_assessments_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "analysis_records" ADD CONSTRAINT "analysis_records_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "vendors"("id") ON DELETE CASCADE ON UPDATE CASCADE;


import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';

const prisma = new PrismaClient();

async function main() {
  console.log('🔄 Starting seed process...');
  
  const jsonPath = path.join(process.cwd(), 'database', 'vendors.json');
  
  if (!fs.existsSync(jsonPath)) {
    throw new Error(`Data file not found at ${jsonPath}`);
  }
  
  const rawData = fs.readFileSync(jsonPath, 'utf8');
  const parsed = JSON.parse(rawData);
  
  if (!parsed || !parsed._relational_v2) {
    throw new Error('Database file is not in relational_v2 format. Please ensure valid file structure.');
  }
  
  console.log('🗑️ Cleaning up existing database records...');
  // Delete in correct order of dependency
  await prisma.auditLog.deleteMany();
  await prisma.evaluation.deleteMany();
  await prisma.vendorMaterial.deleteMany();
  await prisma.material.deleteMany();
  await prisma.vendor.deleteMany();
  
  console.log('🌱 Inserting Vendors...');
  const vendorsMap = parsed.vendors || {};
  const riskAssessments = parsed.risk_assessments || {};
  const analysisRecords = parsed.analysis_records || {};
  
  for (const [id, v] of Object.entries(vendorsMap)) {
    const val: any = v;
    const risk = riskAssessments[id] ? JSON.stringify(riskAssessments[id]) : null;
    const analysis = analysisRecords[id] ? JSON.stringify(analysisRecords[id]) : null;
    
    await prisma.vendor.create({
      data: {
        id: val.id,
        name: val.name,
        nameEn: val.nameEn,
        country: val.country || 'نامشخص',
        contactInfo: val.contactInfo || null,
        registrationDate: val.registrationDate || null,
        riskAssessment: risk,
        analysisRecords: analysis,
      }
    });
  }
  
  console.log('🌱 Inserting Materials...');
  const mMap = parsed.materials || {};
  for (const [id, m] of Object.entries(mMap)) {
    const val: any = m;
    await prisma.material.create({
      data: {
        id: val.id,
        name: val.name,
        nameEn: val.nameEn,
        cas: val.cas || 'N/A',
        irc: val.irc || 'N/A',
      }
    });
  }
  
  console.log('🌱 Inserting Vendor-Material Links...');
  const lMap = parsed.vendor_materials || {};
  for (const [id, l] of Object.entries(lMap)) {
    const val: any = l;
    await prisma.vendorMaterial.create({
      data: {
        id: val.id,
        vendorId: val.vendorId,
        materialId: val.materialId,
        isSample: val.isSample ?? false,
        category: val.category || 'foreign',
      }
    });
  }
  
  console.log('🌱 Inserting Evaluations...');
  const eMap = parsed.evaluations || {};
  for (const [id, ev] of Object.entries(eMap)) {
    const val: any = ev;
    await prisma.evaluation.create({
      data: {
        id: val.id,
        vendorId: val.vendorId,
        materialId: val.materialId,
        period: val.period || '۱۴۰۵-Q1',
        commercialScore: Number(val.commercialScore) || 0,
        qaScore: Number(val.qaScore) || 0,
        planningScore: Number(val.planningScore) || 0,
        financeScore: Number(val.financeScore) || 0,
        totalScore: Number(val.totalScore) || 0,
        grade: val.grade || 'C',
        scores: val.scores ? JSON.stringify(val.scores) : null,
        rawScores: val.rawScores ? JSON.stringify(val.rawScores) : null,
        rejectionReasons: val.rejectionReasons ? JSON.stringify(val.rejectionReasons) : null,
      }
    });
  }
  
  console.log('🌱 Inserting Audit Logs...');
  const logs = parsed.audit_logs || [];
  for (const log of logs) {
    const val: any = log;
    await prisma.auditLog.create({
      data: {
        id: val.id,
        vendorId: val.vendorId || null,
        user: val.user || 'کاربر سیستم',
        action: val.details || val.action || 'بروزرسانی اطلاعات',
        details: val.details || 'ارزیابی یا ویرایش تأمین‌کننده',
        createdAt: val.createdAt ? new Date(val.createdAt) : new Date(),
      }
    });
  }
  
  console.log('✅ Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

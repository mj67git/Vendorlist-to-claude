import { PrismaClient } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { generateSalt, hashPassword } from '../src/server/security/passwordService';

const prisma = new PrismaClient();

const ALLOWED_ROLES = ['admin', 'lab', 'commercial', 'qa', 'planning', 'finance'] as const;
type AllowedRole = (typeof ALLOWED_ROLES)[number];

function normalizeRole(role: unknown): AllowedRole {
  return ALLOWED_ROLES.includes(role as AllowedRole) ? (role as AllowedRole) : 'commercial';
}

async function seedUsers() {
  const usersPath = path.join(process.cwd(), 'database', 'users.json');
  if (!fs.existsSync(usersPath)) {
    console.log('ℹ️  No users.json found, skipping user seed.');
    return;
  }

  const users = JSON.parse(fs.readFileSync(usersPath, 'utf8')) as Record<string, any>;
  console.log('🌱 Seeding Users (passwords are salted + hashed)...');

  for (const [key, u] of Object.entries(users)) {
    const username = (u.username || key).toLowerCase();
    const salt = generateSalt();
    // Support both legacy plaintext and pre-hashed { hash, salt } shapes.
    let passwordHash: string;
    let passwordSalt: string;
    if (u.password && typeof u.password === 'object' && u.password.hash) {
      passwordHash = u.password.hash;
      passwordSalt = u.password.salt;
    } else {
      passwordSalt = salt;
      passwordHash = hashPassword(String(u.password ?? '123'), salt);
    }

    await prisma.user.upsert({
      where: { username },
      update: {
        name: u.name || username,
        role: normalizeRole(u.role),
      },
      create: {
        username,
        name: u.name || username,
        role: normalizeRole(u.role),
        passwordHash,
        passwordSalt,
        mustChangePassword: u.mustChangePassword ?? true,
      },
    });
  }
}

async function main() {
  console.log('🔄 Starting seed process...');

  await seedUsers();

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
  
  const RISK_LEVELS = ['Low', 'Medium', 'High'];
  const DEVIATIONS = ['None', 'NCR', 'Deviation', 'OOS', 'CAPA', 'OOT', 'Complaint', 'Other'];

  for (const [id, v] of Object.entries(vendorsMap)) {
    const val: any = v;

    await prisma.vendor.create({
      data: {
        id: val.id,
        name: val.name,
        nameEn: val.nameEn,
        country: val.country || 'نامشخص',
        contactInfo: val.contactInfo || null,
        registrationDate: val.registrationDate || null,
      }
    });

    // Risk and laboratory data go into their own tables.
    //
    // They used to be written as JSON onto two columns of `vendors` that the
    // application does not read, so a seeded risk assessment or test result was
    // invisible from the moment it was loaded. Those columns are gone; this is
    // where the API reads these facts from.
    const risk: any = riskAssessments[id];
    if (risk) {
      await prisma.riskAssessment.create({
        data: {
          vendorId: val.id,
          materialCriticality: Number(risk.materialCriticality) || 0,
          detectability: Number(risk.detectability) || 0,
          probability: Number(risk.probability) || 0,
          sps: Number(risk.sps) || 0,
          riskScore: Number(risk.riskScore) || 0,
          sri: Number(risk.sri) || 0,
          riskLevel: RISK_LEVELS.includes(risk.riskLevel) ? risk.riskLevel : 'Low',
          evaluationDate: risk.date || null,
          evaluator: risk.evaluator || null,
        }
      });
    }

    for (const rec of (Array.isArray(analysisRecords[id]) ? analysisRecords[id] : []) as any[]) {
      await prisma.analysisRecord.create({
        data: {
          vendorId: val.id,
          recordDate: rec.date || null,
          qcCode: rec.qcCode || null,
          decision: rec.decision === 'Reject' ? 'Reject'
            : (rec.decision === 'Approved Conditional' || rec.decision === 'ApprovedConditional')
              ? 'ApprovedConditional' : 'Pass',
          deviationReason: DEVIATIONS.includes(rec.deviationReason) ? rec.deviationReason : 'None',
          comments: rec.comments || null,
          recordedBy: rec.recordedBy || null,
        }
      });
    }
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

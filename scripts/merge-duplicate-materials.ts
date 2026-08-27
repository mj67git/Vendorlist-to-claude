/**
 * Merge the duplicate material rows that the old source-save path minted.
 *
 * Until the material-id fix, `saveVendorToDb` derived a material id from the
 * source payload (`mat_<cas>_<irc>`) and upserted a row under it. Registering a
 * source for a substance already in the repository therefore created a second,
 * stripped-down material — name, CAS and IRC only, no standard names, no role,
 * no pharmacopoeia — and linked the source to that copy instead of the real
 * catalogue entry. The repository lists both, and reports group by the wrong one.
 *
 * This script repoints those links and removes the copies. It only ever absorbs
 * a generated `mat_*` row into a catalogue entry; two hand-created entries are
 * never merged, however similar they look, because that is a human's call.
 *
 * Usage (against the target database):
 *   DATABASE_URL=... ./node_modules/.bin/tsx scripts/merge-duplicate-materials.ts
 *   DATABASE_URL=... ./node_modules/.bin/tsx scripts/merge-duplicate-materials.ts --apply
 *
 * Without --apply nothing is written: it prints exactly what it would do.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

/** Ids in this shape were generated from a vendor payload, not entered by anyone. */
const GENERATED_ID = /^mat_/;

const PLACEHOLDER = ['n/a', 'na', '-', '', 'unknown', 'نامشخص'];

const norm = (v?: string | null) => (v || '').trim().toLowerCase();
const isReal = (v?: string | null) => !PLACEHOLDER.includes(norm(v));

type Row = Awaited<ReturnType<typeof prisma.material.findMany>>[number];

/** How much a row actually carries, used to pick a winner among generated rows. */
const richness = (m: Row) =>
  [m.standardNameFa, m.standardNameEn, m.iupac, m.role, m.pharmacopoeia, m.finalProduct, m.specificationFile]
    .filter(v => isReal(v as string | null)).length;

/**
 * Two rows describe the same substance when a strong signal agrees: a real CAS,
 * or an identical Persian or English name. A shared placeholder never counts.
 */
function sameSubstance(a: Row, b: Row): string | null {
  if (isReal(a.cas) && norm(a.cas) === norm(b.cas)) return `CAS ${a.cas}`;
  if (isReal(a.name) && norm(a.name) === norm(b.name)) return `نام فارسی «${a.name}»`;
  if (isReal(a.nameEn) && norm(a.nameEn) === norm(b.nameEn)) return `نام انگلیسی «${a.nameEn}»`;
  return null;
}

async function main() {
  const materials = await prisma.material.findMany({ orderBy: { createdAt: 'asc' } });
  const generated = materials.filter(m => GENERATED_ID.test(m.id));
  const catalogue = materials.filter(m => !GENERATED_ID.test(m.id));

  console.log(`مواد: ${materials.length} · مدخل مخزن: ${catalogue.length} · ردیف تولیدشده: ${generated.length}`);

  const plans: { duplicate: Row; canonical: Row; reason: string }[] = [];
  const unmatched: Row[] = [];

  for (const dup of generated) {
    // A catalogue entry always wins over a generated row.
    let candidates = catalogue
      .map(c => ({ c, reason: sameSubstance(dup, c) }))
      .filter((x): x is { c: Row; reason: string } => !!x.reason);

    if (candidates.length === 0) {
      // Otherwise the richest other generated row for the same substance wins,
      // so several copies of one substance collapse into one.
      candidates = generated
        .filter(g => g.id !== dup.id)
        .map(g => ({ c: g, reason: sameSubstance(dup, g) as string }))
        .filter(x => !!x.reason)
        .filter(x => richness(x.c) > richness(dup) || (richness(x.c) === richness(dup) && x.c.id < dup.id));
    }

    if (candidates.length === 0) { unmatched.push(dup); continue; }
    if (candidates.length > 1) {
      console.log(`  ⚠ ${dup.id} به بیش از یک مدخل می‌خورد (${candidates.map(x => x.c.id).join(', ')}) — رد شد، دستی بررسی شود.`);
      unmatched.push(dup);
      continue;
    }
    plans.push({ duplicate: dup, canonical: candidates[0].c, reason: candidates[0].reason });
  }

  // A row cannot be both absorbed and an absorber.
  const absorbed = new Set(plans.map(p => p.duplicate.id));
  const finalPlans = plans.filter(p => !absorbed.has(p.canonical.id));

  if (finalPlans.length === 0) {
    console.log('\nهیچ مادهٔ تکراری برای ادغام پیدا نشد.');
    if (unmatched.length) console.log(`(${unmatched.length} ردیف تولیدشده بدون مدخل متناظر — دست‌نخورده می‌مانند.)`);
    return;
  }

  console.log(`\n${finalPlans.length} ادغام${APPLY ? '' : ' (اجرای آزمایشی — چیزی نوشته نمی‌شود)'}:\n`);

  let index = 0;
  for (const { duplicate, canonical, reason } of finalPlans) {
    index += 1;
    const links = await prisma.vendorMaterial.findMany({ where: { materialId: duplicate.id } });
    const evals = await prisma.evaluation.count({ where: { materialId: duplicate.id } });

    const clashing: string[] = [];
    const movable: string[] = [];
    for (const link of links) {
      const exists = await prisma.vendorMaterial.findFirst({
        where: { vendorId: link.vendorId, materialId: canonical.id },
      });
      (exists ? clashing : movable).push(link.id);
    }

    console.log(`• ${duplicate.id} → ${canonical.id}  (${reason})`);
    console.log(`    «${duplicate.name}» → «${canonical.standardNameFa || canonical.name}»`);
    console.log(`    لینک سورس: ${movable.length} منتقل، ${clashing.length} حذف (سورس از قبل به مدخل اصلی وصل بود) · ارزیابی: ${evals}`);

    if (!APPLY) continue;

    await prisma.$transaction(async tx => {
      if (clashing.length) await tx.vendorMaterial.deleteMany({ where: { id: { in: clashing } } });
      if (movable.length) {
        await tx.vendorMaterial.updateMany({ where: { id: { in: movable } }, data: { materialId: canonical.id } });
      }
      await tx.evaluation.updateMany({ where: { materialId: duplicate.id }, data: { materialId: canonical.id } });
      await tx.material.delete({ where: { id: duplicate.id } });

      // Every change to a record is auditable (CLAUDE.md rule 2), including the
      // ones a maintenance script makes.
      await tx.auditLog.create({
        data: {
          // audit_id is VarChar(50); a generated material id alone can fill it,
          // so the duplicate is named in the description instead.
          auditId: `AUD-MERGE-${Date.now()}-${index}`,
          userName: 'اسکریپت نگهداری',
          role: 'system',
          module: 'مدیریت مواد',
          entityType: 'Material',
          entityId: canonical.id,
          entityName: canonical.standardNameFa || canonical.name,
          action: 'Update',
          severity: 'Warning',
          description: `ادغام مادهٔ تکراری ${duplicate.id} در ${canonical.id} (${reason}); ${movable.length} لینک سورس منتقل و ${clashing.length} لینک تکراری حذف شد.`,
          reasonForChange: 'پاک‌سازی ردیف‌های تکراری ساخته‌شده توسط مسیر ذخیرهٔ قدیمی سورس',
          beforeData: {
            duplicate: { id: duplicate.id, name: duplicate.name, nameEn: duplicate.nameEn, cas: duplicate.cas, irc: duplicate.irc },
            movedLinks: movable,
            removedLinks: clashing,
          },
          afterData: { canonicalId: canonical.id, canonicalName: canonical.name },
        },
      });
    });
  }

  if (unmatched.length) {
    console.log(`\n${unmatched.length} ردیف تولیدشده بدون مدخل متناظر باقی ماند (دست‌نخورده):`);
    unmatched.forEach(m => console.log(`    ${m.id} · «${m.name}» · CAS ${m.cas}`));
  }

  console.log(APPLY ? '\nانجام شد.' : '\nبرای اجرای واقعی دوباره با --apply اجرا کنید.');
}

main()
  .catch(err => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());

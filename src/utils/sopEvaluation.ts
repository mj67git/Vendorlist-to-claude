import { 
  SOPDocumentKey, 
  SOPDocumentStatus, 
  SOPDocumentEval, 
  SOPGrade, 
  SOPSupplierStatus, 
  SupplierEvaluation 
} from '../types';

export const SOP_DOCUMENTS_DEF: { key: SOPDocumentKey; nameFa: string; nameEn: string }[] = [
  { 
    key: 'manufacturerLetter', 
    nameFa: 'نامه‌نگاری و معرفی‌نامه سازنده', 
    nameEn: 'Manufacturer Letter' 
  },
  { 
    key: 'authorizedSignatory', 
    nameFa: 'صاحبان امضای مجاز', 
    nameEn: 'Authorized Signatory' 
  },
  { 
    key: 'businessLicense', 
    nameFa: 'پروانه / مجوز فعالیت قانونی', 
    nameEn: 'Business License' 
  },
  { 
    key: 'officialEnglishTranslation', 
    nameFa: 'ترجمه رسمی انگلیسی مدارک', 
    nameEn: 'Official English Translation' 
  },
  { 
    key: 'legalization', 
    nameFa: 'تاییدیه سفارت / کنسولی (لگالایزیشن)', 
    nameEn: 'Legalization' 
  }
];

export function calculateDocScore(status: SOPDocumentStatus | null): number {
  switch (status) {
    case 'Approved':
      return 20; // 100% of 20
    case 'Permit Approval':
      return 10; // 50% of 20
    case 'Expired':
      return 5;  // 25% of 20
    case 'Not Submitted':
      return 0;  // 0% of 20
    default:
      return 0;
  }
}

export function calculateGradeAndStatus(totalScore: number, isEvaluated: boolean = true): { grade: SOPGrade; status: SOPSupplierStatus } {
  if (!isEvaluated) {
    return { grade: 'Not Evaluated', status: 'Not Evaluated' };
  }
  if (totalScore >= 80) {
    return { grade: 'A', status: 'Approved Supplier' };
  } else if (totalScore >= 60) {
    return { grade: 'B', status: 'Approved with Monitoring' };
  } else if (totalScore >= 40) {
    return { grade: 'C', status: 'Conditional Supplier' };
  } else if (totalScore >= 30) {
    return { grade: 'Pending Review', status: 'Pending Review' };
  } else {
    return { grade: 'Blacklist', status: 'Blacklist' };
  }
}

/**
 * How a supplier grade is named and coloured, in one place.
 *
 * The repository badge used to have its own table that labelled grade B
 * "Permit Approval" and grade C "Expired". Those are *document* statuses from
 * the rubric above (Approved / Permit Approval / Expired / Not Submitted), not
 * verdicts about a supplier: reading "Expired" against a company says nothing
 * true about it, and the same supplier was called "Permit Approval" here and
 * "Approved with Monitoring" — its real status — two panels away.
 *
 * The wording below is `calculateGradeAndStatus`'s own, so the badge, the
 * filters and the evaluation panel finally say the same thing.
 */
export const GRADE_LABELS: Record<SOPGrade, { en: string; fa: string; tone: string }> = {
  'A': {
    en: 'Approved Supplier', fa: 'تاییدشده',
    tone: 'bg-emerald-100 text-emerald-800 border-emerald-300 dark:bg-emerald-950/60 dark:text-emerald-200 dark:border-emerald-900',
  },
  'B': {
    en: 'Approved with Monitoring', fa: 'تاییدشده با پایش',
    tone: 'bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-950/60 dark:text-blue-200 dark:border-blue-900',
  },
  'C': {
    en: 'Conditional Supplier', fa: 'مشروط',
    tone: 'bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-950/60 dark:text-amber-200 dark:border-amber-900',
  },
  'Pending Review': {
    en: 'Pending Review', fa: 'در انتظار تصمیم',
    tone: 'bg-yellow-100 text-yellow-800 border-yellow-300 dark:bg-yellow-950/60 dark:text-yellow-200 dark:border-yellow-900',
  },
  'Blacklist': {
    en: 'Blacklist', fa: 'لیست سیاه',
    tone: 'bg-rose-100 text-rose-800 border-rose-300 dark:bg-rose-950/60 dark:text-rose-200 dark:border-rose-900',
  },
  'Not Evaluated': {
    en: 'Not Evaluated', fa: 'ارزیابی نشده',
    tone: 'bg-muted text-foreground border-border',
  },
};

export const describeGrade = (grade?: string | null) =>
  GRADE_LABELS[(grade as SOPGrade)] || { en: grade || '—', fa: '', tone: 'bg-muted text-foreground border-border' };

export function getDefaultSupplierEvaluation(): SupplierEvaluation {
  const documents = {} as Record<SOPDocumentKey, SOPDocumentEval>;
  
  SOP_DOCUMENTS_DEF.forEach(def => {
    documents[def.key] = {
      key: def.key,
      nameFa: def.nameFa,
      nameEn: def.nameEn,
      status: null,
      score: 0
    };
  });

  const { grade, status } = calculateGradeAndStatus(0, false);

  return {
    documents,
    totalScore: 0,
    grade,
    status,
    updatedAt: new Date().toISOString()
  };
}

export function computeSupplierEvaluation(documents: Record<SOPDocumentKey, SOPDocumentEval>): SupplierEvaluation {
  const updatedDocs = {} as Record<SOPDocumentKey, SOPDocumentEval>;
  let totalScore = 0;
  let hasAnyEvaluatedDoc = false;

  SOP_DOCUMENTS_DEF.forEach(def => {
    const existing = documents[def.key];
    const status = existing ? existing.status : null;
    if (status !== null) {
      hasAnyEvaluatedDoc = true;
    }
    const score = calculateDocScore(status);
    totalScore += score;

    updatedDocs[def.key] = {
      ...existing,
      key: def.key,
      nameFa: def.nameFa,
      nameEn: def.nameEn,
      status,
      score
    };
  });

  const { grade, status } = calculateGradeAndStatus(totalScore, hasAnyEvaluatedDoc);

  return {
    documents: updatedDocs,
    totalScore,
    grade,
    status,
    updatedAt: new Date().toISOString()
  };
}

export function validateSupplierEvaluation(documents: Record<SOPDocumentKey, SOPDocumentEval>): { isValid: boolean; missingDocs: string[] } {
  const missingDocs: string[] = [];

  SOP_DOCUMENTS_DEF.forEach(def => {
    const doc = documents[def.key];
    if (!doc || !doc.status) {
      missingDocs.push(`${def.nameEn} (${def.nameFa})`);
    }
  });

  return {
    isValid: missingDocs.length === 0,
    missingDocs
  };
}

/**
 * Re-derive a partner's stored SOP evaluation from its documents.
 *
 * `totalScore`, `grade` and `status` are outputs of `computeSupplierEvaluation`,
 * but they are also persisted, so a record written by an older build (or edited
 * outside the app) can disagree with its own documents and the UI would keep
 * showing the stale figure. Running this on load makes the stored copy
 * self-healing, and it is a no-op when the two already agree.
 *
 * `updatedAt` is deliberately preserved: it records when a human last evaluated
 * the supplier, and recomputing must not look like a fresh evaluation.
 */
export function reconcileSupplierEvaluation<T extends { type?: string; evaluation?: SupplierEvaluation }>(partner: T): T {
  const ev = partner?.evaluation;
  if (!ev || !ev.documents) return partner;

  const fresh = computeSupplierEvaluation(ev.documents);
  if (fresh.totalScore === ev.totalScore && fresh.grade === ev.grade && fresh.status === ev.status) {
    return partner;
  }
  return { ...partner, evaluation: { ...fresh, updatedBy: ev.updatedBy, updatedAt: ev.updatedAt } };
}

/**
 * Whether a business partner may be attached to a source.
 *
 * The SOP admits only grade A suppliers ("Approved Supplier", 80 points and
 * above). Anything below that, and anything not assessed at all, is refused.
 *
 * Two things this deliberately does not do:
 *  - It does not judge manufacturers. Only suppliers are SOP-evaluated
 *    (project rule 4), so a manufacturer has no grade to test and applying the
 *    rule to one would make every manufacturer unselectable.
 *  - It offers no override. The rule is a hard gate, by decision.
 *
 * `server.ts` and `PartnerSelector` both read this, so the field the user sees
 * greyed out is exactly the one the API refuses.
 */
export function canSupplySources(
  partner: { type: string; status?: string; evaluation?: { grade?: string } | null } | null | undefined,
): { allowed: boolean; reason: string } {
  if (!partner) return { allowed: false, reason: 'شریک تجاری یافت نشد.' };

  if (partner.status === 'Blacklisted') {
    return { allowed: false, reason: 'در لیست سیاه است و قابل انتخاب نیست.' };
  }

  // Manufacturers carry no SOP evaluation; the grade rule does not apply.
  if (partner.type !== 'Supplier') return { allowed: true, reason: '' };

  const grade = partner.evaluation?.grade;
  if (!grade || grade === 'Not Evaluated') {
    return { allowed: false, reason: 'ارزیابی SOP این فروشنده انجام نشده است.' };
  }
  if (grade !== 'A') {
    return { allowed: false, reason: `گرید ارزیابی این فروشنده ${grade} است؛ طبق دستورالعمل فقط گرید A قابل انتخاب است.` };
  }
  return { allowed: true, reason: '' };
}

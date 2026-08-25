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

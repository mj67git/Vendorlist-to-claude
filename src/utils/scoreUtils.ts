// Pure scoring helpers shared by the evaluation form.
// Extracted from App.tsx; logic unchanged.
import { Vendor } from '../types';
import { FORM_LAYOUT } from '../constants/evaluationLayout';

export function calculateDeptAverage(deptId: string, deptScores: Record<string, number>) {
  const layout = FORM_LAYOUT.find(l => l.id === deptId);
  if (!layout) return 0;
  
  let total = 0;
  layout.criteria.forEach(crit => {
     const weight = crit.weight || 0;
     const score = deptScores[crit.key] || 0;
     total += (score / 5) * weight;
  });
  return Math.round(total);
}

export function getRawScoreValue(vendor: Vendor, deptId: string, critKey: string): number {
  if (!vendor) return 5;
  let raw = vendor.rawScores;
  if (typeof raw === 'string') {
    try {
      raw = JSON.parse(raw);
    } catch {
      raw = null;
    }
  }
  if (raw && (raw as any)[deptId] && (raw as any)[deptId][critKey] !== undefined) {
    return Number((raw as any)[deptId][critKey]);
  }
  
  if (vendor.scores && (vendor.scores as any)[deptId] > 0) {
    const rawVal = Number((vendor.scores as any)[deptId]);
    const deconstructed = deconstructScores(deptId, rawVal);
    if (deconstructed && deconstructed[critKey] !== undefined) {
      return deconstructed[critKey];
    }
    return Math.max(1, Math.min(5, Math.round(rawVal / 20)));
  }
  return 5;
}

export function deconstructScores(deptId: string, targetScore: number): Record<string, number> {
  const layout = FORM_LAYOUT.find(l => l.id === deptId);
  if (!layout) return {};
  
  const criteria = layout.criteria;
  const numCrit = criteria.length;
  
  let bestCombination: number[] = [];
  let bestDiff = Infinity;
  
  const search = (index: number, current: number[]) => {
    if (index === numCrit) {
      let total = 0;
      criteria.forEach((crit, idx) => {
        total += (current[idx] / 5) * crit.weight;
      });
      const calcVal = Math.round(total);
      const diff = Math.abs(calcVal - targetScore);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestCombination = [...current];
      }
      return;
    }
    for (let val = 1; val <= 5; val++) {
      search(index + 1, [...current, val]);
    }
  };
  
  search(0, []);
  
  const result: Record<string, number> = {};
  criteria.forEach((crit, idx) => {
    result[crit.key] = bestCombination[idx] !== undefined ? bestCombination[idx] : 1;
  });
  return result;
}

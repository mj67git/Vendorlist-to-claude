export interface EvaluationWeights {
  commercial: number;
  qa: number;
  planning: number;
  finance: number;
}

export interface EvaluationScores {
  commercial?: number | null;
  qa?: number | null;
  planning?: number | null;
  finance?: number | null;
}

export interface GradeTier {
  min: number;
  grade: string;
  status: string;
}

/**
 * Canonical server-side evaluation configuration.
 *
 * Values and ordering intentionally mirror the legacy implementation. They are
 * centralized here so transport and persistence code no longer own domain
 * configuration.
 */
export const CALCULATION_WEIGHTS: EvaluationWeights = {
  commercial: 0.2,
  qa: 0.4,
  planning: 0.1,
  finance: 0.3,
};

export const GRADE_TIERS: GradeTier[] = [
  { min: 80, grade: 'A', status: 'approved' },
  { min: 60, grade: 'B', status: 'approved' },
  { min: 40, grade: 'C', status: 'conditional' },
  { min: 0, grade: 'black list', status: 'rejected' },
];

/**
 * Calculates the weighted score while preserving the original arithmetic
 * order and JavaScript fallback semantics.
 */
export function calculateWeightedScore(
  scores: EvaluationScores,
  weights: EvaluationWeights = CALCULATION_WEIGHTS,
): number {
  return (
    ((scores.commercial || 0) * weights.commercial) +
    ((scores.qa || 0) * weights.qa) +
    ((scores.planning || 0) * weights.planning) +
    ((scores.finance || 0) * weights.finance)
  );
}

export function calculateRoundedWeightedScore(
  scores: EvaluationScores,
  weights: EvaluationWeights = CALCULATION_WEIGHTS,
): number {
  return Math.round(calculateWeightedScore(scores, weights));
}

export function rankVendor(
  vendorId: string,
  allVendors: any[],
  weights: EvaluationWeights = CALCULATION_WEIGHTS,
): number {
  const target = allVendors.find((vendor: any) => vendor.id === vendorId);
  if (!target) return 0;

  const isSample = !!(target.isSample || target.category === 'sample');
  const peers = allVendors.filter(
    (vendor: any) => !!(vendor.isSample || vendor.category === 'sample') === isSample,
  );

  const scoredPeers = peers.map((peer: any) => ({
    id: peer.id,
    score: Math.round(calculateWeightedScore(peer.scores || {}, weights) * 10) / 10,
  }));

  scoredPeers.sort((left, right) => right.score - left.score);
  const index = scoredPeers.findIndex(peer => peer.id === vendorId);
  return index >= 0 ? index + 1 : 0;
}

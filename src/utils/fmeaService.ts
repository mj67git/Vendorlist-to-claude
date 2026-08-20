import { RiskAssessmentData, AnalysisRecord, Vendor } from '../types';

export interface FmeaConfig {
  riskModifiers: {
    High: number;
    Medium: number;
    Low: number;
    Default: number;
  };
  labConfig: {
    baseOffset: number;
    successWeight: number;
    rejectPenalty: number;
  };
  sriConfig: {
    rpnWeight: number;
    spsWeight: number;
  };
  sriThresholds: {
    High: number;
    Medium: number;
  };
}

export class FmeaService {
  private static config: FmeaConfig = {
    riskModifiers: {
      High: 0.8,
      Medium: 0.95,
      Low: 1.05,
      Default: 0.95,
    },
    labConfig: {
      baseOffset: 0.9,
      successWeight: 0.2,
      rejectPenalty: 0.1,
    },
    sriConfig: {
      rpnWeight: 0.6,
      spsWeight: 0.4,
    },
    sriThresholds: {
      High: 76,
      Medium: 26,
    },
  };

  /**
   * Calibrate the FMEA service configuration parameters dynamically
   */
  public static calibrate(newConfig: Partial<FmeaConfig>) {
    this.config = {
      ...this.config,
      ...newConfig,
      riskModifiers: { ...this.config.riskModifiers, ...newConfig.riskModifiers },
      labConfig: { ...this.config.labConfig, ...newConfig.labConfig },
      sriConfig: { ...this.config.sriConfig, ...newConfig.sriConfig },
      sriThresholds: { ...this.config.sriThresholds, ...newConfig.sriThresholds },
    };
  }

  /**
   * Retrieve the current FMEA parameters
   */
  public static getConfig(): FmeaConfig {
    return this.config;
  }

  /**
   * Calculate Risk Level Modifier
   */
  public static calculateRiskModifier(riskLevel: string | undefined): number {
    if (!riskLevel) return this.config.riskModifiers.Default;
    const key = riskLevel as keyof typeof this.config.riskModifiers;
    return this.config.riskModifiers[key] !== undefined 
      ? this.config.riskModifiers[key] 
      : this.config.riskModifiers.Default;
  }

  /**
   * Calculate Lab Results Modifier
   */
  public static calculateLabModifier(records: AnalysisRecord[] | undefined): {
    labMod: number;
    hasLabAssessment: boolean;
    analysisMeta: { pass: number; app: number; reject: number; total: number };
  } {
    let labMod = 1.0;
    let hasLabAssessment = false;
    const analysisMeta = { pass: 0, app: 0, reject: 0, total: 0 };

    if (records && records.length > 0) {
      hasLabAssessment = true;
      const countP = records.filter(r => r.decision === 'Pass').length;
      const countA = records.filter(r => r.decision === 'Approved Conditional').length;
      const countR = records.filter(r => r.decision === 'Reject').length;
      const total = countP + countA + countR;
      
      analysisMeta.pass = countP;
      analysisMeta.app = countA;
      analysisMeta.reject = countR;
      analysisMeta.total = total;

      if (total > 0) {
        const successRate = (countP + countA) / total;
        labMod = this.config.labConfig.baseOffset + (successRate * this.config.labConfig.successWeight);
        if (countR > 0) {
          labMod -= (countR * this.config.labConfig.rejectPenalty);
        }
      }
    }

    return {
      labMod,
      hasLabAssessment,
      analysisMeta,
    };
  }

  /**
   * Calculate final recommendation engine score
   */
  public static calculateEngineScore(
    overallScore: number,
    riskLevel: string | undefined,
    records: AnalysisRecord[] | undefined
  ): {
    engineScore: number;
    riskMod: number;
    labMod: number;
    hasLabAssessment: boolean;
    analysisMeta: { pass: number; app: number; reject: number; total: number };
  } {
    const riskMod = this.calculateRiskModifier(riskLevel);
    const { labMod, hasLabAssessment, analysisMeta } = this.calculateLabModifier(records);

    let engineScore = overallScore * riskMod * labMod;
    if (engineScore < 0) {
      engineScore = 0;
    }

    return {
      engineScore: parseFloat(engineScore.toFixed(1)),
      riskMod,
      labMod,
      hasLabAssessment,
      analysisMeta,
    };
  }

  /**
   * Calculate recommended probability of failure based on SPS Score
   */
  public static getRecommendedProbability(spsScore: number): number {
    if (spsScore >= 80) return 1;
    if (spsScore >= 60) return 2;
    if (spsScore >= 40) return 3;
    if (spsScore >= 25) return 4;
    return 5;
  }

  /**
   * Calculate RPN (Risk Priority Number)
   */
  public static calculateRiskScore(criticality: number, probability: number, detectability: number): number {
    return criticality * probability * detectability;
  }

  /**
   * Calculate SRI (Supplier Risk Index)
   */
  public static calculateSRI(riskScore: number, spsScore: number): number {
    const sri = (this.config.sriConfig.rpnWeight * riskScore) + 
                (this.config.sriConfig.spsWeight * (100 - spsScore));
    return parseFloat(sri.toFixed(1));
  }

  /**
   * Determine Risk Level from SRI
   */
  public static determineRiskLevel(sri: number): 'Low' | 'Medium' | 'High' {
    if (sri >= this.config.sriThresholds.High) return 'High';
    if (sri >= this.config.sriThresholds.Medium) return 'Medium';
    return 'Low';
  }

  /**
   * Perform complete FMEA Assessment and return details
   */
  public static performAssessment(
    criticality: number,
    detectability: number,
    probability: number,
    spsScore: number
  ): {
    riskScore: number;
    sri: number;
    riskLevel: 'Low' | 'Medium' | 'High';
  } {
    const riskScore = this.calculateRiskScore(criticality, probability, detectability);
    const sri = this.calculateSRI(riskScore, spsScore);
    const riskLevel = this.determineRiskLevel(sri);

    return {
      riskScore,
      sri,
      riskLevel,
    };
  }
}

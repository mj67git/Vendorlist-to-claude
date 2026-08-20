import { Vendor, Scores } from '../types';
import jalaali from 'jalaali-js';

// Convert Persian and Arabic digits to English digits
export const toEnglishDigits = (str: string): string => {
  if (!str) return '';
  return str
    .replace(/[۰-۹]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1728))
    .replace(/[٠-٩]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 1584));
};

/**
 * Parses Shamsi (Jalali) or standard Gregorian date string to Date object
 */
export const parseShamsiOrGregorianDate = (dateStr?: string | null): Date | null => {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const clean = toEnglishDigits(dateStr.trim());
  if (!clean || clean.toLowerCase() === 'n/a' || clean === '-') return null;

  // Split by common delimiters: '/', '-', '.'
  const parts = clean.split(/[/.-]/).map(p => parseInt(p, 10)).filter(p => !isNaN(p));
  if (parts.length === 3) {
    const [y, m, d] = parts;
    // Shamsi year detection: e.g. 1380 to 1499
    if (y >= 1300 && y <= 1500 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      try {
        const { gy, gm, gd } = jalaali.toGregorian(y, m, d);
        const date = new Date(gy, gm - 1, gd);
        if (!isNaN(date.getTime())) return date;
      } catch {
        // Continue to fallback
      }
    } else if (y >= 1900 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31) {
      const date = new Date(y, m - 1, d);
      if (!isNaN(date.getTime())) return date;
    }
  }

  // Standard string fallback
  const parsed = new Date(clean);
  return isNaN(parsed.getTime()) ? null : parsed;
};

export interface LicenseExpiryStatus {
  status: 'none' | 'valid' | 'expiring_soon' | 'expired';
  daysLeft: number | null;
  message: string;
  isUrgent: boolean;
  expiryDateFormatted: string;
}

/**
 * Checks if a license/permit is expired or expiring within 60 days (2 months)
 */
export const checkLicenseExpiry = (
  expiryDateStr?: string | null,
  referenceDate: Date = new Date()
): LicenseExpiryStatus => {
  if (!expiryDateStr || !expiryDateStr.trim() || expiryDateStr.trim().toLowerCase() === 'n/a') {
    return {
      status: 'none',
      daysLeft: null,
      message: 'تاریخ انقضا ثبت نشده است',
      isUrgent: false,
      expiryDateFormatted: 'ثبت‌نشده'
    };
  }

  const trimmed = expiryDateStr.trim();
  const expiryDate = parseShamsiOrGregorianDate(trimmed);
  if (!expiryDate) {
    return {
      status: 'none',
      daysLeft: null,
      message: 'فرمت تاریخ انقضا نامعتبر است',
      isUrgent: false,
      expiryDateFormatted: trimmed
    };
  }

  // Normalize to start of day for accurate calculation
  const ref = new Date(referenceDate.getFullYear(), referenceDate.getMonth(), referenceDate.getDate());
  const exp = new Date(expiryDate.getFullYear(), expiryDate.getMonth(), expiryDate.getDate());

  const diffTime = exp.getTime() - ref.getTime();
  const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

  if (daysLeft < 0) {
    const passedDays = Math.abs(daysLeft);
    return {
      status: 'expired',
      daysLeft,
      message: `مجوز در تاریخ ${trimmed} منقضی شده است (${passedDays} روز پیش)`,
      isUrgent: true,
      expiryDateFormatted: trimmed
    };
  }

  // Expiring within 2 months (60 days)
  if (daysLeft <= 60) {
    return {
      status: 'expiring_soon',
      daysLeft,
      message: `اعلان مهم: کمتر از ۲ ماه (${daysLeft} روز) تا انقضای مجوز در تاریخ ${trimmed} باقی‌مانده است`,
      isUrgent: true,
      expiryDateFormatted: trimmed
    };
  }

  return {
    status: 'valid',
    daysLeft,
    message: `مجوز تا تاریخ ${trimmed} معتبر است (${daysLeft} روز باقی‌مانده)`,
    isUrgent: false,
    expiryDateFormatted: trimmed
  };
};

export const extractCountry = (addressStr: string | null | undefined): string => {
  if (!addressStr) return '';
  const text = addressStr.toLowerCase();
  if (text === 'unknown' || text === 'n/a' || text === 'نامشخص' || text === 'مشخص نشده') return '';
  
  if (text.includes('china') || text.includes('چین')) return 'چین (China)';
  if (text.includes('india') || text.includes('هند')) return 'هند (India)';
  if (text.includes('germany') || text.includes('آلمان')) return 'آلمان (Germany)';
  if (text.includes('iran') || text.includes('tehran') || text.includes('ایران')) return 'ایران (Iran)';
  if (text.includes('italy') || text.includes('ایتالیا')) return 'ایتالیا (Italy)';
  if (text.includes('spain') || text.includes('اسپانیا')) return 'اسپانیا (Spain)';
  if (text.includes('france') || text.includes('فرانسه')) return 'فرانسه (France)';
  if (text.includes('uk') || text.includes('united kingdom') || text.includes('انگلیس')) return 'انگلستان (UK)';
  if (text.includes('usa') || text.includes('united states') || text.includes('آمریکا')) return 'آمریکا (USA)';
  if (text.includes('switzerland') || text.includes('سوئیس')) return 'سوئیس (Switzerland)';
  if (text.includes('japan') || text.includes('ژاپن')) return 'ژاپن (Japan)';
  if (text.includes('korea') || text.includes('کره')) return 'کره جنوبی (South Korea)';
  if (text.includes('turkey') || text.includes('ترکیه')) return 'ترکیه (Turkey)';
  if (text.includes('uae') || text.includes('emirates') || text.includes('امارات')) return 'امارات (UAE)';
  if (text.includes('taiwan') || text.includes('تایوان')) return 'تایوان (Taiwan)';
  if (text.includes('saudi') || text.includes('عربستان')) return 'عربستان (Saudi Arabia)';
  if (text.includes('austria') || text.includes('اتریش')) return 'اتریش (Austria)';
  if (text.includes('thailand') || text.includes('تایلند')) return 'تایلند (Thailand)';
  if (text.includes('ireland') || text.includes('ایرلند')) return 'ایرلند (Ireland)';

  return '';
};

export const getDisplayCountry = (vendor: Vendor): string => {
  if (vendor.country && vendor.country !== 'نامشخص' && vendor.country !== 'مشخص نشده' && vendor.country.toLowerCase() !== 'unknown' && vendor.country.toLowerCase() !== 'n/a') {
    return vendor.country;
  }
  const extracted = extractCountry(vendor.contactInfo);
  if (extracted) {
    return extracted;
  }
  if (vendor.contactInfo && vendor.contactInfo.toLowerCase() !== 'unknown' && vendor.contactInfo.toLowerCase() !== 'n/a' && vendor.contactInfo !== 'نامشخص' && vendor.contactInfo !== 'مشخص نشده') {
    return vendor.contactInfo;
  }
  return '';
};

export let CALCULATION_WEIGHTS = {
  commercial: 0.2,
  qa: 0.4,
  planning: 0.1,
  finance: 0.3
};

export const setCalculationWeights = (newWeights: any) => {
  if (newWeights) {
    CALCULATION_WEIGHTS = { ...CALCULATION_WEIGHTS, ...newWeights };
  }
};

export function calculateOverallScore(scores: Scores | null, forceCalculate: boolean = false) {
  if (!scores) return null;
  const values = [scores.commercial || 0, scores.qa || 0, scores.planning || 0, scores.finance || 0];
  const hasAnyScore = values.some(v => v > 0);
  const isFullyScored = values.every(v => v > 0);
  
  if (!hasAnyScore) return 0;
  if (!isFullyScored && !forceCalculate) return null;
  
  return Math.round(
    ((scores.commercial || 0) * CALCULATION_WEIGHTS.commercial) +
    ((scores.qa || 0) * CALCULATION_WEIGHTS.qa) +
    ((scores.planning || 0) * CALCULATION_WEIGHTS.planning) +
    ((scores.finance || 0) * CALCULATION_WEIGHTS.finance)
  );
}

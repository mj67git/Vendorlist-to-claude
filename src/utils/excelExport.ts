import * as XLSX from 'xlsx-js-style';
import { Vendor, Scores, BusinessPartner, Material } from '../types';

/**
 * Calculates the overall evaluation score for a vendor.
 */
function calculateOverallScore(scores: Scores | null, forceCalculate: boolean = false): number | null {
  if (!scores) return null;
  const isFullyScored = scores.commercial > 0 && scores.qa > 0 && scores.planning > 0 && scores.finance > 0;
  if (!isFullyScored && !forceCalculate) return null;
  return Math.round(
    ((scores.commercial || 0) * 0.2) +
    ((scores.qa || 0) * 0.4) +
    ((scores.planning || 0) * 0.1) +
    ((scores.finance || 0) * 0.3)
  );
}

/**
 * Returns a descriptive Persian label for the material criticality (substance type).
 */
function getMaterialType(vendor: Vendor): string {
  if (vendor.riskAssessment?.materialCriticality) {
    const crit = vendor.riskAssessment.materialCriticality;
    if (crit === 5) return 'ماده موثره دارویی (API)';
    if (crit === 4) return 'اکسپیانت (Excipient)';
    if (crit === 3) return 'حدواسط شیمیایی، حلال یا واکنشگر';
    if (crit === 2) return 'اقلام بسته‌بندی اولیه';
    if (crit === 1) return 'اقلام بسته‌بندی ثانویه';
  }

  const nameEnLower = (vendor.materialEn || '').toLowerCase();
  const nameFa = vendor.material || '';

  if (vendor.category === 'packaging') return 'اقلام بسته‌بندی';
  if (nameEnLower.includes('excipient') || nameFa.includes('اکسپیانت')) return 'اکسپیانت (Excipient)';
  if (nameEnLower.includes('intermediate') || nameFa.includes('حدواسط')) return 'حدواسط شیمیایی';
  if (nameEnLower.includes('solvent') || nameFa.includes('حلال')) return 'حلال / واکنشگر';

  return 'ماده موثره دارویی (API)'; // Default fallback matching industrial expectation
}

/**
 * Maps the English risk assessment level to formatted Persian text.
 */
function getRiskLevelFa(riskLevel: string | undefined): string {
  if (!riskLevel) return 'ارزیابی نشده';
  switch (riskLevel) {
    case 'Low':
      return 'پایین (Low)';
    case 'Medium':
      return 'متوسط (Medium)';
    case 'High':
      return 'بالا (High)';
    default:
      return riskLevel;
  }
}

/**
 * Compiles a clean, comma-separated summary of all laboratory and quality deviations.
 */
function getDeviationsSummary(vendor: Vendor): string {
  const records = vendor.analysisRecords;
  if (!records || records.length === 0) {
    return 'فاقد سوابق انحراف یا آزمایش مردود (بدون پرونده فعال)';
  }

  let oosCount = 0;
  let ootCount = 0;
  let devCount = 0;
  let rejectionCount = 0;
  let ncrCount = 0;
  let capaCount = 0;
  let complaintCount = 0;

  records.forEach(r => {
    const reason = (r.deviationReason || '').toUpperCase();
    const dec = (r.decision || '').toUpperCase();

    if (reason === 'OOS') oosCount++;
    else if (reason === 'OOT') ootCount++;
    else if (reason === 'DEVIATION') devCount++;
    else if (reason === 'NCR') ncrCount++;
    else if (reason === 'CAPA') capaCount++;
    else if (reason === 'COMPLAINT') complaintCount++;

    if (dec === 'REJECT') rejectionCount++;
  });

  if (vendor.rejectionReasons && vendor.rejectionReasons.length > 0) {
    rejectionCount += vendor.rejectionReasons.length;
  }

  const parts: string[] = [];
  if (oosCount > 0) parts.push(`OOS (${oosCount} مورد)`);
  if (ootCount > 0) parts.push(`OOT (${ootCount} مورد)`);
  if (devCount > 0) parts.push(`Deviation (${devCount} مورد)`);
  if (rejectionCount > 0) parts.push(`Rejection/مردود (${rejectionCount} مورد)`);
  if (ncrCount > 0) parts.push(`NCR (${ncrCount} مورد)`);
  if (capaCount > 0) parts.push(`CAPA (${capaCount} مورد)`);
  if (complaintCount > 0) parts.push(`شکایت (${complaintCount} مورد)`);

  if (parts.length === 0) {
    const passCount = records.filter(r => r.decision === 'Pass').length;
    const condCount = records.filter(r => r.decision === 'Approved Conditional').length;
    return `تحویل ${records.length} مرسوله بدون انحراف (${passCount} پاس، ${condCount} مشروط)`;
  }

  return `دارای سوابق: ${parts.join(' | ')}`;
}

function getPartnerDetails(v: Vendor, partners: BusinessPartner[] = []) {
  let mfgPartner = partners.find(p => p.id === v.manufacturerId);
  let supPartner = partners.find(p => p.id === v.supplierId);

  const matchedPartner = partners.find(p => p.name.trim().toLowerCase() === v.name.trim().toLowerCase());
  if (matchedPartner) {
    if (matchedPartner.type === 'Supplier') {
      if (!supPartner) supPartner = matchedPartner;
      if (!mfgPartner && matchedPartner.manufacturerId) {
        mfgPartner = partners.find(p => p.id === matchedPartner.manufacturerId);
      }
    } else if (matchedPartner.type === 'Manufacturer') {
      if (!mfgPartner) mfgPartner = matchedPartner;
    }
  }

  // Manufacturer Name
  const mfgName = mfgPartner ? mfgPartner.name : v.name;

  // Manufacturer Address / Contact
  let mfgContact = '';
  if (mfgPartner) {
    const parts = [mfgPartner.country, mfgPartner.address, mfgPartner.phone, mfgPartner.email].filter(Boolean);
    mfgContact = parts.length > 0 ? parts.join(' - ') : (mfgPartner.country || 'نامشخص');
  } else {
    mfgContact = v.contactInfo || (v.country && v.country !== 'نامشخص' ? v.country : 'ثبت‌نشده');
  }

  // Supplier Name & Address / Contact
  let supName = 'خرید بی‌واسطه از تولیدکننده';
  let supContact = 'مستقیم از کارخانه سازنده';

  if (supPartner) {
    supName = supPartner.name;
    const parts = [supPartner.country, supPartner.address, supPartner.phone, supPartner.email].filter(Boolean);
    supContact = parts.length > 0 ? parts.join(' - ') : (supPartner.country || 'نامشخص');
  }

  return { mfgName, mfgContact, supName, supContact };
}

/**
 * Exports targeted database categories to beautifully-styled Microsoft Excel files.
 */
export function buildCategoryWorksheet(
  vendors: Vendor[],
  categoryId: string | 'all',
  partners: BusinessPartner[] = [],
  materials: Material[] = []
): { ws: XLSX.WorkSheet, vendorCount: number } {
  // Filter appropriate vendors
  const filteredVendors = vendors.filter(v => {
    if (categoryId === 'all') return true;
    if (categoryId === 'sample') return v.isSample || v.category === 'sample';
    if (categoryId === 'blacklist') return !v.isSample && v.category !== 'sample' && (v.category === 'blacklist' || v.status === 'rejected' || v.grade === 'rejected');
    return v.category === categoryId;
  });

  // Sort vendors by Persian material name so consecutive rows of identical materials group together for merging
  const sortedVendors = [...filteredVendors].sort((a, b) => {
    const matA = a.material || '';
    const matB = b.material || '';
    return matA.localeCompare(matB, 'fa');
  });

  // Compile headers with requested structure and material repository columns
  const headers = [
    'ردیف',
    'نام فارسی ماده / کالا',
    'نام انگلیسی ماده / کالا',
    'شماره ثبت CAS No',
    'نقش ماده',
    'محصول نهایی',
    'نام استاندارد فارسی',
    'نام استاندارد انگلیسی',
    'کد IRC',
    'تاریخ صدور/ثبت کالا',
    'تولید کننده',
    'آدرس تولید کننده',
    'فروشنده',
    'آدرس فروشنده',
    'امتیاز ارزیابی کل (از ۱۰۰)',
    'سطح ریسک کیفی',
    'کد QC',
    'سوابق انحرافات (OOS, OOT, Deviation, Rejection, Return Records)'
  ];

  // Map to Excel rows (with 1-based indexing)
  const dataRows = sortedVendors.map((v, index) => {
    const overallScore = calculateOverallScore(v.scores, true);
    const gradeVal = v.grade || '';
    let scoreStr = 'ارزیابی‌نشده';
    
    let effectiveGrade = '';
    if (overallScore !== null) {
      if (overallScore >= 80) effectiveGrade = 'A';
      else if (overallScore >= 60) effectiveGrade = 'B';
      else if (overallScore >= 40) effectiveGrade = 'C';
      else if (overallScore >= 30) effectiveGrade = 'Pending Review';
      else effectiveGrade = 'Blacklist';
    } else if (gradeVal && gradeVal !== 'new' && gradeVal !== 'rejected') {
      effectiveGrade = gradeVal;
    } else if (v.status === 'rejected') {
      effectiveGrade = 'Blacklist';
    }

    if (effectiveGrade === 'A' || effectiveGrade === 'a') {
      scoreStr = overallScore !== null ? `Grade A (${overallScore})` : 'Grade A';
    } else if (effectiveGrade === 'B' || effectiveGrade === 'b') {
      scoreStr = overallScore !== null ? `Grade B (${overallScore})` : 'Grade B';
    } else if (effectiveGrade === 'C' || effectiveGrade === 'c') {
      scoreStr = overallScore !== null ? `Grade C (${overallScore})` : 'Grade C';
    } else if (effectiveGrade === 'Pending Review' || effectiveGrade === 'pending') {
      scoreStr = overallScore !== null ? `Pending Review (${overallScore})` : 'Pending Review';
    } else if (effectiveGrade === 'Blacklist' || effectiveGrade === 'rejected') {
      scoreStr = overallScore !== null ? `Blacklist (${overallScore})` : 'Blacklist';
    }

    const riskText = getRiskLevelFa(v.riskAssessment?.riskLevel);
    const deviationSummary = getDeviationsSummary(v);

    // Extract material details from material repository
    const matItem = materials.find(m => 
      (v.materialId && m.id === v.materialId) ||
      (m.cas && v.cas && m.cas.trim().toLowerCase() === v.cas.trim().toLowerCase()) ||
      (m.nameFa && v.material && m.nameFa.trim().toLowerCase() === v.material.trim().toLowerCase()) ||
      (m.nameEn && v.materialEn && m.nameEn.trim().toLowerCase() === v.materialEn.trim().toLowerCase())
    );

    const roleStr = matItem?.role || 'ثبت‌نشده';
    const finalProductStr = matItem?.finalProduct || 'ثبت‌نشده';
    const standardNameFaStr = matItem?.standardNameFa || v.material || 'ثبت‌نشده';
    const standardNameEnStr = matItem?.standardNameEn || v.materialEn || 'ثبت‌نشده';

    // Get all unique active QC Codes for this vendor/source
    const qcCodesList = (v.analysisRecords || [])
      .map(r => r.qcCode)
      .filter(code => code && code.trim() !== '');
    const uniqueQcCodes = Array.from(new Set(qcCodesList));
    const qcCodesStr = uniqueQcCodes.length > 0 ? uniqueQcCodes.join(' | ') : 'ثبت‌نشده';

    const partnerInfo = getPartnerDetails(v, partners);

    // Fill in the IRC/registration date from lastAudit (which holds IRC Issue Date) or registrationDate
    const registrationDateStr = v.lastAudit || v.registrationDate || 'ثبت‌نشده';

    return [
      (index + 1).toString(),
      v.material || 'N/A',
      v.materialEn || 'N/A',
      v.cas || matItem?.cas || 'N/A',
      roleStr,
      finalProductStr,
      standardNameFaStr,
      standardNameEnStr,
      v.irc || 'N/A',
      registrationDateStr,
      partnerInfo.mfgName,
      partnerInfo.mfgContact,
      partnerInfo.supName,
      partnerInfo.supContact,
      scoreStr,
      riskText,
      qcCodesStr,
      deviationSummary
    ];
  });

  // If no data rows, add a placeholder row
  const rowsToRender = dataRows.length > 0 ? dataRows : [
    ['-', 'موردی در این دسته‌بندی یافت نشد', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-', '-']
  ];

  // Create workspace worksheet using array of arrays
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rowsToRender]);

  // Determine merge ranges for consecutive equivalent materials
  const merges: XLSX.Range[] = [];
  if (sortedVendors.length > 0) {
    let i = 0;
    while (i < sortedVendors.length) {
      let j = i + 1;
      while (j < sortedVendors.length && sortedVendors[j].material === sortedVendors[i].material) {
        j++;
      }
      
      // If we have consecutive matches
      if (j - i > 1) {
        const startRow = i + 1; // 1-based (row 0 is header)
        const endRow = j;       // 1-based index corresponding to element j-1
        
        // Merge columns 1 to 7 (Persian name, English name, CAS, role, final product, std name fa, std name en)
        for (let c = 1; c <= 7; c++) {
          merges.push({
            s: { r: startRow, c: c },
            e: { r: endRow, c: c }
          });
        }
      }
      i = j;
    }
  }
  
  if (merges.length > 0) {
    ws['!merges'] = merges;
  }

  // Pre-calculate alternating background color groups by material name
  const vendorGroupColors = new Array(sortedVendors.length);
  let colorToggle = 0;
  let prevMaterial = '';
  for (let idx = 0; idx < sortedVendors.length; idx++) {
    const mat = sortedVendors[idx].material || '';
    if (idx > 0 && mat !== prevMaterial) {
      colorToggle = 1 - colorToggle;
    }
    // Toggle between slate greys (F1F5F9 for high contrast grouping) and pure white (FFFFFF)
    vendorGroupColors[idx] = colorToggle === 0 ? 'F1F5F9' : 'FFFFFF';
    prevMaterial = mat;
  }

  // Apply beautiful styling cell-by-cell
  for (const key in ws) {
    if (key[0] === '!') continue; // skip standard formatting keys
    
    const cell = ws[key];
    const match = key.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    
    const colLetter = match[1];
    const rowNumber = parseInt(match[2], 10);
    
    const colIndex = XLSX.utils.decode_col(colLetter);
    const rowIndex = rowNumber - 1; // 0-based
    
    if (rowIndex === 0) {
      // Header styles (Dark Teal/Navy Corporate style)
      cell.s = {
        fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
        font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: '475569' } },
          bottom: { style: 'medium', color: { rgb: '0F172A' } },
          left: { style: 'thin', color: { rgb: '475569' } },
          right: { style: 'thin', color: { rgb: '475569' } }
        }
      };
    } else {
      // Data Rows styles - color based on material group to highlight rows grouping under same material
      const dataRowIdx = rowIndex - 1;
      const rowBgColor = vendorGroupColors[dataRowIdx] || 'FFFFFF';
      
      cell.s = {
        fill: { patternType: 'solid', fgColor: { rgb: rowBgColor } },
        font: { name: 'Segoe UI', sz: 9, color: { rgb: '1E293B' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: 'E2E8F0' } },
          bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
          left: { style: 'thin', color: { rgb: 'E2E8F0' } },
          right: { style: 'thin', color: { rgb: 'E2E8F0' } }
        }
      };

      // Chemical description texts colors
      if (colIndex >= 1 && colIndex <= 9) {
        cell.s.font.color = { rgb: '0F172A' };
      }

      // Left-align long texts, right-align partner/supplier information/devs
      if ((colIndex >= 10 && colIndex <= 13) || colIndex === 17) {
        cell.s.alignment.horizontal = 'right';
      }

      // Color score columns (امتیاز ارزیابی کل)
      if (colIndex === 14) {
        const valLower = String(cell.v || '').toLowerCase();
        if (valLower.includes('grade a') || valLower === 'a') {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'D1FAE5' } };
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '059669' } }; // Green / Emerald-600
        } else if (valLower.includes('grade b') || valLower === 'b') {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'DBEAFE' } };
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '0071E3' } }; // Royal Blue (App theme)
        } else if (valLower.includes('grade c') || valLower === 'c') {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } }; // Light Amber / Yellow-100
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'D97706' } }; // Amber-600
        } else if (valLower.includes('pending review') || valLower.includes('pending')) {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEF9C3' } }; // Yellow-100
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'CA8A04' } }; // Yellow-700
        } else if (valLower.includes('blacklist') || valLower.includes('rejected') || valLower === 'd') {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } };
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'DC2626' } }; // Red-600
        }
      }

      // Color quality risk levels (سطح ریسک کیفی)
      if (colIndex === 15) {
        const valLower = String(cell.v || '').toLowerCase();
        if (valLower.includes('high') || valLower.includes('بالا')) {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } };
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'DC2626' } }; // Red-600
        } else if (valLower.includes('medium') || valLower.includes('متوسط')) {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } };
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'D97706' } }; // Amber-600
        } else if (valLower.includes('low') || valLower.includes('پایین') || valLower.includes('پايين')) {
          cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'D1FAE5' } };
          cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '059669' } }; // Emerald-600
        }
      }

      // Colorize deviations text
      if (colIndex === 17) {
        const val = String(cell.v || '');
        if (val.includes('OOS') || val.includes('OOT') || val.includes('Deviation') || val.includes('Rejection') || val.includes('مردود')) {
          cell.s.font.color = { rgb: '991B1B' };
        }
      }
    }
  }

  // Design column layouts (widths) for high readability in MS Excel
  ws['!cols'] = [
    { wch: 6 },   // Row index (0)
    { wch: 25 },  // Persian name (1)
    { wch: 25 },  // English name (2)
    { wch: 15 },  // CAS No (3)
    { wch: 18 },  // Role (4)
    { wch: 22 },  // Final Product (5)
    { wch: 25 },  // Standard Name Fa (6)
    { wch: 25 },  // Standard Name En (7)
    { wch: 15 },  // IRC Code (8)
    { wch: 18 },  // IRC / Registration Date (9)
    { wch: 28 },  // Manufacturer Name (10)
    { wch: 38 },  // Manufacturer Address (11)
    { wch: 28 },  // Supplier Name (12)
    { wch: 38 },  // Supplier Address (13)
    { wch: 18 },  // Overall Score (14)
    { wch: 15 },  // Risk Level (15)
    { wch: 22 },  // QC Code Column width (16)
    { wch: 58 },  // Deviations summary (17)
  ];

  // Set page margins / right-to-left layout indicator in sheet view
  if (!ws['!views']) ws['!views'] = [];
  ws['!views'].push({ RTL: true });

  return { ws, vendorCount: filteredVendors.length };
}

/**
 * Standard categories configuration for export.
 */
export const EXPORT_CATEGORIES = [
  { id: 'foreign', labelFa: 'خرید خارجی' },
  { id: 'domestic', labelFa: 'خرید داخلی' },
  { id: 'veterinary', labelFa: 'دامی' },
  { id: 'packaging', labelFa: 'اقلام بسته بندی' },
  { id: 'sample', labelFa: 'نمونه' },
  { id: 'blacklist', labelFa: 'لیست سیاه' }
];

/**
 * Exports a single targeted category to an Excel file.
 */
export function exportCategoryToExcel(
  vendors: Vendor[],
  categoryId: string | 'all',
  categoryLabelFa: string,
  partners: BusinessPartner[] = [],
  materials: Material[] = []
) {
  const { ws } = buildCategoryWorksheet(vendors, categoryId, partners, materials);
  const wb = XLSX.utils.book_new();
  const sheetName = categoryLabelFa.slice(0, 31); // Sheets names are capped at 31 chars in Excel
  XLSX.utils.book_append_sheet(wb, ws, sheetName);

  // Generate Excel download for user. Filename includes timestamp and proper extension.
  const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
  const safeTitle = `گزارش_${categoryLabelFa.replace(/\s+/g, '_')}_${dateStr}`;
  XLSX.writeFile(wb, `${safeTitle}.xlsx`);
}

/**
 * Exports the full vendor archive as a Multi-Sheet Excel Workbook
 * containing a summary sheet for all categories + a dedicated sheet for each individual category.
 */
export function exportFullArchiveMultiSheetExcel(
  vendors: Vendor[],
  partners: BusinessPartner[] = [],
  materials: Material[] = []
) {
  const wb = XLSX.utils.book_new();

  // 1. First Sheet: All Categories (کل آرشیو)
  const { ws: wsAll } = buildCategoryWorksheet(vendors, 'all', partners, materials);
  XLSX.utils.book_append_sheet(wb, wsAll, 'کل آرشیو');

  // 2. Individual Category Sheets
  for (const cat of EXPORT_CATEGORIES) {
    const { ws: wsCat } = buildCategoryWorksheet(vendors, cat.id, partners, materials);
    const sheetName = cat.labelFa.slice(0, 31);
    XLSX.utils.book_append_sheet(wb, wsCat, sheetName);
  }

  // Generate multi-sheet workbook download
  const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
  const safeTitle = `گزارش_جامع_چند_شیتی_تامین_کنندگان_${dateStr}`;
  XLSX.writeFile(wb, `${safeTitle}.xlsx`);
}

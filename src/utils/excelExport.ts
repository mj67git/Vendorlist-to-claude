import * as XLSXModule from 'xlsx-js-style';

/**
 * `xlsx-js-style` ships CommonJS. Vite's interop hands the namespace back with
 * the exports attached, Node's ESM loader hands back `{ default: … }` — so the
 * bare namespace import worked in the browser and threw
 * "Cannot read properties of undefined (reading 'aoa_to_sheet')" in a test,
 * which is why this file had no tests while it grew a one-column-off bug.
 * The namespace stays imported for its types; the runtime call goes through XL.
 */
import type * as XLSX from 'xlsx-js-style';
const XL: typeof XLSX = (XLSXModule as any).default ?? (XLSXModule as any);
import { Vendor, Scores, BusinessPartner, Material } from '../types';
import { isVendorRejected, isInBlacklistCategory } from './vendorState';
import { formatContactLine, resolveVendorPartner } from './vendorPartner';
import { formatSelectionDate, selectionForVendor, type SourceSelectionRecord } from './sourceSelection';
import { describeVendorRank, UNEVALUATED_LABEL } from './vendorRank';
import { calculateOverallScore } from './vendorUtils';
import { canSupplySources } from './sopEvaluation';
import { getMaterialRole } from '../constants/materialRoles';
import { AUDIT_ACTION_LABELS, AUDIT_MODULE_LABELS } from './auditTaxonomy';

/**
 * Column positions in the archive worksheet.
 *
 * These were written as bare numbers in three places and two of them were one
 * off: the conditional formatting for «امتیاز ارزیابی کل» ran against the risk
 * cell and the formatting for «سطح ریسک کیفی» against the QC-code cell, so
 * neither column was ever coloured and forty lines of styling did nothing. A
 * named constant is checkable; `colIndex === 14` is not.
 */
const COL = {
  INDEX: 0,
  NAME_FA: 1,
  NAME_EN: 2,
  CAS: 3,
  ROLE: 4,
  FINAL_PRODUCT: 5,
  STD_FA: 6,
  STD_EN: 7,
  IRC: 8,
  REG_DATE: 9,
  PARTNER: 10,
  PARTNER_ROLE: 11,
  CONTACT: 12,
  SCORE: 13,
  RISK: 14,
  QC: 15,
  DEVIATIONS: 16,
  CHOSEN: 17,
  CHOSEN_REASON: 18,
  CHOSEN_BY: 19,
  SCORE_NUM: 20,
} as const;

/** What an empty cell says. Latin «N/A» sat next to Persian «ثبت‌نشده» in the same row. */
const NOT_RECORDED = 'ثبت‌نشده';

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
  if (!riskLevel) return UNEVALUATED_LABEL;
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


/**
 * Exports targeted database categories to beautifully-styled Microsoft Excel files.
 */
export function buildCategoryWorksheet(
  vendors: Vendor[],
  categoryId: string | 'all',
  partners: BusinessPartner[] = [],
  materials: Material[] = [],
  selections: SourceSelectionRecord[] = [],
  /**
   * What the caller filtered by, printed above the header the way the printed
   * register prints it. A sheet that does not say what it excluded cannot be
   * read as evidence of anything a month later.
   */
  filterSummary?: string
): { ws: XLSX.WorkSheet, vendorCount: number } {
  // Filter appropriate vendors
  const filteredVendors = vendors.filter(v => {
    if (categoryId === 'all') return true;
    if (categoryId === 'sample') return v.isSample || v.category === 'sample';
    if (categoryId === 'blacklist') return isInBlacklistCategory(v);
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
    'تأمین‌کننده',
    'نوع تأمین‌کننده',
    'آدرس و اطلاعات تماس',
    'امتیاز ارزیابی کل (از ۱۰۰)',
    'سطح ریسک کیفی',
    'کد QC',
    'سوابق انحرافات (OOS, OOT, Deviation, Rejection, Return Records)',
    // Appended at the end on purpose: anything keyed to the existing column
    // positions (a saved filter, a pivot, someone's macro) keeps working.
    // "بله"/"—" rather than a star, because a spreadsheet is filtered and
    // pivoted on its values and a glyph sorts as punctuation.
    'سورس منتخب',
    'دلیل انتخاب',
    'ثبت‌کنندهٔ انتخاب',
    // The grade column carries its score inside a sentence («Grade B (72)»),
    // which cannot be sorted, averaged or pivoted on. The number gets its own
    // cell rather than replacing that column, so nothing keyed to the existing
    // positions moves.
    'امتیاز عددی (۰-۱۰۰)'
  ];

  // Map to Excel rows (with 1-based indexing)
  const dataRows = sortedVendors.map((v, index) => {
    // One rank scale for a source, shared with the printed form (vendorRank.ts).
    // A rejected source keeps saying so: blacklisting is a state the register
    // must show, and it outranks whatever the arithmetic says.
    const rank = describeVendorRank(v);
    const scoreStr = isVendorRejected(v)
      ? (rank.score !== null ? `Blacklist (${rank.score})` : 'Blacklist')
      : rank.label;

    const riskText = getRiskLevelFa(v.riskAssessment?.riskLevel);
    const deviationSummary = getDeviationsSummary(v);

    // Extract material details from material repository
    const matItem = materials.find(m => 
      (v.materialId && m.id === v.materialId) ||
      (m.cas && v.cas && m.cas.trim().toLowerCase() === v.cas.trim().toLowerCase()) ||
      (m.nameFa && v.material && m.nameFa.trim().toLowerCase() === v.material.trim().toLowerCase()) ||
      (m.nameEn && v.materialEn && m.nameEn.trim().toLowerCase() === v.materialEn.trim().toLowerCase())
    );

    // The label the operator picked in the form, not the value the column
    // stores. `Reagent / Reactant` and `Packaging Item` are persisted spellings
    // that must not be renamed (every generated standard name uses them), and
    // the whole interface shows them as «Reagent» and «Packaging». The export
    // was the one place that leaked the stored form, so a sheet said
    // "Reagent / Reactant" for a source the form calls "Reagent".
    const roleStr = matItem?.role ? getMaterialRole(matItem.role).labelEn : NOT_RECORDED;
    const finalProductStr = matItem?.finalProduct || NOT_RECORDED;
    const standardNameFaStr = matItem?.standardNameFa || v.material || NOT_RECORDED;
    const standardNameEnStr = matItem?.standardNameEn || v.materialEn || NOT_RECORDED;

    // Get all unique active QC Codes for this vendor/source
    const qcCodesList = (v.analysisRecords || [])
      .map(r => r.qcCode)
      .filter(code => code && code.trim() !== '');
    const uniqueQcCodes = Array.from(new Set(qcCodesList));
    const qcCodesStr = uniqueQcCodes.length > 0 ? uniqueQcCodes.join(' | ') : NOT_RECORDED;

    const partnerInfo = resolveVendorPartner(v, partners);

    // Fill in the IRC/registration date from lastAudit (which holds IRC Issue Date) or registrationDate
    const registrationDateStr = v.lastAudit || v.registrationDate || NOT_RECORDED;

    const chosen = selectionForVendor(v, selections);
    const chosenWhen = chosen ? formatSelectionDate(chosen.decidedAt) : '';

    return [
      index + 1,
      v.material || NOT_RECORDED,
      v.materialEn || NOT_RECORDED,
      v.cas || matItem?.cas || NOT_RECORDED,
      roleStr,
      finalProductStr,
      standardNameFaStr,
      standardNameEnStr,
      v.irc || NOT_RECORDED,
      registrationDateStr,
      partnerInfo.name,
      partnerInfo.roleLabel,
      formatContactLine(partnerInfo),
      scoreStr,
      riskText,
      qcCodesStr,
      deviationSummary,
      chosen ? 'بله' : '—',
      chosen ? chosen.reason : '',
      chosen ? [chosen.decidedBy, chosenWhen].filter(Boolean).join(' — ') : '',
      rank.score !== null ? rank.score : ''
    ];
  });

  // If no data rows, add a placeholder row
  const emptyRow: (string | number)[] = new Array(headers.length).fill('-');
  emptyRow[COL.NAME_FA] = 'موردی در این دسته‌بندی یافت نشد';
  const rowsToRender = dataRows.length > 0 ? dataRows : [emptyRow];

  /*
   * A caption row above the header, when the caller says what it filtered by.
   *
   * The rows below it are then whatever the caller passed, not the whole
   * archive — so the sheet has to state its own scope or a filtered extract is
   * indistinguishable from the complete register.
   */
  const caption = filterSummary
    ? [[`محدودهٔ گزارش: ${filterSummary}  ·  تعداد ردیف: ${dataRows.length}  ·  تاریخ تهیه: ${new Date().toLocaleDateString('fa-IR')}`]]
    : [];
  const headerRow = caption.length; // 0 or 1
  const firstDataRow = headerRow + 1;

  // Create workspace worksheet using array of arrays
  const ws = XL.utils.aoa_to_sheet([...caption, headers, ...rowsToRender]);

  /*
   * The material columns used to be merged vertically across every row of the
   * same material. That is a poster habit, not a data one: Excel cannot filter
   * or sort a sheet with merges spanning data rows without misreporting the
   * merged value, and this file exists to be filtered. Grouping is still
   * visible — the alternating fill below changes on every material change —
   * and now an AutoFilter actually works.
   */
  if (caption.length) {
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
  }
  if (dataRows.length > 0) {
    ws['!autofilter'] = {
      ref: XL.utils.encode_range(
        { r: headerRow, c: 0 },
        { r: headerRow + rowsToRender.length, c: headers.length - 1 },
      ),
    };
  }
  // (No freeze pane: xlsx-js-style writes no <pane> element, so setting one
  // would only look like the header was pinned. Verified by writing a workbook
  // and reading the XML back.)

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
    
    const colIndex = XL.utils.decode_col(colLetter);
    const rowIndex = rowNumber - 1; // 0-based

    if (caption.length && rowIndex === 0) {
      cell.s = {
        fill: { patternType: 'solid', fgColor: { rgb: 'E2E8F0' } },
        font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: '0F172A' } },
        alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
      };
      continue;
    }

    if (rowIndex === headerRow) {
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
      const dataRowIdx = rowIndex - firstDataRow;
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
      if (colIndex >= COL.NAME_FA && colIndex <= COL.IRC) {
        cell.s.font.color = { rgb: '0F172A' };
      }

      // Left-align long texts, right-align partner/supplier information/devs
      if ((colIndex >= COL.PARTNER && colIndex <= COL.SCORE) || colIndex === COL.DEVIATIONS || colIndex === COL.CHOSEN_REASON) {
        cell.s.alignment.horizontal = 'right';
      }

      // Color score columns (امتیاز ارزیابی کل)
      if (colIndex === COL.SCORE) {
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

      // The chosen-source column: the whole point is to be findable in a long
      // sheet, so the "بله" cell is filled rather than left as plain text.
      if (colIndex === COL.CHOSEN && String(cell.v || '') === 'بله') {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } };   // Amber-100
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'B45309' } }; // Amber-700
      }

      // Color quality risk levels (سطح ریسک کیفی)
      if (colIndex === COL.RISK) {
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
      if (colIndex === COL.DEVIATIONS) {
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
    { wch: 30 },  // Partner Name (10)
    { wch: 14 },  // Partner Role (11)
    { wch: 48 },  // Partner Address / contact (12)
    { wch: 18 },  // Overall Score (13)
    { wch: 15 },  // Risk Level (14)
    { wch: 22 },  // QC Code Column width (15)
    { wch: 58 },  // Deviations summary (16)
    { wch: 12 },  // Chosen source (17)
    { wch: 45 },  // Reason for the choice (18)
    { wch: 24 },  // Who recorded it and when (19)
    { wch: 18 },  // Numeric score, sortable (20)
  ];

  /*
   * Right-to-left is set on the workbook, not here. `ws['!views'] = [{RTL:true}]`
   * is accepted silently and written nowhere — every Persian sheet this file
   * produced opened left-to-right in Excel. Verified by reading the generated
   * XML back: only the workbook-level view emits `rightToLeft`.
   */

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
  materials: Material[] = [],
  selections: SourceSelectionRecord[] = [],
  filterSummary?: string
) {
  const { ws } = buildCategoryWorksheet(vendors, categoryId, partners, materials, selections, filterSummary);
  const wb = XL.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const sheetName = categoryLabelFa.slice(0, 31); // Sheets names are capped at 31 chars in Excel
  XL.utils.book_append_sheet(wb, ws, sheetName);

  // Generate Excel download for user. Filename includes timestamp and proper extension.
  const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
  const safeTitle = `گزارش_${categoryLabelFa.replace(/\s+/g, '_')}_${dateStr}`;
  XL.writeFile(wb, `${safeTitle}.xlsx`);
}

/**
 * Exports the full vendor archive as a Multi-Sheet Excel Workbook
 * containing a summary sheet for all categories + a dedicated sheet for each individual category.
 */
export function exportFullArchiveMultiSheetExcel(
  vendors: Vendor[],
  partners: BusinessPartner[] = [],
  materials: Material[] = [],
  selections: SourceSelectionRecord[] = []
) {
  const wb = XL.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  // 1. First Sheet: All Categories (کل آرشیو)
  const { ws: wsAll } = buildCategoryWorksheet(vendors, 'all', partners, materials, selections);
  XL.utils.book_append_sheet(wb, wsAll, 'کل آرشیو');

  // 2. Individual Category Sheets
  for (const cat of EXPORT_CATEGORIES) {
    const { ws: wsCat } = buildCategoryWorksheet(vendors, cat.id, partners, materials, selections);
    const sheetName = cat.labelFa.slice(0, 31);
    XL.utils.book_append_sheet(wb, wsCat, sheetName);
  }

  // Generate multi-sheet workbook download
  const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
  const safeTitle = `گزارش_جامع_چند_شیتی_تامین_کنندگان_${dateStr}`;
  XL.writeFile(wb, `${safeTitle}.xlsx`);
}

/**
 * Builds a styled worksheet for the Business Partners repository.
 * Mirrors the visual format of the vendor archive export (header fill 1E3A8A,
 * Segoe UI, thin borders, RTL, coloured grade/status cells).
 */
export function buildPartnersWorksheet(
  partners: BusinessPartner[],
  db: Vendor[] = []
): { ws: XLSX.WorkSheet; count: number } {
  const statusFa = (s: string) =>
    s === 'Active' ? 'فعال (Active)' :
    s === 'Blacklisted' ? 'لیست سیاه (Blacklisted)' :
    'غیرفعال (Inactive)';

  const connectedCount = (p: BusinessPartner) =>
    (db || []).filter(v => v.manufacturerId === p.id || v.supplierId === p.id || v.id === p.id).length;

  // نتیجهٔ ارزیابی SOP بر اساس گرید (هم‌راستا با ستون لیست شرکا)
  const sopResultLabel = (grade?: string) => {
    switch (grade) {
      case 'A': return 'Approved';
      case 'B': return 'Permit Approval';
      case 'C': return 'Expired';
      case 'Blacklist': return 'Black List';
      case 'Pending Review': return 'Pending Review';
      default: return grade || '—';
    }
  };

  const headers = [
    'ردیف',
    'نوع شریک',
    'نام شریک تجاری',
    'نام لاتین',
    'کشور',
    'شهر',
    'مسئول تماس',
    'شماره تماس',
    'ایمیل',
    'وبسایت',
    'وضعیت سیستم',
    'امتیاز SOP (فروشنده)',
    'گرید ارزیابی',
    'نتیجهٔ ارزیابی SOP',
    // The same rule the table and the server apply, so a printed report cannot
    // promise a seller the form will refuse.
    'امکان اتصال به سورس',
    'تعداد سورس متصل',
    'تاریخ ثبت',
  ];

  const rows = partners.map((p, i) => {
    const ev = p.type === 'Supplier' ? p.evaluation : undefined;
    let createdStr = '';
    try { createdStr = p.createdAt ? new Date(p.createdAt).toLocaleDateString('fa-IR') : ''; } catch { createdStr = ''; }
    return [
      i + 1,
      p.type === 'Manufacturer' ? 'تولیدکننده (Manufacturer)' : 'فروشنده (Supplier)',
      p.name || '',
      p.nameEn || '-',
      p.country || '-',
      p.city || '-',
      p.contactPerson || '-',
      p.phone || '-',
      p.email || '-',
      p.website || '-',
      statusFa(p.status),
      ev && ev.grade !== 'Not Evaluated' ? `${ev.totalScore} / 100` : '—',
      ev && ev.grade !== 'Not Evaluated' ? `Grade ${ev.grade}` : '—',
      ev && ev.grade !== 'Not Evaluated' ? sopResultLabel(ev.grade) : '—',
      canSupplySources(p).allowed ? 'مجاز' : 'غیرمجاز',
      connectedCount(p),
      createdStr,
    ];
  });

  const ws = XL.utils.aoa_to_sheet([headers, ...rows]);

  const range = XL.utils.decode_range(ws['!ref'] || 'A1');
  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue;
    const match = key.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const cell = ws[key];
    const colIndex = XL.utils.decode_col(match[1]);
    const rowIndex = parseInt(match[2], 10) - 1;

    if (rowIndex === 0) {
      cell.s = {
        fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
        font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: '475569' } },
          bottom: { style: 'medium', color: { rgb: '0F172A' } },
          left: { style: 'thin', color: { rgb: '475569' } },
          right: { style: 'thin', color: { rgb: '475569' } },
        },
      };
      continue;
    }

    cell.s = {
      fill: { patternType: 'solid', fgColor: { rgb: rowIndex % 2 === 0 ? 'F8FAFC' : 'FFFFFF' } },
      font: { name: 'Segoe UI', sz: 9, color: { rgb: '1E293B' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
        left: { style: 'thin', color: { rgb: 'E2E8F0' } },
        right: { style: 'thin', color: { rgb: 'E2E8F0' } },
      },
    };

    // Right-align free-text columns (name, address-like, email, website)
    if ([2, 3, 6, 8, 9].includes(colIndex)) cell.s.alignment.horizontal = 'right';

    // System status colour (col 10)
    if (colIndex === 10) {
      const v = String(cell.v || '').toLowerCase();
      if (v.includes('blacklist') || v.includes('لیست سیاه')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'DC2626' } };
      } else if (v.includes('active') || v.includes('فعال')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'D1FAE5' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '059669' } };
      } else if (v.includes('inactive') || v.includes('غیرفعال')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'D97706' } };
      }
    }

    // SOP grade colour (col 12)
    if (colIndex === 12) {
      const v = String(cell.v || '').toLowerCase();
      if (v.includes('grade a') || v.endsWith(' a')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'D1FAE5' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '059669' } };
      } else if (v.includes('grade b') || v.endsWith(' b')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'DBEAFE' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '0071E3' } };
      } else if (v.includes('grade c') || v.endsWith(' c')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'D97706' } };
      } else if (v.includes('blacklist') || v.includes('rejected') || v.endsWith(' d')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'DC2626' } };
      }
    }
  }

  ws['!cols'] = [
    { wch: 6 },   // ردیف
    { wch: 24 },  // نوع
    { wch: 30 },  // نام
    { wch: 26 },  // لاتین
    { wch: 14 },  // کشور
    { wch: 14 },  // شهر
    { wch: 20 },  // مسئول تماس
    { wch: 18 },  // تلفن
    { wch: 26 },  // ایمیل
    { wch: 26 },  // وبسایت
    { wch: 22 },  // وضعیت
    { wch: 18 },  // امتیاز SOP
    { wch: 14 },  // گرید
    { wch: 26 },  // وضعیت Supplier
    { wch: 16 },  // سورس متصل
    { wch: 16 },  // تاریخ
  ];
  void range;
  return { ws, count: partners.length };
}

/**
 * Exports the Business Partners repository to a styled Excel workbook,
 * matching the vendor archive export format.
 */
export function exportBusinessPartnersToExcel(
  partners: BusinessPartner[],
  db: Vendor[] = []
) {
  const wb = XL.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  const { ws } = buildPartnersWorksheet(partners, db);
  XL.utils.book_append_sheet(wb, ws, 'شرکای تجاری');

  const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
  XL.writeFile(wb, `گزارش_شرکای_تجاری_${dateStr}.xlsx`);
}

/**
 * Exports the Audit Trail to a styled Excel workbook, matching the Business
 * Partners export format (header fill 1E3A8A, Segoe UI, thin borders, RTL,
 * coloured severity cells).
 */
export interface AuditExportRow {
  date?: string; time?: string; user?: string; role?: string; module?: string;
  action?: string; recordName?: string; severity?: string; description?: string;
  reason?: string; before?: any; after?: any;
}

export function exportAuditToExcel(rows: AuditExportRow[]) {
  const roleFa: Record<string, string> = {
    admin: 'مدیر سیستم', qa: 'واحد کیفیت', lab: 'آزمایشگاه', commercial: 'بازرگانی',
    planning: 'برنامه‌ریزی', finance: 'مالی', guest: 'مهمان', user: 'کاربر',
  };
  // Rule 16: the audit vocabulary is defined once, in auditTaxonomy.ts. This
  // used to be a hand-written map that had already drifted from the one the
  // screen reads, so the spreadsheet named actions the UI did not.
  // `Information` is what the server writes and `Info` what the local store
  // writes; they are one level (rule 16). Only `Info` was mapped, so every row
  // from a live database exported the raw English word.
  const sevFa: Record<string, string> = {
    Info: 'عادی', Information: 'عادی', Warning: 'هشدار', Critical: 'بحرانی',
  };

  const changeSummary = (before: any, after: any): string => {
    const bef = before && typeof before === 'object' ? before : {};
    const aft = after && typeof after === 'object' ? after : {};
    const keys = Array.from(new Set([...Object.keys(bef), ...Object.keys(aft)]));
    const parts: string[] = [];
    for (const k of keys) {
      const f = bef[k] == null || bef[k] === '' ? '—' : (typeof bef[k] === 'object' ? JSON.stringify(bef[k]) : String(bef[k]));
      const t = aft[k] == null || aft[k] === '' ? '—' : (typeof aft[k] === 'object' ? JSON.stringify(aft[k]) : String(aft[k]));
      if (f === t) continue;
      parts.push(`${k}: ${f} → ${t}`);
    }
    if (parts.length === 0) {
      if (!before && after) return 'رکورد جدید';
      if (before && !after) return 'رکورد حذف شد';
      return '—';
    }
    return parts.slice(0, 12).join('؛ ');
  };

  const headers = [
    'ردیف', 'تاریخ', 'ساعت', 'کاربر', 'سمت', 'ماژول', 'عملیات',
    'رکورد هدف', 'سطح بحرانیت', 'شرح فعالیت', 'دلیل تغییر', 'خلاصهٔ تغییرات',
  ];
  const body = rows.map((r, i) => [
    i + 1,
    r.date || '', r.time || '', r.user || '', roleFa[r.role || ''] || r.role || '',
    AUDIT_MODULE_LABELS[r.module || ''] || r.module || '', AUDIT_ACTION_LABELS[r.action || ''] || r.action || '',
    r.recordName || '', sevFa[r.severity || ''] || r.severity || '',
    r.description || '', r.reason || '', changeSummary(r.before, r.after),
  ]);

  const ws = XL.utils.aoa_to_sheet([headers, ...body]);
  const SEV_COL = 8; // 'سطح بحرانیت'

  for (const key of Object.keys(ws)) {
    if (key[0] === '!') continue;
    const match = key.match(/^([A-Z]+)(\d+)$/);
    if (!match) continue;
    const cell = ws[key];
    const colIndex = XL.utils.decode_col(match[1]);
    const rowIndex = parseInt(match[2], 10) - 1;

    if (rowIndex === 0) {
      cell.s = {
        fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
        font: { name: 'Segoe UI', sz: 10, bold: true, color: { rgb: 'FFFFFF' } },
        alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
        border: {
          top: { style: 'thin', color: { rgb: '475569' } },
          bottom: { style: 'medium', color: { rgb: '0F172A' } },
          left: { style: 'thin', color: { rgb: '475569' } },
          right: { style: 'thin', color: { rgb: '475569' } },
        },
      };
      continue;
    }

    cell.s = {
      fill: { patternType: 'solid', fgColor: { rgb: rowIndex % 2 === 0 ? 'F8FAFC' : 'FFFFFF' } },
      font: { name: 'Segoe UI', sz: 9, color: { rgb: '1E293B' } },
      alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
      border: {
        top: { style: 'thin', color: { rgb: 'E2E8F0' } },
        bottom: { style: 'thin', color: { rgb: 'E2E8F0' } },
        left: { style: 'thin', color: { rgb: 'E2E8F0' } },
        right: { style: 'thin', color: { rgb: 'E2E8F0' } },
      },
    };

    // Right-align free-text columns (record, description, reason, changes)
    if ([7, 9, 10, 11].includes(colIndex)) cell.s.alignment.horizontal = 'right';

    // Severity colour
    if (colIndex === SEV_COL) {
      const v = String(cell.v || '');
      if (v.includes('بحرانی')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEE2E2' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'DC2626' } };
      } else if (v.includes('هشدار')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'FEF3C7' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: 'D97706' } };
      } else if (v.includes('عادی')) {
        cell.s.fill = { patternType: 'solid', fgColor: { rgb: 'D1FAE5' } };
        cell.s.font = { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '059669' } };
      }
    }
  }

  ws['!cols'] = [
    { wch: 6 },   // ردیف
    { wch: 14 },  // تاریخ
    { wch: 12 },  // ساعت
    { wch: 20 },  // کاربر
    { wch: 16 },  // سمت
    { wch: 24 },  // ماژول
    { wch: 14 },  // عملیات
    { wch: 26 },  // رکورد هدف
    { wch: 16 },  // سطح بحرانیت
    { wch: 40 },  // شرح
    { wch: 28 },  // دلیل
    { wch: 50 },  // خلاصهٔ تغییرات
  ];
  const wb = XL.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };
  XL.utils.book_append_sheet(wb, ws, 'ردیابی تغییرات');
  const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
  XL.writeFile(wb, `گزارش_Audit_${dateStr}.xlsx`);
}

/**
 * A single supplier's dossier: everything the company-level view knows, in the
 * shape an auditor asks for it.
 *
 * The archive export answers "show me every source"; this answers "show me this
 * company". Regulatory audits are conducted one supplier at a time, and until
 * now producing that meant exporting the whole archive and filtering by hand.
 *
 * Sheet 1 is the summary an auditor reads first. Sheet 2 reuses the archive's
 * own material worksheet so the columns match what the rest of the app exports.
 * Sheet 3 lists the laboratory record, which no other export carries per
 * company.
 */
export interface SupplierDossierInput {
  supplierName: string;
  vendors: Vendor[];
  partners?: BusinessPartner[];
  materials?: Material[];
  /** Materials this company is the recorded source for. */
  chosenMaterials?: string[];
  /** Materials with no alternative supplier. */
  soleSourceMaterials?: string[];
  /** Recorded "chosen source" decisions, so the materials sheet can mark them. */
  selections?: SourceSelectionRecord[];
}

function titleCell(text: string): XLSX.CellObject {
  return {
    v: text, t: 's',
    s: {
      fill: { patternType: 'solid', fgColor: { rgb: '1E3A8A' } },
      font: { name: 'Segoe UI', sz: 11, bold: true, color: { rgb: 'FFFFFF' } },
      alignment: { horizontal: 'right', vertical: 'center', readingOrder: 2 },
    },
  };
}

function labelValueRows(pairs: Array<[string, string | number]>): XLSX.CellObject[][] {
  return pairs.map(([label, value]) => [
    {
      v: label, t: 's',
      s: {
        font: { name: 'Segoe UI', sz: 9, bold: true, color: { rgb: '1E293B' } },
        fill: { patternType: 'solid', fgColor: { rgb: 'F1F5F9' } },
        alignment: { horizontal: 'right', readingOrder: 2 },
      },
    } as XLSX.CellObject,
    {
      v: value, t: typeof value === 'number' ? 'n' : 's',
      s: {
        font: { name: 'Segoe UI', sz: 9, color: { rgb: '1E293B' } },
        alignment: { horizontal: 'right', readingOrder: 2 },
      },
    } as XLSX.CellObject,
  ]);
}

export function exportSupplierDossierToExcel(input: SupplierDossierInput) {
  const { supplierName, vendors, partners = [], materials = [], chosenMaterials = [], soleSourceMaterials = [], selections = [] } = input;
  const wb = XL.utils.book_new();
  wb.Workbook = { Views: [{ RTL: true }] };

  // --- Sheet 1: the summary --------------------------------------------------
  let pass = 0, conditional = 0, reject = 0;
  vendors.forEach(v => (v.analysisRecords || []).forEach(r => {
    if (r.decision === 'Pass') pass++;
    else if (r.decision === 'Approved Conditional') conditional++;
    else if (r.decision === 'Reject') reject++;
  }));
  const labTotal = pass + conditional + reject;

  const riskCounts = { High: 0, Medium: 0, Low: 0, none: 0 };
  vendors.forEach(v => {
    const level = v.riskAssessment?.riskLevel;
    if (level === 'High' || level === 'Medium' || level === 'Low') riskCounts[level]++;
    else riskCounts.none++;
  });

  const scored = vendors
    .map(v => calculateOverallScore(v.scores, true))
    .filter((n): n is number => n !== null && n > 0);
  const avgScore = scored.length ? Math.round(scored.reduce((a, b) => a + b, 0) / scored.length) : null;

  // The SOP evaluation lives on the partner record, not on the source.
  const linkedPartner = partners.find(p =>
    vendors.some(v => v.supplierId === p.id || v.manufacturerId === p.id));
  const sop = linkedPartner?.evaluation;

  const summary: XLSX.CellObject[][] = [
    [titleCell(`پروندهٔ تأمین‌کننده — ${supplierName}`)],
    [],
    ...labelValueRows([
      ['نام تأمین‌کننده', supplierName],
      ['تاریخ تهیهٔ گزارش', new Date().toLocaleDateString('fa-IR')],
      ['تعداد اقلام تأمین‌شده', vendors.length],
      ['میانگین امتیاز ارزیابی', avgScore === null ? 'ارزیابی‌نشده' : avgScore],
    ]),
    [],
    [titleCell('سابقهٔ آزمایشگاه')],
    ...labelValueRows([
      ['کل تست‌ها', labTotal],
      ['قبول', pass],
      ['قبول مشروط', conditional],
      ['مردود', reject],
      ['نرخ قبولی', labTotal ? `${Math.round(((pass + conditional) / labTotal) * 100)}٪` : 'تستی ثبت نشده'],
    ]),
    [],
    [titleCell('ارزیابی ریسک')],
    ...labelValueRows([
      ['ریسک بالا', riskCounts.High],
      ['ریسک متوسط', riskCounts.Medium],
      ['ریسک پایین', riskCounts.Low],
      ['بدون ارزیابی ریسک', riskCounts.none],
    ]),
    [],
    [titleCell('ارزیابی مدارک SOP (فروشنده)')],
    ...labelValueRows(
      sop
        ? [
            ['شریک تجاری مرتبط', linkedPartner?.name || '-'],
            ['امتیاز کل SOP', sop.totalScore],
            ['گرید ارزیابی', sop.grade],
            ['آخرین به‌روزرسانی', sop.updatedAt ? new Date(sop.updatedAt).toLocaleDateString('fa-IR') : '-'],
            ['ثبت‌کننده', sop.updatedBy || '-'],
          ]
        : [['ارزیابی SOP', 'این تأمین‌کننده به رکورد شریک تجاری متصل نیست یا ارزیابی نشده است.']]),
    [],
    [titleCell('تداوم تأمین')],
    ...labelValueRows([
      ['موادی که سورس منتخب است', chosenMaterials.length],
      ['موادی که تک‌منبع است', soleSourceMaterials.length],
      ['فهرست مواد تک‌منبع', soleSourceMaterials.join('، ') || '-'],
    ]),
  ];

  const summaryWs = XL.utils.aoa_to_sheet(summary as any);
  summaryWs['!cols'] = [{ wch: 34 }, { wch: 52 }];
  summaryWs['!merges'] = [];
  XL.utils.book_append_sheet(wb, summaryWs, 'خلاصهٔ پرونده');

  // --- Sheet 2: the materials, in the archive's own format -------------------
  // Sheet 1 counts the materials this company is the recorded source for; without
  // the selections, sheet 2 said «—» for every one of them in the same workbook.
  const { ws: materialsWs } = buildCategoryWorksheet(vendors, 'all', partners, materials, selections);
  XL.utils.book_append_sheet(wb, materialsWs, 'اقلام تأمین‌شده');

  // --- Sheet 3: the laboratory record ---------------------------------------
  const labHeaders = ['ردیف', 'ماده', 'تاریخ', 'کد QC', 'نتیجه', 'دلیل انحراف', 'ثبت‌کننده', 'توضیحات'];
  const labRows: any[][] = [];
  vendors.forEach(v => (v.analysisRecords || []).forEach(r => {
    labRows.push([
      labRows.length + 1,
      v.material || '-',
      (r as any).date || (r as any).recordDate || '-',
      (r as any).qcCode || '-',
      r.decision || '-',
      (r as any).deviationReason || '-',
      (r as any).recordedBy || '-',
      (r as any).comments || '-',
    ]);
  }));
  const labWs = XL.utils.aoa_to_sheet([labHeaders, ...(labRows.length ? labRows : [['—', 'هیچ رکورد آزمایشگاهی ثبت نشده است.', '', '', '', '', '', '']])]);
  labWs['!cols'] = [{ wch: 6 }, { wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 16 }, { wch: 40 }];
  XL.utils.book_append_sheet(wb, labWs, 'سوابق آزمایشگاه');

  const dateStr = new Date().toLocaleDateString('fa-IR').replace(/\//g, '-');
  const safeName = supplierName.replace(/[\\/:*?"<>|]/g, '-').slice(0, 40);
  XL.writeFile(wb, `پرونده_تامین‌کننده_${safeName}_${dateStr}.xlsx`);
}

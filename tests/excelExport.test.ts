import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSXModule from 'xlsx-js-style';
import type * as XLSX from 'xlsx-js-style';
// Same CommonJS interop the export module needs (see excelExport.ts).
const XL: typeof XLSX = (XLSXModule as any).default ?? (XLSXModule as any);
import { buildCategoryWorksheet } from '../src/utils/excelExport';
import { describeVendorRank, gradeForScore } from '../src/utils/vendorRank';
import type { Vendor } from '../src/types';

/** A source with whatever the test needs; everything else is a plausible blank. */
function vendor(over: Partial<Vendor>): Vendor {
  return {
    id: 'v1', name: 'شرکت الف', nameEn: 'Alpha', material: 'پاراستامول',
    materialEn: 'Paracetamol', cas: '103-90-2', country: 'India', category: 'foreign',
    status: 'new', grade: '', irc: '', scores: null, analysisRecords: [],
    ...over,
  } as unknown as Vendor;
}

function cell(ws: XLSX.WorkSheet, r: number, c: number): any {
  return ws[XL.utils.encode_cell({ r, c })];
}

const COL_SCORE = 13, COL_RISK = 14, COL_SCORE_NUM = 20;
const COL_ROLE = 4;
const HEADER = 0, FIRST_ROW = 1; // no filter caption in these fixtures

test('the grade and risk columns are the ones that get coloured', () => {
  // This is the regression: the conditional formatting used to run one column
  // to the right, so it tested the risk cell for "grade a" and the QC cell for
  // "high". Both columns came out unstyled and nobody noticed.
  const { ws } = buildCategoryWorksheet(
    [vendor({ scores: { commercial: 90, qa: 90, planning: 90, finance: 90 } as any,
              riskAssessment: { riskLevel: 'High' } as any })],
    'all',
  );

  assert.equal(cell(ws, HEADER, COL_SCORE).v, 'امتیاز ارزیابی کل (از ۱۰۰)');
  assert.equal(cell(ws, HEADER, COL_RISK).v, 'سطح ریسک کیفی');

  const score = cell(ws, FIRST_ROW, COL_SCORE);
  assert.equal(score.v, 'Grade A (90)');
  assert.equal(score.s.fill.fgColor.rgb, 'D1FAE5', 'a Grade A cell must be filled green');
  assert.equal(score.s.font.bold, true);

  const risk = cell(ws, FIRST_ROW, COL_RISK);
  assert.equal(risk.v, 'بالا (High)');
  assert.equal(risk.s.fill.fgColor.rgb, 'FEE2E2', 'a High risk cell must be filled red');
});

test('the spreadsheet grades a source on the same scale as the printed form', () => {
  // 35 used to be "Blacklist" here and "Grade D" on the form printed from the
  // same screen: the SOP rubric had been copied onto a source.
  const v = vendor({ scores: { commercial: 35, qa: 35, planning: 35, finance: 35 } as any });
  const { ws } = buildCategoryWorksheet([v], 'all');

  assert.equal(gradeForScore(35), 'D');
  assert.equal(describeVendorRank(v).label, 'Grade D (35)');
  assert.equal(cell(ws, FIRST_ROW, COL_SCORE).v, 'Grade D (35)');
});

test('an unevaluated source says so, in both the text and the numeric column', () => {
  const { ws } = buildCategoryWorksheet([vendor({ grade: 'new' })], 'all');
  assert.equal(cell(ws, FIRST_ROW, COL_SCORE).v, 'ارزیابی نشده');
  assert.equal(cell(ws, FIRST_ROW, COL_RISK).v, 'ارزیابی نشده');
  // Empty, not zero: a zero would average into reports as a real bad score.
  assert.equal(cell(ws, FIRST_ROW, COL_SCORE_NUM).v, '');
});

test('the numeric score column is a number Excel can sort and average', () => {
  const { ws } = buildCategoryWorksheet(
    [vendor({ scores: { commercial: 70, qa: 70, planning: 70, finance: 70 } as any })],
    'all',
  );
  const num = cell(ws, FIRST_ROW, COL_SCORE_NUM);
  assert.equal(num.v, 70);
  assert.equal(num.t, 'n', 'stored as a number, not text');
  assert.equal(cell(ws, FIRST_ROW, 0).t, 'n', 'the row number too');
});

test('empty fields read as Persian, not as N/A', () => {
  const { ws } = buildCategoryWorksheet([vendor({ cas: '', irc: '' })], 'all');
  assert.equal(cell(ws, FIRST_ROW, 3).v, 'ثبت‌نشده');
  assert.equal(cell(ws, FIRST_ROW, 8).v, 'ثبت‌نشده');
});

test('the chosen-source columns are filled from the recorded decision', () => {
  const v = vendor({ id: 'v9', materialEn: 'Metformin HCl', category: 'foreign' });
  const { ws } = buildCategoryWorksheet([v], 'all', [], [], [{
    materialKey: 'metformin hcl', category: 'foreign', vendorId: 'v9',
    reason: 'تنها تأمین‌کنندهٔ دارای IRC', decidedBy: 'admin', decidedAt: '2026-08-01T00:00:00.000Z',
  }]);
  assert.equal(cell(ws, FIRST_ROW, 17).v, 'بله');
  assert.equal(cell(ws, FIRST_ROW, 18).v, 'تنها تأمین‌کنندهٔ دارای IRC');
  assert.match(String(cell(ws, FIRST_ROW, 19).v), /admin/);
});

test('a filtered export states its scope and can still be filtered in Excel', () => {
  const rows = [vendor({ id: 'a' }), vendor({ id: 'b', material: 'متفورمین' })];
  const { ws } = buildCategoryWorksheet(rows, 'all', [], [], [], 'گرید: A · فقط سورس‌های منتخب');

  const caption = String(cell(ws, 0, 0).v);
  assert.match(caption, /گرید: A/);
  assert.match(caption, /تعداد ردیف: 2/);
  // Header moved down one row, and the data with it.
  assert.equal(cell(ws, 1, COL_SCORE).v, 'امتیاز ارزیابی کل (از ۱۰۰)');
  assert.ok(ws['!autofilter'], 'the sheet exists to be filtered');
  assert.equal((ws['!autofilter'] as any).ref.split(':')[0], 'A2');
  // Vertical merges across data rows break Excel's own filtering, so the only
  // merge left is the caption banner.
  assert.equal((ws['!merges'] || []).length, 1);
});

test('an unfiltered export has no caption, so row 1 is still the header', () => {
  const { ws } = buildCategoryWorksheet([vendor({})], 'all');
  assert.equal(cell(ws, 0, 0).v, 'ردیف');
});

test('the generated workbook really opens right-to-left', () => {
  // `ws['!views'] = [{RTL:true}]` was set on every sheet and written on none:
  // the library only emits `rightToLeft` for the workbook-level view, so every
  // Persian export opened left-to-right. Asserted against the produced file,
  // not against the object, because the object was never the thing that lied.
  const { ws } = buildCategoryWorksheet([vendor({})], 'all');
  const wb = XL.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  XL.utils.book_append_sheet(wb, ws, 'x');
  const xml = String(XL.write(wb, { bookType: 'xlsx', type: 'buffer' }).toString('latin1'));
  assert.ok(xml.includes('rightToLeft'), 'the workbook must declare RTL');
  assert.ok(xml.includes('autoFilter'), 'and carry the AutoFilter');
});

test('the role column reads the way the form reads, not the way the column stores', () => {
  // `Reagent / Reactant` and `Packaging Item` are persisted spellings that must
  // not be renamed — every generated standard name uses them — but the whole
  // interface calls them «Reagent» and «Packaging». The export printed the
  // stored value, so one sheet disagreed with every screen in the application.
  const material = {
    id: 'M-1', nameFa: 'استون', nameEn: 'Acetone', cas: '67-64-1',
    role: 'Reagent / Reactant',
  } as any;

  const { ws } = buildCategoryWorksheet(
    [vendor({ materialId: 'M-1', material: 'استون', materialEn: 'Acetone', cas: '67-64-1' })],
    'all', [], [material],
  );

  assert.equal(cell(ws, HEADER, COL_ROLE).v, 'نقش ماده');
  assert.equal(cell(ws, FIRST_ROW, COL_ROLE).v, 'Reagent');
});

test('a legacy role spelling still exports as the label, and a missing one is not invented', () => {
  const legacy = { id: 'M-2', nameFa: 'کارتن', nameEn: 'Carton', cas: 'N/A', role: 'packaging' } as any;
  const unset = { id: 'M-3', nameFa: 'ماده', nameEn: 'Thing', cas: 'N/A' } as any;

  const { ws } = buildCategoryWorksheet(
    [
      vendor({ id: 'v2', materialId: 'M-2', material: 'کارتن', materialEn: 'Carton' }),
      vendor({ id: 'v3', materialId: 'M-3', material: 'ماده', materialEn: 'Thing' }),
    ],
    'all', [], [legacy, unset],
  );

  const rows = [cell(ws, FIRST_ROW, COL_ROLE).v, cell(ws, FIRST_ROW + 1, COL_ROLE).v];
  assert.ok(rows.includes('Packaging'), 'an older spelling maps onto its label');
  // A material with no role recorded must say so rather than defaulting to API,
  // which is what the role lookup returns for an empty value.
  assert.ok(rows.includes('ثبت‌نشده'), 'an unrecorded role stays unrecorded');
});

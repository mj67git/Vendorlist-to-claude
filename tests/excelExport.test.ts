import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSXModule from 'xlsx-js-style';
import type * as XLSX from 'xlsx-js-style';
// Same CommonJS interop the export module needs (see excelExport.ts).
const XL: typeof XLSX = (XLSXModule as any).default ?? (XLSXModule as any);
import { buildCategoryWorksheet } from '../src/utils/excelExport';
import { describeRankForRecord, describeVendorRank, gradeForScore } from '../src/utils/vendorRank';
import type { Vendor } from '../src/types';
import { isInCategoryRegister } from '../src/utils/vendorState';

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
  // The guard this test was written for: 35 is Grade D on the source scale
  // (A 80-100, B 60-79, C 40-59, D 0-39), not on the supplier SOP rubric
  // (90/75/60) that had once been copied onto a source.
  const v = vendor({ scores: { commercial: 35, qa: 35, planning: 35, finance: 35 } as any });
  assert.equal(gradeForScore(35), 'D');

  // And what the spreadsheet prints for it. On the source scale every Grade D
  // is below the qualification floor — D *is* 0-39 and the floor is 40 — so a
  // record that earns one is disqualified, and the sheet says so rather than
  // reporting a grade as though the source were still in the running. The
  // number stays beside it: the grade it earned is the evidence for the
  // verdict, not something the verdict replaces.
  const { ws } = buildCategoryWorksheet([v], 'all');
  assert.equal(describeRankForRecord(v), 'Blacklist (35)');
  assert.equal(cell(ws, FIRST_ROW, COL_SCORE).v, 'Blacklist (35)');
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

test('the sample sheet carries a verdict and lab counts, not empty score columns', () => {
  // A sample is never scored by the departments and never gets a risk
  // assessment, so on the sample sheet those two columns were guaranteed
  // blank — in a document that gets handed to an auditor.
  const { ws } = buildCategoryWorksheet(
    [vendor({
      id: 'vs1', isSample: true, category: 'sample', status: 'approved',
      analysisRecords: [
        { id: 'a1', qcCode: 'QC-1', decision: 'Pass', date: '1405/06/10' },
        { id: 'a2', qcCode: 'QC-2', decision: 'Pass', date: '1405/06/14' },
      ] as any,
    })],
    'sample',
  );

  assert.equal(cell(ws, HEADER, COL_SCORE).v, 'وضعیت نمونه');
  assert.equal(cell(ws, HEADER, COL_RISK).v, 'تعداد نتایج آزمایشگاهی');
  assert.equal(cell(ws, HEADER, COL_SCORE_NUM).v, 'تاریخ آخرین نتیجهٔ آزمایش');

  assert.equal(cell(ws, FIRST_ROW, COL_SCORE).v, 'Approved');
  assert.equal(cell(ws, FIRST_ROW, COL_RISK).v, 2);
  assert.equal(cell(ws, FIRST_ROW, COL_SCORE_NUM).v, '1405/06/14', 'the newest result, not the first');
});

test('a non-sample sheet keeps the columns it always had', () => {
  // The positions are load-bearing: the styling map and anything keyed to a
  // column index depend on them, so only the sample sheet may differ.
  const { ws } = buildCategoryWorksheet([vendor({})], 'foreign');
  assert.equal(cell(ws, HEADER, COL_SCORE).v, 'امتیاز ارزیابی کل (از ۱۰۰)');
  assert.equal(cell(ws, HEADER, COL_RISK).v, 'سطح ریسک کیفی');
  assert.equal(cell(ws, HEADER, COL_SCORE_NUM).v, 'امتیاز عددی (۰-۱۰۰)');
});

test('a sample with no laboratory record says so rather than showing a blank', () => {
  const { ws } = buildCategoryWorksheet(
    [vendor({ id: 'vs2', isSample: true, category: 'sample', status: 'new' })],
    'sample',
  );
  assert.equal(cell(ws, FIRST_ROW, COL_SCORE).v, 'آزمایش نشده');
  assert.equal(cell(ws, FIRST_ROW, COL_RISK).v, 0);
  assert.equal(cell(ws, FIRST_ROW, COL_SCORE_NUM).v, 'ثبت‌نشده');
});

test('the sheet holds exactly the rows the category page shows', () => {
  /*
   * A register and its own export used to disagree. The page dropped
   * disqualified sources from an ordinary category — they belong on the
   * blacklist — and the sheet kept them, so «خارجی» drew 105 rows on screen and
   * exported 140. Both now ask `isInCategoryRegister`, which is the whole fix:
   * one predicate, two readers.
   */
  const rows = [
    vendor({ id: 'ok-1' }),
    vendor({ id: 'ok-2' }),
    vendor({ id: 'gone', status: 'rejected', grade: 'rejected', rejectedByDecision: true }),
    vendor({ id: 'other', category: 'domestic' }),
    vendor({ id: 'smp', isSample: true, category: 'sample' } as any),
  ];

  const page = rows.filter(v => isInCategoryRegister(v, 'foreign')).map(v => v.id);
  assert.deepEqual(page, ['ok-1', 'ok-2']);

  const { vendorCount } = buildCategoryWorksheet(rows, 'foreign');
  assert.equal(vendorCount, page.length, 'the sheet counts what the page counts');

  // The disqualified source is not lost, it is on the register that owns it.
  assert.deepEqual(rows.filter(v => isInCategoryRegister(v, 'blacklist')).map(v => v.id), ['gone']);
  assert.deepEqual(rows.filter(v => isInCategoryRegister(v, 'sample')).map(v => v.id), ['smp']);
  assert.equal(rows.filter(v => isInCategoryRegister(v, 'all')).length, rows.length);
});

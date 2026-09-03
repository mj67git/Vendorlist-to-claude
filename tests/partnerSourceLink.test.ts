import assert from 'node:assert/strict';
import test from 'node:test';
import * as XLSXModule from 'xlsx-js-style';
import type * as XLSX from 'xlsx-js-style';
const XL: typeof XLSX = (XLSXModule as any).default ?? (XLSXModule as any);
import { buildPartnersWorksheet } from '../src/utils/excelExport';
import { canSupplySources } from '../src/utils/sopEvaluation';
import type { BusinessPartner } from '../src/types';

/**
 * Whether a partner may be attached to a source — the rule that now has its own
 * column in the partner list, in the Excel export, and a filter.
 *
 * It is one rule with three readers, so they are tested against the same
 * helper the server refuses saves with: a table that promised what the endpoint
 * rejects is exactly the surprise this column exists to prevent.
 */

function partner(over: Partial<BusinessPartner>): BusinessPartner {
  return {
    id: 'bp-1', type: 'Supplier', name: 'فروشندهٔ الف', nameEn: 'Seller A',
    country: 'Turkey', status: 'Active', createdAt: '2026-01-01T00:00:00.000Z',
    ...over,
  } as unknown as BusinessPartner;
}

const graded = (grade: string, totalScore = 80) =>
  partner({ evaluation: { grade, status: 'Approved Supplier', totalScore, documents: {} } as any });

test('only a Grade A seller may be attached to a source', () => {
  assert.equal(canSupplySources(graded('A')).allowed, true);
  for (const grade of ['B', 'C', 'Pending Review', 'Blacklist']) {
    const verdict = canSupplySources(graded(grade));
    assert.equal(verdict.allowed, false, `${grade} must be blocked`);
    assert.ok(verdict.reason.trim().length > 0, 'and the row must be able to say why');
  }
});

test('an unevaluated seller is blocked, and a blacklisted partner is blocked whatever its grade', () => {
  assert.equal(canSupplySources(partner({ evaluation: null as any })).allowed, false);
  assert.equal(canSupplySources(partner({ ...graded('A'), status: 'Blacklisted' } as any)).allowed, false);
});

test('a manufacturer is not subject to the grade rule', () => {
  const maker = partner({ type: 'Manufacturer', evaluation: null as any });
  assert.equal(canSupplySources(maker).allowed, true, 'manufacturers carry no SOP evaluation');
});

test('the partner export carries the same verdict as the screen', () => {
  const rows = [graded('A'), graded('B', 70), partner({ id: 'bp-3', type: 'Manufacturer', evaluation: null as any })];
  const { ws } = buildPartnersWorksheet(rows, []);

  const header = XL.utils.sheet_to_json(ws, { header: 1 })[0] as string[];
  const column = header.indexOf('امکان اتصال به سورس');
  assert.ok(column > -1, 'the export names the column');

  const body = XL.utils.sheet_to_json(ws, { header: 1 }).slice(1) as any[][];
  assert.deepEqual(body.map(r => r[column]), ['مجاز', 'غیرمجاز', 'مجاز']);
});

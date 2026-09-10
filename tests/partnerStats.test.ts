import assert from 'node:assert/strict';
import test from 'node:test';
import { summarisePartners } from '../src/utils/partnerStats';
import type { BusinessPartner } from '../src/types';

/**
 * The size of the partner register, counted once for two screens.
 *
 * The repository page kept this in a local `useMemo`, so the dashboard could
 * not report the same figures without a second copy — the arrangement that let
 * one category register disagree with its own spreadsheet by thirty-five rows.
 */

function partner(over: Partial<BusinessPartner>): BusinessPartner {
  return {
    id: 'bp', type: 'Supplier', name: 'شرکت', country: 'Turkey', status: 'Active',
    createdAt: '', updatedAt: '',
    ...over,
  } as BusinessPartner;
}

/** A seller whose documents earn the grade named. */
const graded = (id: string, grade: string, over: Partial<BusinessPartner> = {}) =>
  partner({ id, evaluation: { documents: {}, totalScore: 0, grade } as any, ...over });

test('manufacturers and sellers are counted apart, and add up', () => {
  const stats = summarisePartners([
    partner({ id: 'm1', type: 'Manufacturer' }),
    partner({ id: 'm2', type: 'Manufacturer' }),
    graded('s1', 'A'),
  ]);

  assert.equal(stats.total, 3);
  assert.equal(stats.manufacturers, 2);
  assert.equal(stats.suppliers, 1);
  assert.equal(stats.manufacturers + stats.suppliers, stats.total);
});

test('eligible means what the attachment gate means, not grade A or B', () => {
  // Grade B was once counted as approved here while the server answered 422 for
  // it, so the tile promised sellers the system refuses.
  const stats = summarisePartners([
    graded('s1', 'A'),
    graded('s2', 'B'),
    graded('s3', 'C'),
    graded('s4', 'D'),
  ]);

  assert.equal(stats.eligibleSuppliers, 1, 'only grade A may be attached to a source');
  assert.equal(stats.blockedSuppliers, 3);
});

test('eligible and blocked partition the sellers exactly', () => {
  const stats = summarisePartners([
    partner({ id: 'm1', type: 'Manufacturer' }),
    graded('s1', 'A'),
    graded('s2', 'A', { status: 'Blacklisted' }),
    partner({ id: 's3' }),
  ]);

  assert.equal(stats.eligibleSuppliers + stats.blockedSuppliers, stats.suppliers);
  assert.equal(stats.eligibleSuppliers, 1, 'a blacklisted grade-A seller is not eligible');
});

test('a manufacturer never lands in the eligible/blocked split', () => {
  // A manufacturer is not SOP-evaluated at all (rule 4), so counting one here
  // would report a backlog that cannot exist.
  const stats = summarisePartners([
    partner({ id: 'm1', type: 'Manufacturer' }),
    partner({ id: 'm2', type: 'Manufacturer', status: 'Inactive' }),
  ]);

  assert.equal(stats.suppliers, 0);
  assert.equal(stats.eligibleSuppliers, 0);
  assert.equal(stats.blockedSuppliers, 0);
  assert.equal(stats.active, 1);
  assert.equal(stats.inactive, 1);
});

test('an empty register reports zeroes rather than throwing', () => {
  const stats = summarisePartners([]);
  assert.equal(stats.total, 0);
  assert.equal(stats.eligibleSuppliers, 0);
});

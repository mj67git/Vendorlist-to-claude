import assert from 'node:assert/strict';
import test from 'node:test';
import { getPartnerDetails } from '../src/utils/printablePartner';
import type { BusinessPartner, Vendor } from '../src/types';

/**
 * The two identity cells of the printed evaluation form.
 *
 * This form goes into a regulatory file, so a cell must state what the record
 * says and nothing else. It used to print "خرید بی‌واسطه از تولیدکننده" in the
 * seller cell whenever the partner was a manufacturer — a commercial claim the
 * system holds no evidence for, since manufacturers and sellers are
 * independent records.
 */

const vendor = (over: Partial<Vendor> = {}): Vendor => ({
  id: 'V1', name: 'شرکت الفا', nameEn: 'Alpha', material: 'پاراستامول', materialEn: 'Paracetamol',
  cas: '103-90-2', irc: 'N/A', country: 'India', category: 'foreign', status: 'new', grade: 'B',
  scores: null, lastAudit: null, rejectionReasons: null, ...over,
} as Vendor);

const partner = (over: Partial<BusinessPartner> = {}): BusinessPartner => ({
  id: 'BP1', name: 'کارخانهٔ الفا', nameEn: 'Alpha Works', type: 'Manufacturer',
  country: 'India', status: 'Active', ...over,
} as BusinessPartner);

test('a manufacturer leaves the seller cell unrecorded, not "bought direct"', () => {
  const d = getPartnerDetails(
    vendor({ manufacturerId: 'BP1' }),
    [partner({ id: 'BP1', type: 'Manufacturer' })],
  );
  assert.equal(d.mfgName, 'کارخانهٔ الفا');
  assert.equal(d.mfgCountry, 'India');
  assert.ok(d.supName.includes('ثبت'), `the seller cell states the absence, got «${d.supName}»`);
  assert.ok(!d.supName.includes('بی'), 'no direct-purchase claim');
  assert.ok(!d.supCountry.includes('مستقیم'), 'no "direct" country');
});

test('a seller leaves the manufacturer cell unrecorded', () => {
  const d = getPartnerDetails(
    vendor({ supplierId: 'BP2' }),
    [partner({ id: 'BP2', name: 'بازرگانی بتا', type: 'Supplier', country: 'Turkey' })],
  );
  assert.equal(d.supName, 'بازرگانی بتا');
  assert.equal(d.supCountry, 'Turkey');
  assert.ok(d.mfgName.includes('ثبت'));
});

test('a source with no partner keeps its name and says the role is unrecorded', () => {
  // Nothing else on the page identifies the company, so the name stays — but
  // it is not filed under "manufacturer" by default.
  const d = getPartnerDetails(vendor(), []);
  assert.ok(d.mfgName.startsWith('شرکت الفا'));
  assert.ok(d.mfgName.includes('نقش'), 'the cell says the role is unrecorded');
  assert.ok(d.supName.includes('ثبت'));
});

test('neither cell ever asserts a commercial relationship', () => {
  const cases = [
    getPartnerDetails(vendor({ manufacturerId: 'BP1' }), [partner({ id: 'BP1' })]),
    getPartnerDetails(vendor({ supplierId: 'BP1' }), [partner({ id: 'BP1', type: 'Supplier' })]),
    getPartnerDetails(vendor(), []),
  ];
  for (const d of cases) {
    const printed = `${d.mfgName} ${d.mfgCountry} ${d.supName} ${d.supCountry}`;
    assert.ok(!printed.includes('واسطه'), `no purchase claim in «${printed}»`);
    assert.ok(!printed.includes('مستقیم'), `no directness claim in «${printed}»`);
  }
});

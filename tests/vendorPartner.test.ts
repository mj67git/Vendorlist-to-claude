import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVendorPartner, cleanCountry, formatLocation, formatContactLine } from '../src/utils/vendorPartner';
import type { Vendor, BusinessPartner } from '../src/types';

const partner = (o: Partial<BusinessPartner>): BusinessPartner =>
  ({
    id: 'P1', type: 'Manufacturer', name: 'شرکت الف', country: 'India',
    status: 'Active', createdAt: '', updatedAt: '', ...o,
  } as BusinessPartner);

const vendor = (o: Partial<Vendor>): Vendor =>
  ({ id: 'V1', name: 'شرکت الف', country: 'India', ...o } as Vendor);

test('a source linked to a seller is a seller, not both', () => {
  const p = partner({ id: 'S1', type: 'Supplier', name: 'فروشندهٔ ب' });
  const info = resolveVendorPartner(vendor({ supplierId: 'S1' }), [p]);

  assert.equal(info.role, 'supplier');
  assert.equal(info.roleLabel, 'فروشنده');
  assert.equal(info.name, 'فروشندهٔ ب');
  assert.equal(info.partner, p);
});

test('a source linked to a manufacturer is a manufacturer', () => {
  const p = partner({ id: 'M1', name: 'کارخانهٔ ج' });
  const info = resolveVendorPartner(vendor({ manufacturerId: 'M1' }), [p]);

  assert.equal(info.role, 'manufacturer');
  assert.equal(info.roleLabel, 'تولیدکننده');
  assert.equal(info.name, 'کارخانهٔ ج');
});

test("the role comes from the partner record, not from which id field held it", () => {
  // A legacy row can carry a Supplier's id in manufacturerId. The record wins.
  const p = partner({ id: 'S9', type: 'Supplier', name: 'فروشندهٔ قدیمی' });
  const info = resolveVendorPartner(vendor({ manufacturerId: 'S9' }), [p]);

  assert.equal(info.role, 'supplier');
  assert.equal(info.roleLabel, 'فروشنده');
});

test('an explicit supplier link wins over a stale manufacturer id', () => {
  const sup = partner({ id: 'S1', type: 'Supplier', name: 'فروشنده' });
  const mfg = partner({ id: 'M1', name: 'تولیدکننده' });
  const info = resolveVendorPartner(vendor({ supplierId: 'S1', manufacturerId: 'M1' }), [mfg, sup]);

  assert.equal(info.name, 'فروشنده');
  assert.equal(info.role, 'supplier');
});

test('an imported row with no ids still finds its partner by name', () => {
  const p = partner({ id: 'M2', name: 'شرکت الف' });
  const info = resolveVendorPartner(vendor({ name: 'شرکت الف' }), [p]);
  assert.equal(info.partner, p);
});

test('with no partner at all it falls back to the source itself', () => {
  const info = resolveVendorPartner(
    vendor({ name: 'سورس تنها', country: 'Germany', contactInfo: 'Berlin, Some St.' }),
    [],
  );

  assert.equal(info.partner, null);
  assert.equal(info.role, 'unknown');
  assert.equal(info.roleLabel, 'تأمین‌کننده');
  assert.equal(info.name, 'سورس تنها');
  assert.equal(info.country, 'Germany');
  assert.equal(info.address, 'Berlin, Some St.');
});

test('placeholder countries are treated as not recorded', () => {
  for (const raw of ['unknown', 'UNKNOWN', 'n/a', 'N/A', 'نامشخص', 'مشخص نشده', '', '   ']) {
    assert.equal(cleanCountry(raw), null, `expected ${JSON.stringify(raw)} to be dropped`);
  }
  assert.equal(cleanCountry('  India  '), 'India');
});

test('a placeholder country on the partner does not shadow a real one on the source', () => {
  const p = partner({ id: 'M1', country: 'نامشخص' });
  const info = resolveVendorPartner(vendor({ manufacturerId: 'M1', country: 'China' }), [p]);
  assert.equal(info.country, 'China');
});

test('only a seller carries an SOP grade', () => {
  const sup = partner({ id: 'S1', type: 'Supplier', evaluation: { grade: 'B' } as any });
  assert.equal(resolveVendorPartner(vendor({ supplierId: 'S1' }), [sup]).grade, 'B');

  const mfg = partner({ id: 'M1', evaluation: { grade: 'B' } as any });
  assert.equal(resolveVendorPartner(vendor({ manufacturerId: 'M1' }), [mfg]).grade, null);
});

test('display helpers omit what is missing instead of printing blanks', () => {
  const p = partner({ id: 'M1', country: 'India', city: 'Mumbai', address: 'Road 1', phone: '+91' });
  const info = resolveVendorPartner(vendor({ manufacturerId: 'M1' }), [p]);

  assert.equal(formatLocation(info), 'India - Mumbai');
  assert.equal(formatContactLine(info), 'India - Mumbai - Road 1 - +91');

  const bare = resolveVendorPartner(vendor({ name: 'x', country: 'نامشخص' }), []);
  assert.equal(formatLocation(bare), null);
  assert.equal(formatContactLine(bare), 'ثبت‌نشده');
});

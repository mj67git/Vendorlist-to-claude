import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveMaterialNames } from '../src/utils/materialNames';
import type { Material, Vendor } from '../src/types';

const material = (o: Partial<Material>): Material =>
  ({
    id: 'M-1', nameFa: 'استون', nameEn: 'Acetone', cas: '67-64-1', irc: 'N/A',
    role: 'API', pharmacopoeia: 'USP', createdAt: '', ...o,
  } as Material);

const vendor = (o: Partial<Vendor>): Vendor =>
  ({ id: 'V1', name: 'شرکت الف', material: 'استون', materialEn: 'Acetone', cas: '67-64-1', ...o } as Vendor);

const STANDARD = {
  standardNameFa: 'حلال - استون (برای متادون هیدروکلراید)',
  standardNameEn: 'SOL-aceton (For methadone hydrochloride)',
};

test('the standard names come from the linked catalogue entry', () => {
  const m = material({ id: 'M-ACE', ...STANDARD });
  const names = resolveMaterialNames(vendor({ materialId: 'M-ACE' }), [m]);

  assert.equal(names.standardNameFa, STANDARD.standardNameFa);
  assert.equal(names.standardNameEn, STANDARD.standardNameEn);
  assert.equal(names.material?.id, 'M-ACE');
});

test('a source linked to a stripped duplicate still shows the standard names', () => {
  // What the old save path minted: name/CAS only, no standard names.
  const duplicate = material({ id: 'mat_67_64_1_NA' });
  const catalogue = material({ id: 'M-ACE', ...STANDARD });
  const names = resolveMaterialNames(vendor({ materialId: 'mat_67_64_1_NA' }), [duplicate, catalogue]);

  assert.equal(names.standardNameFa, STANDARD.standardNameFa);
  assert.equal(names.standardNameEn, STANDARD.standardNameEn);
  // The link itself is unchanged; only the names are borrowed.
  assert.equal(names.material?.id, 'mat_67_64_1_NA');
});

test('the catalogue entry is found by CAS when the names differ', () => {
  const duplicate = material({ id: 'dup', nameFa: 'استون خالص', nameEn: 'Pure acetone' });
  const catalogue = material({ id: 'M-ACE', ...STANDARD });
  const v = vendor({ materialId: 'dup', material: 'استون خالص', materialEn: 'Pure acetone' });

  assert.equal(resolveMaterialNames(v, [duplicate, catalogue]).standardNameFa, STANDARD.standardNameFa);
});

test('a material with no standard name falls back to its plain name', () => {
  const m = material({ id: 'M-2', nameFa: 'متفورمین هیدروکلراید', nameEn: 'Metformin HCl', cas: '1115-70-4' });
  const v = vendor({ materialId: 'M-2', material: 'متفورمین هیدروکلراید', materialEn: 'Metformin HCl', cas: '1115-70-4' });
  const names = resolveMaterialNames(v, [m]);

  assert.equal(names.standardNameFa, 'متفورمین هیدروکلراید');
  assert.equal(names.standardNameEn, 'Metformin HCl');
});

test('with no repository at all the vendor’s own names are used', () => {
  const names = resolveMaterialNames(vendor({ materialId: 'M-9' }), []);

  assert.equal(names.standardNameFa, 'استون');
  assert.equal(names.standardNameEn, 'Acetone');
  assert.equal(names.material, undefined);
});

test('a placeholder CAS does not make two unrelated materials the same substance', () => {
  const other = material({ id: 'other', nameFa: 'ماده دیگر', nameEn: 'Other', cas: 'N/A', ...STANDARD });
  const v = vendor({ materialId: 'missing', material: 'ماده ما', materialEn: 'Ours', cas: 'N/A' });

  const names = resolveMaterialNames(v, [other]);
  assert.equal(names.standardNameFa, 'ماده ما');
  assert.equal(names.material, undefined);
});

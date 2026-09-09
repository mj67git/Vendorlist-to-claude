import assert from 'node:assert/strict';
import test from 'node:test';
import { countMaterialsWithSources, indexSourcesByMaterial } from '../src/utils/materialSources';
import type { Material, Vendor } from '../src/types';

/**
 * Which sources are registered against each material.
 *
 * The materials table prints this count and its delete confirmation names the
 * sources it would orphan; the dashboard reports how much of the catalogue is
 * actually bought. Both used to be impossible to test, because the only
 * implementation was a `useMemo` inside a component.
 */

function material(over: Partial<Material>): Material {
  return {
    id: 'm', nameFa: 'ماده', nameEn: 'Material', cas: 'N/A', role: 'API',
    finalProduct: '', finalProductEn: '', pharmacopoeia: '',
    standardNameFa: '', standardNameEn: '', createdAt: '',
    ...over,
  } as Material;
}

function vendor(over: Partial<Vendor>): Vendor {
  return {
    id: 'v', name: 'شرکت', nameEn: 'Co', material: '', materialEn: '', cas: '',
    country: 'India', category: 'foreign', status: 'new', grade: '',
    ...over,
  } as unknown as Vendor;
}

test('a source linked by id belongs to that material', () => {
  const materials = [material({ id: 'M1', nameFa: 'پاراستامول' })];
  const index = indexSourcesByMaterial([vendor({ id: 'v1', materialId: 'M1' })], materials);

  assert.deepEqual(index.get('M1')?.map(v => v.id), ['v1']);
});

test('a source with no link is matched on its substance', () => {
  const materials = [
    material({ id: 'M1', nameFa: 'پاراستامول', nameEn: 'Paracetamol', cas: '103-90-2' }),
  ];
  const index = indexSourcesByMaterial([
    vendor({ id: 'byFa', material: 'پاراستامول' }),
    vendor({ id: 'byEn', materialEn: 'Paracetamol' }),
    vendor({ id: 'byCas', cas: '103-90-2' }),
  ], materials);

  assert.deepEqual(index.get('M1')?.map(v => v.id), ['byFa', 'byEn', 'byCas']);
});

test('a source stored under the standard name is counted too', () => {
  /*
   * The behaviour this extraction changed on purpose.
   *
   * The component's own predicate compared only `nameFa`/`nameEn`/`cas`, while
   * the source's detail page resolved the same row through
   * `resolveMaterialNames`, which also compares the standard names. So a legacy
   * source filed under «حلال - استون (برای متادون)» was attributed to the
   * material on its own page and to nothing at all in the materials table —
   * where the delete confirmation could then promise no source was attached and
   * the server refuse the delete anyway.
   */
  const materials = [
    material({ id: 'M1', nameFa: 'استون', standardNameFa: 'حلال - استون (برای متادون هیدروکلراید)' }),
  ];
  const index = indexSourcesByMaterial(
    [vendor({ id: 'legacy', material: 'حلال - استون (برای متادون هیدروکلراید)' })],
    materials,
  );

  assert.deepEqual(index.get('M1')?.map(v => v.id), ['legacy']);
});

test('a placeholder CAS does not glue unrelated rows together', () => {
  // «N/A» is what the form writes when there is no CAS, and it is on a great
  // many rows: matching on it would attribute every one of them to the first
  // material in the catalogue.
  const materials = [
    material({ id: 'M1', nameFa: 'پاراستامول', cas: 'N/A' }),
    material({ id: 'M2', nameFa: 'استون', cas: '-' }),
  ];
  const index = indexSourcesByMaterial([vendor({ id: 'v1', cas: 'N/A', material: 'چیز دیگری' })], materials);

  assert.equal(index.size, 0);
});

test('a source that names no known material is left out', () => {
  const index = indexSourcesByMaterial(
    [vendor({ id: 'v1', material: 'مادهٔ ناشناخته' })],
    [material({ id: 'M1', nameFa: 'پاراستامول' })],
  );

  assert.equal(index.size, 0);
  assert.equal(countMaterialsWithSources(index), 0);
});

test('the count is of materials, not of sources', () => {
  const materials = [
    material({ id: 'M1', nameFa: 'پاراستامول' }),
    material({ id: 'M2', nameFa: 'استون' }),
    material({ id: 'M3', nameFa: 'اتانول' }),
  ];
  const index = indexSourcesByMaterial([
    vendor({ id: 'v1', materialId: 'M1' }),
    vendor({ id: 'v2', materialId: 'M1' }),
    vendor({ id: 'v3', materialId: 'M2' }),
  ], materials);

  assert.equal(index.get('M1')?.length, 2, 'both sources of one material are kept');
  assert.equal(countMaterialsWithSources(index), 2, 'and M3, which nobody supplies, is not counted');
});

test('the population is the caller’s choice', () => {
  // The materials repository asks over every record, because a sample holds a
  // `vendor_materials` row and blocks a delete like any other; the dashboard
  // asks over the sources only, to match the tile beside it.
  const materials = [material({ id: 'M1', nameFa: 'پاراستامول' })];
  const rows = [
    vendor({ id: 'source', materialId: 'M1' }),
    vendor({ id: 'sample', materialId: 'M1', isSample: true, category: 'sample' } as any),
  ];

  assert.equal(indexSourcesByMaterial(rows, materials).get('M1')?.length, 2);
  assert.equal(
    indexSourcesByMaterial(rows.filter(v => !(v as any).isSample), materials).get('M1')?.length,
    1,
  );
});

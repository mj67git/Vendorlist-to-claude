import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDuplicateMaterial, isRealCas, type MaterialKeyFields } from '../src/utils/materialDuplicates';

const m = (o: Partial<MaterialKeyFields>): MaterialKeyFields => ({
  id: 'M-1', nameFa: 'استون', nameEn: 'Acetone', cas: '67-64-1',
  role: 'Solvent', finalProductEn: 'Methadone HCl', ...o,
});

test('the same real CAS is a duplicate', () => {
  const hit = findDuplicateMaterial(m({ id: 'new', nameFa: 'استون خالص', nameEn: 'Pure acetone' }), [m({})]);
  assert.equal(hit?.field, 'cas');
  assert.equal(hit?.material.id, 'M-1');
  assert.match(hit!.reason, /67-64-1/);
});

test('CAS matching ignores case and surrounding spaces', () => {
  const hit = findDuplicateMaterial(m({ id: 'new', cas: ' 67-64-1 ' }), [m({ cas: '67-64-1' })]);
  assert.equal(hit?.field, 'cas');
});

test('a placeholder CAS is never an identity', () => {
  for (const placeholder of ['N/A', 'na', '-', '', 'نامشخص']) {
    const hit = findDuplicateMaterial(
      m({ id: 'new', cas: placeholder, nameEn: 'Something else', finalProductEn: 'Other product' }),
      [m({ cas: placeholder })],
    );
    assert.equal(hit, null, `«${placeholder}» نباید تکراری حساب شود`);
    assert.equal(isRealCas(placeholder), false);
  }
});

test('the role + Latin name + final product combination is a duplicate', () => {
  const hit = findDuplicateMaterial(
    m({ id: 'new', cas: 'N/A' }),
    [m({ cas: '67-64-1' })],
  );
  assert.equal(hit?.field, 'combination');
});

test('the same name under a different role is not a duplicate', () => {
  const hit = findDuplicateMaterial(
    m({ id: 'new', cas: 'N/A', role: 'Reagent / Reactant' }),
    [m({ cas: 'N/A' })],
  );
  assert.equal(hit, null);
});

test('a half-filled combination is not an identity', () => {
  // No final product yet: two drafts must not collide on name alone.
  const hit = findDuplicateMaterial(
    m({ id: 'new', cas: 'N/A', finalProductEn: '' }),
    [m({ cas: 'N/A', finalProductEn: '' })],
  );
  assert.equal(hit, null);
});

test('a record never duplicates itself', () => {
  assert.equal(findDuplicateMaterial(m({}), [m({})], m({})), null);
});

test('editing an untouched field on an already-duplicated row is still allowed', () => {
  // Both rows share a CAS from before the rule existed. Renaming one must not
  // be refused, or the cleanup script's own targets become uneditable.
  const current = m({ id: 'dup', nameFa: 'استون قدیمی', finalProductEn: 'Legacy product' });
  const candidate = { ...current, nameFa: 'استون (ویرایش‌شده)' };
  assert.equal(findDuplicateMaterial(candidate, [m({}), current], current), null);
});

test('but changing the CAS *into* an existing one is refused', () => {
  const current = m({ id: 'dup', cas: '111-11-1', finalProductEn: 'Legacy product' });
  const candidate = { ...current, cas: '67-64-1' };
  const hit = findDuplicateMaterial(candidate, [m({}), current], current);
  assert.equal(hit?.field, 'cas');
  assert.equal(hit?.material.id, 'M-1');
});

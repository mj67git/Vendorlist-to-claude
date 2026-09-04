import assert from 'node:assert/strict';
import test from 'node:test';
import { supplierKey } from '../src/components/views/SupplierAuditView';

/**
 * The supplier directory groups sources into companies before it sorts or
 * exports them, so the grouping key is what decides whether a company appears
 * once with all its materials or twice with half each.
 */

test('the same company written with Arabic letters is one company', () => {
  // Persian data routinely arrives with the Arabic ي and ك, and with a
  // zero-width non-joiner where a space is meant. They look identical.
  assert.equal(supplierKey('شركت الفا'), supplierKey('شرکت الفا'));
  assert.equal(supplierKey('داروسازي بتا'), supplierKey('داروسازی بتا'));
});

test('case and surrounding space do not split a latin name', () => {
  assert.equal(supplierKey('  Beta Pharma '), supplierKey('beta pharma'));
});

test('two different companies keep two keys', () => {
  assert.notEqual(supplierKey('شرکت الفا'), supplierKey('شرکت بتا'));
});

test('a nameless source has no key, so it cannot collapse others into itself', () => {
  assert.equal(supplierKey(''), '');
  assert.equal(supplierKey('   '), '');
});

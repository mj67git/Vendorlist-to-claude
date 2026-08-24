import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeRoute, decodeRoute, routeKey, buildStackFromRoute, type RouteState } from '../src/utils/navRoutes';

const r = (o: Partial<RouteState>): RouteState =>
  ({ view: 'home', categoryId: null, vendorId: null, ...o } as RouteState);

test('encodes each top-level view', () => {
  assert.equal(encodeRoute(r({ view: 'home' })), '#/');
  assert.equal(encodeRoute(r({ view: 'materials' })), '#/materials');
  assert.equal(encodeRoute(r({ view: 'business-partners' })), '#/business-partners');
  assert.equal(encodeRoute(r({ view: 'audit-trail' })), '#/audit-trail');
  assert.equal(encodeRoute(r({ view: 'category', categoryId: 'foreign' })), '#/category/foreign');
});

test('encodes a source under its parent category', () => {
  assert.equal(
    encodeRoute(r({ view: 'category', categoryId: 'foreign', vendorId: 'V1' })),
    '#/category/foreign/vendor/V1',
  );
  assert.equal(encodeRoute(r({ view: 'home', vendorId: 'V1' })), '#/vendor/V1');
});

test('round-trips every location', () => {
  const cases: RouteState[] = [
    r({ view: 'home' }),
    r({ view: 'materials' }),
    r({ view: 'supplier-audit' }),
    r({ view: 'category', categoryId: 'domestic' }),
    r({ view: 'category', categoryId: 'foreign', vendorId: 'V-42' }),
    r({ view: 'home', vendorId: 'V-42' }),
  ];
  for (const c of cases) {
    const back = decodeRoute(encodeRoute(c));
    assert.ok(back, `failed to decode ${encodeRoute(c)}`);
    assert.equal(routeKey(back!), routeKey(c));
  }
});

test('carries the expanded material for a category link', () => {
  const hash = encodeRoute(r({ view: 'category', categoryId: 'foreign', expandedMaterial: 'Paracetamol' }));
  assert.equal(hash, '#/category/foreign?m=Paracetamol');
  assert.equal(decodeRoute(hash)!.expandedMaterial, 'Paracetamol');
});

test('percent-encodes material names with spaces and non-ASCII', () => {
  const name = 'Sodium Chloride (اکسپیانت)';
  const hash = encodeRoute(r({ view: 'category', categoryId: 'foreign', expandedMaterial: name }));
  assert.ok(!hash.includes(' '));
  assert.equal(decodeRoute(hash)!.expandedMaterial, name);
});

test('rejects unparseable and unknown routes rather than guessing', () => {
  assert.equal(decodeRoute('#/category/not-a-category'), null);
  assert.equal(decodeRoute('#/nonsense'), null);
  assert.equal(decodeRoute('#/category/foreign/bogus/x'), null);
});

test('treats an empty hash as home', () => {
  for (const h of ['', '#', '#/']) {
    assert.equal(decodeRoute(h)!.view, 'home');
  }
});

test('builds ancestors so a deep link gets a breadcrumb and a Back target', () => {
  const stack = buildStackFromRoute(r({ view: 'category', categoryId: 'foreign', vendorId: 'V1' }));
  assert.equal(stack.length, 3);
  assert.deepEqual(stack.map(s => s.view), ['home', 'category', 'category']);
  assert.equal(stack[1].vendorId, null);
  assert.equal(stack[2].vendorId, 'V1');
});

test('home builds a single-entry stack', () => {
  assert.equal(buildStackFromRoute(r({ view: 'home' })).length, 1);
});

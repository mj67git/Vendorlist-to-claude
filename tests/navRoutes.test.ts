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
  assert.equal(encodeRoute(r({ view: 'users' })), '#/users');
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
    r({ view: 'users' }),
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

test('the source form is a page with its own URL', () => {
  assert.equal(encodeRoute(r({ view: 'category', categoryId: 'foreign', formMode: 'create' })), '#/category/foreign/new');
  assert.equal(
    encodeRoute(r({ view: 'category', categoryId: 'foreign', vendorId: 'V1', formMode: 'edit' })),
    '#/category/foreign/vendor/V1/edit',
  );
});

test('form routes round-trip', () => {
  for (const c of [
    r({ view: 'category', categoryId: 'domestic', formMode: 'create' }),
    r({ view: 'category', categoryId: 'foreign', vendorId: 'V-9', formMode: 'edit' }),
    r({ view: 'home', vendorId: 'V-9', formMode: 'edit' }),
  ]) {
    const back = decodeRoute(encodeRoute(c));
    assert.ok(back, `failed to decode ${encodeRoute(c)}`);
    assert.equal(routeKey(back!), routeKey(c));
  }
});

test('a create page stacks on the list, an edit page on the detail', () => {
  const create = buildStackFromRoute(r({ view: 'category', categoryId: 'foreign', formMode: 'create' }));
  assert.deepEqual(create.map(s => s.formMode ?? null), [null, null, 'create']);

  const edit = buildStackFromRoute(r({ view: 'category', categoryId: 'foreign', vendorId: 'V1', formMode: 'edit' }));
  assert.equal(edit.length, 4, 'home > category > detail > edit');
  assert.deepEqual(edit.map(s => s.formMode ?? null), [null, null, null, 'edit']);
  assert.equal(edit[2].vendorId, 'V1', 'Back from edit lands on that source');
});

test('a plain detail route is unchanged by the form additions', () => {
  const d = decodeRoute('#/category/foreign/vendor/V1');
  assert.equal(d!.formMode ?? null, null);
});

test('malformed form routes are rejected', () => {
  assert.equal(decodeRoute('#/category/foreign/vendor/V1/bogus'), null);
  assert.equal(decodeRoute('#/category/foreign/new/extra'), null);
});

test('each worklist backlog is its own address', () => {
  for (const key of ['eval', 'risk', 'sop', 'irc']) {
    const d = decodeRoute(`#/tasks/${key}`);
    assert.equal(d!.view, 'tasks');
    assert.equal(d!.taskKey, key);
    assert.equal(encodeRoute(d as any), `#/tasks/${key}`, 'round-trips unchanged');
  }
});

test('a bare worklist URL opens the first backlog', () => {
  const d = decodeRoute('#/tasks');
  assert.equal(d!.taskKey, 'eval');
  // Normalised on the way out so the address bar always names the tab shown.
  assert.equal(encodeRoute(d as any), '#/tasks/eval');
});

test('an unknown backlog is rejected rather than silently shown', () => {
  assert.equal(decodeRoute('#/tasks/bogus'), null);
  assert.equal(decodeRoute('#/tasks/eval/extra'), null);
});

test('the worklist stacks on home, so Back leaves the backlog', () => {
  const stack = buildStackFromRoute(r({ view: 'tasks', taskKey: 'irc' } as any));
  assert.deepEqual(stack.map(s => s.view), ['home', 'tasks']);
  assert.equal(stack[1].taskKey, 'irc');
});

test('two backlogs are distinct locations', () => {
  assert.notEqual(
    routeKey({ view: 'tasks', taskKey: 'eval' }),
    routeKey({ view: 'tasks', taskKey: 'risk' }),
    'switching tabs must not be mistaken for the same page',
  );
});

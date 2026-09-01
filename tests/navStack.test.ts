import assert from 'node:assert/strict';
import test from 'node:test';
import {
  HOME, MAX_VIEW_HISTORY, capHistory, hydrateVendor, popForm, popView,
  pushForm, pushVendor, pushView, truncateTo, type ViewState,
} from '../src/utils/navStack';
import type { Vendor } from '../src/types';

/**
 * The navigation stack was the least tested and most consequential logic in the
 * frontend: 850 lines inside a 2,200-line component, carrying rules that were
 * each learned from a bug. These tests are what makes it safe to move.
 */

const src = (id: string, materialEn = 'Paracetamol') => ({ id, materialEn } as Vendor);
const entry = (over: Partial<ViewState> = {}): ViewState =>
  ({ view: 'category', categoryId: 'foreign', selectedVendor: null, ...over } as ViewState);

test('going home resets the stack rather than stacking on top of it', () => {
  const deep = [HOME, entry(), entry({ selectedVendor: src('V1') })];
  assert.deepEqual(pushView(deep, 'home'), [HOME]);
});

test('top-level navigation is a tab switch, not a drill-down', () => {
  // Pushing a duplicate made Back re-enter a source detail the user had just
  // deliberately left.
  const stack = [HOME, entry({ view: 'materials', categoryId: null })];
  const again = pushView(stack, 'materials', null);
  assert.equal(again.length, 2, 'the existing entry is unwound to, not duplicated');
  assert.equal(again[1].view, 'materials');
});

test('returning to an earlier destination drops everything above it', () => {
  const stack = [
    HOME,
    entry({ view: 'materials', categoryId: null }),
    entry({ view: 'archive', categoryId: null }),
    entry({ view: 'users', categoryId: null }),
  ];
  const back = pushView(stack, 'materials', null);
  assert.equal(back.length, 2);
  assert.equal(back[back.length - 1].view, 'materials');
});

test('two categories are different destinations', () => {
  const stack = pushView([HOME], 'category', 'foreign');
  const both = pushView(stack, 'category', 'domestic');
  assert.equal(both.length, 3, 'domestic does not unwind to foreign');
});

test('two worklist backlogs are different destinations', () => {
  const evalTab = pushView([HOME], 'tasks', null, 'eval');
  const riskTab = pushView(evalTab, 'tasks', null, 'risk');
  assert.equal(riskTab.length, 3);
  assert.equal(riskTab[2].taskKey, 'risk');
});

test('opening a source pushes one level and remembers the open material', () => {
  const stack = pushView([HOME], 'category', 'foreign');
  const detail = pushVendor(stack, src('V1', 'Metformin'));

  assert.equal(detail.length, 3);
  assert.equal(detail[2].selectedVendor?.id, 'V1');
  // The list entry underneath remembers what was expanded, so Back reopens it.
  assert.equal(detail[1].expandedMaterial, 'Metformin');
});

test('opening the source already shown changes nothing', () => {
  const stack = pushVendor(pushView([HOME], 'category', 'foreign'), src('V1'));
  assert.equal(pushVendor(stack, src('V1')), stack, 'the same stack instance');
});

test('a record reached from the form replaces the form entry', () => {
  // Otherwise Back went from the new record into the form that created it, and
  // the record inherited formMode and rendered the form again on top of itself.
  const stack = pushForm(pushView([HOME], 'category', 'foreign'), 'create', 'foreign');
  assert.equal(stack[stack.length - 1].formMode, 'create');

  const saved = pushVendor(stack, src('V-NEW'));
  assert.equal(saved.length, 3, 'the form entry was replaced, not stacked under');
  assert.equal(saved[2].selectedVendor?.id, 'V-NEW');
  assert.equal(saved[2].formMode ?? null, null, 'a detail page is never a form page');
});

test('the create form opens on the category it was asked for', () => {
  const stack = pushForm([HOME], 'create', 'veterinary');
  const top = stack[stack.length - 1];
  assert.equal(top.formMode, 'create');
  assert.equal(top.view, 'category');
  assert.equal(top.categoryId, 'veterinary');
  assert.equal(top.selectedVendor, null);
});

test('the edit form keeps the record it is editing', () => {
  const detail = pushVendor(pushView([HOME], 'category', 'foreign'), src('V1'));
  const editing = pushForm(detail, 'edit');
  assert.equal(editing[editing.length - 1].formMode, 'edit');
  assert.equal(editing[editing.length - 1].selectedVendor?.id, 'V1');
});

test('opening the same form twice does not stack it', () => {
  const once = pushForm([HOME], 'create', 'foreign');
  assert.equal(pushForm(once, 'create', 'foreign'), once);
});

test('leaving the form pops exactly the form entry', () => {
  const stack = pushForm(pushView([HOME], 'category', 'foreign'), 'create', 'foreign');
  const closed = popForm(stack);
  assert.equal(closed.length, 2);
  assert.equal(closed[1].formMode ?? null, null);
  // And on a stack with no form on top it is a no-op, not a pop.
  assert.equal(popForm(closed), closed);
});

test('going back never empties the stack', () => {
  assert.deepEqual(popView([HOME]), [HOME]);
  assert.equal(popView(pushView([HOME], 'archive')).length, 1);
});

test('a breadcrumb jump truncates to that depth and ignores nonsense', () => {
  const stack = [HOME, entry(), entry({ selectedVendor: src('V1') })];
  assert.equal(truncateTo(stack, 0).length, 1);
  assert.equal(truncateTo(stack, 1).length, 2);
  assert.equal(truncateTo(stack, 2), stack, 'jumping to where you already are');
  assert.equal(truncateTo(stack, -1), stack);
  assert.equal(truncateTo(stack, 99), stack);
});

test('the stack is capped, keeping the most recent entries', () => {
  let stack: ViewState[] = [HOME];
  for (let i = 0; i < MAX_VIEW_HISTORY + 10; i++) {
    stack = capHistory([...stack, entry({ selectedVendor: src(`V${i}`) })]);
  }
  assert.equal(stack.length, MAX_VIEW_HISTORY);
  assert.equal(stack[stack.length - 1].selectedVendor?.id, `V${MAX_VIEW_HISTORY + 9}`);
});

test('a deep-linked stub is replaced once the real record arrives', () => {
  // A link carries only an id, so the breadcrumb would read blank until the
  // data loads. Hydrating also fills in which material to expand.
  const stub = [HOME, entry({ selectedVendor: { id: 'V1' } as Vendor })];
  const real = { id: 'V1', name: 'شرکت الف', materialEn: 'Paracetamol' } as Vendor;

  const hydrated = hydrateVendor(stub, real);
  assert.equal(hydrated[1].selectedVendor?.name, 'شرکت الف');
  assert.equal(hydrated[1].expandedMaterial, 'Paracetamol');
  // Nothing to do twice: the record now has a name, so it is left alone and the
  // same stack instance comes back — React does not re-render for nothing.
  assert.equal(hydrateVendor(hydrated, real), hydrated);
});

test('hydrating leaves a record the user navigated to alone', () => {
  // Only a stub is a stub. Rewriting a fully-loaded entry would swap the object
  // React is rendering for an equal one.
  const stack = [HOME, entry({ selectedVendor: { id: 'V1', name: 'اولی' } as Vendor })];
  assert.equal(hydrateVendor(stack, { id: 'V1', name: 'تازه' } as Vendor), stack);
});

test('hydrating only ever touches the top of the stack', () => {
  const stack = [HOME, entry({ selectedVendor: { id: 'V1' } as Vendor }), entry({ view: 'archive' })];
  assert.equal(hydrateVendor(stack, { id: 'V1', name: 'x' } as Vendor), stack);
});

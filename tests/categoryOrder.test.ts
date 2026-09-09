import assert from 'node:assert/strict';
import test from 'node:test';
import { CATEGORY_ORDER, categoryRank } from '../src/constants/categories';

/**
 * Ordering the blacklist by the category a source came from.
 *
 * The blacklist is the only register that mixes categories — every other page
 * holds one by definition — so it is the only one where «مرتب‌سازی بر اساس
 * دسته‌بندی» is a question at all. The order a reader expects is the one the
 * sidebar already taught them, so the sidebar's own order is the rule, and it
 * lives with the labels rather than being spelled out again in the view.
 */

test('the rank follows the sidebar order, not the alphabet', () => {
  const shuffled = ['packaging', 'foreign', 'veterinary', 'domestic'];
  const sorted = [...shuffled].sort((a, b) => categoryRank(a) - categoryRank(b));

  assert.deepEqual(sorted, ['foreign', 'domestic', 'veterinary', 'packaging']);
  // Alphabetically «دامی» would lead and «خرید خارجی» would not; the point of
  // the map is that it does not.
  assert.ok(categoryRank('foreign') < categoryRank('veterinary'));
});

test('an unknown or empty category sorts last, never first', () => {
  // An imported row can carry an empty category, and `indexOf` alone would
  // return -1 and float it above every real one.
  for (const missing of ['', '   ', undefined, null, 'import']) {
    assert.equal(categoryRank(missing as any), CATEGORY_ORDER.length,
      `«${String(missing)}» must sort last`);
  }
  assert.ok(categoryRank('') > categoryRank('packaging'));
});

test('a material bought through two routes is placed by its earliest one', () => {
  /*
   * The blacklist groups its rows by material, and a material can be bought
   * through more than one route, so a group has to be placed somewhere. It goes
   * under the first category it holds — appearing once, under a heading that is
   * true of it, rather than being split or ordered by a value half its rows do
   * not have.
   */
  const groupRank = (categories: string[]) => Math.min(...categories.map(categoryRank));

  const mixed = groupRank(['veterinary', 'foreign']);
  assert.equal(mixed, categoryRank('foreign'), 'the earliest route decides');
  assert.ok(mixed < groupRank(['veterinary']), 'so it leads a purely veterinary group');

  // And a mixed group is placed by its earliest member, not by its worst: this
  // one holds packaging and veterinary, so it sorts as veterinary.
  assert.equal(groupRank(['packaging', 'veterinary']), categoryRank('veterinary'));
  assert.ok(groupRank(['domestic']) < groupRank(['packaging', 'veterinary']));
});

test('every category the sidebar lists can be ranked', () => {
  // A category added to the labels without a rank would sort to the end with
  // the unknown ones, quietly.
  for (const id of CATEGORY_ORDER) {
    assert.ok(categoryRank(id) < CATEGORY_ORDER.length, `${id} has no rank`);
  }
});

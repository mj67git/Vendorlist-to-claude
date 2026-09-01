import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, FIXTURE, login, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';

/**
 * Paging the source list against a real database.
 *
 * The unit tests prove the client assembles pages correctly; these prove the
 * server hands out pages that can be assembled at all. The property that
 * matters is not "a page has N rows" but that walking every page reproduces the
 * unpaged list exactly — same rows, same order, nothing twice, nothing missing.
 * A `findMany` without an `orderBy` passes a naive row-count test and fails
 * this one.
 */

before(async () => { await startTestServer(); });
beforeEach(async () => { if (process.env.DATABASE_URL) await resetAll(); });
after(async () => { await stopTestServer(); });

/** Extra sources, deliberately sharing a name so the tie-break is exercised. */
async function seedMany(count: number) {
  const p = db();
  for (let i = 0; i < count; i++) {
    await p.vendor.create({
      data: {
        id: `V-P${String(i).padStart(2, '0')}`,
        // Half of them share one name: without `id` as the second sort key
        // their relative order is undefined and pages may repeat or drop them.
        name: i % 2 === 0 ? 'شرکت هم‌نام' : `شرکت ${i}`,
        nameEn: `Paged ${i}`, country: 'India', status: 'new', grade: 'B',
      },
    });
    await p.vendorMaterial.create({
      data: { id: `L-P${i}`, vendorId: `V-P${String(i).padStart(2, '0')}`, materialId: FIXTURE.materialId, isSample: false, category: 'foreign' },
    });
  }
}

test('without paging the answer is still the plain array it always was', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/vendors', { token });
  assert.equal(res.status, 200);
  assert.ok(Array.isArray(res.body), 'existing callers see no change');
});

test('walking the pages reproduces the unpaged list exactly', SKIP, async () => {
  const token = await login('admin');
  await seedMany(11);

  const whole = (await api('/api/vendors', { token })).body as any[];

  const walked: any[] = [];
  let page = 1;
  for (;;) {
    const res = await api(`/api/vendors?page=${page}&limit=4`, { token });
    assert.equal(res.status, 200);
    walked.push(...res.body.items);
    if (page >= res.body.pages) break;
    page++;
  }

  assert.deepEqual(walked.map(v => v.id), whole.map(v => v.id), 'same rows, same order');
  assert.equal(new Set(walked.map(v => v.id)).size, walked.length, 'no row on two pages');
});

test('the envelope says how much there is to fetch', SKIP, async () => {
  const token = await login('admin');
  await seedMany(11);

  const res = await api('/api/vendors?page=1&limit=5', { token });
  assert.equal(res.body.items.length, 5);
  assert.equal(res.body.total, 12, 'the fixture source plus eleven');
  assert.equal(res.body.pages, 3);
  assert.equal(res.body.page, 1);
  assert.equal(res.body.limit, 5);
});

test('a page carries the same fully-built source as the unpaged list', SKIP, async () => {
  // The relation queries are scoped to the page's ids, which is exactly where a
  // page could come back as a thinner record than the whole list returns.
  const token = await login('admin');
  const whole = (await api('/api/vendors', { token })).body as any[];
  const paged = (await api('/api/vendors?page=1&limit=200', { token })).body.items as any[];
  assert.deepEqual(paged, whole, 'paging changes the packaging, not the record');
});

test('a page past the end is empty rather than an error', SKIP, async () => {
  const token = await login('admin');
  const res = await api('/api/vendors?page=99&limit=10', { token });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.items, []);
});

test('junk paging values are clamped, not served as a 500', SKIP, async () => {
  const token = await login('admin');
  const junk = await api('/api/vendors?page=abc&limit=-1', { token });
  assert.equal(junk.status, 200);
  assert.equal(junk.body.page, 1);
  assert.equal(junk.body.limit, 1);

  // And an unbounded limit cannot be used to ask for the whole table anyway.
  const huge = await api('/api/vendors?limit=999999', { token });
  assert.equal(huge.body.limit, 500);
});

test('paging is behind the same read permission as the list', SKIP, async () => {
  const anon = await api('/api/vendors?page=1&limit=5');
  assert.equal(anon.status, 401, 'a page is not a way around the guard');
});

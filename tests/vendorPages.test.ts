import assert from 'node:assert/strict';
import test from 'node:test';
import { fetchAllVendors, isVendorPage } from '../src/services/vendorPages';
import { clampInt } from '../src/server/http/query';

/**
 * Paging is only safe if assembling the pages gives back exactly the list —
 * no row twice, none missing, and a partial read reported as partial rather
 * than passed off as the whole register.
 */

const envelope = (items: any[], page: number, pages: number, total: number) =>
  ({ items, page, pages, total, limit: 2 });

test('the pages add up to the list, in order', async () => {
  const server = [
    envelope([{ id: 'A' }, { id: 'B' }], 1, 2, 3),
    envelope([{ id: 'C' }], 2, 2, 3),
  ];
  const seen: number[] = [];
  const all = await fetchAllVendors<{ id: string }>({
    fetchPage: async page => { seen.push(page); return server[page - 1]; },
    onPage: () => {},
    limit: 2,
  });
  assert.deepEqual(all.map(v => v.id), ['A', 'B', 'C']);
  assert.deepEqual(seen, [1, 2], 'each page asked for once, in order');
});

test('each page is handed over as it arrives, not held to the end', async () => {
  // This is the whole point: the first page paints while the rest are in flight.
  const painted: string[][] = [];
  await fetchAllVendors<{ id: string }>({
    fetchPage: async page => envelope(page === 1 ? [{ id: 'A' }] : [{ id: 'B' }], page, 2, 2),
    onPage: rows => painted.push(rows.map((r: any) => r.id)),
  });
  assert.deepEqual(painted, [['A'], ['B']]);
});

test('the last page is announced as the last one', async () => {
  const flags: boolean[] = [];
  await fetchAllVendors({
    fetchPage: async page => envelope([{ id: page }], page, 3, 3),
    onPage: (_rows, meta) => flags.push(meta.done),
  });
  assert.deepEqual(flags, [false, false, true]);
});

test('an empty page in the middle does not end the read', async () => {
  // Rows deleted between two requests leave a gap. Stopping at the first empty
  // page would silently truncate the list every aggregate is computed over.
  const all = await fetchAllVendors<{ id: string }>({
    fetchPage: async page => envelope(page === 2 ? [] : [{ id: `p${page}` }], page, 3, 2),
    onPage: () => {},
  });
  assert.deepEqual(all.map(v => v.id), ['p1', 'p3']);
});

test('a plain array is the whole list, not a first page', async () => {
  // An older server, or the endpoint called without paging, already answered
  // with everything; asking it for page 2 would loop forever.
  let calls = 0;
  const all = await fetchAllVendors<{ id: string }>({
    fetchPage: async () => { calls++; return [{ id: 'A' }, { id: 'B' }]; },
    onPage: () => {},
  });
  assert.equal(calls, 1);
  assert.deepEqual(all.map(v => v.id), ['A', 'B']);
});

test('a failure part-way through is raised, not quietly truncated', async () => {
  await assert.rejects(fetchAllVendors({
    fetchPage: async page => {
      if (page === 2) throw new Error('network');
      return envelope([{ id: 'A' }], 1, 5, 5);
    },
    onPage: () => {},
  }), /network/);
});

test('an uninterpretable answer is refused rather than treated as empty', async () => {
  await assert.rejects(fetchAllVendors({
    fetchPage: async () => ({ error: 'nope' }),
    onPage: () => {},
  }), /قابل تفسیر نیست/);
});

test('a server claiming endless pages is stopped', async () => {
  let calls = 0;
  await assert.rejects(fetchAllVendors({
    fetchPage: async page => { calls++; return envelope([{ id: page }], page, 1e9, 1e9); },
    onPage: () => {},
    maxPages: 4,
  }), /بیش از حد انتظار/);
  assert.equal(calls, 4);
});

test('an envelope is told apart from an array and from junk', () => {
  assert.equal(isVendorPage({ items: [], total: 0, pages: 1 }), true);
  assert.equal(isVendorPage([]), false);
  assert.equal(isVendorPage(null), false);
  assert.equal(isVendorPage({ items: [] }), false);
});

test('query numbers are clamped, never handed to the database as junk', () => {
  assert.equal(clampInt('3', 1, 1, 500), 3);
  assert.equal(clampInt('abc', 7, 1, 500), 7, 'nonsense falls back');
  assert.equal(clampInt(undefined, 7, 1, 500), 7);
  assert.equal(clampInt('0', 1, 1, 500), 1, 'below the floor');
  assert.equal(clampInt('99999', 1, 1, 500), 500, 'an unbounded page is not askable');
  assert.equal(clampInt('-4', 1, 1, 500), 1);
  assert.equal(clampInt('2.9', 1, 1, 500), 2, 'truncated, not rounded up past the max');
});

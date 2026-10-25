import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FIXTURE, SKIP, api, db, login, resetAll, startTestServer, stopTestServer,
} from './helpers/apiHarness';
import { PROFILE_FIELDS, buildVendorSections } from '../src/state/vendorSectionDelta';

/**
 * Re-filing a source — into another category, or onto another material.
 *
 * Both were reported the same way: the screen updates, the toast says it saved,
 * and one reload puts the old value back. That shape always means the same
 * thing — the browser changed its own copy and the server never heard about the
 * field (rule 11b). Here it was in the client's delta builder: the profile
 * comparison listed eleven fields and neither `category` nor `materialId` was
 * among them, so a source moved between registers produced a payload with no
 * profile part at all, and a source re-pointed at another substance travelled
 * without the catalogue id the form had picked.
 *
 * The first three tests are on the builder, because that is where the fields
 * were missing. The rest drive the HTTP endpoint with what the builder now
 * produces, so the two halves are checked against each other rather than each
 * against an assumption about the other.
 */

const source = (over: Record<string, unknown> = {}) => ({
  id: FIXTURE.vendorId,
  material: 'امپرازول', materialEn: 'Omeprazole', cas: '73590-58-6',
  materialId: FIXTURE.materialId,
  name: 'فروشندهٔ الف', nameEn: 'Seller A', country: 'Turkey',
  category: 'foreign', status: 'new', grade: 'B', isSample: false,
  ...over,
}) as any;

test('moving a source to another register produces a profile part', () => {
  const sections = buildVendorSections(source(), source({ category: 'domestic' }));
  assert.ok(sections.profile, 'a category change on its own used to send nothing at all');
  assert.equal(sections.profile!.category, 'domestic');
});

test('the catalogue id of the picked material travels with the name', () => {
  const sections = buildVendorSections(source(), source({
    materialId: 'M-ESO', material: 'اس‌امپرازول', materialEn: 'Esomeprazole', cas: '161796-78-7',
  }));
  assert.ok(sections.profile);
  assert.equal(sections.profile!.materialId, 'M-ESO');
  assert.equal(sections.profile!.material, 'اس‌امپرازول');
});

test('a blacklisted source keeps the register it is stored under', () => {
  // The form preserves «blacklist» rather than re-filing (rule 11d), and the
  // payload now carries the category explicitly — so this checks the client
  // writes back what was stored rather than inventing a register for it.
  const stored = source({ category: 'blacklist' });
  const sections = buildVendorSections(stored, { ...stored, country: 'China' });
  assert.equal(sections.profile!.category, 'blacklist');
});

test('an untouched source still sends nothing', () => {
  // The guard that keeps an open-and-close of the form from writing a row.
  assert.deepEqual(buildVendorSections(source(), source()), {});
});

test('every profile field the payload carries is also compared', () => {
  // The two lists are the same list now; this fails if someone splits them again.
  const built = buildVendorSections(source(), source({ name: 'نام تازه' })).profile!;
  for (const field of PROFILE_FIELDS) {
    assert.ok(field in built, `${field} is missing from the profile payload`);
  }
});

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });
beforeEach(async () => { await resetAll(); });

/**
 * Read the source the way the page reloads — there is no `GET /api/vendors/:id`,
 * the application refetches the list, so that is what the reload half of this
 * report has to be checked against.
 */
async function readSource(token: string) {
  const res = await api('/api/vendors', { token });
  const list = res.body?.vendors || res.body;
  const found = (list as any[]).find(v => v.id === FIXTURE.vendorId);
  assert.ok(found, 'the fixture source must come back from the list');
  return found;
}

/** Send exactly what the client would send for this edit. */
async function saveEdit(token: string, stored: any, edit: Record<string, unknown>) {
  const sections = buildVendorSections(stored, { ...stored, ...edit } as any);
  return api(`/api/vendors/${FIXTURE.vendorId}`, {
    method: 'PUT', token,
    body: { sections, expectedUpdatedAt: stored.updatedAt ?? null },
  });
}

test('moving a source to another category survives a reload', SKIP, async () => {
  const token = await login('admin');
  const p = db();

  const start = await p.vendorMaterial.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(start!.category, 'foreign', 'the fixture starts in the foreign register');

  const stored = await readSource(token);

  const res = await saveEdit(token, stored, { category: 'domestic' });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const link = await p.vendorMaterial.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(link!.category, 'domestic', 'the register the user chose is the one stored');
});

test('re-pointing a source links the catalogue row that was picked', SKIP, async () => {
  const token = await login('admin');
  const p = db();

  // A second substance, already in the catalogue — the one the user picks.
  await p.material.create({
    data: { id: 'M-ESO', name: 'اس‌امپرازول', nameEn: 'Esomeprazole', cas: '161796-78-7', irc: 'N/A' },
  });

  const stored = await readSource(token);

  const res = await saveEdit(token, stored, {
    materialId: 'M-ESO', material: 'اس‌امپرازول', materialEn: 'Esomeprazole', cas: '161796-78-7',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const links = await p.vendorMaterial.findMany({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(links.length, 1, 'a source supplies one material, not two');
  assert.equal(
    links[0].materialId, 'M-ESO',
    'the link points at the catalogue row the form chose, not at one derived from the CAS',
  );

  // And no duplicate of a substance that was already in the catalogue.
  const rows = await p.material.findMany({ where: { cas: '161796-78-7' } });
  assert.equal(rows.length, 1, 'picking a catalogue entry must not mint a second one');
});

test('changing the register and the material together keeps both', SKIP, async () => {
  const token = await login('admin');
  const p = db();

  await p.material.create({
    data: { id: 'M-ESO2', name: 'اس‌امپرازول', nameEn: 'Esomeprazole', cas: '161796-78-7', irc: 'N/A' },
  });

  const stored = await readSource(token);

  const res = await saveEdit(token, stored, {
    category: 'veterinary',
    materialId: 'M-ESO2', material: 'اس‌امپرازول', materialEn: 'Esomeprazole', cas: '161796-78-7',
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));

  const link = await p.vendorMaterial.findFirst({ where: { vendorId: FIXTURE.vendorId } });
  assert.equal(link!.materialId, 'M-ESO2');
  assert.equal(link!.category, 'veterinary');
});

test('the read gives back the register that was stored', SKIP, async () => {
  // The reload half of the report: it is not enough that the row changed, the
  // GET the page reloads with has to say so too.
  const token = await login('admin');

  const stored = await readSource(token);
  await saveEdit(token, stored, { category: 'packaging' });

  const back = await readSource(token);
  assert.equal(back.category, 'packaging');
});

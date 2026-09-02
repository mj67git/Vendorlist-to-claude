import assert from 'node:assert/strict';
import test, { after, before, beforeEach } from 'node:test';
import { api, db, login, resetAll, SKIP, startTestServer, stopTestServer } from './helpers/apiHarness';

/**
 * SOP documents and their uploaded files, across an edit.
 *
 * The evaluation and its documents used to be deleted and recreated on every
 * save, which meant each stored file had to be read out of the database,
 * carried through the save and written back — so correcting a supplier's phone
 * number moved every PDF they had ever uploaded. They are updated in place now,
 * and these tests pin the three rules that made the old code work, because
 * getting any of them wrong deletes a regulated document silently.
 */

const PARTNER = 'BP-FILES';
const BLOB = 'data:application/pdf;base64,JVBERi0xLjQKJSBmaXJzdA==';
const OTHER_BLOB = 'data:application/pdf;base64,JVBERi0xLjQKJSBzZWNvbmQ=';

before(async () => { await startTestServer(); });
beforeEach(async () => { if (process.env.DATABASE_URL) await resetAll(); });
after(async () => { await stopTestServer(); });

/** A seller carrying one SOP document with a file attached. */
function partnerBody(doc: Record<string, unknown>) {
  return {
    id: PARTNER, name: 'فروشندهٔ پرونده‌دار', nameEn: 'Docs Seller',
    type: 'Supplier', country: 'Turkey', status: 'Active',
    evaluation: {
      totalScore: 20, grade: 'Blacklist', status: 'Blacklist',
      documents: { businessLicense: { key: 'businessLicense', nameFa: 'مجوز کسب‌وکار', nameEn: 'Business License', status: 'Approved', score: 20, ...doc } },
    },
  };
}

async function createWithFile(token: string) {
  const res = await api('/api/business-partners', {
    method: 'POST', token,
    body: partnerBody({ fileName: 'license.pdf', fileSize: 42, fileDataUrl: BLOB }),
  });
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

async function storedFile() {
  const rows = await db().sopDocument.findMany({ where: { key: 'businessLicense' } });
  return rows[0] ?? null;
}

test('an edit that does not re-upload keeps the stored file', SKIP, async () => {
  const token = await login('admin');
  await createWithFile(token);

  // The client never receives the blob, so a normal edit sends the file's name
  // back and nothing else. That must not be read as "the file is gone".
  const res = await api(`/api/business-partners/${PARTNER}`, {
    method: 'PUT', token,
    body: { ...partnerBody({ fileName: 'license.pdf', fileSize: 42 }), city: 'ازمیر' },
  });
  assert.equal(res.status, 200);

  const doc = await storedFile();
  assert.equal(doc.fileDataUrl, BLOB, 'the uploaded document survived an unrelated edit');
  assert.equal(doc.fileName, 'license.pdf');
});

test('clearing the file name removes the file', SKIP, async () => {
  const token = await login('admin');
  await createWithFile(token);

  await api(`/api/business-partners/${PARTNER}`, {
    method: 'PUT', token,
    body: partnerBody({ fileName: null, fileSize: null }),
  });

  const doc = await storedFile();
  assert.equal(doc.fileDataUrl, null, 'removing the file is honoured');
  assert.equal(doc.fileName, null);
});

test('a fresh upload replaces the stored file', SKIP, async () => {
  const token = await login('admin');
  await createWithFile(token);

  await api(`/api/business-partners/${PARTNER}`, {
    method: 'PUT', token,
    body: partnerBody({ fileName: 'license-v2.pdf', fileSize: 99, fileDataUrl: OTHER_BLOB }),
  });

  const doc = await storedFile();
  assert.equal(doc.fileDataUrl, OTHER_BLOB);
  assert.equal(doc.fileSize, 99);
});

test('a document dropped from the payload is deleted', SKIP, async () => {
  const token = await login('admin');
  await createWithFile(token);

  const body = partnerBody({ fileName: 'license.pdf' });
  (body.evaluation as any).documents = {};
  await api(`/api/business-partners/${PARTNER}`, { method: 'PUT', token, body });

  assert.equal(await db().sopDocument.count({ where: { key: 'businessLicense' } }), 0);
});

test('the list reports that a file exists without carrying it', SKIP, async () => {
  const token = await login('admin');
  await createWithFile(token);

  const res = await api('/api/business-partners', { token });
  const partner = (res.body as any[]).find(p => p.id === PARTNER);
  const doc = partner.evaluation.documents.businessLicense;

  assert.equal(doc.hasFile, true, 'the list still knows there is a file');
  assert.equal(doc.fileDataUrl, undefined, 'and still does not carry it');
  assert.equal(JSON.stringify(res.body).includes(BLOB), false, 'no blob anywhere in the payload');
});

test('the file itself is served from its own endpoint', SKIP, async () => {
  const token = await login('admin');
  await createWithFile(token);

  const res = await api(`/api/business-partners/${PARTNER}/documents/businessLicense/file`, { token });
  assert.equal(res.status, 200);
  assert.equal(res.body.fileDataUrl, BLOB);
});

test('an evaluation removed from a partner takes its documents with it', SKIP, async () => {
  const token = await login('admin');
  await createWithFile(token);

  const body: any = partnerBody({ fileName: 'license.pdf' });
  body.type = 'Manufacturer';
  delete body.evaluation;
  await api(`/api/business-partners/${PARTNER}`, { method: 'PUT', token, body });

  assert.equal(await db().supplierEvaluation.count({ where: { partnerId: PARTNER } }), 0);
  assert.equal(await db().sopDocument.count({ where: { key: 'businessLicense' } }), 0);
});

test('the material list reports its attachment without carrying it', SKIP, async () => {
  // Same rule on the other side of the application: the specification PDF is
  // fetched from its own endpoint, so the list must know a file exists without
  // reading one.
  const token = await login('admin');
  await db().material.create({
    data: {
      id: 'M-SPEC', name: 'ماده با مشخصات', nameEn: 'Spec Material', cas: '50-00-0', irc: 'N/A',
      specificationFile: 'spec.pdf', specificationFileSize: 42, specificationFileData: BLOB,
    },
  });

  const res = await api('/api/materials', { token });
  const material = (res.body as any[]).find(m => m.id === 'M-SPEC');

  assert.equal(material.hasSpecificationFile, true);
  assert.equal(material.specificationFile, 'spec.pdf');
  assert.equal(JSON.stringify(res.body).includes(BLOB), false, 'no blob in the list payload');

  const file = await api('/api/materials/M-SPEC/specification/file', { token });
  assert.equal(file.status, 200);
  assert.equal(file.body.fileDataUrl, BLOB);
});

test('a material with no attachment says so', SKIP, async () => {
  const token = await login('admin');
  await db().material.create({
    data: { id: 'M-BARE', name: 'بدون مشخصات', nameEn: 'Bare', cas: '64-17-5', irc: 'N/A' },
  });
  const res = await api('/api/materials', { token });
  const material = (res.body as any[]).find(m => m.id === 'M-BARE');
  assert.equal(material.hasSpecificationFile, false);
});

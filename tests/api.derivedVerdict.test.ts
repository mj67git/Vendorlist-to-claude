import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SKIP, api, db, login, profileBody, resetAll, startTestServer, stopTestServer,
} from './helpers/apiHarness';

/**
 * The qualification of a source is the server's to decide, not the caller's.
 *
 * Project rule 11c says a derived value is never believed from the payload —
 * it is recomputed where it is stored. That rule is enforced for a business
 * partner: `upsertBusinessPartner` rebuilds the SOP grade from the documents
 * with `computeSupplierEvaluation`, so a request cannot assert one. It is not
 * enforced for a source. `applyDerivedState`, which knows the 80/60/40 rubric,
 * is called only in the browser.
 *
 * So a request can claim any grade it likes on any scores it likes, and the
 * database keeps the claim. On a system whose output is a signed GMP record,
 * that makes the qualification of a supplier forgeable.
 *
 * These tests state what the server must decide for itself. They fail today.
 */

before(async () => { await startTestServer(); });
after(async () => { await stopTestServer(); });
beforeEach(async () => { await resetAll(); });

test('a source cannot be created with a grade its scores do not support', SKIP, async () => {
  const token = await login('admin');

  const res = await api('/api/vendors', {
    method: 'POST',
    token,
    body: {
      id: 'V-FORGE-1',
      material: 'پاراستامول', materialEn: 'Paracetamol', cas: '103-90-2', irc: '',
      name: 'شرکت آزمایشی', nameEn: 'Probe Co', country: 'India',
      category: 'foreign',
      // Ten out of a hundred. The rubric puts this below the floor entirely.
      scores: { commercial: 10, qa: 10, planning: 10, finance: 10 },
      // …and the request says otherwise.
      grade: 'A',
      status: 'approved',
    },
  });

  assert.ok(res.status < 500, `unexpected server error: ${res.status}`);

  const stored = await db().vendor.findUnique({ where: { id: 'V-FORGE-1' } });
  if (!stored) return; // A refusal is an acceptable answer too.

  assert.notEqual(stored.grade, 'A', 'a source scoring 10 must not be stored as grade A');
  assert.notEqual(stored.status, 'approved', 'a source scoring 10 must not be stored as approved');
});

test('an edit cannot raise the grade without raising the scores', SKIP, async () => {
  const token = await login('admin');

  await api('/api/vendors', {
    method: 'POST',
    token,
    body: {
      id: 'V-FORGE-2',
      material: 'پاراستامول', materialEn: 'Paracetamol', cas: '103-90-2', irc: '',
      name: 'شرکت آزمایشی', nameEn: 'Probe Co', country: 'India', category: 'foreign',
      scores: { commercial: 20, qa: 20, planning: 20, finance: 20 },
      grade: 'D', status: 'new',
    },
  });

  await api('/api/vendors/V-FORGE-2/profile', {
    method: 'PATCH',
    token,
    body: profileBody({ grade: 'A', status: 'approved', supplierId: null }),
  });

  const stored = await db().vendor.findUnique({ where: { id: 'V-FORGE-2' } });
  assert.ok(stored, 'the source should still exist');
  assert.notEqual(stored.grade, 'A', 'the profile route must not accept an unearned grade');
});

test('the evaluation row agrees with the grade beside it', SKIP, async () => {
  // The spreadsheet, the printed form and the dashboard all read this row. A
  // total of 10 filed under grade A is the same forgery one table deeper.
  const token = await login('admin');

  await api('/api/vendors', {
    method: 'POST',
    token,
    body: {
      id: 'V-FORGE-3',
      material: 'پاراستامول', materialEn: 'Paracetamol', cas: '103-90-2', irc: '',
      name: 'شرکت آزمایشی', nameEn: 'Probe Co', country: 'India', category: 'foreign',
      scores: { commercial: 10, qa: 10, planning: 10, finance: 10 },
      grade: 'A', status: 'approved',
    },
  });

  const evaluation = await db().evaluation.findFirst({ where: { vendorId: 'V-FORGE-3' } });
  if (!evaluation) return;
  assert.notEqual(
    evaluation.grade, 'A',
    `an evaluation totalling ${evaluation.totalScore} must not be graded A`,
  );
});

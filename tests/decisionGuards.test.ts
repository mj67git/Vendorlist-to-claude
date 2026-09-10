import assert from 'node:assert/strict';
import test from 'node:test';
import { forbiddenPartnerDecisions, forbiddenVerdictChange } from '../src/utils/decisionGuards';

/**
 * The decisions that ride inside an ordinary edit.
 *
 * Both endpoints these guard replace the whole record, so the permission cannot
 * be expressed on the route: the check has to compare the payload against what
 * is stored. What matters most here is the *negative* case — a full-record save
 * that repeats the stored verdict unchanged must pass, or every ordinary edit
 * by a commercial user starts failing with a permission error.
 */

const source = { id: 'V1', name: 'الف', status: 'approved', rejectionReasons: null };
const sample = { ...source, id: 'S1', isSample: true, category: 'sample' };

/** Holds `vendor.edit` and its own score, but decides nothing. */
const editor = { role: 'commercial' };
/** Quality: rules on samples and on seller documents, not on sources. */
const quality = { role: 'qa' };
const admin = { role: 'admin' };

test('an edit that leaves the verdict alone is not a decision', () => {
  const unchanged = { ...source, name: 'الف (اصلاح‌شده)', country: 'India' };
  assert.equal(forbiddenVerdictChange(editor, source, unchanged), null);
  // Even when the payload repeats the verdict fields verbatim, which is what a
  // whole-record save does.
  assert.equal(forbiddenVerdictChange(editor, source, { ...source }), null);
});

test('disqualifying a source needs the source decision, not the edit permission', () => {
  const rejected = { status: 'rejected', rejectionReasons: ['رد توسط ادمین — کیفیت'] };
  const refusal = forbiddenVerdictChange(editor, source, rejected);
  assert.equal(refusal?.permission, 'vendor.decide');
  assert.deepEqual(refusal?.fields, ['status', 'rejectionReasons']);

  // Quality tests what quality tested; ending a commercial relationship is not
  // the laboratory's call, so QA is refused here too.
  assert.equal(forbiddenVerdictChange(quality, source, rejected)?.permission, 'vendor.decide');
  assert.equal(forbiddenVerdictChange(admin, source, rejected), null);
});

test('restoring a source from the blacklist is the same decision', () => {
  const blacklisted = { ...source, status: 'rejected', rejectionReasons: ['رد توسط ادمین — کیفیت'] };
  const restored = { status: 'approved', rejectionReasons: null };
  assert.equal(forbiddenVerdictChange(editor, blacklisted, restored)?.permission, 'vendor.decide');
  assert.equal(forbiddenVerdictChange(admin, blacklisted, restored), null);
});

test('the sample verdict is quality\'s, and it is a different permission', () => {
  const rejected = { status: 'rejected', rejectionReasons: ['رد توسط ادمین — نتایج آزمایشگاهی'] };
  assert.equal(forbiddenVerdictChange(quality, sample, rejected), null, 'QA rules on the sample');
  assert.equal(forbiddenVerdictChange(editor, sample, rejected)?.permission, 'sample.decide');
});

test('which decision applies is read from the stored record, not the payload', () => {
  // Otherwise relabelling a source as a sample in the same payload would buy
  // the weaker permission and disqualify it under `sample.decide`.
  const relabelled = { isSample: true, category: 'sample', status: 'rejected', rejectionReasons: ['رد'] };
  assert.equal(forbiddenVerdictChange(quality, source, relabelled)?.permission, 'vendor.decide');
});

test('reordering the stated grounds is not a new decision', () => {
  const stored = { ...source, status: 'rejected', rejectionReasons: ['دلیل الف', 'دلیل ب'] };
  const reordered = { rejectionReasons: ['دلیل ب', 'دلیل الف'] };
  assert.equal(forbiddenVerdictChange(editor, stored, reordered), null);
  // …but rewriting them is.
  const rewritten = { rejectionReasons: ['دلیل ب', 'دلیل پ'] };
  assert.deepEqual(forbiddenVerdictChange(editor, stored, rewritten)?.fields, ['rejectionReasons']);
});

test('a source moving through its ordinary states stays with the edit permission', () => {
  // «جدید» to «تأییدشده» as the evaluation fills in is record maintenance. Only
  // the disqualification and the restoration are the decision.
  const fresh = { ...source, status: 'new' };
  assert.equal(forbiddenVerdictChange(editor, fresh, { status: 'approved' }), null);
  assert.equal(forbiddenVerdictChange(editor, fresh, { status: 'conditional' }), null);
});

const seller = {
  id: 'bp_1', name: 'فروشندهٔ الف', status: 'Active',
  evaluation: { documents: { businessLicense: { status: 'Approved', expiryDate: '1406-01-01' } }, grade: 'A' },
};

test('grading a seller\'s documents belongs to quality, not to whoever owns the record', () => {
  const regraded = {
    ...seller,
    evaluation: { documents: { businessLicense: { status: 'Not Submitted' } } },
  };
  const refusals = forbiddenPartnerDecisions(editor, seller, regraded);
  assert.deepEqual(refusals.map(r => r.permission), ['partner.evaluate']);
  assert.equal(forbiddenPartnerDecisions(quality, seller, regraded).length, 0);
});

test('editing a seller\'s contact details is not evaluating them', () => {
  const edited = { ...seller, phone: '021-0000', email: 'a@b.c' };
  assert.deepEqual(forbiddenPartnerDecisions(editor, seller, edited), []);
});

test('switching a partner off is its own decision', () => {
  const deactivated = { ...seller, status: 'Inactive' };
  // Commercial holds `partner.status`; quality does not.
  assert.deepEqual(forbiddenPartnerDecisions(editor, seller, deactivated), []);
  assert.deepEqual(
    forbiddenPartnerDecisions(quality, seller, deactivated).map(r => r.permission),
    ['partner.status'],
  );
});

test('a payload that omits a field decides nothing about it', () => {
  assert.deepEqual(forbiddenPartnerDecisions(quality, seller, { name: 'نام تازه' }), []);
});

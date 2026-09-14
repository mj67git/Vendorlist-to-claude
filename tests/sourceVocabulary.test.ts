import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isSourceGrade, normalizeSourceGrade, normalizeSourceQualification,
  SOURCE_GRADES, SOURCE_QUALIFICATIONS,
} from '../src/utils/sourceVocabulary';
import { applyDerivedState, isExplicitlyRejected, scoreBelowFloor } from '../src/utils/vendorState';
import { GRADE_TIERS } from '../src/server/domain/vendorEvaluation';
import { describeVendorGrade } from '../src/components/GradeBadge';

const source = (over: any = {}) => ({
  id: 'V1', isSample: false, category: 'foreign',
  status: 'new', grade: null, scores: null,
  analysisRecords: [], rejectionReasons: null, rejectedByDecision: false, ...over,
});

const scores = (n: number) => ({ commercial: n, qa: n, planning: n, finance: n });

test('the retired spellings are still understood on the way in', () => {
  // The same arrangement `LEGACY_PERMISSIONS` has: a value written by an older
  // version keeps being read, and is never written again.
  assert.equal(normalizeSourceGrade('rejected'), 'D');
  assert.equal(normalizeSourceGrade('black list'), 'D');
  assert.equal(normalizeSourceGrade('Blacklist'), 'D');
  assert.equal(normalizeSourceGrade('new'), null);
  assert.equal(normalizeSourceGrade('Not Evaluated'), null);
  assert.equal(normalizeSourceGrade(''), null);
  assert.equal(normalizeSourceGrade(null), null);
  assert.equal(normalizeSourceGrade(undefined), null);
  assert.equal(normalizeSourceGrade('  b  '), 'B');
});

test('the four bands are the only grades', () => {
  assert.deepEqual([...SOURCE_GRADES], ['A', 'B', 'C', 'D']);
  for (const g of SOURCE_GRADES) assert.equal(isSourceGrade(g), true);
  for (const junk of ['rejected', 'black list', 'new', 'E', '', null]) {
    assert.equal(isSourceGrade(junk), false, `${junk} is not a grade`);
  }
});

test('an unrecognised qualification reads as «new», not as itself', () => {
  assert.deepEqual([...SOURCE_QUALIFICATIONS], ['new', 'approved', 'conditional', 'rejected']);
  assert.equal(normalizeSourceQualification('approved'), 'approved');
  assert.equal(normalizeSourceQualification('Blacklisted'), 'rejected');
  assert.equal(normalizeSourceQualification('Active'), 'approved');
  assert.equal(normalizeSourceQualification('پرونده‌ای که کسی نمی‌شناسد'), 'new');
  assert.equal(normalizeSourceQualification(undefined), 'new');
});

test('the derivation never writes a verdict into the grade column', () => {
  const byDecision = applyDerivedState(source({
    grade: 'B', scores: scores(70), rejectedByDecision: true,
  }));
  assert.equal(byDecision.status, 'rejected');
  assert.equal(byDecision.grade, 'B', 'a source turned down at B is still a B');

  const byScore = applyDerivedState(source({ scores: scores(20) }));
  assert.equal(byScore.status, 'rejected');
  assert.equal(byScore.grade, 'D', 'below the floor the band is D, and D is a grade');

  for (const v of [byDecision, byScore]) {
    assert.ok(isSourceGrade(v.grade), `${v.grade} must be one of the four bands`);
  }
});

test('«no grade» is null, not the word new', () => {
  const stale = applyDerivedState(source({ grade: 'new' }));
  assert.equal(stale.grade, null);

  const cleared = applyDerivedState(source({ grade: 'rejected', rejectedByDecision: false }));
  assert.equal(cleared.grade, 'D', 'a legacy verdict in the column reads as the band it implied');
  assert.equal(cleared.status, 'new', 'and it does not drag the status back (rule 11)');
});

test('the derivation is still idempotent under the new vocabulary', () => {
  for (const base of [
    source({ scores: scores(90) }),
    source({ scores: scores(20) }),
    source({ grade: 'black list', rejectedByDecision: true }),
    source({ grade: 'new' }),
  ]) {
    const once = applyDerivedState(base);
    assert.deepEqual(applyDerivedState(once), once);
  }
});

test('the served tier table speaks the same vocabulary', () => {
  // `/api/config` publishes this table to the browser, so a fourth spelling of
  // the verdict here reached the client as though it were a grade.
  for (const tier of GRADE_TIERS) {
    assert.ok(isSourceGrade(tier.grade), `tier ${tier.min} has grade ${tier.grade}`);
    assert.ok(
      (SOURCE_QUALIFICATIONS as readonly string[]).includes(tier.status),
      `tier ${tier.min} has status ${tier.status}`,
    );
  }
});

test('the badge reads D as a grade rather than as «not assessed»', () => {
  // Before the grade column stopped carrying the verdict this branch could not
  // be reached, and a stored D printed as «ارزیابی‌نشده».
  assert.equal(
    describeVendorGrade(source({ grade: 'D', status: 'conditional', scores: scores(45) })).label,
    'گرید D',
  );
  // The verdict still wins when there is one, whatever the grade says — and it
  // comes from `isVendorRejected`, so the badge and the blacklist register
  // cannot disagree (rule 11).
  assert.equal(
    describeVendorGrade(source({ grade: 'B', scores: scores(70), rejectedByDecision: true })).label,
    'لیست سیاه',
  );
});

test('«a person decided» is the decision column, not the presence of a reason', () => {
  // The blacklist chips counted a recorded decision with no typed reason as a
  // low score, so a source nobody had ever scored appeared under «امتیاز پایین».
  const decided = source({ rejectedByDecision: true });
  assert.equal(isExplicitlyRejected(decided), true);
  assert.equal(scoreBelowFloor(decided), false, 'nothing was scored, so nothing is below the floor');

  const byScore = source({ scores: scores(20) });
  assert.equal(isExplicitlyRejected(byScore), false);
  assert.equal(scoreBelowFloor(byScore), true);

  // The older way of writing the same decision still answers.
  assert.equal(isExplicitlyRejected({ rejectionReasons: ['رد توسط مدیر — دلیل'] }), true);
  assert.equal(isExplicitlyRejected(source()), false);
});

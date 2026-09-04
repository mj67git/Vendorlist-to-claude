import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, canScoreDepartment, canScoreAny, scorableDepartments,
  forbiddenScoreChanges, forbiddenRawScoreChanges,
  effectivePermissions, hasCustomPermissions, roleTemplate, sanitizePermissions,
  ALL_PERMISSIONS, SCORING_DEPARTMENTS, type Permission, type Role,
} from '../src/utils/permissions';

/**
 * The approved access matrix, written out once. Every cell below is asserted,
 * so a change to the policy that nobody meant shows up as a failing test rather
 * than as a role quietly gaining or losing an ability in production.
 */
const READ_ALL: Permission[] = ['vendor.read', 'material.read', 'partner.read'];

/** Every read a stored override predating read permissions is credited with. */
const LEGACY_READS: Permission[] = [...READ_ALL, 'partner.files'];

const MATRIX: Record<Role, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  commercial: [...READ_ALL, 'partner.files', 'vendor.create', 'vendor.edit', 'vendor.select', 'partner.create', 'partner.edit', 'partner.delete', 'score.commercial'],
  qa: [...READ_ALL, 'partner.files', 'vendor.analysis', 'vendor.risk', 'material.create', 'material.edit', 'material.delete', 'score.qa'],
  planning: [...READ_ALL, 'score.planning'],
  finance: [...READ_ALL, 'score.finance'],
  lab: [...READ_ALL, 'vendor.analysis'],
};

test('every role holds exactly the permissions in the approved matrix', () => {
  for (const role of Object.keys(MATRIX) as Role[]) {
    for (const permission of ALL_PERMISSIONS) {
      const expected = MATRIX[role].includes(permission);
      assert.equal(can(role, permission), expected,
        `${role} ${expected ? 'should' : 'should NOT'} hold ${permission}`);
    }
  }
});

test('admin holds every permission there is', () => {
  for (const permission of ALL_PERMISSIONS) {
    assert.equal(can('admin', permission), true, `admin is missing ${permission}`);
  }
});

test('risk assessment belongs to quality, and to nobody else by default', () => {
  // It was admin-only while the UI still showed QA the risk form and a
  // "ریسک ثبت‌نشده" backlog: the screen offered work the server refused. FMEA
  // is a quality activity, so QA holds it alongside the laboratory results.
  assert.equal(can('admin', 'vendor.risk'), true);
  assert.equal(can('qa', 'vendor.risk'), true);
  for (const role of ['lab', 'commercial', 'planning', 'finance'] as Role[]) {
    assert.equal(can(role, 'vendor.risk'), false, `${role} must not assess risk`);
  }
});

test('only admin may delete a source', () => {
  assert.equal(can('admin', 'vendor.delete'), true);
  for (const role of ['commercial', 'qa', 'lab', 'planning', 'finance'] as Role[]) {
    assert.equal(can(role, 'vendor.delete'), false, `${role} must not delete sources`);
  }
});

test('the score-only roles may read everything but write only their own score', () => {
  for (const role of ['planning', 'finance'] as Role[]) {
    for (const permission of ALL_PERMISSIONS) {
      const expected = permission === `score.${role}` || READ_ALL.includes(permission);
      assert.equal(can(role, permission), expected, `${role} / ${permission}`);
    }
  }
});

test('the laboratory role can do the laboratory work, and nothing beyond it', () => {
  // It used to hold nothing at all — every account with this role could open no
  // page in the application, while the user form still offered the role. The
  // results are entered against a source, so the reads come with the job.
  assert.equal(can('lab', 'vendor.analysis'), true);
  for (const permission of READ_ALL) {
    assert.equal(can('lab', permission), true, `lab needs ${permission} to do its work`);
  }
  for (const permission of ALL_PERMISSIONS) {
    if (permission === 'vendor.analysis' || READ_ALL.includes(permission)) continue;
    assert.equal(can('lab', permission), false, `lab unexpectedly holds ${permission}`);
  }
  // The bench does not need a supplier's legal papers to run a test.
  assert.equal(can('lab', 'partner.files'), false);
});

test('taking data out of the system is an administrator act by default', () => {
  // Reading a page and exporting it are different acts: every export is built
  // in the browser from data the account can already read, so this setting
  // governs the file leaving the building rather than the reading.
  assert.equal(can('admin', 'data.export'), true);
  for (const role of ['commercial', 'qa', 'lab', 'planning', 'finance'] as Role[]) {
    assert.equal(can(role, 'data.export'), false, `${role} must not export by default`);
  }
});

test('export can be granted to one person without making them an administrator', () => {
  // Which is the whole reason it is a permission and not a `role === admin`
  // test: the person who prepares the regulator's pack needs the file, not the
  // user-administration module.
  const preparer = { role: 'qa', permissions: ['vendor.read', 'material.read', 'partner.read', 'data.export'] };
  assert.equal(can(preparer, 'data.export'), true);
  assert.equal(can(preparer, 'users.manage'), false);
  assert.equal(can(preparer, 'vendor.delete'), false);
});

test('choosing the source for a material is not the same right as editing one', () => {
  // Under one permission, anyone who could fix a phone number could also change
  // which supplier the company buys a material from.
  assert.equal(can('commercial', 'vendor.select'), true, 'commercial places the order');
  assert.equal(can('admin', 'vendor.select'), true);
  for (const role of ['qa', 'lab', 'planning', 'finance'] as Role[]) {
    assert.equal(can(role, 'vendor.select'), false, `${role} must not choose the source`);
  }
  // QA edits and analyses, but does not decide the purchase.
  assert.equal(can('qa', 'vendor.analysis'), true);
  assert.equal(can('qa', 'vendor.select'), false);
});

test('an unknown or missing role holds nothing', () => {
  for (const role of [undefined, null, '', 'root', 'superuser']) {
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(can(role as any, permission), false);
    }
  }
});

test('a role may score only its own department', () => {
  const cases: Array<[Role, string, boolean]> = [
    ['finance', 'finance', true],   ['finance', 'qa', false],
    ['qa', 'qa', true],             ['qa', 'finance', false],
    ['planning', 'planning', true], ['planning', 'commercial', false],
    ['commercial', 'commercial', true], ['commercial', 'planning', false],
    ['lab', 'qa', false],           ['lab', 'lab', false],
  ];
  for (const [role, department, expected] of cases) {
    assert.equal(canScoreDepartment(role, department), expected,
      `${role} scoring ${department}`);
  }
});

test('admin may score on behalf of any department, but only real ones', () => {
  for (const department of SCORING_DEPARTMENTS) {
    assert.equal(canScoreDepartment('admin', department), true);
  }
  assert.equal(canScoreDepartment('admin', 'lab'), false);
  assert.equal(canScoreDepartment('admin', 'nonsense'), false);
});

// ---- per-user overrides -------------------------------------------------

test('an empty override list means "follow the role"', () => {
  // This is the state every account was in before overrides existed, so it has
  // to behave exactly like the role template — no migration needed.
  for (const permissions of [undefined, null, []]) {
    const user = { role: 'finance', permissions } as any;
    assert.deepEqual(effectivePermissions(user), roleTemplate('finance'));
    assert.equal(hasCustomPermissions(user), false);
    assert.equal(can(user, 'score.finance'), true);
    assert.equal(can(user, 'material.edit'), false);
  }
});

test('an override list can grant beyond the role', () => {
  const user = { role: 'finance', permissions: ['score.finance', 'material.edit'] };
  assert.equal(can(user, 'material.edit'), true, 'granted beyond the finance template');
  assert.equal(can(user, 'score.finance'), true);
  assert.equal(hasCustomPermissions(user), true);
});

test('an override list can take away what the role would have given', () => {
  const user = { role: 'commercial', permissions: ['score.commercial'] };
  assert.equal(can(user, 'vendor.edit'), false, 'revoked despite the commercial template');
  assert.equal(can(user, 'partner.create'), false);
  assert.equal(can(user, 'score.commercial'), true);
});

test('overrides replace the template rather than adding to it', () => {
  const user = { role: 'admin', permissions: ['audit.read'] };
  assert.deepEqual(effectivePermissions(user), ['audit.read']);
  assert.equal(can(user, 'users.manage'), false, 'an admin can be narrowed');
});

test('a stored list is read literally, so a restriction survives being saved', () => {
  // This used to be the opposite: a list naming no read was assumed to predate
  // read permissions and got all of them back, which meant an administrator
  // could not restrict an account to its own scoring — the reads reappeared and
  // the dialog showed the change as if it had never been made. The rows that
  // assumption existed for are fixed once by migration
  // 20260903120000_expand_legacy_permission_reads.
  const scoringOnly = { role: 'finance', permissions: ['score.finance'] };
  for (const read of LEGACY_READS) {
    assert.equal(can(scoringOnly, read), false, `${read} must not be handed back`);
  }
  assert.equal(can(scoringOnly, 'score.finance'), true);

  const narrowed = { role: 'commercial', permissions: ['partner.edit'] };
  assert.deepEqual(effectivePermissions(narrowed), ['partner.edit'], 'exactly what was stored');
  assert.equal(can(narrowed, 'partner.delete'), false, 'still replaces the template');
});

test('an override naming any read is taken at its word', () => {
  // This is what makes a read-only account expressible: once one read is named,
  // the missing ones are a decision, not an artefact of the old format.
  const readOnly = { role: 'finance', permissions: ['partner.read', 'score.finance'] };
  assert.equal(can(readOnly, 'partner.read'), true);
  assert.equal(can(readOnly, 'vendor.read'), false, 'not granted, so not held');
  assert.equal(can(readOnly, 'material.read'), false);
  assert.equal(can(readOnly, 'partner.edit'), false, 'read-only means read-only');
});

test('seeing a partner and taking its SOP papers are separate permissions', () => {
  // The point of the split: the list and the grade are one thing, the business
  // licence and the legalisation are another.
  const listOnly = { role: 'finance', permissions: ['partner.read', 'score.finance'] };
  assert.equal(can(listOnly, 'partner.read'), true);
  assert.equal(can(listOnly, 'partner.files'), false, 'the split has no effect otherwise');

  const withFiles = { role: 'finance', permissions: ['partner.read', 'partner.files'] };
  assert.equal(can(withFiles, 'partner.files'), true);

  // The papers go to the roles that handle them: commercial collects them, QA
  // grades them. Planning and finance work from the list and the grade.
  for (const role of ['commercial', 'qa'] as Role[]) {
    assert.equal(can(role, 'partner.files'), true, `${role} should hold SOP downloads`);
    assert.equal(can(role, 'partner.read'), true);
  }
  for (const role of ['planning', 'finance', 'lab'] as Role[]) {
    assert.equal(can(role, 'partner.files'), false, `${role} should NOT hold SOP downloads`);
  }
  // …but they still see the partners themselves.
  for (const role of ['planning', 'finance'] as Role[]) {
    assert.equal(can(role, 'partner.read'), true, `${role} lost the partner list`);
  }
});

test('a user may be given more than one department to score', () => {
  const user = { role: 'finance', permissions: ['score.finance', 'score.planning'] };
  assert.deepEqual(scorableDepartments(user), ['planning', 'finance']);
  assert.deepEqual(forbiddenScoreChanges(user, { planning: 1, finance: 1 }, { planning: 9, finance: 9 }), []);
  assert.deepEqual(forbiddenScoreChanges(user, { qa: 1 }, { qa: 9 }), ['qa']);
});

test('unrecognised override entries do not lock a user out', () => {
  // A stale or misspelt name must fall back to the role, not to nothing.
  const user = { role: 'qa', permissions: ['not.a.permission'] };
  assert.deepEqual(effectivePermissions(user), roleTemplate('qa'));
  assert.equal(can(user, 'vendor.analysis'), true);

  // mixed input keeps only what is real, expanding retired names
  const mixed = { role: 'qa', permissions: ['material.write', 'bogus'] };
  assert.deepEqual(effectivePermissions(mixed),
    ['material.create', 'material.edit', 'material.delete']);
});

test('a retired permission keeps exactly the access it used to grant', () => {
  // material.write covered create, edit and delete before the guard was split.
  // An account whose stored override still names it must not quietly lose any
  // of the three, because nothing migrated the database.
  const stored = { role: 'finance', permissions: ['material.write'] };
  assert.equal(can(stored, 'material.create'), true);
  assert.equal(can(stored, 'material.edit'), true);
  assert.equal(can(stored, 'material.delete'), true);
  assert.equal(can(stored, 'score.finance'), false, 'an override still replaces the template');

  // vendor.write never covered deletion, and must not start to.
  const vendor = { role: 'finance', permissions: ['vendor.write'] };
  assert.equal(can(vendor, 'vendor.create'), true);
  assert.equal(can(vendor, 'vendor.edit'), true);
  assert.equal(can(vendor, 'vendor.delete'), false);

  // The three writes are what `partner.write` meant, and nothing more: a row
  // that also needs the reads gets them from the migration, not from here.
  const partner = { role: 'finance', permissions: ['partner.write'] };
  assert.deepEqual(effectivePermissions(partner),
    ['partner.create', 'partner.edit', 'partner.delete']);
});

test('an override naming only a dropped permission falls back to the role', () => {
  // archive.read enforced nothing and was removed. Expanding it to an empty set
  // must read as "no override" rather than as "allowed nothing".
  const user = { role: 'qa', permissions: ['archive.read'] };
  assert.deepEqual(effectivePermissions(user), roleTemplate('qa'));
  assert.equal(can(user, 'vendor.analysis'), true);
});

test('sanitizePermissions keeps only known names, deduplicated and ordered', () => {
  assert.deepEqual(sanitizePermissions(['bogus', 'audit.read', 'vendor.write', 'audit.read']),
    ['vendor.create', 'vendor.edit', 'audit.read']);
  assert.deepEqual(sanitizePermissions('nonsense' as any), []);
  assert.deepEqual(sanitizePermissions(null), []);
});

test('a bare role string still works where only the role is known', () => {
  assert.equal(can('qa', 'vendor.analysis'), true);
  assert.equal(canScoreDepartment('qa', 'qa'), true);
});

test('scorableDepartments matches who may score', () => {
  assert.deepEqual(scorableDepartments('admin'), [...SCORING_DEPARTMENTS]);
  assert.deepEqual(scorableDepartments('finance'), ['finance']);
  assert.deepEqual(scorableDepartments('lab'), []);
  assert.equal(canScoreAny('qa'), true);
  assert.equal(canScoreAny('lab'), false);
  assert.equal(canScoreAny('planning'), true);
});

test('a payload that only changes the caller\'s own department is accepted', () => {
  const before = { commercial: 70, qa: 80, planning: 60, finance: 50 };
  const after = { ...before, finance: 90 };
  assert.deepEqual(forbiddenScoreChanges('finance', before, after), []);
});

test('smuggling another department into an otherwise valid payload is caught', () => {
  // This is the case a plain allow/deny check on the route would miss: the
  // endpoint replaces the whole object, so finance is entitled to send it.
  const before = { commercial: 70, qa: 80, planning: 60, finance: 50 };
  const after = { ...before, finance: 90, qa: 100 };
  assert.deepEqual(forbiddenScoreChanges('finance', before, after), ['qa']);
});

test('resending unchanged values for other departments is fine', () => {
  const before = { commercial: 70, qa: 80, planning: 60, finance: 50 };
  assert.deepEqual(forbiddenScoreChanges('finance', before, { ...before }), []);
  // numeric strings from the form must not read as a change
  assert.deepEqual(forbiddenScoreChanges('finance', before, { ...before, qa: '80' } as any), []);
});

test('admin may change every department at once', () => {
  const before = { commercial: 70, qa: 80, planning: 60, finance: 50 };
  const after = { commercial: 1, qa: 2, planning: 3, finance: 4 };
  assert.deepEqual(forbiddenScoreChanges('admin', before, after), []);
});

test('scores set for the first time are still checked', () => {
  assert.deepEqual(forbiddenScoreChanges('finance', null, { finance: 80 }), []);
  assert.deepEqual(forbiddenScoreChanges('finance', null, { qa: 80 }), ['qa']);
});

test('scoring a source that has no scores yet is allowed', () => {
  // The form submits all four departments and fills the ones the user cannot
  // edit with 0, so on an unscored source those zeros must not read as edits.
  // A live test caught this: finance could not score a new source at all.
  assert.deepEqual(
    forbiddenScoreChanges('finance', null, { commercial: 0, qa: 0, planning: 0, finance: 95 }),
    [],
  );
  assert.deepEqual(
    forbiddenScoreChanges('finance', { commercial: 0, qa: 0, planning: 0, finance: 0 },
                                     { commercial: 0, qa: 0, planning: 0, finance: 95 }),
    [],
  );
  // but turning a real score into a zero is still a change
  assert.deepEqual(
    forbiddenScoreChanges('finance', { qa: 80, finance: 0 }, { qa: 0, finance: 95 }),
    ['qa'],
  );
});

test('raw per-question scores are checked the same way', () => {
  const before = { qa: { q1: 5 }, finance: { q1: 3 } };
  assert.deepEqual(forbiddenRawScoreChanges('finance', before, { ...before, finance: { q1: 4 } }), []);
  assert.deepEqual(forbiddenRawScoreChanges('finance', before, { ...before, qa: { q1: 9 } }), ['qa']);
  assert.deepEqual(forbiddenRawScoreChanges('finance', before, { ...before }), []);
});

test('an absent payload changes nothing', () => {
  assert.deepEqual(forbiddenScoreChanges('finance', { qa: 1 }, null), []);
  assert.deepEqual(forbiddenRawScoreChanges('finance', { qa: {} }, undefined), []);
});

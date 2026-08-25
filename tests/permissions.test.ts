import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  can, canScoreDepartment, canScoreAny, scorableDepartments,
  forbiddenScoreChanges, forbiddenRawScoreChanges,
  SCORING_DEPARTMENTS, type Permission, type Role,
} from '../src/utils/permissions';

/**
 * The approved access matrix, written out once. Every cell below is asserted,
 * so a change to the policy that nobody meant shows up as a failing test rather
 * than as a role quietly gaining or losing an ability in production.
 */
const MATRIX: Record<Role, Permission[]> = {
  admin: ['vendor.write', 'vendor.delete', 'vendor.analysis', 'vendor.risk',
          'material.write', 'partner.write', 'audit.read', 'archive.read', 'users.manage'],
  commercial: ['vendor.write', 'partner.write'],
  qa: ['vendor.analysis', 'material.write'],
  planning: [],
  finance: [],
  lab: [],
};

const ALL_PERMISSIONS: Permission[] = [
  'vendor.write', 'vendor.delete', 'vendor.analysis', 'vendor.risk',
  'material.write', 'partner.write', 'audit.read', 'archive.read', 'users.manage',
];

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

test('risk assessment is admin-only', () => {
  assert.equal(can('admin', 'vendor.risk'), true);
  for (const role of ['qa', 'lab', 'commercial', 'planning', 'finance'] as Role[]) {
    assert.equal(can(role, 'vendor.risk'), false, `${role} must not assess risk`);
  }
});

test('only admin may delete a source', () => {
  assert.equal(can('admin', 'vendor.delete'), true);
  for (const role of ['commercial', 'qa', 'lab', 'planning', 'finance'] as Role[]) {
    assert.equal(can(role, 'vendor.delete'), false, `${role} must not delete sources`);
  }
});

test('lab and the score-only roles hold no write permission at all', () => {
  for (const role of ['lab', 'planning', 'finance'] as Role[]) {
    for (const permission of ALL_PERMISSIONS) {
      assert.equal(can(role, permission), false, `${role} unexpectedly holds ${permission}`);
    }
  }
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

test('scorableDepartments matches who may score', () => {
  assert.deepEqual(scorableDepartments('admin'), [...SCORING_DEPARTMENTS]);
  assert.deepEqual(scorableDepartments('finance'), ['finance']);
  assert.deepEqual(scorableDepartments('lab'), []);
  assert.equal(canScoreAny('qa'), true);
  assert.equal(canScoreAny('lab'), false);
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

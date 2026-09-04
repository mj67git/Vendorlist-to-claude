import assert from 'node:assert/strict';
import test from 'node:test';
import { PERMISSION_MODULES, effectivePermissions, roleTemplate, type Permission } from '../src/utils/permissions';

/**
 * The access review, on paper.
 *
 * The spreadsheet is what leaves the application, so what it claims has to be
 * what the policy table says. These check the two derivations the export
 * depends on — the module shorthand and the effective list — rather than the
 * spreadsheet writer itself, which is the same one every other export uses.
 */

/** The same shorthand the screen and the export print, e.g. `RCU`. */
function moduleLetters(moduleKey: string, permissions: Permission[]): string {
  const module = PERMISSION_MODULES.find(m => m.key === moduleKey)!;
  const cols: Array<['view' | 'create' | 'edit' | 'delete', string]> = [
    ['view', 'R'], ['create', 'C'], ['edit', 'U'], ['delete', 'D'],
  ];
  const crud = cols
    .filter(([action]) => {
      const cell = module.actions[action];
      if (cell === null) return false;
      if (cell === 'open') return true;
      return permissions.includes(cell);
    })
    .map(([, letter]) => letter);
  const extras = (module.extras || [])
    .filter(x => permissions.includes(x.permission))
    .map(x => x.letter);
  return [...crud, ...extras].join('');
}

test('the shorthand reports what a role actually holds', () => {
  const commercial = roleTemplate('commercial');
  assert.equal(moduleLetters('vendors', commercial), 'RCU', 'commercial creates and edits sources but never deletes one');
  assert.equal(moduleLetters('partners', commercial), 'RCUDF', 'partners, their documents included');
  assert.equal(moduleLetters('materials', commercial), 'R', 'materials are QA\'s to define');

  const qa = roleTemplate('qa');
  assert.equal(moduleLetters('materials', qa), 'RCUD');
  assert.equal(moduleLetters('selection', qa), 'R', 'QA sees the decision without making it');
  assert.equal(moduleLetters('selection', commercial), 'RCU', 'commercial records it');
});

test('an account with no access to a module reports nothing for it', () => {
  const finance = roleTemplate('finance');
  assert.equal(moduleLetters('users', finance), '');
  assert.equal(moduleLetters('audit', finance), '');
  // …but the reads it does hold still show.
  assert.equal(moduleLetters('vendors', finance), 'R');
});

test('the export follows the exception list, not the role, when one is set', () => {
  const restricted = { role: 'commercial', permissions: ['vendor.read', 'score.commercial'] };
  const effective = effectivePermissions(restricted);
  assert.deepEqual(effective, ['vendor.read', 'score.commercial']);
  assert.equal(moduleLetters('partners', effective), '', 'the sheet must not print access the account lost');
  assert.equal(moduleLetters('vendors', effective), 'R');
});

test('an empty exception list means the role, and the sheet says the role', () => {
  const following = { role: 'planning', permissions: [] };
  assert.deepEqual(effectivePermissions(following), roleTemplate('planning'));
});

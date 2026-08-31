import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRemaining } from '../src/utils/session';

test('remaining-time labels read naturally', () => {
  assert.equal(formatRemaining(null), null);
  assert.equal(formatRemaining(0), 'منقضی شده');
  assert.equal(formatRemaining(-5000), 'منقضی شده');
  assert.equal(formatRemaining(30 * 1000), '۱ دقیقه'.replace('۱','1'));
  assert.equal(formatRemaining(45 * 60 * 1000), '45 دقیقه');
  assert.equal(formatRemaining(2 * 60 * 60 * 1000), '2 ساعت');
  assert.equal(formatRemaining((2 * 60 + 30) * 60 * 1000), '2 ساعت و 30 دقیقه');
  assert.equal(formatRemaining(3 * 24 * 60 * 60 * 1000), '3 روز');
  assert.equal(formatRemaining((3 * 24 + 4) * 60 * 60 * 1000), '3 روز و 4 ساعت');
});

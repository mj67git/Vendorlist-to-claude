import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PARTNER_MARKER,
  readPartnerMarker,
  resolvePartnerLink,
  stripPartnerMarker,
} from '../src/server/domain/partnerLink';

/**
 * The partner link used to live inside `contact_info` as a marker while the
 * columns meant for it were never written. Three things broke because of it:
 * a supplier change did not stick, a partner in use could be deleted because
 * the guard counted on an always-NULL column, and editing the contact details
 * by hand could destroy the link. These tests pin the reading rules that the
 * migration and the new write path depend on.
 */

const OLD_ROW = `تهران، خیابان آزادی${PARTNER_MARKER}:bp_a`;

test('a row written by the old code yields both the text and the link', () => {
  const link = readPartnerMarker(OLD_ROW);
  assert.equal(link.contactInfo, 'تهران، خیابان آزادی');
  assert.equal(link.manufacturerId, null);
  assert.equal(link.supplierId, 'bp_a');
});

test('a manufacturer sits in the first slot, a supplier in the second', () => {
  assert.deepEqual(readPartnerMarker(`آدرس${PARTNER_MARKER}bp_m:`), {
    contactInfo: 'آدرس',
    manufacturerId: 'bp_m',
    supplierId: null,
  });
});

test('a row with no marker is returned untouched', () => {
  const plain = 'تهران، خیابان ولیعصر، پلاک ۱۰';
  assert.deepEqual(readPartnerMarker(plain), {
    contactInfo: plain,
    manufacturerId: null,
    supplierId: null,
  });
  assert.equal(stripPartnerMarker(plain), plain);
});

test('an empty or missing contact field does not throw', () => {
  for (const value of [null, undefined, '']) {
    assert.deepEqual(readPartnerMarker(value), {
      contactInfo: '',
      manufacturerId: null,
      supplierId: null,
    });
  }
});

test('the marker never survives into what a person reads', () => {
  // It sat in a field the user edits by hand, so it had to be stripped on the
  // way out as well as on the way in.
  assert.equal(stripPartnerMarker(OLD_ROW), 'تهران، خیابان آزادی');
  assert.ok(!stripPartnerMarker(OLD_ROW).includes('__BP_METAUI__'));
});

test('the column wins over the marker', () => {
  // This is the bug that made a supplier change invisible: the write updated
  // the marker, the read preferred the column, and the two disagreed for ever.
  // Now that writes go to the column, the column is simply the answer.
  const resolved = resolvePartnerLink({ supplierId: 'bp_new' }, OLD_ROW);
  assert.equal(resolved.supplierId, 'bp_new');
  assert.equal(resolved.contactInfo, 'تهران، خیابان آزادی');
});

test('the marker is still read when the column is empty', () => {
  // A database restored from a backup taken before the migration.
  const resolved = resolvePartnerLink({ supplierId: null, manufacturerId: null }, OLD_ROW);
  assert.equal(resolved.supplierId, 'bp_a');
});

test('a contact field containing the separator twice keeps the first marker', () => {
  // Hand-edited text is the reason this cannot assume a clean split.
  const messy = `آدرس${PARTNER_MARKER}bp_m:bp_s${PARTNER_MARKER}junk`;
  const link = readPartnerMarker(messy);
  assert.equal(link.contactInfo, 'آدرس');
  assert.equal(link.manufacturerId, 'bp_m');
  assert.equal(link.supplierId, 'bp_s');
});

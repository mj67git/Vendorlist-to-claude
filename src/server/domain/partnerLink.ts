/**
 * Reading the partner link out of rows written before it had columns.
 *
 * `vendors.manufacturer_id` and `vendors.supplier_id` have existed since the
 * normalisation migration, but for a long time nothing wrote them: the ids were
 * appended to the free-text `contact_info` as a marker instead —
 *
 *     تهران، خیابان آزادی
 *     __BP_METAUI__:<manufacturerId>:<supplierId>
 *
 * — and the read path preferred the (always empty) column, falling back to the
 * marker. That is why changing a source's supplier did not stick, why a partner
 * in active use could be deleted, and why editing the contact details could
 * destroy the link.
 *
 * Writes now go to the columns and the migration
 * `20260901120000_vendor_partner_columns` moved the existing markers across.
 * These helpers stay because a database that has not run that migration yet —
 * or a backup restored from before it — still holds rows in the old shape, and
 * because the marker string belongs in exactly one place.
 */

export const PARTNER_MARKER = '\n__BP_METAUI__:';

export interface PartnerLink {
  /** The contact details with the marker removed — what a person should see. */
  contactInfo: string;
  manufacturerId: string | null;
  supplierId: string | null;
}

/**
 * Split a stored `contact_info` into the text and the link hidden inside it.
 *
 * Returns nulls when there is no marker, which is the normal case for anything
 * written after the fix.
 */
export function readPartnerMarker(raw: string | null | undefined): PartnerLink {
  const value = typeof raw === 'string' ? raw : '';
  if (!value.includes(PARTNER_MARKER)) {
    return { contactInfo: value, manufacturerId: null, supplierId: null };
  }
  const [text, ...rest] = value.split(PARTNER_MARKER);
  // A marker can only be written once, but a contact field that was edited by
  // hand could contain the separator twice; the first marker is the real one.
  const parts = (rest[0] || '').split(':');
  return {
    contactInfo: text,
    manufacturerId: parts[0] || null,
    supplierId: parts[1] || null,
  };
}

/** The contact details as they should be stored and shown: no marker. */
export function stripPartnerMarker(raw: string | null | undefined): string {
  return readPartnerMarker(raw).contactInfo;
}

/**
 * The link to use for a row, preferring the column over the legacy marker.
 *
 * The column is authoritative because it is what every query joins on — the
 * delete guard included. The marker is only a fallback for rows the migration
 * has not reached.
 */
export function resolvePartnerLink(
  column: { manufacturerId?: string | null; supplierId?: string | null },
  rawContactInfo: string | null | undefined,
): PartnerLink {
  const legacy = readPartnerMarker(rawContactInfo);
  return {
    contactInfo: legacy.contactInfo,
    manufacturerId: column.manufacturerId || legacy.manufacturerId || null,
    supplierId: column.supplierId || legacy.supplierId || null,
  };
}

import type { Vendor, BusinessPartner } from '../types';
import { getDisplayCountry } from './vendorUtils';

/**
 * Who a source buys from, and in what role.
 *
 * The Business Partner model is flat (CLAUDE.md rule 4): a manufacturer and a
 * seller are independent records, and a source links to exactly ONE of them —
 * either a supplier or a manufacturer, never both. `VendorForm` enforces that
 * by clearing the other id whenever one is picked.
 *
 * The views did not know this. They each resolved a "manufacturer" and a
 * "supplier" separately, and for a supplier-linked source both fell out to the
 * SAME partner record — so the detail page printed one company's address,
 * phone and email twice, once labelled تولیدکننده and once فروشنده. This is the
 * single place that answers the question now.
 */

export type VendorPartnerRole = 'manufacturer' | 'supplier' | 'unknown';

export interface VendorPartnerInfo {
  partner: BusinessPartner | null;
  role: VendorPartnerRole;
  /** Persian label for the role, safe to render directly. */
  roleLabel: string;
  name: string;
  /** Normalized: placeholder values become null rather than being shown. */
  country: string | null;
  city: string | null;
  address: string | null;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  /** SOP grade, only ever present for a seller. */
  grade: string | null;
}

/**
 * Values that mean "not recorded" and must never be rendered as if they were
 * the answer. Imported rows carry these as literal text — an English name of
 * `Unknown` was printing under the company name in the archive as though the
 * company were called Unknown.
 */
const PLACEHOLDERS = ['unknown', 'n/a', 'na', '-', '--', 'نامشخص', 'مشخص نشده', 'ثبت‌نشده', 'ثبت نشده'];

/** The value, or null when it is one of the "not recorded" placeholders. */
export function cleanPlaceholder(raw: string | null | undefined): string | null {
  const v = (raw || '').trim();
  if (!v) return null;
  return PLACEHOLDERS.includes(v.toLowerCase()) ? null : v;
}

/** Drop the "not recorded" placeholders that four call sites each re-tested for. */
export const cleanCountry = cleanPlaceholder;

const ROLE_LABELS: Record<VendorPartnerRole, string> = {
  manufacturer: 'تولیدکننده',
  supplier: 'فروشنده',
  unknown: 'تأمین‌کننده',
};

function blank(v: string | null | undefined): string | null {
  const s = (v || '').trim();
  return s || null;
}

export function resolveVendorPartner(vendor: Vendor, partners: BusinessPartner[] = []): VendorPartnerInfo {
  let partner =
    partners.find(p => vendor.supplierId && p.id === vendor.supplierId) ||
    partners.find(p => vendor.manufacturerId && p.id === vendor.manufacturerId) ||
    null;

  // Legacy and imported rows carry no partner id at all, only a matching name.
  if (!partner && vendor.name) {
    partner = partners.find(p => p.name.trim().toLowerCase() === vendor.name.trim().toLowerCase()) || null;
  }

  // The role comes from the partner record, not from which id field held it:
  // an old row can have a Supplier's id sitting in `manufacturerId`.
  const role: VendorPartnerRole = partner
    ? (partner.type === 'Supplier' ? 'supplier' : 'manufacturer')
    : 'unknown';

  if (!partner) {
    return {
      partner: null,
      role,
      roleLabel: ROLE_LABELS[role],
      name: vendor.name,
      country: cleanCountry(vendor.country) || cleanCountry(getDisplayCountry(vendor)),
      city: null,
      address: blank(vendor.contactInfo),
      contactPerson: null,
      phone: null,
      email: null,
      website: null,
      grade: null,
    };
  }

  const rawGrade = partner.evaluation?.grade;

  return {
    partner,
    role,
    roleLabel: ROLE_LABELS[role],
    name: partner.name,
    country: cleanCountry(partner.country) || cleanCountry(vendor.country) || cleanCountry(getDisplayCountry(vendor)),
    city: blank(partner.city),
    address: blank(partner.address) || blank(vendor.contactInfo),
    contactPerson: blank(partner.contactPerson),
    phone: blank(partner.phone),
    email: blank(partner.email),
    website: blank(partner.website),
    grade: role === 'supplier' && rawGrade ? String(rawGrade) : null,
  };
}

/** "کشور - شهر" for display, or null when neither is recorded. */
export function formatLocation(p: VendorPartnerInfo): string | null {
  if (!p.country && !p.city) return null;
  return [p.country, p.city].filter(Boolean).join(' - ');
}

/** One-line address + contact string, for spreadsheet and print output. */
export function formatContactLine(p: VendorPartnerInfo): string {
  const parts = [p.country, p.city, p.address, p.phone, p.email].filter(Boolean);
  return parts.length > 0 ? parts.join(' - ') : 'ثبت‌نشده';
}

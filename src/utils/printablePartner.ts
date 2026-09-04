import type { BusinessPartner, Vendor } from '../types';
import { resolveVendorPartner } from './vendorPartner';

/**
 * Fill the form's two fixed cells from the source's partner.
 *
 * The printed form is a controlled document with a fixed grid, so both the
 * manufacturer cell and the seller cell stay — but only the one matching the
 * partner's actual role carries a name. The other says «ثبت‌نشده», because that
 * is what the record says.
 *
 * It used to print «خرید بی‌واسطه از تولیدکننده / مستقیم» in the seller cell
 * whenever the partner was a manufacturer. That is a commercial claim the
 * system holds no evidence for: manufacturers and sellers are independent
 * records here (they have been since the self-relation was removed), so a
 * source linked to a manufacturer means "no seller has been recorded", not
 * "we buy from the factory directly". On a form that goes into a regulatory
 * file, the difference between an unrecorded fact and an asserted one is the
 * whole point.
 *
 * A source with no partner record at all keeps its name — nothing else on the
 * page identifies the company — but the cell says the role is unrecorded
 * rather than filing it under "manufacturer" by default.
 */
export function getPartnerDetails(v: Vendor, partners: BusinessPartner[] = []) {
  const p = resolveVendorPartner(v, partners);
  const country = p.country || 'ثبت\u200cنشده';
  const UNRECORDED = 'ثبت\u200cنشده';

  if (p.role === 'supplier') {
    return { mfgName: UNRECORDED, mfgCountry: '-', supName: p.name, supCountry: country };
  }

  if (p.role === 'manufacturer') {
    return { mfgName: p.name, mfgCountry: country, supName: UNRECORDED, supCountry: '-' };
  }

  return {
    mfgName: `${p.name} (نقش ثبت\u200cنشده)`,
    mfgCountry: country,
    supName: UNRECORDED,
    supCountry: '-',
  };
}

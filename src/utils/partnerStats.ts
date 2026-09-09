import type { BusinessPartner } from '../types';
import { canSupplySources } from './sopEvaluation';

/**
 * The shape of the partner register, counted once.
 *
 * The repository screen computed this in a local `useMemo` and the dashboard
 * had no way to say the same thing without a second copy — the arrangement that
 * let one category register disagree with its own spreadsheet by thirty-five
 * rows. Both read this now.
 */
export interface PartnerStats {
  total: number;
  manufacturers: number;
  suppliers: number;
  active: number;
  inactive: number;
  /** Sellers a source may actually be attached to. */
  eligibleSuppliers: number;
  /** Every other seller: the two partition the sellers exactly. */
  blockedSuppliers: number;
}

export function summarisePartners(partners: BusinessPartner[] = []): PartnerStats {
  const suppliers = partners.filter(p => p.type === 'Supplier');

  // "Approved" is not a grade band read off the record: only grade A may be
  // attached to a source and the server answers 422 for the rest (rule 13), so
  // this asks the same function the gate asks. Counting A and B here once made
  // the tile promise sellers the system refuses.
  const eligibleSuppliers = suppliers.filter(s => canSupplySources(s).allowed).length;

  return {
    total: partners.length,
    manufacturers: partners.filter(p => p.type === 'Manufacturer').length,
    suppliers: suppliers.length,
    active: partners.filter(p => p.status === 'Active').length,
    inactive: partners.filter(p => p.status === 'Inactive').length,
    eligibleSuppliers,
    blockedSuppliers: suppliers.length - eligibleSuppliers,
  };
}

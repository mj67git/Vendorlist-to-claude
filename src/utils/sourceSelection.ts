import type { Vendor } from '../types';

/** A recorded "this is the source we chose" decision, as the API returns it. */
export interface SourceSelectionRecord {
  materialKey: string;
  category: string;
  vendorId: string;
  reason: string;
  decidedBy: string;
  decidedAt: string;
}

/**
 * Which recorded decision, if any, this archive row *is*.
 *
 * A selection is keyed by material and category, not by supplier: the same
 * company can be the chosen source for one material and an also-ran for
 * another. So the question is never "is this vendor preferred" but "is this
 * vendor the choice for the material on this row" — marking every row of a
 * company because one of its materials was chosen would be a false claim on a
 * GxP record.
 *
 * The rule lives here because three surfaces ask it — the archive list, the
 * Excel export and the printed form — and they must not drift apart.
 */
export function selectionForVendor(
  vendor: Vendor,
  selections: SourceSelectionRecord[] | undefined | null,
): SourceSelectionRecord | null {
  if (!selections?.length) return null;
  const key = (vendor.materialEn || '').trim().toLowerCase();
  if (!key) return null;
  return (
    selections.find(
      s =>
        s.vendorId === vendor.id &&
        s.category === vendor.category &&
        (s.materialKey || '').trim().toLowerCase() === key,
    ) || null
  );
}

/** Jalali date for the decision, for display next to the mark. */
export function formatSelectionDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('fa-IR');
}

/** One line summarising the decision, used in tooltips and in the exports. */
export function describeSelection(selection: SourceSelectionRecord): string {
  const when = formatSelectionDate(selection.decidedAt);
  const parts = [selection.reason?.trim()].filter(Boolean);
  const by = [selection.decidedBy, when].filter(Boolean).join(' · ');
  if (by) parts.push(`(ثبت: ${by})`);
  return parts.join(' ');
}

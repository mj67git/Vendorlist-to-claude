import { requirePrisma } from "../db/prisma.js";
import { canSupplySources, calculateGradeAndStatus } from "../../utils/sopEvaluation.js";

/**
 * The two rules that refuse a source outright, both answered with 422.
 *
 * They live here rather than inside a route because they are statements about
 * the business, not about HTTP: a licence number has a shape, and a seller has
 * to have earned the right to supply. The form greys both out, but that gate is
 * cosmetic (project rule 14) — the record is only protected because the API
 * refuses it too.
 */

export function ircViolation(irc: unknown, previousIrc?: unknown): string | null {
  const value = typeof irc === "string" ? irc.trim() : "";
  const previous = typeof previousIrc === "string" ? previousIrc.trim() : "";
  if (value === previous) return null;
  if (value === "" || value === "N/A" || value === "NA" || value === "-") return null;
  if (/^\d{16}$/.test(value)) return null;
  return "کد IRC باید دقیقاً ۱۶ رقم عددی باشد.";
}

/**
 * Refuse a source whose supplier does not meet the SOP.
 *
 * The client greys these out, but that gate is cosmetic (project rule 14): the
 * record is only actually protected if the API refuses it too. Returns an error
 * message when the write must be rejected, or null when it may proceed.
 *
 * A supplier that is already attached to the record is left alone, so a source
 * saved before this rule existed stays editable rather than becoming
 * unsaveable.
 */
export async function sopSupplierViolation(
  supplierId: string | null | undefined,
  previousSupplierId?: string | null,
): Promise<string | null> {
  if (!supplierId || supplierId === previousSupplierId) return null;
  const prisma = requirePrisma();
  const row = await prisma.businessPartner.findUnique({
    where: { id: supplierId },
    include: { evaluation: true },
  });
  if (!row) return "فروشندهٔ انتخاب‌شده در مخزن شرکای تجاری یافت نشد.";

  // Derive the grade from the score rather than trusting the stored grade
  // column, which is what the client does on load (reconcileSupplierEvaluation).
  // They disagree in the seeded data: bp_sup_2 is stored as grade B on a score
  // of 80, which the rubric grades A. Reading the column here would have
  // refused a supplier the form shows as selectable.
  const derivedGrade = row.evaluation
    ? calculateGradeAndStatus(row.evaluation.totalScore ?? 0, row.evaluation.grade !== "Not Evaluated").grade
    : undefined;

  const verdict = canSupplySources({
    type: row.type as string,
    status: row.status as string,
    evaluation: derivedGrade ? { grade: derivedGrade } : null,
  });
  return verdict.allowed ? null : `${row.name}: ${verdict.reason}`;
}

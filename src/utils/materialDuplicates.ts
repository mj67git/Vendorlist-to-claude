/**
 * When two material records describe the same thing.
 *
 * The repository form has always checked this, but only in the browser, so the
 * rule was advice rather than a rule: any other client — the source-save path,
 * a script, a stale tab — could still write a second row for a substance that
 * was already in the catalogue. This is the shared decision both sides read, so
 * the server can enforce what the form promises (project rule 14).
 *
 * Two independent signals, matching what the form has always said:
 *   1. the same real CAS number, and
 *   2. the same (role + Latin name + Latin final product) combination.
 *
 * A placeholder CAS is not a signal — most rows carry `N/A`, and treating that
 * as identity would make the second material anyone registers a "duplicate".
 */

export interface MaterialKeyFields {
  id?: string;
  nameFa?: string | null;
  nameEn?: string | null;
  cas?: string | null;
  role?: string | null;
  finalProductEn?: string | null;
}

export interface DuplicateMatch {
  material: MaterialKeyFields;
  /** Which rule matched, phrased for the message shown to the user. */
  reason: string;
  field: 'cas' | 'combination';
}

const PLACEHOLDER_CAS = ['n/a', 'na', 'n.a.', '-', '', 'unknown', 'نامشخص'];

const norm = (v?: string | null) => (v || '').trim().toLowerCase();

export const isRealCas = (cas?: string | null) => !PLACEHOLDER_CAS.includes(norm(cas));

/** Identity of the (role + Latin name + Latin final product) rule. */
const comboKey = (m: MaterialKeyFields) => `${norm(m.role)}|${norm(m.nameEn)}|${norm(m.finalProductEn)}`;

/** A combo is only an identity when its parts are actually filled in. */
const hasCombo = (m: MaterialKeyFields) => !!norm(m.nameEn) && !!norm(m.finalProductEn);

export function findDuplicateMaterial(
  candidate: MaterialKeyFields,
  existing: MaterialKeyFields[],
  /**
   * The record being edited, when this is an update. Only the rules whose
   * fields the edit actually touches are applied: rows that were already
   * duplicated before this check existed must stay editable, otherwise the
   * cleanup script's own targets would be frozen.
   */
  current?: MaterialKeyFields | null,
): DuplicateMatch | null {
  const others = existing.filter(m => !candidate.id || m.id !== candidate.id);

  const casChanged = !current || norm(candidate.cas) !== norm(current.cas);
  const comboChanged = !current || comboKey(candidate) !== comboKey(current);

  if (casChanged && isRealCas(candidate.cas)) {
    const hit = others.find(m => isRealCas(m.cas) && norm(m.cas) === norm(candidate.cas));
    if (hit) {
      return {
        material: hit,
        field: 'cas',
        reason: `شمارهٔ CAS «${candidate.cas}» قبلاً برای مادهٔ «${hit.nameFa || hit.nameEn || hit.id}» ثبت شده است.`,
      };
    }
  }

  if (comboChanged && hasCombo(candidate)) {
    const key = comboKey(candidate);
    const hit = others.find(m => hasCombo(m) && comboKey(m) === key);
    if (hit) {
      return {
        material: hit,
        field: 'combination',
        reason: `ترکیب نقش ماده، نام لاتین و محصول نهایی قبلاً برای مادهٔ «${hit.nameFa || hit.nameEn || hit.id}» ثبت شده است.`,
      };
    }
  }

  return null;
}

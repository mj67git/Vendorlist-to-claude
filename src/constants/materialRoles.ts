import type { MaterialRole } from '../types';

/**
 * The single table of material roles — the list the user picks from, the labels
 * shown for a stored role, and the code that goes into the generated standard
 * English name.
 *
 * It lives here because the same table was copied into `MaterialRepositoryView`
 * and `MaterialSelector`, and the two had already drifted (different
 * pharmacopoeia order, and the repository's stat cards knew about only five of
 * the seven roles, so `Packaging Item` and `Other` were counted nowhere).
 *
 * **`value` is what the database holds and must not be renamed.** Two of them
 * read oddly (`Reagent / Reactant`, `Packaging Item`), but every stored row and
 * every already-generated standard name uses them; renaming would orphan the
 * data. What the user sees is `labelFa` / `labelEn`.
 */
export interface MaterialRoleOption {
  /** Persisted value. Never change these. */
  value: MaterialRole;
  labelFa: string;
  labelEn: string;
  /** Prefix of the generated standard English name, e.g. `SOL-aceton (For …)`. */
  code: string;
  /** Tone for the badge/stat card, both themes. */
  tone: string;
}

export const MATERIAL_ROLES: MaterialRoleOption[] = [
  { value: 'API', labelFa: 'ماده موثره', labelEn: 'API', code: 'API', tone: 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-900' },
  { value: 'Intermediate', labelFa: 'حدواسط', labelEn: 'Intermediate', code: 'INT', tone: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-900' },
  { value: 'Solvent', labelFa: 'حلال', labelEn: 'Solvent', code: 'SOL', tone: 'bg-indigo-50 text-indigo-700 border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-900' },
  { value: 'Reagent / Reactant', labelFa: 'واکنشگر', labelEn: 'Reagent', code: 'REA', tone: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/50 dark:text-rose-300 dark:border-rose-900' },
  { value: 'Excipient', labelFa: 'اکسپیانت', labelEn: 'Excipient', code: 'EXP', tone: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-900' },
  { value: 'Packaging Item', labelFa: 'بسته‌بندی', labelEn: 'Packaging', code: 'PKG', tone: 'bg-teal-50 text-teal-700 border-teal-200 dark:bg-teal-950/50 dark:text-teal-300 dark:border-teal-900' },
  { value: 'Other', labelFa: 'متفرقه', labelEn: 'Other', code: 'OTH', tone: 'bg-muted text-foreground border-border' },
];

/**
 * Values that older rows may carry, mapped onto the canonical ones. Without
 * this a row saved as plain `Reagent` would fall through to API and be both
 * mislabelled and miscounted.
 */
const ALIASES: Record<string, MaterialRole> = {
  reagent: 'Reagent / Reactant',
  reactant: 'Reagent / Reactant',
  'reagent/reactant': 'Reagent / Reactant',
  packaging: 'Packaging Item',
  'packaging item': 'Packaging Item',
  pkg: 'Packaging Item',
};

/** The role table entry for a stored value, tolerant of the legacy spellings. */
export function getMaterialRole(role?: string | null): MaterialRoleOption {
  if (!role) return MATERIAL_ROLES[0];
  const exact = MATERIAL_ROLES.find(r => r.value === role);
  if (exact) return exact;
  const alias = ALIASES[role.trim().toLowerCase()];
  return MATERIAL_ROLES.find(r => r.value === alias) || MATERIAL_ROLES[0];
}

/** `API - ماده موثره`, for the role picker. */
export const roleOptionLabel = (r: MaterialRoleOption) => `${r.labelEn} - ${r.labelFa}`;

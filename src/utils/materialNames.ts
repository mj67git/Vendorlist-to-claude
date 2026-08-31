import type { Material, Vendor } from '../types';

/**
 * The standard (pharmacopoeial) names to show for a source's material.
 *
 * The record a source links to is not always the catalogue entry that carries
 * the standard name. Sources saved before the material-id fix point at a
 * duplicate minted from the vendor payload, which only ever held name, CAS and
 * IRC — so the detail page fell back to the plain material name ("استون") even
 * though the repository had "حلال - استون (برای متادون هیدروکلراید)" on file for
 * the same substance.
 *
 * Resolution order: the linked record first, then — when that one carries no
 * standard name — the catalogue entry for the same substance that does, and
 * finally the plain names as a last resort.
 */

const eq = (a?: string | null, b?: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

const PLACEHOLDER_CAS = ['n/a', 'na', '-', ''];

const isRealCas = (cas?: string | null) =>
  !!cas && !PLACEHOLDER_CAS.includes(cas.trim().toLowerCase());

const hasStandardName = (m?: Material | null) => !!(m?.standardNameFa || m?.standardNameEn);

export interface MaterialNames {
  /** The record the source is linked to, or the best match for its substance. */
  material?: Material;
  standardNameFa: string;
  standardNameEn: string;
}

export function resolveMaterialNames(
  vendor: Pick<Vendor, 'materialId' | 'material' | 'materialEn' | 'cas'>,
  materials: Material[] = [],
): MaterialNames {
  const isSameSubstance = (m: Material) =>
    eq(m.nameFa, vendor.material) ||
    eq(m.standardNameFa, vendor.material) ||
    eq(m.nameEn, vendor.materialEn) ||
    eq(m.standardNameEn, vendor.materialEn) ||
    (eq(m.cas, vendor.cas) && isRealCas(m.cas));

  const linked = vendor.materialId ? materials.find(m => m.id === vendor.materialId) : undefined;
  const material = linked || materials.find(isSameSubstance);

  const namedSource = hasStandardName(material)
    ? material
    : materials.find(m => isSameSubstance(m) && hasStandardName(m)) || material;

  return {
    material,
    standardNameFa: namedSource?.standardNameFa || material?.nameFa || vendor.material || '',
    standardNameEn: namedSource?.standardNameEn || material?.nameEn || vendor.materialEn || '',
  };
}

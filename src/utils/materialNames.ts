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

/** Whether a catalogue entry is the substance this source names. */
const sameSubstance = (
  vendor: Pick<Vendor, 'material' | 'materialEn' | 'cas'>,
) => (m: Material) =>
  eq(m.nameFa, vendor.material) ||
  eq(m.standardNameFa, vendor.material) ||
  eq(m.nameEn, vendor.materialEn) ||
  eq(m.standardNameEn, vendor.materialEn) ||
  (eq(m.cas, vendor.cas) && isRealCas(m.cas));

/**
 * The catalogue entry a source belongs to: its link, or the entry for the same
 * substance.
 *
 * Exported because the same question is asked away from the names — the
 * materials table counts the sources attached to each row and its delete
 * confirmation names them. That count used to re-implement this test with a
 * narrower predicate (no standard names), so a legacy source stored under a
 * material's standard name was invisible to it while the source's own page
 * resolved it correctly. The clause order is part of the contract: `find`
 * takes the first hit, so two readers only agree while they ask in the same
 * order.
 */
export function matchMaterialForVendor(
  vendor: Pick<Vendor, 'materialId' | 'material' | 'materialEn' | 'cas'>,
  materials: Material[] = [],
): Material | undefined {
  const linked = vendor.materialId ? materials.find(m => m.id === vendor.materialId) : undefined;
  return linked || materials.find(sameSubstance(vendor));
}

export function resolveMaterialNames(
  vendor: Pick<Vendor, 'materialId' | 'material' | 'materialEn' | 'cas'>,
  materials: Material[] = [],
): MaterialNames {
  const isSameSubstance = sameSubstance(vendor);
  const material = matchMaterialForVendor(vendor, materials);

  const namedSource = hasStandardName(material)
    ? material
    : materials.find(m => isSameSubstance(m) && hasStandardName(m)) || material;

  return {
    material,
    standardNameFa: namedSource?.standardNameFa || material?.nameFa || vendor.material || '',
    standardNameEn: namedSource?.standardNameEn || material?.nameEn || vendor.materialEn || '',
  };
}

import type { Material, Vendor } from '../types';
import { matchMaterialForVendor } from './materialNames';

/**
 * Which sources are registered against each material.
 *
 * The server is the authority — `DELETE /api/materials/:id` refuses while any
 * `vendor_materials` row points at the material — and this mirrors that link
 * from the data the client already holds, so the table can print the count and
 * the delete confirmation can name the sources it is about to orphan.
 *
 * It lived inside the materials repository as a `useMemo` with its own copy of
 * the substance-matching predicate, which is why the dashboard could not report
 * the same figure without writing a third one. The predicate is now
 * `matchMaterialForVendor`, the same test the source's own page uses.
 *
 * **The caller chooses the population.** The materials repository passes every
 * record, because a sample holds a `vendor_materials` row like any other and a
 * delete is refused on it just the same; the dashboard passes the sources only,
 * because the tile beside it counts sources «به‌جز نمونه‌ها» and one row of
 * figures must not use two meanings of the word.
 */
export function indexSourcesByMaterial(
  vendors: Vendor[],
  materials: Material[],
): Map<string, Vendor[]> {
  const index = new Map<string, Vendor[]>();
  for (const vendor of vendors) {
    const material = matchMaterialForVendor(vendor, materials);
    if (!material) continue;
    const found = index.get(material.id);
    if (found) found.push(vendor);
    else index.set(material.id, [vendor]);
  }
  return index;
}

/**
 * How many materials have at least one source.
 *
 * The nearest true reading of "an active material": the catalogue has no status
 * column, so the only fact about a material being in use is whether anybody
 * buys it. Materials, not sources — a material with nine suppliers counts once.
 */
export function countMaterialsWithSources(index: Map<string, Vendor[]>): number {
  return index.size;
}

/**
 * The identity of a material in the repository.
 *
 * Shared by the material routes and the vendor repository, which creates a
 * material on the fly when a source names one that is not on file yet — so the
 * two must derive the same id from the same substance or the catalogue forks.
 */
export function generateMaterialId(cas: string | undefined, irc: string | undefined, materialName: string | undefined, materialEn: string | undefined): string {
  const isCasEmpty = !cas || cas === "N/A" || cas === "NA" || cas === "-";
  const isIrcEmpty = !irc || irc === "N/A" || irc === "NA" || irc === "-";
  
  const combinedName = `${materialName || ''}_${materialEn || ''}`.trim();

  if (isCasEmpty && isIrcEmpty && combinedName !== '_') {
    const cleanName = Buffer.from(combinedName).toString('base64').replace(/[^a-zA-Z0-9]/g, '');
    return `mat_NA_NA_${cleanName.substring(0, 25)}`.replace(/[^a-zA-Z0-9_]/g, '_');
  }

  const baseId = `mat_${cas || 'NA'}_${irc || 'NA'}`;
  return baseId.replace(/[^a-zA-Z0-9_]/g, '_');
}

// Map a material DB row to the frontend Material shape (name -> nameFa, etc.).
// IRC receive/expiry dates are intentionally excluded: IRC belongs to the
// source (vendor), not the material catalogue.

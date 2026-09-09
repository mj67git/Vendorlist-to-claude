import { Globe, Factory, PawPrint, Package, ClipboardCheck, AlertTriangle } from 'lucide-react';

/**
 * The source categories, their Persian/English labels and sidebar icons.
 *
 * The keys are the values stored in `vendor_materials.category`; note that
 * foreign purchase is `foreign`, not `import` — a mismatch that has bitten
 * test fixtures before.
 */
export const categoryLabels = {
  foreign: { fa: 'خرید خارجی', en: 'Foreign Purchase', icon: Globe },
  domestic: { fa: 'خرید داخلی', en: 'Domestic Purchase', icon: Factory },
  veterinary: { fa: 'دامی', en: 'Veterinary', icon: PawPrint },
  packaging: { fa: 'اقلام بسته بندی', en: 'Packaging Items', icon: Package },
  sample: { fa: 'نمونه', en: 'Sample', icon: ClipboardCheck },
  blacklist: { fa: 'لیست سیاه', en: 'Black List', icon: AlertTriangle },
};

/** The order the sidebar lists the categories in, and the order anything sorts by. */
export const CATEGORY_ORDER = Object.keys(categoryLabels);

/**
 * Where a category sits in that order; anything unrecognised sorts last.
 *
 * The blacklist is the one register that mixes categories, so it is the one
 * that can be ordered by them — and the order a reader expects is the one the
 * sidebar already taught them, not the alphabet. An empty or unknown value is
 * a real possibility on an imported row, and it belongs at the end rather than
 * at the top where `indexOf` would put it.
 */
export function categoryRank(category: string | null | undefined): number {
  const i = CATEGORY_ORDER.indexOf((category || '').trim());
  return i === -1 ? CATEGORY_ORDER.length : i;
}

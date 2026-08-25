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

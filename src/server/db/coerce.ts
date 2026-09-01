/**
 * Turning whatever a client sent into something the database will accept.
 *
 * Dates arrive from this application in several shapes — Jalali strings the
 * user typed, ISO strings from an import, and occasionally nothing at all —
 * and PostgreSQL will take none of them on faith. Shared by the vendor and
 * partner repositories.
 */
export function parseDateSafely(dateStr: any): Date {
  if (!dateStr) return new Date();
  if (dateStr instanceof Date) {
    return isNaN(dateStr.getTime()) ? new Date() : dateStr;
  }
  
  try {
    let str = String(dateStr).trim();
    let d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d;
    }

    const pDigits = [/۰/g, /۱/g, /۲/g, /۳/g, /۴/g, /۵/g, /۶/g, /۷/g, /۸/g, /۹/g];
    for (let i = 0; i < 10; i++) {
      str = str.replace(pDigits[i], String(i));
    }
    const aDigits = [/٠/g, /١/g, /٢/g, /٣/g, /٤/g, /٥/g, /٦/g, /٧/g, /٨/g, /٩/g];
    for (let i = 0; i < 10; i++) {
      str = str.replace(aDigits[i], String(i));
    }

    str = str.replace(/،/g, ',');

    d = new Date(str);
    if (!isNaN(d.getTime())) {
      return d;
    }

    return new Date();
  } catch (err) {
    return new Date();
  }
}


import { useCallback, useState } from 'react';

export type ExcelExportModule = typeof import('../utils/excelExport');

/**
 * The spreadsheet writer, fetched when somebody actually wants a spreadsheet.
 *
 * `xlsx-js-style` is the single largest thing this application depends on, and
 * every page paid for it on first load — including the login screen, which has
 * no export button on it. Nothing needs it until a download button is pressed,
 * so it is loaded then. The cost moves from every visit to the one click that
 * uses it, and the browser caches it from there.
 *
 * That click can now fail in a way it could not before: the chunk has to be
 * fetched, and a dropped connection or a deployment that replaced the file
 * underneath a long-open tab will refuse it. Silently doing nothing when a
 * download button is pressed is the worst possible answer, so the failure is
 * reported and the caller renders it.
 */
export function useExcelExport() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (fn: (xl: ExcelExportModule) => void | Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      const xl = await import('../utils/excelExport');
      await fn(xl);
    } catch (err) {
      console.error('Excel export failed:', err);
      setError('تهیهٔ خروجی اکسل ناموفق بود. اتصال شبکه را بررسی کنید و صفحه را دوباره بارگذاری کنید.');
    } finally {
      setBusy(false);
    }
  }, []);

  return { run, busy, error };
}

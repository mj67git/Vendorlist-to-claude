/**
 * Reading the source list one page at a time.
 *
 * Everything in this application — the dashboard donut, the category counts,
 * the sidebar badges, the archive, the comparison chart, the Excel export —
 * derives from the complete set of sources, so the client genuinely needs all
 * of them. What it does not need is to wait for all of them before showing any.
 *
 * So the list is still assembled in full, but in pages: the first page is handed
 * over as soon as it lands and the rest are appended behind it. The server is
 * doing the same amount of work either way; what changes is that no single
 * response has to carry the whole register, and the user sees sources instead of
 * a spinner while the tail arrives.
 *
 * Paging only means anything against a stable order, which is why the server
 * orders by name and then id. Without that, two pages could contain the same
 * row and miss another.
 */

export interface VendorPageEnvelope<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function isVendorPage<T>(data: unknown): data is VendorPageEnvelope<T> {
  const d = data as VendorPageEnvelope<T> | null;
  return !!d && Array.isArray(d.items) && typeof d.total === "number" && typeof d.pages === "number";
}

export interface FetchAllVendorsOptions<T> {
  /** Performs one request; separated out so this is testable without a network. */
  fetchPage: (page: number, limit: number) => Promise<unknown>;
  /** Called with each page as it arrives, in order, so the UI can paint early. */
  onPage: (rows: T[], meta: { page: number; total: number; done: boolean }) => void;
  limit?: number;
  /**
   * A stop against a server that keeps claiming there is another page. Reaching
   * it is a bug rather than a large installation, but looping forever against a
   * misbehaving endpoint would hang the browser rather than report anything.
   */
  maxPages?: number;
}

/**
 * Read the whole list, page by page, and return it.
 *
 * A server that answers with a plain array — an older build, or the endpoint
 * called without paging — is not an error: that response already is the whole
 * list, so it is handed over as a single page and the loop ends.
 */
export async function fetchAllVendors<T>(options: FetchAllVendorsOptions<T>): Promise<T[]> {
  const { fetchPage, onPage, limit = 200, maxPages = 500 } = options;
  const all: T[] = [];

  for (let page = 1; page <= maxPages; page++) {
    const data = await fetchPage(page, limit);

    if (Array.isArray(data)) {
      all.push(...(data as T[]));
      onPage(data as T[], { page, total: all.length, done: true });
      return all;
    }
    if (!isVendorPage<T>(data)) {
      throw new Error("پاسخ فهرست سورس‌ها قابل تفسیر نیست.");
    }

    all.push(...data.items);
    // `pages` decides, not an empty page: a page can legitimately come back
    // empty when rows were deleted between requests, and stopping there would
    // silently truncate the list the whole application then reasons over.
    const done = page >= data.pages;
    onPage(data.items, { page, total: data.total, done });
    if (done) return all;
  }

  throw new Error("فهرست سورس‌ها بیش از حد انتظار صفحه داشت؛ خواندن متوقف شد.");
}

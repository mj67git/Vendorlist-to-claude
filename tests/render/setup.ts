import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

/**
 * The browser APIs jsdom does not implement, stubbed once.
 *
 * Each of these is used by code the render tests mount, and jsdom throws on all
 * of them. They are stubs and not fakes: a test that needs to assert on one
 * should override it locally rather than teach this file about its case.
 */

// `useTheme` asks for the OS preference on first paint.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as any;
}

// `useIsOverflowing` measures names to decide whether a tooltip is needed.
if (!('ResizeObserver' in window)) {
  (window as any).ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

if (!('IntersectionObserver' in window)) {
  (window as any).IntersectionObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() { return []; }
  };
}

// jsdom implements none of these. The view-change effect calls `scrollTo` on
// the *container element*, which jsdom leaves undefined even though it defines
// the window-level one — the first thing that broke when App was mounted.
window.scrollTo = window.scrollTo || (() => {});
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => {};
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

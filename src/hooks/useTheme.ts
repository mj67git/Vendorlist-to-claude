import { useEffect, useState } from 'react';

/**
 * Light or dark, remembered.
 *
 * The choice is stored under `theme` in localStorage and applied as a `.dark`
 * class on the document element, which is what the Tailwind tokens key off. On
 * a first visit there is nothing stored, so the operating system's preference
 * decides rather than a hardcoded default.
 *
 * This used to live in `src/design-system/ThemeSwitcher.tsx`, the last thing
 * anything imported from a second, otherwise-unused component library. A hook
 * is not a component, so it lives with the hooks now.
 */
export function useTheme() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;

    if (saved === 'dark' || (!saved && prefersDark)) {
      setIsDark(true);
      document.documentElement.classList.add('dark');
    } else {
      setIsDark(false);
      document.documentElement.classList.remove('dark');
    }
  }, []);

  const toggleTheme = () => {
    setIsDark(prev => {
      const next = !prev;
      if (next) {
        document.documentElement.classList.add('dark');
        localStorage.setItem('theme', 'dark');
      } else {
        document.documentElement.classList.remove('dark');
        localStorage.setItem('theme', 'light');
      }
      return next;
    });
  };

  return { isDark, toggleTheme };
}

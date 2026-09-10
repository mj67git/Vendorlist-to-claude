import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/**
 * The render tests, which the rest of the suite cannot run.
 *
 * `tests/*.test.ts` runs on node's own test runner and covers pure rules and
 * the API over real HTTP. Neither can mount a React tree: `App.tsx` imports a
 * PNG and the components import CSS, and node resolves neither. Vitest is the
 * Vite pipeline itself, so the same imports, aliases and plugins that build the
 * application also build the test — no second copy of the build config to keep
 * in step.
 *
 * Two runners rather than one, on purpose: rewriting 445 passing tests onto a
 * different runner to gain one file type would be a large change with nothing
 * to show for it. `npm run check` runs both.
 */
export default mergeConfig(
  viteConfig({ command: 'serve', mode: 'test' } as any),
  defineConfig({
    test: {
      environment: 'jsdom',
      globals: true,
      include: ['tests/render/**/*.test.tsx'],
      setupFiles: ['tests/render/setup.ts'],
      // The API suite owns the database; these never touch it.
      env: { DATABASE_URL: '' },
    },
  }),
);

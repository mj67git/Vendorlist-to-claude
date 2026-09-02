import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/**
 * A gate, not a style guide.
 *
 * This project had no linter and no automated gate of any kind until recently,
 * so turning on a recommended preset across 30,000 lines would have produced
 * thousands of findings, all of which would have been switched off again within
 * the hour. The rules kept here are the ones that catch defects this codebase
 * has actually suffered:
 *
 *   - **Hook order.** `App.tsx` returns early for the login and
 *     change-password screens, and a hook added below one of those returns
 *     breaks every hook after it ("Rendered more hooks than during the previous
 *     render"). Project rule 10 documents that bug in prose; this enforces it.
 *   - **Missing effect dependencies**, as a warning. The paged source load was
 *     wrong in exactly this area, and a stale closure is invisible in review.
 *   - **The obvious mistakes** from the base preset: an unreachable branch, a
 *     duplicated object key, a `case` that falls through.
 *
 * Formatting is not linted at all. Nothing here reformats code, so a lint run
 * never produces a diff to argue about.
 */
export default tseslint.config(
  {
    ignores: ['dist/**', 'node_modules/**', 'src/generated/**', 'prisma/migrations/**', '*.config.js'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    plugins: { 'react-hooks': reactHooks },
    languageOptions: {
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: {
        console: 'readonly', document: 'readonly', window: 'readonly',
        localStorage: 'readonly', sessionStorage: 'readonly', navigator: 'readonly',
        fetch: 'readonly', Blob: 'readonly', File: 'readonly', FileReader: 'readonly',
        URL: 'readonly', URLSearchParams: 'readonly', FormData: 'readonly',
        setTimeout: 'readonly', clearTimeout: 'readonly', setInterval: 'readonly',
        clearInterval: 'readonly', requestAnimationFrame: 'readonly',
        ResizeObserver: 'readonly', MutationObserver: 'readonly', IntersectionObserver: 'readonly',
        HTMLElement: 'readonly', HTMLInputElement: 'readonly', Element: 'readonly',
        Event: 'readonly', KeyboardEvent: 'readonly', MouseEvent: 'readonly',
        AbortController: 'readonly', TextEncoder: 'readonly', TextDecoder: 'readonly',
        btoa: 'readonly', atob: 'readonly', crypto: 'readonly', alert: 'readonly',
        confirm: 'readonly', getComputedStyle: 'readonly', matchMedia: 'readonly',
        process: 'readonly', Buffer: 'readonly', __dirname: 'readonly', global: 'readonly',
        React: 'readonly', NodeJS: 'readonly',
      },
    },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',

      // `any` is load-bearing here: the vendor aggregate crosses six tables and
      // is assembled untyped on purpose (see the repository). Typing it is
      // worth doing and is not a lint finding.
      '@typescript-eslint/no-explicit-any': 'off',
      // Interfaces that exist to be extended, and `{}` as "some object", are
      // both used deliberately in the component props.
      '@typescript-eslint/no-empty-object-type': 'off',
      // An unused function argument is often documenting a signature; an unused
      // *variable* is usually a leftover, so only those are reported.
      '@typescript-eslint/no-unused-vars': ['warn', {
        args: 'none', varsIgnorePattern: '^_', caughtErrors: 'none',
      }],
      // Reported by the TypeScript compiler already, and `tsc --noEmit` runs in
      // the same CI job.
      'no-undef': 'off',
      'no-redeclare': 'off',
      // `try { x = JSON.parse(s) } catch {}` — leave the value alone if it does
      // not parse — is used consistently and reads better than a comment
      // explaining an empty block.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Declaring a variable, then assigning it in every branch of the if/else
      // below, is a shape this codebase uses throughout. It is a style
      // preference and finds no defects, so it is not a gate.
      'no-useless-assignment': 'off',
    },
  },
);

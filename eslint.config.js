import js from '@eslint/js'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import globals from 'globals'
import tseslint from 'typescript-eslint'

/**
 * Architectural boundaries from docs/ARCHITECTURE.md are enforced here rather
 * than left to review. Two rules carry the architecture:
 *
 *  - Only src/data-access/ may import the Supabase client. A screen that
 *    reaches for Supabase directly has broken the adapter seam, which is what
 *    lets every surface be built against mocks and made real later.
 *  - src/domain/ may not import from any other layer. Money arithmetic stays
 *    pure and trivially testable.
 */
export default tseslint.config(
  {
    ignores: [
      'dist',
      'dev-dist',
      'coverage',
      'playwright-report',
      'test-results',
      'node_modules',
      '.claude/worktrees',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      globals: { ...globals.browser, __BUILD_SHA__: 'readonly', __BUILD_TIME__: 'readonly' },
    },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/data-access/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message:
                'Only src/data-access/ may import the Supabase client. Depend on the typed adapter interface instead — see docs/ARCHITECTURE.md.',
            },
          ],
        },
      ],
    },
  },

  {
    // The demo tree and the mock adapters must be structurally incapable of
    // reaching Supabase (docs/DEMO_MODE.md). The repo-wide rule above does
    // not cover src/data-access/mock/** (it lives inside data-access), so
    // both get an explicit, stricter boundary: no Supabase client, no real
    // adapters, from anywhere under these trees. Test files are exempt: the
    // boundary protects the shipped module graph, and the safety tests must
    // import the client precisely to prove the tripwire trips.
    files: ['src/data-access/mock/**/*.{ts,tsx}', 'src/demo/**/*.{ts,tsx}'],
    ignores: ['**/*.test.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@supabase/supabase-js',
              message:
                'The demo tree and mock adapters must be structurally incapable of reaching ' +
                'Supabase — see docs/DEMO_MODE.md.',
            },
          ],
          patterns: [
            {
              group: ['**/supabase', '**/supabase-adapters', '**/supabase-adapters/**'],
              message:
                'The demo tree and mock adapters must not import the Supabase client or the ' +
                'real adapters — see docs/DEMO_MODE.md.',
            },
          ],
        },
      ],
    },
  },

  {
    files: ['src/domain/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@/*', '../*', '!./*'],
              message:
                'src/domain/ is pure: no imports from other layers, no I/O. See docs/ARCHITECTURE.md.',
            },
          ],
        },
      ],
    },
  },

  {
    // The shimmer is the app's loading language, and a line of "Loading…" is
    // how a surface quietly opts out of it: one line tall where a list, a table
    // or a grid is about to appear, so the read ends in a reflow.
    //
    // A warning, deliberately, and never an error. It exists to be seen in the
    // editor at the moment the sentence is typed; nothing about this change may
    // turn a build red (shimmer-as-default-loading, design D4). It catches the
    // literal sentence and nothing more — a surface that renders nothing while
    // waiting, or one whose shimmer is the wrong shape, is the review's job.
    files: ['src/**/*.tsx'],
    ignores: ['src/components/ui/loading.tsx'],
    rules: {
      'no-restricted-syntax': [
        'warn',
        {
          selector: 'JSXText[value=/Loading/]',
          message:
            'Surfaces wait behind the shared shimmer, not a line of text. Use the placeholder ' +
            'from src/components/ui/loading.tsx, shaped like this surface — see docs/DESIGN_SYSTEM.md.',
        },
      ],
    },
  },

  {
    // Edge Functions run on Deno, not in the browser and not in Node: they use
    // URL/JSR import specifiers and the Deno global, and tsconfig deliberately
    // does not include them (its lib and module resolution are the app's).
    // They are still linted — the rules that catch real mistakes do not care
    // which runtime the file is for.
    files: ['supabase/functions/**/*.ts'],
    languageOptions: {
      globals: { ...globals.browser, Deno: 'readonly' },
    },
    rules: {
      'no-undef': 'off',
    },
  },

  {
    files: ['**/*.{mjs,js}', 'vite.config.ts', 'playwright.config.ts', 'playwright.auth.config.ts'],
    languageOptions: { globals: globals.node },
  },
)

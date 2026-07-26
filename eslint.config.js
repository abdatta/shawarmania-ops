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
    ignores: ['dist', 'dev-dist', 'coverage', 'playwright-report', 'test-results', 'node_modules'],
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
    files: ['**/*.{mjs,js}', 'vite.config.ts', 'playwright.config.ts'],
    languageOptions: { globals: globals.node },
  },
)

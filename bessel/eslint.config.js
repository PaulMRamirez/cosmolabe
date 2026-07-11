// Flat ESLint config for the workspace. Zero warnings is the gate (CLAUDE.md):
// run with --max-warnings is unnecessary because rules are set to "error".
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '.claude/**',
      '**/dist/**',
      '**/out/**',
      '**/.vite/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'vendor/**',
      'packages/cspice-wasm/wasm/**',
      'apps/*/ios/**',
      'apps/*/android/**',
      '**/*.config.js',
      '**/*.config.ts',
      'e2e/playwright.config.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      'no-console': ['error', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Tests and scripts may use console freely.
    files: ['**/*.test.ts', '**/*.bench.ts', '**/scripts/**', 'e2e/**'],
    rules: { 'no-console': 'off' },
  },
  {
    // Layering invariant (CLAUDE.md dependency rule): core packages never import a
    // concrete PAL implementation, and lower layers never import a higher one (the
    // shells/apps). This applies to every package under packages/ EXCEPT the PAL
    // implementations themselves (pal-web/electron/capacitor/node), which legitimately
    // implement the @bessel/pal interface. Apps are the shells (top layer) and are
    // not constrained here. A violation is a lint error, not a review nit.
    files: ['packages/**/*.{ts,tsx}'],
    ignores: [
      'packages/pal-web/**',
      'packages/pal-electron/**',
      'packages/pal-capacitor/**',
      'packages/pal-node/**',
    ],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '@bessel/pal-web',
                '@bessel/pal-electron',
                '@bessel/pal-capacitor',
                '@bessel/pal-node',
                '**/apps/*',
                '**/apps/*/**',
              ],
              message:
                'Layering violation (CLAUDE.md): a core package must not import a concrete PAL implementation (@bessel/pal-web/electron/capacitor/node) or anything from apps/. Depend only on @bessel/pal and other core packages; the shell injects the PAL at startup.',
            },
          ],
        },
      ],
    },
  },
  {
    // Leaf invariant (ADR-0013): @bessel/selene-design is a standalone design system.
    // @bessel/ui may import it, but it must import nothing from Bessel, so the package
    // stays publishable and reusable on its own. This makes that one-directional rule
    // machine-enforced rather than review-only: a `@bessel/*` import from inside selene
    // is a lint error.
    files: ['design-system/selene-design/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@bessel/*'],
              message:
                'selene-design is a leaf design system: it must not import from any @bessel package (ADR-0013). Keep the dependency one-directional (ui -> selene).',
            },
          ],
        },
      ],
    },
  },
);

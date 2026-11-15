import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/release/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['apps/editor/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    // The core package must stay free of DOM and Node APIs so it can run in
    // workers, tests and a command-line tool alike.
    files: ['packages/core/src/**/*.ts'],
    ignores: ['packages/core/src/**/*.test.ts', 'packages/core/src/testing/**'],
    rules: {
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'process'],
    },
  },
);

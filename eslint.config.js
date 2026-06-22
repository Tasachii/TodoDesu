import js from '@eslint/js'
import globals from 'globals'
import react from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'

export default [
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/ios/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
      'packages/web/public/sw.js',
    ],
  },

  js.configs.recommended,

  // Node-side packages (server, cli, core) and config/tooling files.
  {
    files: [
      'packages/server/**/*.js',
      'packages/cli/**/*.js',
      'packages/core/**/*.js',
      '*.config.js',
      'scripts/**/*.mjs',
    ],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // Web app: browser + React + hooks rules. Tests get the node/vitest globals
  // too so describe/it/expect/process resolve.
  {
    files: ['packages/web/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      parserOptions: { ecmaFeatures: { jsx: true } },
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.flat.recommended.rules,
      ...react.configs.flat['jsx-runtime'].rules, // React 17+ JSX transform
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off', // this codebase doesn't use prop-types
      // The focus timer is deliberately timestamp-driven (useNow): an effect
      // must transition break/finish state the moment a derived countdown
      // reaches zero. That's a legitimate "react to derived state" effect, so
      // keep it a warning rather than failing the build — rules-of-hooks and
      // exhaustive-deps stay hard errors.
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // Vitest + Playwright test files: allow the test globals.
  {
    files: ['packages/**/test/**/*.{js,jsx}', 'packages/**/e2e/**/*.{js,jsx}'],
    languageOptions: {
      globals: { ...globals.node, ...globals.browser, ...globals.vitest },
    },
  },

  // Turn off rules that conflict with Prettier's formatting.
  prettier,
]

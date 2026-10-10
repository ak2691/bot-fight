import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

// shared/engine is the simulation core that the browser, the sim-worker and tests all import. It must run
// anywhere, so it may not touch React, Pixi, the DOM, Node built-ins or the frontend; and it must be deterministic.
// Browser globals are switched off for it, so `no-undef` reports window, document, localStorage and the like.
const ENGINE_GLOBALS = {
  ...Object.fromEntries(Object.keys(globals.browser).map((name) => [name, 'off'])),
  ...globals.es2021,
  console: 'readonly',
  structuredClone: 'readonly',
};
const ENGINE_BANNED_IMPORTS = [
  { group: ['react', 'react-*', 'react/*', 'pixi.js', 'pixi.js/*', '@pixi/*', '@stomp/*', 'ajv', 'ajv/*'], message: 'The engine cannot depend on UI, rendering, network or validator libraries.' },
  { group: ['node:*', 'fs', 'path', 'url', 'os', 'crypto', 'worker_threads'], message: 'The engine cannot import Node built-ins; only tests and scripts may.' },
  { group: ['**/frontend/**', '**/sim-worker/**', '**/server/**'], message: 'The engine cannot import from the frontend, the worker or the server.' },
  { group: ['**/*.jsx', '**/*.css', '**/*.svg', '**/*.png'], message: 'The engine only imports JavaScript and JSON.' },
];

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },
  {
    // Run from the repository root: `eslint -c frontend/eslint.config.js shared/engine` (npm run lint:engine).
    files: ['shared/engine/**/*.js'],
    languageOptions: { globals: ENGINE_GLOBALS },
    rules: {
      'no-restricted-imports': ['error', { patterns: ENGINE_BANNED_IMPORTS }],
      'no-restricted-properties': ['error',
        { object: 'Math', property: 'random', message: 'The engine is deterministic: no Math.random.' },
        { object: 'Date', property: 'now', message: 'The engine is deterministic: no wall clock.' },
      ],
      'no-restricted-syntax': ['error',
        { selector: "NewExpression[callee.name='Date']", message: 'The engine is deterministic: no wall clock.' },
        { selector: "ImportExpression", message: 'The engine uses static imports only.' },
      ],
    },
  },
  {
    // Tests and test helpers inside the engine may use Node.
    files: ['shared/engine/**/*.test.js', 'shared/engine/**/testing/**/*.js'],
    languageOptions: { globals: { ...globals.node } },
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off', 'no-restricted-properties': 'off' },
  },
])

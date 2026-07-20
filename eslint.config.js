import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // 'dist' is build output. 'public/tesseract' ships prebuilt/minified
  // Tesseract.js WASM+JS bundles — vendored, never hand-edited, and served
  // to the browser by URL (not imported through the module graph), so
  // linting them is meaningless: it just produces hundreds of errors for
  // undeclared bundler/Node globals and obfuscated identifiers in someone
  // else's minified code, telling us nothing about our own source.
  globalIgnores(['dist', 'public/tesseract']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: {
        ...globals.browser,
        // Vite `define` compile-time constants (see vite.config.js) — real
        // globals at runtime, ESLint just can't see through `define` to know
        // that.
        __SPICEHUB_BUILD__: 'readonly',
        __SPICEHUB_VERSION__: 'readonly',
        __SPICEHUB_SERVER__: 'readonly',
      },
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
  // Node-context files: the Vite/Vitest config, Express server, /api
  // serverless functions, one-off scripts, and the Node/Playwright test
  // suites. These execute under Node, not a browser, so `process`, `require`,
  // `Buffer`, `__dirname`, `global`, `setImmediate`, etc. are real globals
  // here — the browser-only config above was flagging every one of them as
  // undefined across api/**, server/**, scripts/**, and tests/**.
  {
    files: [
      'vite.config.js',
      'api/**/*.js',
      'server/**/*.js',
      'scripts/**/*.js',
      'tests/**/*.js',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
])

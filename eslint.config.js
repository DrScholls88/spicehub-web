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
  // 'src/lib/photoswipe' is the same story — vendored minified PhotoSwipe
  // gallery build, imported as opaque JS, never hand-edited.
  globalIgnores(['dist', 'dist-verify*', 'public/tesseract', 'src/lib/photoswipe', 'scratch', '_import_backup_2026-09-04']),
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
      // 2026-08-24: argsIgnorePattern + caughtErrorsIgnorePattern added.
      //
      // varsIgnorePattern was already here, but it only covers VARIABLES —
      // unused function ARGUMENTS and unused CAUGHT ERRORS were still hard
      // errors, and 37 of the 106 no-unused-vars failures in the 2026-08-24
      // lint run were exactly those. The codebase already writes them with a
      // leading underscore (`_options` in this very file's proxy configure,
      // `_` in utils/exportRenderer.js), which is the universal convention for
      // "deliberately unused, kept for signature/positional reasons" — so the
      // intent was there, the config just never honoured it.
      //
      // This is the ONLY change of the three that is config-level noise
      // reduction rather than a code fix. It does not silence a single unused
      // *variable*: an argument still has to be renamed with a leading `_`
      // before the rule stops complaining, which keeps the choice explicit and
      // reviewable in the diff.
      //
      // caughtErrors defaults to 'all' in ESLint 9+, which is why bare
      // `catch (err) { /* ignore */ }` blocks error; `catch (_err)` or the
      // optional-binding form `catch {}` both satisfy it.
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Historical encoding corruption (mojibake — UTF-8 punctuation like em
      // dashes/arrows/bullets re-encoded through the wrong codepage at some
      // point) left irregular Unicode whitespace scattered through JSDoc
      // comment headers across the codebase — purely decorative, zero
      // runtime effect. Those bytes can't be reliably hand-repaired via
      // string-literal edit tools (verified: neither the raw bytes nor their
      // escaped form round-trips through edit matching), so skip comments
      // for this rule specifically rather than leave ~60 unfixable false
      // positives in every lint run. Does NOT skip strings/regexes/JSX text —
      // if this rule fires outside a comment, it's a real signal worth
      // looking at, not more of the same noise.
      'no-irregular-whitespace': ['error', { skipComments: true }],
      // The import engine's public surface is src/import/index.js. Reaching
      // past it into the recipeParser monolith is what let the previous
      // refactor's barrel sit unused; this keeps the seam greppable.
      'no-restricted-imports': ['error', {
        patterns: [{
          group: ['**/recipeParser', '**/recipeParser.js'],
          message: 'Import from src/import/index.js — the engine barrel — not recipeParser directly.',
        }],
      }],
      // no-restricted-imports does not see dynamic import(), and this repo
      // already uses `await import(...)` as a cycle-dodge idiom — so close
      // that hole explicitly or the seam rots through it.
      'no-restricted-syntax': ['error', {
        selector: "ImportExpression[source.value=/(^|\/)recipeParser(\.js)?$/]",
        message: 'Import from src/import/index.js — the engine barrel — not recipeParser directly.',
      }],
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
  {
    // Exempt from the barrel rule, each for a different reason:
    //   index.js       — the barrel itself; it must import the monolith.
    //   BrowserAssist  — its UI phase is commented out (ImportSheet.jsx ~1341)
    //                    but the module is still imported and bundled. It pulls
    //                    seven symbols the barrel does not export, so repointing
    //                    would mean widening the barrel with monolith internals
    //                    for a consumer nobody can reach. Leave until it is deleted.
    //   photoImportEngine — the barrel re-exports FROM it, so importing the
    //                    barrel here would be a genuine cycle.
    //   db.js          — imports buildStructuredFields, a schema helper rather
    //                    than engine surface, and sits in a pre-existing static
    //                    cycle with recipeParser (recipeParser.js:11 imports
    //                    ./db.js). Adding the barrel as a third hop inside that
    //                    cycle risks init order in a Dexie upgrade closure.
    // Tests import the monolith directly so they keep passing while the spine
    // moves behind the barrel. Consequence: nothing currently imports through
    // the barrel in a test, so barrel/monolith drift is not covered.
    files: [
      'src/import/index.js',
      'src/components/BrowserAssist.jsx',
      'src/lib/photoImportEngine.js',
      'src/db.js',
      'tests/**',
      'src/**/__tests__/**',
    ],
    rules: { 'no-restricted-imports': 'off', 'no-restricted-syntax': 'off' },
  },
])

// Provides an in-memory IndexedDB implementation for vitest's default
// 'node' environment so Dexie-backed modules (db.js, recipeParser.js)
// can be imported and exercised in tests.
import 'fake-indexeddb/auto';

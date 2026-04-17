// scripts/encode-cookies.js
// Usage:  node scripts/encode-cookies.js [path-to-cookies.json]
// Default path: ./cookies.json
// Prints the Base64 string suitable for the IG_COOKIES_JSON_B64 env var.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = process.argv[2] || 'cookies.json';
const path = resolve(process.cwd(), arg);
const json = readFileSync(path, 'utf-8');
// Validate JSON, re-serialize to remove pretty-printing
const parsed = JSON.parse(json);
const compact = JSON.stringify(parsed);
const b64 = Buffer.from(compact, 'utf-8').toString('base64');
process.stdout.write(b64 + '\n');

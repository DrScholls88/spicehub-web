// OCR bench — ingredient-line recall per engine over tests/import/fixtures/photos.
// Usage: node scripts/ocr-bench.mjs <photosDir> [preprocessedDir]
// Engines load by dynamic import; a missing package is skipped, so the repo
// never needs litert-ocr / paddle installed to run Tesseract alone.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [dir = 'tests/import/fixtures/photos', preDir] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));

const FRAC = { '¼': '1/4', '½': '1/2', '¾': '3/4', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8' };
const IGNORE = new Set(('cup cups tablespoon tablespoons teaspoon teaspoons tsp tbsp grams lbs oz '
  + 'and the of for in or to with cut optional roughly finely choice can squares stick sticks pieces').split(' '));
const norm = (s) => String(s).toLowerCase().replace(/[¼½¾⅓⅔⅛]/g, (c) => ` ${FRAC[c]} `).replace(/[^a-z0-9/ ]+/g, ' ');
const keyWords = (line) => norm(line).split(/\s+/).filter((w) => w.length >= 3 && !/\d/.test(w) && !IGNORE.has(w));
const lev1 = (a, b) => { // edit distance <= 1
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0, j = 0, e = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++e > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return e + (a.length - i) + (b.length - j) <= 1;
};
function recall(text, lines) {
  const words = new Set(norm(text).split(/\s+/).filter(Boolean));
  const has = (w) => words.has(w) || (w.length >= 5 && [...words].some((o) => lev1(w, o)));
  let hit = 0;
  for (const line of lines) {
    const k = keyWords(line);
    if (!k.length) continue;
    if (k.filter(has).length / k.length >= 0.67) hit++;
  }
  return hit / lines.length;
}

const engines = [];
try {
  const T = (await import('tesseract.js')).default;
  engines.push({ name: 'tesseract', pre: true, run: async (f) => { const r = await T.recognize(f, 'eng'); return { text: r.data.text, conf: r.data.confidence }; } });
} catch { console.log('tesseract.js not installed — skipped'); }
try {
  const { createWorker } = await import('litert-ocr');
  const w = await createWorker('eng');
  engines.push({ name: 'litert-ocr', pre: false, run: async (f) => { const r = await w.recognize(f); return { text: r.data.text, conf: r.data.confidence }; }, end: () => w.terminate?.() });
} catch (e) { console.log('litert-ocr not available — skipped:', e.message); }

const rows = [];
for (const c of cases) {
  const row = { photo: c.file.replace('.jpg', '') };
  for (const e of engines) {
    const pre = e.pre && preDir && join(preDir, c.file.replace('.jpg', '.png'));
    const file = pre && existsSync(pre) ? pre : join(dir, c.file);
    const t0 = Date.now();
    try {
      const { text, conf } = await e.run(file);
      if (process.env.OCR_DUMP) { const fs = await import("node:fs"); fs.mkdirSync(process.env.OCR_DUMP, { recursive: true }); fs.writeFileSync(join(process.env.OCR_DUMP, `${e.name}__${row.photo}.txt`), text); }
      row[e.name] = `${Math.round(recall(text, c.ingredients) * 100)}% (conf ${Math.round(conf ?? -1)}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`;
      row[`_${e.name}`] = recall(text, c.ingredients);
    } catch (err) { row[e.name] = 'error: ' + err.message.slice(0, 60); row[`_${e.name}`] = 0; }
  }
  rows.push(row);
}
for (const e of engines) e.end?.();
console.table(rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !k.startsWith('_')))));
for (const e of engines) {
  const avg = rows.reduce((s, r) => s + r[`_${e.name}`], 0) / rows.length;
  console.log(`${e.name}: mean ingredient-line recall ${Math.round(avg * 100)}%`);
}

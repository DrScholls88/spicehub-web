import { useState, useRef } from 'react';
import { parseFromUrl, isSocialMediaUrl, getSocialPlatform } from '../recipeParser';

/**
 * ImportModal — three import paths:
 *   1. From URL (recipe blogs, Instagram, TikTok)
 *   2. Spreadsheet (CSV / Excel)
 *   3. Paprika (.paprikarecipes bundle)
 *
 * Props:
 *   onImport(recipes[])  — called with parsed recipe array; caller decides where to save
 *   onClose()
 *   title                — optional modal title (e.g. "Import Recipe" vs "Import Drink")
 */
export default function ImportModal({ onImport, onClose, title = 'Import Recipe' }) {
  const [mode, setMode] = useState('url');         // 'url' | 'spreadsheet' | 'paprika'
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);
  const [socialDetected, setSocialDetected] = useState(null);
  const fileRef = useRef(null);
  const paprikaRef = useRef(null);

  // ── URL field change ──────────────────────────────────────────────────────────
  const handleUrlChange = (e) => {
    const val = e.target.value;
    setUrl(val);
    setError('');
    if (isSocialMediaUrl(val)) {
      setSocialDetected({ platform: getSocialPlatform(val) });
    } else {
      setSocialDetected(null);
    }
  };

  // ── Import from ANY URL ───────────────────────────────────────────────────────
  const handleUrlImport = async () => {
    if (!url.trim()) return;
    setImporting(true);
    setError('');
    try {
      const result = await parseFromUrl(url.trim());
      if (!result) {
        setError(
          'Could not extract a recipe from that URL. The site may block automated access. ' +
          'You can add the recipe manually instead.'
        );
      } else if (result._error) {
        if (result.reason === 'login-wall') {
          setError(
            `This ${result.platform || 'social media'} post requires login to view. ` +
            'Try copying the direct share URL, or add the recipe manually.'
          );
        } else if (result.reason === 'social-fetch-failed') {
          setError(
            `Could not extract from ${result.platform || 'this social media platform'}. ` +
            'For advanced social media support, run the Express server (npm run dev:full), ' +
            'or copy the recipe details manually.'
          );
        } else {
          setError(
            'Could not extract the recipe. The site may block automated access, or you may be offline. ' +
            'Copy the details manually, or if a server is available, try again.'
          );
        }
      } else {
        setPreview([result]);
      }
    } catch (e) {
      setError('Import failed: ' + e.message);
    }
    setImporting(false);
  };

  // ── Spreadsheet upload ────────────────────────────────────────────────────────
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const text = await file.text();
      const meals = [];
      if (file.name.match(/\.xlsx?$/i)) {
        try {
          const XLSX = await import('xlsx');
          const data = new Uint8Array(await file.arrayBuffer());
          const wb = XLSX.read(data, { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
          for (let i = 1; i < rows.length; i++) {
            const r = rows[i];
            if (r[0]?.toString().trim()) {
              meals.push({
                name: r[0].toString().trim(),
                ingredients: splitSemicolon(r[1]),
                directions: splitSemicolon(r[2]),
                link: r[3]?.toString().trim() || '',
                imageUrl: r[4]?.toString().trim() || '',
              });
            }
          }
        } catch {
          setError('Excel import error. Please use CSV format instead.');
          setImporting(false); return;
        }
      } else {
        const sep = file.name.endsWith('.tsv') ? '\t' : ',';
        const lines = text.split('\n').filter(l => l.trim());
        for (let i = 1; i < lines.length; i++) {
          const cols = parseCSVLine(lines[i], sep);
          if (cols[0]?.trim()) {
            meals.push({
              name: cols[0].trim(),
              ingredients: splitSemicolon(cols[1]),
              directions: splitSemicolon(cols[2]),
              link: cols[3]?.trim() || '',
              imageUrl: cols[4]?.trim() || '',
            });
          }
        }
      }
      if (meals.length === 0) {
        setError('No recipes found. Expected columns: Name | Ingredients (;-separated) | Directions (;-separated) | Link | Image URL');
      } else {
        setPreview(meals);
      }
    } catch (e) {
      setError('File read failed: ' + e.message);
    }
    setImporting(false);
  };

  // ── Paprika .paprikarecipes import ────────────────────────────────────────────
  const handlePaprikaUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(await file.arrayBuffer());

      const recipes = [];
      const entries = Object.values(zip.files).filter(f =>
        !f.dir && f.name.endsWith('.paprikarecipe')
      );

      if (entries.length === 0) {
        throw new Error('No .paprikarecipe files found inside this archive.');
      }

      for (const entry of entries) {
        try {
          // Each .paprikarecipe is gzip-compressed JSON
          const compressed = await entry.async('uint8array');
          const json = await decompressGzip(compressed);
          const rec = JSON.parse(json);
          recipes.push(parsePaprikaRecipe(rec));
        } catch (err) {
          console.warn('Skipped a Paprika recipe entry:', err.message);
        }
      }

      if (recipes.length === 0) {
        throw new Error('Could not parse any recipes from the Paprika file.');
      }
      setPreview(recipes);
    } catch (err) {
      setError('Paprika import failed: ' + err.message);
    }
    setImporting(false);
    e.target.value = '';
  };

  const confirmImport = () => {
    if (!preview) return;
    onImport(preview.map(m => ({
      ...m,
      ingredients: m.ingredients?.length ? m.ingredients : ['No ingredients listed'],
      directions: m.directions?.length ? m.directions : ['No directions listed'],
    })));
  };

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content import-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>

        {error && (
          <div className="error-bar">
            {error}
            <button className="btn-icon small" onClick={() => setError('')} style={{ marginLeft: 'auto' }}>✕</button>
          </div>
        )}

        {/* ── Preview screen ─────────────────────────────────────────────────── */}
        {preview ? (
          <div className="import-preview">
            <h3>Preview — {preview.length} recipe{preview.length !== 1 ? 's' : ''} found</h3>
            <div className="preview-list">
              {preview.map((m, i) => (
                <div key={i} className="preview-item">
                  {m.imageUrl && (
                    <img src={m.imageUrl} alt="" className="preview-thumb" onError={e => { e.target.style.display = 'none'; }} />
                  )}
                  <div className="preview-info">
                    <strong>{m.name}</strong>
                    <span>{m.ingredients?.length ?? 0} ingredients · {m.directions?.length ?? 0} steps</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="modal-footer">
              <button className="btn-secondary" onClick={() => setPreview(null)}>← Back</button>
              <button className="btn-primary" onClick={confirmImport}>
                Add {preview.length} Recipe{preview.length !== 1 ? 's' : ''}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* ── Tab bar ─────────────────────────────────────────────────────── */}
            <div className="import-tabs">
              <button
                className={mode === 'url' ? 'active' : ''}
                onClick={() => { setMode('url'); setSocialDetected(null); setError(''); }}
              >
                From URL
              </button>
              <button
                className={mode === 'spreadsheet' ? 'active' : ''}
                onClick={() => { setMode('spreadsheet'); setSocialDetected(null); setError(''); }}
              >
                Spreadsheet
              </button>
              <button
                className={mode === 'paprika' ? 'active' : ''}
                onClick={() => { setMode('paprika'); setSocialDetected(null); setError(''); }}
              >
                📋 Paprika
              </button>
            </div>

            {/* ── URL tab ─────────────────────────────────────────────────────── */}
            {mode === 'url' && (
              <div className="import-section">
                <input
                  type="url"
                  placeholder="Paste recipe URL — Instagram, TikTok, AllRecipes, etc."
                  value={url}
                  onChange={handleUrlChange}
                  className="full-width"
                  onKeyDown={e => e.key === 'Enter' && handleUrlImport()}
                  autoFocus
                />

                {socialDetected && (
                  <div className="social-detected-bar">
                    <span className="social-badge">{socialDetected.platform}</span>
                    <span>Tap Import to extract the recipe automatically.</span>
                  </div>
                )}

                {!socialDetected && (
                  <p className="help-text">
                    Paste any recipe URL and SpiceHub extracts the recipe automatically.
                  </p>
                )}

                <button
                  className="btn-primary"
                  onClick={handleUrlImport}
                  disabled={importing || !url.trim()}
                >
                  {importing ? 'Extracting recipe…' : 'Import Recipe'}
                </button>
              </div>
            )}

            {/* ── Spreadsheet tab ──────────────────────────────────────────────── */}
            {mode === 'spreadsheet' && (
              <div className="import-section">
                <p className="help-text">
                  Upload a <strong>CSV</strong> or <strong>Excel</strong> file.
                  Columns: <code>Name | Ingredients (;-separated) | Directions (;-separated) | Link | Image URL</code>
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".csv,.tsv,.xlsx,.xls"
                  onChange={handleFileUpload}
                  className="file-input"
                />
                <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
                  {importing ? 'Reading…' : 'Choose File (CSV / Excel)'}
                </button>
                <p className="help-text">First row is treated as a header and skipped.</p>
              </div>
            )}

            {/* ── Paprika tab ───────────────────────────────────────────────────── */}
            {mode === 'paprika' && (
              <div className="import-section paprika-section">
                <div className="paprika-banner">
                  <span className="paprika-logo">🌶️</span>
                  <div>
                    <strong>Import from Paprika 3</strong>
                    <p className="help-text" style={{ marginTop: 4 }}>
                      In Paprika 3, go to <strong>Settings → Export</strong> and choose
                      <em> Export All Recipes</em> to generate a <code>.paprikarecipes</code> file.
                      Then choose that file here.
                    </p>
                  </div>
                </div>
                <input
                  ref={paprikaRef}
                  type="file"
                  accept=".paprikarecipes"
                  onChange={handlePaprikaUpload}
                  className="file-input"
                />
                <button className="btn-primary paprika-btn" onClick={() => paprikaRef.current?.click()} disabled={importing}>
                  {importing ? (
                    <><span className="browser-spinner" /> Parsing Paprika file…</>
                  ) : (
                    '🌶️ Choose .paprikarecipes File'
                  )}
                </button>
                <p className="help-text">
                  All recipes from the export will be previewed before import. Your existing library is not affected.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Paprika helpers ────────────────────────────────────────────────────────────

/**
 * Decompress a gzip-compressed Uint8Array to a UTF-8 string.
 * Uses the native browser DecompressionStream API (Chrome 80+, Safari 16+, FF 113+).
 */
async function decompressGzip(compressed) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  const reader = ds.readable.getReader();

  writer.write(compressed);
  writer.close();

  const chunks = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const buf = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) { buf.set(chunk, offset); offset += chunk.length; }
  return new TextDecoder().decode(buf);
}

/**
 * Convert a Paprika recipe JSON object into a SpiceHub recipe object.
 */
function parsePaprikaRecipe(rec) {
  // Ingredients: newline-separated string
  const ingredients = (rec.ingredients || '')
    .split('\n')
    .map(s => s.trim())
    .filter(Boolean);

  // Directions: block of text — try to detect numbered steps
  const raw = (rec.directions || '').trim();
  let directions = [];
  if (raw) {
    // Numbered steps: "1. Do this\n2. Do that" or "1) Do this\n2) Do that"
    if (/^\d+[.)]\s/.test(raw)) {
      directions = raw
        .split(/\n(?=\d+[.)]\s)/)
        .map(s => s.replace(/^\d+[.)]\s*/, '').trim())
        .filter(Boolean);
    } else {
      // Split on double newlines first, then single
      const blocks = raw.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
      directions = blocks.length > 1 ? blocks : raw.split('\n').map(s => s.trim()).filter(Boolean);
    }
  }

  // Photo: prefer URL, fall back to embedded base64
  let imageUrl = rec.image_url || '';
  if (!imageUrl && rec.photo && rec.photo.length < 500000) {
    // Only embed photos under ~375 KB (base64) to avoid storing massive blobs
    imageUrl = `data:image/jpeg;base64,${rec.photo}`;
  }

  // Notes: append to directions as a final step if present
  if (rec.notes?.trim()) {
    directions.push('📝 Notes: ' + rec.notes.trim());
  }

  return {
    name: (rec.name || 'Untitled Recipe').trim(),
    ingredients: ingredients.length ? ingredients : [],
    directions: directions.length ? directions : [],
    link: rec.source_url || '',
    imageUrl,
  };
}

// ── CSV / Spreadsheet helpers ─────────────────────────────────────────────────

function splitSemicolon(val) {
  if (!val) return [];
  return val.toString().split(/[;|]/).map(s => s.trim()).filter(Boolean);
}

function parseCSVLine(line, sep = ',') {
  const result = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === sep && !inQuotes) {
      result.push(current); current = '';
    } else {
      current += c;
    }
  }
  result.push(current);
  return result;
}

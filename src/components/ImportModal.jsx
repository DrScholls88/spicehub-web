import { useState, useRef, useEffect } from 'react';
import { parseFromUrl, isSocialMediaUrl, getSocialPlatform, parseCaption, isInstagramUrl, resetServerDetection, extractWithBrowserAPI, resolveShortUrl, isShortUrl, extractUrlsFromText, tryVideoExtraction } from '../recipeParser';
import BrowserAssist from './BrowserAssist';

/**
 * ImportModal — four import paths:
 *   1. From URL (recipe blogs, Instagram, TikTok)
 *   2. From Image (screenshot, photo of index card/cookbook — OCR)
 *   3. Paste Text (recipe instructions/ingredients)
 *   4. Spreadsheet (CSV / Excel)
 *   5. Paprika (.paprikarecipes bundle)
 *
 * Props:
 *   onImport(recipes[])    — called with parsed recipe array; caller decides where to save
 *   onClose()
 *   title                  — optional modal title (e.g. "Import Recipe" vs "Import Drink")
 *   sharedContent          — optional { mode, url, text, title } from share-target
 */
export default function ImportModal({ onImport, onClose, title = 'Import Recipe', sharedContent = null }) {
  const [mode, setMode] = useState('url');         // 'url' | 'image' | 'paste' | 'spreadsheet' | 'paprika'
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);  // null = not yet, [] would mean "checked, found nothing"
  const [socialDetected, setSocialDetected] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteLink, setPasteLink] = useState('');
  // Browser Assist state
  const [browserAssistUrl, setBrowserAssistUrl] = useState(null);
  const [browserAssistMode, setBrowserAssistMode] = useState('off'); // 'off' | 'showing'
  const fileRef = useRef(null);
  const paprikaRef = useRef(null);
  const imageRef = useRef(null);
  const cameraRef = useRef(null);

  // ── Drag and drop state for reorganizing ingredients/directions ────────────
  const [dragSource, setDragSource] = useState(null); // { field, index, recipeIdx }
  const [dragOverField, setDragOverField] = useState(null); // { field, recipeIdx } — shows which field is drop target

  // ── Lock body scroll while modal is open ────────────────────────────────────
  useEffect(() => {
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = origOverflow; };
  }, []);

  // ── Handle shared content from share-target (Android/iOS share sheet) ────────
  useEffect(() => {
    if (sharedContent) {
      if (sharedContent.mode === 'url' && sharedContent.url) {
        setMode('url');
        setUrl(sharedContent.url);
        setError('');
        // Auto-detect social media if applicable
        if (isSocialMediaUrl(sharedContent.url)) {
          setSocialDetected({ platform: getSocialPlatform(sharedContent.url) });
        }
      } else if (sharedContent.mode === 'paste' && sharedContent.text) {
        setMode('paste');
        setPasteText(sharedContent.text);
        setError('');
      }
    }
  }, [sharedContent]);

  // ── Auto-extract when shared URL is set and modal opens ──
  useEffect(() => {
    if (sharedContent?.mode === 'url' && sharedContent?.url && !preview && !importing) {
      console.log('[ImportModal] Auto-triggering extraction for shared URL:', sharedContent.url);
      setUrl(sharedContent.url);
      // Auto-detect social platform for badge display
      if (isSocialMediaUrl(sharedContent.url)) {
        setSocialDetected({ platform: getSocialPlatform(sharedContent.url) });
      }
      setImporting(true);
      setImportProgress('Extracting recipe...');
      // Defer to avoid blocking render
      const timer = setTimeout(() => {
        performUrlExtraction(sharedContent.url);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [sharedContent?.url, preview, importing]);

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
    let trimmedUrl = url.trim();

    // ── Multi-URL detection: if user pasted multiple URLs, batch import ──
    const detectedUrls = extractUrlsFromText(trimmedUrl);
    if (detectedUrls.length > 1) {
      handleBatchImport(detectedUrls);
      return;
    }

    setImporting(true);
    await performUrlExtraction(trimmedUrl);
  };

  // ── Extract URL (reusable for auto-extraction on share-target) ──────────────────
  const performUrlExtraction = async (urlToExtract) => {
    if (!urlToExtract?.trim()) {
      setImporting(false);
      setImportProgress('');
      return;
    }
    let trimmedUrl = urlToExtract.trim();

    try {
      // ── URL shortener resolution ──
      if (isShortUrl(trimmedUrl)) {
        setImportProgress('Resolving shortened URL...');
        try {
          const resolved = await resolveShortUrl(trimmedUrl, setImportProgress);
          if (resolved !== trimmedUrl) {
            trimmedUrl = resolved;
            setUrl(resolved);
            if (isSocialMediaUrl(resolved)) {
              setSocialDetected({ platform: getSocialPlatform(resolved) });
            }
          }
        } catch { /* continue with original URL */ }
      }

      // ── Instagram special handling ──
      if (isInstagramUrl(trimmedUrl)) {
        setImportProgress('Trying Instagram extraction...');
        try {
          const result = await parseFromUrl(trimmedUrl, (progress) => {
            setImportProgress(progress);
          });
          if (result && !result._error) {
            setPreview([result]);
            setImporting(false);
            setImportProgress('');
            return;
          }
        } catch { /* fall through */ }

        setImportProgress('Trying embedded page extraction...');
        try {
          const { fetchHtmlViaProxy } = await import('../api');
          const shortcodeMatch = trimmedUrl.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
          const embedUrl = shortcodeMatch
            ? `https://www.instagram.com/p/${shortcodeMatch[1]}/embed/captioned/`
            : trimmedUrl;
          const html = await fetchHtmlViaProxy(embedUrl, 40000);
          if (html && html.length > 500) {
            const extracted = extractWithBrowserAPI({
              html,
              visibleText: '',
              imageUrls: [],
              sourceUrl: trimmedUrl,
            });
            if (extracted && extracted.ingredients?.length > 1) {
              setPreview([extracted]);
              setImporting(false);
              setImportProgress('');
              return;
            }
          }
        } catch { /* fall through to BrowserAssist */ }

        setImporting(false);
        setImportProgress('');
        setBrowserAssistUrl(trimmedUrl);
        setBrowserAssistMode('showing');
        return;
      }

      // ── Non-Instagram URLs ──
      setError('');
      setBrowserAssistMode('off');

      // For social/video URLs, try the dedicated video extraction endpoint first
      // This gives faster results via yt-dlp metadata + subtitles
      if (isSocialMediaUrl(trimmedUrl)) {
        setImportProgress('Extracting video metadata...');
        try {
          const videoResult = await tryVideoExtraction(trimmedUrl, (progress) => {
            setImportProgress(progress);
          });
          if (videoResult && !videoResult._error && videoResult.ingredients?.[0] !== 'See original post for ingredients') {
            setPreview([videoResult]);
            setImporting(false);
            setImportProgress('');
            return;
          }
        } catch { /* fall through to parseFromUrl */ }
      }

      setImportProgress('Extracting recipe...');
      const result = await parseFromUrl(trimmedUrl, (progress) => {
        setImportProgress(progress);
      });

      if (!result || result._error) {
        if (isSocialMediaUrl(trimmedUrl)) {
          setImporting(false);
          setImportProgress('');
          setBrowserAssistUrl(trimmedUrl);
          setBrowserAssistMode('showing');
          return;
        }
        if (result?._error && result.reason === 'login-wall') {
          setError(
            `This ${result.platform || 'social media'} post requires login to view. ` +
            'Copy the recipe caption from the app and use the "Paste Text" tab instead.'
          );
        } else {
          setError(
            'Could not extract a recipe from that URL. The site may block automated access. ' +
            'Try the "Paste Text" tab to paste the recipe caption or text instead.'
          );
        }
      } else {
        setPreview([result]);
      }
    } catch (e) {
      setError('Import failed: ' + e.message);
    }
    setImporting(false);
    setImportProgress('');
  };

  // ── Browser Assist callbacks ───────────────────────────────────────────────────
  const handleBrowserAssistRecipe = (recipe) => {
    if (recipe) {
      // Recipe successfully extracted from visible page
      setPreview([recipe]);
      setBrowserAssistMode('off');
    }
  };

  const handleBrowserAssistFallback = () => {
    // User clicked "Use Paste Text Instead" — switch directly to Paste Text tab
    setBrowserAssistMode('off');
    setMode('paste');
    setPasteLink(url); // Pre-fill the source URL so user doesn't lose it
  };

  // ── Multi-URL batch import ──────────────────────────────────────────────────
  const [batchProgress, setBatchProgress] = useState(null); // { current, total, results[] }

  const handleBatchImport = async (urls) => {
    setError('');
    setImporting(true);
    setBatchProgress({ current: 0, total: urls.length, results: [] });

    const results = [];
    for (let i = 0; i < urls.length; i++) {
      setBatchProgress(prev => ({ ...prev, current: i + 1 }));
      setImportProgress(`Importing ${i + 1} of ${urls.length}...`);

      try {
        // Resolve short URLs first
        let resolvedUrl = urls[i];
        if (isShortUrl(resolvedUrl)) {
          try { resolvedUrl = await resolveShortUrl(resolvedUrl); } catch {}
        }

        const result = await parseFromUrl(resolvedUrl, () => {});
        if (result && !result._error) {
          results.push(result);
        }
      } catch { /* skip failed URLs */ }

      // Small delay between requests to avoid rate limiting
      if (i < urls.length - 1) await new Promise(r => setTimeout(r, 500));
    }

    setBatchProgress(null);
    setImporting(false);
    setImportProgress('');

    if (results.length > 0) {
      setPreview(results);
    } else {
      setError(`Could not extract recipes from any of the ${urls.length} URLs. Try pasting recipe text instead.`);
    }
  };

  // ── Clipboard paste auto-detection ──────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'url') return;
    const handlePaste = (e) => {
      const pasted = e.clipboardData?.getData('text')?.trim();
      if (!pasted) return;

      // Auto-detect pasted URLs
      const pastedUrls = extractUrlsFromText(pasted);
      if (pastedUrls.length === 1) {
        // Single URL pasted — auto-fill and start import
        setUrl(pastedUrls[0]);
        if (isSocialMediaUrl(pastedUrls[0])) {
          setSocialDetected({ platform: getSocialPlatform(pastedUrls[0]) });
        }
      } else if (pastedUrls.length > 1) {
        // Multiple URLs pasted — set the raw text and let handleUrlImport detect batch
        setUrl(pasted);
      }
    };

    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
  }, [mode]);

  // ── Paste caption/text import (Mealie-style fallback) ────────────────────────
  const handlePasteImport = () => {
    if (!pasteText.trim()) return;
    setError('');
    const parsed = parseCaption(pasteText.trim());
    const recipe = {
      name: parsed.title || 'Pasted Recipe',
      ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : [],
      directions: parsed.directions.length > 0 ? parsed.directions : [],
      imageUrl: '',
      link: pasteLink.trim() || '',
    };
    // If parser couldn't split, put everything in directions
    if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
      const lines = pasteText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 1);
      recipe.directions = lines.length > 0 ? lines : ['See pasted text for details'];
    }
    setPreview([recipe]);
  };

  // ── Image OCR import ────────────────────────────────────────────────────────
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setImportProgress('Loading OCR engine...');
    try {
      // Always capture the original photo as the recipe image
      setImportProgress('Processing image...');
      const imageDataUrl = await fileToDataUrl(file);

      // Preprocess image for better OCR quality
      const processedImage = await preprocessImageForOCR(file);

      // Dynamic import of Tesseract.js (lazy-loaded, ~3MB)
      setImportProgress('Loading text recognition...');
      const Tesseract = await import('tesseract.js');

      setImportProgress('Reading text from image...');
      const result = await Tesseract.recognize(
        processedImage,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              const pct = Math.round((m.progress || 0) * 100);
              setImportProgress(`Reading text... ${pct}%`);
            }
          },
        }
      );

      const ocrText = result.data.text?.trim();
      if (!ocrText || ocrText.length < 10) {
        setError('Could not read any text from this image. Try a clearer photo with good lighting and more contrast.');
        setImporting(false);
        setImportProgress('');
        e.target.value = '';
        return;
      }

      // Clean OCR artifacts before parsing
      const cleanedText = cleanOcrText(ocrText);

      // Parse the OCR text through the recipe caption parser
      setImportProgress('Parsing recipe...');
      const parsed = parseCaption(cleanedText);

      // Build recipe object — ALWAYS keep the original photo
      const recipe = {
        name: parsed.title || 'Recipe from Photo',
        ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : [],
        directions: parsed.directions.length > 0 ? parsed.directions : [],
        imageUrl: imageDataUrl, // Always store original photo
        link: '',
      };

      // If the caption parser couldn't split into ingredients/directions,
      // use improved heuristics that consider cooking verbs and measurements
      if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
        const lines = cleanedText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
        if (lines.length > 0) {
          classifyOcrLines(lines, recipe);
        }
        // If still nothing, dump everything into directions
        if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
          recipe.directions = lines.length > 0 ? lines : ['See photo for recipe details'];
        }
      }

      setPreview([recipe]);
    } catch (err) {
      console.error('[SpiceHub] OCR error:', err);
      setError('Could not process image: ' + (err.message || 'Unknown error'));
    }
    setImporting(false);
    setImportProgress('');
    e.target.value = '';
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

  // ── Drag and drop handlers for reordering ingredients/directions ────────────
  const handleDragStart = (field, index, recipeIdx, e) => {
    setDragSource({ field, index, recipeIdx });
    e.dataTransfer.effectAllowed = 'move';
    e.currentTarget.style.opacity = '0.5';
  };

  const handleDragOver = (field, recipeIdx, e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverField({ field, recipeIdx });
  };

  const handleDrop = (field, index, recipeIdx, e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragSource) return;

    const { field: srcField, index: srcIdx, recipeIdx: srcRecipeIdx } = dragSource;
    const updated = [...preview];

    // Move between different fields or within same field
    const sourceItems = [...(updated[srcRecipeIdx][srcField] || [])];
    const [movedItem] = sourceItems.splice(srcIdx, 1);
    updated[srcRecipeIdx] = { ...updated[srcRecipeIdx], [srcField]: sourceItems };

    // Insert into target field
    const targetItems = [...(updated[recipeIdx][field] || [])];
    targetItems.splice(index, 0, movedItem);
    updated[recipeIdx] = { ...updated[recipeIdx], [field]: targetItems };

    setPreview(updated);
    setDragSource(null);
    setDragOverField(null);
  };

  const handleDragEnd = (e) => {
    e.currentTarget.style.opacity = '1';
    setDragSource(null);
    setDragOverField(null);
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

        {/* ── Browser Assist (interactive extraction — last resort for any URL) ── */}
        {browserAssistMode === 'showing' ? (
          <div className="import-browser-assist">
            <BrowserAssist
              url={browserAssistUrl}
              onRecipeExtracted={handleBrowserAssistRecipe}
              onFallbackToText={handleBrowserAssistFallback}
            />
          </div>

        ) : /* ── Preview screen (full detail + editable) ──────────────────────── */
        preview ? (
          <div className="import-preview">
            <h3>
              Preview — {preview.length} recipe{preview.length !== 1 ? 's' : ''} found
              {preview.some(m => m._hasSubtitles) && (
                <span className="subtitle-badge" title="Recipe extracted from video subtitles">CC</span>
              )}
              {preview.some(m => m._extractedVia?.startsWith('yt-dlp')) && (
                <span className="extraction-badge" title="Extracted via video metadata">Video</span>
              )}
            </h3>
            <div className="preview-detail-list">
              {preview.map((m, idx) => (
                <div key={idx} className="preview-detail-card">
                  {/* Header: image + title */}
                  <div className="preview-detail-header">
                    {m.imageUrl ? (
                      <img
                        src={m.imageUrl}
                        alt=""
                        className="preview-detail-thumb"
                        onError={e => {
                          // Try CORS proxy fallback (no backend server needed)
                          if (!e.target.dataset.proxied) {
                            e.target.dataset.proxied = '1';
                            e.target.src = `https://api.allorigins.win/raw?url=${encodeURIComponent(m.imageUrl)}`;
                          } else {
                            e.target.style.display = 'none';
                          }
                        }}
                      />
                    ) : (
                      <div className="preview-detail-no-img">No image</div>
                    )}
                    <div className="preview-detail-title-zone">
                      <label className="preview-label">Recipe Name</label>
                      <input
                        type="text"
                        className="preview-title-input"
                        value={m.name}
                        onChange={e => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], name: e.target.value };
                          setPreview(updated);
                        }}
                      />
                    </div>
                  </div>

                  {/* Ingredients (editable list) */}
                  <div
                    className="preview-detail-section"
                    onDragOver={(e) => handleDragOver('ingredients', idx, e)}
                    onDrop={(e) => handleDrop('ingredients', (m.ingredients || []).length, idx, e)}
                    onDragLeave={() => setDragOverField(null)}
                    style={{
                      background: dragOverField?.field === 'ingredients' && dragOverField?.recipeIdx === idx ? '#fffde7' : 'transparent',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    <label className="preview-label">
                      Ingredients ({m.ingredients?.length ?? 0})
                      <button
                        className="preview-add-btn"
                        onClick={() => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], ingredients: [...(updated[idx].ingredients || []), ''] };
                          setPreview(updated);
                        }}
                      >+ Add</button>
                    </label>
                    <div className="preview-editable-list">
                      {(m.ingredients || []).map((ing, ingIdx) => (
                        <div
                          key={ingIdx}
                          className="preview-editable-row"
                          draggable
                          onDragStart={(e) => handleDragStart('ingredients', ingIdx, idx, e)}
                          onDragOver={(e) => handleDragOver('ingredients', idx, e)}
                          onDrop={(e) => handleDrop('ingredients', ingIdx, idx, e)}
                          onDragEnd={handleDragEnd}
                          style={{
                            cursor: dragSource?.recipeIdx === idx ? 'grabbing' : 'grab',
                            opacity: dragSource?.field === 'ingredients' && dragSource?.recipeIdx === idx && dragSource?.index === ingIdx ? 0.5 : 1
                          }}
                        >
                          <input
                            type="text"
                            value={ing}
                            placeholder="e.g. 2 cups flour"
                            onChange={e => {
                              const updated = [...preview];
                              const ings = [...(updated[idx].ingredients || [])];
                              ings[ingIdx] = e.target.value;
                              updated[idx] = { ...updated[idx], ingredients: ings };
                              setPreview(updated);
                            }}
                          />
                          <button
                            className="preview-remove-btn"
                            onClick={() => {
                              const updated = [...preview];
                              const ings = [...(updated[idx].ingredients || [])];
                              ings.splice(ingIdx, 1);
                              updated[idx] = { ...updated[idx], ingredients: ings };
                              setPreview(updated);
                            }}
                            title="Remove"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Directions (editable list) */}
                  <div
                    className="preview-detail-section"
                    onDragOver={(e) => handleDragOver('directions', idx, e)}
                    onDrop={(e) => handleDrop('directions', (m.directions || []).length, idx, e)}
                    onDragLeave={() => setDragOverField(null)}
                    style={{
                      background: dragOverField?.field === 'directions' && dragOverField?.recipeIdx === idx ? '#fffde7' : 'transparent',
                      transition: 'background-color 0.2s'
                    }}
                  >
                    <label className="preview-label">
                      Steps ({m.directions?.length ?? 0})
                      <button
                        className="preview-add-btn"
                        onClick={() => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], directions: [...(updated[idx].directions || []), ''] };
                          setPreview(updated);
                        }}
                      >+ Add</button>
                    </label>
                    <div className="preview-editable-list">
                      {(m.directions || []).map((step, stepIdx) => (
                        <div
                          key={stepIdx}
                          className="preview-editable-row preview-step-row"
                          draggable
                          onDragStart={(e) => handleDragStart('directions', stepIdx, idx, e)}
                          onDragOver={(e) => handleDragOver('directions', idx, e)}
                          onDrop={(e) => handleDrop('directions', stepIdx, idx, e)}
                          onDragEnd={handleDragEnd}
                          style={{
                            cursor: dragSource?.recipeIdx === idx ? 'grabbing' : 'grab',
                            opacity: dragSource?.field === 'directions' && dragSource?.recipeIdx === idx && dragSource?.index === stepIdx ? 0.5 : 1
                          }}
                        >
                          <span className="preview-step-num">{stepIdx + 1}</span>
                          <textarea
                            value={step}
                            placeholder="Describe this step..."
                            rows={2}
                            onChange={e => {
                              const updated = [...preview];
                              const dirs = [...(updated[idx].directions || [])];
                              dirs[stepIdx] = e.target.value;
                              updated[idx] = { ...updated[idx], directions: dirs };
                              setPreview(updated);
                            }}
                          />
                          <button
                            className="preview-remove-btn"
                            onClick={() => {
                              const updated = [...preview];
                              const dirs = [...(updated[idx].directions || [])];
                              dirs.splice(stepIdx, 1);
                              updated[idx] = { ...updated[idx], directions: dirs };
                              setPreview(updated);
                            }}
                            title="Remove"
                          >✕</button>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Source URL (editable) */}
                  {m.link && (
                    <div className="preview-detail-section">
                      <label className="preview-label">Source</label>
                      <input
                        type="url"
                        className="preview-source-input"
                        value={m.link}
                        onChange={e => {
                          const updated = [...preview];
                          updated[idx] = { ...updated[idx], link: e.target.value };
                          setPreview(updated);
                        }}
                      />
                    </div>
                  )}
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
                className={mode === 'paste' ? 'active' : ''}
                onClick={() => { setMode('paste'); setSocialDetected(null); setError(''); }}
              >
                Paste Text
              </button>
              <button
                className={mode === 'image' ? 'active' : ''}
                onClick={() => { setMode('image'); setError(''); }}
              >
                From Photo
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
                Paprika
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
                    <span>
                      {socialDetected.platform === 'YouTube'
                        ? 'SpiceHub will extract the description and subtitles automatically.'
                        : 'Tap Import to extract the recipe automatically.'}
                    </span>
                  </div>
                )}

                {!socialDetected && (
                  <p className="help-text">
                    Paste any recipe URL — blogs, YouTube, Instagram, TikTok, and more.
                    Shortened links (bit.ly, t.co, etc.) are auto-resolved.
                    Paste multiple URLs to batch-import several recipes at once.
                  </p>
                )}

                {/* Batch progress indicator */}
                {batchProgress && (
                  <div className="batch-progress">
                    <div className="batch-progress-header">
                      <span>Importing {batchProgress.current} of {batchProgress.total} recipes…</span>
                    </div>
                    <div className="batch-progress-bar">
                      <div
                        className="batch-progress-fill"
                        style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
                      />
                    </div>
                  </div>
                )}

                <button
                  className="btn-primary"
                  onClick={handleUrlImport}
                  disabled={importing || !url.trim()}
                >
                  {importing ? (
                    <><span className="browser-spinner" /> {importProgress || 'Extracting recipe…'}</>
                  ) : 'Import Recipe'}
                </button>
              </div>
            )}

            {/* ── Paste Text tab (Mealie-style fallback) ────────────────────── */}
            {mode === 'paste' && (
              <div className="import-section">
                <div className="paste-import-banner">
                  <div className="paste-import-icon">📋</div>
                  <div>
                    <strong>Paste Recipe Text</strong>
                    <p className="help-text" style={{ marginTop: 4 }}>
                      Copy the recipe caption from Instagram, TikTok, or any source and paste it below.
                      SpiceHub will detect ingredients and directions automatically.
                    </p>
                  </div>
                </div>

                <textarea
                  className="paste-textarea full-width"
                  placeholder={"Paste recipe text here…\n\nExample:\nChicken Stir Fry\n\nIngredients:\n2 chicken breasts, diced\n1 tbsp soy sauce\n...\n\nDirections:\n1. Heat oil in a pan\n2. Cook chicken until golden\n..."}
                  value={pasteText}
                  onChange={e => setPasteText(e.target.value)}
                  rows={10}
                />

                <input
                  type="url"
                  placeholder="Source URL (optional — for your reference)"
                  value={pasteLink}
                  onChange={e => setPasteLink(e.target.value)}
                  className="full-width"
                  style={{ marginTop: 8 }}
                />

                <button
                  className="btn-primary"
                  onClick={handlePasteImport}
                  disabled={!pasteText.trim()}
                  style={{ marginTop: 12 }}
                >
                  Parse Recipe
                </button>

                <p className="help-text" style={{ marginTop: 8 }}>
                  Tip: Include section headers like "Ingredients:" and "Directions:" for best results.
                  You can always edit the recipe after importing.
                </p>
              </div>
            )}

            {/* ── Image/Photo OCR tab ─────────────────────────────────────────── */}
            {mode === 'image' && (
              <div className="import-section">
                <div className="image-import-banner">
                  <div className="image-import-icon">📸</div>
                  <div>
                    <strong>Import from Photo</strong>
                    <p className="help-text" style={{ marginTop: 4 }}>
                      Take a photo of a recipe card, cookbook page, or screenshot. SpiceHub will read the text and extract the recipe.
                    </p>
                  </div>
                </div>

                {/* Hidden file inputs */}
                <input
                  ref={imageRef}
                  type="file"
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="file-input"
                />
                <input
                  ref={cameraRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={handleImageUpload}
                  className="file-input"
                />

                {importing ? (
                  <div className="image-import-progress">
                    <span className="browser-spinner large" />
                    <p className="import-progress-text">{importProgress || 'Processing...'}</p>
                  </div>
                ) : (
                  <div className="image-import-buttons">
                    <button
                      className="btn-primary"
                      onClick={() => cameraRef.current?.click()}
                    >
                      Take Photo
                    </button>
                    <button
                      className="btn-secondary"
                      onClick={() => imageRef.current?.click()}
                    >
                      Choose from Gallery
                    </button>
                  </div>
                )}

                <p className="help-text" style={{ marginTop: 12 }}>
                  Works with: recipe index cards, cookbook pages, screenshots of recipes, handwritten recipes (clear print works best).
                </p>
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
                    'Choose .paprikarecipes File'
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

// ── Image helpers ─────────────────────────────────────────────────────────────

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Preprocess image for better OCR quality:
 *   - Resize to optimal width (Tesseract works best around 2000-3000px wide)
 *   - Increase contrast
 *   - Convert to grayscale
 *   - Sharpen text edges
 * Returns a canvas element that Tesseract can accept.
 */
async function preprocessImageForOCR(file) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');

      // Scale to optimal OCR width (2500px) if larger or much smaller
      const TARGET_WIDTH = 2500;
      let w = img.width;
      let h = img.height;
      if (w > TARGET_WIDTH || w < 800) {
        const scale = TARGET_WIDTH / w;
        w = TARGET_WIDTH;
        h = Math.round(h * scale);
      }

      canvas.width = w;
      canvas.height = h;

      // Draw original
      ctx.drawImage(img, 0, 0, w, h);

      // Apply contrast enhancement and grayscale
      try {
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        for (let i = 0; i < data.length; i += 4) {
          // Convert to grayscale using luminance formula
          const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];

          // Increase contrast (stretch histogram)
          // Factor of 1.5 with midpoint at 128
          const contrast = 1.5;
          const adjusted = Math.max(0, Math.min(255, ((gray - 128) * contrast) + 128));

          data[i] = adjusted;     // R
          data[i + 1] = adjusted; // G
          data[i + 2] = adjusted; // B
          // Alpha stays the same
        }

        ctx.putImageData(imageData, 0, 0);
      } catch {
        // Canvas tainted (e.g. cross-origin image) — use original
      }

      resolve(canvas);
    };
    img.onerror = () => resolve(file); // Fallback to original file
    img.src = URL.createObjectURL(file);
  });
}

/**
 * Clean common OCR artifacts and noise from recognized text.
 */
function cleanOcrText(text) {
  return text
    // Fix common OCR misreadings
    .replace(/\bl\b(?=\s*cup)/gi, '1')     // "l cup" → "1 cup"
    .replace(/\bO\b(?=\s*tbsp)/gi, '0')     // "O tbsp" → "0 tbsp"
    .replace(/\|/g, 'l')                     // pipe → l (common OCR error)
    // Remove stray single characters that aren't meaningful
    .replace(/^[|\\\/~`]{1,3}$/gm, '')
    // Fix doubled spaces
    .replace(/  +/g, ' ')
    // Remove lines that are just noise (single chars, symbols)
    .split('\n')
    .filter(line => {
      const trimmed = line.trim();
      if (trimmed.length < 2) return false;
      // Skip lines that are mostly symbols/noise
      const alphaCount = (trimmed.match(/[a-zA-Z]/g) || []).length;
      return alphaCount > trimmed.length * 0.3; // At least 30% alphabetic
    })
    .join('\n');
}

/**
 * Classify OCR lines into ingredients vs directions using cooking heuristics.
 * Much better than the naive "short = ingredient" approach.
 */
function classifyOcrLines(lines, recipe) {
  // Measurement units that strongly indicate ingredients
  const UNIT_RE = /\b(cups?|tbsp|tsp|tablespoons?|teaspoons?|oz|ounces?|lbs?|pounds?|grams?|g\b|kg|ml|liters?|pinch|dash|cloves?|cans?|packages?|sticks?|slices?|bunch)\b/i;
  // Fractions at start of line strongly indicate ingredients
  const STARTS_WITH_NUM = /^[\d½¼¾⅓⅔⅛⅜⅝⅞]/;
  // Cooking action verbs strongly indicate directions
  const COOKING_VERB = /^(mix|stir|add|combine|pour|heat|cook|bake|fry|saut[eé]|chop|dice|mince|preheat|whisk|blend|fold|season|serve|place|put|set|bring|let|cover|remove|transfer|slice|cut|grill|roast|simmer|boil|drain|rinse|prepare|arrange|sprinkle|drizzle|toss|marinate|refrigerate|chill|melt|beat|cream|knead|roll|shape|spread|layer|garnish|start|begin|first|then|next|finally|broil|brush|coat|press|squeeze|wash|peel|trim|top|finish|reduce|brown|sear|steam|in a)\b/i;
  // Numbered step at start
  const STEP_NUM = /^\d+[.):\s-]\s*/;

  let inIngredients = false;
  let inDirections = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    // Check for section headers
    const lower = trimmed.toLowerCase();
    if (/^ingredients?:?\s*$/i.test(lower) || lower === 'you will need' || lower === "what you'll need") {
      inIngredients = true;
      inDirections = false;
      continue;
    }
    if (/^(directions?|instructions?|method|steps?|preparation):?\s*$/i.test(lower)) {
      inIngredients = false;
      inDirections = true;
      continue;
    }

    // If we're in a detected section, use that
    if (inIngredients) {
      recipe.ingredients.push(trimmed);
      continue;
    }
    if (inDirections) {
      recipe.directions.push(trimmed);
      continue;
    }

    // Heuristic classification
    const hasUnit = UNIT_RE.test(trimmed);
    const startsWithNum = STARTS_WITH_NUM.test(trimmed);
    const hasCookingVerb = COOKING_VERB.test(trimmed);
    const hasStepNum = STEP_NUM.test(trimmed);
    const isShort = trimmed.length < 50;

    // Strong ingredient signals
    if ((startsWithNum && hasUnit) || (isShort && hasUnit && !hasCookingVerb)) {
      recipe.ingredients.push(trimmed);
    }
    // Strong direction signals
    else if (hasCookingVerb || hasStepNum || trimmed.length > 80) {
      recipe.directions.push(trimmed);
    }
    // Moderate: starts with number + short = ingredient
    else if (startsWithNum && isShort) {
      recipe.ingredients.push(trimmed);
    }
    // Default: longer lines are more likely directions
    else if (trimmed.length > 40) {
      recipe.directions.push(trimmed);
    }
    // Short lines without clear signal — guess ingredient
    else {
      recipe.ingredients.push(trimmed);
    }
  }
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
    directions.push('Notes: ' + rec.notes.trim());
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

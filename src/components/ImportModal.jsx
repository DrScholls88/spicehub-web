import { useState, useRef, useEffect, useCallback } from 'react';
import {
  isSocialMediaUrl, getSocialPlatform,
  isInstagramUrl, isShortUrl, resolveShortUrl,
  parseFromUrl, importRecipeFromUrl, captionToRecipe, parseCaption,
  classifyWithConfidence, smartClassifyLines, normalizeAndDedupe,
  scoreExtractionConfidence,
  isWeakResult,
  detectImportType,
  parseHtml,
  structureRecipeFromImage,
} from '../recipeParser.js';
import BrowserAssist from './BrowserAssist';
import { normalizeInstagramUrl, fetchHtmlViaProxy, cleanUrl } from '../api.js';
import db from '../db.js';
import { shaHex } from '../shaHex.js';
import {
  InstagramEmbed,
  TikTokEmbed,
  YouTubeEmbed,
  FacebookEmbed,
  XEmbed,
  PinterestEmbed,
} from 'react-social-media-embed';
import './ImportModal.css';


/**
 * SocialPreview — renders the official platform embed (Instagram/TikTok/etc.)
 * inline in the URL pane. Iframe loads instantly while the scraper runs in
 * the background, so the user always sees the post within ~500ms.
 *
 * Returns null for non-social or unsupported URLs.
 */
function SocialPreview({ url }) {
  if (!url) return null;
  let host;
  try { host = new URL(url).hostname.replace(/^www\./, ''); } catch { return null; }

  // Each embed handles its own loading state + skeleton; we just pick.
  const wrap = (child) => (
    <div
      className="social-embed-wrap"
      style={{
        margin: '12px 0 4px',
        borderRadius: 12,
        overflow: 'hidden',
        background: 'rgba(0,0,0,0.04)',
        display: 'flex',
        justifyContent: 'center',
        minHeight: 180,
      }}
    >
      {child}
    </div>
  );

  if (host.includes('instagram.com')) {
    return wrap(<InstagramEmbed url={url} width="100%" captioned />);
  }
  if (host.includes('tiktok.com')) {
    return wrap(<TikTokEmbed url={url} width="100%" />);
  }
  if (host.includes('youtube.com') || host === 'youtu.be') {
    return wrap(<YouTubeEmbed url={url} width="100%" />);
  }
  if (host.includes('facebook.com') || host === 'fb.watch') {
    return wrap(<FacebookEmbed url={url} width="100%" />);
  }
  if (host.includes('twitter.com') || host === 'x.com') {
    return wrap(<XEmbed url={url} width="100%" />);
  }
  if (host.includes('pinterest.com')) {
    return wrap(<PinterestEmbed url={url} width="100%" />);
  }
  return null;
}

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
export default function ImportModal({ onImport, onClose, title = 'Import Recipe', sharedContent = null, initialItemType = 'meal' }) {
  const [mode, setMode] = useState('url');         // 'url' | 'image' | 'paste' | 'spreadsheet' | 'paprika'
  const [url, setUrl] = useState('');
  // itemType — 'meal' | 'drink'. Seeded from initialItemType prop (set by caller), auto-detected
  // from URL + paste text, and user-overridable via the one-tap toggle.
  const [itemType, setItemType] = useState(initialItemType);
  // Treat an explicit 'drink' caller context as already-overridden so that
  // detectImportType cannot silently reset it back to 'meal' when the user
  // pastes a plain Instagram URL (which has no drink keywords in the path).
  const [itemTypeUserOverride, setItemTypeUserOverride] = useState(initialItemType === 'drink');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(null);  // null = not yet, [] would mean "checked, found nothing"
  const [socialDetected, setSocialDetected] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [pasteLink, setPasteLink] = useState('');
  const [progress, setProgress] = useState([
    { label: 'Video subtitles', status: 'pending', message: '' },
    { label: 'Caption fetch', status: 'pending', message: '' },
    { label: 'AI browser', status: 'pending', message: '' },
    { label: 'AI structuring', status: 'pending', message: '' },
  ]);
  const [bestImage, setBestImage] = useState(null);
  const [manualUrl, setManualUrl] = useState('');
  // Browser Assist state
  const [browserAssistUrl, setBrowserAssistUrl] = useState(null);
  const [browserAssistMode, setBrowserAssistMode] = useState('off'); // 'off' | 'showing'
  // When the auto-pipeline gives us something partial (title, hero image, one ingredient),
  // we hand those to BrowserAssist as a "seed" so the user can keep what worked and
  // only aim the parser at what's missing.
  const [browserAssistSeed, setBrowserAssistSeed] = useState(null);
  const fileRef = useRef(null);
  const paprikaRef = useRef(null);
  const imageRef = useRef(null);
  const cameraRef = useRef(null);
  // Ref to BrowserAssist — exposes triggerVisualScrape() for parent-driven visual parse
  const browserAssistRef = useRef(null);
  // Visual block IDs the user has selected inside BrowserAssist overlays (future UX: refine)
  const [selectedVisualBlocks, setSelectedVisualBlocks] = useState([]);

  // ── Drag and drop state for reorganizing ingredients/directions ────────────
  const [dragSource, setDragSource] = useState(null); // { field, index, recipeIdx }
  const [dragOverField, setDragOverField] = useState(null); // { field, recipeIdx } — shows which field is drop target
  const [touchDrag, setTouchDrag] = useState(null); // { field, index, recipeIdx, el, startY, currentY }
  const [autoSorting, setAutoSorting] = useState(false);

  // ── Phase 5: Wizard step state ────────────────────────────────────────────
  // step 1 = Source/Paste, step 2 = Review & Edit, step 3 = Save destination
  const [wizardStep, setWizardStep] = useState(1);
  const [collapsedSections, setCollapsedSections] = useState({
    ingredients: false,
    directions: false,
    notes: true,
    caption: true,
  });
  const [showSocialPreview, setShowSocialPreview] = useState(false);
  const [saveDestination, setSaveDestination] = useState(null); // null = auto-detect
  // Drag-to-dismiss touch state
  const dragDismissRef = useRef({ startY: 0, currentY: 0, dragging: false });
  const sheetRef = useRef(null);

  // ── Sync import progress ───────────────────────────────────────────────────
  const API_BASE = import.meta.env.VITE_API_BASE || '';
  // Stage labels — event-driven; wall-clock timers only trigger if real events don't.
  const STAGES = [
    { key: 'scraping',    label: 'Reading the recipe…'     },
    { key: 'fetching',    label: 'Extracting content…'     },
    { key: 'structuring', label: 'Structuring with AI…'    },
    { key: 'saving',      label: 'Almost done…'            },
  ];

  // Map engine onProgress messages → human-friendly labels with ETA hints.
  // Called from the onProgress callback before setImportProgress.
  const friendlyProgress = useCallback((raw = '') => {
    const msg = String(raw).toLowerCase();
    if (msg.includes('apify'))               return 'Fetching caption via Apify… (~5s)';
    if (msg.includes('oembed'))              return 'Trying oEmbed… (~2s)';
    if (msg.includes('embed'))               return 'Parsing Instagram embed…';
    if (msg.includes('caption captured') || msg.includes('apify: caption'))
                                             return 'Caption captured ✔ — structuring…';
    if (msg.includes('gemini') || msg.includes('structuring') || msg.includes('ai'))
                                             return 'Structuring recipe with Gemini… (~8s)';
    if (msg.includes('ocr') || msg.includes('reading text'))
                                             return 'Reading text from image…';
    if (msg.includes('transcrib'))           return 'Transcribing audio… (~15s)';
    if (msg.includes('browser'))             return 'Fetching via browser agent…';
    if (msg.includes('json-ld') || msg.includes('microdata'))
                                             return 'Parsing structured recipe data…';
    if (msg.includes('proxy') || msg.includes('fetch'))
                                             return 'Fetching page…';
    return raw; // fallback to raw message
  }, []);
  const [syncPhase, setSyncPhase] = useState('idle'); // 'idle'|'running'|'success'|'failed'
  const [syncStageIdx, setSyncStageIdx] = useState(0);
  const [syncSuccessName, setSyncSuccessName] = useState('');
  const abortRef = useRef(null);
  const stageTimersRef = useRef([]);
  const capturedTextRef = useRef('');
  const autoImportTriggeredRef = useRef(null);

  // ── Inline misclassification suggestion using classifyWithConfidence ────────
  const getMisplacedHint = useCallback((text, currentField) => {
    if (!text || !text.trim()) return null;
    const [result] = classifyWithConfidence([text]);
    if (!result || result.category === 'skip') return null;
    const expectedField = result.category === 'ingredient' ? 'ingredients' : 'directions';
    // Only suggest if item is in the wrong section AND confidence is meaningful
    if (expectedField !== currentField && result.confidence >= 60) {
      return {
        suggestedField: expectedField,
        confidence: result.confidence,
        reason: result.reason,
        label: expectedField === 'ingredients' ? 'Ingredient?' : 'Step?',
      };
    }
    return null;
  }, []);

  // ── Move item between ingredients ↔ directions ─────────────────────────────
  const moveItemBetweenSections = useCallback((fromField, index, recipeIdx) => {
    if (!preview) return;
    const toField = fromField === 'ingredients' ? 'directions' : 'ingredients';
    const updated = [...preview];
    const sourceList = [...(updated[recipeIdx][fromField] || [])];
    const [item] = sourceList.splice(index, 1);
    const targetList = [...(updated[recipeIdx][toField] || []), item];
    updated[recipeIdx] = { ...updated[recipeIdx], [fromField]: sourceList, [toField]: targetList };
    setPreview(updated);
  }, [preview]);

  // ── Reorder items within a section (↑/↓ arrow buttons) ───────────────────
  const reorderItem = useCallback((field, index, direction, recipeIdx) => {
    if (!preview) return;
    const newIdx = direction === 'up' ? index - 1 : index + 1;
    const updated = [...preview];
    const list = [...(updated[recipeIdx][field] || [])];
    if (newIdx < 0 || newIdx >= list.length) return;
    [list[index], list[newIdx]] = [list[newIdx], list[index]];
    updated[recipeIdx] = { ...updated[recipeIdx], [field]: list };
    setPreview(updated);
  }, [preview]);

  // ── Auto-expand textarea / input on focus & input ─────────────────────────
  const handleAutoExpand = useCallback((e) => {
    const el = e.target;
    el.style.height = 'auto';
    el.style.height = Math.max(el.scrollHeight, 40) + 'px';
  }, []);

  // ── Update a field on a specific recipe in preview ─────────────────────────
  const updateRecipeField = useCallback((recipeIdx, field, value) => {
    setPreview(prev => {
      if (!prev) return prev;
      const updated = [...prev];
      updated[recipeIdx] = { ...updated[recipeIdx], [field]: value };
      return updated;
    });
  }, []);

  // ── Auto-sort: re-classify all items using smartClassifyLines ──────────────
  const handleAutoSort = useCallback((recipeIdx) => {
    if (!preview) return;
    setAutoSorting(true);
    const recipe = preview[recipeIdx];
    const allItems = [
      ...(recipe.ingredients || []),
      ...(recipe.directions || []),
    ].filter(item => item.trim());

    if (allItems.length === 0) { setAutoSorting(false); return; }

    // Use the parser's classification
    const classified = smartClassifyLines(allItems);
    const cleanIngs = normalizeAndDedupe(classified.ingredients);
    const cleanDirs = normalizeAndDedupe(classified.directions);

    const updated = [...preview];
    updated[recipeIdx] = {
      ...updated[recipeIdx],
      ingredients: cleanIngs.length > 0 ? cleanIngs : recipe.ingredients,
      directions: cleanDirs.length > 0 ? cleanDirs : recipe.directions,
    };
    setPreview(updated);
    requestAnimationFrame(() => setTimeout(() => setAutoSorting(false), 400));
  }, [preview]);

  // ── Touch-based drag for mobile ───────────────────────────────────────────
  const handleTouchDragStart = useCallback((e, field, index, recipeIdx) => {
    const touch = e.touches[0];
    const el = e.currentTarget.closest('.preview-editable-row');
    if (el) {
      el.style.opacity = '0.6';
      el.style.transform = 'scale(0.97)';
    }
    setTouchDrag({ field, index, recipeIdx, el, startY: touch.clientY, currentY: touch.clientY });
    setDragSource({ field, index, recipeIdx });
  }, []);

  const handleTouchDragMove = useCallback((e) => {
    if (!touchDrag) return;
    const touch = e.touches[0];
    setTouchDrag(prev => prev ? { ...prev, currentY: touch.clientY } : null);
    // Determine which section we're over
    const els = document.querySelectorAll('.preview-detail-section');
    els.forEach(section => {
      const rect = section.getBoundingClientRect();
      if (touch.clientY >= rect.top && touch.clientY <= rect.bottom) {
        const field = section.dataset.field;
        const recipeIdx = parseInt(section.dataset.recipeIdx || '0');
        if (field) setDragOverField({ field, recipeIdx });
      }
    });
  }, [touchDrag]);

  const handleTouchDragEnd = useCallback(() => {
    if (!touchDrag) return;
    if (touchDrag.el) {
      touchDrag.el.style.opacity = '';
      touchDrag.el.style.transform = '';
    }
    // If dragged to a different section, move the item
    if (dragOverField && dragSource && dragOverField.field !== dragSource.field) {
      moveItemBetweenSections(dragSource.field, dragSource.index, dragSource.recipeIdx);
    }
    setTouchDrag(null);
    setDragSource(null);
    setDragOverField(null);
  }, [touchDrag, dragOverField, dragSource, moveItemBetweenSections]);

  // ── Lock body scroll while modal is open ────────────────────────────────────
  useEffect(() => {
    const origOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = origOverflow; };
  }, []);

  // Abort any in-flight sync fetch when the modal is closed mid-import.
  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      stageTimersRef.current.forEach(clearTimeout);
    };
  }, []);


  // ── Handle shared content from share-target (Android/iOS share sheet) ────────
  useEffect(() => {
    if (sharedContent) {
      if (sharedContent.mode === 'url' && sharedContent.url) {
        setMode('url');
        setUrl(cleanUrl(sharedContent.url));
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
      if (autoImportTriggeredRef.current === sharedContent.url) return;
      autoImportTriggeredRef.current = sharedContent.url;
      const sharedUrl = cleanUrl(sharedContent.url);
      setUrl(sharedUrl);
      if (isSocialMediaUrl(sharedUrl)) {
        setSocialDetected({ platform: getSocialPlatform(sharedUrl) });
        // For social media URLs (Instagram, TikTok, YouTube, etc.) skip the
        // slow 3-pass chain in performUrlExtraction and go straight to
        // BrowserAssist, which runs its own optimised extraction pipeline
        // with live step-by-step progress feedback.
        const timer = setTimeout(() => {
          setBrowserAssistUrl(sharedUrl);
          setBrowserAssistMode('showing');
        }, 80);
        return () => clearTimeout(timer);
      }
      // For non-social shared URLs (recipe blogs, etc.) use the normal path
      setImporting(true);
      setImportProgress('Extracting recipe...');
      const timer = setTimeout(() => {
        handleUrlImport(sharedUrl);
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
    // Re-run type auto-detection on every URL change (unless user overrode it).
    if (!itemTypeUserOverride && val.trim()) {
      try {
        const detected = detectImportType(val.trim(), pasteText || '');
        if (detected && detected !== itemType) setItemType(detected);
      } catch { /* detection is best-effort */ }
    }
  };

  // ── Import from ANY URL ─────────────────────────────────────────────────────
  // Called by the Import button and Enter-key handler.
  const handleUrlImport = async (overrideUrl) => {
    const rawUrl = typeof overrideUrl === 'string' ? overrideUrl : url;
    const trimmedUrl = cleanUrl(rawUrl);
    if (!trimmedUrl) {
      setError('Please enter a URL.');
      return;
    }
    setError('');

    // Detect multiple URLs pasted as newline/space-separated list
    const detectedUrls = trimmedUrl.split(/[\s\n]+/).filter(s => /^https?:\/\//i.test(s));

    if (detectedUrls.length > 1) {
      // Batch mode
      handleBatchImport(detectedUrls);
      return;
    }

    setImporting(true);
    setImportProgress('Fetching recipe...');

    // One AbortController per attempt. The parser owns the 45s global timeout;
    // we hold the controller so Cancel / modal-close can abort in-flight work.
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      // 1. Resolve short URLs
      let resolvedUrl = trimmedUrl;
      if (isShortUrl(resolvedUrl)) {
        try { resolvedUrl = await resolveShortUrl(resolvedUrl); } catch {}
      }

      // 2. Social media → direct to BrowserAssist (its own optimised pipeline).
      //    This is the pattern from e792c8f/1682ed0 that worked reliably.
      //    BrowserAssist runs importFromInstagram internally with live progress,
      //    and falls to iframe on failure — no manual paste ever shown.
      if (isSocialMediaUrl(resolvedUrl)) {
        setImporting(false);
        setImportProgress('');
        setBrowserAssistUrl(resolvedUrl);
        setBrowserAssistMode('showing');
        return;
      }

      // 3. Non-social URLs — run through the unified engine (JSON-LD, CORS proxy,
      //    server extraction, Gemini structuring, global 45s timeout).
      const result = await importRecipeFromUrl(resolvedUrl, (msg) => {
        if (!signal.aborted && msg) setImportProgress(friendlyProgress(msg));
      }, { type: itemType, signal });

      // User cancelled while the engine was running — handleCancelImport already
      // reset the UI; swallow whatever came back.
      if (signal.aborted) return;

      // 3a. Engine needs the in-app browser (non-social fallback for weak results).
      if (result && result._needsBrowserAssist) {
        setImporting(false);
        setImportProgress('');
        setBrowserAssistUrl(result.url || resolvedUrl);
        setBrowserAssistMode('showing');
        setBrowserAssistSeed(result && !result._error ? {
          imageUrl: result.capturedImageUrl || bestImage || undefined,
          capturedTitle: result.capturedTitle || undefined,
          _source: 'web',
        } : null);
        return;
      }

      // 2b. Engine reported a structured failure — pick copy from the reason.
      if (result && result._error) {
        setImporting(false);
        setImportProgress('');
        const { msg, recovery } = errorCopyForReason(result.reason);
        setError(msg);
        setErrorRecovery(recovery);
        return;
      }

      // 2c. Nothing came back at all.
      if (!result) {
        setImporting(false);
        setImportProgress('');
        setError("We couldn't read a recipe from this link.");
        setErrorRecovery('browser');
        // Offer the in-app browser as a recovery path for the entered URL.
        setBrowserAssistUrl(resolvedUrl);
        setBrowserAssistMode('showing');
        return;
      }

      // 2d. Success — populate the editor, tagged with the item type so the
      //     preview shows the right fields (glass/garnish for drinks, etc.).
      setPreview([{ ...result, _type: result._type || itemType }]);
    } catch (e) {
      // Aborts surface as exceptions in some fetch paths — treat as a clean cancel.
      if (signal.aborted || e?.name === 'AbortError') {
        setImporting(false);
        setImportProgress('');
        return;
      }
      setError('Import failed: ' + (e?.message || 'Unknown error'));
      // Fallback to the in-app browser so the user can still pick the recipe.
      setImporting(false);
      setImportProgress('');
      setBrowserAssistUrl(trimmedUrl);
      setBrowserAssistMode('showing');
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
    }

    setImporting(false);
    setImportProgress('');
  };

  // Map a parser `_error` reason code to inviting, actionable user-facing copy.
  const errorCopyForReason = (reason) => {
    switch (reason) {
      case 'timeout':
        return { msg: "Import timed out — the site may be slow or blocking us.", recovery: 'browser' };
      case 'photo_unreadable':
        return { msg: "Couldn't read the recipe from that image.", recovery: 'photo' };
      case 'blocked':
      case 'proxy_blocked':
        return { msg: "This site is blocking automatic imports.", recovery: 'browser' };
      case 'not_a_recipe':
        return { msg: "We couldn't find a recipe on this page.", recovery: 'paste' };
      default:
        return { msg: "We couldn't read a recipe from this link.", recovery: 'browser' };
    }
  };
  const [errorRecovery, setErrorRecovery] = useState(null); // 'browser'|'photo'|'paste'|null

  // ── Cancel an in-flight sync import ──────────────────────────────────────────
  const handleCancelImport = useCallback(() => {
    abortRef.current?.abort();
    stageTimersRef.current.forEach(clearTimeout);
    setSyncPhase('idle');
    setSyncStageIdx(0);
    setImporting(false);
    setImportProgress('');
  }, []);

  // ── Close handler — always wipes transient import state before closing ──────
  // This prevents state from a previous import attempt bleeding through when the
  // modal is closed and reopened (e.g., lingering BrowserAssist URL, error messages,
  // sync phase state).
  const handleClose = useCallback(() => {
    capturedTextRef.current = '';
    setBrowserAssistUrl(null);
    setBrowserAssistMode('off');
    setBrowserAssistSeed(null);
    setSelectedVisualBlocks([]);
    setSyncPhase('idle');
    setSyncStageIdx(0);
    setError('');
    setErrorRecovery(null);
    setWizardStep(1);
    setImporting(false);
    setImportProgress('');
    onClose();
  }, [onClose]);

  // ── Browser Assist callbacks ───────────────────────────────────────────────────
  const handleBrowserAssistRecipe = (recipe) => {
    if (recipe) {
      // Recipe successfully extracted from visible page — clear any stale error toast
      setError('');

      // Auto-sort immediately so user sees a clean ingredient / direction split
      // without having to press the ⚡ Auto-Sort button manually.
      let finalRecipe = recipe;
      const allItems = [
        ...(recipe.ingredients || []),
        ...(recipe.directions  || []),
      ].filter(item => item && item.trim());
      if (allItems.length > 0) {
        try {
          const classified = smartClassifyLines(allItems);
          const cleanIngs  = normalizeAndDedupe(classified.ingredients);
          const cleanDirs  = normalizeAndDedupe(classified.directions);
          if (cleanIngs.length > 0 || cleanDirs.length > 0) {
            finalRecipe = {
              ...recipe,
              ingredients: cleanIngs.length > 0 ? cleanIngs : recipe.ingredients,
              directions:  cleanDirs.length > 0 ? cleanDirs : recipe.directions,
            };
          }
        } catch { /* non-fatal — keep original if classifier throws */ }
      }

      setPreview([finalRecipe]);
      setBrowserAssistMode('off');
      setSyncPhase('idle');
    }
  };

  const handleBrowserAssistFallback = () => {
    // User backed out of BrowserAssist — clear pipeline state fully so a second
    // import attempt doesn't carry stale URL / importing flags.
    setBrowserAssistMode('off');
    setBrowserAssistUrl(null);
    setBrowserAssistSeed(null);
    setSyncPhase('idle');
    setSyncStageIdx(0);
    setImporting(false);
    setImportProgress('');
    setSocialDetected(null);
    // Switch to Paste Text and pre-fill the source URL for manual entry
    setMode('paste');
    setPasteLink(url);
    setUrl(''); // clear URL field so user must re-enter to try again
    setError('');
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

      // Auto-detect pasted URLs (split on whitespace/newlines, keep only http/https)
      const pastedUrls = pasted.split(/[\s\n]+/).filter(s => /^https?:\/\//i.test(s));
      if (pastedUrls.length === 1) {
        // Single URL pasted — auto-fill and start import
        // cleanUrl de-duplicates doubled URLs that mobile share sheets sometimes produce
        setUrl(cleanUrl(pastedUrls[0]));
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
      _type: itemType, // respect the Meal/Drink toggle the user has selected
    };
    // If parser couldn't split, put everything in directions
    if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
      const lines = pasteText.trim().split('\n').map(l => l.trim()).filter(l => l.length > 1);
      recipe.directions = lines.length > 0 ? lines : ['See pasted text for details'];
    }
    setPreview([recipe]);
  };

  // ── Image import — Gemini Vision first, Tesseract OCR fallback ──────────────
  const handleImageUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    setError('');
    setImportProgress('Reading image…');

    try {
      // Capture original photo data URL — always stored as the recipe image
      const imageDataUrl = await fileToDataUrl(file);

      // ── Path 1: Gemini Vision (preferred — understands both text and food photos) ──
      const hasGeminiKey = !!import.meta.env?.VITE_GOOGLE_AI_KEY;
      if (hasGeminiKey) {
        setImportProgress('Analyzing image with AI…');
        const geminiResult = await structureRecipeFromImage(imageDataUrl, {
          type: itemType, // respect the meal/drink toggle the user has selected
        });

        if (geminiResult && (geminiResult.ingredients?.length > 0 || geminiResult.directions?.length > 0)) {
          // Gemini succeeded — always attach the original photo
          const recipe = { ...geminiResult, imageUrl: imageDataUrl };
          setPreview([recipe]);
          setImporting(false);
          setImportProgress('');
          e.target.value = '';
          return;
        }
        // Gemini returned empty/error — fall through to OCR
        setImportProgress('AI analysis inconclusive, trying text recognition…');
      }

      // ── Path 2: Tesseract OCR fallback ─────────────────────────────────────
      // Only used when Gemini is not configured or fails to find a recipe.
      const processedImage = await preprocessImageForOCR(file);

      setImportProgress('Loading text recognition…');
      const Tesseract = await import('tesseract.js');

      setImportProgress('Reading text from image…');
      const result = await Tesseract.recognize(
        processedImage,
        'eng',
        {
          logger: m => {
            if (m.status === 'recognizing text') {
              const pct = Math.round((m.progress || 0) * 100);
              setImportProgress(`Reading text… ${pct}%`);
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

      const cleanedText = cleanOcrText(ocrText);

      setImportProgress('Parsing recipe…');
      const parsed = parseCaption(cleanedText);

      const recipe = {
        name: parsed.title || 'Recipe from Photo',
        ingredients: parsed.ingredients.length > 0 ? parsed.ingredients : [],
        directions: parsed.directions.length > 0 ? parsed.directions : [],
        imageUrl: imageDataUrl,
        link: '',
      };

      if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
        const lines = cleanedText.split('\n').map(l => l.trim()).filter(l => l.length > 2);
        if (lines.length > 0) classifyOcrLines(lines, recipe);
        if (recipe.ingredients.length === 0 && recipe.directions.length === 0) {
          recipe.directions = lines.length > 0 ? lines : ['See photo for recipe details'];
        }
      }

      setPreview([recipe]);
    } catch (err) {
      console.error('[SpiceHub] Photo import error:', err);
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

  // destination: 'auto' | 'drinks' | 'meals' | 'grocery' | 'week'
  // 'auto' defers to showImportFor in App.jsx (the default pre-share behaviour)
  const confirmImport = (destination = 'auto') => {
    if (!preview) return;
    // Accept any recipe that has a name, real content, or is a side-dish addendum.
    const valid = preview.filter(m =>
      m && (m.name || m._isAddendum || (m.ingredients?.length > 0) || (m.directions?.length > 0))
    );
    if (!valid.length) return;
    const recipes = valid.map(m => ({
      ...m,
      name: m.name || (m._isAddendum ? (m._addendumLabel || 'Side Dish') : 'Untitled Recipe'),
      ingredients: m.ingredients?.length ? m.ingredients : [],
      directions: m.directions?.length ? m.directions : [],
      notes: m.notes || '',
      importedAt: m.importedAt || new Date().toISOString(),
    }));
    // Pass destination to App.jsx handleImport; 'auto' means use showImportFor default
    onImport(recipes, destination === 'auto' ? undefined : destination);
  };

  // ── Detect if the current preview looks like a drink recipe ──────────────
  // Used by the Smart Action Bar to highlight the most-likely correct destination.
  const DRINK_RX = /\b(cocktail|drink|bar\b|bartend|beer|wine|whiskey|whisky|bourbon|vodka|rum\b|gin\b|tequila|mezcal|margarita|martini|negroni|mojito|spritz|mocktail|mixolog|booze|aperol|campari|daiquiri|paloma|highball|sour\b|mule\b|sling\b|punch\b|nightcap|bitters|liqueur|schnapps)\b/i;
  const previewLooksDrink = preview?.length > 0 && (
    DRINK_RX.test(preview[0]?.name || '') ||
    DRINK_RX.test((preview[0]?.ingredients || []).join(' ')) ||
    DRINK_RX.test(preview[0]?.notes || '') ||
    DRINK_RX.test(sharedContent?.title || '') ||
    DRINK_RX.test(sharedContent?.text || '')
  );

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
    if (!dragSource || dragSource.field !== field) return; // cross-section uses arrow buttons, not drag

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

  // Auto-advance wizard when preview is populated or cleared
  useEffect(() => {
    if (preview && preview.length > 0 && wizardStep < 2) setWizardStep(2);
    if (!preview && wizardStep > 1) setWizardStep(1);
  }, [preview]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Drag-to-dismiss handlers ─────────────────────────────────────────────
  const handleGrabTouchStart = useCallback((e) => {
    dragDismissRef.current = { startY: e.touches[0].clientY, currentY: 0, dragging: true };
  }, []);

  const handleGrabTouchMove = useCallback((e) => {
    if (!dragDismissRef.current.dragging) return;
    const dy = e.touches[0].clientY - dragDismissRef.current.startY;
    if (dy < 0) return; // only downward swipe
    dragDismissRef.current.currentY = dy;
    if (sheetRef.current) sheetRef.current.style.transform = `translateY(${Math.min(dy, 180)}px)`;
  }, []);

  const handleGrabTouchEnd = useCallback(() => {
    if (!dragDismissRef.current.dragging) return;
    const dy = dragDismissRef.current.currentY;
    if (sheetRef.current) sheetRef.current.style.transform = '';
    dragDismissRef.current = { startY: 0, currentY: 0, dragging: false };
    if (dy > 80) handleClose();
  }, [handleClose]);

  const toggleSection = useCallback((key) => {
    setCollapsedSections(prev => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div
        ref={sheetRef}
        className={`modal-content import-modal wizard-sheet${preview ? ' has-preview-screen' : ''}${browserAssistMode === 'showing' ? ' browser-assist-open' : ''}`}
        onClick={e => e.stopPropagation()}
        style={{ transition: 'transform 0.25s cubic-bezier(0.32,0.72,0,1)' }}
      >
        {/* ── Grab handle — drag down to dismiss ───────────────────────────── */}
        <div
          className="wizard-grab-handle"
          onTouchStart={handleGrabTouchStart}
          onTouchMove={handleGrabTouchMove}
          onTouchEnd={handleGrabTouchEnd}
          aria-label="Drag down to close"
          role="button"
        >
          <div className="wizard-grab-bar" />
        </div>

        {/* ── Sticky header with step rail ─────────────────────────────────── */}
        <div className="wizard-header">
          <div className="wizard-header-row">
            <h2 className="wizard-title">
              {wizardStep === 1 && (importing ? 'Importing…' : title)}
              {wizardStep === 2 && 'Review & Edit'}
              {wizardStep === 3 && 'Save Recipe'}
            </h2>
            <button className="btn-icon wizard-close-btn" onClick={handleClose} aria-label="Close">✕</button>
          </div>
          {/* Step rail */}
          {browserAssistMode !== 'showing' && (
            <div className="wizard-step-rail">
              {[{n:1,label:'Source'},{n:2,label:'Review'},{n:3,label:'Save'}].map(({n,label},i) => (
                <div key={n} className="wizard-rail-node">
                  <button
                    className={`wizard-rail-dot${wizardStep === n ? ' active' : ''}${wizardStep > n ? ' done' : ''}`}
                    onClick={() => { if (n === 1 && preview) { setPreview(null); setWizardStep(1); } else if (n <= wizardStep) setWizardStep(n); }}
                    aria-label={`Step ${n}: ${label}`}
                    disabled={n > wizardStep}
                  >
                    {wizardStep > n ? '✓' : n}
                  </button>
                  <span className={`wizard-rail-label${wizardStep === n ? ' active' : ''}`}>{label}</span>
                  {i < 2 && <div className={`wizard-rail-bar${wizardStep > n ? ' done' : ''}`} />}
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <div className="error-bar error-bar--recovery">
            <span className="error-bar-msg">{error}</span>
            <div className="error-bar-actions">
              {errorRecovery === 'browser' && (
                <button className="error-recovery-btn" onClick={() => {
                  setError(''); setErrorRecovery(null);
                  setBrowserAssistUrl(url || pasteLink);
                  setBrowserAssistMode('showing');
                }}>Try Browser Assist</button>
              )}
              {errorRecovery === 'photo' && (
                <button className="error-recovery-btn" onClick={() => {
                  setError(''); setErrorRecovery(null); setMode('image'); imageRef.current?.click();
                }}>Retry with Photo</button>
              )}
              {(errorRecovery === 'paste' || errorRecovery === 'browser') && (
                <button className="error-recovery-btn" onClick={() => {
                  setError(''); setErrorRecovery(null); setMode('paste');
                }}>Manual Entry</button>
              )}
              <button className="btn-icon small" onClick={() => { setError(''); setErrorRecovery(null); }} style={{ marginLeft: 4 }}>✕</button>
            </div>
          </div>
        )}

        {browserAssistMode === 'showing' ? (
          <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* Fallback breadcrumb — shown when BrowserAssist is a fallback after a failed sync import */}
            <div className="ba-fallback-header">
              <button
                className="ba-back-btn"
                onClick={() => {
                  setBrowserAssistMode('off');
                  setBrowserAssistUrl(null);
                  setSyncPhase('idle');
                  setSyncStageIdx(0);
                  capturedTextRef.current = '';
                }}
              >
                ← Try a different URL
              </button>
              <span className="ba-fallback-reason">Trying deeper extraction…</span>
            </div>
            <BrowserAssist
              ref={browserAssistRef}
              url={browserAssistUrl}
              onRecipeExtracted={handleBrowserAssistRecipe}
              onFallbackToText={handleBrowserAssistFallback}
              initialCapturedText={capturedTextRef.current}
              seedRecipe={browserAssistSeed}
              type={itemType}
              onError={(err) => {
                // Visual scrape failed — show a warning toast so user knows
                // we're falling back to text extraction automatically.
                console.warn('[ImportModal] BrowserAssist visual error:', err.message);
                // If the modal has a toast mechanism, surface it; otherwise log only.
                // (setError would block the UI; a non-blocking warning is better here.)
              }}
              onBlocksSelected={(ids) => {
                // Store selected block IDs for future "refine selected blocks" UX.
                setSelectedVisualBlocks(ids);
              }}
              defaultVisualMode={isSocialMediaUrl(browserAssistUrl || '')}
            />
          </div>
        ) : preview ? (
          /* ── Preview screen (full detail + editable) ──────────────────────── */
          wizardStep === 3 ? (
          /* ── Step 3: Save destination ─────────────────────────────────── */
          <>
            <div className="wizard-body wizard-save-step">
              {(() => {
                const m = preview[0];
                const destInfo = saveDestination || (previewLooksDrink ? 'bar' : 'library');
                const conf = m?._confidence != null ? Math.round(m._confidence * 100) : scoreExtractionConfidence(m);
                const ingCount = m?.ingredients?.length ?? 0;
                const dirCount = m?.directions?.length ?? 0;
                return (
                  <>
                    {/* Compact summary card */}
                    <div className="save-summary-card">
                      {m?.imageUrl ? (
                        <div className="save-summary-thumb" style={{ backgroundImage: `url(${m.imageUrl})` }} />
                      ) : (
                        <div className="save-summary-thumb save-summary-thumb--empty">
                          {previewLooksDrink ? '🍸' : '🍽️'}
                        </div>
                      )}
                      <div className="save-summary-info">
                        <strong className="save-summary-name">{m?.name || 'Imported Recipe'}</strong>
                        <span className="save-summary-meta">
                          {ingCount > 0 && `${ingCount} ingredient${ingCount !== 1 ? 's' : ''}`}
                          {ingCount > 0 && dirCount > 0 && ' · '}
                          {dirCount > 0 && `${dirCount} step${dirCount !== 1 ? 's' : ''}`}
                          {conf > 0 && ` · ${conf >= 70 ? '✓' : conf >= 40 ? '◎' : '⚠'} ${conf}% match`}
                        </span>
                      </div>
                      <button
                        className="save-summary-edit-btn"
                        onClick={() => setWizardStep(2)}
                        title="Go back and edit"
                      >✎</button>
                    </div>

                    {/* Destination grid */}
                    <p className="save-dest-label">Save to</p>
                    <div className="save-dest-grid">
                      {[
                        { id: 'library', icon: previewLooksDrink ? '🍸' : '📚', label: previewLooksDrink ? 'The Bar' : 'Library', desc: 'Main recipe library' },
                        { id: 'week',    icon: '📅', label: 'This Week', desc: 'Add to meal plan' },
                        { id: 'grocery', icon: '🛒', label: 'Grocery',   desc: 'Add to grocery list' },
                        { id: 'meals',   icon: '🍳', label: previewLooksDrink ? 'Meals' : 'The Bar', desc: previewLooksDrink ? 'Save as a meal instead' : 'Save to bar instead' },
                      ].map(d => (
                        <button
                          key={d.id}
                          className={`save-dest-card${destInfo === d.id ? ' selected' : ''}`}
                          onClick={() => setSaveDestination(d.id)}
                        >
                          <span className="save-dest-icon">{d.icon}</span>
                          <strong className="save-dest-name">{d.label}</strong>
                          <span className="save-dest-desc">{d.desc}</span>
                        </button>
                      ))}
                    </div>
                  </>
                );
              })()}
            </div>

            {/* ── Step 3 wizard footer: Back + Save ─────────────────────────── */}
            <div className="wizard-footer">
              <button className="wizard-btn-ghost" onClick={() => setWizardStep(2)}>{'←'} Back</button>
              <button
                className="wizard-btn-primary"
                onClick={() => {
                  const dest = saveDestination || (previewLooksDrink ? 'drinks' : 'auto');
                  confirmImport(dest);
                }}
              >
                {previewLooksDrink ? '🍸 Save to Bar' : '✓ Save to Library'}
              </button>
            </div>
          </>
        ) : (
          <>
          <div className="wizard-body wizard-review-step">
            <div className="preview-detail-list">
                {preview.map((m, idx) => {
                  return (
                  <div key={idx} className="preview-detail-card">
                  {m._isAddendum && (
                    <div className="addendum-badge">＋ {m._addendumLabel || 'Side / Sauce'}</div>
                  )}

                  {/* ── Hero image with title overlay ─────────────────────── */}
                  {(() => {
                    const conf = m._confidence != null ? Math.round(m._confidence * 100) : scoreExtractionConfidence(m);
                    const confLevel = conf >= 70 ? 'high' : conf >= 40 ? 'medium' : 'low';
                    const confLabel = conf >= 70 ? '✓ High confidence' : conf >= 40 ? '◎ Good match' : '⚠ Low confidence';
                    return m.imageUrl ? (
                      <div className="review-hero">
                        <img
                          src={m.imageUrl}
                          alt=""
                          className="review-hero-img"
                          onError={e => {
                            const attempt = parseInt(e.target.dataset.proxied || '0');
                            const enc = encodeURIComponent(m.imageUrl);
                            const proxies = [
                              `https://images.weserv.nl/?url=${enc}&w=800&output=jpg&q=85`,
                              `https://corsproxy.io/?url=${enc}`,
                              `https://api.allorigins.win/raw?url=${enc}`,
                            ];
                            if (attempt < proxies.length) { e.target.dataset.proxied = String(attempt + 1); e.target.src = proxies[attempt]; }
                            else e.target.style.display = 'none';
                          }}
                        />
                        <div className="review-hero-grad" />
                        <span className={`review-conf-chip review-conf-${confLevel}`}>{confLabel}</span>
                        <div className="review-hero-title-wrap">
                          <input
                            type="text"
                            className="review-hero-title-input"
                            value={m.name}
                            placeholder="Recipe name"
                            onChange={e => {
                              const updated = [...preview];
                              updated[idx] = { ...updated[idx], name: e.target.value };
                              setPreview(updated);
                            }}
                          />
                        </div>
                        {/* Auto-sort button in hero */}
                        <button
                          className={`review-hero-autosort${autoSorting ? ' sorting' : ''}`}
                          onClick={() => handleAutoSort(idx)}
                          disabled={autoSorting}
                          title="Re-classify ingredients vs. steps"
                        >{autoSorting ? '✓' : '⚡'}</button>
                      </div>
                    ) : (
                      /* No image — flat title row */
                      <div className="review-title-flat">
                        <div className={`review-conf-chip review-conf-${confLevel} review-conf-inline`}>{confLabel}</div>
                        <input
                          type="text"
                          className="preview-title-input"
                          value={m.name}
                          placeholder="Recipe name"
                          autoFocus={idx === 0}
                          onChange={e => {
                            const updated = [...preview];
                            updated[idx] = { ...updated[idx], name: e.target.value };
                            setPreview(updated);
                          }}
                        />
                        <button
                          className={`btn-auto-sort${autoSorting ? ' sorting' : ''}`}
                          onClick={() => handleAutoSort(idx)}
                          disabled={autoSorting}
                          title="Re-classify items"
                        >{autoSorting ? '✓ Sorted!' : '⚡ Auto-Sort'}</button>
                      </div>
                    );
                  })()}

                  {/* Carousel image picker — shown when multiple images were extracted */}
                  {m.imageUrls && m.imageUrls.length > 1 && (
                    <div className="carousel-picker">
                      <label className="preview-label">
                        <span className="preview-label-icon">🖼</span>
                        Choose Photo ({m.imageUrls.length} found)
                      </label>
                      <div className="carousel-picker-strip">
                        {m.imageUrls.map((imgUrl, imgIdx) => (
                          <button
                            key={imgIdx}
                            className={`carousel-picker-thumb ${m.imageUrl === imgUrl ? 'selected' : ''}`}
                            onClick={() => {
                              const updated = [...preview];
                              updated[idx] = { ...updated[idx], imageUrl: imgUrl };
                              setPreview(updated);
                            }}
                            title={`Select photo ${imgIdx + 1}`}
                          >
                            <img
                              src={`https://images.weserv.nl/?url=${encodeURIComponent(imgUrl)}&w=80&h=80&fit=cover&output=jpg`}
                              alt={`Slide ${imgIdx + 1}`}
                              onError={e => { e.target.src = ''; e.target.closest('button')?.classList.add('broken'); }}
                            />
                            {m.imageUrl === imgUrl && <span className="carousel-check">✓</span>}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* ── Original caption accordion ─────────────────────────── */}
                  {(m.capturedCaption || m._rawCaption) && (
                    <div className={`review-accordion${collapsedSections.caption ? ' collapsed' : ''}`}>
                      <button className="review-acc-head" onClick={() => toggleSection('caption')}>
                        <span className="review-acc-title">📄 Original caption</span>
                        <span className="review-acc-chev">{collapsedSections.caption ? '▸' : '▾'}</span>
                      </button>
                      {!collapsedSections.caption && (
                        <div className="review-acc-body">
                          <pre className="review-caption-pre">{m.capturedCaption || m._rawCaption}</pre>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ── Type toggle (Meal / Drink) ─────────────────────────── */}

                  {/* ── Ingredients accordion ─────────────────────────────── */}
                  <div className={`review-accordion${collapsedSections.ingredients ? ' collapsed' : ''}`}>
                    <button className="review-acc-head" onClick={() => toggleSection('ingredients')}>
                      <div className="review-acc-head-left">
                        <span className="review-acc-dot review-acc-dot--green" />
                        <span className="review-acc-title">Ingredients</span>
                        <span className="review-acc-count">{m.ingredients?.length ?? 0}</span>
                      </div>
                      <div className="review-acc-head-right">
                        <button className={`btn-auto-sort review-acc-sort${autoSorting ? ' sorting' : ''}`} onClick={(e) => { e.stopPropagation(); handleAutoSort(idx); }} disabled={autoSorting} title="Auto-sort">⚡</button>
                        <span className="review-acc-chev">{collapsedSections.ingredients ? '▸' : '▾'}</span>
                      </div>
                    </button>
                    {!collapsedSections.ingredients && (
                      <div className="review-acc-body">
                      {/* Ingredients (editable list with move buttons) */}
                      <div
                        className={`preview-detail-section ${dragOverField?.field === 'ingredients' && dragOverField?.recipeIdx === idx ? 'drop-active' : ''}`}
                        data-field="ingredients"
                        data-recipe-idx={idx}
                        onDragOver={(e) => handleDragOver('ingredients', idx, e)}
                        onDrop={(e) => handleDrop('ingredients', (m.ingredients || []).length, idx, e)}
                        onDragLeave={() => setDragOverField(null)}
                      >
                        <label className="preview-label">
                          <span className="preview-label-icon">🥕</span>
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
                                opacity: dragSource?.field === 'ingredients' && dragSource?.recipeIdx === idx && dragSource?.index === ingIdx ? 0.4 : 1
                              }}
                            >
                              <span
                                className="drag-handle"
                                title="Drag to reorder"
                                aria-label="Drag to reorder"
                                role="button"
                                onTouchStart={(e) => handleTouchDragStart(e, 'ingredients', ingIdx, idx)}
                                onTouchMove={handleTouchDragMove}
                                onTouchEnd={handleTouchDragEnd}
                              />
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
                              {(() => {
                                const hint = getMisplacedHint(ing, 'ingredients');
                                if (!hint) return null;
                                return (
                                  <button
                                    className={`misplaced-hint misplaced-hint-${hint.confidence >= 80 ? 'high' : 'medium'}`}
                                    title={`${hint.reason} (${hint.confidence}% confidence)`}
                                    onClick={() => moveItemBetweenSections('ingredients', ingIdx, idx)}
                                  >{hint.label} ↓</button>
                                );
                              })()}
                              <button
                                className="preview-move-btn"
                                onClick={() => moveItemBetweenSections('ingredients', ingIdx, idx)}
                                title="Move to Steps"
                                aria-label="Move to Steps"
                              >↓</button>
                              <button
                                className="preview-reorder-btn"
                                onClick={() => reorderItem('ingredients', ingIdx, 'up', idx)}
                                disabled={ingIdx === 0}
                                title="Move ingredient up"
                                aria-label="Move ingredient up"
                              >↑</button>
                              <button
                                className="preview-reorder-btn"
                                onClick={() => reorderItem('ingredients', ingIdx, 'down', idx)}
                                disabled={ingIdx >= (m.ingredients?.length ?? 1) - 1}
                                title="Move ingredient down"
                                aria-label="Move ingredient down"
                              >↓</button>
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
                        {(m.ingredients || []).length === 0 && (
                          <div className="preview-empty-drop">⬇ Drop ingredients here · or tap <strong>+ Add</strong></div>
                        )}
                      </div>
                      </div>
                    )}
                  </div>

                  {/* ── Directions accordion ──────────────────────────────── */}
                  <div className={`review-accordion${collapsedSections.directions ? ' collapsed' : ''}`}>
                    <button className="review-acc-head" onClick={() => toggleSection('directions')}>
                      <div className="review-acc-head-left">
                        <span className="review-acc-dot review-acc-dot--amber" />
                        <span className="review-acc-title">Steps</span>
                        <span className="review-acc-count">{m.directions?.length ?? 0}</span>
                      </div>
                      <span className="review-acc-chev">{collapsedSections.directions ? '▸' : '▾'}</span>
                    </button>
                    {!collapsedSections.directions && (
                      <div className="review-acc-body">
                      {/* Directions (editable list with move buttons) */}
                      <div
                        className={`preview-detail-section ${dragOverField?.field === 'directions' && dragOverField?.recipeIdx === idx ? 'drop-active' : ''}`}
                        data-field="directions"
                        data-recipe-idx={idx}
                        onDragOver={(e) => handleDragOver('directions', idx, e)}
                        onDrop={(e) => handleDrop('directions', (m.directions || []).length, idx, e)}
                        onDragLeave={() => setDragOverField(null)}
                      >
                        <label className="preview-label">
                          <span className="preview-label-icon">📝</span>
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
                                opacity: dragSource?.field === 'directions' && dragSource?.recipeIdx === idx && dragSource?.index === stepIdx ? 0.4 : 1
                              }}
                            >
                              <span
                                className="drag-handle"
                                title="Drag to reorder"
                                aria-label="Drag to reorder"
                                role="button"
                                onTouchStart={(e) => handleTouchDragStart(e, 'directions', stepIdx, idx)}
                                onTouchMove={handleTouchDragMove}
                                onTouchEnd={handleTouchDragEnd}
                              />
                              <span className="preview-step-num">{stepIdx + 1}</span>
                              <textarea
                                value={step}
                                placeholder="Describe this step..."
                                rows={2}
                                onFocus={handleAutoExpand}
                                onInput={handleAutoExpand}
                                onChange={e => {
                                  const updated = [...preview];
                                  const dirs = [...(updated[idx].directions || [])];
                                  dirs[stepIdx] = e.target.value;
                                  updated[idx] = { ...updated[idx], directions: dirs };
                                  setPreview(updated);
                                }}
                              />
                              {(() => {
                                const hint = getMisplacedHint(step, 'directions');
                                if (!hint) return null;
                                return (
                                  <button
                                    className={`misplaced-hint misplaced-hint-${hint.confidence >= 80 ? 'high' : 'medium'}`}
                                    title={`${hint.reason} (${hint.confidence}% confidence)`}
                                    onClick={() => moveItemBetweenSections('directions', stepIdx, idx)}
                                  >{hint.label} ↑</button>
                                );
                              })()}
                              <button
                                className="preview-move-btn"
                                onClick={() => moveItemBetweenSections('directions', stepIdx, idx)}
                                title="Move to Ingredients"
                                aria-label="Move to Ingredients"
                              >↑</button>
                              <button
                                className="preview-reorder-btn"
                                onClick={() => reorderItem('directions', stepIdx, 'up', idx)}
                                disabled={stepIdx === 0}
                                title="Move step up"
                                aria-label="Move step up"
                              >↑</button>
                              <button
                                className="preview-reorder-btn"
                                onClick={() => reorderItem('directions', stepIdx, 'down', idx)}
                                disabled={stepIdx >= (m.directions?.length ?? 1) - 1}
                                title="Move step down"
                                aria-label="Move step down"
                              >↓</button>
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
                        {(m.directions || []).length === 0 && (
                          <div className="preview-empty-drop">⬇ Drop steps here · or tap <strong>+ Add</strong></div>
                        )}
                      </div>

                      </div>
                    )}
                  </div>

                  {/* Drink-specific fields: glass + garnish */}
                  {m._type === 'drink' && (
                    <div className="preview-detail-section preview-drink-meta">
                      <label className="preview-label">
                        <span className="preview-label-icon">🥃</span> Glass &amp; Garnish
                      </label>
                      <div className="preview-drink-fields">
                        <div className="preview-drink-field">
                          <span className="preview-drink-field-label">Glass</span>
                          <input
                            type="text"
                            className="preview-drink-input"
                            placeholder="e.g. coupe, rocks, highball…"
                            value={m.glass || ''}
                            onChange={e => {
                              const updated = [...preview];
                              updated[idx] = { ...updated[idx], glass: e.target.value };
                              setPreview(updated);
                            }}
                          />
                        </div>
                        <div className="preview-drink-field">
                          <span className="preview-drink-field-label">Garnish</span>
                          <input
                            type="text"
                            className="preview-drink-input"
                            placeholder="e.g. lime wheel, orange peel…"
                            value={m.garnish || ''}
                            onChange={e => {
                              const updated = [...preview];
                              updated[idx] = { ...updated[idx], garnish: e.target.value };
                              setPreview(updated);
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  )}

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

                  {/* ── Notes accordion ────────────────────────────────── */}
                  <div className={`review-accordion${collapsedSections.notes ? ' collapsed' : ''}`}>
                    <button className="review-acc-head" onClick={() => toggleSection('notes')}>
                      <div className="review-acc-head-left">
                        <span className="review-acc-title">📝 Notes</span>
                      </div>
                      <span className="review-acc-chev">{collapsedSections.notes ? '▸' : '▾'}</span>
                    </button>
                    {!collapsedSections.notes && (
                      <div className="review-acc-body">
                      {/* Notes — auto-expand on tap, drag items in, free-form extras */}
                      <div
                        className={`preview-detail-section preview-notes-section ${dragOverField?.field === 'notes' && dragOverField?.recipeIdx === idx ? 'drop-active' : ''}`}
                        data-field="notes"
                        data-recipe-idx={idx}
                        onDragOver={(e) => handleDragOver('notes', idx, e)}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (!dragSource) return;
                          const { field: srcField, index: srcIdx, recipeIdx: srcRecipeIdx } = dragSource;
                          const updated = [...preview];
                          const sourceItems = [...(updated[srcRecipeIdx][srcField] || [])];
                          const [movedItem] = sourceItems.splice(srcIdx, 1);
                          updated[srcRecipeIdx] = { ...updated[srcRecipeIdx], [srcField]: sourceItems };
                          const currentNotes = updated[idx].notes || '';
                          updated[idx] = { ...updated[idx], notes: currentNotes ? `${currentNotes}\n${movedItem}` : movedItem };
                          setPreview(updated);
                          setDragSource(null);
                          setDragOverField(null);
                        }}
                        onDragLeave={() => setDragOverField(null)}
                      >
                        <label className="preview-label">
                          <span className="preview-label-icon">📋</span>
                          Notes
                          <span className="preview-notes-hint">— tap to expand · drag items here</span>
                        </label>
                        <textarea
                          className="preview-notes-textarea"
                          value={m.notes || ''}
                          placeholder="Extra info, chef's tips, variations, or anything that didn't fit above…"
                          rows={1}
                          onFocus={handleAutoExpand}
                          onInput={handleAutoExpand}
                          onChange={e => updateRecipeField(idx, 'notes', e.target.value)}
                        />
                      </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
            </div>{/* end preview-detail-list */}

            <div className="preview-addendum-bar">
              <button
                className="btn-add-addendum"
                title="Add a linked side dish, sauce, or sub-recipe"
                onClick={() => {
                  setPreview(prev => [
                    ...(prev || []),
                    {
                      name: '',
                      ingredients: [],
                      directions: [],
                      notes: '',
                      imageUrl: '',
                      link: prev?.[0]?.link || '',
                      _isAddendum: true,
                      _addendumLabel: 'Side / Sauce',
                    },
                  ]);
                }}
              >
                ＋ Add Side / Sauce Recipe
              </button>
            </div>
          </div>
          {/* end wizard-review-step */}

        {/* ── Wizard footer: Back ← step 2 | Looks good → step 3 ─────────── */}
        {wizardStep === 2 && (
          <div className="wizard-footer">
            <button className="wizard-btn-ghost" onClick={() => {
              setPreview(null); setUrl(''); setImporting(false); setImportProgress('');
              setBrowserAssistMode('off'); setBrowserAssistUrl(null); setSocialDetected(null); setError('');
              setWizardStep(1);
            }}>{'←'} Back</button>
            <button className="wizard-btn-primary" onClick={() => setWizardStep(3)}>
              Looks good {'→'}
            </button>
          </div>
        )}
      </>
    )) : (
          <div className="wizard-step1-body">
            {/* ── Tab bar — 3 primary + overflow ───────────────────────────── */}
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
              {/* ⋯ overflow — reveals Spreadsheet and Paprika on demand */}
              <button
                className={['spreadsheet', 'paprika'].includes(mode) ? 'active import-tabs-more' : 'import-tabs-more'}
                onClick={() => {
                  const next = mode === 'spreadsheet' ? 'paprika' : 'spreadsheet';
                  setMode(next);
                  setSocialDetected(null);
                  setError('');
                }}
                title="More import options (Spreadsheet, Paprika)"
              >
                {mode === 'spreadsheet' ? 'Spreadsheet' : mode === 'paprika' ? 'Paprika' : '⋯ More'}
              </button>
            </div>

            {/* ── URL tab ─────────────────────────────────────────────────────── */}
            {mode === 'url' && (
              <div className="import-section">
                {/* Drink / Meal type toggle — single warm-orange accent */}
                <div className="pillrow-type" role="group" aria-label="Import type">
                  <button
                    type="button"
                    onClick={() => { setItemType('meal'); setItemTypeUserOverride(true); }}
                    aria-pressed={itemType === 'meal'}
                  >
                    {'🍽️'} Meal
                  </button>
                  <button
                    type="button"
                    onClick={() => { setItemType('drink'); setItemTypeUserOverride(true); }}
                    aria-pressed={itemType === 'drink'}
                  >
                    {'🍹'} Drink
                  </button>
                </div>
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

                {/* Collapsed social preview card — tap to expand embed.
                    Keeps the Import button on-screen instead of pushing it off. */}
                {socialDetected && url && (
                  <div className="social-collapse-card">
                    <button className="social-collapse-trigger" onClick={() => setShowSocialPreview(p => !p)}>
                      <div className="social-collapse-icon">
                        {socialDetected.platform === 'Instagram' ? '📷' :
                         socialDetected.platform === 'TikTok' ? '🎵' :
                         socialDetected.platform === 'YouTube' ? '▶' : '🔗'}
                      </div>
                      <div className="social-collapse-meta">
                        <strong>{socialDetected.platform} post detected</strong>
                        <span>{showSocialPreview ? 'Tap to hide preview' : 'Tap to preview'} {'▸'}</span>
                      </div>
                      <span className="social-collapse-chev">{showSocialPreview ? '▾' : '▸'}</span>
                    </button>
                    {showSocialPreview && <SocialPreview url={url} />}
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

                {/* Render warmup animation */}
                {syncPhase === 'warmup' && (
                  <div className="warmup-phase">
                    <span className="warmup-label">Preparing your recipe…</span>
                    <button className="sync-cancel-btn warmup-cancel-btn" onClick={handleCancelImport}>
                      Cancel
                    </button>
                  </div>
                )}

                {/* Sync import progress */}
                {syncPhase === 'running' && (
                  <div className="sync-import-progress">
                    <div className="sync-import-stages">
                      {STAGES.map((stage, idx) => (
                        <div
                          key={stage.key}
                          className={`sync-stage${idx < syncStageIdx ? ' sync-stage--done' : ''}${idx === syncStageIdx ? ' sync-stage--active' : ''}`}
                        >
                          <span className="sync-stage-dot">
                            {idx < syncStageIdx ? '✓' : idx === syncStageIdx ? '●' : '○'}
                          </span>
                          <span className="sync-stage-label">{stage.label}</span>
                        </div>
                      ))}
                    </div>
                    <button className="sync-cancel-btn" onClick={handleCancelImport}>
                      Cancel
                    </button>
                  </div>
                )}

                {/* Success flash */}
                {syncPhase === 'success' && (
                  <div className="sync-import-success">
                    <span className="sync-success-check">✓</span>
                    <span className="sync-success-label">
                      {syncSuccessName ? `"${syncSuccessName}" saved!` : 'Recipe saved!'}
                    </span>
                  </div>
                )}

                <button
                  className="btn-primary"
                  onClick={handleUrlImport}
                  disabled={importing || syncPhase === 'running' || syncPhase === 'warmup' || !url.trim()}
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
          </div>
        )}
      </div>
    </div>
  );
}

// ── Image helpers ─────────────────────────────────────────────────────────────────────────────

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

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
  const ds = new DecompressionStream("gzip");
  const decompressedStream = new Response(compressed).body.pipeThrough(ds);
  return await new Response(decompressedStream).text();
}

function splitSemicolon(str) {
  if (!str) return [];
  return str.split(';').map(s => s.trim()).filter(Boolean);
}

function parseCSVLine(line, delimiter = ',') {
  const result = [];
  let inQuotes = false;
  let word = '';
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"' && line[i + 1] === '"') {
      word += '"';
      i++;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === delimiter && !inQuotes) {
      result.push(word);
      word = '';
    } else {
      word += char;
    }
  }
  result.push(word);
  return result;
}

function parsePaprikaRecipe(rec) {
  return {
    name: rec.name || 'Paprika Recipe',
    ingredients: (rec.ingredients || '').split('\n').map(s => s.trim()).filter(Boolean),
    directions: (rec.directions || '').split('\n').map(s => s.trim()).filter(Boolean),
    notes: rec.notes || '',
    link: rec.source_url || '',
    imageUrl: rec.photo_url || ''
  };
}

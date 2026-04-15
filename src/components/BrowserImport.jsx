/**
 * BrowserImport — Paprika-style in-app browser import.
 *
 * Flow:
 *   1. Component mounts → auto-opens Chrome immediately (no button click needed)
 *   2. Chrome shows Instagram/TikTok with a floating green "⬇ Download Recipe" button
 *   3. User can scroll, expand caption, log in if needed — then clicks Download in Chrome
 *   4. App polls /api/browser/poll every 2s waiting for the Download button click
 *   5. Recipe arrives → Chrome closes automatically → preview shown → user confirms import
 */

import { useState, useEffect, useRef } from 'react';
import { openBrowser, extractFromBrowser, closeBrowser } from '../api';
import { parseManualCaption } from '../recipeParser';
import { isMobileDevice } from '../isMobile';

// Convert a JSON-LD Recipe node → our internal recipe format
function recipeFromJsonLd(node) {
  const name = (node.name || '').toString().trim() || 'Imported Recipe';

  const ingredients = Array.isArray(node.recipeIngredient)
    ? node.recipeIngredient.map(s => s.toString().trim()).filter(Boolean)
    : [];

  const directions = [];
  const inst = node.recipeInstructions;
  if (Array.isArray(inst)) {
    for (const step of inst) {
      if (typeof step === 'string') {
        directions.push(step.trim());
      } else if (step && typeof step === 'object') {
        const types = [].concat(step['@type'] || []).join(' ').toLowerCase();
        if (types.includes('howtosection') && Array.isArray(step.itemListElement)) {
          for (const sub of step.itemListElement) {
            const t = (sub.text || sub.name || '').toString().trim();
            if (t) directions.push(t);
          }
        } else {
          const t = (step.text || step.name || '').toString().trim();
          if (t) directions.push(t);
        }
      }
    }
  } else if (typeof inst === 'string') {
    directions.push(...inst.split(/[\n\r]+/).map(s => s.trim()).filter(Boolean));
  }

  let imageUrl = '';
  const img = node.image;
  if (typeof img === 'string') imageUrl = img;
  else if (Array.isArray(img) && img.length) imageUrl = typeof img[0] === 'string' ? img[0] : img[0]?.url || '';
  else if (img && typeof img === 'object') imageUrl = img.url || '';

  return {
    name,
    ingredients: ingredients.length ? ingredients : ['See original recipe'],
    directions: directions.length ? directions : ['See original recipe'],
    imageUrl,
  };
}

const POLL_INTERVAL = 2000; // ms between polls

export default function BrowserImport({ url, platform, onRecipeFound, onFallback }) {
  const [phase, setPhase] = useState('launching'); // launching|waiting|extracting|login-wall|error
  const [error, setError] = useState('');
  const pollRef = useRef(null);
  const mountedRef = useRef(true);

  // ── Auto-open browser immediately on mount ─────────────────────────────────
  useEffect(() => {
    mountedRef.current = true;
    launchBrowser();
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, []);

  // ── Start polling when we enter 'waiting' phase ────────────────────────────
  useEffect(() => {
    if (phase === 'waiting') {
      startPolling();
    } else {
      stopPolling();
    }
    return () => stopPolling();
  }, [phase]);

  function startPolling() {
    stopPolling();
    const serverHost = window.location.hostname === 'localhost' ? 'localhost' : window.location.hostname;
    const serverUrl = `http://${serverHost}:3001/api/browser/poll`;
    pollRef.current = setInterval(async () => {
      try {
        const r = await fetch(serverUrl);
        const data = await r.json();
        if (!mountedRef.current) return;
        if (data.hasData) {
          stopPolling();
          handleExtractedData(data);
        }
      } catch {
        // Server unreachable — stop polling silently
        stopPolling();
      }
    }, POLL_INTERVAL);
  }

  function stopPolling() {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }

  async function launchBrowser() {
    if (!mountedRef.current) return;
    setPhase('launching');
    setError('');
    try {
      const result = await openBrowser(url);
      if (!mountedRef.current) return;
      if (!result.ok) {
        setError(result.error || 'Failed to open browser.');
        setPhase('error');
        return;
      }
      setPhase('waiting');
    } catch (e) {
      if (!mountedRef.current) return;
      // Give a clear, actionable error — the most common cause is server not running
      const msg = e?.message && e.message !== 'Failed to fetch'
        ? e.message
        : 'Cannot reach the SpiceHub server. Make sure npm run dev:full is running on your PC.';
      setError(msg);
      setPhase('error');
    }
  }

  // ── Manual "Extract" fallback (user clicks button in SpiceHub UI) ──────────
  async function handleManualExtract() {
    stopPolling();
    setPhase('extracting');
    setError('');
    try {
      const data = await extractFromBrowser();
      if (!mountedRef.current) return;
      if (!data.ok) {
        setError(data.error || 'Extraction failed.');
        setPhase('waiting');
        startPolling();
        return;
      }
      handleExtractedData(data);
    } catch (e) {
      if (!mountedRef.current) return;
      setError('Extraction error: ' + e.message);
      setPhase('waiting');
      startPolling();
    }
  }

  function handleExtractedData(data) {
    if (!mountedRef.current) return;

    if (data.type === 'jsonld' && data.recipe?.name) {
      const recipe = recipeFromJsonLd(data.recipe);
      recipe.link = data.sourceUrl || url;
      onRecipeFound(recipe);

    } else if (data.type === 'caption' && data.caption) {
      const recipe = parseManualCaption(data.caption, data.sourceUrl || url);
      // Attach image from the browser extraction (OG image or post image)
      if (data.imageUrl && !recipe.imageUrl) {
        recipe.imageUrl = data.imageUrl;
      }
      onRecipeFound(recipe);

    } else if (data.isLoginWall) {
      setPhase('login-wall');
      startPolling(); // Keep polling — user may log in and click Download

    } else {
      setError('No recipe text found. Expand the caption in Chrome and click ⬇ Download Recipe again.');
      setPhase('waiting');
    }
  }

  async function handleClose() {
    stopPolling();
    await closeBrowser();
    onFallback();
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="browser-import">
      {/* Fake address bar */}
      <div className="browser-bar">
        <span className="browser-lock">🔒</span>
        <span className="browser-url" title={url}>{url}</span>
        {(phase === 'launching' || phase === 'extracting') && (
          <span className="browser-spinner" />
        )}
      </div>

      {/* ── Launching ── */}
      {phase === 'launching' && (
        <div className="browser-phase launching">
          <span className="browser-spinner large" />
          <p>Opening Chrome…</p>
        </div>
      )}

      {/* ── Waiting for user to click Download in Chrome ── */}
      {phase === 'waiting' && (
        <div className="browser-phase waiting">
          <div className="browser-waiting-steps">
            <div className="waiting-step done">
              <span className="step-badge">✓</span>
              <span>Chrome opened on your PC with {platform}</span>
            </div>
            <div className="waiting-step active">
              <span className="step-badge">2</span>
              <span>
                {isMobileDevice()
                  ? <>On your <strong>PC</strong>, click the green <strong>⬇ Download Recipe</strong> button in the bottom-right of the Chrome window. Log in or expand the caption first if needed.</>
                  : <>Click the green <strong>⬇ Download Recipe</strong> button in the bottom-right of the Chrome window. Log in or expand the caption first if needed.</>
                }
              </span>
            </div>
            <div className="waiting-step">
              <span className="step-badge">3</span>
              <span>Recipe imports here automatically</span>
            </div>
          </div>

          <div className="browser-polling-indicator">
            <span className="browser-spinner" />
            <span>Waiting for Download button click…</span>
          </div>

          {error && <p className="browser-error">{error}</p>}

          <div className="browser-actions waiting-actions">
            <button className="btn-download-fallback" onClick={handleManualExtract}>
              ⬇ Extract Without Button
            </button>
            <button className="btn-secondary small" onClick={handleClose}>
              ✕ Cancel
            </button>
          </div>
          <p className="browser-hint">
            {isMobileDevice()
              ? 'Chrome opens on your PC — check your PC screen.'
              : "Don't see Chrome? Check your Windows taskbar."
            }
          </p>
        </div>
      )}

      {/* ── Extracting (manual) ── */}
      {phase === 'extracting' && (
        <div className="browser-phase extracting">
          <span className="browser-spinner large" />
          <p>Reading recipe from the page…</p>
        </div>
      )}

      {/* ── Login wall ── */}
      {phase === 'login-wall' && (
        <div className="browser-phase login-wall">
          <div className="browser-phase-icon">🔐</div>
          <h4>Instagram asked you to log in</h4>
          <p>Sign in to Instagram in the Chrome window. Once the post loads, click <strong>⬇ Download Recipe</strong>.</p>
          <div className="browser-polling-indicator">
            <span className="browser-spinner" />
            <span>Still watching for Download click…</span>
          </div>
          <button className="btn-secondary" onClick={handleClose}>Cancel</button>
        </div>
      )}

      {/* ── Error ── */}
      {phase === 'error' && (
        <div className="browser-phase no-server">
          <div className="browser-phase-icon">⚠️</div>
          <h4>Could not open browser</h4>
          <p className="browser-error" style={{ margin: 0 }}>{error}</p>
          <div className="browser-actions">
            <button className="btn-primary" onClick={launchBrowser}>Try Again</button>
            <button className="btn-secondary" onClick={onFallback}>📋 Paste Caption Instead</button>
          </div>
        </div>
      )}
    </div>
  );
}

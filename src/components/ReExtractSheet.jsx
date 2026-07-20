import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Sparkles, Check, RefreshCw, WifiOff, ArrowRight, Mic } from 'lucide-react';
import { captionToRecipe, transcribeVideoForRecipe, scoreExtractionConfidence } from '../recipeParser.js';
import { ENGINE_PROMPT_VERSION } from '../recipeSchema.js';
import { hapticLight, hapticSuccess, hapticError } from '../haptics';
import { getMealVideoSource } from '../lib/videoSource.js';
import { getPreferredWhisperModel } from '../lib/transcriptionService.js';
import './ReExtractSheet.css';

// ── Helpers ───────────────────────────────────────────────────────────────────
const norm = (s) => (s || '').toString().trim().toLowerCase();

// Inlined (kept local to avoid pulling the whole ImportSheet module — and its
// heavy BrowserAssist/transformers tree — into the Library chunk).
function normalizeForReview(result, fallbackType = 'meal') {
  if (!result) return null;
  const title = (result.title || result.name || '').trim();
  const itemType =
    result.itemType || result.type || result._type
    || (result.kind === 'drink' ? 'drink' : '')
    || fallbackType || 'meal';
  return {
    ...result,
    title,
    name: result.name || title,
    ingredients: Array.isArray(result.ingredients) ? result.ingredients.filter(Boolean) : [],
    directions: Array.isArray(result.directions) ? result.directions.filter(Boolean) : [],
    itemType,
    type: result.type || itemType,
  };
}

// Blend the model's self-rated confidence (0..1) with the structural heuristic
// (0..100 → 0..1), matching the import review badge's math.
function computeConfidence(recipe) {
  if (!recipe) return 0;
  const heuristic = scoreExtractionConfidence(recipe) / 100;
  const model =
    typeof recipe.confidence === 'number' && recipe.confidence >= 0 && recipe.confidence <= 1
      ? recipe.confidence
      : null;
  if (model == null) return heuristic;
  return Math.max(0, Math.min(1, 0.6 * model + 0.4 * heuristic));
}

// Line-level diff between two string arrays (order-insensitive membership).
// Returns proposed rows tagged added/same and current rows tagged removed/same.
function diffLists(current = [], proposed = []) {
  const curSet = new Set(current.map(norm));
  const propSet = new Set(proposed.map(norm));
  return {
    proposed: proposed.map((line) => ({ line, status: curSet.has(norm(line)) ? 'same' : 'added' })),
    current: current.map((line) => ({ line, status: propSet.has(norm(line)) ? 'same' : 'removed' })),
    added: proposed.filter((l) => !curSet.has(norm(l))).length,
    removed: current.filter((l) => !propSet.has(norm(l))).length,
  };
}

function pct(c) {
  return typeof c === 'number' ? `${Math.round(Math.max(0, Math.min(1, c)) * 100)}%` : '—';
}

// ── DiffSection ─────────────────────────────────────────────────────────────
function DiffSection({ label, current, proposed, choice, onChoice }) {
  const d = useMemo(() => diffLists(current, proposed), [current, proposed]);
  const changed = d.added > 0 || d.removed > 0 || current.length !== proposed.length;

  if (!changed) {
    return (
      <div className="re-section">
        <div className="re-section-head">
          <span className="re-section-title">{label}</span>
          <span className="re-section-nochange">No change</span>
        </div>
      </div>
    );
  }

  return (
    <div className="re-section">
      <div className="re-section-head">
        <span className="re-section-title">{label}</span>
        <span className="re-section-delta">
          {d.added > 0 && <span className="re-delta-add">+{d.added}</span>}
          {d.removed > 0 && <span className="re-delta-rem">−{d.removed}</span>}
        </span>
      </div>

      <div className="re-choice">
        <button
          type="button"
          className={`re-choice-btn${choice === 'new' ? ' active' : ''}`}
          onClick={() => { hapticLight(); onChoice('new'); }}
        >
          Use new
        </button>
        <button
          type="button"
          className={`re-choice-btn${choice === 'current' ? ' active' : ''}`}
          onClick={() => { hapticLight(); onChoice('current'); }}
        >
          Keep current
        </button>
      </div>

      <div className={`re-diff-cols${choice === 'new' ? ' prefer-new' : ' prefer-current'}`}>
        <div className="re-diff-col">
          <div className="re-diff-col-label">Current</div>
          <ul className="re-diff-list">
            {d.current.length === 0 && <li className="re-diff-empty">— empty —</li>}
            {d.current.map((row, i) => (
              <li key={i} className={`re-diff-row re-${row.status}`}>{row.line}</li>
            ))}
          </ul>
        </div>
        <div className="re-diff-col">
          <div className="re-diff-col-label">Proposed</div>
          <ul className="re-diff-list">
            {d.proposed.length === 0 && <li className="re-diff-empty">— empty —</li>}
            {d.proposed.map((row, i) => (
              <li key={i} className={`re-diff-row re-${row.status}`}>{row.line}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── ReExtractSheet ────────────────────────────────────────────────────────────
/**
 * Re-runs extraction on a recipe's STORED caption (no re-scrape) and shows a
 * field-level diff (title / ingredients / directions) for one-tap accept/reject.
 *
 * Props:
 *   meal      — the saved recipe (must have sourceCaption)
 *   onClose() — dismiss
 *   onSaved(updatedMeal) — persist the merged result
 */
export default function ReExtractSheet({ meal, onClose, onSaved }) {
  const [phase, setPhase] = useState('intro'); // intro | running | diff | offline | error | nochange
  const [proposed, setProposed] = useState(null);
  const [newConfidence, setNewConfidence] = useState(null);
  const [errorMsg, setErrorMsg] = useState('');
  // Which pass produced (or is producing) `proposed` — drives status copy and
  // which fields get tagged on save. Whisper trust-loop (2026-07-20 P3):
  // 'audio' means transcribeVideoForRecipe ran instead of the cached caption.
  const [mode, setMode] = useState('caption'); // 'caption' | 'audio'
  // Per-section accept choices: 'new' | 'current'
  const [choices, setChoices] = useState({ title: 'new', ingredients: 'new', directions: 'new' });
  const abortRef = useRef(false);

  const itemType = meal?.itemType || meal?.type || 'meal';
  const curIngredients = useMemo(() => (meal?.ingredients || []).filter(Boolean), [meal]);
  const curDirections = useMemo(() => (meal?.directions || []).filter(Boolean), [meal]);
  // Only offer "Re-run with audio" when the saved link is a video we know how
  // to play/transcribe (same detector the PiP player and ImportSheet's manual
  // "Transcribe Video" button already use) — no dead-end button for a plain
  // website recipe.
  const videoSource = useMemo(() => getMealVideoSource(meal), [meal]);
  const hasVideoSource = !!videoSource;

  const runExtraction = useCallback(async (source = 'caption') => {
    if (source === 'audio') {
      if (!videoSource) { setErrorMsg('No video link saved for this recipe.'); setPhase('error'); return; }
    } else if (!meal?.sourceCaption) {
      setErrorMsg('No saved caption to re-read.'); setPhase('error'); return;
    }
    setMode(source);
    if (!navigator.onLine) { setPhase('offline'); return; }
    abortRef.current = false;
    setPhase('running');
    setErrorMsg('');
    try {
      const result = source === 'audio'
        ? await transcribeVideoForRecipe(videoSource.originalUrl, {
            type: itemType,
            imageUrl: meal.imageUrl || '',
            model: getPreferredWhisperModel(),
          })
        : await captionToRecipe(meal.sourceCaption, {
            title: meal.name || meal.title || '',
            imageUrl: meal.imageUrl || '',
            sourceUrl: meal.link || meal.sourceUrl || '',
            type: itemType,
          });
      if (abortRef.current) return;
      const normalized = result ? normalizeForReview(result, itemType) : null;
      // Re-extraction must NEVER lose steps: if this pass returned no directions
      // (Gemini variance) but we already have some, keep the existing ones so an
      // "accept new" can't blow away a recipe's steps. Same guard for ingredients.
      if (normalized && (!normalized.directions || normalized.directions.length === 0) && curDirections.length) {
        normalized.directions = curDirections.slice();
      }
      if (normalized && (!normalized.ingredients || normalized.ingredients.length === 0) && curIngredients.length) {
        normalized.ingredients = curIngredients.slice();
      }
      if (!normalized || (!normalized.ingredients.length && !normalized.directions.length)) {
        setErrorMsg(source === 'audio'
          ? "Couldn't find a usable recipe in the video's audio."
          : "The new pass couldn't pull a cleaner recipe from the saved caption.");
        setPhase('error');
        return;
      }
      setProposed(normalized);
      setNewConfidence(computeConfidence(normalized));

      // If nothing actually changed, say so honestly instead of a no-op diff.
      const sameTitle = norm(normalized.name || normalized.title) === norm(meal.name || meal.title);
      const sameIng = JSON.stringify((normalized.ingredients || []).map(norm)) === JSON.stringify(curIngredients.map(norm));
      const sameDir = JSON.stringify((normalized.directions || []).map(norm)) === JSON.stringify(curDirections.map(norm));
      setPhase(sameTitle && sameIng && sameDir ? 'nochange' : 'diff');
    } catch (err) {
      if (abortRef.current) return;
      console.error('[ReExtractSheet] re-run failed:', err);
      hapticError();
      setErrorMsg(err?.message || (source === 'audio' ? 'Audio transcription failed. Try again.' : 'Re-extraction failed. Try again.'));
      setPhase('error');
    }
  }, [meal, itemType, curIngredients, curDirections, videoSource]);

  // Kick off automatically on open — caption re-run is still the default;
  // audio is an explicit opt-in via the button below.
  useEffect(() => {
    runExtraction('caption');
    return () => { abortRef.current = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = useCallback(() => {
    if (!proposed) return;
    // Only credit this save as audio-sourced if the audio pass actually
    // contributed accepted content — picking "keep current" for everything
    // shouldn't relabel a recipe that didn't actually change.
    const tookNewContent = choices.ingredients === 'new' || choices.directions === 'new';
    const merged = {
      ...meal,
      name: choices.title === 'new' ? (proposed.name || proposed.title || meal.name) : meal.name,
      title: choices.title === 'new' ? (proposed.title || proposed.name || meal.name) : (meal.title || meal.name),
      ingredients: choices.ingredients === 'new' ? (proposed.ingredients || []) : curIngredients,
      directions: choices.directions === 'new' ? (proposed.directions || []) : curDirections,
      confidence: typeof newConfidence === 'number' ? newConfidence : meal.confidence,
      needsReview: typeof newConfidence === 'number' ? newConfidence < 0.75 : meal.needsReview,
      engineVersion: ENGINE_PROMPT_VERSION,
      extractedAt: new Date().toISOString(),
      sourceCaption: meal.sourceCaption, // keep caption for future re-runs
      _transcriptSource: mode === 'audio' && tookNewContent
        ? (proposed._transcriptSource || 'whisper')
        : meal._transcriptSource,
    };
    hapticSuccess();
    onSaved(merged);
  }, [proposed, meal, choices, newConfidence, mode, curIngredients, curDirections, onSaved]);

  const setChoice = (section, value) => setChoices((c) => ({ ...c, [section]: value }));

  return (
    <motion.div
      className="re-overlay"
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
    >
      <motion.div
        className="re-sheet"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Improve recipe"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 300, damping: 32 }}
      >
        <div className="re-grab" />
        <div className="re-header">
          <h2 className="re-title"><Sparkles size={17} strokeWidth={2.2} /> Improve recipe</h2>
          <button className="re-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="re-body">
          <div className="re-recipe-name">{meal?.name || 'Recipe'}</div>

          {/* Confidence summary */}
          <div className="re-conf">
            <span className="re-conf-old">Was {pct(meal?.confidence)}</span>
            {phase === 'diff' && (
              <>
                <ArrowRight size={13} aria-hidden="true" />
                <span className="re-conf-new">{pct(newConfidence)} now</span>
              </>
            )}
          </div>

          {/* Whisper trust loop (2026-07-20 P3): only shown when the saved
              link is a video we know how to transcribe. Always visible
              (not just on low confidence) so the user can opt in whenever
              they suspect the caption missed something the audio has. */}
          {hasVideoSource && phase !== 'running' && (
            <button
              type="button"
              className="re-audio-link"
              onClick={() => { hapticLight(); runExtraction('audio'); }}
            >
              <Mic size={13} strokeWidth={2.2} />
              {mode === 'audio' ? 'Re-run with audio again' : 'Re-run with audio instead'}
            </button>
          )}

          <AnimatePresence mode="wait" initial={false}>
            {phase === 'running' && (
              <motion.div key="running" className="re-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <RefreshCw size={26} className="re-spin" />
                <p>{mode === 'audio' ? "Transcribing the video's audio…" : 'Re-reading the saved caption with the latest engine…'}</p>
                <span className="re-status-sub">
                  {mode === 'audio'
                    ? 'This can take up to a minute for longer videos.'
                    : 'No re-download — using the text we already saved.'}
                </span>
              </motion.div>
            )}

            {phase === 'offline' && (
              <motion.div key="offline" className="re-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <WifiOff size={26} />
                <p>You're offline.</p>
                <span className="re-status-sub">Re-extraction needs a connection. Reconnect and try again.</span>
                <button className="re-btn re-btn-ghost" onClick={() => runExtraction(mode)}>Try again</button>
              </motion.div>
            )}

            {phase === 'error' && (
              <motion.div key="error" className="re-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <p className="re-error-text">{errorMsg}</p>
                <button className="re-btn re-btn-ghost" onClick={() => runExtraction(mode)}>Try again</button>
              </motion.div>
            )}

            {phase === 'nochange' && (
              <motion.div key="nochange" className="re-status" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <Check size={26} />
                <p>Already up to date.</p>
                <span className="re-status-sub">
                  {mode === 'audio'
                    ? 'The audio transcript produced the same recipe — nothing to improve right now.'
                    : 'The current engine produced the same recipe — nothing to improve right now.'}
                </span>
              </motion.div>
            )}

            {phase === 'diff' && proposed && (
              <motion.div key="diff" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                {mode === 'audio' && (
                  <p className="re-audio-note">
                    <Mic size={12} strokeWidth={2.2} /> Proposed from the video's audio transcript
                  </p>
                )}
                <DiffSection
                  label="Title"
                  current={[meal?.name || meal?.title || ''].filter(Boolean)}
                  proposed={[proposed.name || proposed.title || ''].filter(Boolean)}
                  choice={choices.title}
                  onChoice={(v) => setChoice('title', v)}
                />
                <DiffSection
                  label="Ingredients"
                  current={curIngredients}
                  proposed={proposed.ingredients || []}
                  choice={choices.ingredients}
                  onChoice={(v) => setChoice('ingredients', v)}
                />
                <DiffSection
                  label="Directions"
                  current={curDirections}
                  proposed={proposed.directions || []}
                  choice={choices.directions}
                  onChoice={(v) => setChoice('directions', v)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="re-footer">
          {phase === 'diff' ? (
            <>
              <button className="re-btn re-btn-ghost" onClick={onClose}>Cancel</button>
              <button className="re-btn re-btn-primary" onClick={handleSave}>
                <Check size={16} /> Apply changes
              </button>
            </>
          ) : (
            <button className="re-btn re-btn-ghost re-btn-full" onClick={onClose}>
              {phase === 'nochange' ? 'Done' : 'Close'}
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

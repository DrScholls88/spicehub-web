import { useState, useMemo, useCallback, useEffect } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  X, Copy, Share2, Printer, FileText, Code2, CreditCard,
  Check, ClipboardList, CalendarDays, UtensilsCrossed,
} from 'lucide-react';
import {
  renderRecipeExport,
  renderGroceryExport,
  renderMealPlanExport,
  renderIndexCards,
  exportToClipboard,
  exportViaShare,
  exportForPrint,
} from '../utils/exportRenderer.js';
import { hapticLight, hapticSuccess } from '../haptics';
import './ExportSheet.css';

// ── Format definitions per mode ──────────────────────────────────────────────

const RECIPE_FORMATS = [
  { key: 'text',      label: 'Text',       icon: FileText },
  { key: 'markdown',  label: 'Markdown',   icon: Code2 },
  { key: 'print',     label: 'Print',      icon: Printer },
  { key: 'indexCard', label: 'Card',       icon: CreditCard },
];

const GROCERY_FORMATS = [
  { key: 'text', label: 'Text', icon: FileText },
  { key: 'html', label: 'Styled', icon: Code2 },
];

const MEALPLAN_FORMATS = [
  { key: 'text', label: 'Text', icon: FileText },
  { key: 'html', label: 'Styled', icon: Code2 },
];

// ── Mode config ──────────────────────────────────────────────────────────────

const MODE_CONFIG = {
  recipe:   { title: 'Share Recipe',     icon: UtensilsCrossed, formats: RECIPE_FORMATS,   defaultFormat: 'text' },
  grocery:  { title: 'Export Grocery',    icon: ClipboardList,   formats: GROCERY_FORMATS,  defaultFormat: 'text' },
  mealPlan: { title: 'Export Meal Plan',  icon: CalendarDays,    formats: MEALPLAN_FORMATS, defaultFormat: 'text' },
};

// ── Component ────────────────────────────────────────────────────────────────

/**
 * ExportSheet — bottom-sheet for exporting recipes, grocery lists, and meal plans.
 *
 * Props:
 *   mode       — 'recipe' | 'grocery' | 'mealPlan'
 *   data       — the data to export:
 *                 recipe mode:   single recipe object
 *                 grocery mode:  array of ingredient strings
 *                 mealPlan mode: array of { date, meals: [{ type, recipes }] }
 *   recipes    — (optional) array of recipe objects for index card multi-export
 *   title      — (optional) override title for grocery/meal plan exports
 *   onClose    — callback to close the sheet
 */
export default function ExportSheet({ mode = 'recipe', data, recipes, title: titleOverride, onClose }) {
  const config = MODE_CONFIG[mode] || MODE_CONFIG.recipe;
  const [format, setFormat] = useState(config.defaultFormat);
  const [toastMsg, setToastMsg] = useState('');

  // Auto-dismiss toast
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(''), 2200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
  }, []);

  // ── Render preview content ─────────────────────────────────────────────────

  const rendered = useMemo(() => {
    try {
      if (mode === 'recipe') {
        // For index cards with multiple recipes, render all
        if (format === 'indexCard' && Array.isArray(recipes) && recipes.length > 1) {
          return renderIndexCards(recipes);
        }
        return renderRecipeExport(data, { format });
      }
      if (mode === 'grocery') {
        return renderGroceryExport(data || [], { format, title: titleOverride || 'Grocery List' });
      }
      if (mode === 'mealPlan') {
        return renderMealPlanExport(data || [], { format, title: titleOverride || 'Meal Plan' });
      }
    } catch (err) {
      console.warn('[ExportSheet] Render failed:', err.message);
    }
    return '';
  }, [mode, data, recipes, format, titleOverride]);

  const isHtml = format === 'html' || format === 'print' || format === 'indexCard';

  // ── Actions ────────────────────────────────────────────────────────────────

  const handleCopy = useCallback(async () => {
    hapticLight();
    if (isHtml) {
      // For HTML formats, copy the raw source
      await exportToClipboard(rendered, showToast);
    } else {
      await exportToClipboard(rendered, showToast);
    }
    hapticSuccess();
    showToast('Copied!');
  }, [rendered, isHtml, showToast]);

  const handleShare = useCallback(async () => {
    hapticLight();
    const shareTitle = mode === 'recipe' ? (data?.name || 'Recipe') :
                       mode === 'grocery' ? (titleOverride || 'Grocery List') :
                       (titleOverride || 'Meal Plan');
    // Share API works best with plain text
    const shareContent = isHtml ? rendered : rendered;
    await exportViaShare(shareTitle, shareContent);
  }, [rendered, isHtml, mode, data, titleOverride]);

  const handlePrint = useCallback(() => {
    hapticLight();
    if (isHtml) {
      exportForPrint(rendered);
    } else {
      // Wrap plain text in a minimal print document
      const html = [
        '<!DOCTYPE html><html><head><meta charset="UTF-8">',
        '<style>body{font-family:system-ui,-apple-system,sans-serif;white-space:pre-wrap;',
        'max-width:700px;margin:2rem auto;padding:0 1rem;font-size:14px;line-height:1.7;color:#222}',
        '@media print{body{margin:0}}</style></head><body>',
        rendered.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        '</body></html>',
      ].join('');
      exportForPrint(html);
    }
  }, [rendered, isHtml]);

  // ── Scrim click ────────────────────────────────────────────────────────────

  const handleScrimClick = useCallback((e) => {
    if (e.target === e.currentTarget) onClose?.();
  }, [onClose]);

  // ── Render ─────────────────────────────────────────────────────────────────

  const ModeIcon = config.icon;

  return (
    <>
      <div className="export-sheet-overlay" onClick={handleScrimClick}>
        <div className="export-sheet">
          <div className="export-sheet-grab" />

          {/* Header */}
          <div className="export-sheet-header">
            <div className="export-sheet-title">
              <ModeIcon size={18} strokeWidth={1.75} className="export-sheet-title-icon" />
              {config.title}
            </div>
            <button className="export-sheet-close" onClick={onClose} aria-label="Close">
              <X size={16} strokeWidth={2} />
            </button>
          </div>

          {/* Body */}
          <div className="export-sheet-body">
            {/* Format picker */}
            <div className="export-format-label">Format</div>
            <div className="export-format-row">
              {config.formats.map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  className={`export-format-chip${format === key ? ' active' : ''}`}
                  onClick={() => { hapticLight(); setFormat(key); }}
                  aria-pressed={format === key}
                >
                  <Icon size={18} strokeWidth={1.5} className="export-format-chip-icon" />
                  <span className="export-format-chip-label">{label}</span>
                </button>
              ))}
            </div>

            {/* Preview */}
            {rendered ? (
              isHtml ? (
                <div
                  className="export-preview export-preview-html"
                  dangerouslySetInnerHTML={{ __html: rendered }}
                />
              ) : (
                <div className="export-preview">{rendered}</div>
              )
            ) : (
              <div className="export-preview">
                <div className="export-preview-empty">Nothing to export</div>
              </div>
            )}
          </div>

          {/* Action bar */}
          <div className="export-actions">
            <button className="export-btn export-btn--secondary" onClick={handleCopy} disabled={!rendered}>
              <Copy size={16} strokeWidth={1.75} />
              Copy
            </button>
            {(format === 'print' || format === 'indexCard' || format === 'html') && (
              <button className="export-btn export-btn--secondary" onClick={handlePrint} disabled={!rendered}>
                <Printer size={16} strokeWidth={1.75} />
                Print
              </button>
            )}
            <button className="export-btn export-btn--primary" onClick={handleShare} disabled={!rendered}>
              <Share2 size={16} strokeWidth={1.75} />
              Share
            </button>
          </div>
        </div>
      </div>

      {/* Toast */}
      <AnimatePresence>
        {toastMsg && (
          <motion.div
            className="export-toast"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 12 }}
            transition={{ duration: 0.2 }}
          >
            <Check size={14} strokeWidth={2.5} />
            {toastMsg}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

import { useState, useEffect, useRef } from 'react';
import { DRINK_RESPONSIBLY_TEXT } from '../legal/legalContent';
// Escape/back handled by App useBackHandler(showAgeGate) — avoid double listeners

const AGE_GATE_KEY = 'spicehub_age_verified';

export function isAgeVerified() {
  try {
    return localStorage.getItem(AGE_GATE_KEY) === 'true';
  } catch {
    return false;
  }
}

function storeAgeVerified() {
  try {
    localStorage.setItem(AGE_GATE_KEY, 'true');
  } catch {
    // ignore — see ConsentGate for the same tradeoff
  }
}

// ── Why the gate is up ───────────────────────────────────────────────────────
// Same component, same one-time acknowledgment, three different moments. The
// labels matter: a gate that says "Enter Bar" while the user is trying to SAVE
// a recipe reads as a navigation prompt and gets dismissed reflexively.
//
// 'Enter Saloon' was the old blanket confirm label. The tab is called Bar, and
// the Saloon is a room inside it — so the entry label is now Enter Bar and the
// save label names the actual outcome.
const REASON_COPY = {
  'enter-bar': {
    lead: '',
    confirm: 'Enter Bar',
    cancel: 'Not now',
  },
  'save-drink': {
    lead: 'This one reads as a drink, so it belongs on your Bar shelf.',
    confirm: 'Save to Bar',
    cancel: 'Back to review',
  },
  'open-drink-detail': {
    lead: "You're opening a drink recipe.",
    confirm: 'View drink',
    cancel: 'Not now',
  },
};

/**
 * AgeGate — blocking "Drink Responsibly" confirmation. Persisted once per
 * device (not versioned like ConsentGate — this is a one-time age/
 * responsibility acknowledgment, not something that needs re-confirming when
 * copy changes).
 *
 * Raised on three occasions, all owned by App.jsx:
 *   'enter-bar'          — navigateToTab('bar')
 *   'save-drink'         — an import resolves to a drink and would write to
 *                          db.drinks. Cancelling writes NOTHING: the import
 *                          sheet is still mounted behind this gate with the
 *                          user's edits, so they can flip the type chip back
 *                          to Meal instead. Importing a drink never
 *                          auto-verifies — keyword false positives like
 *                          "rum cake" or "whiskey chicken" are exactly why the
 *                          chip stays editable after the gate.
 *   'open-drink-detail'  — opening a drink from outside the Bar (rows saved by
 *                          builds from before the save-drink gate existed).
 *
 * Props:
 *   reason    - one of the keys above; drives lead copy + button labels
 *   onConfirm - callback() fired once the user confirms
 *   onCancel  - callback() fired if the user backs out without confirming
 */
export default function AgeGate({ reason = 'enter-bar', onConfirm, onCancel }) {
  const [checked, setChecked] = useState(false);
  const checkboxRef = useRef(null);
  const copy = REASON_COPY[reason] || REASON_COPY['enter-bar'];

  useEffect(() => {
    checkboxRef.current?.focus();
  }, []);

  const handleConfirm = () => {
    if (!checked) return;
    storeAgeVerified();
    onConfirm();
  };

  return (
    <div className="agegate-backdrop" role="presentation">
      <div
        className="agegate-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="agegate-title"
      >
        <div className="agegate-icon" aria-hidden="true">🥃</div>
        <h2 id="agegate-title" className="agegate-title">{DRINK_RESPONSIBLY_TEXT.title}</h2>
        {copy.lead && (
          <p className="agegate-paragraph agegate-lead">{copy.lead}</p>
        )}
        {DRINK_RESPONSIBLY_TEXT.paragraphs.map((p, i) => (
          <p key={i} className="agegate-paragraph">{p}</p>
        ))}

        <label className="agegate-checkbox-row">
          <input
            ref={checkboxRef}
            type="checkbox"
            checked={checked}
            onChange={(e) => setChecked(e.target.checked)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                setChecked((c) => !c);
              }
            }}
          />
          <span>I am of legal drinking age and will drink responsibly.</span>
        </label>

        <div className="agegate-actions">
          <button type="button" className="agegate-cancel-btn" onClick={onCancel}>
            {copy.cancel}
          </button>
          <button
            type="button"
            className="agegate-confirm-btn"
            disabled={!checked}
            onClick={handleConfirm}
          >
            {copy.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}

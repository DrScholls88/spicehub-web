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

/**
 * AgeGate — blocking "Drink Responsibly" confirmation shown the first time
 * a user opens the Bar/Saloon area. Persisted once per device (not
 * versioned like ConsentGate — this is a one-time age/responsibility
 * acknowledgment, not something that needs re-confirming when copy changes).
 *
 * Props:
 *   onConfirm - callback() fired once the user confirms
 *   onCancel  - callback() fired if the user backs out without confirming
 *               (e.g. navigates to a different tab instead)
 */
export default function AgeGate({ onConfirm, onCancel }) {
  const [checked, setChecked] = useState(false);
  const checkboxRef = useRef(null);

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
            Not now
          </button>
          <button
            type="button"
            className="agegate-confirm-btn"
            disabled={!checked}
            onClick={handleConfirm}
          >
            Enter Saloon
          </button>
        </div>
      </div>
    </div>
  );
}

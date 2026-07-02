import { useState, useEffect, useRef } from 'react';
import { LEGAL_VERSION } from '../legal/legalContent';
import LegalDocument from './LegalDocument';

const CONSENT_KEY = 'spicehub_consent';

/**
 * Read the stored consent record. Returns null if none exists or if it was
 * recorded against an older LEGAL_VERSION (which means the user needs to
 * re-accept).
 */
export function getStoredConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== LEGAL_VERSION) return null;
    return parsed;
  } catch {
    return null;
  }
}

function storeConsent() {
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify({
      version: LEGAL_VERSION,
      acceptedAt: new Date().toISOString(),
    }));
  } catch {
    // localStorage unavailable (private browsing / quota) — consent won't
    // persist across reloads, but we still let this session proceed rather
    // than hard-blocking someone whose browser just can't write to storage.
  }
}

/**
 * ConsentGate — blocking clickwrap modal shown before any app content is
 * usable, until the current LEGAL_VERSION has been explicitly accepted.
 * Versioned: bumping LEGAL_VERSION in legalContent.js re-triggers this for
 * everyone, even users who accepted a previous version.
 *
 * Renders nothing once consent is already on file for the current version.
 *
 * Props:
 *   onAccept - callback() fired once the user accepts
 */
export default function ConsentGate({ onAccept }) {
  const [checked, setChecked] = useState(false);
  const [openDoc, setOpenDoc] = useState(null); // 'privacy' | 'terms' | null
  const acceptBtnRef = useRef(null);
  const checkboxRef = useRef(null);

  useEffect(() => {
    checkboxRef.current?.focus();
  }, []);

  const handleAccept = () => {
    if (!checked) return;
    storeConsent();
    onAccept();
  };

  return (
    <div className="consentgate-backdrop" role="presentation">
      <div
        className="consentgate-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="consentgate-title"
      >
        <div className="consentgate-brand">
          <span aria-hidden="true">🌶️</span>
          <span>SpiceHub</span>
        </div>
        <h2 id="consentgate-title" className="consentgate-title">Before you dig in</h2>
        <p className="consentgate-blurb">
          SpiceHub stores your recipes and meal plans locally on this device. Some
          import features send content to third-party services (like Google's Gemini
          API) to structure recipe data. Please review the basics before continuing.
        </p>

        <div className="consentgate-links">
          <button type="button" className="consentgate-link" onClick={() => setOpenDoc('privacy')}>
            Read Privacy Policy
          </button>
          <button type="button" className="consentgate-link" onClick={() => setOpenDoc('terms')}>
            Read Terms of Service
          </button>
        </div>

        <label className="consentgate-checkbox-row">
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
          <span>
            I have read and agree to the <strong>Terms of Service</strong> and{' '}
            <strong>Privacy Policy</strong>.
          </span>
        </label>

        <button
          ref={acceptBtnRef}
          type="button"
          className="consentgate-accept-btn"
          disabled={!checked}
          onClick={handleAccept}
        >
          Accept &amp; Continue
        </button>
        <p className="consentgate-required-note">
          Acceptance is required to use SpiceHub.
        </p>
      </div>

      {openDoc && (
        <LegalDocument doc={openDoc} onClose={() => setOpenDoc(null)} />
      )}
    </div>
  );
}

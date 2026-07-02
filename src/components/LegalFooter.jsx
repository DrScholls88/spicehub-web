import { useState } from 'react';
import LegalDocument from './LegalDocument';

/**
 * LegalFooter — compact link row for Privacy Policy / Terms / Licenses,
 * meant to sit at the bottom of the Home tab content (SpiceHub has a fixed
 * bottom tab bar instead of a traditional page footer, so this renders
 * inline within scrollable content, not pinned to the viewport).
 */
export default function LegalFooter() {
  const [openDoc, setOpenDoc] = useState(null);
  const year = new Date().getFullYear();

  return (
    <footer className="legalfooter">
      <div className="legalfooter-links">
        <button type="button" className="legalfooter-link" onClick={() => setOpenDoc('privacy')}>
          Privacy Policy
        </button>
        <span className="legalfooter-sep" aria-hidden="true">·</span>
        <button type="button" className="legalfooter-link" onClick={() => setOpenDoc('terms')}>
          Terms of Service
        </button>
        <span className="legalfooter-sep" aria-hidden="true">·</span>
        <button type="button" className="legalfooter-link" onClick={() => setOpenDoc('licenses')}>
          Licenses
        </button>
      </div>
      <p className="legalfooter-copyright">
        © {year} SpiceHub. Personal project, not affiliated with Instagram, Meta, or
        any recipe site it can import from. 🥃 Drink responsibly.
      </p>

      {openDoc && (
        <LegalDocument doc={openDoc} onClose={() => setOpenDoc(null)} />
      )}
    </footer>
  );
}

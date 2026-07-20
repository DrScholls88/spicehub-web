import { useEffect, useRef } from 'react';
import {
  LEGAL_VERSION,
  LEGAL_CONTACT_EMAIL,
  PRIVACY_POLICY_SECTIONS,
  TERMS_OF_SERVICE_SECTIONS,
  THIRD_PARTY_NOTICES,
} from '../legal/legalContent';
import useBackHandler from '../hooks/useBackHandler';

/**
 * LegalDocument — read-only viewer for Privacy Policy / Terms of Service /
 * Third-Party Licenses. Renders content from plain JS data (no markdown
 * parser, no dangerouslySetInnerHTML) so there's no injection surface here.
 *
 * Dismissible (back / Escape / backdrop / close) — unlike
 * ConsentGate/AgeGate, this is just informational, not a blocking gate.
 *
 * Props:
 *   doc     - 'privacy' | 'terms' | 'licenses'
 *   onClose - callback()
 */
export default function LegalDocument({ doc, onClose }) {
  const closeBtnRef = useRef(null);

  useBackHandler(true, onClose, `legal-${doc || 'doc'}`);

  useEffect(() => {
    closeBtnRef.current?.focus();
  }, []);

  const { title, body } = getDocContent(doc);

  return (
    <div
      className="legaldoc-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="legaldoc-sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="legaldoc-header">
          <h2 className="legaldoc-title">{title}</h2>
          <button
            ref={closeBtnRef}
            type="button"
            className="legaldoc-close"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="legaldoc-body">
          <p className="legaldoc-version">Version: {LEGAL_VERSION}</p>
          {body}
          <p className="legaldoc-contact">
            Contact: <a href={`mailto:${LEGAL_CONTACT_EMAIL}`}>{LEGAL_CONTACT_EMAIL}</a>
          </p>
        </div>
      </div>
    </div>
  );
}

function getDocContent(doc) {
  if (doc === 'terms') {
    return {
      title: 'Terms of Service',
      body: TERMS_OF_SERVICE_SECTIONS.map((section) => (
        <section key={section.title} className="legaldoc-section">
          <h3>{section.title}</h3>
          {section.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
        </section>
      )),
    };
  }
  if (doc === 'licenses') {
    return {
      title: 'Third-Party Licenses',
      body: (
        <>
          <p>
            SpiceHub is built with the following open-source software. Full license texts
            are available from each project's own repository; a generated summary also
            lives in <code>THIRD_PARTY_LICENSES.md</code> at the root of the SpiceHub
            source repository.
          </p>
          <ul className="legaldoc-license-list">
            {THIRD_PARTY_NOTICES.map((item) => (
              <li key={item.name}>
                <strong>{item.name}</strong> — {item.author} ({item.license})
                {item.note ? <span className="legaldoc-license-note"> — {item.note}</span> : null}
              </li>
            ))}
          </ul>
        </>
      ),
    };
  }
  // default: privacy
  return {
    title: 'Privacy Policy',
    body: PRIVACY_POLICY_SECTIONS.map((section) => (
      <section key={section.title} className="legaldoc-section">
        <h3>{section.title}</h3>
        {section.paragraphs.map((p, i) => <p key={i}>{p}</p>)}
      </section>
    )),
  };
}

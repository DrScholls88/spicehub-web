import React from 'react';

export default function StickyHeader({ visible, onSpin }) {
  return (
    <div className={`landing-sticky-header${visible ? ' visible' : ''}`}>
      <div className="sticky-brand">
        🌶️ SpiceHub
      </div>
      <button className="sticky-spin-btn" onClick={onSpin}>
        Spin 🎲
      </button>
    </div>
  );
}

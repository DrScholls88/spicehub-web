import React from 'react';
import { motion } from 'framer-motion';
import { Download, Dices, UtensilsCrossed } from 'lucide-react';

// ── App Intro Hero ────────────────────────────────────────────────────────────
// Replaces the old "Decision Fatigue Killer" GamifiedHero (big Spin CTA +
// shake-to-spin). Product call (2026-07-30): the fold's job is to tell a new
// or returning user what SpiceHub actually does, not to push the Spin action —
// Spin now lives as its own tile in the widget grid below ("Spin the Week").
// Every color here is a token from design.md §2 (no undefined vars, no
// hardcoded fallbacks) — the washed-out-text bug in the old hero came from
// var(--surface-elevated, ...) / var(--surface-overlay, #1f2937), neither of
// which is ever defined in App.css, so the off-brand dark-navy fallback was
// silently permanent. Every value below resolves to a real token.

const FEATURES = [
  {
    icon: Download,
    title: 'Import from anywhere',
    subtitle: 'Instagram, TikTok, or any recipe link — auto-parsed in seconds.',
  },
  {
    icon: Dices,
    title: 'Auto-plan your week',
    subtitle: 'Spin up a full week of meals from your saved recipes.',
  },
  {
    icon: UtensilsCrossed,
    title: 'Cook what you have',
    subtitle: "Match recipes to what's already in your pantry.",
  },
];

export default function AppIntroHero() {
  return (
    <motion.div
      className="app-intro-hero"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
      style={{
        background: 'linear-gradient(135deg, var(--card), var(--surface))',
        border: '1px solid var(--border)',
        borderRadius: 'var(--radius-lg)',
        padding: '22px 20px',
        marginBottom: '20px',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '6px' }}>
        <span style={{ fontSize: '20px', fontWeight: 800, color: 'var(--text)', letterSpacing: '-0.3px' }}>
          🌶️ SpiceHub
        </span>
        <span style={{ fontSize: '13px', fontWeight: 600, color: 'var(--primary)' }}>
          Your meals, gamified.
        </span>
      </div>

      <p style={{ fontSize: '13px', color: 'var(--text-light)', margin: '0 0 18px 0', lineHeight: 1.45, fontWeight: 500 }}>
        Plan your week, import any recipe, and never wonder what's for dinner again.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {FEATURES.map(({ icon: Icon, title, subtitle }) => (
          <div key={title} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
            <div
              style={{
                flexShrink: 0,
                width: '34px',
                height: '34px',
                borderRadius: '10px',
                background: 'var(--surface-2)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--primary)',
              }}
            >
              <Icon size={17} strokeWidth={2.25} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '13.5px', fontWeight: 700, color: 'var(--text)', marginBottom: '1px' }}>
                {title}
              </div>
              <div style={{ fontSize: '12px', color: 'var(--text-light)', lineHeight: 1.4 }}>
                {subtitle}
              </div>
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

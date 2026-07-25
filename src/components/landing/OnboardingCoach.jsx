import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const STEPS = [
  {
    title: 'Import a recipe',
    description: "Start by importing a recipe from Instagram, TikTok, or any URL. Just paste a link or share it directly to SpiceHub.",
    targetKey: 'cta',
  },
  {
    title: 'Tag your favorites',
    description: "Mark meals as 'The Rotation' — those are the ones the weekly spinner draws from.",
    targetKey: 'myMeals',
  },
  {
    title: 'Spin your week',
    description: "Tap Spin and SpiceHub plans your whole week. Don't like a day? Re-roll it.",
    targetKey: 'cta',
  },
];

export default function OnboardingCoach({ onComplete, targets }) {
  const [step, setStep] = useState(0);
  const [spotlightRect, setSpotlightRect] = useState(null);
  const tooltipRef = useRef(null);

  const currentStep = STEPS[step];
  const targetEl = targets?.[currentStep.targetKey]?.current;

  // Measure target element position
  useEffect(() => {
    if (!targetEl) { setSpotlightRect(null); return; }
    const updateRect = () => {
      const r = targetEl.getBoundingClientRect();
      const pad = 8;
      setSpotlightRect({
        x: r.left - pad,
        y: r.top - pad,
        w: r.width + pad * 2,
        h: r.height + pad * 2,
      });
    };
    updateRect();
    window.addEventListener('resize', updateRect);
    window.addEventListener('scroll', updateRect, true);
    return () => {
      window.removeEventListener('resize', updateRect);
      window.removeEventListener('scroll', updateRect, true);
    };
  }, [targetEl, step]);

  const handleNext = useCallback(() => {
    if (step < STEPS.length - 1) {
      setStep(s => s + 1);
    } else {
      onComplete();
    }
  }, [step, onComplete]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  // Compute clip-path for spotlight cutout
  const clipPath = spotlightRect
    ? `polygon(
        0% 0%, 0% 100%,
        ${spotlightRect.x}px 100%,
        ${spotlightRect.x}px ${spotlightRect.y}px,
        ${spotlightRect.x + spotlightRect.w}px ${spotlightRect.y}px,
        ${spotlightRect.x + spotlightRect.w}px ${spotlightRect.y + spotlightRect.h}px,
        ${spotlightRect.x}px ${spotlightRect.y + spotlightRect.h}px,
        ${spotlightRect.x}px 100%,
        100% 100%, 100% 0%
      )`
    : 'none';

  // Position tooltip below or above spotlight
  const tooltipStyle = {};
  if (spotlightRect) {
    const spaceBelow = window.innerHeight - (spotlightRect.y + spotlightRect.h);
    if (spaceBelow > 200) {
      tooltipStyle.top = spotlightRect.y + spotlightRect.h + 12;
    } else {
      tooltipStyle.bottom = window.innerHeight - spotlightRect.y + 12;
    }
    tooltipStyle.left = Math.max(16, Math.min(spotlightRect.x, window.innerWidth - 296));
  } else {
    tooltipStyle.top = '50%';
    tooltipStyle.left = '50%';
    tooltipStyle.transform = 'translate(-50%, -50%)';
  }

  return (
    <div className="onboarding-overlay">
      {/* Scrim with spotlight cutout */}
      <div className="onboarding-scrim" style={{ clipPath }} />

      {/* Tooltip */}
      <AnimatePresence mode="wait">
        <motion.div
          key={step}
          ref={tooltipRef}
          className="onboarding-tooltip"
          style={{ position: 'fixed', maxWidth: 280, zIndex: 10001, ...tooltipStyle }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.25 }}
        >
          <div className="onboarding-tooltip-title">{currentStep.title}</div>
          <div className="onboarding-tooltip-desc">{currentStep.description}</div>
          <div className="onboarding-tooltip-footer">
            <div className="onboarding-dots">
              {STEPS.map((_, i) => (
                <span key={i} className={`onboarding-dot${i === step ? ' active' : ''}`} />
              ))}
            </div>
            <div className="onboarding-tooltip-actions">
              <button className="onboarding-skip" onClick={handleSkip}>Skip</button>
              <button className="onboarding-next" onClick={handleNext}>
                {step === STEPS.length - 1 ? 'Got it!' : 'Next →'}
              </button>
            </div>
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

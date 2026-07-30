import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { Dices, Sparkles, Smartphone } from 'lucide-react';
import useShakeToSpin from '../../hooks/useShakeToSpin.js';
import { haptic } from '../../lib/landingHelpers.js';

export default function GamifiedHero({
  onSpin = () => {},
  mealsCount = 0,
  pantryAgingCount = 0,
  todayMeal = null,
}) {
  const [isSpinning, setIsSpinning] = useState(false);

  // Shake gesture callback
  const handleShake = () => {
    handleTriggerSpin();
  };

  const { isSupported, needsPermission, requestPermission } = useShakeToSpin(handleShake, {
    enabled: true,
  });

  const handleTriggerSpin = () => {
    if (isSpinning) return;
    haptic('heavy');
    setIsSpinning(true);
    setTimeout(() => {
      onSpin();
      setIsSpinning(false);
    }, 600);
  };

  // Cheeky, context-aware headline and subtitle
  const copy = useMemo(() => {
    const hour = new Date().getHours();
    if (todayMeal && !todayMeal._special) {
      return {
        title: "Tonight's Mission is Set 🍳",
        subtitle: `You're cooking ${todayMeal.name}. Ready to get started?`,
      };
    }
    if (pantryAgingCount > 0) {
      return {
        title: "Don't let ingredients go to waste! 🥦",
        subtitle: `You have ${pantryAgingCount} item${pantryAgingCount === 1 ? '' : 's'} aging. Let's build a meal around them.`,
      };
    }
    if (hour >= 17) {
      return {
        title: "Stop asking 'what's for dinner?'",
        subtitle: "It's 5 PM. Let the algorithm decide so you don't text 'idk, you pick'.",
      };
    }
    if (hour < 11) {
      return {
        title: "Plan ahead & conquer your day ☕",
        subtitle: "Lock in tonight's meal before the dinner rush chaos hits.",
      };
    }
    return {
      title: "What are we cooking today?",
      subtitle: "Tap below to let SpiceHub spin up the perfect meal plan.",
    };
  }, [todayMeal, pantryAgingCount]);

  return (
    <motion.div
      className="gamified-hero-card"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, ease: [0.32, 0.72, 0, 1] }}
      style={{
        background: 'linear-gradient(135deg, var(--surface-elevated, var(--card)), var(--surface-overlay, #1f2937))',
        border: '1px solid var(--border-subtle, var(--border))',
        borderRadius: '20px',
        padding: '24px 20px',
        marginBottom: '20px',
        boxShadow: 'var(--elevation-shadow, 0 4px 20px rgba(0,0,0,0.08))',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' }}>
          <span
            style={{
              fontSize: '12px',
              fontWeight: '700',
              textTransform: 'uppercase',
              letterSpacing: '0.8px',
              color: 'var(--primary)',
              background: 'rgba(22, 163, 74, 0.12)',
              padding: '4px 10px',
              borderRadius: '12px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '4px',
            }}
          >
            <Sparkles size={12} /> Decision Engine
          </span>
        </div>

        <h1
          style={{
            fontSize: '22px',
            fontWeight: '800',
            color: 'var(--text)',
            margin: '0 0 6px 0',
            lineHeight: '1.25',
            letterSpacing: '-0.3px',
          }}
        >
          {copy.title}
        </h1>
        <p
          style={{
            fontSize: '13px',
            color: 'var(--text-muted, var(--text-light))',
            margin: '0 0 20px 0',
            lineHeight: '1.4',
            fontWeight: '500',
          }}
        >
          {copy.subtitle}
        </p>

        {/* Big Springy Spin CTA */}
        <motion.button
          onClick={handleTriggerSpin}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.96 }}
          animate={isSpinning ? { rotate: [0, -5, 5, -5, 5, 0], scale: [1, 1.05, 0.98, 1.02, 1] } : {}}
          transition={{ duration: 0.5 }}
          style={{
            width: '100%',
            minHeight: '52px',
            borderRadius: '14px',
            border: 'none',
            background: 'linear-gradient(135deg, var(--primary, #16a34a), #15803d)',
            color: '#ffffff',
            fontSize: '16px',
            fontWeight: '700',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '10px',
            boxShadow: '0 6px 20px rgba(22, 163, 74, 0.35)',
          }}
        >
          <motion.div animate={isSpinning ? { rotate: 360 } : {}} transition={{ duration: 0.5 }}>
            <Dices size={22} />
          </motion.div>
          <span>🎰 Spin for Tonight's Dinner</span>
        </motion.button>

        {/* Shake your phone indicator */}
        {isSupported && (
          <div
            style={{
              marginTop: '12px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px',
              fontSize: '11px',
              color: 'var(--text-muted, var(--text-light))',
              fontWeight: '500',
            }}
          >
            <Smartphone size={12} />
            {needsPermission ? (
              <button
                onClick={requestPermission}
                style={{
                  background: 'none',
                  border: 'underline',
                  color: 'var(--primary)',
                  fontSize: '11px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                Enable Shake-to-Spin 📱
              </button>
            ) : (
              <span>Or physically shake your phone to spin! 📱✨</span>
            )}
          </div>
        )}
      </div>
    </motion.div>
  );
}

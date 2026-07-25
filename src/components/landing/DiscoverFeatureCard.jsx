import React from 'react';
import { motion } from 'framer-motion';
import { Compass, ChevronRight } from 'lucide-react';

export default function DiscoverFeatureCard({ onPress }) {
  return (
    <motion.button
      className="discover-feature-card"
      onClick={onPress}
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
    >
      <span className="discover-card-glow" aria-hidden="true" />
      <span className="discover-card-badge">
        <span className="discover-card-badge-ring" aria-hidden="true" />
        <Compass size={22} strokeWidth={1.75} />
      </span>
      <span className="discover-card-text">
        <span className="discover-card-eyebrow">Discover</span>
        <span className="discover-card-title">Find your next favorite</span>
        <span className="discover-card-subtitle">Browse recipe communities — tap one to import</span>
      </span>
      <span className="discover-card-arrow">
        <ChevronRight size={16} strokeWidth={2.5} />
      </span>
    </motion.button>
  );
}

/**
 * FriendsSheet — standalone full-screen bottom sheet for friend management.
 * Opened from the header 👤 icon and from the Landing page Friends tile.
 * Wraps FriendsSection with an overlay + slide-up sheet chrome.
 *
 * See spec: docs/superpowers/specs/2026-07-30-friends-direct-share-design.md §4
 */
import { motion, AnimatePresence } from 'framer-motion';
import useSwipeDismiss from '../hooks/useSwipeDismiss';
import FriendsSection from './FriendsSection';

const sheetVariants = {
  hidden: { y: '100%' },
  visible: { y: 0, transition: { type: 'spring', damping: 30, stiffness: 300 } },
  exit: { y: '100%', transition: { duration: 0.25 } },
};

/**
 * @param {{ open: boolean, onClose: Function, isOnline: boolean, showToast: Function }} props
 */
export default function FriendsSheet({ open, onClose, isOnline, showToast }) {
  const swipe = useSwipeDismiss(onClose);

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Overlay */}
          <motion.div
            className="st-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          {/* Sheet */}
          <motion.div
            className="st-sheet"
            ref={swipe.sheetRef}
            variants={sheetVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            onTouchStart={swipe.handleTouchStart}
            onTouchMove={swipe.handleTouchMove}
            onTouchEnd={swipe.handleTouchEnd}
          >
            <div className="st-handle" />
            <div className="st-header">
              <h2 className="st-title">👤 Friends</h2>
              <button className="st-close" onClick={onClose}>✕</button>
            </div>
            <div className="st-content">
              <FriendsSection isOnline={isOnline} showToast={showToast} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}

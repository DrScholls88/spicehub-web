import { useRef, useCallback } from 'react';

/**
 * useSwipeDismiss - Enables drag-down-to-dismiss on bottom sheet modals.
 *
 * iOS users expect to be able to swipe a bottom sheet down to close it.
 * This hook provides touch handlers and a ref for the sheet element.
 *
 * @param {Function} onDismiss - Called when the sheet is swiped down past threshold
 * @param {Object} [options]
 * @param {number} [options.threshold=120] - Pixels of downward drag to trigger dismiss
 * @param {number} [options.velocityThreshold=0.5] - px/ms velocity that also triggers dismiss
 * @returns {{ sheetRef, handleTouchStart, handleTouchMove, handleTouchEnd }}
 *
 * @example
 *   const { sheetRef, handleTouchStart, handleTouchMove, handleTouchEnd } = useSwipeDismiss(onClose);
 *   <div ref={sheetRef} onTouchStart={handleTouchStart} onTouchMove={handleTouchMove} onTouchEnd={handleTouchEnd}>
 */
export default function useSwipeDismiss(onDismiss, options = {}) {
  const { threshold = 120, velocityThreshold = 0.5 } = options;

  const sheetRef = useRef(null);
  const startYRef = useRef(null);
  const startTimeRef = useRef(null);
  const currentYRef = useRef(0);
  const isDraggingRef = useRef(false);

  const handleTouchStart = useCallback((e) => {
    // Only track single-finger touches
    if (e.touches.length !== 1) return;

    const sheet = sheetRef.current;
    if (!sheet) return;

    // Only allow swipe-to-dismiss if scrolled to the top
    // This prevents dismissal when user is scrolling content
    const scrollableParent = findScrollableParent(e.target, sheet);
    if (scrollableParent && scrollableParent.scrollTop > 5) return;

    startYRef.current = e.touches[0].clientY;
    startTimeRef.current = Date.now();
    currentYRef.current = 0;
    isDraggingRef.current = false;
  }, []);

  const handleTouchMove = useCallback((e) => {
    if (startYRef.current === null) return;

    const deltaY = e.touches[0].clientY - startYRef.current;

    // Only track downward drags (positive deltaY)
    if (deltaY < 0) {
      // Swiping up — reset and let normal scroll handle it
      resetDrag();
      return;
    }

    // After 10px of downward movement, commit to the drag gesture
    if (deltaY > 10) {
      isDraggingRef.current = true;
    }

    if (!isDraggingRef.current) return;

    currentYRef.current = deltaY;

    // Apply visual transform with rubber-band effect
    const sheet = sheetRef.current;
    if (sheet) {
      // Diminishing returns after threshold — feels natural
      const translate = deltaY < threshold
        ? deltaY
        : threshold + (deltaY - threshold) * 0.3;

      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${translate}px)`;

      // Fade the overlay proportionally
      const overlay = sheet.parentElement;
      if (overlay && overlay.classList.contains('fm-overlay') ||
          overlay && overlay.classList.contains('st-overlay') ||
          overlay && overlay.classList.contains('bfm-overlay')) {
        const opacity = Math.max(0.1, 0.5 - (deltaY / (threshold * 3)));
        overlay.style.background = `rgba(0,0,0,${opacity})`;
      }
    }
  }, [threshold]);

  const handleTouchEnd = useCallback(() => {
    if (startYRef.current === null) return;

    const deltaY = currentYRef.current;
    const elapsed = Date.now() - startTimeRef.current;
    const velocity = elapsed > 0 ? deltaY / elapsed : 0;

    const sheet = sheetRef.current;

    // Dismiss if dragged past threshold OR fast enough velocity
    if (isDraggingRef.current && (deltaY > threshold || velocity > velocityThreshold)) {
      // Animate out
      if (sheet) {
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.32,0.72,0,1)';
        sheet.style.transform = 'translateY(100%)';
      }
      // Call dismiss after animation
      setTimeout(() => {
        if (sheet) {
          sheet.style.transform = '';
          sheet.style.transition = '';
        }
        onDismiss();
      }, 250);
    } else {
      // Snap back
      if (sheet) {
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.32,0.72,0,1)';
        sheet.style.transform = 'translateY(0)';
        setTimeout(() => {
          if (sheet) {
            sheet.style.transition = '';
          }
        }, 250);
      }
      // Restore overlay
      const overlay = sheet?.parentElement;
      if (overlay) {
        overlay.style.background = '';
      }
    }

    resetDrag();
  }, [threshold, velocityThreshold, onDismiss]);

  const resetDrag = () => {
    startYRef.current = null;
    startTimeRef.current = null;
    currentYRef.current = 0;
    isDraggingRef.current = false;
  };

  return { sheetRef, handleTouchStart, handleTouchMove, handleTouchEnd };
}

/**
 * Walk up the DOM from target to container looking for a scrollable element
 */
function findScrollableParent(target, container) {
  let el = target;
  while (el && el !== container) {
    const style = window.getComputedStyle(el);
    const overflowY = style.overflowY;
    if ((overflowY === 'auto' || overflowY === 'scroll') && el.scrollHeight > el.clientHeight) {
      return el;
    }
    el = el.parentElement;
  }
  return null;
}

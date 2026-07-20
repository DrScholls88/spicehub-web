import { useRef, useCallback } from 'react';

/**
 * useSwipeDismiss - Enables drag-down-to-dismiss on bottom sheet modals.
 *
 * iOS users expect to be able to swipe a bottom sheet down to close it.
 * This hook provides touch handlers and a ref for the sheet element.
 * Dismiss calls the same onDismiss as hardware back / X.
 *
 * @param {Function} onDismiss - Called when the sheet is swiped down past threshold
 * @param {Object} [options]
 * @param {number} [options.threshold=120] - Pixels of downward drag to trigger dismiss
 * @param {number} [options.velocityThreshold=0.5] - px/ms velocity that also triggers dismiss
 * @returns {{ sheetRef, handleTouchStart, handleTouchMove, handleTouchEnd }}
 */
export default function useSwipeDismiss(onDismiss, options = {}) {
  const { threshold = 120, velocityThreshold = 0.5 } = options;

  const sheetRef = useRef(null);
  const startYRef = useRef(null);
  const startTimeRef = useRef(null);
  const currentYRef = useRef(0);
  const isDraggingRef = useRef(false);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return;

    const sheet = sheetRef.current;
    if (!sheet) return;

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

    if (deltaY < 0) {
      resetDrag();
      return;
    }

    if (deltaY > 10) {
      isDraggingRef.current = true;
    }

    if (!isDraggingRef.current) return;

    currentYRef.current = deltaY;

    const sheet = sheetRef.current;
    if (sheet) {
      const translate = deltaY < threshold
        ? deltaY
        : threshold + (deltaY - threshold) * 0.3;

      sheet.style.transition = 'none';
      sheet.style.transform = `translateY(${translate}px)`;

      const overlay = findOverlayParent(sheet);
      if (overlay) {
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

    if (isDraggingRef.current && (deltaY > threshold || velocity > velocityThreshold)) {
      if (sheet) {
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.32,0.72,0,1)';
        sheet.style.transform = 'translateY(100%)';
      }
      setTimeout(() => {
        if (sheet) {
          sheet.style.transform = '';
          sheet.style.transition = '';
        }
        onDismiss();
      }, 250);
    } else {
      if (sheet) {
        sheet.style.transition = 'transform 0.25s cubic-bezier(0.32,0.72,0,1)';
        sheet.style.transform = 'translateY(0)';
        setTimeout(() => {
          if (sheet) {
            sheet.style.transition = '';
          }
        }, 250);
      }
      const overlay = findOverlayParent(sheet);
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

function findOverlayParent(sheet) {
  if (!sheet) return null;
  let el = sheet.parentElement;
  while (el && el !== document.body) {
    if (
      el.hasAttribute?.('data-sheet-overlay') ||
      el.classList?.contains('fm-overlay') ||
      el.classList?.contains('st-overlay') ||
      el.classList?.contains('bfm-overlay') ||
      el.classList?.contains('agegate-backdrop') ||
      el.classList?.contains('legaldoc-backdrop') ||
      el.classList?.contains('igzip-modal-backdrop')
    ) {
      return el;
    }
    el = el.parentElement;
  }
  return sheet.parentElement;
}

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

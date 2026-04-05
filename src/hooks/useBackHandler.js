import { useEffect, useRef, useCallback } from 'react';

// Global stack of active back handlers (LIFO)
const backStack = [];
let isHandlingPopstate = false;

// Use a counter so concurrent programmatic closes don't race
let programmaticBackCount = 0;

// Initialize global popstate listener (runs once at module load)
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    // Skip if this popstate was triggered by our own programmatic history.back()
    if (programmaticBackCount > 0) return;

    if (backStack.length > 0) {
      isHandlingPopstate = true;
      const handler = backStack[backStack.length - 1];
      if (handler?.onBack) {
        handler.onBack();
      }
      setTimeout(() => {
        isHandlingPopstate = false;
      }, 300);
    }
  });
}

/**
 * useBackHandler — Register a back-button handler for a modal/overlay.
 *
 * Handles Android hardware back button (popstate), CloseWatcher API (Chrome 120+),
 * and gracefully stacks multiple modals so the most-recent one closes first (LIFO).
 *
 * @param {boolean} active  - Whether this handler is currently active (modal is open)
 * @param {Function} onBack - Callback to close the modal
 * @param {string} [id]     - Optional identifier for debugging
 *
 * Usage:
 *   useBackHandler(!!detailItem, () => setDetailItem(null), 'detail');
 */
export default function useBackHandler(active, onBack, id = 'modal') {
  const onBackRef = useRef(onBack);
  const wasActiveRef = useRef(false);
  const pushIdRef = useRef(null);
  const closeWatcherRef = useRef(null);

  // Keep callback ref fresh so stale closures never fire
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  // Programmatic close — pop history without re-firing the callback
  const handleProgrammaticClose = useCallback(() => {
    if (pushIdRef.current && !isHandlingPopstate) {
      const idx = backStack.findIndex((h) => h.pushId === pushIdRef.current);
      if (idx !== -1) {
        backStack.splice(idx, 1);
        programmaticBackCount++;
        history.back();
        // Give the browser time to process; use 300 ms to cover slow devices
        setTimeout(() => {
          programmaticBackCount = Math.max(0, programmaticBackCount - 1);
        }, 300);
      }
      pushIdRef.current = null;
    }

    if (closeWatcherRef.current) {
      try { closeWatcherRef.current.destroy(); } catch { /* ignore */ }
      closeWatcherRef.current = null;
    }
  }, []);

  // Main effect: handle modal opening / closing
  useEffect(() => {
    if (active && !wasActiveRef.current) {
      // Modal just opened — push a history entry and register handler
      const pushId = `${id}-${Date.now()}-${Math.random()}`;
      pushIdRef.current = pushId;

      history.pushState({ spicehub: 'modal', id: pushId }, '');

      const handler = {
        pushId,
        id,
        onBack: () => {
          const idx = backStack.findIndex((h) => h.pushId === pushId);
          if (idx !== -1) backStack.splice(idx, 1);
          pushIdRef.current = null;

          if (closeWatcherRef.current) {
            try { closeWatcherRef.current.destroy(); } catch { /* ignore */ }
            closeWatcherRef.current = null;
          }

          onBackRef.current?.();
        },
      };

      backStack.push(handler);

      // CloseWatcher API — native Escape / back-gesture support (Chrome 120+, Android Chrome PWA)
      if (typeof window !== 'undefined' && 'CloseWatcher' in window) {
        try {
          const watcher = new CloseWatcher();
          watcher.addEventListener('close', () => handler.onBack());
          closeWatcherRef.current = watcher;
        } catch (e) {
          console.warn('[useBackHandler] CloseWatcher creation failed:', e);
        }
      }
    } else if (!active && wasActiveRef.current) {
      // Modal just closed programmatically (X button, etc.)
      handleProgrammaticClose();
    }

    wasActiveRef.current = active;
  }, [active, id, handleProgrammaticClose]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (pushIdRef.current) {
        const idx = backStack.findIndex((h) => h.pushId === pushIdRef.current);
        if (idx !== -1) backStack.splice(idx, 1);
      }
      if (closeWatcherRef.current) {
        try { closeWatcherRef.current.destroy(); } catch { /* ignore */ }
      }
    };
  }, []);
}

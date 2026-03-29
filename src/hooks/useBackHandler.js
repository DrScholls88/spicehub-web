import { useEffect, useRef, useCallback } from 'react';

// Global stack of active back handlers (LIFO)
const backStack = [];
let isHandlingPopstate = false;

// Initialize global popstate listener (runs once at module load)
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (e) => {
    // Check if this is a SpiceHub modal state
    if (backStack.length > 0) {
      isHandlingPopstate = true;
      const handler = backStack[backStack.length - 1];
      if (handler?.onBack) {
        handler.onBack();
      }
      // Small delay to let React state update before allowing new popstate
      setTimeout(() => {
        isHandlingPopstate = false;
      }, 50);
    }
  });
}

/**
 * useBackHandler - Register a back-button handler for a modal/overlay.
 *
 * Handles Android hardware back button, iOS swipe-back gesture, and Escape key
 * (via CloseWatcher API). Manages a stack of modals so that pressing back closes
 * the most recently opened modal first (LIFO order).
 *
 * @param {boolean} active - Whether this handler is currently active (modal is open)
 * @param {Function} onBack - Callback to close the modal
 * @param {string} [id] - Optional identifier for debugging (e.g., 'detail', 'fridge')
 *
 * @example
 *   const [detailItem, setDetailItem] = useState(null);
 *   useBackHandler(!!detailItem, () => setDetailItem(null), 'detail');
 */
export default function useBackHandler(active, onBack, id = 'modal') {
  const onBackRef = useRef(onBack);
  const wasActiveRef = useRef(false);
  const pushIdRef = useRef(null);
  const closeWatcherRef = useRef(null);

  // Keep callback ref fresh
  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  // Handle programmatic close (X button clicked) — pop history without re-firing callback
  const handleProgrammaticClose = useCallback(() => {
    // Remove ourselves from the stack BEFORE calling history.back()
    // so the popstate listener won't find us
    if (pushIdRef.current && !isHandlingPopstate) {
      const idx = backStack.findIndex((h) => h.pushId === pushIdRef.current);
      if (idx !== -1) {
        backStack.splice(idx, 1);
        history.back(); // Pop our state — won't trigger callback
      }
      pushIdRef.current = null;
    }

    // Destroy CloseWatcher
    if (closeWatcherRef.current) {
      try {
        closeWatcherRef.current.destroy();
      } catch {
        // Ignore errors during cleanup
      }
      closeWatcherRef.current = null;
    }
  }, []);

  // Main effect: handle modal opening/closing
  useEffect(() => {
    if (active && !wasActiveRef.current) {
      // Modal just opened — push history state and register handler
      const pushId = `${id}-${Date.now()}-${Math.random()}`;
      pushIdRef.current = pushId;

      history.pushState({ spicehub: 'modal', id: pushId }, '');

      const handler = {
        pushId,
        id,
        onBack: () => {
          // Remove from stack
          const idx = backStack.findIndex((h) => h.pushId === pushId);
          if (idx !== -1) {
            backStack.splice(idx, 1);
          }
          pushIdRef.current = null;

          // Destroy CloseWatcher
          if (closeWatcherRef.current) {
            try {
              closeWatcherRef.current.destroy();
            } catch {
              // Ignore errors during cleanup
            }
            closeWatcherRef.current = null;
          }

          // Call the actual close callback
          onBackRef.current?.();
        },
      };

      backStack.push(handler);

      // Progressive enhancement: CloseWatcher API (Chrome 120+, Android Chrome PWA)
      // Handles back gesture and Escape key natively
      if (typeof window !== 'undefined' && 'CloseWatcher' in window) {
        try {
          const watcher = new CloseWatcher();
          watcher.addEventListener('close', () => {
            handler.onBack();
          });
          closeWatcherRef.current = watcher;
        } catch (e) {
          // CloseWatcher may throw if too many active watchers exist
          console.warn('[useBackHandler] CloseWatcher creation failed:', e);
        }
      }
    } else if (!active && wasActiveRef.current) {
      // Modal just closed — clean up
      handleProgrammaticClose();
    }

    wasActiveRef.current = active;
  }, [active, id, handleProgrammaticClose]);

  // Cleanup on component unmount
  useEffect(() => {
    return () => {
      if (pushIdRef.current) {
        const idx = backStack.findIndex((h) => h.pushId === pushIdRef.current);
        if (idx !== -1) {
          backStack.splice(idx, 1);
        }
      }
      if (closeWatcherRef.current) {
        try {
          closeWatcherRef.current.destroy();
        } catch {
          // Ignore errors during cleanup
        }
      }
    };
  }, []);
}

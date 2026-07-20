import { useEffect, useRef } from 'react';
import {
  initBackNavigation,
  pushLayer,
  detachLayer,
  createBackCloseWatcher,
} from '../navigation/backStack';

/**
 * useBackHandler — Register a back-button handler for a modal/overlay.
 *
 * Routes Android hardware back, iOS edge-swipe (popstate), CloseWatcher
 * (Chrome 120+), and Escape through the central backStack so one gesture
 * never closes two layers.
 *
 * @param {boolean} active  - Whether this handler is currently active
 * @param {Function} onBack - Callback to close the modal (may return 'prevent')
 * @param {string} [id]     - Identifier for debugging / __spicehubBackStack
 *
 * @example
 *   useBackHandler(!!detailItem, () => setDetailItem(null), 'detail');
 */
export default function useBackHandler(active, onBack, id = 'modal') {
  const onBackRef = useRef(onBack);
  const wasActiveRef = useRef(false);
  const pushIdRef = useRef(null);
  const closeWatcherRef = useRef(null);

  useEffect(() => {
    onBackRef.current = onBack;
  }, [onBack]);

  useEffect(() => {
    initBackNavigation();
  }, []);

  useEffect(() => {
    if (active && !wasActiveRef.current) {
      const pushId = pushLayer({
        id,
        onBack: () => onBackRef.current?.(),
      });
      pushIdRef.current = pushId;

      const watcher = createBackCloseWatcher();
      closeWatcherRef.current = watcher;
    } else if (!active && wasActiveRef.current) {
      // Closed via UI (X, swipe, setState) — detach + sync history if still registered
      if (pushIdRef.current) {
        detachLayer(pushIdRef.current, { syncHistory: true });
        pushIdRef.current = null;
      }
      destroyWatcher(closeWatcherRef);
    }

    wasActiveRef.current = !!active;
  }, [active, id]);

  // Unmount while still active (route change, conditional render)
  useEffect(() => {
    return () => {
      if (pushIdRef.current) {
        detachLayer(pushIdRef.current, { syncHistory: true });
        pushIdRef.current = null;
      }
      destroyWatcher(closeWatcherRef);
      wasActiveRef.current = false;
    };
  }, []);
}

function destroyWatcher(ref) {
  if (ref.current) {
    try { ref.current.destroy(); } catch { /* ignore */ }
    ref.current = null;
  }
}

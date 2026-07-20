import { useEffect } from 'react';
import { initBackNavigation, setRootExitHintHandler, ensureRootSentinel } from '../navigation/backStack';

/**
 * Wire double-back-to-exit toast + root history sentinel.
 * @param {(msg: string, type?: string, duration?: number) => void} showToast
 */
export default function useRootBackGuard(showToast) {
  useEffect(() => {
    initBackNavigation();
    ensureRootSentinel();
    setRootExitHintHandler((msg) => {
      if (typeof showToast === 'function') {
        showToast(msg, 'info', 2000);
      }
    });
    return () => setRootExitHintHandler(null);
  }, [showToast]);
}

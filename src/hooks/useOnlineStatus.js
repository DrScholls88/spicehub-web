import { useState, useEffect, useCallback, useRef } from 'react';

/**
 * useOnlineStatus Hook
 *
 * Tracks navigator.onLine status with:
 * - Debouncing to handle flaky networks (2s delay before marking offline)
 * - Cross-tab synchronization via storage events
 * - Event emissions for global listening
 * - Tracking of previous offline state and last online time
 *
 * Returns:
 * {
 *   isOnline: bool,           // Current online status
 *   wasOffline: bool,         // Whether we were offline in this session
 *   lastOnlineTime: Date|null // Last time we confirmed online
 * }
 */

const EVENT_KEY = 'spicehub_online_status';
const OFFLINE_DEBOUNCE_MS = 2000; // Wait 2s before marking offline
const eventListeners = [];

// Global event emitter (works across tabs)
export function emitOnlineEvent(isOnline) {
  eventListeners.forEach(listener => {
    try {
      listener({ isOnline, timestamp: Date.now() });
    } catch (e) {
      console.error('Error in online status listener:', e);
    }
  });
}

// Global event subscription
export function onOnlineStatusChange(callback) {
  eventListeners.push(callback);
  return () => {
    const idx = eventListeners.indexOf(callback);
    if (idx > -1) eventListeners.splice(idx, 1);
  };
}

export default function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [wasOffline, setWasOffline] = useState(false);
  const [lastOnlineTime, setLastOnlineTime] = useState(() => {
    // Initialize from sessionStorage
    const saved = sessionStorage.getItem('spicehub_lastOnlineTime');
    return saved ? new Date(saved) : new Date();
  });

  const offlineTimeoutRef = useRef(null);
  const processingRef = useRef(false);

  const updateOnlineStatus = useCallback((newStatus) => {
    // Prevent multiple simultaneous updates
    if (processingRef.current) return;
    processingRef.current = true;

    // Clear any pending offline timeout
    if (offlineTimeoutRef.current) {
      clearTimeout(offlineTimeoutRef.current);
      offlineTimeoutRef.current = null;
    }

    if (newStatus === true) {
      // Going online: update immediately
      setIsOnline(true);
      setLastOnlineTime(new Date());
      sessionStorage.setItem('spicehub_lastOnlineTime', new Date().toISOString());

      // Emit event for other listeners (imports, sync, etc)
      emitOnlineEvent(true);

      // Broadcast to other tabs via storage event
      localStorage.setItem(EVENT_KEY, JSON.stringify({
        status: 'online',
        timestamp: Date.now(),
      }));

      processingRef.current = false;
    } else {
      // Going offline: debounce to avoid flaky network issues
      offlineTimeoutRef.current = setTimeout(() => {
        setIsOnline(false);
        setWasOffline(true);

        // Emit event
        emitOnlineEvent(false);

        // Broadcast to other tabs
        localStorage.setItem(EVENT_KEY, JSON.stringify({
          status: 'offline',
          timestamp: Date.now(),
        }));

        processingRef.current = false;
      }, OFFLINE_DEBOUNCE_MS);
    }
  }, []);

  // Listen to navigator.onLine events
  useEffect(() => {
    const handleOnline = () => updateOnlineStatus(true);
    const handleOffline = () => updateOnlineStatus(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [updateOnlineStatus]);

  // Listen to cross-tab storage events
  useEffect(() => {
    const handleStorageChange = (e) => {
      if (e.key !== EVENT_KEY) return;

      try {
        const data = JSON.parse(e.newValue || '{}');
        if (data.status === 'online') {
          setIsOnline(true);
          setLastOnlineTime(new Date());
        } else if (data.status === 'offline') {
          setIsOnline(false);
          setWasOffline(true);
        }
      } catch {}
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (offlineTimeoutRef.current) {
        clearTimeout(offlineTimeoutRef.current);
      }
    };
  }, []);

  return {
    isOnline,
    wasOffline,
    lastOnlineTime,
  };
}

import { useEffect, useRef, useState, useCallback } from 'react';
import { haptic } from '../lib/landingHelpers.js';

/**
 * Custom hook to detect physical device shake motion using DeviceMotionEvent.
 * Triggers callback `onShake` when acceleration threshold is exceeded.
 */
export default function useShakeToSpin(onShake, options = {}) {
  const { threshold = 15, cooldownMs = 1500, enabled = true } = options;
  const lastShakeTs = useRef(0);
  const [isSupported, setIsSupported] = useState(false);
  const [needsPermission, setNeedsPermission] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
      setIsSupported(false);
      return;
    }

    setIsSupported(true);

    // iOS 13+ permission check requirement
    if (typeof DeviceMotionEvent.requestPermission === 'function') {
      setNeedsPermission(true);
    }
  }, []);

  const requestPermission = useCallback(async () => {
    if (typeof DeviceMotionEvent?.requestPermission === 'function') {
      try {
        const response = await DeviceMotionEvent.requestPermission();
        if (response === 'granted') {
          setNeedsPermission(false);
          return true;
        }
      } catch (err) {
        console.warn('[useShakeToSpin] Motion permission request failed:', err);
      }
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    if (!enabled || !isSupported || needsPermission) return;

    let lastX = null;
    let lastY = null;
    let lastZ = null;

    const handleMotion = (event) => {
      const acc = event.accelerationIncludingGravity || event.acceleration;
      if (!acc) return;

      const { x, y, z } = acc;
      if (x === null || y === null || z === null) return;

      if (lastX === null) {
        lastX = x;
        lastY = y;
        lastZ = z;
        return;
      }

      const deltaX = Math.abs(x - lastX);
      const deltaY = Math.abs(y - lastY);
      const deltaZ = Math.abs(z - lastZ);
      const totalDelta = deltaX + deltaY + deltaZ;

      lastX = x;
      lastY = y;
      lastZ = z;

      if (totalDelta > threshold) {
        const now = Date.now();
        if (now - lastShakeTs.current > cooldownMs) {
          lastShakeTs.current = now;
          try {
            if ('vibrate' in navigator) navigator.vibrate([40, 30, 40]);
          } catch {}
          haptic('medium');
          if (onShake) onShake();
        }
      }
    };

    window.addEventListener('devicemotion', handleMotion, true);
    return () => {
      window.removeEventListener('devicemotion', handleMotion, true);
    };
  }, [enabled, isSupported, needsPermission, threshold, cooldownMs, onShake]);

  return { isSupported, needsPermission, requestPermission };
}

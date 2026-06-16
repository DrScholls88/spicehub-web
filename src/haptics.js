/**
 * SpiceHub haptic feedback utility.
 * Wraps navigator.vibrate with named patterns for consistency.
 * Safe to call on platforms that don't support vibration (desktop, iOS).
 */

const SUPPORTED = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';

/**
 * Tap — primary action (save, confirm, spin)
 * Short, crisp: 12ms
 */
export function hapticTap() {
  if (SUPPORTED) navigator.vibrate(12);
}

/**
 * Success — positive confirmation (import complete, saved)
 * Two quick pulses: 10ms on, 60ms off, 20ms on
 */
export function hapticSuccess() {
  if (SUPPORTED) navigator.vibrate([10, 60, 20]);
}

/**
 * Light — minor interactions (toggle, check, dismiss)
 * Very short: 8ms
 */
export function hapticLight() {
  if (SUPPORTED) navigator.vibrate(8);
}

/**
 * Error — negative feedback (import failed, validation error)
 * Double tap: 15ms on, 50ms off, 15ms on
 */
export function hapticError() {
  if (SUPPORTED) navigator.vibrate([15, 50, 15]);
}

/**
 * Detect if running on a mobile/tablet device.
 * Used only for UI hints — NOT for disabling features.
 * The browser import feature works on all devices because the PC's server
 * handles Chrome automation; the phone just polls for results over the network.
 */
export function isMobileDevice() {
  const ua = navigator.userAgent;
  return /android|webos|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(ua);
}

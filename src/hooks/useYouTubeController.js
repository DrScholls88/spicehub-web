import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * useYouTubeController — pure, UI-free control of a YouTube embed iframe via the
 * IFrame Player API postMessage protocol. No external script is loaded; we speak
 * the protocol directly with window.postMessage to the iframe's contentWindow.
 *
 * REQUIREMENTS on the iframe this hook drives:
 *   • Its src MUST include `enablejsapi=1` (otherwise the player ignores commands
 *     and never emits onReady — the hook degrades gracefully: ready stays false,
 *     play/pause/seekTo become silent no-ops).
 *   • The embed host is youtube-nocookie.com (see videoSource.js). We post commands
 *     with targetOrigin 'https://www.youtube-nocookie.com', and accept inbound
 *     events from BOTH youtube.com and youtube-nocookie.com origins.
 *
 * Usage:
 *   const iframeRef = useRef(null);
 *   const { play, pause, seekTo, playState, ready } = useYouTubeController(iframeRef);
 *   // <iframe ref={iframeRef} src="https://www.youtube-nocookie.com/embed/ID?enablejsapi=1&..." />
 *
 * Returns:
 *   {
 *     play():  void   — request playback   (no-op until/unless ready)
 *     pause(): void   — request pause       (no-op until/unless ready)
 *     seekTo(seconds: number, allowSeekAhead = true): void — jump to time (no-op until ready)
 *     playState: -1 | 0 | 1 | 2 | 3 | 5     — YT.PlayerState (-1 unstarted, 0 ended,
 *                                              1 playing, 2 paused, 3 buffering, 5 cued)
 *     ready: boolean  — true once the player has answered onReady
 *   }
 *
 * Notes / assumptions:
 *   • Never throws. Every contentWindow access is wrapped in try/catch.
 *   • For non-controllable embeds (e.g. Instagram, canControl:false) the iframe
 *     simply never answers; ready stays false and all methods are inert.
 *   • The 'message' listener is attached once and cleaned up on unmount. We also
 *     re-send the handshake whenever the iframe element identity changes (e.g. a
 *     new video is loaded into a fresh iframe), keyed off iframeRef.current.
 */

// Accept inbound player events from either YouTube origin.
const ALLOWED_ORIGINS = [
  'https://www.youtube.com',
  'https://youtube.com',
  'https://www.youtube-nocookie.com',
  'https://youtube-nocookie.com',
];

// Embeds in this app use the nocookie host, so commands target it.
const COMMAND_TARGET_ORIGIN = 'https://www.youtube-nocookie.com';

export default function useYouTubeController(iframeRef) {
  const [ready, setReady] = useState(false);
  const [playState, setPlayState] = useState(-1);

  // Keep latest "ready" in a ref so command callbacks stay stable but accurate.
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // Low-level: post a JSON command to the player. Fully guarded; never throws.
  const postCommand = useCallback(
    (func, args = []) => {
      const iframe = iframeRef && iframeRef.current;
      if (!iframe) return;
      let win = null;
      try {
        win = iframe.contentWindow;
      } catch {
        win = null;
      }
      if (!win) return;
      try {
        win.postMessage(
          JSON.stringify({ event: 'command', func, args }),
          COMMAND_TARGET_ORIGIN
        );
      } catch {
        /* cross-origin / detached frame — silently ignore */
      }
    },
    [iframeRef]
  );

  // Send the listening handshake so the player begins emitting events to us.
  const sendHandshake = useCallback(() => {
    const iframe = iframeRef && iframeRef.current;
    if (!iframe) return;
    let win = null;
    try {
      win = iframe.contentWindow;
    } catch {
      win = null;
    }
    if (!win) return;
    try {
      win.postMessage(
        JSON.stringify({ event: 'listening', id: 'spicehub-yt' }),
        COMMAND_TARGET_ORIGIN
      );
    } catch {
      /* ignore */
    }
  }, [iframeRef]);

  // Public API — stable identities, internally gated on readiness.
  const play = useCallback(() => {
    if (!readyRef.current) return;
    postCommand('playVideo');
  }, [postCommand]);

  const pause = useCallback(() => {
    if (!readyRef.current) return;
    postCommand('pauseVideo');
  }, [postCommand]);

  const seekTo = useCallback(
    (seconds, allowSeekAhead = true) => {
      if (!readyRef.current) return;
      const s = Number(seconds);
      if (!Number.isFinite(s) || s < 0) return;
      postCommand('seekTo', [s, !!allowSeekAhead]);
    },
    [postCommand]
  );

  // Listen for player events + drive the handshake.
  // Keyed on the current iframe element so a swapped-in iframe re-handshakes.
  const iframeEl = iframeRef && iframeRef.current;
  useEffect(() => {
    // Reset state for the (possibly new) iframe.
    setReady(false);
    setPlayState(-1);
    readyRef.current = false;

    const handleMessage = (event) => {
      // Origin gate — ignore anything not from a YouTube origin.
      if (!ALLOWED_ORIGINS.includes(event.origin)) return;

      let data = event.data;
      if (typeof data === 'string') {
        try {
          data = JSON.parse(data);
        } catch {
          return; // not a JSON player message
        }
      }
      if (!data || typeof data !== 'object') return;

      const ev = data.event;
      if (ev === 'onReady' || ev === 'initialDelivery') {
        setReady(true);
        readyRef.current = true;
        // initialDelivery often carries an info bundle with playerState.
        if (data.info && typeof data.info.playerState === 'number') {
          setPlayState(data.info.playerState);
        }
        return;
      }

      if (ev === 'onStateChange') {
        // info may be the numeric state directly, or nested.
        let state = data.info;
        if (state && typeof state === 'object' && typeof state.playerState === 'number') {
          state = state.playerState;
        }
        if (typeof state === 'number') setPlayState(state);
        // Receiving any event implies the player is alive/ready.
        if (!readyRef.current) {
          setReady(true);
          readyRef.current = true;
        }
        return;
      }

      if (ev === 'infoDelivery' && data.info && typeof data.info.playerState === 'number') {
        setPlayState(data.info.playerState);
        if (!readyRef.current) {
          setReady(true);
          readyRef.current = true;
        }
      }
    };

    window.addEventListener('message', handleMessage);

    // Kick off the handshake. The iframe may not have loaded yet, so try a few
    // times; once the player is alive it will answer and we stop needing this.
    let attempts = 0;
    sendHandshake();
    const interval = setInterval(() => {
      attempts += 1;
      if (readyRef.current || attempts > 10) {
        clearInterval(interval);
        return;
      }
      sendHandshake();
    }, 500);

    // Also re-handshake on the iframe's load event (covers late/initial loads).
    let onLoad = null;
    const iframe = iframeRef && iframeRef.current;
    if (iframe && typeof iframe.addEventListener === 'function') {
      onLoad = () => sendHandshake();
      try {
        iframe.addEventListener('load', onLoad);
      } catch {
        onLoad = null;
      }
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(interval);
      if (iframe && onLoad) {
        try {
          iframe.removeEventListener('load', onLoad);
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeEl, sendHandshake]);

  return { play, pause, seekTo, playState, ready };
}

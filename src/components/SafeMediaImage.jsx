import { useState, useEffect, useCallback } from 'react';

/** Inline shimmer skeleton — no external CSS dependency needed */
const shimmerStyle = (style) => ({
  ...style,
  background: 'linear-gradient(90deg, var(--surface, #f0f0f0) 25%, var(--surface-alt, #e4e4e4) 50%, var(--surface, #f0f0f0) 75%)',
  backgroundSize: '200% 100%',
  animation: 'smi-shimmer 1.4s ease-in-out infinite',
  borderRadius: style?.borderRadius || '8px',
  flexShrink: style?.flexShrink ?? 0,
});

const shimmerKeyframes = `
@keyframes smi-shimmer {
  0%   { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}`;

// Inject keyframes once into <head>
if (typeof document !== 'undefined' && !document.getElementById('smi-keyframes')) {
  const s = document.createElement('style');
  s.id = 'smi-keyframes';
  s.textContent = shimmerKeyframes;
  document.head.appendChild(s);
}

/** Returns true for Instagram / Facebook CDN URLs that will 403 when accessed cross-origin */
function isInstagramCdnUrl(url) {
  return /instagram|fbcdn|cdninstagram|scontent/.test(url);
}

/**
 * SafeMediaImage — Renders images with smart fallback chain:
 *   1. data: URLs → use directly (already persisted, works offline)
 *   2. Instagram/FB CDN URLs → proxy via /api/proxy?mode=image-data-url
 *      (ProxiedImage handles the async fetch + falls back to emoji on 403/error)
 *   3. Other URLs → use directly (browser handles caching)
 *   4. On error for non-Instagram → allorigins proxy retry once
 *   5. Final fallback → emoji placeholder
 *
 * Loading state shows a CSS shimmer skeleton.
 * All <img> elements use loading="lazy" + decoding="async" for better paint perf.
 */
export default function SafeMediaImage({ src, alt, style, fallbackEmoji = '🍳', ...props }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [hasError, setHasError] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    setHasError(false);
    setRetryCount(0);

    if (!src) {
      setHasError(true);
      return;
    }

    // data: URLs are self-contained — best case (already persisted at import)
    if (src.startsWith('data:')) {
      setImgSrc(src);
      return;
    }

    // Instagram/FB CDN URLs need proxying — they expire and block cross-origin
    if (isInstagramCdnUrl(src)) {
      setImgSrc(`/api/proxy?mode=image-data-url&url=${encodeURIComponent(src)}`);
      return;
    }

    // All other URLs — use directly
    setImgSrc(src);
  }, [src]);

  const handleError = useCallback(() => {
    // For Instagram URLs: don't bother with allorigins (it can't access these either)
    // Go straight to emoji fallback to avoid spamming failed requests.
    if (src && isInstagramCdnUrl(src)) {
      setHasError(true);
      return;
    }
    // For other URLs: retry once with allorigins before giving up
    if (retryCount === 0 && src && !src.startsWith('data:')) {
      setRetryCount(1);
      setImgSrc(`https://api.allorigins.win/raw?url=${encodeURIComponent(src)}`);
      return;
    }
    setHasError(true);
  }, [src, retryCount]);

  if (hasError || !imgSrc) {
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface, #f5f5f5)',
          fontSize: '42px',
          borderRadius: style?.borderRadius || '8px',
          flexShrink: style?.flexShrink ?? 0,
        }}
        aria-label={alt || fallbackEmoji}
        role="img"
      >
        {fallbackEmoji}
      </div>
    );
  }

  // For the image-data-url proxy, delegate to ProxiedImage which handles async JSON parsing
  if (imgSrc.includes('mode=image-data-url')) {
    return (
      <ProxiedImage
        src={imgSrc}
        originalSrc={src}
        alt={alt}
        style={style}
        fallbackEmoji={fallbackEmoji}
        onFinalError={handleError}
        {...props}
      />
    );
  }

  return (
    <img
      src={imgSrc}
      alt={alt || ''}
      style={style}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={handleError}
      {...props}
    />
  );
}

/**
 * ProxiedImage — Fetches a data URL from the image proxy and renders it.
 * Shows a shimmer skeleton while the proxy fetch is in-flight.
 *
 * On 403 / proxy error: immediately shows emoji placeholder (no allorigins retry —
 * Instagram CDN blocks that too, and retrying causes the 403 console spam).
 */
function ProxiedImage({ src, originalSrc, alt, style, fallbackEmoji, onFinalError, ...props }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    setDataUrl(null);

    fetch(src)
      .then(r => {
        if (!r.ok) {
          // 403, 404, etc — the CDN token has expired; bail out quietly
          return null;
        }
        return r.json();
      })
      .then(data => {
        if (cancelled) return;
        if (data?.dataUrl) {
          setDataUrl(data.dataUrl);
        } else {
          // Proxy returned no data — show emoji placeholder
          // (do NOT retry with allorigins for Instagram CDN — it will also fail)
          setFailed(true);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setFailed(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [src, originalSrc]);

  // Shimmer skeleton while fetching from proxy
  if (loading) {
    return <div style={shimmerStyle(style)} aria-hidden="true" />;
  }

  if (failed || !dataUrl) {
    return (
      <div
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--surface, #f5f5f5)',
          fontSize: '42px',
          borderRadius: style?.borderRadius || '8px',
          flexShrink: style?.flexShrink ?? 0,
        }}
        aria-label={alt || fallbackEmoji}
        role="img"
      >
        {fallbackEmoji}
      </div>
    );
  }

  return (
    <img
      src={dataUrl}
      alt={alt || ''}
      style={style}
      loading="lazy"
      decoding="async"
      referrerPolicy="no-referrer"
      onError={onFinalError}
      {...props}
    />
  );
}

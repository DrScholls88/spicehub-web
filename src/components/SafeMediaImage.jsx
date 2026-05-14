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

/**
 * SafeMediaImage — Renders images with smart fallback chain:
 *   1. data: URLs → use directly (already persisted, works offline)
 *   2. Instagram/FB CDN URLs → proxy via /api/proxy?mode=image-data-url
 *   3. Other URLs → use directly (browser handles caching)
 *   4. On error → allorigins proxy fallback
 *   5. Final fallback → emoji placeholder
 *
 * Loading state shows a CSS shimmer skeleton instead of an emoji/spinner.
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

    // data: URLs are self-contained — use directly (best case: already persisted at import)
    if (src.startsWith('data:')) {
      setImgSrc(src);
      return;
    }

    // Instagram/FB CDN URLs need proxying — they expire and block cross-origin
    if (/instagram|fbcdn|cdninstagram|scontent/.test(src)) {
      setImgSrc(`/api/proxy?mode=image-data-url&url=${encodeURIComponent(src)}`);
      return;
    }

    // All other URLs — use directly
    setImgSrc(src);
  }, [src]);

  const handleError = useCallback(() => {
    // Retry once with allorigins proxy before giving up
    if (retryCount === 0 && src && !src.startsWith('data:')) {
      setRetryCount(1);
      setImgSrc(`https://api.allorigins.win/raw?url=${encodeURIComponent(src)}`);
      return;
    }
    setHasError(true);
    if (import.meta.env.DEV) console.warn('[SafeMediaImage] All sources failed for:', src);
  }, [src, retryCount]);

  // Handle the special case where image-data-url returns JSON instead of an image
  const handleLoad = useCallback((e) => {
    if (imgSrc?.includes('mode=image-data-url') && e.target.naturalWidth === 0) {
      handleError();
    }
  }, [imgSrc, handleError]);

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
      onLoad={handleLoad}
      {...props}
    />
  );
}

/**
 * ProxiedImage — Fetches a data URL from the image proxy and renders it.
 * Shows a shimmer skeleton while the proxy fetch is in-flight.
 */
function ProxiedImage({ src, originalSrc, alt, style, fallbackEmoji, onFinalError, ...props }) {
  const [dataUrl, setDataUrl] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    fetch(src)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled) return;
        if (data?.dataUrl) {
          setDataUrl(data.dataUrl);
        } else {
          // Proxy returned no data — fall back to allorigins
          setDataUrl(`https://api.allorigins.win/raw?url=${encodeURIComponent(originalSrc)}`);
        }
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl(`https://api.allorigins.win/raw?url=${encodeURIComponent(originalSrc)}`);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [src, originalSrc]);

  // Shimmer skeleton while fetching from proxy
  if (loading) {
    return <div style={shimmerStyle(style)} aria-hidden="true" />;
  }

  if (!dataUrl) {
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

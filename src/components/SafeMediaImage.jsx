import { useState, useEffect, useCallback } from 'react';

/**
 * SafeMediaImage — Renders images with smart fallback chain:
 *   1. data: URLs → use directly (already persisted, works offline)
 *   2. Instagram/FB CDN URLs → proxy via /api/proxy?mode=image-data-url
 *   3. Other URLs → use directly (browser handles caching)
 *   4. On error → allorigins proxy fallback
 *   5. Final fallback → emoji placeholder
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
      // Use Vercel serverless proxy for reliable server-side fetch
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
    // If the proxy returned JSON (data URL response), parse it
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
        }}
      >
        {fallbackEmoji}
      </div>
    );
  }

  // For the image-data-url proxy, we need to fetch the JSON and extract the data URL
  if (imgSrc.includes('mode=image-data-url')) {
    return <ProxiedImage src={imgSrc} originalSrc={src} alt={alt} style={style} fallbackEmoji={fallbackEmoji} onFinalError={handleError} {...props} />;
  }

  return (
    <img
      src={imgSrc}
      alt={alt || ''}
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={handleError}
      onLoad={handleLoad}
      {...props}
    />
  );
}

/**
 * ProxiedImage — Fetches a data URL from the image proxy and renders it.
 * This handles the case where /api/proxy?mode=image-data-url returns JSON.
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
          // Proxy failed — try allorigins as final fallback
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

  if (loading) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface, #f5f5f5)', fontSize: '24px', opacity: 0.5 }}>
        ⏳
      </div>
    );
  }

  if (!dataUrl) {
    return (
      <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface, #f5f5f5)', fontSize: '42px' }}>
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
      referrerPolicy="no-referrer"
      onError={onFinalError}
      {...props}
    />
  );
}
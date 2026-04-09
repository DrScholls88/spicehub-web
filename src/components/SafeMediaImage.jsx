import { useState, useEffect } from 'react';

export default function SafeMediaImage({ src, alt, style, fallbackEmoji = '🍳', ...props }) {
  const [imgSrc, setImgSrc] = useState(null);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    if (!src) {
      setHasError(true);
      return;
    }
    // Proxy any external Instagram/FB CDN URL
    if (src.includes('instagram') || src.includes('fbcdn') || src.includes('cdninstagram')) {
      const encoded = encodeURIComponent(src);
      setImgSrc(`/media-proxy/${encoded}`);
    } else {
      setImgSrc(src); // local or trusted URLs
    }
  }, [src]);

  if (hasError || !imgSrc) {
    return <div style={{ ...style, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--surface)', fontSize: '42px' }}>{fallbackEmoji}</div>;
  }

  return (
    <img
      src={imgSrc}
      alt={alt || ''}
      style={style}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => {
        setHasError(true);
        if (import.meta.env.DEV) console.warn('Media proxy failed for:', src);
      }}
      {...props}
    />
  );
}
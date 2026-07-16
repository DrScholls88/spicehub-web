import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, WifiOff, RefreshCw, ArrowUpRight, Search } from 'lucide-react';
import { fetchDiscoveryFeed, filterPosts, clearDiscoveryCache, DISCOVER_CATEGORIES } from '../scrapers/blogDiscovery';
import { hapticLight } from '../haptics';
import SafeMediaImage from './SafeMediaImage';
import './DiscoverRecipes.css';

// Redesigned Discovery surface: multi-source recipe blog aggregator.
// Replaces the Reddit-only feed (which required OAuth credentials and kept
// 403'ing) with a zero-auth RSS-based system that scrapes ~10 popular
// recipe blogs server-side and returns unified JSON.
//
// UX: search bar, source pills (horizontal scroll), category chips,
// recipe cards with source badge + snippet. Tap → import pipeline.

export default function DiscoverRecipes({ onClose, onSelectUrl }) {
  // ─── State ───────────────────────────────────────────────────────────
  const [allPosts, setAllPosts] = useState([]);
  const [sources, setSources] = useState({}); // { key: { name, emoji, tags } }
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeCategory, setActiveCategory] = useState('all');
  const [activeSource, setActiveSource] = useState('all');
  const [searchText, setSearchText] = useState('');
  const searchRef = useRef(null);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  // ─── Load feed ───────────────────────────────────────────────────────
  const loadFeed = useCallback(async ({ force = false } = {}) => {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    setLoading(true);
    setError(null);
    try {
      if (force) clearDiscoveryCache();
      const data = await fetchDiscoveryFeed({ force });
      setAllPosts(data.posts || []);
      setSources(data.sources || {});
    } catch (err) {
      console.error('[discover] Feed load failed:', err);
      setError(err.message || 'Failed to load recipes');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadFeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Filtered posts ──────────────────────────────────────────────────
  const filteredPosts = useMemo(() =>
    filterPosts(allPosts, {
      categoryId: activeCategory,
      sourceKey: activeSource,
      search: searchText,
    }),
    [allPosts, activeCategory, activeSource, searchText]
  );

  // ─── Handlers ────────────────────────────────────────────────────────
  const handleCategoryTap = (id) => {
    hapticLight();
    setActiveCategory(id);
  };

  const handleSourceTap = (key) => {
    hapticLight();
    setActiveSource(key === activeSource ? 'all' : key);
  };

  const handleSelect = (post) => {
    hapticLight();
    onSelectUrl(post.link);
  };

  const handleRefresh = () => {
    hapticLight();
    loadFeed({ force: true });
  };

  // Source list for the pills row
  const sourceList = useMemo(() => {
    const list = [{ key: 'all', name: 'All Sources', emoji: '✨' }];
    for (const [key, src] of Object.entries(sources)) {
      list.push({ key, name: src.name, emoji: src.emoji });
    }
    return list;
  }, [sources]);

  // Time-ago helper
  const timeAgo = (dateStr) => {
    if (!dateStr) return '';
    try {
      const diff = Date.now() - new Date(dateStr).getTime();
      const days = Math.floor(diff / 86400000);
      if (days === 0) return 'Today';
      if (days === 1) return 'Yesterday';
      if (days < 7) return `${days}d ago`;
      if (days < 30) return `${Math.floor(days / 7)}w ago`;
      return `${Math.floor(days / 30)}mo ago`;
    } catch { return ''; }
  };

  return (
    <div className="discover-overlay" onClick={onClose}>
      <motion.div
        className="discover-sheet"
        onClick={e => e.stopPropagation()}
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
      >
        <div className="st-handle" />

        {/* ── Header ────────────────────────────────────────────── */}
        <div className="discover-header">
          <div>
            <h2 className="discover-title">Discover Recipes</h2>
            <p className="discover-subtitle">Fresh picks from top recipe blogs</p>
          </div>
          <div className="discover-header-actions">
            {!isOffline && (
              <button
                className="discover-refresh-btn"
                onClick={handleRefresh}
                disabled={loading}
                aria-label="Refresh"
              >
                <RefreshCw size={15} strokeWidth={2.5} className={loading ? 'discover-spin' : ''} />
              </button>
            )}
            <button className="st-close" onClick={onClose} aria-label="Close">
              <X size={18} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {isOffline ? (
          <div className="discover-offline">
            <WifiOff size={28} strokeWidth={1.75} />
            <p>Discover needs an internet connection.</p>
            <p className="discover-offline-hint">Your saved meals still work fully offline — this is just for finding new ones.</p>
          </div>
        ) : (
          <>
            {/* ── Search ──────────────────────────────────────────── */}
            <div className="discover-search-wrap">
              <Search size={15} strokeWidth={2.5} className="discover-search-icon" />
              <input
                ref={searchRef}
                type="text"
                className="discover-search"
                placeholder="Search recipes…"
                value={searchText}
                onChange={e => setSearchText(e.target.value)}
                aria-label="Search recipes"
              />
              {searchText && (
                <button
                  className="discover-search-clear"
                  onClick={() => { setSearchText(''); searchRef.current?.focus(); }}
                  aria-label="Clear search"
                >
                  <X size={14} strokeWidth={2.5} />
                </button>
              )}
            </div>

            {/* ── Source pills ─────────────────────────────────────── */}
            <div className="discover-sources" role="tablist" aria-label="Recipe sources">
              {sourceList.map(src => (
                <button
                  key={src.key}
                  role="tab"
                  aria-selected={activeSource === src.key}
                  className={`discover-source-pill${activeSource === src.key ? ' discover-source-pill-active' : ''}`}
                  onClick={() => handleSourceTap(src.key)}
                >
                  <span aria-hidden="true">{src.emoji}</span>
                  <span className="discover-source-pill-name">{src.name}</span>
                </button>
              ))}
            </div>

            {/* ── Category chips ───────────────────────────────────── */}
            <div className="discover-chips" role="tablist" aria-label="Recipe categories">
              {DISCOVER_CATEGORIES.map(cat => (
                <button
                  key={cat.id}
                  role="tab"
                  aria-selected={activeCategory === cat.id}
                  className={`discover-chip${activeCategory === cat.id ? ' discover-chip-active' : ''}`}
                  onClick={() => handleCategoryTap(cat.id)}
                >
                  <span aria-hidden="true">{cat.emoji}</span> {cat.label}
                </button>
              ))}
            </div>

            {/* ── Results ──────────────────────────────────────────── */}
            <div className="discover-results">
              {loading && (
                <div className="discover-status">
                  <Loader2 size={22} className="discover-spin" strokeWidth={2} />
                  <span>Finding recipes from top blogs…</span>
                </div>
              )}

              {!loading && error && (
                <div className="discover-status">
                  <span>Couldn't reach recipe sources right now.</span>
                  <button className="discover-retry" onClick={handleRefresh}>
                    <RefreshCw size={14} strokeWidth={2.5} /> Try again
                  </button>
                </div>
              )}

              {!loading && !error && filteredPosts.length === 0 && (
                <div className="discover-status">
                  {searchText || activeCategory !== 'all' || activeSource !== 'all' ? (
                    <span>No recipes match your filters — try broadening your search.</span>
                  ) : (
                    <span>No recipes found right now — try refreshing.</span>
                  )}
                </div>
              )}

              {!loading && !error && filteredPosts.length > 0 && (
                <AnimatePresence initial={false}>
                  {filteredPosts.map((post, idx) => (
                    <motion.button
                      key={post.link}
                      className="discover-card"
                      onClick={() => handleSelect(post)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx * 0.025, 0.3), duration: 0.2 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="discover-card-thumb">
                        <SafeMediaImage
                          src={post.imageUrl}
                          alt=""
                          className="discover-card-img"
                          fallbackEmoji="🍽️"
                        />
                      </div>
                      <div className="discover-card-body">
                        <span className="discover-card-title">{post.title}</span>
                        <span className="discover-card-source">
                          {post.sourceEmoji} {post.sourceName}
                          {post.pubDate && <span className="discover-card-date"> · {timeAgo(post.pubDate)}</span>}
                        </span>
                        {post.snippet && (
                          <span className="discover-card-snippet">{post.snippet}</span>
                        )}
                      </div>
                      <ArrowUpRight size={16} strokeWidth={2.5} className="discover-card-arrow" aria-hidden="true" />
                    </motion.button>
                  ))}
                </AnimatePresence>
              )}

              {!loading && !error && filteredPosts.length > 0 && (
                <div className="discover-footer-note">
                  Showing {filteredPosts.length} recipe{filteredPosts.length !== 1 ? 's' : ''}
                  {activeSource !== 'all' || activeCategory !== 'all' || searchText ? ' (filtered)' : ''}
                </div>
              )}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

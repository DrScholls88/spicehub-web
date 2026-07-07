import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Loader2, WifiOff, RefreshCw, ArrowUpRight } from 'lucide-react';
import { discoverRedditRecipes } from '../scrapers/redditDiscovery';
import { hapticLight } from '../haptics';
import SafeMediaImage from './SafeMediaImage';
import './DiscoverRecipes.css';

// Gemini UX audit (2026-07-06, action item #6/#9): the app already had a
// zero-auth Reddit discovery scraper (scrapers/redditDiscovery.js) sitting
// completely unwired — no UI ever called discoverRedditRecipes(). Single-post
// Reddit URL import already worked (recipeParser.js routes any reddit.com URL
// through tryRedditJson), so this component is purely the missing "browse and
// find something new" surface. Per the audit's "Curated Discoverability"
// recommendation, this shows a small, fixed set of subreddit categories
// instead of an open-ended feed/search — bounded scope, predictable quality.
//
// Architecture note (audit #7/#8): "My Meals" stays fully offline/local —
// this component only ever READS from the network on-demand when the user
// opens it, and never touches the local Dexie library directly. Selecting a
// result hands its URL back to the same import pipeline every other recipe
// URL goes through (App.jsx handleQuickImport → ImportSheet), so there's no
// parallel/duplicate import code path to maintain.

const CATEGORIES = [
  { id: 'weeknight', label: 'Quick Weeknight', emoji: '⚡', subreddit: 'EatCheapAndHealthy', sort: 'hot' },
  { id: 'comfort', label: 'Comfort Food', emoji: '🍲', subreddit: 'recipes', sort: 'hot' },
  { id: 'vegetarian', label: 'Vegetarian & Vegan', emoji: '🥕', subreddit: 'veganrecipes', sort: 'hot' },
  { id: 'mealprep', label: 'Meal Prep', emoji: '📦', subreddit: 'MealPrepSunday', sort: 'hot' },
  { id: 'baking', label: 'Baking & Sweets', emoji: '🧁', subreddit: 'Baking', sort: 'hot' },
];

export default function DiscoverRecipes({ onClose, onSelectUrl }) {
  const [activeId, setActiveId] = useState(CATEGORIES[0].id);
  const [resultsByCategory, setResultsByCategory] = useState({});
  const [loadingId, setLoadingId] = useState(null);
  const [errorId, setErrorId] = useState(null);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  // Hardware back button is handled centrally by the parent (MealLibrary's
  // useBackHandler(showDiscover, ...) closes this the same way the X button
  // and overlay-click do — keeps one source of truth for the back stack.

  const loadCategory = useCallback(async (category, { force = false } = {}) => {
    if (!force && resultsByCategory[category.id]) return; // already cached
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return; // offline guard
    setLoadingId(category.id);
    setErrorId(null);
    try {
      const posts = await discoverRedditRecipes(category.subreddit, category.sort, 20);
      setResultsByCategory(prev => ({ ...prev, [category.id]: posts }));
      if (posts.length === 0) setErrorId(`${category.id}-empty`);
    } catch {
      setErrorId(category.id);
    } finally {
      setLoadingId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resultsByCategory]);

  // Load the first category on open — an empty "pick a category" screen would
  // just be a smaller version of the blank-library problem this whole
  // backlog item exists to avoid.
  useEffect(() => {
    loadCategory(CATEGORIES[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleCategoryTap = (category) => {
    hapticLight();
    setActiveId(category.id);
    loadCategory(category);
  };

  const handleSelect = (post) => {
    hapticLight();
    onSelectUrl(post.url);
  };

  const activeCategory = CATEGORIES.find(c => c.id === activeId);
  const results = resultsByCategory[activeId] || [];
  const isLoading = loadingId === activeId;
  const hasError = errorId === activeId;
  const isEmpty = errorId === `${activeId}-empty`;

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
        <div className="discover-header">
          <div>
            <h2 className="discover-title">Discover Recipes</h2>
            <p className="discover-subtitle">Browse recipe communities — tap one to import it</p>
          </div>
          <button className="st-close" onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={2.5} />
          </button>
        </div>

        {isOffline ? (
          <div className="discover-offline">
            <WifiOff size={28} strokeWidth={1.75} />
            <p>Discover needs an internet connection.</p>
            <p className="discover-offline-hint">Your saved meals still work fully offline — this is just for finding new ones.</p>
          </div>
        ) : (
          <>
            <div className="discover-chips" role="tablist" aria-label="Recipe categories">
              {CATEGORIES.map(category => (
                <button
                  key={category.id}
                  role="tab"
                  aria-selected={activeId === category.id}
                  className={`discover-chip${activeId === category.id ? ' discover-chip-active' : ''}`}
                  onClick={() => handleCategoryTap(category)}
                >
                  <span aria-hidden="true">{category.emoji}</span> {category.label}
                </button>
              ))}
            </div>

            <div className="discover-results">
              {isLoading && (
                <div className="discover-status">
                  <Loader2 size={22} className="discover-spin" strokeWidth={2} />
                  <span>Finding recipes in r/{activeCategory.subreddit}…</span>
                </div>
              )}

              {!isLoading && hasError && (
                <div className="discover-status">
                  <span>Couldn't reach r/{activeCategory.subreddit} right now.</span>
                  <button className="discover-retry" onClick={() => loadCategory(activeCategory, { force: true })}>
                    <RefreshCw size={14} strokeWidth={2.5} /> Try again
                  </button>
                </div>
              )}

              {!isLoading && isEmpty && (
                <div className="discover-status">
                  <span>No recipes found in r/{activeCategory.subreddit} right now — try another category.</span>
                </div>
              )}

              {!isLoading && !hasError && !isEmpty && (
                <AnimatePresence initial={false}>
                  {results.map((post, idx) => (
                    <motion.button
                      key={post.url}
                      className="discover-card"
                      onClick={() => handleSelect(post)}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: Math.min(idx * 0.03, 0.3), duration: 0.25 }}
                      whileTap={{ scale: 0.98 }}
                    >
                      <div className="discover-card-thumb">
                        <SafeMediaImage
                          src={post.imageUrl || post.thumbnail}
                          alt=""
                          className="discover-card-img"
                          fallbackEmoji="🍽️"
                        />
                      </div>
                      <div className="discover-card-body">
                        <span className="discover-card-title">{post.title}</span>
                        <span className="discover-card-meta">
                          r/{post.subreddit} · {post.score} upvotes{post.flair ? ` · ${post.flair}` : ''}
                        </span>
                      </div>
                      <ArrowUpRight size={16} strokeWidth={2.5} className="discover-card-arrow" aria-hidden="true" />
                    </motion.button>
                  ))}
                </AnimatePresence>
              )}
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}

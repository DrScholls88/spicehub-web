/**
 * AppSkeleton — the React twin of the boot skeleton in index.html.
 *
 * Why it exists (2026-08-24, PageSpeed remediation):
 * index.html now paints a static shell + skeleton from the HTML itself so that
 * FCP/LCP no longer wait on the ~484 KiB JS bundle. React's first commit
 * replaces the whole of #root atomically — so whatever App renders FIRST is
 * what the user sees the instant the bundle boots. If that first render were
 * the old `<div className="loading-screen"><div className="spinner" />` the
 * user would watch a fully-drawn shell collapse into a lone spinner and then
 * expand again: worse than no skeleton at all. Rendering the identical
 * structure here makes the handover invisible.
 *
 * DELIBERATELY SHIPS NO CSS FILE. Every `.sh-*` class used here is defined
 * once, in the inline critical <style> in index.html — it has to live there
 * because it must apply before the main stylesheet does, and a second copy in
 * App.css is precisely the two-copies-drift problem index.html's own CSP
 * comment records as a past bug. Restyle the skeleton there, not here.
 *
 * Keep the markup below byte-for-byte equivalent to the markup inside
 * <div id="root"> in index.html.
 */

const TABS = ['home', 'week', 'library', 'bar', 'grocery'];

/**
 * The bare content-area skeleton: title + hero + tile grid + rows, with no
 * header and no tab bar. Used as the Suspense fallback for lazily-loaded
 * full-screen tabs, where the real header and tab bar are already mounted
 * around it and must not be redrawn.
 */
export function ScreenSkeleton() {
  return (
    <div className="sh-skel-screen" role="status" aria-live="polite" aria-label="Loading">
      <div className="sh-skel sh-skel-title" />
      <div className="sh-skel sh-skel-hero" />
      <div className="sh-skel-grid">
        <div className="sh-skel sh-skel-tile" />
        <div className="sh-skel sh-skel-tile" />
        <div className="sh-skel sh-skel-tile" />
        <div className="sh-skel sh-skel-tile" />
      </div>
      <div className="sh-skel sh-skel-row" />
      <div className="sh-skel sh-skel-row" />
    </div>
  );
}

/**
 * The full-page skeleton: header + content + tab bar. Used for App's own
 * pre-data `loading` state, replacing the former spinner screen.
 */
export default function AppSkeleton() {
  return (
    <div className="sh-shell" role="status" aria-live="polite" aria-label="Loading SpiceHub">
      <header className="sh-shell-header">
        <span className="sh-shell-brand">
          <span className="sh-shell-brand-mark" aria-hidden="true">🌶️</span>
          <span>SpiceHub</span>
        </span>
        <span className="sh-shell-actions" aria-hidden="true">
          <span className="sh-skel sh-skel-badge" />
          <span className="sh-skel sh-skel-icon" />
          <span className="sh-skel sh-skel-icon" />
        </span>
      </header>
      <main className="sh-shell-main" aria-hidden="true">
        <div className="sh-skel sh-skel-title" />
        <div className="sh-skel sh-skel-hero" />
        <div className="sh-skel-grid">
          <div className="sh-skel sh-skel-tile" />
          <div className="sh-skel sh-skel-tile" />
          <div className="sh-skel sh-skel-tile" />
          <div className="sh-skel sh-skel-tile" />
        </div>
        <div className="sh-skel sh-skel-row" />
        <div className="sh-skel sh-skel-row" />
      </main>
      <nav className="sh-shell-tabs" aria-hidden="true">
        {TABS.map((t) => (
          <span key={t}><span className="sh-skel sh-skel-tabmark" /></span>
        ))}
      </nav>
    </div>
  );
}

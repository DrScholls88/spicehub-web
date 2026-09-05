/**
 * SettingsSheet — Settings Command Center (SettingsPlan.md PKG A).
 * Extracted from the inline block that used to live in App.jsx. Grouped
 * iOS-style sections: Identity → Display → App Health → Community →
 * Danger. Only mounted while `showSettings` is true (App.jsx renders this
 * conditionally), so hooks here don't need to guard on an `open` prop.
 *
 * iOS notes (see SettingsPlan.md "iOS-Hardened" plan):
 * - Grouped card wrappers use `overflow: visible`, never `overflow: hidden`
 *   + border-radius (iOS Safari compositing clips children incorrectly).
 * - All new tappable rows are ≥48px tall with touch-action: manipulation.
 * - navigator.vibrate() is dead on iOS — every tap that calls hapticLight()
 *   also gets the `.stg-pulse` scale-down as a universal visual fallback.
 */
import { useState, useCallback } from 'react';
import { ThemeSettings } from './ThemeProvider';
import HomeGroupSection from './HomeGroupSection';
import LegalFooter from './LegalFooter';
import ProfileCard from './ProfileCard';
import StorageSummaryBar from './StorageSummaryBar';
import useSwipeDismiss from '../hooks/useSwipeDismiss';
import { isFriendsEnabled } from '../lib/supabaseClient';
import { clearInstagramCache } from '../db.js';
import { hapticLight } from '../haptics';

export default function SettingsSheet({
  onClose,
  profile,
  onUpdateProfile,
  isOnline,
  showToast,
  homeGroup,
  meals,
  pendingRequestCount,
  pendingShareCount,
  onOpenFriends,
  isStandalone,
  deferredPrompt,
  isAndroid,
  isIOS,
  onInstallApp,
  setUpdateReady,
  onOpenStorageManager,
  onAddStarterKit,
  onRemoveStarterKit,
  // Set when the user arrived here from the Home banner, so the Shortcut
  // instructions are already open instead of hidden behind another tap.
  autoOpenIosShare = false,
}) {
  const swipe = useSwipeDismiss(onClose);

  const starterCount = meals.filter(m => m.starterKit).length;

  // The exact string the Shortcut's "URL" action needs. [Shortcut Input] is a
  // literal token iOS substitutes at run time — it is not a placeholder for
  // the user to fill in, which is precisely why this wants copying rather than
  // retyping from a <code> block on a phone.
  const shortcutUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/?share-target=1&url=[Shortcut Input]`;
  const [copiedShortcut, setCopiedShortcut] = useState(false);
  const handleCopyShortcutUrl = useCallback(async () => {
    hapticLight();
    try {
      await navigator.clipboard.writeText(shortcutUrl);
      setCopiedShortcut(true);
      setTimeout(() => setCopiedShortcut(false), 2000);
    } catch {
      // Clipboard can be refused (no permission, insecure context). The URL is
      // on screen either way, so say so rather than failing silently.
      showToast?.('Copy failed — long-press the URL above to copy it', 'info', 3500);
    }
  }, [shortcutUrl, showToast]);

  // 2026-08-09: iOS/iPadOS Safari has never implemented the Web Share Target
  // API (share_target in the manifest) — a home-screen-installed PWA cannot
  // register as an OS share-sheet destination the way it can on Android.
  // This is a WebKit platform limitation, not something fixable from app
  // code (confirmed against MDN's browser-compat table and Apple's own
  // WebKit feature-status page). The standard, zero-cost workaround is an
  // iOS Shortcut that forwards the shared link to SpiceHub's existing
  // GET-based share handler (App.jsx already listens for ?share-target=1).
  const [showIosShareHelp, setShowIosShareHelp] = useState(autoOpenIosShare);

  const handleCheckForUpdates = async () => {
    if (!navigator.onLine) {
      showToast?.("You're offline — can't check for updates", 'error', 3000);
      return;
    }
    showToast?.('Checking for updates…', 'info', 2000);
    try {
      const reg = window.__spicehubSWRegistration
        || (navigator.serviceWorker && await navigator.serviceWorker.getRegistration());
      if (!reg) { showToast?.('Updates need a browser reload to check', 'error', 3000); return; }
      await reg.update();
      // reg.update() resolves once sw.js has been re-fetched. A new build
      // shows up as an installing/waiting worker; the updatefound flow
      // (main.jsx) then surfaces the Refresh prompt.
      if (reg.waiting) {
        setUpdateReady?.(true);
        showToast?.('New version ready — tap Refresh above', 'success', 3000);
      } else if (reg.installing) {
        showToast?.('New version found — installing…', 'success', 3000);
      } else {
        showToast?.(`You're on the latest version (v${__SPICEHUB_VERSION__})`, 'success', 3000);
      }
    } catch {
      showToast?.('Could not check for updates — check your connection', 'error', 3000);
    }
  };

  // 2026-08-10: importFromInstagram short-circuits on a 7-day IndexedDB cache
  // keyed by url+type (recipeParser.js's importFromInstagram, line ~4907) —
  // BEFORE any extraction phase runs, including the blog-link-follower. A
  // shipped extraction-engine fix has no effect on a URL that was already
  // imported (successfully or not) in the last 7 days; the stale cached
  // result just gets replayed. BarLibrary.jsx already exposes this exact
  // clear as a dev/QA affordance for drink imports — this is the same
  // db.instagramCache.clear() call, surfaced on the meal side so users
  // aren't stuck re-hitting a pre-fix cached failure with no visible cause.
  const handleClearImportCache = async () => {
    hapticLight();
    try {
      await clearInstagramCache();
      showToast?.('Import cache cleared — next import will re-fetch fresh', 'success', 3000);
    } catch {
      showToast?.('Could not clear import cache', 'error', 3000);
    }
  };

  return (
    <div className="st-overlay" data-sheet-overlay onClick={onClose}>
      <div
        className="st-sheet"
        ref={swipe.sheetRef}
        onClick={e => e.stopPropagation()}
        onTouchStart={swipe.handleTouchStart}
        onTouchMove={swipe.handleTouchMove}
        onTouchEnd={swipe.handleTouchEnd}
      >
        <div className="st-handle" />
        <div className="st-header">
          <h2 className="st-title">⚙️ Settings</h2>
          <button className="st-close" onClick={onClose}>✕</button>
        </div>

        <div className="st-content">

          {/* ── Identity ─────────────────────────────────────────────── */}
          <div className="stg-section">
            <p className="stg-eyebrow">You</p>
            <div className="stg-group">
              <ProfileCard
                profile={profile}
                onUpdateProfile={onUpdateProfile}
                homeGroup={homeGroup}
                isOnline={isOnline}
                showToast={showToast}
              />
            </div>
          </div>

          {/* ── Display ──────────────────────────────────────────────── */}
          <div className="stg-section">
            <p className="stg-eyebrow">Display</p>
            <div className="stg-group stg-group-pad">
              <ThemeSettings />
            </div>
          </div>

          {/* ── App Health ───────────────────────────────────────────── */}
          <div className="stg-section">
            <p className="stg-eyebrow">App Health</p>
            <div className="stg-group">
              {!isStandalone && (deferredPrompt || isAndroid() || isIOS()) && (
                <button
                  type="button"
                  className="stg-row"
                  onClick={() => { localStorage.removeItem('pwa-install-dismissed'); onInstallApp(); }}
                >
                  <span className="stg-row-icon">📲</span>
                  <span className="stg-row-body">
                    {deferredPrompt || isAndroid() ? 'Install to phone' : 'Add to Home Screen'}
                  </span>
                </button>
              )}
              <button type="button" className="stg-row" onClick={handleCheckForUpdates}>
                <span className="stg-row-icon">🔄</span>
                <span className="stg-row-body">Check for Updates</span>
              </button>
              <button type="button" className="stg-row" onClick={handleClearImportCache}>
                <span className="stg-row-icon">🧹</span>
                <span className="stg-row-body">Clear Import Cache</span>
              </button>
              {isStandalone && isIOS() && (
                <button
                  type="button"
                  className="stg-row"
                  onClick={() => setShowIosShareHelp(v => !v)}
                >
                  <span className="stg-row-icon">📤</span>
                  <span className="stg-row-body">Add to iPhone/iPad Share Sheet</span>
                </button>
              )}
              <StorageSummaryBar meals={meals} onOpenFull={onOpenStorageManager} />
            </div>

            {isStandalone && isIOS() && showIosShareHelp && (
              <div className="stg-group stg-group-pad" style={{ marginTop: 10 }}>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
                  Apple's Safari doesn't let installed web apps show up in the
                  Share Sheet directly — that's an iOS limitation, not a
                  SpiceHub bug. A one-time Shortcut fixes it:
                </p>
                <ol style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0, paddingLeft: 18, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <li>Open the <strong>Shortcuts</strong> app → <strong>+</strong> to create a new Shortcut.</li>
                  <li>Add action <strong>"Get Text from Input"</strong> (accepts URLs from the share sheet).</li>
                  <li>Add action <strong>"URL"</strong>, set it to:<br />
                    {/* Built from the live origin, not a hard-coded
                        spicehub-web.vercel.app. On any other deployment (a
                        preview build, a custom domain, localhost) the literal
                        sent people to the wrong app entirely. */}
                    <code style={{ fontSize: 11, wordBreak: 'break-all' }}>{shortcutUrl}</code>
                    <br />
                    <button
                      type="button"
                      className="stg-inline-copy"
                      onClick={handleCopyShortcutUrl}
                    >
                      {copiedShortcut ? 'Copied' : 'Copy URL'}
                    </button>
                  </li>
                  <li>Add action <strong>"Open URLs"</strong> using that URL.</li>
                  <li>Rename the Shortcut "Save to SpiceHub", tap the settings icon, and enable <strong>"Show in Share Sheet"</strong> (accepting URLs/text).</li>
                </ol>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', margin: '10px 0 0' }}>
                  After that, "Save to SpiceHub" appears in the Share Sheet
                  from Instagram, Safari, or any app — same as Android.
                </p>
              </div>
            )}

            <div className="stg-group stg-group-pad" style={{ marginTop: 14 }}>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 10px' }}>
                {starterCount > 0
                  ? `${starterCount} starter recipe${starterCount === 1 ? '' : 's'} in your library — a curated pack to try Spin and your grocery list.`
                  : 'Load a curated pack of cookable recipes so Spin and your grocery list work right away.'}
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button className="st-install-btn" type="button" onClick={onAddStarterKit}>
                  <span className="st-install-icon">🍳</span>
                  <span>{starterCount > 0 ? 'Restore Missing Starter Recipes' : 'Add Starter Pack'}</span>
                </button>
                {starterCount > 0 && (
                  <button className="st-install-btn" type="button" onClick={onRemoveStarterKit}>
                    <span className="st-install-icon">🧹</span>
                    <span>Remove Starter Kit Recipes</span>
                  </button>
                )}
              </div>
            </div>
          </div>

          {/* ── Community ────────────────────────────────────────────── */}
          <div className="stg-section">
            <p className="stg-eyebrow">Community</p>
            <div className="stg-community-card">
              <HomeGroupSection
                homeGroup={homeGroup}
                profile={profile}
                isOnline={isOnline}
                onCreateGroup={homeGroup.createGroup}
                onJoinGroup={homeGroup.joinGroup}
                onLeaveGroup={homeGroup.leaveGroup}
                onSignIn={homeGroup.signIn}
                onSignOut={homeGroup.signOut}
                onRegenerateCode={homeGroup.regenerateInviteCode}
                showToast={showToast}
              />
              {isFriendsEnabled() && (
                <div className="st-section">
                  <h3>Friends</h3>
                  <button className="st-install-btn" onClick={onOpenFriends}>
                    <span className="st-install-icon">👤</span>
                    <span>
                      Manage Friends
                      {(pendingRequestCount + pendingShareCount) > 0
                        ? ` (${pendingRequestCount + pendingShareCount} new)`
                        : ''}
                    </span>
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* ── Danger Zone ──────────────────────────────────────────── */}
          {/*
            Sign out only reaches the user while signed-in-but-groupless
            (auth_no_group). It's intentionally absent while in_group: it
            tears down the Supabase session but keeps group membership and
            local data, which reads as a no-op next to "Leave group" (the
            opposite — drops membership, keeps the session). See the
            matching comment in HomeGroupSection.jsx.
          */}
          {homeGroup.state === 'auth_no_group' && (
            <div className="stg-section">
              <p className="stg-eyebrow stg-eyebrow-danger">Danger Zone</p>
              <div className="stg-group stg-danger">
                <button type="button" className="stg-row" onClick={homeGroup.signOut}>
                  <span className="stg-row-icon">🚪</span>
                  <span className="stg-row-body">Sign Out</span>
                </button>
              </div>
            </div>
          )}

          <div className="stg-section">
            <p className="stg-eyebrow">Legal</p>
            <LegalFooter />
          </div>

          <div className="st-version-footer">
            SpiceHub Meal Spinner · v{__SPICEHUB_VERSION__}
          </div>
        </div>
      </div>
    </div>
  );
}

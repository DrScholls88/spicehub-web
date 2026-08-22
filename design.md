# SpiceHub Design & Theming Constitution

**Status**: binding for all UI work, same standing as `CLAUDE.md`. If a change would violate a rule here, fix the rule or ask — don't silently ignore it.

**Why this file exists**: three separate bug reports this session (dark mode text, light mode text, icon contrast) all traced back to the same handful of root causes. This document exists so the next UI change doesn't reintroduce them.

---

## 1. The one rule that matters

**Every color that touches text, an icon, a background, or a border must come from a CSS variable (`var(--token)`), never a hardcoded hex/rgb/named color** — unless that color is *intentionally* theme-invariant (see §5).

A hardcoded color is a color that was correct for the theme the author happened to be looking at, and wrong for the other one. Every bug fixed this session was a hardcoded color in disguise, including ones that didn't look like a color bug at first (see §4).

---

## 2. Token reference (`src/App.css`)

Defined in `:root` (light, the default) and re-declared in `[data-theme="dark"], [data-theme="auto"][data-system-dark="true"]`. Always reference the variable name, never the hex value, so both blocks stay in sync automatically.

| Token | Light | Dark | Use for |
|---|---|---|---|
| `--bg` | `#fff8f0` | `#1f1a16` | page background |
| `--card` / `--card-bg` | `#ffffff` | `#2c2722` | cards, sheets, modals |
| `--surface` | `#f5f0e8` | `#332e29` | secondary panels |
| `--surface-2` | `#f5f0e8` | `#2a2520` | placeholders, hover fills, subtle chips — **the default answer for "what should this hardcoded light gray background be"** |
| `--text` | `#2c2c2c` | `#f5f0e8` | primary text |
| `--text-light` | `#666666` | `#b0a898` | secondary text, **default icon color** |
| `--text-muted` | `#6d6d6d` | `#968e86` | tertiary/meta text (counts, timestamps). Fixed 2026-07-20 — see §6. |
| `--border` | `#e8e2d8` | `#3e3730` | dividers, input borders. Low contrast by design (~1.3:1) — see §7 known debt. |
| `--primary` / `--primary-light` / `--primary-dark` | orange family | green family | brand accent — deliberately different hue per theme, not just lightness |
| `--danger` / `--success` / `--warning` | — | — | semantic status colors |
| `--shadow` / `--shadow-lg` / `--shadow-glow` | — | — | elevation |

**Component-local token namespaces**: some feature areas (`ImportSheet.css`'s `--sh-*` tokens, for example) define their own `:root`-scoped variable set inside their own CSS file rather than using the tokens above. This is legitimate — it lets a subsystem re-theme independently — but it means `var(--sh-bg)` etc. only resolves once that component's stylesheet has actually loaded. Don't assume every `var(--x)` you find is defined in `App.css`; grep for `--x:` across `src/**/*.css` before declaring a variable "undefined."

---

## 3. WCAG contrast minimums (non-negotiable, check the math)

- **Normal text**: 4.5:1 against its actual background.
- **Large text (≥18px, or ≥14px bold) and UI component boundaries** (icon buttons, input borders): 3:1.
- Compute this for real — don't eyeball it. A one-line Python check (relative-luminance formula, WCAG 2.x) takes seconds and is how every fix in this doc was verified:

```python
def lin(c):
    c = c/255
    return c/12.92 if c <= 0.03928 else ((c+0.055)/1.055)**2.4
def rel_lum(hexv):
    hexv = hexv.lstrip('#')
    r, g, b = int(hexv[0:2],16), int(hexv[2:4],16), int(hexv[4:6],16)
    return 0.2126*lin(r) + 0.7152*lin(g) + 0.0722*lin(b)
def contrast(a, b):
    L1, L2 = rel_lum(a), rel_lum(b)
    L1, L2 = max(L1,L2), min(L1,L2)
    return (L1+0.05)/(L2+0.05)
```

- **Check against every surface the element can realistically sit on.** `--text-muted` was checked against `--card`, `--surface-2`, and `--bg` in both themes before landing on a replacement value — checking just one surface would have missed a failure on another.

---

## 4. Anti-patterns found this session (do not reintroduce)

### 4a. Hardcoded light background + themed text → invisible in dark mode
```css
/* BAD — background never flips, color does, they go white-on-white in dark */
.ml-sheet-option { background: white; color: var(--text); }

/* GOOD */
.ml-sheet-option { background: var(--card); color: var(--text); }
```
Found in: MealLibrary search input, action sheets, delete-confirm buttons, quick-preview hover states, Landing's stats-strip hover (as a framer-motion inline style, same bug — `whileHover={{ backgroundColor: '#faf7f0' }}` needed to be `'var(--surface-2)'`).

### 4b. Icon-only `<button>` with no explicit `color` → browser system color, not the theme
```css
/* BAD — <button>'s UA-stylesheet default color is the system "ButtonText"
   color, not `inherit`. A lucide-react icon (stroke="currentColor") on a
   button with no color declaration renders in that system color, which
   tracks OS/browser preference, not this app's data-theme toggle — so it
   can end up low-contrast in either mode, independent of your theme. */
.btn-icon { background: none; border: none; /* ...no color... */ }

/* GOOD */
.btn-icon { background: none; border: none; color: var(--text-light); }
```
Found in: MealDetail's Edit/Share/Export/Close icons (`.btn-icon`), star rating (`.star-btn`), favorite heart (`.heart-btn-detail`) — all three shared this exact gap. **Rule: every icon-only button gets an explicit `color`, full stop, even if it "happens to work" in whatever browser you're testing in.**

### 4c. `var(--undefined-token, hardcoded-fallback)` → the fallback silently becomes permanent
```css
/* BAD — --text-secondary is not defined anywhere in this codebase.
   var() with an undefined custom property always uses the fallback,
   so this is really just `color: #666` wearing a var() costume. */
color: var(--text-secondary, #666);

/* GOOD — use a token that's actually defined */
color: var(--text-light);
```
This is the sneakiest variant because it *looks* theme-aware at a glance. Before trusting a `var(--x, fallback)`, grep for `--x:` and confirm it's actually declared somewhere reachable. Found in `MealDetail.jsx`'s description/yield line and `.detail-nutrition-label`/`.detail-nutrition-grid` in `App.css`; **three more instances of `var(--text-secondary, #888)` remain unfixed** (BarLibrary rarity text and two other call sites) — same bug, not yet addressed, see §7.

### 4d. The token itself fails contrast, not any individual usage
`--text-muted` was `#999999` (light) / `#786e64` (dark) — both self-consistent, both used correctly everywhere, and both under 3:1 contrast against every surface they sit on. No individual call site was "wrong"; the design-system token was. When a report says text is unreadable "everywhere" rather than in one spot, suspect the token before auditing call sites — grep the hex value in `:root` and `[data-theme="dark"]`, run it through the contrast formula in §3.

### 4e. Component-local snapshot state going stale after a mutation
Not a color bug, but same session, same root-cause shape: a sheet/modal that renders from a state snapshot taken at open time (`quickPreview`, `detailItem`) won't reflect a mutation until it's closed and reopened, even if the underlying list data was correctly reloaded. If a handler calls `onReload()` after writing to the DB, check whether any open snapshot state also needs an inline update — `setQuickPreview(prev => prev?.id === id ? { ...prev, field: newValue } : prev)`.

---

## 5. When a hardcoded color is correct

Not everything should be a variable. Leave these alone:
- **Self-paired color+background in the same rule** — e.g. `.ml-rotation-chip.ml-active { background: var(--primary); color: white; }`. The white text is paired with a background that's guaranteed to be dark/saturated in both themes, so it's safe.
- **Deliberately theme-invariant props/decorations** — the Saloon's chalkboard (`#0c3512` slate green, always dark, it's a physical prop), rarity/legendary accents (`#ffd700` gold on the Bar rarity system) — these are aesthetic choices independent of light/dark mode, not oversights.
- **Semantic accent colors on their own backgrounds** — badges, gradients, category dots — as long as the text sitting on them is also fixed in the same rule.

The test: if you swapped `data-theme` right now, would this element's text and background still have been *designed* together, or did only one side "happen" to still work? If a hardcoded color's contrast partner is a **variable**, that's the bug pattern in §4a — flag it.

---

## 6. Verification workflow for any color/token change

1. Compute contrast against every real surface the element sits on (§3), in both themes.
2. Grep for other hardcoded uses of the same value being replaced — a token fix should be applied at the token, not duplicated ad hoc at each call site.
3. Grep for the CSS variable name itself across `src/**/*.css` and `src/**/*.jsx` to confirm it's actually defined somewhere reachable before trusting a `var(--x, fallback)`.
4. Syntax-check edited files (this sandbox's own `node_modules/@esbuild` binary segfaults — use an isolated throwaway esbuild install, see project memory `feedback_esbuild_sandbox_segfault` if present) and confirm `App.css` brace count is balanced pre/post edit.
5. You still owe `npm run build` on the actual Windows machine — sandbox verification is a syntax gate, not a real build.
6. Manually check both themes for the actual component touched before calling it done.

---

## 7. Known debt (flagged, not fixed — revisit if reported)

- **`--border` contrast** (~1.3:1 light mode) — genuinely low, but fixing it to meet WCAG's 3:1 non-text threshold would visibly darken every card outline/divider app-wide. That's a bigger design call than any single bug report asked for. Revisit only if borders/dividers are specifically called out as hard to see.
- **Three remaining `var(--text-secondary, #888)` call sites** in `App.css` (outside MealDetail — likely BarLibrary/consent-related) share the §4c bug and haven't been triaged for their actual context/surface yet.
- **`--sh-*` token namespace** (Import/Export sheets) — turned out to be legitimate, not a bug: it's a component-local `:root` token set defined in `ImportSheet.css` itself, not the shared tokens in §2. Confirmed working (not confirmed broken). Documented here so it isn't re-flagged as "undefined" by a future grep that only checks `App.css`.
- **Dead CSS**: `.preview-source-input` and `.preview-notes-textarea` in `App.css` are defined but not referenced by any current `.jsx` — found while auditing input font sizes for iOS zoom (§9). Left in place rather than deleted blind; worth a cleanup pass if someone confirms they're truly orphaned.
- **`.preview-editable-row input`/`textarea`** was defined **three separate times** at different line ranges in `App.css` with different property sets (padding/border-radius/background differ slightly between them) — all three now agree on `font-size: 16px`, but the underlying triplication is itself a maintainability smell worth consolidating someday.

---

## 8. Pre-ship checklist for new/edited UI

- [ ] No hardcoded color unless it falls under §5's exceptions.
- [ ] Every icon-only button has an explicit `color`.
- [ ] Every `var(--x, fallback)` has a confirmed, reachable definition of `--x`.
- [ ] Contrast computed (not eyeballed) for any new text/icon/border color, against light and dark.
- [ ] Checked in both `data-theme="light"` and `data-theme="dark"` before calling it done.
- [ ] Any new `<input>`/`<textarea>` is `font-size: 16px` or larger (§9).
- [ ] Any new full-height container uses `100dvh`, not bare `100vh` (§9).
- [ ] Any new fixed bottom-anchored element accounts for `env(safe-area-inset-bottom)` (§9).
- [ ] `App.css` brace-balanced, edited files syntax-checked.
- [ ] Conventional commit message provided; user runs `npm run build` + git commands themselves per `CLAUDE.md`.

---

## 9. iOS Safari / PWA rules

iOS Safari (and iOS home-screen PWAs, which use the same WebKit engine — there is no alternative rendering engine allowed on iOS) has its own footguns independent of the light/dark theming above. Found via a full audit of the codebase against a third-party iOS compatibility report — most were already handled well; these are the gaps that were real.

### 9a. Every text-entry field must be `font-size: 16px` or larger
Any `<input>`/`<textarea>` under 16px triggers iOS Safari's automatic page-zoom on focus — the single most common "feels broken on iPhone" complaint, and easy to miss because it's invisible on desktop and on Android. This codebase had **~18 real instances** under 16px as of 2026-07-26, spanning the Add/Edit Recipe form, the entire Import Review flow (`.review-row`, `.import-input-url`, `.import-input-paste`, `.review-notes`), tag creation, and Bar/Pantry inputs — all normalized to 16px. When grepping for these, filter out class names that merely *contain* "input" as a naming convention for buttons/toggles/labels (e.g. `.ml-select-toolbar-btn`, `.import-input-type-chip`) — check the actual selector ends in a bare `input`/`textarea`/`select`, or confirm the class is applied to a real form element in the `.jsx` before "fixing" it.

### 9b. `100vh` doesn't account for iOS's collapsing toolbar; use `100dvh`
iOS Safari's URL bar/toolbar shows and hides based on scroll direction, and `100vh` is computed against the *largest possible* viewport (toolbar hidden), so content sized with bare `vh` gets clipped or leaves a gap when the toolbar is showing. Fix: declare the `vh` value first, then redeclare with `dvh` immediately after (progressive enhancement — browsers without `dvh` support simply ignore the second line):
```css
min-height: 100vh;
min-height: 100dvh;
/* same pattern for calc() forms: */
max-height: calc(100vh - 220px);
max-height: calc(100dvh - 220px);
```
This project already does this correctly for every root-level container; the gaps found were all in nested sheets/split-views that used a bare `calc(100vh - Npx)`.

### 9c. Fixed bottom-anchored elements need `env(safe-area-inset-bottom)`
Any `position: fixed` element anchored to `bottom: 0` (or a fixed offset) on a device with a home-indicator (iPhone X and later) needs `env(safe-area-inset-bottom)` folded into its bottom offset/padding, or it sits under the home-indicator gesture area. This codebase already does this consistently (`.tab-bar`, `.ml-fab-group`/`.bl-fab-group`, `.import-sheet-footer`, `.re-footer`, `.st-sheet`, `FloatingVideoPlayer`'s `.fvp-panel`/`.fvp-pill` via `@supports (padding: max(0px))` + `max()`) — verified during this audit, not something that needed fixing. Use `max(fixed-px, calc(env(safe-area-inset-bottom) + fixed-px))` (see `FloatingVideoPlayer.css`) when the element needs a minimum offset even on devices without a safe-area inset (older iPhones, Android, desktop).

### 9d. Keyboard-covering-fixed-footer (defense in depth)
iOS Safari resizes `visualViewport` when the keyboard opens but not always the layout viewport the same way, and `dvh`'s keyboard-awareness has known inconsistencies on some iOS versions. `useKeyboardInset()` (`src/hooks/useKeyboardInset.js`) mirrors the live layout/visual-viewport gap into `--keyboard-inset` (defaults to `0px`, i.e. a no-op) for any fixed footer to fold into its padding as a supplement to — not a replacement for — `dvh` sizing and safe-area padding:
```css
padding-bottom: calc(12px + env(safe-area-inset-bottom) + var(--keyboard-inset, 0px));
```
Called once near the app root (`App.jsx`). Don't add per-component `visualViewport` listeners — use the shared hook and opt individual fixed footers into the CSS var.

### 9e. Request persistent storage proactively when installed, not just reactively
iOS reclaims IndexedDB more aggressively than Android under storage pressure or after the app goes unopened for a while. `navigator.storage.persist()` shows no permission dialog on Safari — grant/deny is silent and heuristic-based, weighted toward "installed to home screen" — so there's no UX cost to calling it unprompted once the app detects `isStandalone`, rather than waiting for the user to find the Storage Manager sheet. Done in `App.jsx`'s startup effect, gated on `isStandalone` and `isPersistentStorageGranted()` so it doesn't re-request every launch once granted.

### 9f. Capacitor share-target is configured but not built
`@capacitor/core` + `@capgo/capacitor-share-target` are real dependencies and `capacitor.config.json` is set up correctly (including `iosShareExtensionTargets`), and the JS-side gating (`Capacitor.isNativePlatform()`) is correct — but there is **no `ios/` Xcode project in this repo** (`npx cap add ios` has never been run, and it's not `.gitignore`d, so it genuinely doesn't exist yet). "Share → SpiceHub" from Instagram only works today via the PWA's own `share_target` manifest entry on Android/Chrome — iOS Safari home-screen PWAs don't support Web Share Target Level 2, and the Capacitor path that would fix that for iOS isn't a shippable artifact yet. Don't tell users to "use the Capacitor build" — it doesn't exist until someone runs the native build step on macOS.

---

## 10. Layout, Spacing, Typography & Motion Tokens

*(Merged in 2026-08-21 from the retired `docs/DESIGN_SYSTEM.md`. Its color-token table was intentionally **not** carried over — those values are stale; §2 above, sourced from `App.css`, is the current source of truth for color. The tokens below were spot-checked against `App.css` and are still live.)*

### Design Philosophy

SpiceHub is a meal planning and recipe discovery PWA that should feel like a native app you reach for daily. Warm, appetizing, and calm — with zero-interface lean where possible (content speaks for itself, controls appear when needed).

1. **Touch-first**: Minimum 44px touch targets, generous spacing, forgiving hit areas
2. **Calm appetite**: Warm neutrals, food photography as hero, muted chrome
3. **Zero-interface lean**: Progressive disclosure, hide complexity until needed
4. **Offline-native**: Status is ambient, not alarming. Queued actions feel confident.
5. **Gesture-driven**: Swipe to dismiss, pull to refresh, drag to reorder — like native iOS/Android

### Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` | Tight gaps, inline spacing |
| `--space-sm` | `8px` | Between related items |
| `--space-md` | `16px` | Section padding, card padding |
| `--space-lg` | `24px` | Between sections |
| `--space-xl` | `32px` | Major section breaks |
| `--space-2xl` | `48px` | Page-level spacing |

### Typography

**Font Stack**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif`

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Page title | 22px | 800 | 1.2 |
| Section header | 17px | 700 | 1.3 |
| Card title | 15px | 600 | 1.3 |
| Body | 14px | 400 | 1.5 |
| Caption | 12px | 500 | 1.4 |
| Label | 11px | 700 | 1.2 |

### Touch Targets

- **Minimum**: 44×44px (WCAG 2.1 AA)
- **Comfortable**: 48×48px (primary actions)
- **Icon buttons**: 44×44px minimum hit area (even if icon is smaller)
- **List items**: Full-width tap area, 56px minimum row height
- **Drag handles**: 32–36px visible, 44px hit area

### Elevation & Shadows

| Level | Token | Value |
|-------|-------|-------|
| Resting card | `--shadow` | `0 2px 12px rgba(45,42,38,0.08)` |
| Elevated | `--shadow-lg` | `0 8px 32px rgba(45,42,38,0.12)` |
| Modal overlay | — | `rgba(0,0,0,0.45)` + `backdrop-filter: blur(4px)` |
| Tab bar | — | `0 -1px 12px rgba(0,0,0,0.06)` |
| Toast | — | `0 4px 20px rgba(0,0,0,0.12)` |

### Border Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `8px` | Buttons, inputs, chips |
| `--radius` | `14px` | Cards, sections |
| `--radius-lg` | `20px` | Modals, bottom sheets |
| `--radius-pill` | `100px` | Pills, badges, tabs |

### Animation & Motion

**Easing**:
- `--ease-spring`: `cubic-bezier(0.32, 0.72, 0, 1)` — primary transitions
- `--ease-bounce`: `cubic-bezier(0.34, 1.56, 0.64, 1)` — playful micro-interactions

**Durations**:
- Micro: `100–150ms` (button press, hover)
- Standard: `200–300ms` (modal open, tab switch)
- Gesture: `250ms` with spring ease (swipe dismiss)
- Loading: `600–800ms` cycles

**Reduced motion**: All animations respect `prefers-reduced-motion: reduce`

### Safe Area Handling

```css
padding-bottom: calc(32px + env(safe-area-inset-bottom));
padding-top: env(safe-area-inset-top);
```

Applied to: modal content, tab bar, fixed-position toasts, full-screen overlays. (See also §9c for the fixed-bottom-element-specific version with `max()`.)

---

## 11. Component Patterns

### Bottom Sheet Modal
- Slides up from bottom on mobile, centered on tablet+
- Drag handle at top (40×5px, centered)
- Swipe-down-to-dismiss with rubber-band overshoot
- `max-height: 92vh`, `border-radius: 20px 20px 0 0`
- Safe-area padding at bottom

### Cards (Meal/Drink)
- Full-bleed image or emoji placeholder
- Title + metadata row
- Subtle border, warm shadow
- Hover: border highlight, Active: scale(0.985)
- Long-press for multi-select

### Tab Bar (Bottom Nav)
- Fixed bottom, glass morphism background
- Safe-area bottom padding
- Active: primary color + top border accent
- 5 max tabs, icon + label stacked

### Toast Notifications
- Bottom-center, above tab bar
- Glass morphism background
- Auto-dismiss 2.5s, slide-up entrance
- Color-coded left border (success/error/info)

### Offline Indicator
- Top-right corner, pill badge
- Translucent with blur
- Expands to panel on tap
- Auto-hides when back online
- Non-intrusive, ambient status

---

## 12. Broader Accessibility Checklist (supplement to §8)

§8 covers color/contrast/icon/iOS items specific to bugs found in this codebase. These are the more general a11y items from the retired design system doc, not yet folded into a per-bug checklist:

- [ ] All interactive elements have `min-width/height: 44px`
- [ ] Focus-visible outlines on all interactive elements
- [ ] `aria-label` on icon-only buttons
- [ ] `prefers-reduced-motion` disables animations
- [ ] `prefers-color-scheme` feeds into auto theme
- [ ] Screen reader announcements for state changes
- [ ] Semantic HTML (headings, lists, landmarks)

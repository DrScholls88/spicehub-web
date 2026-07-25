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
- **`--sh-*` token namespace** (Import/Export sheets) is architecturally unusual (component-local `:root` tokens rather than the shared set above) — not confirmed broken, but worth a dedicated pass if Import/Export sheet theming is ever reported as inconsistent.

---

## 8. Pre-ship checklist for new/edited UI

- [ ] No hardcoded color unless it falls under §5's exceptions.
- [ ] Every icon-only button has an explicit `color`.
- [ ] Every `var(--x, fallback)` has a confirmed, reachable definition of `--x`.
- [ ] Contrast computed (not eyeballed) for any new text/icon/border color, against light and dark.
- [ ] Checked in both `data-theme="light"` and `data-theme="dark"` before calling it done.
- [ ] `App.css` brace-balanced, edited files syntax-checked.
- [ ] Conventional commit message provided; user runs `npm run build` + git commands themselves per `CLAUDE.md`.

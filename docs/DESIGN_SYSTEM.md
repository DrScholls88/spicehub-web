# SpiceHub Design System — Mobile-First PWA

**Version**: 2.0 | **Updated**: April 2026

## Design Philosophy

SpiceHub is a meal planning and recipe discovery PWA that should feel like a native app you reach for daily. The design language is warm, appetizing, and calm — with zero-interface lean where possible (content speaks for itself, controls appear when needed).

**Core Principles**:
1. **Touch-first**: Minimum 44px touch targets, generous spacing, forgiving hit areas
2. **Calm appetite**: Warm neutrals, food photography as hero, muted chrome
3. **Zero-interface lean**: Progressive disclosure, hide complexity until needed
4. **Offline-native**: Status is ambient, not alarming. Queued actions feel confident.
5. **Gesture-driven**: Swipe to dismiss, pull to refresh, drag to reorder — like native iOS/Android

---

## Color Tokens

### Light Mode
| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#e65100` | CTA buttons, active nav, links |
| `--primary-light` | `#ff833a` | Header gradient, hover states |
| `--primary-dark` | `#ac1900` | Pressed states |
| `--accent` | `#2e7d32` | Success, confirmations, "in rotation" |
| `--bg` | `#faf7f2` | Page background (warm off-white) |
| `--card` | `#ffffff` | Card surfaces |
| `--surface` | `#f5f2ed` | Recessed areas, input backgrounds |
| `--text` | `#2d2a26` | Primary text (warm near-black) |
| `--text-light` | `#8a8580` | Secondary text, metadata |
| `--text-muted` | `#b5b0aa` | Placeholders, disabled |
| `--border` | `#e8e4df` | Card borders, dividers |
| `--danger` | `#d32f2f` | Delete, errors |

### Dark Mode
| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#66bb6a` | Swapped to green for dark readability |
| `--bg` | `#121212` | True dark background |
| `--card` | `#1e1e1e` | Elevated surfaces |
| `--text` | `#ececec` | Primary text |

---

## Spacing Scale

| Token | Value | Usage |
|-------|-------|-------|
| `--space-xs` | `4px` | Tight gaps, inline spacing |
| `--space-sm` | `8px` | Between related items |
| `--space-md` | `16px` | Section padding, card padding |
| `--space-lg` | `24px` | Between sections |
| `--space-xl` | `32px` | Major section breaks |
| `--space-2xl` | `48px` | Page-level spacing |

---

## Typography

**Font Stack**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, sans-serif`

| Role | Size | Weight | Line Height |
|------|------|--------|-------------|
| Page title | 22px | 800 | 1.2 |
| Section header | 17px | 700 | 1.3 |
| Card title | 15px | 600 | 1.3 |
| Body | 14px | 400 | 1.5 |
| Caption | 12px | 500 | 1.4 |
| Label | 11px | 700 | 1.2 |

---

## Touch Targets

- **Minimum**: 44×44px (WCAG 2.1 AA)
- **Comfortable**: 48×48px (primary actions)
- **Icon buttons**: 44×44px minimum hit area (even if icon is smaller)
- **List items**: Full-width tap area, 56px minimum row height
- **Drag handles**: 32–36px visible, 44px hit area

---

## Elevation & Shadows

| Level | Token | Value |
|-------|-------|-------|
| Resting card | `--shadow` | `0 2px 12px rgba(45,42,38,0.08)` |
| Elevated | `--shadow-lg` | `0 8px 32px rgba(45,42,38,0.12)` |
| Modal overlay | — | `rgba(0,0,0,0.45)` + `backdrop-filter: blur(4px)` |
| Tab bar | — | `0 -1px 12px rgba(0,0,0,0.06)` |
| Toast | — | `0 4px 20px rgba(0,0,0,0.12)` |

---

## Border Radii

| Token | Value | Usage |
|-------|-------|-------|
| `--radius-sm` | `8px` | Buttons, inputs, chips |
| `--radius` | `14px` | Cards, sections |
| `--radius-lg` | `20px` | Modals, bottom sheets |
| `--radius-pill` | `100px` | Pills, badges, tabs |

---

## Animation & Motion

**Easing**:
- `--ease-spring`: `cubic-bezier(0.32, 0.72, 0, 1)` — primary transitions
- `--ease-bounce`: `cubic-bezier(0.34, 1.56, 0.64, 1)` — playful micro-interactions

**Durations**:
- Micro: `100–150ms` (button press, hover)
- Standard: `200–300ms` (modal open, tab switch)
- Gesture: `250ms` with spring ease (swipe dismiss)
- Loading: `600–800ms` cycles

**Reduced motion**: All animations respect `prefers-reduced-motion: reduce`

---

## Component Patterns

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

## Accessibility Checklist

- [ ] All interactive elements have `min-width/height: 44px`
- [ ] Color contrast ratio ≥ 4.5:1 for text
- [ ] Focus-visible outlines on all interactive elements
- [ ] `aria-label` on icon-only buttons
- [ ] `prefers-reduced-motion` disables animations
- [ ] `prefers-color-scheme` feeds into auto theme
- [ ] Screen reader announcements for state changes
- [ ] Semantic HTML (headings, lists, landmarks)

---

## Safe Area Handling

```css
padding-bottom: calc(32px + env(safe-area-inset-bottom));
padding-top: env(safe-area-inset-top);
```

Applied to: modal content, tab bar, fixed-position toasts, full-screen overlays.

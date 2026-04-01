# SpiceHub Design System — Mobile-First PWA

**Version**: 2.0 | **Updated**: April 2026

## Design Principles

1. **Calm & Appetizing** — Warm neutrals, food-photography-friendly palette. No visual noise.
2. **Touch-First** — Every interactive element ≥ 44px. Generous padding. Forgiving hit areas.
3. **Zero-Interface Lean** — Hide chrome when possible. Let content breathe. Progressive disclosure.
4. **Offline-Confident** — Never make the user anxious about connectivity. Quiet indicators, auto-queue.
5. **Native Feel** — Bottom sheets, swipe gestures, momentum scrolling, haptic-style feedback.

## Color Tokens

### Light Mode
| Token | Value | Usage |
|-------|-------|-------|
| `--primary` | `#e65100` | CTA, active states, brand accent |
| `--primary-light` | `#ff833a` | Gradients, hover states |
| `--primary-dark` | `#ac1900` | Pressed states |
| `--accent` | `#2e7d32` | Success, positive actions |
| `--bg` | `#faf7f2` | Page background (warm cream) |
| `--card` | `#ffffff` | Card surfaces |
| `--surface` | `#f5f2ed` | Subtle background areas |
| `--text` | `#2d2a26` | Primary text (warm black) |
| `--text-light` | `#8a8580` | Secondary text |
| `--text-muted` | `#b5b0aa` | Placeholder, disabled |
| `--border` | `#e8e4df` | Dividers, input borders |
| `--danger` | `#d32f2f` | Destructive actions |
| `--shadow` | `0 2px 12px rgba(45,42,38,0.08)` | Card elevation |
| `--radius` | `14px` | Card corners |
| `--radius-sm` | `8px` | Button/input corners |
| `--radius-lg` | `20px` | Modal corners |

### Dark Mode
| Token | Value | Usage |
|-------|-------|-------|
| `--bg` | `#1a1816` | Page background |
| `--card` | `#252320` | Card surfaces |
| `--surface` | `#2d2b28` | Subtle areas |
| `--text` | `#ede8e2` | Primary text |
| `--text-light` | `#9a9590` | Secondary text |
| `--border` | `#3a3835` | Dividers |
| `--shadow` | `0 2px 12px rgba(0,0,0,0.25)` | Elevation |

## Typography

- **System font stack**: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif`
- **Scale**: 11px (caption) → 13px (body-sm) → 15px (body) → 17px (title) → 22px (h1)
- **Weight**: 400 (body), 600 (emphasis), 700 (headings), 800 (hero)
- **Line height**: 1.5 (body), 1.3 (headings)

## Spacing

- Base unit: 4px
- Common: 4, 8, 12, 16, 20, 24, 32, 48
- Touch padding: minimum 12px around interactive elements
- Card internal padding: 16px
- Section gaps: 20-24px

## Touch Targets

- **Minimum**: 44×44px (WCAG 2.5.8)
- **Comfortable**: 48×48px
- **Icon buttons**: 44px with 6px padding
- **Tab bar buttons**: full-width, 52px height
- **Drag handles**: 36×36px minimum

## Component Patterns

### Bottom Sheet Modal
- Rounded top corners (20px)
- Swipe handle: 40×5px pill, centered, 8px from top
- Slide-up animation: 0.35s cubic-bezier(0.32, 0.72, 0, 1)
- Swipe-to-dismiss: 120px threshold with momentum
- Overlay: rgba(0,0,0,0.45) with backdrop-filter blur(4px)

### Cards
- 14px border-radius, subtle shadow
- Image: 60×60px rounded-lg (list) or full-width hero
- Active state: scale(0.98) with 0.1s transition
- Hover: warm border tint

### Buttons
- Primary: gradient background, 0.2s transition, min-height 48px
- Active: scale(0.97) + darker shade
- Disabled: 0.5 opacity, no pointer events
- Icon: 44px touch target, 6px padding, rounded

### Inputs
- 48px min-height, 14px font, 12px padding
- Focus: 2px primary ring
- Placeholder: --text-muted

### Toast / Snackbar
- Bottom-center, above tab bar
- 0.3s slide-up, auto-dismiss 3s
- Left color accent strip

### Offline Indicator
- Pill shape, top-right, semi-transparent background
- Animate in/out with 0.3s fade + slide
- Back online: brief green flash then hide

## Animation Guidelines

- **Duration**: 0.15s (micro), 0.25s (UI), 0.35s (modal), 0.5s (emphasis)
- **Easing**: `cubic-bezier(0.32, 0.72, 0, 1)` (Apple-style spring)
- **Reduced motion**: All animations respect `prefers-reduced-motion: reduce`
- **Touch feedback**: scale(0.97) on press, 0.1s duration

## Safe Areas

```css
padding-top: env(safe-area-inset-top);
padding-bottom: env(safe-area-inset-bottom);
padding-left: env(safe-area-inset-left);
padding-right: env(safe-area-inset-right);
```

## Accessibility

- Focus visible: 2px solid var(--primary), 2px offset
- Color contrast: minimum 4.5:1 (text), 3:1 (large text/icons)
- Touch targets: 44px minimum
- Reduced motion: disable all transforms and animations
- Screen reader: aria-labels on all icon-only buttons

# GroceryList Colorize Changes — Zesty Orange (#FF6B35)

## Overview
Complete CSS transformation of GroceryList component applying the "Zesty Orange" (#FF6B35) accent color system following the design brief: `/colorize` rule (rare orange use), `/quieter` principle (minimal visual noise), dark charcoal theme (#121212), and Mint-Cream text (#F5FFF5).

## Changes by Component

### Container & Layout
- **`.gl-container`**: Changed background from light cream `var(--bg)` → dark charcoal `#121212`
- **`.gl-empty-state p`**: Text color updated to light mint `rgba(245, 255, 245, 0.6)`

### Progress Section
- **`.gl-progress-section`**: Border updated to subtle dark `rgba(255, 255, 255, 0.06)`
- **`.gl-progress-bar`**: Background changed to muted dark `rgba(255, 255, 255, 0.12)`
- **`.gl-progress-fill`**: Gradient now uses Zesty Orange `linear-gradient(90deg, #FF6B35, #FF8F5E)` with improved easing
- **`.gl-progress-text`**: Color updated to mint-cream with reduced opacity `rgba(245, 255, 245, 0.5)`

### Top Toolbar
- **`.gl-top-toolbar`**: Border updated to `rgba(255, 255, 255, 0.06)`
- **`.gl-btn-batch`, `.gl-btn-auto-sort`, `.gl-btn-rebuild`**:
  - Border: `rgba(255, 255, 255, 0.1)` (quiet border)
  - Background: `rgba(255, 255, 255, 0.04)` (subtle surface)
  - Text: `#F5FFF5` (mint-cream)
  - Border-radius: `8px` (from 6px, for consistency)
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)` (spring easing)
- **`.gl-btn-batch.gl-active`**: Background `#FF6B35` (primary action, orange pop)

### Batch Toolbar
- **`.gl-batch-toolbar`**: 
  - Background: `rgba(255, 107, 53, 0.08)` (subtle orange tint)
  - Border: `#FF6B35` (2px solid orange accent)
- **`.gl-batch-count`**: Color `#FF6B35` (orange highlight)
- **`.gl-btn-select-all`, `.gl-btn-assign-store`**:
  - Border: `#FF6B35` (orange outline)
  - Background: `transparent`
  - Color: `#FF6B35`
  - Disabled state: `opacity: 0.3` with muted border
  - Active: `background: rgba(255, 107, 53, 0.12)` (subtle fill)

### Floating Actions (Bottom Bar)
- **`.gl-floating-actions`**: 
  - Background: Dark gradient `linear-gradient(180deg, transparent, rgba(18, 18, 18, 0.95) 20%)`
  - Border-top: `rgba(255, 255, 255, 0.06)`
- **`.gl-btn-keep-primary`**: 
  - Color: `#121212` (dark text on yellow button)
  - Font-weight: `700`
- **`.gl-btn-keep-secondary`**:
  - Background: `rgba(255, 255, 255, 0.08)` (subtle surface)
  - Color: `#F5FFF5` (mint text)
  - Border: `1px solid rgba(255, 255, 255, 0.12)`
  - Active: Background to `rgba(255, 255, 255, 0.12)`

### Bottom Sheet / Store Picker Overlay
- **`.gl-overlay-backdrop`**: Opacity increased to `0.5` (stronger scrim)
- **`.gl-overlay-sheet`**:
  - Background: `#1A1A1A` (dark card surface)
  - Animation: `slideUp 300ms cubic-bezier(0.4, 0, 0.2, 1)` (smooth easing)
  - Border: `1px solid rgba(255, 255, 255, 0.06)` (quiet border)
- **`.gl-sheet-header h2`**: Color `#F5FFF5` (mint text)
- **`.gl-sheet-close`**:
  - Background: `rgba(255, 255, 255, 0.08)`
  - Color: `#F5FFF5`
  - Active: Background to `rgba(255, 255, 255, 0.12)`
- **`.gl-store-option`**:
  - Color: `#F5FFF5` (mint text)
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`
  - Active: `background: rgba(255, 255, 255, 0.06)`
- **`.gl-store-option-arrow`**: Color `rgba(245, 255, 245, 0.4)` (muted)

### Section Headers
- **`.gl-section-header`**:
  - Background: `transparent`
  - Border-bottom: `1px solid rgba(255, 255, 255, 0.06)` (quiet divider)
- **`.gl-section-title`**:
  - Font-size: `11px` (reduced, more elegant)
  - Font-weight: `700` (uppercase bold)
  - Letter-spacing: `0.12em`
  - Text-transform: `uppercase`
  - Color: `rgba(245, 255, 245, 0.4)` (muted mint)
  - Border-left: `none` (removed, quieter)
  - Padding-left: `0`
- **`.gl-section-count`**:
  - Font-size: `11px`
  - Color: `rgba(245, 255, 245, 0.5)` (muted mint)
  - Background: `rgba(245, 255, 245, 0.08)` (subtle badge)
  - Border-radius: `100px` (pill shape)
  - Padding: `2px 8px`
- **`.gl-btn-keep-section`**:
  - Border-radius: `8px` (from 6px, for consistency)
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`

### Grocery Items (Core List)
- **`.gl-item`**:
  - Min-height: `52px` (improved touch target)
  - Padding: `12px 16px`
  - Border-bottom: `1px solid rgba(255, 255, 255, 0.06)` (quiet separator)
  - Background: `transparent` (clean)
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`
- **`.gl-item.gl-item-checked`**:
  - Opacity: `0.35` (strong dimming to show "consumed" state)
  - Background: `rgba(255, 107, 53, 0.04)` (subtle orange tint, visual reward)
- **`.gl-item.gl-item-selected`**:
  - Background: `rgba(255, 107, 53, 0.1)` (stronger orange during batch mode)

### Checkbox Input (Custom Styled)
- **`.gl-checkbox-input`** (completely custom, replaces native):
  - Appearance: `none` (remove browser default)
  - Size: `20×20px`
  - Border: `1.5px solid rgba(245, 255, 245, 0.25)` (quiet default)
  - Border-radius: `50%` (circular)
  - Background: `transparent`
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`
  - Flex-shrink: `0` (prevent shrinking)
- **`.gl-checkbox-input:hover`**:
  - Border-color: `#FF6B35` (orange invite to tap)
  - Box-shadow: `0 0 0 2px rgba(255, 107, 53, 0.1)` (subtle glow)
- **`.gl-checkbox-input:checked`**:
  - Background: `#FF6B35` (orange checkmark indicator)
  - Border-color: `#FF6B35`
- **`.gl-checkbox-input:checked::after`**:
  - Content: `'✓'` (white checkmark)
  - Font-size: `12px`
  - Font-weight: `700`
  - Color: `white`
  - Centered with flexbox

### Item Text
- **`.gl-item-text`**:
  - Font-size: `15px`
  - Color: `#F5FFF5` (mint-cream, primary text)
  - Line-height: `1.4`
  - Word-break: `break-word`
- **`.gl-item-text-checked`**:
  - Text-decoration: `line-through`
  - Color: `rgba(245, 255, 245, 0.35)` (faded when checked)

### Item Action Buttons
- **`.gl-item-actions`**: Display flex with proper spacing
- **`.gl-btn-store`** (store assignment):
  - Width/height: `44px` (good touch target)
  - Border: `none`
  - Background: `transparent`
  - Color: `rgba(245, 255, 245, 0.35)` (subtle default)
  - Border-radius: `8px`
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`
  - Active: `background: rgba(255, 255, 255, 0.06)` with scale animation
- **`.gl-btn-store.gl-btn-store-assigned`**:
  - Color: `#FF6B35` (orange when store is set — **the rare orange pop**)

### Pantry Buttons
- **`.gl-btn-pantry`** (mark as in-pantry):
  - Size: `30px` circular
  - Border: `2px solid #4caf50` (green, semantic)
  - Color: `#4caf50`
  - Active: Fill green, white text with scale animation
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`
- **`.gl-btn-unpantry`** (restore from pantry):
  - Size: `28px` circular
  - Border: `1px solid rgba(255, 255, 255, 0.12)` (quiet)
  - Color: `#F5FFF5`
  - Background: `transparent`
  - Active: `background: rgba(255, 255, 255, 0.08)` with scale

### Remove Button
- **`.gl-btn-remove`**:
  - Size: `32px` circular (larger for visibility)
  - Border-radius: `8px` (slightly more rounded)
  - Background: `transparent`
  - Color: `#F5FFF5`
  - Opacity: `0.3` (very subtle default)
  - Active: `opacity: 1` with scale animation
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`

### Pantry Section
- **`.gl-pantry-section`**:
  - Opacity: `0.5` (muted, already-purchased state)
- **`.gl-item-pantry`**:
  - Background: `rgba(76, 175, 80, 0.08)` (subtle green tint)
  - Border-bottom: `1px solid rgba(76, 175, 80, 0.2)` (green separator)
- **`.gl-pantry-check`**:
  - Color: `#4caf50` (green checkmark)
  - Font: `700 14px`
- **`.gl-item-text-pantry`**:
  - Text-decoration: `line-through`
  - Color: `rgba(245, 255, 245, 0.35)`
- **`.gl-pantry-badge`**:
  - Color: `#4caf50` (green in progress bar)

### Store Picker (Inline Popover)
- **`.gl-picker-backdrop`**: Z-index 30 (below picker)
- **`.gl-item-picker`**:
  - Background: `#1A1A1A` (dark surface)
  - Border: `1px solid rgba(255, 255, 255, 0.06)`
  - Box-shadow: `0 4px 16px rgba(0, 0, 0, 0.4)` (darker shadow)
  - Border-radius: `16px`
  - Transition: `150ms cubic-bezier(0.4, 0, 0.2, 1)`
- **`.gl-picker-option`**:
  - Color: `#F5FFF5` (mint text)
  - Background: `transparent`
  - Border-left: `4px solid transparent`
  - Active: `background: rgba(255, 255, 255, 0.06)`
- **`.gl-picker-unsort`**:
  - Color: `rgba(245, 255, 245, 0.5)` (muted for unsort action)
  - Border-left-color: `rgba(255, 255, 255, 0.15)`

### Store Logos
- **`.gl-store-logo-letter`**:
  - Box-shadow: `0 1px 3px rgba(0, 0, 0, 0.2)` (subtle elevation)
- **`.gl-store-logo-img`**:
  - Box-shadow: `0 1px 3px rgba(0, 0, 0, 0.2)` (subtle elevation)

### Desktop Enhancements (@media 640px+)
- Floating actions move to sticky top position with updated border
- Overlay sheet becomes centered modal
- Store picker repositions as side popover

### Hover States (@media hover: hover)
- **Toolbar buttons**: `background: rgba(255, 255, 255, 0.08)` with border update
- **Active batch button**: `background: #FF5420` (darker orange for hover depth)
- **Keep primary button**: Existing shadow enhanced
- **Store/picker options**: `background: rgba(255, 255, 255, 0.06)` (subtle hover fill)
- **Checkbox input**: Border becomes `#FF6B35` with glow

## Design Principles Applied

1. **Zesty Orange Rarity**: Orange (#FF6B35) appears ONLY on:
   - Checkbox when checked (visual reward)
   - Unchecked checkbox hover (invite to tap)
   - Active batch mode button (primary action)
   - Store-assigned button (status indicator)
   - Progress bar fill (completion feedback)
   - Batch toolbar background (context hint)

2. **Charcoal/Dark Theme (#121212, #1A1A1A)**:
   - Full dark mode applied to all surfaces
   - Reduced visual noise with subtle borders `rgba(255, 255, 255, 0.06)`
   - Improved readability on mobile screens

3. **Mint-Cream Text (#F5FFF5)**:
   - Primary text color throughout
   - Semantic palette for secondary text (50%, 35% opacity)
   - Green (#4caf50) reserved for pantry/in-stock items

4. **Touch-Friendly Targets**:
   - Min 44px height for interactive elements
   - 52px min height for list items
   - Smooth scale animations on active state
   - Clear visual feedback on hover (desktop)

5. **Quiet Visual Design**:
   - No heavy shadows or clutter
   - Subtle 1px borders with low opacity
   - Minimal use of colors (only orange, green, white, mint)
   - Clear information hierarchy via typography and opacity

## File Modified
- `/sessions/intelligent-funny-cori/mnt/spicehub-web/src/App.css` (lines 5752–6533)

## Testing Checklist
- [ ] Verify checkbox custom styling works (20×20px, orange when checked)
- [ ] Test checkbox hover state shows orange border on desktop
- [ ] Confirm orange accent is RARE (only 5 interactive states max)
- [ ] Verify dark theme doesn't strain eyes in low light
- [ ] Check list items with 50+ items feel visually quiet (no clutter)
- [ ] Pantry section dimmed to 0.5 opacity (shows "consumed" state)
- [ ] Progress bar uses orange gradient (#FF6B35 → #FF8F5E)
- [ ] Touch targets are >= 44px height
- [ ] All transitions use `150ms cubic-bezier(0.4, 0, 0.2, 1)` easing
- [ ] Bottom sheet slides up smoothly with correct easing
- [ ] Desktop hover states work correctly (no issues on mobile)
- [ ] Store logo shadows are subtle (0 1px 3px)
- [ ] Mint-cream text (#F5FFF5) appears throughout
- [ ] Section count badges use light background + mint text

## Conventional Commit
```
fix(grocery-list): apply Zesty Orange colorize with dark theme

- Replace light cream background with charcoal (#121212) throughout
- Apply Mint-Cream text (#F5FFF5) as primary text color
- Use Zesty Orange (#FF6B35) ONLY on checked checkmarks, store-assigned
  buttons, batch mode, progress bar, and unchecked checkbox hover states
- Implement custom checkbox styling (20×20px circle, orange fill when checked)
- Update section headers to uppercase, muted color, no left border
- Redesign buttons with transparent backgrounds and quiet 1px borders
- Apply /quieter principle: minimal visual noise, subtle shadows
- Improve touch targets: min 44px for buttons, 52px for list items
- Add spring easing (150ms cubic-bezier) to all transitions
- Separate pantry section with green semantic color (#4caf50)
- Dark bottom sheet and store pickers (#1A1A1A)
- Maintain offline queue, Dexie storage, PWA manifest integrity

BREAKING CHANGE: Dark theme applied — light theme removed
```

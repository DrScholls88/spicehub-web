# Zesty Orange (#FF6B35) Usage Reference

## Design Rule: RARE Orange — One Pop Per Screen

The `/colorize` rule states: "The accent must be RARE. One pop of orange per screen max."

This CSS strictly enforces that rule across all interactive surfaces.

---

## Where Orange Appears (Allowed)

### 1. **Checked Checkbox** ✓
```css
.gl-checkbox-input:checked {
  background: #FF6B35;
  border-color: #FF6B35;
}

.gl-checkbox-input:checked::after {
  content: '✓';
  color: white;
  font-weight: 700;
  font-size: 12px;
}
```
**Purpose**: Momentary reward — user sees bright orange checkmark when they mark item complete. **This is the PRIMARY orange pop.**

---

### 2. **Unchecked Checkbox Hover** (Desktop only)
```css
.gl-checkbox-input:hover {
  border-color: #FF6B35;
  box-shadow: 0 0 0 2px rgba(255, 107, 53, 0.1);
}
```
**Purpose**: Invite to tap. On hover, the checkbox border glows orange to encourage interaction.

---

### 3. **Active Batch Mode Button** (Primary Action)
```css
.gl-btn-batch.gl-active {
  background: #FF6B35;
  color: white;
  border-color: #FF6B35;
}
```
**Purpose**: When batch mode is ON, the button fills with orange to show active state. Single pop during batch operations.

---

### 4. **Progress Bar Fill** (Completion Feedback)
```css
.gl-progress-fill {
  background: linear-gradient(90deg, #FF6B35, #FF8F5E);
}
```
**Purpose**: As user checks items, the progress bar fills with orange, showing completion momentum.

---

### 5. **Store-Assigned Button** (Status Indicator)
```css
.gl-btn-store.gl-btn-store-assigned {
  background: transparent;
  color: #FF6B35;
}
```
**Purpose**: When an item HAS a store assigned, the diamond button becomes orange. Signals "this item is sorted." **Secondary orange pop if multiple items on screen are assigned.**

---

### 6. **Batch Toolbar Context** (Visual Grouping)
```css
.gl-batch-toolbar {
  background: rgba(255, 107, 53, 0.08);
  border-bottom: 2px solid #FF6B35;
}

.gl-batch-count {
  color: #FF6B35;
}
```
**Purpose**: When batch mode is active, the entire toolbar section is tinted orange (8% opacity) with an orange bottom border. This groups related batch actions together.

---

### 7. **Batch Assign Store Buttons** (Selection Controls)
```css
.gl-btn-select-all,
.gl-btn-assign-store {
  border: 1px solid #FF6B35;
  color: #FF6B35;
}
```
**Purpose**: In batch mode, buttons controlling selection are outlined in orange. Indicates they're part of the active batch workflow.

---

### 8. **Batch Toolbar Active States**
```css
.gl-btn-select-all:active,
.gl-btn-assign-store:active:not(:disabled) {
  background: rgba(255, 107, 53, 0.12);
}
```
**Purpose**: When tapping batch buttons, they fill with 12% orange (very subtle), providing tactile feedback.

---

### 9. **Darker Orange on Hover** (Desktop only)
```css
@media (hover: hover) {
  .gl-btn-batch.gl-active:hover {
    background: #FF5420;  /* Darker orange (#FF5420) */
  }
}
```
**Purpose**: On desktop, hovering over the active batch button darkens the orange for depth, showing it's interactive.

---

## Where Orange Does NOT Appear (Forbidden)

### ✗ Section headers
Section titles remain muted mint-gray `rgba(245, 255, 245, 0.4)` — no orange accents.

### ✗ Item rows
Individual grocery items stay dark/transparent — no orange row backgrounds or orange item text.

### ✗ Pantry section
Reserved for green (#4caf50) semantic color — "already have it" uses green, not orange.

### ✗ Store picker
Store logos display their brand colors, but the picker itself uses mint text on dark background — no orange background.

### ✗ Remove button
Delete/remove actions use neutral mint-cream or red, never orange.

### ✗ All borders (except specific cases)
General item borders, section borders, and dividers use `rgba(255, 255, 255, 0.06)` — never orange.

---

## Orange as "Importance Signal"

In SpiceHub's GroceryList design language, **Zesty Orange (#FF6B35) = "This action is active right now."**

Examples:
1. **Checkbox checked** → Orange ✓ = "This item is marked done"
2. **Store assigned** → Orange diamond = "This item is sorted and ready to shop"
3. **Batch mode active** → Orange button + toolbar = "I'm in selection mode"
4. **Progress bar** → Orange fill = "I'm making progress toward my goal"

Absence of orange = "Not the primary action" or "Already in a completed state" (like pantry items, which appear at 0.5 opacity green).

---

## Opacity & Contrast Rules

- **Primary Orange**: `#FF6B35` (100% saturation, full color)
- **Orange Highlight**: `#FF8F5E` (lighter variant for progress gradient)
- **Dark Orange Hover**: `#FF5420` (darker variant for desktop hover feedback)
- **Orange Tint Background**: `rgba(255, 107, 53, 0.04–0.12)` (very subtle, never more than 12% opacity for backgrounds)

---

## Test Cases for Orange Enforcement

| Action | Expected Orange | Visibility |
|--------|-----------------|-----------|
| Hover unchecked checkbox | Orange border + glow | Desktop only |
| Click checkbox to check | Orange checkmark ✓ | All devices |
| Toggle batch mode ON | Orange filled button | All devices |
| Assign store to item | Orange diamond button | All devices |
| Progress updates | Orange progress bar fill | All devices |
| Hover batch mode button | Darker orange (#FF5420) | Desktop only |
| Hover store-assigned button | No additional orange (already orange) | Desktop only |
| Batch select items | Orange toolbar border + 8% tint | All devices |
| Batch disabled state | No orange on disabled "Assign Store" | All devices |

---

## Color Palette Summary

| Role | Color | Opacity | Hex/CSS |
|------|-------|---------|---------|
| **Primary Accent (Orange)** | Zesty Orange | 100% | `#FF6B35` |
| **Secondary Accent (Orange)** | Light Orange | 100% | `#FF8F5E` |
| **Tertiary (Orange)** | Dark Orange (hover) | 100% | `#FF5420` |
| **Orange Background Tint** | Orange | 4–12% | `rgba(255, 107, 53, 0.04–0.12)` |
| **Pantry Indicator** | Mint Green | 100% | `#4caf50` |
| **Primary Text** | Mint-Cream | 100% | `#F5FFF5` |
| **Secondary Text** | Mint-Cream | 50% | `rgba(245, 255, 245, 0.5)` |
| **Tertiary Text** | Mint-Cream | 35% | `rgba(245, 255, 245, 0.35)` |
| **Muted Text** | Mint-Cream | 40% | `rgba(245, 255, 245, 0.4)` |
| **Muted Borders** | Mint-Cream | 6% | `rgba(255, 255, 255, 0.06)` |
| **Subtle Surface** | Mint-Cream | 4% | `rgba(255, 255, 255, 0.04)` |
| **Dark Surface** | Charcoal | 100% | `#121212` or `#1A1A1A` |

---

## Implementation Notes for Developers

1. **Checkbox is custom-styled**: The native `<input type="checkbox">` is hidden with `appearance: none`. Custom styling applies orange on `:checked` and `:hover` states.

2. **Spring easing on all transitions**: All interactive elements use `transition: all 150ms cubic-bezier(0.4, 0, 0.2, 1)` for consistent, delightful feedback.

3. **Touch target minimums enforced**: 
   - List items: min-height 52px
   - Buttons: min-height 44px or 32×32px
   - Ensures usable on small devices

4. **Batch mode is a separate context**: When batch mode is ON, the entire toolbar (`.gl-batch-toolbar`) is tinted 8% orange, and buttons switch to orange borders. This is clear visual communication of mode change.

5. **Dark theme throughout**: Background is charcoal `#121212`. All surfaces are dark (`#1A1A1A`). Text is mint-cream (`#F5FFF5`). Orange pops against this background.

6. **Pantry section is green, not orange**: "Already have it" uses green (`#4caf50`) to clearly differentiate from shopping items. Pantry rows show at 0.5 opacity, appearing "grayed out."

7. **No shadow clutter**: Subtle shadows only on logos and modals. Main list has NO drop shadows (follows `/quieter` principle).

---

**File**: `/sessions/intelligent-funny-cori/mnt/spicehub-web/src/App.css` (lines 5752–6533)

**Design Brief Source**: `/sessions/intelligent-funny-cori/mnt/spicehub-web/CLAUDE.md` — "Organic Precision" colorize rule

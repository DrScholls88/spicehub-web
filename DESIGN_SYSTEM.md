# SpiceHub PWA – UI/UX Pro Max Design System (Master Brief)

**Version**: 1.0  
**Goal**: Create a calm, appetizing, premium mobile-first PWA that feels like a native meal-planning companion.  
**Core Feeling**: Warm, trustworthy, effortless, and joyful — like opening a well-organized cookbook.

## 1. Design Vision & Principles

- **Calm & Appetizing**: Warm neutrals, soft food photography, generous whitespace.
- **Touch-First**: Minimum 48px touch targets, clear affordances, delightful micro-interactions.
- **Progressive & Forgiving**: Smart defaults, confidence indicators, minimal manual work.
- **Consistent & Accessible**: High contrast, clear hierarchy, reduced motion option.
- **PWA Native Feel**: Smooth slide-down gestures, large modals, visible drag handles, standalone-mode polish.

## 2. Color Palette (Warm & Appetizing)

**Primary**  
--primary: #e65100 (main orange)  
--primary-light: #ff833a  
--primary-dark: #ac1900  

**Neutral & Background**  
--bg: #fff8f0 (warm off-white)  
--card: #ffffff  
--surface: #f5f0e8  

**Text**  
--text: #2c2c2c  
--text-light: #666666  
--text-muted: #999999  

**Accent / Success**  
--accent: #2e7d32 (soft green for success/imported)  
--warning: #f59e0b  

**Dark Mode** (soft & warm)  
--bg-dark: #1f1a16  
--card-dark: #2c2722  
--text-dark: #f5f0e8  

## 3. Typography

- **Font Family**: System UI (San Francisco on iOS, Roboto on Android, Segoe UI on Windows) with fallback to Inter.
- **Headings**: 600–700 weight, tight tracking.
- **Body**: 400–500 weight, excellent readability.
- **Scale**:
  - Title (24px / 1.3) – bold for recipe names
  - Section Header (18px / 1.4)
  - Body (16px / 1.5)
  - Caption / Meta (14px / 1.4)
  - Small (12px / 1.3)

## 4. Spacing & Layout

- Base unit: **8px**
- Card padding: 20px
- Modal padding: 24px
- Gap between elements: 12–16px
- Max content width: 600px (centered on larger screens)

## 5. Component Guidelines

### Buttons
- Primary: Rounded 12px, 48px height minimum, bold text, subtle shadow.
- Secondary: Outlined, warm neutral background.
- Icon buttons: Minimum 44×44px touch area.

### Cards & Containers
- Border-radius: 16px
- Soft shadow: `0 4px 12px rgba(0,0,0,0.08)`
- Hover / active state: slight lift + warmer background.

### Drag & Drop (Preview Editing)
- Large, visible drag handles (28px wide, rounded pill with grip lines).
- Clear drop zones with dashed border + color change on hover.
- Smart auto-suggestions with confidence badges (e.g., “95% Ingredients”).
- Smooth animation on drop (scale + fade).

### Modals & Bottom Sheets
- Large rounded top corners (20px).
- Visible drag handle (40px wide, 5px thick pill).
- Smooth slide-down gesture with momentum.
- Backdrop blur + dimmed background.

### Progress Indicators
- Clear step-by-step text with animated dots.
- Subtle progress bar for longer operations.
- Reassuring copy: “Trying subtitles…”, “Building your recipe…”, “Almost there!”

### Empty States
- Large friendly illustration or emoji.
- Encouraging headline + actionable button.
- Example: Week View empty day → big “+ Add Meal” with food icons.

## 6. Specific Screen Guidelines

### Week View
- Hero card for selected day: large image, prominent name, quick actions.
- Empty days: inviting “Tap to add a meal” with soft food illustrations.
- Quick actions: “Repeat last week”, “Generate shopping list”, “Spin the Week”.

### Import Preview / Editing
- Significantly larger default view (reduce iframe padding, increase default zoom-out).
- Excellent pinch-to-zoom + visible zoom controls.
- Prominent, forgiving drag & drop area with auto-suggestions.
- Clear section labels with confidence indicators.
- Smooth scroll and responsive layout.

### Meal Detail / Modals
- Smooth slide-down to close with visible handle.
- Larger touch targets for edit/delete buttons.
- Beautiful image header with overlay gradient.

### Offline / Sync States
- Non-intrusive, calm indicators (soft pill at top or bottom).
- Clear, reassuring messaging (“Saved offline – will sync when online”).

## 7. PWA-Specific Rules

- Standalone mode: Full-screen, no browser chrome.
- Safe-area insets respected on iOS.
- Minimum 48px touch targets everywhere.
- Haptic feedback where appropriate (success import, drag drop).
- Splash screen and manifest icons must feel premium.

## 8. Implementation Priority (for Ruflo + UI/UX Pro Max)

**Immediate (Phase 1)**
1. Full design tokens applied to App.css
2. Larger, better mobile browser view + zoom controls in BrowserAssist
3. Premium drag & drop in Import preview with auto-suggestions

**Next (Phase 2)**
4. Week View polish + inviting empty states
5. Consistent slide-down gestures on all modals
6. Progress & feedback polish

**Follow-up**
7. Overall visual refresh with food photography placeholders
8. Dark mode alignment
9. Accessibility audit

---

This design system brief is now ready for **UI/UX Pro Max** to consume and generate the actual tokens, components, and CSS.

Would you like me to:
- Turn this into a full set of CSS custom properties + component examples?
- Generate the exact Ruflo prompt to implement this design system across the app?
- Or create a focused version for just the Preview Editing + Mobile Browser View first?

Let me know how you want to proceed and I’ll give you the next ready-to-run prompt or code.
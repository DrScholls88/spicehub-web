# SpiceHub PWA Constitution

**Project**: SpiceHub Meal & Recipe Planner  
**Goal**: Zero-cost downloadable PWA (Vercel + installable on Android/iOS/Windows) with strong device local storage, offline-first behavior, and delightful Instagram/social media recipe import.

## Core Principles (Non-Negotiable)
- Preserve offline queue, Dexie storage, service worker, and PWA manifest at all costs.
- Instagram import is the keystone feature — it must feel automatic, reliable, and premium.
- Maximum usability and touch-friendly mobile experience.
- Security: Never hardcode secrets. Use environment variables only.

## Preferred Tools & Workflow
- Ruflo (minimal mode) for structured changes
- Agent Browser + Playwright for social media extraction
- Context7 for better context management
- Conventional Commit cmd provided for every change package

## High-Priority Focus Areas (Current Sprint)
1. Instagram Import
   - Significantly better text scraping and auto-sorting
   - Improved ability to read and parse social media links
   - When a link is shared directly to Spicehub app, import should start automatically


2. UI/UX Polish
   - Smooth slide-down gestures on all modals
   - Larger, consistent touch targets
   - Clear progress feedback during imports
   - Inviting empty states and Week View polish

## Ruflo Usage Rules
- End every swarm with conventional commit suggestions + testing plan
- Keep graceful fallbacks and offline queue intact

You are now operating under this constitution.
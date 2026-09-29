# SpiceHub PWA Constitution (Project instructions)

**Project**: SpiceHub Meal & Recipe Planner: zero-cost offline-first PWA (Vercel + installable on Android/iOS/Windows, Capacitor share target). Instagram/social import is the keystone feature.

**Source of truth**: the repo's `CLAUDE.md` (constitution) and `design.md` (UI). If this text and the repo disagree, the repo wins. Read `CLAUDE.md` before any code work.

## Never regress
- Extraction quality: import corpus stays green; fallback chains stay intact.
- Offline sovereignty: Dexie write first, queue, then sync. Service worker, manifest, and Dexie `upgrade` + `populate` paths are load-bearing.
- Security: no secrets in client code; env vars behind `/api/*` or the Render server.
- a11y + `design.md` tokens (WCAG AA, 44px targets, 16px inputs).

## How we build
- **Ponytail skill, full mode, every coding task.** Understand the flow first, then the smallest change that works. The rungs above are protected: Ponytail may not cut them.
- Edit in place, smallest diff. No placeholders or truncated files, ever.
- Never run mutating git. End every change package with a Conventional Commit command (explicit paths) and a short test plan.
- Actually run the build/tests where possible; don't "mentally verify". Commands for Brian are PowerShell.
- Verify pasted audits against the code before acting on them.

## Current focus
Import engine overhaul per `docs/superpowers/plans/2026-09-04-import-engine-overhaul.md`, then import-modal honesty (real progress, working Try again), then polish (contrast, iOS PWA lifecycle, image fallbacks, a11y).

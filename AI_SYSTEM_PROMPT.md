# SpiceHub PWA: Unified AI System Prompt
**Last Updated**: 2026-07-25  
**Project Owner**: Brian Goeke (bjgoeke@gmail.com)  
**Applicable To**: Claude, Grok, Gemini, and any AI system assisting with this project

---

## PROJECT MISSION

**SpiceHub Meal & Recipe Planner** is a zero-cost, downloadable Progressive Web App (PWA) deployed on Vercel. The app is installable on Android, iOS, and Windows, with Instagram/social media recipe import as the flagship feature.

**The Core Promise**: Users snap a photo or paste a social media link → AI transforms messy captions into structured, Schema.org-compliant recipes → zero manual correction needed.

---

## NON-NEGOTIABLE CORE PRINCIPLES

### 1. Extraction Excellence
- Instagram/social import **IS the product**, not a side feature.
- All recipes must be parsed via LLM-powered extraction (structured prompting, schema compliance).
- Target: high-fidelity recipe data (ingredients, directions, nutritional hints) extractable from photo captions, Instagram post text, video transcripts.
- Quality bar: near-zero manual correction required post-import.
- Related systems: `lib/recipeSchema.js` (contract), `api/vision`, `api/structure`, extraction engines (Gemini primary, Mistral secondary, Tesseract fallback).

### 2. Offline Sovereignty
- The app must be **100% functional offline**. No internet = no degradation. (Apart from Gemini Import calls)
- All user actions are queued locally (IndexedDB/LocalStorage) before network sync.
- Optimistic updates: UI reflects user intent immediately; network lag is invisible.
- Service worker caches assets; Dexie handles structured data sync.
- Related systems: `service-worker.js`, `db.js` (IndexedDB schema), offline queue logic in mutations.

### 3. Security-First Architecture
- **Zero tolerance for hardcoded secrets** — API keys, OAuth tokens, session secrets.
- All sensitive config flows through environment variables only.
- API routes must be rate-limited and CORS-protected.
- Client must proxy vision/LLM calls through `/api/vision`, `/api/structure` to keep keys server-side.
- Related systems: `.env.local` (never committed), API middleware, token refresh logic.

---

## DEVELOPMENT WORKFLOW & CONSTRAINTS

### Environment & Tooling
- **OS**: Windows PC only. Use Windows-native terminal commands (PowerShell, cmd).
- **Build System**: Vite (dev), npm run build (prod).
- **Runtime Checks**: Always run `npm run build` before declaring work complete. Zero syntax errors.
- **Testing**: Jest + React Testing Library for components; manual integration tests on device when applicable.

### Git & Commits
- **Conventional Commits** are mandatory for every change.
- **Claude ONLY provides git commit commands**. User manually executes to ensure routing.
- Never run `git stash`, `git reset`, `git checkout`, `git commit` from AI sandbox (risk of `.git/index` corruption).
- Commits must reference affected files, feature gates, and migration notes where applicable.

### Code Quality & Defensibility
- AI is empowered to **challenge user recommendations** if they cause marked regression in quality, extractability, or security.
- Justify challenges with specific technical reasoning.
- Prioritize long-term maintainability over quick fixes (extraction engine changes especially).

### Full Output Enforcement
- Modified files must be **complete** (no truncation, no placeholder patterns like `// ... rest of code`).
- No build-breaking syntax errors.
- Verify via `npm run build` before handoff.

---

## CODEBASE NAVIGATION & KNOWLEDGE GRAPH

### Graphify (AST-Based Knowledge Graph)
The project includes a knowledge graph (`graphify-out/`) for fast codebase navigation.

**Commands** (run in project root):
```bash
# Query for a specific topic/component/bug
graphify query "<your question>"

# Find relationships between two files/concepts
graphify path "<source>" "<destination>"

# Explain a concept or component
graphify explain "<concept name>"

# Rebuild graph after modifications
graphify update .
```

**When to Use**:
- Use graphify for codebase questions **first**.
- Falls back to `graphify-out/GRAPH_REPORT.md` for broad architecture review.
- Avoid raw source browsing unless graph queries are insufficient.
- After any code changes, run `graphify update .` to keep the graph fresh.

### Memory System (Persistent Context)
User maintains a memory index at `MEMORY.md` (read-only during task execution). Memory types:
- **User**: Role, preferences, expertise level.
- **Feedback**: Do's/don'ts (with rationale), validated approaches.
- **Project**: Current initiatives, deadlines, stakeholder constraints.
- **Reference**: External resources (Linear tickets, Grafana boards, etc.).

**Do not write to memory during task execution.** Memory is for cross-session persistence only.

---

## ARCHITECTURE SNAPSHOT (As of 2026-07-25)

### Core Domains
1. **Import Engine**: Multi-stage extraction (photo → caption → structured recipe). Engines: Gemini (primary), Mistral (fallback), Tesseract (OCR).
2. **Offline State**: IndexedDB via Dexie (v17+), optimistic updates, offline queue in LocalStorage.
3. **Recipe Schema**: `recipeSchema.js` defines ingredient/direction/nutrition structure. Mealie-inspired, Schema.org compliant.
4. **UI Layer**: React (Vite), Tailwind CSS, Aceternity components, framer-motion animations.
5. **Pantry/Bar Systems**: Ingredient catalog, bar inventory, proximity matching, grocery dedupe.
6. **Pixel Art/Saloon**: Retro visual identity (SVG sprites, ragdoll physics, chalkboard UI).

### Key Files to Know
- `src/App.jsx` — Router, main app state, offline queue dispatch.
- `src/db.js` — Dexie schema, migration logic, local sync.
- `src/lib/recipeSchema.js` — Ingredient/direction/nutrition contracts.
- `src/lib/importEngine.js` — Extraction orchestration (Gemini → Mistral → Tesseract).
- `src/lib/ingredientNormalizer.js` — 3917-item catalog, unit canonicalization.
- `src/api/vision.js` — Vision endpoint (Gemini/Mistral proxy).
- `src/api/structure.js` — LLM structuring (recipe → JSON).
- `src/components/ImportTimeline.jsx` — 3-stage UI (scan → review → save).
- `src/components/MealDetail.jsx` — Recipe display + edit.
- `src/components/BarShelf.jsx` — Pixel bar inventory + physics.
- `src/components/PantryMode.jsx` — Pantry inventory view + match engine.

---

## HIGH-PRIORITY FOCUS AREAS (Current Sprint)

### 1. Instagram Import Excellence
**Current State**: All 6 extraction engines (corpus, api/extract, api/structure, instagram, carousel, vision) unified under one "brain" (Gemini primary). Import UI (ImportTimeline) stable.

**Next Steps**:
- Significantly better text scraping (handle captions + comments + carousel text).
- Auto-sorting of messy ingredient lists (group by course, detect prep steps).
- Photo quality detection (confidence badges for low-quality captures).
- Re-extract flow (user can improve low-confidence results offline).

**Related Tickets/Memory**: 
- `project_import_polish_2026_07_03.md` (UI/UX fixes)
- `project_import_unification_impl_2026_07_08.md` (engine consolidation)
- `project_grok_extraction_2026_06_19.md` (Grok as optional provider)

### 2. Pantry/Bar Features (Phases 1-5 Shipped, P6 Pending)
- P1-5 COMPLETE: Saloon declutter, wanted parchment modal, My Bar card, pantry flags, PantryMode screen, proximity matching.
- P6 DEFERRED: Shared pantry sync, multi-user collaboration.

### 3. Polish & Performance
- Icon contrast fixes (dark mode, light mode `--text-muted`).
- iOS PWA lifecycle (status bar scrim, honest update prompt).
- Image fallback chain (Apify → direct → data-url).
- Accessibility audit (WCAG AA compliance).

---

## WORKING WITH DIFFERENT AI SYSTEMS

### Claude (Primary)
- Full tool access (Read, Write, Edit, Bash, Glob, Grep).
- Leverages Figma MCP for design-to-code workflows.
- Skill system for domain-specific guidance (brainstorming, test-driven-development, code-review, etc.).
- Prefer structured reasoning before implementation.

### Gemini (Vision + Multimodal)
- Use for screenshot analysis, design mockup review, image understanding.
- Gemini is the primary LLM for recipe extraction (via `api/vision` → `api/structure`).
- Handles photo-to-caption transcription, multi-page PDFs.

### Other Systems
- Apply the same core principles: offline-first, extraction excellence, security-first.
- Respect the CLAUDE.md constitution and memory system.
- Provide Conventional Commit commands but do not execute git operations.

---

## SECURITY & SECRETS MANAGEMENT

### Environment Variables (Must Be Set)
```bash
VITE_API_URL=https://spicehub.vercel.app  # or localhost:3000 for dev
VITE_IMPORT_PACK_ONLY=false              # set true to skip live extraction (corpus-only)

# Server-side secrets (NEVER in VITE_*)
GEMINI_API_KEY
MISTRAL_API_KEY
OPENAI_API_KEY  # for Whisper transcription
APIFY_API_TOKEN
SUPABASE_URL, SUPABASE_KEY  # if using Supabase auth
```

### Hardcoding Prevention
- Any API call requiring auth must flow through `/api/*` endpoints.
- Client-side code can only reference `VITE_*` variables.
- Audit via grep for "key=", "token=", "secret=" in component files.

---

## TESTING & VERIFICATION CHECKLIST

Before declaring a feature complete:
1. **Build Success**: `npm run build` runs with zero errors/warnings.
2. **Test Pass**: `npm run test:unit` passes (if relevant).
3. **Manual Testing**: Feature works offline (disable network in DevTools).
4. **Accessibility**: Run axe audit or manual WCAG AA check on changed components.
5. **Conventional Commit**: Commit message follows spec (type(scope): subject + body).
6. **No Secrets Leaked**: Grep for `VITE_` in api routes, `api_key` in client code.

---

## COMMON PITFALLS TO AVOID

| Pitfall | Why Bad | Fix |
|---------|--------|-----|
| Hardcoding API keys in client code | Security breach, keys leaked to browser | Route through `/api/*` endpoints only |
| Not testing offline | Broken core principle | Test with DevTools Network disabled |
| Truncated file edits | Build breaks, incomplete changes | Always run `npm run build` before handoff |
| Git mutations in sandbox | Corrupts `.git/index` | Only provide git commands, never execute |
| Ignoring extraction quality | Ruins flagship feature | Use schema validation, confidence scoring |
| No optimistic updates | Laggy UX on slow networks | Queue all mutations, update UI before response |
| Hardcoded theme/color values | Breaks dark mode + accessibility | Use CSS variables (`var(--primary)`, etc.) |
| Large uncompressed images | Bloats bundle, breaks offline caching | Optimize via barSprites, data-urls, or CDN proxies |

---

## QUICK REFERENCE: COMMON TASKS

### Add a Recipe Import Feature
1. Define schema in `recipeSchema.js` (e.g., new field for cuisine type).
2. Update extraction prompt in `api/structure.js`.
3. Wire through `lib/importEngine.js` stages.
4. Test with real Instagram URLs (use test corpus if offline).
5. Add confidence validation.

### Fix an Offline Bug
1. Check `db.js` for schema mismatches.
2. Verify Dexie version matches app expectations.
3. Test sync queue in `src/lib/offlineQueue.js`.
4. Manual test: disable network, perform action, re-enable, verify sync.

### Optimize Image Loading
1. Use `resolveDisplayableImage()` for Instagram images (handle 403s).
2. Prefer barSprites for UI icons (SVG + data-url).
3. Proxy large images through CDN or `/api/proxy` if needed.
4. Test with 3G throttling enabled.

### Add Accessibility Fix
1. Use semantic HTML (`<button>`, `<nav>`, `<main>`, etc.).
2. Check color contrast: `--text-muted` currently ~3:1 (WCAG AA, not AAA).
3. Ensure 48px touch targets.
4. Test with screen reader (NVDA on Windows, VoiceOver on iOS).

---

## ESCALATION & DECISION RUBRIC

**When to escalate to user**:
- Architecture changes affecting multiple domains.
- Scope creep conflicting with core principles.
- Trade-offs between offline, security, and UX that require stakeholder input.
- Major version upgrades (Dexie, React, Vite).

**When to push back**:
- Suggestions that compromise extraction quality.
- Shortcuts that add hardcoded secrets or skip offline sync.
- UI changes that reduce accessibility.
- Changes that break existing offline queue or sync logic.

**How to push back**:
- Cite specific principle(s) violated.
- Provide concrete counter-proposal.
- Link to related memory or code.
- Frame as "this preserves X, which unblocks Y later."

---

## RESOURCES & REFERENCES

### Project Roots
- **Roadmap**: `gemini-analysis-action-plan-2026-07.md` (5-phase plan, P1-5 complete).
- **Schema Docs**: `recipeSchema.js` (source of truth for recipe structure).
- **Extraction Engines**: `lib/importEngine.js`, `api/vision`, `api/structure`.
- **Offline Sync**: `db.js`, `src/lib/offlineQueue.js`.

### External Integrations
- **Apify** (Instagram scraping): `api/extract.js`.
- **Gemini** (LLM extraction): `api/structure.js`, configured to return JSON schema.
- **Mistral** (fallback vision): `lib/importEngine.js`.
- **Tesseract** (OCR): browser fallback via Transformers.js.
- **Vercel** (hosting): deployed at `spicehub.vercel.app`.

### Debugging
- **DevTools**: Disable network tab to test offline behavior.
- **Service Worker**: Check `Application > Service Workers` for cache status.
- **IndexedDB**: Browse `Application > Storage > IndexedDB` to inspect Dexie tables.
- **Graphify**: `graphify query "import engine"` to understand extraction flow.

---

## TEMPLATE: SESSION KICKOFF

When starting any task on SpiceHub, answer these before coding:

1. **Principle Check**: Which core principle(s) does this touch? (Extraction, Offline, Security)
2. **Knowledge Graph**: Run `graphify query "<feature>"` to understand related code.
3. **Memory Context**: Check memory index for related feedback/project notes.
4. **Build State**: Verify `npm run build` passes before starting.
5. **Scope & Exit Criteria**: What is "done"? How will we verify it?
6. **Risk Mitigation**: What could break? Offline? Security? Extraction quality?

---

## CHANGELOG & VERSIONING

**ENGINE_PROMPT_VERSION**: 2026.06.3  
**LAST PROMPT UPDATE**: 2026-07-25  
**STABLE FEATURES**: Import (all 6 engines unified), Offline sync, Pantry/Bar (P1-5), Pixel saloon.  
**IN PROGRESS**: Instagram caption parsing improvements, P6 multi-user sync design.  
**DEFERRED**: Deep transcript extraction, WPRM/Tasty recipe site scrapers.

---

**This prompt is the source of truth for AI-assisted development on SpiceHub. Update it when principles shift or new constraints emerge.**

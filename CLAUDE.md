# SpiceHub Constitution (CLAUDE.md)
**Last Updated**: 2026-09-28
**Status**: Binding for every AI agent on this repo (Claude Code, Cowork, Gemini, Grok, etc.). `AGENTS.md` points here.

---

## Always-On Summary (read every turn)

You are the **Senior Product Developer** for SpiceHub: an offline-first React PWA (+ Capacitor share target) for meal planning, recipe capture, a Bar, a Pantry, and a small social layer. Import is the product.

**Three things that must never regress**
1. **Extraction quality.** Social/web/photo import lands a usable recipe with near-zero manual fixing.
2. **Offline sovereignty.** Everything except live LLM calls works with no network. Local write first (Dexie), queue, then sync.
3. **Security.** No secrets in client code. Keys live in env vars behind `/api/*` or the Render server.

**How we build: Ponytail, with protected rungs**
- Default mode is Ponytail **full**: understand the real flow first, then take the smallest change that works (reuse > stdlib > platform > installed dep > one line > minimum new code).
- Ponytail decides *how much* code. This file decides *what must not break*. When they disagree, the **Protected Rungs** below win.

**Workflow**
- Edit in place with the smallest diff. **No placeholders ever** (`// ...rest of code`, `TODO: implement`). If you print a file in chat, print it whole.
- Never run mutating git. End every change package with a Conventional Commit command (explicit paths) and a short test plan.
- UI / CSS / icons / layout → also obey `design.md`. Otherwise one line is enough: "Respect design.md tokens if any UI is touched."
- Challenge anything that would hurt extraction, offline, security, or a11y, with the technical reason.

---

## Protected Rungs (Ponytail may not cut these)

Ponytail already exempts validation, data-loss handling, security and a11y. In SpiceHub that concretely means:

| Protected | What it means here |
|---|---|
| Extraction quality | Don't simplify parsing, fallbacks, or prompts without the import corpus (`npm run test:corpus`) staying green. A shorter pipeline that loses a field is a regression. |
| Fallback chains | Import acquire legs (Apify, oEmbed, proxy scrape, comment/blog followers), photo tiers (Gemini → Mistral → Tesseract) and image fallbacks stay intact. Removing a "redundant" leg needs evidence it's dead. |
| Offline queue + optimistic UI | Writes go to Dexie before any network call. `backgroundSync.js`, `sync.js`, `sw.js`, and the manifest are load-bearing. |
| Dexie schema | Every `db.version(n)` bump keeps prior versions and handles **both** `upgrade()` (existing installs) and `on('populate')` (fresh installs: `upgrade` never runs there). |
| Trust boundaries | Share-target/launch-intent input, pasted URLs, and LLM JSON are validated (`recipeSchema.js`, `importGuards.js`). |
| Secrets | Client code never holds a key. New providers go through `/api/*` or `server/`. |
| a11y + theming | `design.md` tokens only, WCAG AA contrast, 44px touch targets, 16px inputs on iOS. |
| Explicit asks | If Brian asks for the full version, build the full version. No re-arguing. |

What Ponytail **should** cut here: duplicate helpers (grep `src/lib/` and the `src/import/index.js` barrel before writing one), new dependencies (zero-cost app; stay on what's installed), speculative config, second facades next to existing ones, dead code nobody mounts.

`ponytail:` comments are welcome for deliberate corners with a known ceiling.

---

## Current App Map

| Area | Where |
|---|---|
| Frontend | React 19 + Vite, `src/App.jsx`, per-screen CSS (App.css was split 2026-08-24) |
| Local data | Dexie 4 (`src/db.js`, v29), `storageManager.js` |
| Offline | `src/sw.js`, `backgroundSync.js`, `sync.js`, offline queue |
| Import engine | Entry: `src/import/index.js` barrel. Core: `recipeParser.js`, `recipeSchema.js`, `src/lib/importGuards.js`, `src/lib/importConfig.js`, `photoImportEngine.js`, `batchImportEngine.js`. UI: `ImportSheet.jsx`, `ImportInput.jsx`, `ImportReview.jsx`, `ReExtractSheet.jsx` |
| Inbound doorways | `src/lib/launchIntent.js` (share target, manifest shortcuts, capture +) |
| Server | Vercel `api/` (extract, structure, vision, proxy, discover); Render Express `server/` (yt-dlp audio, image persistence) |
| AI | Gemini is the structuring engine (model names in `importConfig.js`: verify live before changing, they've died 3 times). Grok off unless `VITE_AI_PROVIDER=grok`. Whisper runs in-browser via Transformers.js. |
| Social | Supabase: friends, home group, activity feed, shared slots |
| Chrome | 4 tabs + centred capture `+`; Shop lives in the header cart. Lucide icons. |

---

## Verification (actually run it, don't "mentally verify")

Ponytail's "leave one runnable check" = **one vitest case in the existing suite**, not a new demo file. Import work adds or extends a `tests/import/corpus.*.test.js` case.

- **Brian's machine (Windows / PowerShell):** `npm run build`, `npm test`, `npm run test:corpus`. Any command handed to Brian is PowerShell.
- **Agent shells (Cowork Linux VM):** fine for verification, never for handing commands to Brian.
  - Build: `npx vite build --outDir <path outside the repo>` with `NODE_PATH` + `ESBUILD_BINARY_PATH` pointing at Linux natives in `/tmp` (see project memory). Writing `dist/` inside the mount fails with EPERM, which is not a real error.
  - Every verification build bumps `buildNumber.json`. Tell Brian to revert it.
  - Known pre-existing reds: `profile.test.js` (10, Dexie cross-file state) and `v28.adhoc.test.js` (1). Don't blame your diff for them.
- **Verify claims before fixing.** Pasted audits and third-party analyses have been wrong repeatedly. Check the code, build output, or live logs first.

---

## Repo Hazards

- **Git:** read-only commands only (`status`, `diff`, `show`, `log`). Never `stash`/`reset`/`checkout`/`commit`. Commit commands stage explicit paths, never `git add .` / `-A`.
- **Line endings:** mixed CRLF/LF, drifting mid-session. Check each file's ending right before editing. Huge diffs → `git diff --ignore-cr-at-eol --stat` before panicking.
- **Concurrent editors:** other tools edit this repo while sessions run. Re-check your changes before reporting done.
- **Deletes:** move to `_to_delete/` if you can't delete; Brian clears it.

---

## Current Focus

1. **Import engine overhaul**: `docs/superpowers/plans/2026-09-04-import-engine-overhaul.md` is the plan of record. Check its task status before starting; don't re-plan what it covers.
2. **Import modal honesty**: progress that reflects real stages, and a Miss → Try again that uses the user's edit.
3. **Polish**: contrast, iOS PWA lifecycle, image fallback chain, a11y.

Update this list when focus actually changes.

---

## Conditional Files

| File | When to load |
|---|---|
| `design.md` | Any UI, CSS, component, theming, icon, or layout work |
| `docs/superpowers/plans/*` | Before touching the subsystem a plan covers |
| `AGENTS.md` | Only a pointer for non-Claude agents |

## Graphify (when available)

Prefer `graphify query "..."`, `graphify path A B`, `graphify explain "..."` over broad greps. After meaningful changes: `graphify update .`

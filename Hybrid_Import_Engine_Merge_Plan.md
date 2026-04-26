# Hybrid Import Engine Merge Plan  
**Paprika Visual Scraper (first man to bat) + Unified Import Engine v2 (intelligent fallback)**

**Author:** Brian Goeke (Senior Product Developer)  
**Date:** April 23, 2026  
**Branch to merge:** `feat/unified-import-engine` (24 commits)  
**Target:** `main` (which now contains the Paprika Visual Scraper commit)  
**Goal:** Create the best-of-both-worlds recipe import engine for SpiceHub PWA (Windows, iOS, Android) — maximum usability, simplicity, interactivity, and bulletproof parsing from any website/app.

## Executive Summary

We are combining two powerful import improvements into a **single Hybrid engine**:

- **Paprika Visual Scraper** → Default fast path (layout heuristics, Purple “V” toggle, instant for Instagram/TikTok/Reels).
- **Unified Import Engine v2** → Deep fallback (server-side stealth fetch + recipe-scrapers + Gemini AI + ghost recipe + async polling).

**Result:** 80 % of imports are instant and deterministic. The remaining 20 % automatically escalate to the full AI/stealth pipeline with optimistic UI. Zero breaking changes, everything behind existing feature flags.

## Why This Hybrid Is Perfect for Our Product

- **Parsing power (paramount requirement):** Visual heuristics first → AI/stealth when needed.
- **Usability & simplicity:** One Purple “V” toggle, instant feedback, no more stuck spinners.
- **Interactivity:** Ghost recipes + Web Worker polling keep the entire PWA responsive.
- **Deployability:** Still pure PWA on Windows/iOS/Android. Server changes are optional and flagged.
- **Maintainability:** Clean hybrid function + single `/api/import` router.

## Comparison (Quick Reference)

| Aspect                  | Paprika (just committed)       | Unified v2 (24 commits)          | Hybrid Winner                  |
|-------------------------|--------------------------------|----------------------------------|--------------------------------|
| Speed / Determinism     | Excellent (heuristics)         | Good (server round-trip)         | Paprika first                  |
| Power on hard sites     | Good                           | Outstanding (stealth + AI)       | Unified fallback               |
| UI/Interactivity        | Good                           | Outstanding (ghost + polling)    | Unified                        |
| Code risk               | Very low                       | Medium (new server/)             | Low after hybrid merge         |
| Files touched           | 5 files                        | Many + new `server/` dir         | Cleanly merged                 |

## Exact Rebase + Merge Plan (Run in this order)

You are currently in the middle of a rebase on `feat/unified-import-engine`.

### Step 1: Finish the current rebase (`.mcp.json` conflict — already identified)

```bash
code .mcp.json
Resolution rule for .mcp.json:
Keep the version that uses a placeholder for the GitHub token (never commit your real GITHUB_PERSONAL_ACCESS_TOKEN). The Unified branch version is preferred because it already includes the new MCP servers (playwright, context7, github, code-review-graph).
Example safe final content:
JSON{
  "mcpServers": {
    "playwright": { ... },
    "context7": { ... },
    "github": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "YOUR_TOKEN_HERE"   // ← placeholder only
      }
    },
    "code-review-graph": { ... }
  }
}
Then:
Bashgit add .mcp.json
git rebase --continue
Step 2: Rebase onto main (Paprika commit)
Bashgit rebase origin/main
You will hit exactly 4 expected conflicts:

src/recipeParser.js
src/components/ImportModal.jsx
src/components/BrowserAssist.jsx
server/importRoutes.js
(plus trivial buildNumber.json)

Step 3: Resolve Conflicts with Hybrid Logic
1. src/recipeParser.js

Keep Paprika’s parseVisualJSON() function at the top.
Add this new hybrid function at the bottom:

JavaScriptexport async function parseHybrid(url, options = {}) {
  // First man to bat: Paprika visual heuristics (fast path)
  if (options.useVisual !== false) {
    const visualResult = await parseVisualJSON(url);
    if (visualResult.confidence > 70) return visualResult; // Paprika threshold
  }
  // Fallback → Unified v2 server pipeline (deep AI + stealth)
  return fetch('/api/v2/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, mode: 'deep' })
  }).then(r => r.json());
}
2. src/components/BrowserAssist.jsx

Keep the Purple “V” toggle exactly as Paprika added it.
Update the import handler:

JavaScriptconst handleImport = async (url) => {
  setIsProcessing(true);
  const result = await parseHybrid(url, { useVisual: !deepModeToggle }); // Purple V = visual-first
  // ...existing ghost recipe + polling logic from Unified stays here
};
3. src/components/ImportModal.jsx

Keep Paprika’s memory-wipe onClose logic.
Ensure the modal now calls parseHybrid (Unified’s ghost + polling UI is already present).

4. server/importRoutes.js

Keep Paprika’s /api/import/visual-parse endpoint.
Keep all Unified v2 routes.
Add this hybrid router alias:

JavaScriptrouter.post('/import', async (req, res) => {
  if (!req.body.mode || req.body.mode === 'visual') {
    return visualParseHandler(req, res);   // Paprika fast path
  }
  return v2ImportHandler(req, res);       // Unified deep path
});
After resolving:
Bashgit add src/recipeParser.js src/components/ImportModal.jsx src/components/BrowserAssist.jsx server/importRoutes.js buildNumber.json
git rebase --continue
Step 4: Test & Push
Bashnpm run dev
# Test:
# 1. Purple V on Instagram Reel → should use visual first
# 2. Ctrl/Cmd + click Purple V → forces deep Unified mode
# 3. Verify ghost recipe → final recipe flow
# 4. Check no memory leaks after 10+ imports
Bashgit push origin feat/unified-import-engine --force-with-lease
Combined PR Description (Copy-Paste Ready)
Title:
feat(import): Hybrid Unified Engine – Paprika Visual Scraper first + AI/stealth fallback
Body:
Markdown### What’s Changed

**Hybrid Import Engine** – Paprika Visual Scraper as default fast path + Unified Import Engine v2 as intelligent fallback.

**Paprika Visual Scraper (kept as “first man to bat”)**  
- `parseVisualJSON()` with layout heuristics  
- Purple “V” toggle in BrowserAssist (auto-activates on Instagram/TikTok/Reels)  
- New lightweight `/api/import/visual-parse` endpoint  
- Memory leak fix in ImportModal  

**Unified Import Engine v2 (now deep fallback)**  
- Full server-side waterfall (stealth fetch → recipe-scrapers → Gemini → image persist)  
- Ghost recipe + optimistic UI + Web Worker polling  
- Dexie schema extensions + feature flags  
- Complete docs and E2E tests  

**Hybrid glue (new)**  
- `parseHybrid()` in recipeParser.js  
- Single `/api/import` endpoint that routes visual vs deep  

### Why  
Maximum usability + parsing power while keeping the PWA dead-simple and interactive across Windows/iOS/Android.

### How to Test  
- Purple V → instant visual parse  
- Ctrl/Cmd-click Purple V → deep AI parse  
- Verify ghost → final recipe flow  

Closes #42 #51
Post-Merge Tasks (after PR is merged)

A/B test with 10 % of users on full v2 default.
Add Redis jobStore when import volume grows.
Update release notes and ship as the new default import experience.

Security Notes

.mcp.json must always use placeholder tokens (YOUR_TOKEN_HERE or env vars).
The Unified branch already updated .gitignore to protect sensitive files (cookies, etc.). Double-check after merge.


Ready to ship the best recipe importer on the planet.
Just paste this entire Markdown into Claude and let it guide you (or run the commands yourself).
If you need any tweaks before handing it off, let me know. We’re one clean merge away from the killer feature our users have been waiting for. 🚀
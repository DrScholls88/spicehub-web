# SpiceHub Server — Unified Import Engine (v2)

## Overview

The v2 import backend is a Node.js Express service that orchestrates recipe
extraction via an async skill waterfall:

```
POST /api/v2/import
  └─ metadata_pass.py   (recipe-scrapers, fast)
       └─ if confidence < 0.9 AND Instagram URL:
            instagram_stealth_fetch.py  (playwright-stealth)
       └─ structureWithGemini()         (Gemini 1.5-flash)
```

A ghost Dexie row (`status: 'processing'`) is created client-side immediately;
`importWorker.js` polls `/api/v2/import/status/:jobId` until the row is populated.

---

## Environment Variables

| Variable | Where | Description |
|---|---|---|
| `VITE_USE_V2_IMPORT` | Vercel / `.env` | Set `true` to enable v2 on the client |
| `VITE_API_BASE` | Vercel / `.env` | Full URL of your Render service, e.g. `https://spicehub.onrender.com` |
| `ENABLE_V2_IMPORT` | Render dashboard | Set `true` to register `/api/v2/*` routes on the server |
| `IG_COOKIES_JSON_B64` | Render dashboard | Base64-encoded cookies.json (see below) |
| `GEMINI_API_KEY` | Render dashboard | Google AI Studio key for Gemini 1.5-flash |
| `PYTHON_BIN` | Render dashboard (optional) | Override Python binary path (default: `python3`) |

---

## Instagram Cookie Setup

Instagram blocks unauthenticated scraping. The stealth worker loads session
cookies from `IG_COOKIES_JSON_B64` to appear as a logged-in user.

### 1 — Export cookies from your browser

Use the [EditThisCookie](https://www.editthiscookie.com/) extension (Chrome) or
[Cookie-Editor](https://cookie-editor.com/) (Firefox/Chrome) to export cookies
for `instagram.com` as **JSON**.

Save the file locally as `cookies.json` (already in `.gitignore` — never commit it).

### 2 — Encode to Base64

```bash
node scripts/encode-cookies.js cookies.json
```

This prints a single Base64 string. Copy it.

### 3 — Set the env var on Render

In your Render service → **Environment** tab:

```
IG_COOKIES_JSON_B64=<paste the Base64 string here>
```

Click **Save Changes** and redeploy.

### Cookie Rotation Runbook

Instagram session cookies expire after roughly **90 days** (sometimes sooner if
Instagram detects automation). Signs of expiry:

- Import jobs get stuck at `processing` for >30 seconds
- Server logs show `login_wall_detected: true`
- Render logs show `instagram_stealth_fetch` exiting with `{"ok":false}`

**To rotate:**

1. Log in to Instagram in a browser that holds a fresh session.
2. Export cookies again with the same extension.
3. Run `node scripts/encode-cookies.js cookies.json` to get a new Base64 string.
4. Update `IG_COOKIES_JSON_B64` on Render and redeploy.
5. Test with a real Instagram URL via the SpiceHub import modal.

> **Tip:** Keep one dedicated Instagram account for scraping. This reduces the
> risk of your personal account being flagged.

---

## API Reference

### `POST /api/v2/import`

Start an async import job.

**Request body:**
```json
{ "url": "https://www.instagram.com/p/XXXX/" }
```

**Response `202`:**
```json
{ "jobId": "abc123", "sourceHash": "sha256hex" }
```

**Response `409` (duplicate):**
```json
{ "jobId": "abc123", "sourceHash": "sha256hex", "duplicate": true }
```

---

### `GET /api/v2/import/status/:jobId`

Poll for job status.

**Response `200`:**
```json
{
  "status": "processing" | "done" | "failed",
  "recipe": { ... },   // present when status === "done"
  "error": "..."       // present when status === "failed"
}
```

**Response `404`:** Job not found (TTL expired or never started).

---

## Local Development

```bash
# Install Node deps
npm install

# Install Python deps
pip3 install -r server/requirements.txt
python3 -m playwright install chromium

# Run backend only
ENABLE_V2_IMPORT=true GEMINI_API_KEY=xxx node server/index.js

# Run tests
npx vitest run
```

---

## Deployment (Render)

1. Connect your GitHub repo to a Render **Web Service**.
2. Set **Build Command**: `bash render-build.sh`
3. Set **Start Command**: `node server/index.js`
4. Add environment variables in the Render dashboard (see table above).
5. Deploy.

The `render-build.sh` script installs Python deps and Playwright's Chromium
automatically during each build.

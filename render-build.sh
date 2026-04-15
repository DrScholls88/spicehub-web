#!/usr/bin/env bash
set -o errexit

# 1. Install Node dependencies
npm ci --include=dev --legacy-peer-deps

# 2. Build the frontend
npm run build

# 3. Manually download Chrome for Puppeteer
# This stores Chrome in a cache directory Render persists
PUPPETEER_CACHE_DIR=/opt/render/.cache/puppeteer
mkdir -p $PUPPETEER_CACHE_DIR
npx puppeteer browsers install chrome

# 4. Install yt-dlp via python
python3 -m pip install yt-dlp

# 5. Python workers for the Unified Import Engine
if command -v pip3 >/dev/null 2>&1; then
  pip3 install --user -r server/requirements.txt
  # Chromium for playwright-stealth; ~170MB, fits in Render's free-tier ephemeral disk
  python3 -m playwright install --with-deps chromium || python3 -m playwright install chromium
else
  echo "WARN: pip3 not found — skipping Python worker setup. v2 import will fail." >&2
fi

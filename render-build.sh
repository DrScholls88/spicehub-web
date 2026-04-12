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

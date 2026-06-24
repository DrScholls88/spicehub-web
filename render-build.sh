#!/usr/bin/env bash
set -o errexit

# 1. Install Node dependencies
npm ci --include=dev --legacy-peer-deps

# 2. Build the frontend
npm run build

# 3. Fetch the standalone yt-dlp binary for server-side video extraction.
#    - yt-dlp_linux is a self-contained executable (no Python needed).
#    - Downloaded as a DIRECT release asset (releases/latest/download/...), which
#      goes through GitHub's CDN, NOT the rate-limited GitHub API that broke the
#      old youtube-dl-exec postinstall.
#    The server auto-detects this path (server/index.js -> resolveYtDlpBin()).
mkdir -p ./bin
curl -fSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux -o ./bin/yt-dlp
chmod a+rx ./bin/yt-dlp
./bin/yt-dlp --version

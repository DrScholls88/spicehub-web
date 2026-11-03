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

# 4. ffmpeg — yt-dlp needs it to extract audio (/api/transcribe) and the server
#    spawns it directly for audio transcode and still frames (/api/frames).
#    Use the host's ffmpeg when it has one; otherwise drop a static build into
#    ./bin (server/index.js -> resolveFfmpegBin() prefers ./bin/ffmpeg).
#    Same GitHub release-CDN route as yt-dlp above, no API rate limit.
if command -v ffmpeg >/dev/null 2>&1; then
  echo "Using host ffmpeg: $(command -v ffmpeg)"
else
  curl -fSL https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz \
    | tar -xJ -C ./bin --strip-components=2 --wildcards '*/bin/ffmpeg'
  chmod a+rx ./bin/ffmpeg
fi
"$(command -v ./bin/ffmpeg || command -v ffmpeg)" -version | head -1

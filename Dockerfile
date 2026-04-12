# 1. Use Node.js for the main runtime
FROM node:22-bullseye-slim

# 2. Install Python, FFmpeg, and the "Hidden" Chrome libraries
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    ffmpeg \
    wget \
    gnupg \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libc6 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libexpat1 \
    libfontconfig1 \
    libgbm1 \
    libgcc1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libstdc++6 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxcursor1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxi6 \
    libxrandr2 \
    libxrender1 \
    libxss1 \
    libxtst6 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# 3. Install yt-dlp globally
RUN python3 -m pip install --no-cache-dir --break-system-packages yt-dlp

# 4. Set up the App
WORKDIR /app
COPY package*.json ./
RUN npm ci --include=dev --legacy-peer-deps
COPY . .
RUN npm run build

# 5. Download Chrome for Puppeteer
RUN npx puppeteer browsers install chrome

EXPOSE 10000
CMD ["node", "server/index.js"]

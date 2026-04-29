# Core UI + parsing
npm install tailwindcss@latest postcss autoprefixer @tailwindcss/vite
npm install react-social-media-embed   # ← this is the magic for Instagram/TikTok/etc. embeds by URL only

# Cross-platform (Capacitor = iOS + Android + PWA)
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init reelchef com.reelchef.app   # use your own package ID

# Windows desktop (Tauri — tiny & fast)
npm install --save-dev @tauri-apps/cli
npx tauri init --app-name reelchef --window-title "ReelChef"

# Optional but recommended for offline + persistence
npm install idb   # IndexedDB wrapper (works everywhere)
Step 2: Initialize the platforms (run once)
Bashnpx cap add android
npx cap add ios
npx tauri add   # (Tauri will guide you)

# UI + Tailwind (modern styling)
npm install tailwindcss @tailwindcss/vite postcss autoprefixer

# Rich embeds for Instagram, TikTok, YouTube, etc. (this is what made Copilot "feel great")
npm install react-social-media-embed

# Offline storage + URL parsing helpers
npm install idb lucide-react  # icons + IndexedDB

# Capacitor (iOS + Android + PWA) — run after Tauri if you want
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios
npx cap init reelchef com.yourname.reelchef   # change package ID
npx cap add android
npx cap add ios

# 1. Install Tauri CLI properly as dev dependency
npm install --save-dev @tauri-apps/cli

# 1. Install the good stuff
npm install tailwindcss @tailwindcss/vite postcss autoprefixer
npm install react-social-media-embed lucide-react idb

Verify Rust is installed by running:PowerShellcargo --version
rustc --version

npm install @types/node  # if not already there
npm install jsdom  # for better parsing (optional but helpful)

npm install @capacitor/share   # basic sharing
npm install @capgo/capacitor-share-target   # receive shares from Instagram etc.
npx cap sync

npm install parse-ingredient lucide-react  # for better ingredient parsing
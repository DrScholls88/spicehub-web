#!/usr/bin/env node

/**
 * Simple production server for SpiceHub web app
 * Serves the built app from dist/ folder with proper caching headers
 * Usage: node server-prod.js
 * Visit: http://localhost:3000
 */

import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, 'dist');
const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from dist with long cache for assets
app.use(express.static(distDir, {
  maxAge: '1d', // Cache for 1 day
  etag: false,
  index: false, // Don't serve index.html automatically
}));

// Service Worker should never be cached
app.get('/sw.js', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(distDir, 'sw.js'));
});

// Manifest should not be cached
app.get('/manifest.json', (req, res) => {
  res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.sendFile(path.join(distDir, 'manifest.json'));
});

// All other requests (SPA routing) serve index.html
app.get('*', (req, res) => {
  const indexPath = path.join(distDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.sendFile(indexPath);
  } else {
    res.status(404).send('Not found');
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════╗
║       SpiceHub Web App - Production        ║
╠════════════════════════════════════════════╣
║                                            ║
║  🌐 Server running at:                    ║
║     http://localhost:${PORT}                        ║
║                                            ║
║  📖 Open in browser to start using app    ║
║  📴 Works completely offline (PWA)        ║
║  💾 All data stored locally on device     ║
║                                            ║
║  Press Ctrl+C to stop                     ║
║                                            ║
╚════════════════════════════════════════════╝
  `);
});

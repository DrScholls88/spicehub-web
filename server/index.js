/**
 * SpiceHub Minimal Server
 * 
 * Since all recipe extraction has moved to the client (CORS proxies + Gemini Client),
 * this server now only acts as a static host for the Vite build and a legacy ping endpoint.
 */

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ── Legacy API Stubs ─────────────────────────────────────────────────────────

app.get('/api/v2/ping', (req, res) => {
  res.json({ ok: true, status: 'Client-Side Sovereign' });
});

app.get('/api/status', (req, res) => {
  res.json({
    ok: true,
    message: 'Backend automation decommissioned. Application is 100% client-side.',
    capabilities: ['static-hosting', 'legacy-ping']
  });
});

// All other /api routes return 410 Gone (to signal infrastructure removal)
app.all('/api/*', (req, res) => {
  res.status(410).json({
    ok: false,
    error: 'Infrastructure Removed',
    message: 'This endpoint relied on server-side automation which has been decommissioned in favor of client-side extraction.'
  });
});

// ── Static Hosting ───────────────────────────────────────────────────────────

const distPath = path.join(__dirname, '../dist');
app.use(express.static(distPath));

// Fallback to index.html for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`\n🚀 SpiceHub Client-Side Server running on port ${PORT}`);
  console.log(`   - Static hosting: ${distPath}`);
  console.log(`   - Legacy API: stubbed (410 Gone)\n`);
});
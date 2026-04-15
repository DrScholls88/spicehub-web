// In-memory job store with 10-minute TTL. Soft state; Dexie is the source of truth.
const JOBS = new Map();
const TTL_MS = 10 * 60 * 1000;

export function put(jobId, patch) {
  const prev = JOBS.get(jobId) || { jobId, createdAt: Date.now() };
  const next = { ...prev, ...patch, updatedAt: Date.now() };
  JOBS.set(jobId, next);
  return next;
}

export function get(jobId) {
  const j = JOBS.get(jobId);
  if (!j) return null;
  if (Date.now() - j.updatedAt > TTL_MS) { JOBS.delete(jobId); return null; }
  return j;
}

// Sweep every 60s to free memory even without reads
setInterval(() => {
  const now = Date.now();
  for (const [id, j] of JOBS) if (now - j.updatedAt > TTL_MS) JOBS.delete(id);
}, 60_000).unref?.();

// Test hook — do not call from production code
export function _resetForTests() { JOBS.clear(); }

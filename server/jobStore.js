const TTL_MS = 10 * 60 * 1000;
const jobs = new Map();

function now() {
  return Date.now();
}

export function put(jobId, patch) {
  const existing = jobs.get(jobId) || { jobId, createdAt: now() };
  jobs.set(jobId, {
    ...existing,
    ...patch,
    jobId,
    createdAt: existing.createdAt,
    updatedAt: now(),
  });
  return jobs.get(jobId);
}

export function get(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  if (now() - job.createdAt > TTL_MS) {
    jobs.delete(jobId);
    return null;
  }
  return job;
}

export function _resetForTests() {
  jobs.clear();
}

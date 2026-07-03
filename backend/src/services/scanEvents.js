/**
 * scanEvents.js
 *
 * In-memory activity log for the Discovery Control feed. Each scan pushes events
 * (kept / filtered:aggregator / filtered:vendor / filtered:competitor /
 * filtered:seller / source-pass) as it runs; the /api/discovery/scan/:id endpoint
 * returns the buffered events so the frontend can render a live "Activity" panel
 * under the progress steps.
 *
 * Not persisted — scans don't survive a backend restart anyway (the startup sweep
 * marks stragglers failed), so a Map is the right tool. Bounded at MAX_PER_JOB
 * events to keep a runaway scan from blowing up memory.
 */

const MAX_PER_JOB = 500;
const MAX_JOBS    = 200;

/** @type {Map<string, Array<{ ts: number, type: string, reason?: string, company?: string, source?: string, detail?: string, count?: number, query?: string }>>} */
const store = new Map();

function push(jobId, event) {
  if (!jobId) return;
  let arr = store.get(jobId);
  if (!arr) {
    arr = [];
    store.set(jobId, arr);
    // Evict oldest job's events if we're tracking too many concurrent scans.
    if (store.size > MAX_JOBS) {
      const oldest = store.keys().next().value;
      if (oldest) store.delete(oldest);
    }
  }
  arr.push({ ts: Date.now(), ...event });
  // Drop from the front if we've exceeded the per-job cap — recent activity is
  // more useful than ancient activity for a live feed.
  if (arr.length > MAX_PER_JOB) arr.splice(0, arr.length - MAX_PER_JOB);
}

function get(jobId, since = 0) {
  const arr = store.get(jobId) || [];
  if (!since) return arr;
  const sinceTs = Number(since) || 0;
  return arr.filter(e => e.ts > sinceTs);
}

function clear(jobId) {
  store.delete(jobId);
}

module.exports = { push, get, clear };

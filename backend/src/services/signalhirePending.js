/**
 * signalhirePending.js
 *
 * SignalHire is asynchronous and webhook-only: you submit a search, get a
 * requestId, and SignalHire POSTs the result to your callbackUrl later. This
 * in-memory store remembers which lead a pending request belongs to, keyed by
 * BOTH the requestId and the query identifier we sent (LinkedIn URL / domain /
 * name) — the webhook can then match on whichever the callback echoes back.
 *
 * NOTE: in-memory only — entries are lost on server restart. Fine for testing;
 * for production durability this would move to a DB table or a lead column.
 */
const logger = require('../utils/logger');

const pending = new Map(); // key (lowercased string) -> { leadId, organizationId, createdById, ts }
const TTL_MS = 30 * 60 * 1000; // 30 minutes

function _key(k) {
  return String(k).trim().toLowerCase();
}

function _gc() {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.ts > TTL_MS) pending.delete(k);
  }
}

/** Register a pending request under all provided keys (requestId + identifier). */
function register(keys, meta) {
  _gc();
  const entry = { ...meta, ts: Date.now() };
  for (const k of keys) {
    if (k === null || k === undefined || k === '') continue;
    pending.set(_key(k), entry);
  }
  logger.info('SignalHire pending registered', { keys: keys.filter(Boolean), leadId: meta.leadId });
}

/** Find and remove the first matching pending entry for any of the given keys. */
function consume(keys) {
  for (const k of keys) {
    if (k === null || k === undefined || k === '') continue;
    const kk = _key(k);
    const hit = pending.get(kk);
    if (hit) {
      // Remove every key pointing at the same entry so we don't double-process.
      for (const [mk, mv] of pending) if (mv === hit) pending.delete(mk);
      return hit;
    }
  }
  return null;
}

module.exports = { register, consume };

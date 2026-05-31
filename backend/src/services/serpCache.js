// SERP result cache — Phase 2.7
//
// In-memory TTL cache keyed by sha256(query|recency|provider). Hits return
// cached organic results; misses populate the cache on success.
//
// Why in-memory (not Postgres):
//   * Zero migration / ops overhead — works on first `npm start`
//   * Covers the dominant use case: re-running similar queries during dev/testing
//   * Survives the Node process; resets on restart (fine — fresh data anyway)
//
// Future-proofing: this file exports a `replaceCacheBackend()` hook so a
// Postgres-backed implementation can drop in without touching call sites.

const crypto = require('crypto');
const logger = require('../utils/logger');

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours
const MAX_ENTRIES   = 500;                  // bound memory (each entry ~5-50KB)
const CACHE_VERSION = 'v1';                 // bump when result shape changes

// Backend abstraction — synchronous in-memory by default, async-compatible
// signature so a Postgres backend can swap in.
const _memory = new Map(); // key → { value, expiresAt }

const inMemoryBackend = {
  async get(key) {
    const entry = _memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      _memory.delete(key);
      return null;
    }
    return entry.value;
  },
  async set(key, value, ttlMs) {
    if (_memory.size >= MAX_ENTRIES) {
      // Evict the oldest entry (Map preserves insertion order)
      const firstKey = _memory.keys().next().value;
      if (firstKey) _memory.delete(firstKey);
    }
    _memory.set(key, { value, expiresAt: Date.now() + ttlMs });
  },
  async clear() {
    _memory.clear();
  },
  async size() {
    return _memory.size;
  },
  name: 'memory',
};

let _backend = inMemoryBackend;

function replaceCacheBackend(backend) {
  if (!backend || typeof backend.get !== 'function' || typeof backend.set !== 'function') {
    throw new Error('Cache backend must implement async get/set/clear/size');
  }
  _backend = backend;
  logger.info('SERP cache: backend replaced', { backend: backend.name || 'custom' });
}

// Build the cache key — sha256 of normalized inputs. Provider is included so
// switching SerpAPI → Serper doesn't return stale SerpAPI results.
function buildCacheKey(query, opts = {}) {
  const norm = String(query || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const recency = opts.recency || '';
  const provider = opts.provider || 'serpapi';
  const num = opts.numResults || 10;
  const raw = `${CACHE_VERSION}|${provider}|${recency}|${num}|${norm}`;
  return crypto.createHash('sha256').update(raw).digest('hex');
}

// Read from cache. Returns the cached results array, or null on miss.
async function getCachedResults(query, opts = {}) {
  try {
    const key = buildCacheKey(query, opts);
    const hit = await _backend.get(key);
    if (hit) {
      logger.info('SERP cache: hit', {
        query: String(query).slice(0, 80),
        provider: opts.provider || 'serpapi',
        results: Array.isArray(hit) ? hit.length : 0,
      });
      return hit;
    }
    return null;
  } catch (err) {
    logger.warn('SERP cache: read failed (non-fatal)', { err: err.message });
    return null;
  }
}

// Write results into the cache. Only call on successful provider responses.
async function setCachedResults(query, opts = {}, results = []) {
  try {
    if (!Array.isArray(results) || !results.length) return; // don't cache empty/error
    const key = buildCacheKey(query, opts);
    const ttl = opts.ttlMs || DEFAULT_TTL_MS;
    await _backend.set(key, results, ttl);
    logger.debug('SERP cache: stored', {
      query: String(query).slice(0, 80),
      provider: opts.provider || 'serpapi',
      results: results.length,
      ttlHours: ttl / 3600000,
    });
  } catch (err) {
    logger.warn('SERP cache: write failed (non-fatal)', { err: err.message });
  }
}

// Maintenance helpers (used by tests + optional admin endpoints later)
async function clearCache() {
  await _backend.clear();
}
async function cacheSize() {
  return _backend.size();
}

module.exports = {
  getCachedResults,
  setCachedResults,
  clearCache,
  cacheSize,
  replaceCacheBackend,
  buildCacheKey,
  DEFAULT_TTL_MS,
};

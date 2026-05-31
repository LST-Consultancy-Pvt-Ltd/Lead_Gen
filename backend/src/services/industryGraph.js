// Industry Knowledge Graph — Phase 2.1
//
// Maps offer descriptions to pre-computed buyer-intent metadata:
//   * target industries
//   * buyer personas / titles
//   * demand signals
//   * preferred / avoid sources
//   * default query patterns
//
// The graph is consulted BEFORE the AI inference call. When a confident match
// is found, the AI is given the graph entry as context so it generates queries
// aligned with the bucket. When no match is found, the AI runs unconstrained
// (legacy behavior). This:
//   - reduces AI hallucination (anchored to known buckets)
//   - improves query quality (proven patterns)
//   - keeps the system generic (graph covers all major B2B categories)
//
// Matching strategy is simple substring scoring against profile text. We
// intentionally do NOT use embeddings here — the graph is rule-based by design
// and embedding-based routing was explicitly de-scoped (Phase 2 stays cheap).

const path = require('path');
const fs = require('fs');
const logger = require('../utils/logger');

let _graph = null;

function loadGraph() {
  if (_graph) return _graph;
  const file = path.join(__dirname, '..', 'data', 'industryGraph.json');
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    delete parsed._meta;
    _graph = parsed;
    logger.info('Industry graph loaded', { buckets: Object.keys(_graph).length });
    return _graph;
  } catch (err) {
    logger.error('Failed to load industry graph', { err: err.message });
    _graph = {};
    return _graph;
  }
}

// Normalize text for matching — lowercase + collapse whitespace
function normalizeText(text = '') {
  return String(text).toLowerCase().replace(/\s+/g, ' ').trim();
}

// Score a bucket against the input text. Score = sum of (length of matched
// keyword) so multi-word matches like "cloud migration" outweigh single tokens.
// Bucket keys starting with `_` are reserved (e.g., _default_b2b_service) and
// only used when no scored bucket matches.
function scoreBucket(bucket, text) {
  let score = 0;
  let matched = [];
  for (const kw of (bucket.matchKeywords || [])) {
    if (!kw) continue;
    const k = kw.toLowerCase();
    if (text.includes(k)) {
      score += k.length;
      matched.push(k);
    }
  }
  return { score, matched };
}

// Look up the best matching bucket for an offer. Returns null when no bucket
// scores above the minimum threshold — caller should fall back to AI-only.
function lookupOfferBucket(profile = {}, productInput = {}) {
  const graph = loadGraph();
  if (!Object.keys(graph).length) return null;

  // Combine all the text we have about the offer for matching
  const haystack = normalizeText([
    profile.productName,
    profile.productSummary,
    profile.buyerDescription,
    productInput.productName,
    productInput.description,
    productInput.content,
  ].filter(Boolean).join(' '));

  if (!haystack) return null;

  let best = null;
  for (const [key, bucket] of Object.entries(graph)) {
    if (key.startsWith('_')) continue; // reserved buckets
    const { score, matched } = scoreBucket(bucket, haystack);
    if (score > 0 && (!best || score > best.score)) {
      best = { key, bucket, score, matched };
    }
  }

  // Minimum threshold: at least one matched keyword 8+ chars OR cumulative score 12+.
  // A bare "service" hitting accidentally won't qualify; "cloud migration" (15 chars) will.
  if (!best || (best.score < 12 && !best.matched.some(m => m.length >= 8))) {
    logger.info('Industry graph: no confident bucket match', {
      bestScore: best?.score || 0,
      bestKey: best?.key || null,
    });
    return null;
  }

  logger.info('Industry graph: matched bucket', {
    bucket: best.key,
    label: best.bucket.label,
    score: best.score,
    matchedKeywords: best.matched.slice(0, 5),
  });

  return { key: best.key, ...best.bucket };
}

// Get a bucket by key. Used when caller already knows the bucket (e.g., after
// AI fallback returns a bucket name). Falls back to _default_b2b_service.
function getBucket(key) {
  const graph = loadGraph();
  return graph[key] || graph._default_b2b_service || null;
}

// Get the fallback bucket directly. Useful when lookup fails and we still want
// SOME structured hints to give to the AI.
function getDefaultBucket() {
  const graph = loadGraph();
  return graph._default_b2b_service || null;
}

// List all bucket keys (excluding reserved). Used by AI fallback prompt so the
// model can pick a bucket name when keyword matching fails.
function listBucketKeys() {
  const graph = loadGraph();
  return Object.keys(graph).filter(k => !k.startsWith('_'));
}

module.exports = {
  lookupOfferBucket,
  getBucket,
  getDefaultBucket,
  listBucketKeys,
};

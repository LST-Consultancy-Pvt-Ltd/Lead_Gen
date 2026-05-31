// Source Routing Engine — Phase 2.3
//
// Decides which SERP sources to prefer or avoid for a given offer bucket.
// Inputs:
//   - profile (with profile._industryBucket from P2.2 graph merge)
//   - filters (targetRegion, etc.)
//
// Outputs a routing plan:
//   {
//     preferredSourceQueries: [ "site:techcrunch.com ...", ... ],  // injected at SERP time
//     avoidDomains:           [ "github.com", "rigzone.com" ],     // filtered post-fetch
//     extraQueryPatterns:     [ ... ],                              // bucket query patterns
//     bucketKey:              "it_services",
//     bucketLabel:            "IT Services & Cloud Consulting"
//   }
//
// Design notes:
//   - Pure rule-based. No AI calls. Reads only from the graph + filters.
//   - Fail-open: when no bucket is set, returns empty arrays so the legacy
//     SERP loop runs unchanged. Phase 2.3 doesn't break existing behavior.
//   - Geo-aware extensions (P2.4) plug into this same return shape.

const path = require('path');
const fs = require('fs');
const { getBucket, getDefaultBucket } = require('./industryGraph');
const logger = require('../utils/logger');

// Phase 2.4: regional sources. Loaded once per process.
let _regionsData = null;
function loadRegions() {
  if (_regionsData) return _regionsData;
  try {
    const file = path.join(__dirname, '..', 'data', 'regionSources.json');
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    delete parsed._meta;
    _regionsData = parsed;
    logger.info('Region sources loaded', { regions: Object.keys(_regionsData).length });
    return _regionsData;
  } catch (err) {
    logger.error('Failed to load regionSources', { err: err.message });
    _regionsData = {};
    return _regionsData;
  }
}

// Build a reverse-index of aliases → canonical region key for O(1) lookup.
// Lazily computed on first use; cached forever (data is static at runtime).
let _aliasIndex = null;
function buildAliasIndex() {
  if (_aliasIndex) return _aliasIndex;
  const regions = loadRegions();
  const idx = new Map();
  for (const [key, data] of Object.entries(regions)) {
    if (!data) continue;
    // Add the canonical key itself (lowercase)
    idx.set(key.toLowerCase(), key);
    // Add the label (if different from key)
    if (data.label) idx.set(data.label.toLowerCase(), key);
    // Add all aliases
    for (const alias of (data.aliases || [])) {
      if (alias) idx.set(String(alias).toLowerCase(), key);
    }
  }
  _aliasIndex = idx;
  return idx;
}

// Resolve a single user-supplied region token to a canonical key. Tries exact
// match against the alias index; falls back to substring containment for
// multi-word inputs ("Greater Mumbai" → "India" via "Mumbai" alias).
function resolveRegionKey(token) {
  if (!token) return null;
  const t = String(token).trim().toLowerCase();
  if (!t) return null;
  const idx = buildAliasIndex();
  if (idx.has(t)) return idx.get(t);
  // Substring fallback — find any alias that appears in the token
  for (const [alias, key] of idx.entries()) {
    if (alias.length < 3) continue; // skip 2-letter country codes for substring (too noisy)
    if (t.includes(alias)) return key;
  }
  return null;
}

// Split user's targetRegion string on commas and resolve each token to a canonical
// region key. Deduplicates while preserving order. Caps at maxRegions to keep
// SerpAPI cost bounded.
function parseRegionList(targetRegion = '', maxRegions = 4) {
  if (!targetRegion) return [];
  const tokens = String(targetRegion)
    .split(/[,/&]/g)
    .map(s => s.trim())
    .filter(Boolean);
  const seen = new Set();
  const out = [];
  for (const tok of tokens) {
    const key = resolveRegionKey(tok);
    if (!key || key === '_global') continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= maxRegions) break;
  }
  return out;
}

// Get sources for a canonical region key. Returns the region data object, or null.
function getRegionSources(key) {
  const regions = loadRegions();
  return regions[key] || null;
}

// Wrap a domain into a Google site: operator query — used to convert a bucket's
// `preferredSources` list into actual SERP queries that target those domains.
// The `eventClause` is a short OR-list of demand events the bucket cares about;
// without it, `site:techcrunch.com` alone returns generic content with no buyer
// signal. We pull the eventClause from the bucket's queryPatterns when present.
function buildSiteQueries(preferredSources = [], eventClause = '', maxQueries = 3) {
  if (!preferredSources.length) return [];
  const out = [];
  for (const domain of preferredSources.slice(0, maxQueries)) {
    if (!domain) continue;
    // If the eventClause already contains a site: operator (rare), skip wrap
    if (/\bsite:/i.test(eventClause)) {
      out.push(eventClause);
    } else if (eventClause) {
      out.push(`${eventClause} site:${domain}`);
    } else {
      // Fallback: just target the domain with a generic event word
      out.push(`announcement OR expansion OR launch site:${domain}`);
    }
  }
  return out;
}

// Build the routing plan for a given profile.
//   profile._industryBucket — set by industryGraph merge in P2.2
//   profile.demandSignals    — used to enrich the event clause for site queries
function buildRoutingPlan(profile = {}, filters = {}) {
  const bucketKey = profile._industryBucket;
  const bucket = bucketKey ? getBucket(bucketKey) : null;

  // Fail-open when there's no bucket information at all — still try to inject
  // regional queries (with a generic event clause) so unknown offers in known
  // regions still benefit from country-specific press.
  if (!bucket) {
    logger.info('Source router: no bucket on profile — falling back to region-only routing');
    const regionKeys = parseRegionList(filters.targetRegion || '');
    const regionalSourceQueries = [];
    const regionalSourcesSelected = [];
    for (const key of regionKeys) {
      const region = getRegionSources(key);
      if (!region) continue;
      const domain = (region.press && region.press[0]) || null;
      if (!domain) continue;
      regionalSourceQueries.push(`announcement OR expansion OR launch site:${domain}`);
      regionalSourcesSelected.push({ region: key, domain });
    }
    if (regionalSourcesSelected.length) {
      logger.info('Source router: regional fallback', { regions: regionalSourcesSelected });
    }
    return {
      preferredSourceQueries: [],
      regionalSourceQueries,
      avoidDomains:           [],
      extraQueryPatterns:     [],
      bucketKey:              null,
      bucketLabel:            null,
      resolvedRegions:        regionKeys,
    };
  }

  // Build a short event clause from the bucket's queryPatterns. We take the
  // first pattern (usually the broadest "facility expansion / new plant / etc.")
  // and use it as the body of site-operator queries. This gives Google something
  // to anchor on within the preferred-source domain.
  const firstPattern = (bucket.queryPatterns || [])[0] || '';
  // If pattern is too long (>120 chars), trim to the first OR group to keep
  // the final query under Google's effective length budget
  const eventClause = firstPattern.length > 120
    ? firstPattern.replace(/\s+OR\s+/g, ' OR ').slice(0, 120).replace(/\s+\S*$/, '')
    : firstPattern;

  const preferredSourceQueries = buildSiteQueries(bucket.preferredSources, eventClause, 3);

  // Bucket queryPatterns are useful as additional buyer-event queries (beyond
  // what the AI generated). We include up to 3 to diversify the funnel.
  const extraQueryPatterns = (bucket.queryPatterns || []).slice(0, 3);

  // Phase 2.4: regional source queries. For each canonical region the user
  // targets, pick 1 top press domain and build a site: query using the
  // bucket's eventClause. This pulls in region-specific signals (e.g., new
  // factory in India → livemint.com; data center expansion in UAE → zawya.com)
  // alongside the bucket's global preferred sources.
  const regionKeys = parseRegionList(filters.targetRegion || '');
  const regionalSourceQueries = [];
  const regionalSourcesSelected = [];
  for (const key of regionKeys) {
    const region = getRegionSources(key);
    if (!region) continue;
    // Prefer press over business over tenders for buyer-intent queries
    const domain = (region.press && region.press[0])
                || (region.business && region.business[0])
                || (region.tenders && region.tenders[0])
                || null;
    if (!domain) continue;
    const query = eventClause
      ? `${eventClause} site:${domain}`
      : `announcement OR expansion OR launch site:${domain}`;
    regionalSourceQueries.push(query);
    regionalSourcesSelected.push({ region: key, domain });
  }

  const plan = {
    preferredSourceQueries,
    regionalSourceQueries,
    avoidDomains:           bucket.avoidSources || [],
    extraQueryPatterns,
    bucketKey:              bucketKey,
    bucketLabel:            bucket.label || null,
    resolvedRegions:        regionKeys,
  };

  logger.info('Source router: plan built', {
    bucket: bucketKey,
    preferredQueries: plan.preferredSourceQueries.length,
    regionalQueries:  plan.regionalSourceQueries.length,
    regions:          regionalSourcesSelected,
    avoidDomains:     plan.avoidDomains.length,
    extraPatterns:    plan.extraQueryPatterns.length,
  });

  return plan;
}

// Check if a SerpAPI result URL is on a domain we should avoid (for the current
// bucket). Returns the matched avoid-domain (truthy) when blocked, else null.
function urlIsOnAvoidDomain(url, avoidDomains = []) {
  if (!url || !avoidDomains.length) return null;
  const lower = String(url).toLowerCase();
  for (const dom of avoidDomains) {
    if (!dom) continue;
    if (lower.includes(String(dom).toLowerCase())) return dom;
  }
  return null;
}

module.exports = {
  buildRoutingPlan,
  urlIsOnAvoidDomain,
};

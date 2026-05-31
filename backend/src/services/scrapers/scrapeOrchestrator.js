// Scrape orchestrator — Phase 2.6
//
// Runs after SerpAPI returns results, BEFORE scoreBatch (AI scoring). Selects
// the top-N candidates by pre-score and fetches their article bodies with
// bounded parallelism. Each lead's `_rawDescription` is augmented with the
// scraped body so the AI scorer sees the actual article content (the source
// URL's article), not just the ~200-char SerpAPI snippet.
//
// Concurrency is capped to avoid hammering a single publisher domain. Failures
// fall back to the SerpAPI snippet — the scan never crashes on a scrape error.

const CheerioScraper = require('./CheerioScraper');
const logger = require('../../utils/logger');

let _scraper = null;
function getScraper() {
  if (_scraper) return _scraper;
  // Future: select adapter from config.scraper.provider
  _scraper = new CheerioScraper();
  logger.info('Scraper initialized', { provider: _scraper.name });
  return _scraper;
}

// Resolve the URL we should scrape for a given lead. Preference order:
//   1. lead.sourceUrl (the SerpAPI link or news URL)
//   2. lead._sourceLink (raw fallback some adapters use)
function resolveScrapeUrl(lead) {
  if (!lead) return '';
  return lead.sourceUrl || lead._sourceLink || '';
}

// Run multiple async jobs with a concurrency cap. Returns settled results
// matched by input index. We use this rather than Promise.all to avoid the
// "30 simultaneous fetches to 30 domains" thundering-herd when SerpAPI returns
// a diverse result set.
async function runWithConcurrency(items, concurrency, worker) {
  const out = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try {
        out[i] = await worker(items[i], i);
      } catch (err) {
        out[i] = { _error: err.message };
      }
    }
  }
  const runners = Array.from({ length: Math.min(concurrency, items.length) }, runOne);
  await Promise.all(runners);
  return out;
}

// Augment a lead's description fields with the scraped body. Adds metadata
// flags downstream code can check:
//   _scrapeStatus:   'ok' | 'http_error' | 'parse_error' | 'timeout' | 'blocked'
//   _scrapedTitle:   article headline (may improve over SerpAPI's truncated title)
//   _scrapedAt:      epoch ms when the scrape happened
function applyScrapeToLead(lead, scrape) {
  if (!lead || !scrape) return;
  lead._scrapeStatus = scrape.status;
  lead._scrapedAt    = Date.now();
  if (scrape.status === 'ok' && scrape.body) {
    // Keep original snippet around just in case, append scraped body
    lead._rawSnippet      = lead._rawSnippet || lead._rawDescription || lead.description || '';
    lead._rawDescription  = scrape.body;
    if (scrape.title)       lead._scrapedTitle = scrape.title;
    if (scrape.publishedAt) lead._scrapedPublishedAt = scrape.publishedAt;
    if (scrape.byline)      lead._scrapedByline = scrape.byline;

    // Phase 2.8: persist a readable excerpt to lead.description so it survives
    // the DB save. analyzeLeadIntent (lead detail summary) later reads this to
    // produce context-aware summaries instead of "no signals available". For
    // news/aggregator leads, the existing description is empty or a short SerpAPI
    // snippet, so we overwrite with the richer scraped body. We cap at 800 chars
    // — enough for the LLM to cite the specific buyer event, without bloating
    // the DB record.
    const excerpt = String(scrape.body).slice(0, 800).replace(/\s+/g, ' ').trim();
    if (excerpt) {
      lead.description = excerpt;
    }
  }
}

// Main entry point: take an array of raw leads, scrape the top-N by relevance,
// and mutate them in place. Returns a summary count for FUNNEL logs.
//
// Options:
//   topN:        how many candidates to scrape (default 10)
//   concurrency: parallel fetches (default 3 — polite + matches CheerioScraper's
//                 free-tier rate budget)
async function deepScrapeTopCandidates(leads, opts = {}) {
  const { topN = 10, concurrency = 3 } = opts;
  if (!Array.isArray(leads) || !leads.length) return { scraped: 0, ok: 0, failed: 0 };

  // Rank candidates: news/aggregator articles benefit most (snippet ≈ teaser),
  // direct company pages don't gain much from deep scrape. We weight news first.
  const ranked = [...leads]
    .map((l, idx) => ({ l, idx, url: resolveScrapeUrl(l) }))
    .filter(x => !!x.url)
    .sort((a, b) => {
      // News articles first, then by relevanceScore desc
      const aN = a.l._isNewsArticle ? 1 : 0;
      const bN = b.l._isNewsArticle ? 1 : 0;
      if (aN !== bN) return bN - aN;
      return (b.l.relevanceScore || 0) - (a.l.relevanceScore || 0);
    })
    .slice(0, topN);

  if (!ranked.length) return { scraped: 0, ok: 0, failed: 0 };

  const scraper = getScraper();
  const startMs = Date.now();
  logger.info('Deep scrape START', {
    provider: scraper.name,
    candidates: ranked.length,
    concurrency,
  });

  const results = await runWithConcurrency(ranked, concurrency, async (item) => {
    return scraper.extractArticleBody(item.url);
  });

  let ok = 0, failed = 0;
  for (let i = 0; i < ranked.length; i++) {
    const scrape = results[i] || { status: 'unknown' };
    applyScrapeToLead(ranked[i].l, scrape);
    if (scrape.status === 'ok') ok++; else failed++;
  }

  logger.info('Deep scrape DONE', {
    provider: scraper.name,
    candidates: ranked.length,
    ok,
    failed,
    durationMs: Date.now() - startMs,
  });

  return { scraped: ranked.length, ok, failed };
}

module.exports = {
  deepScrapeTopCandidates,
  getScraper,
};

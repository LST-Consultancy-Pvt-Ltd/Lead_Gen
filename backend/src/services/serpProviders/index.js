// SerpProvider factory — Phase 2.5
//
// Returns the configured SerpProvider implementation. Currently only SerpAPI
// is available, but the indirection lets us swap providers (Serper, Brave,
// DataForSEO) by changing config without touching call sites.
//
// Config key: config.serpapi.provider (default 'serpapi'). Future values:
//   'serper'     → SerperAdapter
//   'brave'      → BraveAdapter
//   'dataforseo' → DataForSeoAdapter

const SerpApiAdapter = require('./SerpApiAdapter');
const config = require('../../config');
const logger = require('../../utils/logger');

let _instance = null;

function getSerpProvider() {
  if (_instance) return _instance;
  const which = (config.serpapi?.provider || 'serpapi').toLowerCase();
  switch (which) {
    case 'serpapi':
      _instance = new SerpApiAdapter();
      break;
    default:
      logger.warn('Unknown SERP provider configured, defaulting to serpapi', { configured: which });
      _instance = new SerpApiAdapter();
  }
  logger.info('SERP provider initialized', { provider: _instance.name });
  return _instance;
}

module.exports = { getSerpProvider };

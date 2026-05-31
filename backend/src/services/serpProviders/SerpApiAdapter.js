// SerpApiAdapter — Phase 2.5
//
// Concrete SerpProvider implementation backed by https://serpapi.com.
// Replaces the inline axios call previously in productDiscoveryService.js.
//
// Returns 429/503 as a status code rather than throwing — the caller layer
// (searchOrganic) implements retry / backoff / circuit breaker.

const axios = require('axios');
const SerpProvider = require('./SerpProvider');
const config = require('../../config');
const logger = require('../../utils/logger');

class SerpApiAdapter extends SerpProvider {
  get name() { return 'serpapi'; }

  async search(query, opts = {}) {
    const { recency = null, numResults = 10, timeoutMs = 15000 } = opts;

    if (!config.serpapi?.key) {
      // Don't throw — return an empty result with a synthetic error so callers
      // can log + continue. Throwing here would crash entire scans on bad config.
      logger.warn('SerpAPI: API key not set');
      return { results: [], statusCode: 0, headers: {}, providerError: 'missing_api_key' };
    }

    const params = {
      api_key: config.serpapi.key,
      q:       query,
      num:     numResults,
      engine:  'google',
    };
    if (recency) params.tbs = recency;

    try {
      const { data, status, headers } = await axios.get('https://serpapi.com/search', {
        params,
        timeout: timeoutMs,
        // Tell axios to resolve rather than throw for 4xx/5xx so we can inspect
        // body. Without this, 429 throws an exception which loses the response body.
        validateStatus: () => true,
      });

      // Non-2xx (rate limit, server error, plan exhausted) — surface to caller
      // for retry / circuit handling instead of throwing
      if (status >= 400) {
        const bodySnippet = typeof data === 'string'
          ? data.slice(0, 300)
          : (data ? JSON.stringify(data).slice(0, 300) : '');
        return {
          results:       [],
          statusCode:    status,
          headers:       headers || {},
          providerError: bodySnippet || `http_${status}`,
        };
      }

      return {
        results:       Array.isArray(data?.organic_results) ? data.organic_results : [],
        statusCode:    status,
        headers:       headers || {},
        providerError: '',
      };
    } catch (err) {
      // True network error / timeout — return statusCode 0 so caller knows
      // this is NOT a rate-limit retry candidate
      logger.warn('SerpAPI: network error', { query: query.slice(0, 80), err: err.message });
      return {
        results:       [],
        statusCode:    0,
        headers:       {},
        providerError: `network: ${err.message}`,
      };
    }
  }
}

module.exports = SerpApiAdapter;

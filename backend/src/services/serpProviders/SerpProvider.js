// SerpProvider — Phase 2.5
//
// Abstract interface for SERP providers (SerpAPI, Serper, Brave, etc.).
//
// All concrete adapters must:
//   - implement `async search(query, opts) → { results, statusCode, headers, providerError }`
//   - normalize results to the SerpAPI organic-results shape (an array of
//     `{ title, link, snippet, ... }`) so downstream code (organicToLead,
//     scoreBatch, news-domain detection) doesn't need provider-specific branches
//   - throw on transport errors, not on rate-limit responses (rate limits are
//     a normal control flow signal — return statusCode 429 and let the caller
//     handle backoff)
//
// The interface lives in its own file (rather than as a TypeScript interface)
// because the codebase is pure CommonJS JavaScript. Adapter contracts are
// enforced by convention + tests rather than by the type system.

class SerpProvider {
  // Identifier used in logs and config.
  get name() { return 'abstract'; }

  // Perform an organic web search.
  //
  // Required arg: query (string)
  // Optional opts (object):
  //   recency:   string. SerpAPI-compatible `tbs` value (e.g., 'qdr:m3').
  //              Adapters that don't support time-bound search should ignore.
  //   numResults:integer. Number of organic results to request. Default 10.
  //   timeoutMs: integer. Request timeout. Default 15000.
  //
  // Returns:
  //   {
  //     results:        Array<{ title, link, snippet, ... }>  (SerpAPI shape)
  //     statusCode:     number  (200 on success; 429/503 on rate limit)
  //     headers:        object  (raw response headers, used for Retry-After)
  //     providerError:  string  ('' on success; short reason on rate limit)
  //   }
  //
  // Adapters MUST NOT throw on 429/503 — the caller (searchOrganic) handles
  // retry. Throw only on network errors, malformed responses, or missing keys.
  async search(query, opts = {}) {
    throw new Error('SerpProvider.search() must be implemented by subclass');
  }
}

module.exports = SerpProvider;

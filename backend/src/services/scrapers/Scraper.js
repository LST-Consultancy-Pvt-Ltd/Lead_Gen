// Scraper interface — Phase 2.6
//
// Abstract base class for page-content scrapers. Concrete implementations:
//   - CheerioScraper:   axios + cheerio (static HTML, cheap, fast)
//   - PlaywrightScraper (future): headless browser for JS-rendered pages
//   - ScrapeDoScraper   (future): managed scraping API with anti-bot bypass
//
// All scrapers must return a normalized shape so callers don't branch:
//   {
//     title:        string,  // article headline / <title>
//     body:         string,  // extracted article text, ~4000 char cap
//     publishedAt:  string,  // ISO date if found, else ''
//     byline:       string,  // author or publication name if found, else ''
//     status:       string,  // 'ok' | 'http_error' | 'parse_error' | 'timeout' | 'blocked'
//     statusCode:   number,  // HTTP status (0 on network failure)
//   }
//
// Scrapers must NEVER throw — failures must be returned as a status string so
// the orchestrator can fall back to the SerpAPI snippet without crashing the scan.

class Scraper {
  get name() { return 'abstract'; }

  // Extract the readable body of an article-style page.
  //   url:       absolute URL to fetch
  //   timeoutMs: per-request timeout (default 8000 — short, this is best-effort)
  async extractArticleBody(url, opts = {}) {
    throw new Error('Scraper.extractArticleBody() must be implemented by subclass');
  }
}

module.exports = Scraper;

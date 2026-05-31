// CheerioScraper — Phase 2.6
//
// Lightweight HTML scraper backed by axios + cheerio. Targets article-style
// pages (news, press releases, blog posts). Extraction order:
//   1. <article> tag (semantic HTML)
//   2. <main> tag (fallback)
//   3. Largest <p>-tag cluster on the page (heuristic for sites without
//      semantic markup, like older WordPress themes)
//
// Cleans nav, scripts, styles, ads, social-share blocks. Caps body at 4000 chars
// so downstream LLM token costs stay bounded. Never throws — failures return
// a status string the orchestrator can log + fall back to SerpAPI snippet.

const axios = require('axios');
const cheerio = require('cheerio');
const Scraper = require('./Scraper');
const logger = require('../../utils/logger');

// Pretend to be a real browser. Many news sites send a tracking-pixel-only
// stub to default axios UA; rotating these helps on busy days but a single
// modern UA is fine for best-effort.
const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
];

function pickUserAgent() {
  return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

// Selectors to strip BEFORE extracting text — these contain non-article noise
// that bloats the body and burns LLM tokens on irrelevant content.
const NOISE_SELECTORS = [
  'script', 'style', 'noscript', 'iframe', 'svg',
  'nav', 'header', 'footer', 'aside',
  '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
  '.nav', '.navbar', '.navigation', '.menu',
  '.footer', '.site-footer', '.page-footer',
  '.header', '.site-header', '.page-header',
  '.sidebar', '.side-bar',
  '.ad', '.ads', '.advertisement', '.advert', '[class*="advert"]',
  '.social', '.share', '.social-share', '[class*="social-share"]', '[class*="share-buttons"]',
  '.comments', '.comment-section', '#comments',
  '.related', '.related-articles', '.related-posts',
  '.popup', '.modal', '.cookie-banner', '.cookie-notice', '.consent',
  '.newsletter', '.subscribe',
  '.breadcrumb', '.breadcrumbs',
  '.author-bio', '.author-card',
  'form',
];

// Collapse runs of whitespace and trim. Preserves paragraph breaks as double
// newlines so the LLM can see structure.
function cleanText(s = '') {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ /g, ' ')
    .trim();
}

// Pull title from <meta property="og:title">, <title>, then first <h1>.
function extractTitle($) {
  const og = $('meta[property="og:title"]').attr('content');
  if (og) return cleanText(og);
  const twitter = $('meta[name="twitter:title"]').attr('content');
  if (twitter) return cleanText(twitter);
  const titleTag = $('title').first().text();
  if (titleTag) return cleanText(titleTag);
  const h1 = $('h1').first().text();
  if (h1) return cleanText(h1);
  return '';
}

// Pull published-at from common meta tags. Best-effort; returns '' if absent.
function extractPublishedAt($) {
  const candidates = [
    $('meta[property="article:published_time"]').attr('content'),
    $('meta[name="article:published_time"]').attr('content'),
    $('meta[property="og:published_time"]').attr('content'),
    $('meta[name="pubdate"]').attr('content'),
    $('meta[name="publishdate"]').attr('content'),
    $('meta[name="date"]').attr('content'),
    $('time[datetime]').first().attr('datetime'),
  ];
  for (const c of candidates) {
    if (c) return String(c).slice(0, 32);
  }
  return '';
}

function extractByline($) {
  const candidates = [
    $('meta[name="author"]').attr('content'),
    $('meta[property="article:author"]').attr('content'),
    $('[rel="author"]').first().text(),
    $('.author-name, .byline, .by-line').first().text(),
  ];
  for (const c of candidates) {
    if (c) {
      const t = cleanText(c);
      if (t && t.length < 120) return t;
    }
  }
  return '';
}

// Heuristic body extraction. Tries semantic selectors first, then falls back
// to the largest paragraph cluster (the area with the most <p> tags by
// cumulative text length).
function extractBody($) {
  const tryAreas = [
    'article',
    '[role="article"]',
    'main',
    '[role="main"]',
    '.article-body', '.post-content', '.entry-content',
    '.story-body', '.story-content',
    '.content-body', '#content',
  ];

  for (const sel of tryAreas) {
    const $area = $(sel).first();
    if ($area.length) {
      const text = cleanText($area.text());
      if (text.length >= 300) return text;
    }
  }

  // Fallback: find the container with the most <p>-text by cumulative length.
  // This catches sites that wrap content in generic divs with no semantic tags.
  let bestContainer = null;
  let bestScore = 0;
  $('div, section').each(function () {
    const $el = $(this);
    const pCount = $el.find('p').length;
    if (pCount < 3) return;
    const pText = $el.find('p').map((_, p) => $(p).text()).get().join(' ');
    const score = pText.length;
    if (score > bestScore) {
      bestScore = score;
      bestContainer = $el;
    }
  });
  if (bestContainer && bestScore >= 300) {
    return cleanText(bestContainer.text());
  }

  // Last resort: stitch all <p> tags on the page
  const allParas = $('p').map((_, p) => $(p).text()).get().join('\n\n');
  return cleanText(allParas);
}

class CheerioScraper extends Scraper {
  get name() { return 'cheerio'; }

  async extractArticleBody(url, opts = {}) {
    const { timeoutMs = 8000, maxBodyChars = 4000 } = opts;
    if (!url || !/^https?:\/\//i.test(url)) {
      return { title: '', body: '', publishedAt: '', byline: '', status: 'invalid_url', statusCode: 0 };
    }
    try {
      const { data, status } = await axios.get(url, {
        timeout: timeoutMs,
        maxContentLength: 2_000_000, // 2 MB cap; most articles are <500 KB
        maxBodyLength: 2_000_000,
        validateStatus: () => true,
        headers: {
          'User-Agent':      pickUserAgent(),
          'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
        },
      });

      if (status >= 400) {
        return { title: '', body: '', publishedAt: '', byline: '', status: 'http_error', statusCode: status };
      }
      if (typeof data !== 'string' || data.length < 200) {
        return { title: '', body: '', publishedAt: '', byline: '', status: 'parse_error', statusCode: status };
      }

      const $ = cheerio.load(data);

      // Strip noise BEFORE extracting (otherwise nav + footer text bleeds into body)
      for (const sel of NOISE_SELECTORS) {
        try { $(sel).remove(); } catch (_) { /* ignore selector errors */ }
      }

      const title       = extractTitle($);
      const body        = extractBody($).slice(0, maxBodyChars);
      const publishedAt = extractPublishedAt($);
      const byline      = extractByline($);

      // Bot-block / captcha heuristic: very short body + no semantic article tag
      // usually means a JS-rendered page or a "verify you are human" challenge.
      if (body.length < 200) {
        return { title, body, publishedAt, byline, status: 'blocked', statusCode: status };
      }

      return { title, body, publishedAt, byline, status: 'ok', statusCode: status };
    } catch (err) {
      const isTimeout = /timeout/i.test(err.message);
      logger.debug('CheerioScraper: fetch failed', {
        url: String(url).slice(0, 120),
        err: err.message,
        isTimeout,
      });
      return {
        title: '', body: '', publishedAt: '', byline: '',
        status: isTimeout ? 'timeout' : 'network_error',
        statusCode: 0,
      };
    }
  }
}

module.exports = CheerioScraper;

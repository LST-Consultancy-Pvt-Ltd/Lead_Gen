/**
 * productDiscoveryService.js — SMART ROUTING BY PRODUCT TYPE
 *
 * PROBLEM SOLVED:
 *   Apollo is a tech/software company database.
 *   Searching Apollo for "diesel generator" returns software companies
 *   that happen to serve the energy sector — NOT actual industrial buyers.
 *
 * SOLUTION — AI decides the right search engine per product:
 *
 *   DIGITAL / SOFTWARE products (CRM, SaaS, app, platform, IT service):
 *     → Apollo people search by buyer job titles (works great for tech buyers)
 *     → Apollo company search by keywords
 *
 *   PHYSICAL / INDUSTRIAL products (generator, machine, equipment, parts, tools):
 *     → SerpAPI Google Jobs — companies hiring roles that USE this equipment
 *       e.g. "Plant Engineer" at a mine = they need a generator
 *     → SerpAPI Google organic — procurement, RFP, tender notices
 *     → SerpAPI Google News — companies expanding/building = they need equipment
 *     Apollo is SKIPPED for physical products
 *
 *   B2C products (toys, food, clothing, consumer goods):
 *     → SerpAPI Google — find retailers, distributors, wholesalers
 *
 * ONE AI call decides: isPhysicalProduct, buyerType, and generates
 * all search queries / job titles dynamically. Zero static lists.
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { callOpenAI } = require('./aiService');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const TEST_MODE      = process.env.TEST_MODE === 'true';
const TEST_MAX_LEADS = 10;
const TEST_MAX_PAGES = 1;

function normName(n = '') {
  return n.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
// Normalize a job title for dedup so the same role reworded across portals
// ("Senior NetSuite Developer" vs "Sr. NetSuite Developer (Remote)") collapses to
// one key, while genuinely different roles stay distinct.
function normJobTitle(t = '') {
  return t
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')                                   // drop "(remote)", "(US)" …
    .replace(/\b(senior|sr|jr|junior|principal|staff)\b\.?/g, ' ') // seniority noise
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normDomain(url = '') {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase().trim();
}
function empSize(n = 0) {
  if (n > 10000) return '10000+';
  if (n > 1000)  return '1000-10000';
  if (n > 200)   return '200-1000';
  if (n > 50)    return '50-200';
  if (n > 10)    return '10-50';
  return '';
}

const AGGREGATOR_DOMAINS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'monster.com', 'ziprecruiter.com',
  'simplyhired.com', 'careerbuilder.com', 'dice.com', 'seek.com', 'naukri.com',
  'jobstreet.com', 'totaljobs.com', 'reed.co.uk', 'lever.co', 'greenhouse.io',
  'workday.com', 'myworkdayjobs.com', 'wellfound.com', 'angel.co', 'crunchbase.com',
  'techcrunch.com', 'reddit.com', 'twitter.com', 'x.com', 'facebook.com', 'wikipedia.org',
  // job aggregators that re-post listings — the "company" on these is the portal, not a real employer
  'shine.com', 'bebee.com', 'theirstack.com', 'jora.com', 'talent.com', 'jooble.org',
  'jobrapido.com', 'learn4good.com', 'glassdoor.co.in', 'foundit.in', 'whatjobs.com',
  'jobsora.com', 'adzuna.com', 'jobcase.com', 'snagajob.com', 'builtin.com',
];
function isAggregator(url = '') {
  const d = normDomain(url);
  return AGGREGATOR_DOMAINS.some(jb => d.includes(jb));
}
// Aggregator brand names (domain minus TLD) — used to reject leads whose COMPANY
// NAME is itself a job board/portal (e.g. Google Jobs reports the employer as
// "Shine.com" for a re-posted listing). Catches the case where there's no website.
const AGGREGATOR_NAMES = new Set(
  AGGREGATOR_DOMAINS.map(d => d.split('.')[0]).concat(['google jobs', 'jobs'])
);
function isAggregatorName(name = '') {
  const raw = (name || '').toLowerCase().trim();
  if (!raw) return false;
  // A name that looks like a bare domain ("shine.com", "bebee") is a portal artifact,
  // never a real employer. Real company names don't carry a TLD.
  if (/\.(com|io|net|org|co|in|us|uk|me|ai)\b/.test(raw)) return true;
  const n = normName(name);
  // Exact whole-name match against a known portal brand (avoids flagging
  // multi-word real names like "Shine Lawyers").
  return AGGREGATOR_NAMES.has(n);
}

// Is this company the platform VENDOR itself (e.g. "Salesforce, Inc." for a
// Salesforce-consulting offer)? The maker of the platform never buys its own
// ecosystem service, so it must be excluded. Whole-word/phrase match so we don't
// flag unrelated names that merely contain the token.
function isVendorCompany(name, profile) {
  const n = normName(name);
  if (!n) return false;
  return (profile?.vendorNames || []).some(v => {
    const nv = normName(v);
    if (!nv) return false;
    return n === nv || n.startsWith(nv + ' ') || n.endsWith(' ' + nv) || n.includes(' ' + nv + ' ');
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Source routing — when the user names specific portals, search each of them.
//   jobboard  → Google Jobs engine, results filtered to that board's `via`/domain
//   site      → Google organic `site:<domain>` + AI extraction of company + intent
// Unknown portals fall back to a best-effort organic keyword search.
// ─────────────────────────────────────────────────────────────────────────────
const SOURCE_REGISTRY = [
  // Job boards (Google Jobs aggregates these; we keep only matching `via`)
  { key: 'linkedin',     category: 'jobboard', domains: ['linkedin.com'],                       aliases: ['linkedin jobs', 'linkedin'] },
  { key: 'indeed',       category: 'jobboard', domains: ['indeed.com'],                         aliases: ['indeed'] },
  { key: 'glassdoor',    category: 'jobboard', domains: ['glassdoor.com', 'glassdoor.co.in'],   aliases: ['glassdoor'] },
  { key: 'dice',         category: 'jobboard', domains: ['dice.com'],                           aliases: ['dice'] },
  { key: 'wellfound',    category: 'jobboard', domains: ['wellfound.com', 'angel.co'],          aliases: ['wellfound', 'angellist', 'angel list'] },
  { key: 'builtin',      category: 'jobboard', domains: ['builtin.com'],                        aliases: ['builtin', 'built in'] },
  { key: 'ziprecruiter', category: 'jobboard', domains: ['ziprecruiter.com'],                   aliases: ['ziprecruiter', 'zip recruiter'] },
  { key: 'monster',      category: 'jobboard', domains: ['monster.com'],                        aliases: ['monster'] },
  { key: 'naukri',       category: 'jobboard', domains: ['naukri.com'],                         aliases: ['naukri'] },
  // Community & discussion (site: organic + AI extraction)
  { key: 'reddit',       category: 'site', domains: ['reddit.com'],                aliases: ['reddit', 'r/'] },
  { key: 'quora',        category: 'site', domains: ['quora.com'],                 aliases: ['quora'] },
  { key: 'hackernews',   category: 'site', domains: ['news.ycombinator.com'],      aliases: ['hacker news', 'hackernews', 'ycombinator'] },
  { key: 'spiceworks',   category: 'site', domains: ['community.spiceworks.com', 'spiceworks.com'], aliases: ['spiceworks'] },
  { key: 'stackoverflow',category: 'site', domains: ['stackoverflow.com'],         aliases: ['stack overflow', 'stackoverflow'] },
  { key: 'devto',        category: 'site', domains: ['dev.to'],                    aliases: ['dev.to', 'dev to', 'devto'] },
  { key: 'medium',       category: 'site', domains: ['medium.com'],               aliases: ['medium'] },
  { key: 'hashnode',     category: 'site', domains: ['hashnode.com', 'hashnode.dev'], aliases: ['hashnode'] },
  { key: 'dzone',        category: 'site', domains: ['dzone.com'],                 aliases: ['dzone'] },
  { key: 'sitepoint',    category: 'site', domains: ['sitepoint.com'],             aliases: ['sitepoint'] },
  // NetSuite ecosystem (best-effort)
  { key: 'oraclecommunity', category: 'site', domains: ['community.oracle.com'],   aliases: ['oracle netsuite community', 'oracle community', 'netsuite community'] },
  // Social (gated — low yield, attempted best-effort)
  { key: 'linkedinposts',category: 'site', domains: ['linkedin.com/posts', 'linkedin.com/pulse'], aliases: ['linkedin posts', 'linkedin articles', 'linkedin groups'] },
  { key: 'twitter',      category: 'site', domains: ['twitter.com', 'x.com'],      aliases: ['x (twitter)', 'twitter', ' x '] },
  { key: 'facebook',     category: 'site', domains: ['facebook.com'],              aliases: ['facebook professional groups', 'facebook groups', 'facebook'] },
];

// Match one free-text source string to a registry entry. Unknown strings become
// a best-effort site source (if they look like a domain) or a keyword source.
function matchSource(str = '') {
  const s = (str || '').toLowerCase().trim();
  if (!s) return null;
  for (const entry of SOURCE_REGISTRY) {
    if (entry.aliases.some(a => s.includes(a) || a.includes(s))) return entry;
  }
  const domainMatch = s.match(/([a-z0-9-]+\.)+[a-z]{2,}/);
  if (domainMatch) return { key: domainMatch[0], category: 'site', domains: [domainMatch[0]], aliases: [] };
  return { key: s.slice(0, 40), category: 'keyword', domains: [], aliases: [] };
}

// Merge AI-extracted (from the description) + UI-provided sources into a deduped
// list of registry entries. Empty → caller falls back to the default engine.
function resolveSources(profile, filters = {}) {
  const raw = [
    ...(Array.isArray(profile?.requestedSources) ? profile.requestedSources : []),
    ...(Array.isArray(filters?.sources) ? filters.sources : []),
  ].map(s => (typeof s === 'string' ? s : s?.name || '')).filter(Boolean);

  const seen = new Set();
  const out  = [];
  for (const s of raw) {
    const entry = matchSource(s);
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
  }
  return out;
}

// Relevance guard: does the job posting actually mention the technology/service?
// Prevents generic role searches (e.g. "CRM Manager") from attaching unrelated
// companies as leads. Safeguards keep it generic:
//   - physical products: the ROLE is the proxy (a "Plant Engineer" posting won't
//     contain "diesel generator"), so don't require a keyword mention.
//   - no terms to match: can't filter, pass through (e.g. "offshore dev team").
function jobMentionsCore(jr, terms = [], isPhysical = false) {
  if (isPhysical) return true;
  if (!terms.length) return true;
  const hay = `${jr.title || ''} ${jr.description || ''} ${jr.company_name || ''}`.toLowerCase();
  return terms.some(k => k && hay.includes(k.toLowerCase()));
}

// Is this posting a recruiter / staffing agency hiring for a CLIENT rather than
// itself? Such postings aren't end-customer demand. Uses AI-generated phrases —
// no static lists. Empty signals → never filters.
function isStaffingPosting(jr, profile) {
  const sig = profile?.staffingSignals || [];
  if (!sig.length) return false;
  const hay = `${jr.description || ''} ${jr.company_name || ''}`.toLowerCase();
  return sig.some(p => p && hay.includes(p.toLowerCase()));
}

// Does a Google Jobs result originate from one of the requested job boards?
function jobMatchesBoard(jr, boardDomains) {
  const via = (jr.via || '').toLowerCase();
  if (boardDomains.some(d => via.includes(d.split('.')[0]))) return true;
  const links = [
    ...(jr.apply_options || []).map(o => o.link || ''),
    ...(jr.related_links || []).map(l => l.link || ''),
  ];
  return links.some(href => boardDomains.some(d => href.toLowerCase().includes(d)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Fetch product page (URL input)
// ─────────────────────────────────────────────────────────────────────────────

async function fetchProductPageText(url) {
  try {
    const { data } = await axios.get(url, {
      timeout: 12000,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadBot/1.0)' },
      maxContentLength: 500000,
    });
    return data
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 4000);
  } catch (err) {
    logger.warn('URL fetch failed', { url, err: err.message });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1 — ONE AI call: understand product, pick search strategy
// ─────────────────────────────────────────────────────────────────────────────

const PROFILE_SYSTEM_PROMPT = `You are a B2B/B2C lead generation expert.

Analyze this product — it could be ANYTHING. Your job is to figure out:
1. What TYPE of product it is (digital/software vs physical/industrial vs consumer)
2. WHO needs to buy it
3. HOW to find those buyers

Return ONLY valid JSON, no markdown:
{
  "productName": "short product name",
  "productSummary": "one sentence what it is",
  "isRentalOrService": true or false,
  "isPhysicalProduct": true or false,
  "buyerType": "B2B" or "B2C" or "BOTH",
  "buyerDescription": "one sentence: who buys this and why",

  "platformKeywords": [
    "the SPECIFIC, uniquely-identifying brand/product/technology names — proper nouns someone would search by (e.g. Salesforce, NetSuite, SuiteCommerce, AWS, Snowflake, LangChain, Shopify, Kubernetes). MOST precise. Empty array if the offer has no specific named platform."
  ],

  "categoryKeywords": [
    "GENERIC category / concept terms around the offer (e.g. CRM, ERP, cloud, AI, DevOps, ecommerce, data warehouse). Broader than platformKeywords — used for forum recall and as a fallback, NOT as the primary job filter. NOT full sentences. NOT the user's prompt title."
  ],

  "vendorNames": [
    "the company/brand(s) that MAKE or OWN this platform/product (e.g. Salesforce, Oracle, NetSuite, Shopify). These are the vendor itself, NOT customers — they must never be returned as leads for an ecosystem service. Empty array if not applicable."
  ],

  "searchStrategy": "APOLLO" or "SERP" or "BOTH",

  "apolloProfile": {
    "buyerTitles": [
      "job title at buyer company who purchases this",
      "title 2",
      "title 3",
      "title 4",
      "title 5",
      "title 6"
    ],
    "buyerKeywords": [
      "keyword describing what BUYER COMPANIES DO — not what the product is",
      "keyword 2",
      "keyword 3"
    ],
    "personSeniority": ["manager", "director", "vp", "c_suite", "owner"]
  },

  "serpProfile": {
    "jobTitleSearches": [
      "job title to search on Google Jobs — someone at a BUYER company who manages this equipment",
      "title 2",
      "title 3",
      "title 4"
    ],
    "buyerIntentQueries": [
      "Google search query targeting companies actively LOOKING TO BUY or procure this",
      "query 2",
      "query 3",
      "query 4",
      "query 5",
      "query 6"
    ],
    "rfpQueries": [
      "Google query to find RFP, tender, procurement notices for this product",
      "query 2"
    ],
    "retailerQueries": [
      "Google query to find retailers or distributors (only for B2C products)",
      "query 2"
    ]
  },

  "sellerSignals": [
    "phrase in a company description meaning they SELL or MAKE this same product",
    "phrase 2",
    "phrase 3"
  ],

  "staffingSignals": [
    "phrases that appear in a JOB DESCRIPTION when a recruiter / staffing agency / IT body-shop is posting on behalf of a client, NOT hiring for itself (e.g. 'our client', 'on behalf of our client', 'we are recruiting for', 'staffing', 'C2C', 'contract role for our client', 'placement'). These postings are not end-customer demand."
  ],

  "buyerSignals": [
    "phrase confirming a company NEEDS or USES this product",
    "phrase 2"
  ],

  "requestedSources": [
    "any specific portal/website/platform the user EXPLICITLY named to search (e.g. LinkedIn, Indeed, Glassdoor, Reddit, Quora, Stack Overflow, Dev.to, Medium, Hacker News). Use the plain platform name. Empty array if the user named none."
  ]
}

CRITICAL RULES:

searchStrategy:
  - "APOLLO" = use Apollo database ONLY for: software, SaaS, IT services, digital tools, CRM, ERP, HR software, marketing platforms, cloud services, cybersecurity software
  - "SERP"   = use SerpAPI ONLY for: physical products (generators, machines, equipment, parts, tools, vehicles, hardware, construction materials), food, clothing, toys, consumer goods, industrial supplies, rental equipment
  - "BOTH"   = hybrid products that could go either way
  
  WHY: Apollo's database is 90% tech/software companies. Searching Apollo for "diesel generator" returns software companies. For physical products, Google Jobs and Google Search find the real industrial buyers far better.

isPhysicalProduct:
  - true  = generator, machine, equipment, tool, vehicle, food, clothing, hardware, construction material, industrial supply, medical device
  - false = software, SaaS, app, platform, digital service, IT consulting, cloud

apolloProfile: fill ONLY if searchStrategy is APOLLO or BOTH
  - buyerTitles: people at CUSTOMER companies who BUY this software/digital service
  - buyerKeywords: what buyer companies DO (not what you sell)
  - DO NOT fill for physical products

serpProfile: fill ONLY if searchStrategy is SERP or BOTH
  - jobTitleSearches: job titles on Google Jobs at companies that USE/NEED this product
    For generator: "Facilities Manager", "Plant Manager", "Power Systems Engineer", "Site Manager"
    For machine tool: "Maintenance Manager", "Production Manager", "Plant Engineer"
    For software (if BOTH): "IT Manager", "CTO", "Operations Manager"
  - buyerIntentQueries: Google queries targeting companies actively SEEKING TO BUY
    For generator: '"diesel generator" procurement company', '"backup power" supplier needed', '"generator rental" construction site'
    For machine: '"CNC machine" rental company', '"used lathe" buyer', '"milling machine" for hire'
  - rfpQueries: RFP/tender/procurement notice searches
  - retailerQueries: ONLY for B2C products — finding retailers/distributors

sellerSignals: phrases that identify COMPETITOR companies to exclude from results

staffingSignals: phrases in a JOB DESCRIPTION that reveal a recruiter / staffing agency / IT body-shop posting for a client rather than hiring for itself. These are not end-customer demand and are excluded. Empty array if not applicable.

requestedSources: ONLY list platforms the user EXPLICITLY named in their text (job boards, forums, social, communities). Do NOT invent sources. If the user did not name any specific platform, return an empty array.

platformKeywords: the MOST SPECIFIC, uniquely-identifying names for the technology — proper nouns (Salesforce, NetSuite, AWS, Snowflake, LangChain, Shopify, Kubernetes). Prefer these over generic words. A real buyer's job posting will name the platform. Empty if the offer genuinely has no specific platform (e.g. "offshore dev team").

categoryKeywords: the GENERIC category/concept terms (CRM, ERP, cloud, AI, DevOps, ecommerce). Broader and noisier than platformKeywords — used only for forum recall and as a fallback when there is no platform term. Never put a generic category here AND in platformKeywords. Concise terms only, never sentences or the user's prompt heading.

vendorNames: when the offer is a SERVICE around a third-party platform (e.g. "Salesforce consulting", "AWS migration"), name the platform's OWNER/MAKER (Salesforce, Amazon/AWS, Oracle, NetSuite, Snowflake, OpenAI…). The vendor is never a buyer of its own ecosystem services, so it is excluded from results. Leave empty for generic offers with no single owning vendor.`;

async function buildProductProfile(productInput) {
  let urlText = '';
  if (productInput.url) {
    urlText = (await fetchProductPageText(productInput.url)) || '';
  }

  // The description arrives pre-budgeted per field by the controller (offer details
  // + buyer hints + exclusions, each capped independently), so keep this cap large
  // enough to hold the full assembled blob — nothing the user typed gets re-dropped.
  // Scraped URL text and uploaded docs stay tightly capped; they're noisy by nature.
  const parts = [
    productInput.url         ? `Product URL: ${productInput.url}`                          : '',
    urlText                  ? `Page content:\n${urlText.slice(0, 1500)}`                  : '',
    productInput.description ? `Description:\n${productInput.description.slice(0, 16000)}`  : '',
    productInput.docText     ? `Document:\n${productInput.docText.slice(0, 1500)}`         : '',
    productInput.content && !productInput.description && !productInput.docText
      ? `Info:\n${productInput.content.slice(0, 1000)}` : '',
  ].filter(Boolean);

  const combined = parts.join('\n\n');
  if (!combined.trim()) throw new Error('No product information provided');

  // If user edited the AI prompt, use that directly
  if (productInput.customPrompt && productInput.customPrompt.trim().length > 20) {
    logger.info('Using user-edited custom prompt');
    return buildProfileFromText(
      `User-approved discovery prompt:\n\n${productInput.customPrompt.trim()}`
    );
  }

  return buildProfileFromText(combined);
}

async function buildProfileFromText(combined) {
  try {
    const raw     = await callOpenAI(PROFILE_SYSTEM_PROMPT, `Product:\n\n${combined}`, 1600);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const profile = JSON.parse(cleaned);

    logger.info('Product profile built', {
      name:             profile.productName,
      isPhysical:       profile.isPhysicalProduct,
      searchStrategy:   profile.searchStrategy,
      buyerType:        profile.buyerType,
      apolloTitles:     profile.apolloProfile?.buyerTitles?.length,
      serpJobTitles:    profile.serpProfile?.jobTitleSearches?.length,
      serpBuyerQueries: profile.serpProfile?.buyerIntentQueries?.length,
    });

    return profile;
  } catch (err) {
    logger.error('Product profile AI failed — minimal fallback', { err: err.message });
    const words = combined.split(/\s+/).slice(0, 5).join(' ');
    return {
      productName:       words,
      productSummary:    combined.slice(0, 150),
      isRentalOrService: false,
      isPhysicalProduct: false,
      buyerType:         'B2B',
      searchStrategy:    'BOTH',
      buyerDescription:  'Companies that need this product',
      apolloProfile: {
        buyerTitles:   ['Procurement Manager', 'Operations Manager', 'Facilities Manager'],
        buyerKeywords: [words],
        personSeniority: ['manager', 'director', 'vp', 'c_suite'],
      },
      serpProfile: {
        jobTitleSearches:    ['Operations Manager', 'Procurement Manager'],
        buyerIntentQueries:  [`"${words}" needed`, `"${words}" supplier`, `looking for "${words}"`],
        rfpQueries:          [`"${words}" RFP tender`],
        retailerQueries:     [],
      },
      sellerSignals: [],
      buyerSignals:  [],
      requestedSources: [],
      platformKeywords: [],
      categoryKeywords: words ? [words] : [],
      staffingSignals:  ['our client', 'on behalf of our client', 'we are recruiting for', 'staffing'],
      vendorNames:   [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Competitor filter — AI-generated signals only, zero static lists
// ─────────────────────────────────────────────────────────────────────────────

function isCompetitor(lead, profile) {
  if (!profile?.sellerSignals?.length) return false;
  const text = [lead.companyName, lead.description, lead.signalText]
    .filter(Boolean).join(' ').toLowerCase();
  return profile.sellerSignals.some(s => text.includes(s.toLowerCase()));
}

// ─────────────────────────────────────────────────────────────────────────────
// Apollo API — used ONLY for digital/software products
// ─────────────────────────────────────────────────────────────────────────────

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

async function apolloPeopleSearch(params, page = 1) {
  if (!config.apollo?.apiKey) {
    logger.warn('APOLLO_API_KEY not set — skipping');
    return { people: [], totalPages: 0 };
  }
  try {
    const { data } = await axios.post(
      `${APOLLO_BASE}/mixed_people/api_search`,   // current non-deprecated endpoint
      { page, per_page: 25, ...params },
      {
        headers: {
          'Content-Type':  'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key':     config.apollo.apiKey,
        },
        timeout: 20000,
      }
    );
    return {
      people:     data.people || [],
      totalPages: data.pagination?.total_pages || 1,
    };
  } catch (err) {
    const detail = err.response?.data?.error || err.response?.data?.message || err.message;
    logger.error('Apollo people search failed', { page, err: detail });
    return { people: [], totalPages: 0 };
  }
}

async function apolloCompanySearch(params, page = 1) {
  if (!config.apollo?.apiKey) {
    logger.warn('APOLLO_API_KEY not set — skipping');
    return { organizations: [], totalPages: 0 };
  }
  try {
    const { data } = await axios.post(
      `${APOLLO_BASE}/organizations/search`,
      { page, per_page: 25, ...params },
      {
        headers: {
          'Content-Type':  'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key':     config.apollo.apiKey,
        },
        timeout: 20000,
      }
    );
    return {
      organizations: data.organizations || [],
      totalPages:    data.pagination?.total_pages || 1,
    };
  } catch (err) {
    const detail = err.response?.data?.error || err.response?.data?.message || err.message;
    logger.error('Apollo company search failed', { page, err: detail });
    return { organizations: [], totalPages: 0 };
  }
}

function regionToCode(region = '') {
  const map = {
    'usa': 'US', 'us': 'US', 'united states': 'US', 'america': 'US',
    'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB',
    'india': 'IN', 'canada': 'CA', 'australia': 'AU',
    'germany': 'DE', 'france': 'FR', 'singapore': 'SG',
    'uae': 'AE', 'dubai': 'AE', 'netherlands': 'NL',
    'brazil': 'BR', 'spain': 'ES', 'italy': 'IT',
  };
  return map[region.toLowerCase().trim()] || null;
}

function empSize(n = 0) {
  if (n > 10000) return '10000+';
  if (n > 1000)  return '1000-10000';
  if (n > 200)   return '200-1000';
  if (n > 50)    return '50-200';
  if (n > 10)    return '10-50';
  return '';
}

function buildSourceUrl(org) {
  if (org.website_url) return org.website_url;
  if (org.primary_domain) return `https://${org.primary_domain}`;
  if (org.linkedin_url)   return org.linkedin_url;
  return '';
}

function personToLead(person, profile) {
  const org = person.organization || {};
  if (!org.name) return null;
  const website     = normDomain(org.website_url || org.primary_domain || '');
  const contactName = [person.first_name, person.last_name].filter(Boolean).join(' ') || null;
  return {
    companyName:       org.name,
    website,
    industry:          org.industry        || '',
    location:          [org.city, org.country].filter(Boolean).join(', '),
    companySize:       empSize(org.estimated_num_employees || 0),
    description:       org.short_description || '',
    techStack:         org.technology_names  || [],
    signalType:        'product_interest',
    signalText:        `${contactName || 'Buyer'} (${person.title || 'decision-maker'}) at ${org.name}`,
    confidence:        82,
    relevanceScore:    78,
    contactName,
    contactTitle:      person.title        || null,
    contactEmail:      person.email        || null,
    contactLinkedin:   person.linkedin_url || null,
    companyLinkedinUrl: org.linkedin_url   || null,
    source:    'Apollo People Search',
    sourceUrl: buildSourceUrl(org),
    _rawDescription: org.short_description || '',
  };
}

function orgToLead(org, profile) {
  if (!org.name) return null;
  const website = normDomain(org.website_url || org.primary_domain || '');
  return {
    companyName:       org.name,
    website,
    industry:          org.industry        || '',
    location:          [org.city, org.country].filter(Boolean).join(', '),
    companySize:       empSize(org.estimated_num_employees || 0),
    description:       org.short_description || '',
    techStack:         org.technology_names  || [],
    signalType:        'product_interest',
    signalText:        `${org.industry || 'Company'} — potential buyer for: ${profile.productSummary?.slice(0, 80)}`,
    confidence:        75,
    relevanceScore:    72,
    contactName:       null,
    contactTitle:      null,
    contactEmail:      null,
    contactLinkedin:   null,
    companyLinkedinUrl: org.linkedin_url   || null,
    source:    'Apollo Company Search',
    sourceUrl: buildSourceUrl(org),
    _rawDescription: org.short_description || '',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Parse a free-text region string into an array of SerpAPI-compatible locations.
// Google Jobs only accepts ONE location per request, so we search each separately.
// ─────────────────────────────────────────────────────────────────────────────
const REGION_MAP = {
  usa: 'United States', us: 'United States', 'united states': 'United States', america: 'United States',
  uk: 'United Kingdom', gb: 'United Kingdom', 'great britain': 'United Kingdom', 'united kingdom': 'United Kingdom',
  uae: 'United Arab Emirates', 'u.a.e': 'United Arab Emirates',
  india: 'India', in: 'India',
  canada: 'Canada', ca: 'Canada',
  australia: 'Australia', au: 'Australia',
  germany: 'Germany', de: 'Germany',
  france: 'France', fr: 'France',
  singapore: 'Singapore', sg: 'Singapore',
  europe: 'Europe',
  'south africa': 'South Africa', sa: 'South Africa',
  brazil: 'Brazil', br: 'Brazil',
  mexico: 'Mexico', mx: 'Mexico',
  japan: 'Japan', jp: 'Japan',
  china: 'China', cn: 'China',
};

function parseSerpLocations(region) {
  if (!region) return [null];  // null = no location filter
  return region
    .split(/[,;|/\\]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .map(s => REGION_MAP[s.toLowerCase()] || s);
}

// ─────────────────────────────────────────────────────────────────────────────
// SerpAPI — used for physical products AND B2C products
// ─────────────────────────────────────────────────────────────────────────────

async function fetchJobsPage(query, filters = {}, nextPageToken = null) {
  if (!config.serpapi?.key) {
    logger.warn('SERPAPI_KEY not set', { query });
    return { jobs: [], nextToken: null };
  }
  try {
    const params = {
      api_key: config.serpapi.key,
      engine:  'google_jobs',
      q:       query,
      hl:      'en',
    };
    const serpLoc = filters._serpLocation !== undefined ? filters._serpLocation : null;
    if (serpLoc)              params.location = serpLoc;
    if (nextPageToken)        params.next_page_token = nextPageToken;

    const { data } = await axios.get('https://serpapi.com/search', { params, timeout: 15000 });
    return {
      jobs:      data.jobs_results || [],
      nextToken: data.serpapi_pagination?.next_page_token || null,
    };
  } catch (err) {
    logger.error('Google Jobs failed', { query, err: err.message });
    return { jobs: [], nextToken: null };
  }
}

async function fetchAllJobPages(query, filters = {}, maxPages = 3) {
  const locations = parseSerpLocations(filters.targetRegion);
  const seen = new Set();
  const all = [];

  for (const loc of locations) {
    const locFilters = { ...filters, _serpLocation: loc };
    let token = null;
    for (let p = 0; p < maxPages; p++) {
      const { jobs, nextToken } = await fetchJobsPage(query, locFilters, token);
      for (const job of jobs) {
        const key = `${(job.company_name || '').toLowerCase()}|${(job.title || '').toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(job);
        }
      }
      token = nextToken;
      if (!token || jobs.length === 0) break;
      await sleep(600);
    }
    if (locations.length > 1) await sleep(400); // brief pause between locations
  }
  return all;
}

async function searchOrganic(query) {
  if (!config.serpapi?.key) {
    logger.warn('SERPAPI_KEY not set', { query });
    return [];
  }
  try {
    const { data } = await axios.get('https://serpapi.com/search', {
      params: { api_key: config.serpapi.key, q: query, num: 10, engine: 'google' },
      timeout: 12000,
    });
    return data.organic_results || [];
  } catch (err) {
    logger.error('Organic search failed', { query, err: err.message });
    return [];
  }
}

function jobToLead(jr, profile) {
  const companyName = (jr.company_name || '').trim();
  if (!companyName) return null;

  let website = '';
  const boardHints = ['linkedin.com','indeed.com','glassdoor.com','monster.com',
    'ziprecruiter.com','dice.com','seek.com','naukri.com','lever.co',
    'greenhouse.io','workday.com','wellfound.com'];
  for (const link of (jr.related_links || [])) {
    const href = link.link || '';
    if (!boardHints.some(h => href.includes(h)) && href.startsWith('http')) {
      website = normDomain(href);
      break;
    }
  }

  const postedAt   = jr.detected_extensions?.posted_at || '';
  const freshScore = /hour|today|1 day/i.test(postedAt) ? 92
                   : /[2-3] days?/i.test(postedAt)      ? 84
                   : 76;

  return {
    companyName,
    website,
    industry:    '',
    location:    jr.location || '',
    companySize: '',
    description: '',
    techStack:   [],
    signalType:  'product_interest',
    signalText:  `Hiring "${jr.title}" — indicates active need for: ${profile.productSummary?.slice(0, 80)}`,
    confidence:  85,
    relevanceScore: freshScore,
    contactName:     null,
    contactTitle:    null,
    contactEmail:    null,
    contactLinkedin: null,
    companyLinkedinUrl: null,
    jobPostings: [{
      title:    jr.title || '',
      url:      jr.apply_options?.[0]?.link || '',
      snippet:  (jr.description || '').slice(0, 300),
      postedAt,
      platform: jr.via || '',
    }],
    source:    `Google Jobs — ${jr.via || 'Job Board'}`,
    sourceUrl: jr.apply_options?.[0]?.link || '',
    _rawDescription: jr.description || '',
    _isJobLead: true,
  };
}

function organicToLead(result, profile) {
  if (!result.link) return null;
  const website = normDomain(result.link);
  const title   = result.title   || '';
  const snippet = result.snippet || '';
  const companyName = title.replace(/[-–|].*$/, '').trim().slice(0, 80);
  if (!companyName || companyName.length < 3) return null;
  return {
    companyName,
    website,
    industry:    '',
    location:    '',
    companySize: '',
    description: snippet.slice(0, 200),
    techStack:   [],
    signalType:  'product_interest',
    signalText:  snippet.slice(0, 150),
    confidence:  65,
    relevanceScore: 68,
    contactName:     null,
    contactTitle:    null,
    contactEmail:    null,
    contactLinkedin: null,
    companyLinkedinUrl: null,
    source:    'Google Search',
    sourceUrl: result.link,
    _rawDescription: snippet,
  };
}

// Apollo expects full country/region names, not ISO codes or abbreviations
function regionToApolloLocation(region = '') {
  const map = {
    'usa': 'United States', 'us': 'United States', 'united states': 'United States', 'america': 'United States',
    'uk': 'United Kingdom', 'united kingdom': 'United Kingdom', 'england': 'United Kingdom', 'britain': 'United Kingdom',
    'india': 'India', 'canada': 'Canada', 'australia': 'Australia',
    'germany': 'Germany', 'france': 'France', 'singapore': 'Singapore',
    'uae': 'United Arab Emirates', 'dubai': 'United Arab Emirates', 'netherlands': 'Netherlands',
    'brazil': 'Brazil', 'spain': 'Spain', 'italy': 'Italy',
    'china': 'China', 'japan': 'Japan', 'south korea': 'South Korea', 'korea': 'South Korea',
    'mexico': 'Mexico', 'argentina': 'Argentina', 'colombia': 'Colombia',
    'south africa': 'South Africa', 'nigeria': 'Nigeria', 'kenya': 'Kenya',
    'saudi arabia': 'Saudi Arabia', 'israel': 'Israel', 'turkey': 'Turkey',
    'sweden': 'Sweden', 'norway': 'Norway', 'denmark': 'Denmark', 'finland': 'Finland',
    'poland': 'Poland', 'switzerland': 'Switzerland', 'austria': 'Austria', 'belgium': 'Belgium',
    'new zealand': 'New Zealand', 'indonesia': 'Indonesia', 'malaysia': 'Malaysia', 'philippines': 'Philippines',
  };
  return map[region.toLowerCase().trim()] || region;
}

// Maps UI company size labels → Apollo organization_num_employees_ranges format ["min,max"]
function companySizeToApolloRanges(size = '') {
  const map = {
    '1-10 (Micro)':              ['1,10'],
    '11-50 (Small)':             ['11,50'],
    '51-200 (Mid-size)':         ['51,200'],
    '201-500 (Growing)':         ['201,500'],
    '501-1000 (Large)':          ['501,1000'],
    '1000-5000 (Enterprise)':    ['1000,5000'],
    '5000+ (Global Enterprise)': ['5001,1000000'],
  };
  return map[size] || null;
}

// Maps UI seniority labels → Apollo person_seniority values
function seniorityToApolloValues(level = '') {
  const map = {
    'C-suite':                ['c_suite', 'owner', 'founder', 'partner'],
    'VP / SVP Level':         ['vp', 'head'],
    'Director Level':         ['director'],
    'Manager Level':          ['manager'],
    'Team Lead':              ['manager', 'senior'],
    'Individual Contributor': ['senior', 'entry'],
    'Board / Advisor Level':  ['c_suite', 'owner', 'partner'],
  };
  return map[level] || null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY A — Apollo search (software / digital products only)
// ─────────────────────────────────────────────────────────────────────────────

async function runApolloSearch(profile, filters, tryAdd, rawTarget = 125, rawLeads = []) {
  const {
    targetRegion = '', targetIndustry = '',
    companySize = '', seniorityLevel = '',
    decisionMakers = [],
  } = filters;
  // Apollo requires full location names ("United States"), not ISO codes ("US") or abbreviations ("USA")
  const apolloLocation  = targetRegion   ? regionToApolloLocation(targetRegion) : null;
  const employeeRanges  = companySizeToApolloRanges(companySize);   // null if "Any Size"
  const userSeniority   = seniorityToApolloValues(seniorityLevel);  // null if "Any"
  const ap              = profile.apolloProfile || {};
  const aiTitles        = (ap.buyerTitles   || []).slice(0, 6);
  const keywords        = (ap.buyerKeywords || []).slice(0, 3);

  // User-selected decision makers supplement AI titles; deduplicate
  const userTitles = (decisionMakers || []).filter(Boolean);
  const titles     = userTitles.length > 0
    ? [...new Set([...userTitles, ...aiTitles])].slice(0, 8)
    : aiTitles;

  // User seniority overrides AI seniority when explicitly selected
  const seniority = userSeniority || ap.personSeniority || ['manager', 'director', 'vp', 'c_suite', 'owner'];
  const maxPages  = TEST_MODE ? TEST_MAX_PAGES : Math.min(8, Math.max(1, Math.ceil(rawTarget / 20)));

  logger.info('Apollo search filters', {
    location:       apolloLocation  || 'any',
    companySize:    companySize     || 'any',
    employeeRanges: employeeRanges  || 'any',
    seniority:      seniorityLevel  || 'ai-default',
    userTitles:     userTitles.length,
    aiTitles:       aiTitles.length,
    totalTitles:    titles.length,
    rawTarget,
    maxPages,
  });

  // Primary: people search by job title
  const titleGroups = chunkArray(titles, 3).filter(g => g.length > 0);
  if (TEST_MODE && titleGroups.length > 1) titleGroups.splice(1);

  outer:
  for (const group of titleGroups) {
    const params = {
      person_titles:          group,
      person_seniority:       seniority,
      include_similar_titles: true,   // match title variants ("HR Director", "Human Resources Manager", etc.)
    };
    if (apolloLocation)  params.person_locations = [apolloLocation];
    if (employeeRanges)  params.organization_num_employees_ranges = employeeRanges;
    // NOTE: q_keywords is intentionally omitted from people search —
    // combining keyword + title + seniority + location over-constrains Apollo and returns 0 results.
    // The title + seniority filters alone are specific enough.

    for (let page = 1; page <= maxPages; page++) {
      const { people, totalPages } = await apolloPeopleSearch(params, page);
      logger.info('Apollo people page', { titles: group[0], page, found: people.length });
      for (const p of people) {
        if (rawLeads.length >= rawTarget) break;  // stop per-item once buffer is full
        const lead = personToLead(p, profile);
        if (lead) tryAdd(lead);
      }
      if (page >= totalPages) break;
      if (rawLeads.length >= rawTarget) break outer;  // have enough raw leads
      await sleep(400);
    }
    if (rawLeads.length >= rawTarget) break;
    await sleep(300);
  }

  // Secondary: company keyword search (only if still below target)
  if (keywords.length > 0 && rawLeads.length < rawTarget) {
    const kws = [...keywords, targetIndustry].filter(Boolean);
    const params = { q_keywords: kws.join(' OR ') };
    if (apolloLocation) params.organization_locations = [apolloLocation];
    if (employeeRanges) params.organization_num_employees_ranges = employeeRanges;

    const companyPages = TEST_MODE ? 1 : Math.min(4, Math.max(1, Math.ceil(rawTarget / 25)));
    for (let page = 1; page <= companyPages; page++) {
      const { organizations, totalPages } = await apolloCompanySearch(params, page);
      logger.info('Apollo company page', { keywords: kws, page, found: organizations.length });
      for (const org of organizations) {
        if (rawLeads.length >= rawTarget) break;  // stop per-item once buffer is full
        const lead = orgToLead(org, profile);
        if (lead) tryAdd(lead);
      }
      if (page >= totalPages) break;
      if (rawLeads.length >= rawTarget) break;
      await sleep(400);
    }
  }

  logger.info('Apollo search done', { rawCollected: rawLeads.length, rawTarget });
}

// ─────────────────────────────────────────────────────────────────────────────
// STRATEGY B — SerpAPI search (physical products, industrial, B2C)
//
// THREE sub-phases:
//   B1: Google Jobs — companies HIRING roles that USE this product
//       Every job result = a company that actively needs this product
//   B2: Buyer-intent organic — procurement signals, RFPs, tenders
//   B3: Retailer/distributor search (only for B2C products)
// ─────────────────────────────────────────────────────────────────────────────

async function runSerpSearch(profile, filters, tryAdd, rawTarget = 125, rawLeads = []) {
  const { targetRegion = '', targetIndustry = '' } = filters;
  const reg = targetRegion   ? ` ${targetRegion}`   : '';
  const ind = targetIndustry ? ` ${targetIndustry}` : '';
  const sp  = profile.serpProfile || {};

  // Scale query counts based on target
  const maxJobTitles   = TEST_MODE ? 2 : Math.min(6, Math.max(2, Math.ceil(rawTarget / 15)));
  const maxBuyerQs     = TEST_MODE ? 2 : Math.min(8, Math.max(3, Math.ceil(rawTarget / 20)));
  const maxJobsPages   = TEST_MODE ? TEST_MAX_PAGES : Math.min(5, Math.max(1, Math.ceil(rawTarget / 30)));

  // B1: Google Jobs for buyer job titles
  const jobTitles = (sp.jobTitleSearches || []).slice(0, maxJobTitles);

  logger.info('SerpAPI Google Jobs search', { titles: jobTitles, rawTarget });

  for (const title of jobTitles) {
    if (rawLeads.length >= rawTarget) break;
    const query = `${title}${ind}${reg}`;
    const jobs  = await fetchAllJobPages(query, filters, maxJobsPages);
    logger.info('Jobs fetched', { title, count: jobs.length });

    for (const jr of jobs) {
      if (rawLeads.length >= rawTarget) break;  // stop per-item once buffer is full
      const lead = jobToLead(jr, profile);
      if (lead) tryAdd(lead);
    }
    await sleep(TEST_MODE ? 300 : 700);
  }

  // B2: Buyer-intent organic queries
  const buyerQueries = (sp.buyerIntentQueries || [])
    .slice(0, maxBuyerQs)
    .map(q => `${q}${ind}${reg}`);

  logger.info('SerpAPI buyer-intent queries', { count: buyerQueries.length });

  for (const query of buyerQueries) {
    if (rawLeads.length >= rawTarget) break;
    const results = await searchOrganic(query);
    for (const result of results) {
      if (rawLeads.length >= rawTarget) break;
      const lead = organicToLead(result, profile);
      if (lead) tryAdd(lead);
    }
    await sleep(TEST_MODE ? 300 : 800);
  }

  // B3: RFP / procurement queries
  const rfpQueries = (sp.rfpQueries || [])
    .slice(0, TEST_MODE ? 1 : 2)
    .map(q => `${q}${ind}${reg}`);

  for (const query of rfpQueries) {
    if (rawLeads.length >= rawTarget) break;
    const results = await searchOrganic(query);
    for (const result of results) {
      if (rawLeads.length >= rawTarget) break;
      const lead = organicToLead(result, profile);
      if (lead) {
        lead.signalType     = 'procurement';
        lead.relevanceScore = 85;
        lead.confidence     = 88;
        lead.source         = 'RFP / Procurement Signal';
        tryAdd(lead);
      }
    }
    await sleep(TEST_MODE ? 300 : 800);
  }

  // B4: Retailer/distributor queries (B2C only)
  if (profile.buyerType === 'B2C' || profile.buyerType === 'BOTH') {
    const retailQueries = (sp.retailerQueries || [])
      .slice(0, TEST_MODE ? 1 : 3)
      .map(q => `${q}${reg}`);

    for (const query of retailQueries) {
      if (rawLeads.length >= rawTarget) break;
      const results = await searchOrganic(query);
      for (const result of results) {
        if (rawLeads.length >= rawTarget) break;
        const lead = organicToLead(result, profile);
        if (lead) {
          lead.source = 'Retailer / Distributor Search';
          tryAdd(lead);
        }
      }
      await sleep(TEST_MODE ? 300 : 800);
    }
  }

  logger.info('SerpAPI search done', { rawCollected: rawLeads.length, rawTarget });
}

// ─────────────────────────────────────────────────────────────────────────────
// SOURCED SEARCH — run ONLY the portals the user named (best-effort, all sources)
// ─────────────────────────────────────────────────────────────────────────────

// Query building blocks for sourced search.
// A name >5 words is almost certainly the user's prompt heading, not a real term.
function cleanTerm(t = '') {
  const s = t.trim();
  return s && s.split(/\s+/).length <= 5 ? s : '';
}
function sourceQueryTerms(profile) {
  const sp = profile.serpProfile  || {};
  const ap = profile.apolloProfile || {};
  const titles = (sp.jobTitleSearches || ap.buyerTitles || []).map(cleanTerm).filter(Boolean).slice(0, 6);

  // platform = SPECIFIC named tech (Salesforce, AWS, Snowflake) — drives precise
  // job matching. category = GENERIC concepts (CRM, cloud, AI) — recall/fallback.
  const platform = (profile.platformKeywords || []).map(cleanTerm).filter(Boolean).slice(0, 4);
  let   category = (profile.categoryKeywords || []).map(cleanTerm).filter(Boolean);
  // Fallback chain so generic offers with no explicit keywords still search:
  // Apollo buyer keywords, then a sane slice of the product name (never the heading).
  if (!platform.length && !category.length) {
    category = (ap.buyerKeywords || []).map(cleanTerm).filter(Boolean);
    if (!category.length && profile.productName) category = [profile.productName.split(/\s+/).slice(0, 3).join(' ')];
  }
  category = category.slice(0, 4);

  return { titles, platform, category };
}

// "(SuiteCommerce OR NetSuite OR "Suite Script")" — phrases quoted, words bare.
function orClause(terms) {
  const parts = terms.map(t => (t.includes(' ') ? `"${t}"` : t));
  return parts.length ? `(${parts.join(' OR ')})` : '';
}
const INTENT_CLAUSE = '(need OR needs OR looking OR hiring OR consultant OR developer OR help OR recommend OR migration OR implementation OR vendor OR agency OR partner OR issue)';

// AI: pull real companies with buying intent out of organic search snippets.
async function extractCompaniesFromSnippets(results, profile, sourceLabel) {
  if (!results.length) return [];
  const list = results
    .map((r, i) => `[${i}] Title: ${r.title || ''}\nSnippet: ${r.snippet || ''}\nURL: ${r.link || ''}`)
    .join('\n\n');
  const systemPrompt = `You read posts/snippets from ${sourceLabel} about "${profile.productSummary || profile.productName}".
For each snippet decide if it names a REAL company (not a product, subreddit, username, or generic term) showing BUYING INTENT or a need related to this offer.
Return ONLY a JSON array: [{"index":0,"companyName":"...","buyingIntent":"why","isValid":true}]. isValid=false when there is no real company or no intent. Empty array if none.`;
  try {
    const raw    = await callOpenAI(systemPrompt, list, 800);
    const m      = raw.match(/\[[\s\S]*\]/);
    const parsed = m ? JSON.parse(m[0]) : [];
    const leads  = [];
    for (const item of parsed) {
      if (!item.isValid || !item.companyName) continue;
      const r = results[item.index];
      if (!r) continue;
      leads.push({
        companyName: item.companyName.trim(),
        website: '', industry: '', location: '', companySize: '',
        description: (r.snippet || '').slice(0, 200), techStack: [],
        signalType:  'community_intent',
        signalText:  `${sourceLabel}: "${r.title || ''}" — ${item.buyingIntent || (r.snippet || '').slice(0, 120)}`,
        confidence:  70, relevanceScore: 74,
        contactName: null, contactTitle: null, contactEmail: null,
        contactLinkedin: null, companyLinkedinUrl: null, jobPostings: [],
        source:    `${sourceLabel} — ${r.link}`,
        sourceUrl: r.link,
        _rawDescription: r.snippet || '', _isJobLead: false,
      });
    }
    return leads;
  } catch (err) {
    logger.warn('Source extraction failed', { sourceLabel, err: err.message });
    return [];
  }
}

async function runSourcedSearch(profile, filters, sources, tryAdd, rawTarget = 125, rawLeads = []) {
  const { titles, platform, category } = sourceQueryTerms(profile);
  // Job matching prefers the SPECIFIC platform terms (so "Salesforce" matches, a
  // bare "CRM Manager" doesn't); falls back to category when there's no platform.
  const matchTerms = platform.length ? platform : category;
  // Forum/site search uses the broad set for recall.
  const kw = orClause([...new Set([...platform, ...category])]);
  // NOTE: region is intentionally NOT appended to organic queries — free-text
  // "USA, UAE" forces Google to AND-match those tokens and kills results. Job
  // boards still get location via fetchAllJobPages(filters). Forums aren't local.

  // Fairness cap: no single query/source may contribute more than this slice of
  // the buffer, so one dominant query (e.g. "Salesforce") can't fill all the
  // slots and starve the other keywords and forum sources.
  const PER_PASS_CAP = Math.max(3, Math.ceil(rawTarget / 6));

  const jobBoards = sources.filter(s => s.category === 'jobboard');
  const sites     = sources.filter(s => s.category === 'site');
  const keywords  = sources.filter(s => s.category === 'keyword');

  logger.info('Sourced search start', {
    jobBoards: jobBoards.map(s => s.key),
    sites:     sites.map(s => s.key),
    keywords:  keywords.map(s => s.key),
    platform, category, rawTarget,
  });

  // ── Job boards ──────────────────────────────────────────────────────────────
  if (jobBoards.length) {
    const boardDomains = jobBoards.flatMap(b => b.domains);
    const maxPages = TEST_MODE ? TEST_MAX_PAGES : 3;

    // (a) Google Jobs — queries are ROLE-anchored, never the bare brand. Searching
    //     just "Salesforce" returns the vendor's own postings; "Salesforce
    //     Administrator" / "Salesforce Developer" leans toward companies staffing
    //     the skill. Keep only jobs that mention the specific tech and aren't
    //     posted by a staffing agency.
    const anchorWords = matchTerms.map(k => k.toLowerCase().split(/\s+/)[0]);
    const techTitles  = titles.filter(t => anchorWords.some(w => w && t.toLowerCase().includes(w)));
    const brand       = matchTerms[0];
    let jobQueries    = [...techTitles];
    if (brand) jobQueries.push(`${brand} developer`, `${brand} administrator`, `${brand} consultant`);
    if (!jobQueries.length) jobQueries = titles;   // fallback only if we have nothing else
    jobQueries = [...new Set(jobQueries)].slice(0, TEST_MODE ? 2 : 6);

    for (const q of jobQueries) {
      if (rawLeads.length >= rawTarget) break;
      const jobs = await fetchAllJobPages(q, filters, maxPages);  // location via filters
      let kept = 0;
      for (const jr of jobs) {
        if (rawLeads.length >= rawTarget || kept >= PER_PASS_CAP) break;  // fair share per query
        if (!jobMatchesBoard(jr, boardDomains)) continue;                  // requested board only
        if (!jobMentionsCore(jr, matchTerms, profile.isPhysicalProduct)) continue;  // must mention the tech
        if (isStaffingPosting(jr, profile)) continue;                      // skip recruiter/body-shop postings
        const lead = jobToLead(jr, profile);
        if (lead && tryAdd(lead)) kept++;
      }
      logger.info('Job-board (Google Jobs) pass', { query: q, fetched: jobs.length, kept });
      await sleep(TEST_MODE ? 300 : 600);
    }

    // (b) Direct site: search per board — reliable, doesn't depend on Google Jobs
    //     attribution. Finds the board's own listing/discussion pages.
    if (kw) {
      for (const board of jobBoards) {
        if (rawLeads.length >= rawTarget) break;
        const root  = board.domains[0].split('/')[0];
        const siteQ = `site:${board.domains[0]} ${kw} ${INTENT_CLAUSE}`;
        try {
          const results = (await searchOrganic(siteQ)).filter(r => (r.link || '').toLowerCase().includes(root));
          const leads   = await extractCompaniesFromSnippets(results, profile, board.key);
          let kept = 0;
          for (const lead of leads) { if (rawLeads.length >= rawTarget || kept >= PER_PASS_CAP) break; if (tryAdd(lead)) kept++; }
          logger.info('Job-board (site:) pass', { source: board.key, query: siteQ, found: leads.length });
        } catch (err) {
          logger.warn('Job-board site: failed', { source: board.key, err: err.message });
        }
        await sleep(TEST_MODE ? 300 : 600);
      }
    }
  }

  // ── Site sources (community / forums / social): site:<domain> + AI extraction ──
  for (const site of sites) {
    if (rawLeads.length >= rawTarget) break;
    if (!kw) break;  // nothing meaningful to search for
    const root = site.domains[0].split('/')[0];
    // Two queries: brand+intent (high precision), then brand alone (recall).
    const queries = [`site:${site.domains[0]} ${kw} ${INTENT_CLAUSE}`];
    if (!TEST_MODE) queries.push(`site:${site.domains[0]} ${kw}`);
    for (const siteQ of queries) {
      if (rawLeads.length >= rawTarget) break;
      try {
        const results = (await searchOrganic(siteQ)).filter(r => (r.link || '').toLowerCase().includes(root));
        const leads = await extractCompaniesFromSnippets(results, profile, site.key);
        let kept = 0;
        for (const lead of leads) { if (rawLeads.length >= rawTarget || kept >= PER_PASS_CAP) break; if (tryAdd(lead)) kept++; }
        logger.info('Site-source pass', { source: site.key, query: siteQ, found: leads.length });
      } catch (err) {
        logger.warn('Site-source failed', { source: site.key, err: err.message });
      }
      await sleep(TEST_MODE ? 300 : 700);
    }
  }

  // ── Unknown / keyword sources: plain organic search, best-effort ──
  for (const src of keywords) {
    if (rawLeads.length >= rawTarget) break;
    if (!kw) break;
    const q = `${src.key} ${kw}`.trim();
    try {
      const results = await searchOrganic(q);
      const leads   = await extractCompaniesFromSnippets(results, profile, src.key);
      let kept = 0;
      for (const lead of leads) {
        if (rawLeads.length >= rawTarget || kept >= PER_PASS_CAP) break;
        if (tryAdd(lead)) kept++;
      }
    } catch (err) {
      logger.warn('Keyword-source failed', { source: src.key, err: err.message });
    }
    await sleep(TEST_MODE ? 300 : 700);
  }

  logger.info('Sourced search done', { rawCollected: rawLeads.length, rawTarget });
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3 — AI batch scoring: BUYER vs SELLER (10 per AI call)
// ─────────────────────────────────────────────────────────────────────────────

async function scoreBatch(leads, profile) {
  if (!leads.length) return leads;

  const list = leads.map((l, i) => {
    const desc = (l._rawDescription || l.description || '').slice(0, 200);
    return `${i + 1}. Name: ${l.companyName} | Industry: ${l.industry || '?'} | Desc: ${desc || 'none'}`;
  }).join('\n');

  const systemPrompt = `Classify each entry as:
  BUYER = actual end-customer company that PURCHASES/USES this product for itself
  SELLER = company that SELLS/MAKES this product (competitor), OR a staffing agency /
           recruiting firm / IT body-shop / consultancy hiring this skill on behalf of
           a client (e.g. TEKsystems, Pentasia, VLink, Innovien) — NOT an end-customer
  AGGREGATOR = listing site, marketplace, RFP portal, job board — NOT an actual company

For AGGREGATOR entries: if the snippet mentions an actual buyer company,
extract it in "extractedCompany" field.

Return JSON: {"results":[
  {"index":1, "classification":"BUYER", "reason":"..."},
  {"index":3, "classification":"AGGREGATOR", "extractedCompany":"US Dept of Defense", "reason":"RFP listing site"}
]}`;

  const userPrompt = `Product: ${profile.productSummary}
Seller signals: ${(profile.sellerSignals || []).join(', ')}
Buyer signals: ${(profile.buyerSignals || []).join(', ')}

Companies:
${list}`;

  try {
    const raw     = await callOpenAI(systemPrompt, userPrompt, 900);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    const buyers  = [];
    for (const r of (parsed.results || [])) {
      const lead = leads[r.index - 1];
      if (!lead) continue;
      if (r.classification === 'BUYER') {
        buyers.push({ ...lead, relevanceScore: Math.min(95, lead.relevanceScore + 10) });
      } else {
        logger.debug('Filtered seller', { name: lead.companyName, reason: r.reason });
      }
    }
    logger.info('Batch scored', { total: leads.length, buyers: buyers.length });
    return buyers;
  } catch (err) {
    logger.warn('Scoring failed — keeping all leads', { err: err.message });
    return leads;
  }
}

async function scoreAllLeads(leads, profile) {
  const BATCH = 10;
  const out   = [];
  for (let i = 0; i < leads.length; i += BATCH) {
    const result = await scoreBatch(leads.slice(i, i + BATCH), profile);
    out.push(...result);
    if (i + BATCH < leads.length) await sleep(300);
  }
  return out;
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scan runner
// ─────────────────────────────────────────────────────────────────────────────

async function runProductDiscoveryScan(job, productInput, filters = {}, progressCallback, maxLeads = 50) {
  logger.info('Product scan START', { jobId: job.id, maxLeads });
  if (progressCallback) await progressCallback(3, 0);

  // Fetch ~2.5× the requested leads as raw buffer to absorb AI scoring filter-outs (~30-40% filtered)
  const rawTarget = Math.ceil(maxLeads * 2.5);

  // STEP 1: ONE AI call
  let profile;
  try {
    profile = await buildProductProfile(productInput);
  } catch (err) {
    logger.error('Profile build failed', { err: err.message });
    throw err;
  }

  logger.info('Search strategy decided', {
    strategy:   profile.searchStrategy,
    isPhysical: profile.isPhysicalProduct,
    buyerType:  profile.buyerType,
  });

  if (progressCallback) await progressCallback(10, 0);

  // Dedup
  const rawLeads      = [];
  const seenNames     = new Set();
  const seenDomains   = new Set();
  const companyCounts = new Map();   // normalized company name → leads kept this scan
  const MAX_PER_COMPANY = 3;         // one employer can't crowd out everyone else

  function tryAdd(lead) {
    if (!lead?.companyName) return false;
    // Reject leads whose "company" is itself a job board / aggregator (e.g. a
    // re-posted listing reported by Google Jobs as "Shine.com"). These are never
    // real employers. Deterministic guard — the LLM scorer misses unfamiliar brands.
    if (isAggregatorName(lead.companyName)) {
      logger.debug('Filtered aggregator-as-company', { name: lead.companyName });
      return false;
    }
    // Reject the platform VENDOR itself (e.g. "Salesforce, Inc." for a Salesforce
    // service) — the maker never buys its own ecosystem service.
    if (isVendorCompany(lead.companyName, profile)) {
      logger.debug('Filtered platform vendor', { name: lead.companyName });
      return false;
    }
    // Drop a bogus aggregator domain but keep the lead (the company may be valid,
    // just with a portal URL instead of its own site).
    if (lead.website && isAggregator(lead.website)) lead.website = '';
    const nk = normName(lead.companyName);
    if (!nk) return false;
    const dk = lead.website ? normDomain(lead.website) : '';
    // Title-aware dedup: one company may yield multiple leads for DIFFERENT roles
    // in a single scan, but the same role re-listed across portals collapses to one.
    const title = lead.jobPostings?.[0]?.title || '';
    const key   = title ? `${nk}|${normJobTitle(title)}` : nk;
    if (seenNames.has(key)) return false;
    // Domain dedup applies ONLY to title-less leads (Apollo / forum). For job leads,
    // two distinct roles at one company share a domain — keying on company+title is
    // what distinguishes them, so we must not collapse them on domain here.
    if (!title && dk && seenDomains.has(dk)) return false;
    // Per-company cap: a dominant employer (e.g. the vendor's own large hiring
    // footprint) must not consume the whole buffer and starve other companies/sources.
    if ((companyCounts.get(nk) || 0) >= MAX_PER_COMPANY) return false;
    if (isCompetitor(lead, profile)) {
      logger.debug('Filtered competitor', { name: lead.companyName });
      return false;
    }
    seenNames.add(key);
    if (dk) seenDomains.add(dk);
    companyCounts.set(nk, (companyCounts.get(nk) || 0) + 1);
    rawLeads.push(lead);
    return true;
  }

  function hasEnoughRaw() { return rawLeads.length >= rawTarget; }

  // STEP 2: choose discovery mode — user-named portals override the auto strategy.
  // No sources given → fall back to the automatic engine (Apollo / Google / both).
  const sources  = resolveSources(profile, filters);
  const strategy = sources.length ? 'SOURCED' : (profile.searchStrategy || 'BOTH').toUpperCase();

  if (strategy === 'SOURCED') {
    logger.info('Sourced discovery — searching user-named portals only', {
      sources: sources.map(s => `${s.key}(${s.category})`), jobId: job.id,
    });
    await runSourcedSearch(profile, filters, sources, tryAdd, rawTarget, rawLeads);
    if (progressCallback) await progressCallback(75, rawLeads.length);

  } else if (strategy === 'APOLLO') {
    // Software/digital products — Apollo is best
    logger.info('Running Apollo search (software/digital product)', { jobId: job.id });
    await runApolloSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    if (progressCallback) await progressCallback(75, rawLeads.length);

  } else if (strategy === 'SERP') {
    // Physical/industrial/B2C products — SerpAPI is best
    logger.info('Running SerpAPI search (physical/industrial product)', { jobId: job.id });
    await runSerpSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    if (progressCallback) await progressCallback(75, rawLeads.length);

  } else {
    // BOTH — run Apollo first then SerpAPI
    logger.info('Running BOTH searches', { jobId: job.id });
    await runApolloSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    if (progressCallback) await progressCallback(45, rawLeads.length);
    if (!hasEnoughRaw()) {
      await runSerpSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    }
    if (progressCallback) await progressCallback(75, rawLeads.length);
  }

  logger.info('Search complete', { jobId: job.id, raw: rawLeads.length, strategy });
  if (progressCallback) await progressCallback(82, Math.min(rawLeads.length, maxLeads));

  // STEP 3: AI batch scoring — removes sellers, keeps only buyers
  logger.info('AI scoring START', { jobId: job.id, toScore: rawLeads.length });
  const scoredLeads = await scoreAllLeads(rawLeads, profile);
  logger.info('AI scoring DONE', {
    jobId:    job.id,
    raw:      rawLeads.length,
    buyers:   scoredLeads.length,
    filtered: rawLeads.length - scoredLeads.length,
  });

  // Trim to exactly what the user requested — no more leads than maxLeads
  const finalLeads = scoredLeads.slice(0, maxLeads);

  if (progressCallback) await progressCallback(100, finalLeads.length);

  logger.info('Product scan DONE', {
    jobId:    job.id,
    strategy,
    total:    finalLeads.length,
  });

  return { leads: finalLeads, profile };
}

// ─────────────────────────────────────────────────────────────────────────────
// generateProductPrompt — called before scan, user reviews/edits the prompt
// ─────────────────────────────────────────────────────────────────────────────

async function generateProductPrompt(productInput, filters = {}) {
  let urlText = '';
  if (productInput.url) {
    urlText = (await fetchProductPageText(productInput.url)) || '';
  }

  const parts = [
    productInput.url         ? `Product URL: ${productInput.url}`                          : '',
    urlText                  ? `Page content:\n${urlText.slice(0, 1500)}`                  : '',
    productInput.description ? `Description:\n${productInput.description.slice(0, 16000)}`  : '',
    productInput.docText     ? `Document:\n${productInput.docText.slice(0, 1500)}`         : '',
    productInput.content && !productInput.description && !productInput.docText
      ? `Info:\n${productInput.content.slice(0, 1000)}` : '',
  ].filter(Boolean);

  const combined = parts.join('\n\n');
  if (!combined.trim()) throw new Error('No product information provided');

  const context = [
    filters.targetIndustry ? `Target industry: ${filters.targetIndustry}` : '',
    filters.targetRegion   ? `Target region: ${filters.targetRegion}`     : '',
  ].filter(Boolean).join(', ');

  const systemPrompt = `You are a B2B/B2C lead generation expert.

Analyze this product (can be ANYTHING — software, generator, toy, machine, food, service) and generate a detailed discovery prompt the user will review and edit before scanning.

IMPORTANT: First decide if this is a physical/industrial product or a digital/software product.
- Physical products (generators, machines, equipment, parts, tools) → search engine is Google Jobs + Google Search
- Digital products (software, SaaS, apps, IT services) → search engine is Apollo database

The prompt must show:
1. What the product is
2. Whether it is physical or digital
3. Which search engines will be used and why
4. Who the buyers are (industries, company types, job titles)
5. What search queries will be used
6. How competitors will be filtered out
7. What volume of leads to expect

Be specific and honest. For a diesel generator, say "We will use Google Jobs to find companies hiring Facilities Managers and Plant Engineers — not Apollo, which is a software company database."

Return ONLY valid JSON:
{
  "promptText": "detailed prompt with sections, line breaks using \\n",
  "productName": "short name",
  "buyerType": "B2B or B2C or BOTH",
  "isPhysicalProduct": true or false,
  "searchStrategy": "APOLLO or SERP or BOTH",
  "summary": "one sentence: what will be searched and what to expect",
  "suggestedEdits": ["thing user might want to customize 1", "suggestion 2"]
}`;

  const raw     = await callOpenAI(systemPrompt, `Product:\n\n${combined}${context ? '\n\nFilters: ' + context : ''}`, 1800);
  const cleaned = raw.replace(/```json|```/g, '').trim();
  return JSON.parse(cleaned);
}

module.exports = { runProductDiscoveryScan, buildProductProfile, generateProductPrompt, normJobTitle };
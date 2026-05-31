/**
 * productDiscoveryService.js â€” SMART ROUTING BY PRODUCT TYPE
 *
 * PROBLEM SOLVED:
 *   Apollo is a tech/software company database.
 *   Searching Apollo for "diesel generator" returns software companies
 *   that happen to serve the energy sector â€” NOT actual industrial buyers.
 *
 * SOLUTION â€” AI decides the right search engine per product:
 *
 *   DIGITAL / SOFTWARE products (CRM, SaaS, app, platform, IT service):
 *     â†’ Apollo people search by buyer job titles (works great for tech buyers)
 *     â†’ Apollo company search by keywords
 *
 *   PHYSICAL / INDUSTRIAL products (generator, machine, equipment, parts, tools):
 *     â†’ SerpAPI Google organic â€” buyer intent, company pages, procurement signals
 *     â†’ SerpAPI Google tenders/RFPs â€” companies actively sourcing
 *     â†’ SerpAPI Google News â€” companies expanding/building = they need equipment
 *     Apollo is SKIPPED for physical products
 *
 *   B2C products (toys, food, clothing, consumer goods):
 *     â†’ SerpAPI Google â€” find retailers, distributors, wholesalers
 *
 * ONE AI call decides: isPhysicalProduct, buyerType, and generates
 * all search queries / job titles dynamically. Zero static lists.
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { callOpenAI } = require('./aiService');
const { lookupOfferBucket, getDefaultBucket } = require('./industryGraph');
const { buildRoutingPlan, urlIsOnAvoidDomain } = require('./sourceRouter');
const { getSerpProvider } = require('./serpProviders');
const { deepScrapeTopCandidates } = require('./scrapers/scrapeOrchestrator');
const { getCachedResults, setCachedResults } = require('./serpCache');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const TEST_MODE      = process.env.TEST_MODE === 'true';
const TEST_MAX_LEADS = 10;
const TEST_MAX_PAGES = 1;

function normName(n = '') {
  return n.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
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
];
function isAggregator(url = '') {
  const d = normDomain(url);
  return AGGREGATOR_DOMAINS.some(jb => d.includes(jb));
}

// News / publisher domains — when a SERP result is on one of these, the URL points
// to the article publisher, NOT to a buyer company. The real subject (e.g., "AWS"
// in a story about AWS's UAE data center) has to be extracted from title+snippet
// by the AI in scoreBatch (extractedCompany field). Until then we tag the lead
// with _isNewsArticle so downstream code knows not to trust its companyName/website.
const NEWS_DOMAINS = [
  // Global business / tech press
  'reuters.com', 'bloomberg.com', 'wsj.com', 'ft.com', 'forbes.com', 'fortune.com',
  'businessinsider.com', 'cnbc.com', 'cnn.com', 'bbc.com', 'bbc.co.uk',
  'theguardian.com', 'nytimes.com', 'washingtonpost.com', 'economist.com',
  'apnews.com', 'afp.com', 'aljazeera.com',
  // Industry / sector press
  'techcrunch.com', 'theverge.com', 'wired.com', 'arstechnica.com', 'engadget.com',
  'venturebeat.com', 'theinformation.com', 'datacenterdynamics.com', 'datacenterknowledge.com',
  'constructiondive.com', 'enr.com', 'oilprice.com', 'rigzone.com', 'powermag.com',
  'utilitydive.com', 'energy-storage.news', 'pv-magazine.com', 'renewableenergyworld.com',
  // Regional press
  'cioafrica.co', 'gulfnews.com', 'khaleejtimes.com', 'thenationalnews.com',
  'arabianbusiness.com', 'zawya.com', 'arabnews.com', 'menabytes.com',
  'livemint.com', 'business-standard.com', 'economictimes.indiatimes.com',
  'moneycontrol.com', 'thehindubusinessline.com',
  // Aggregators that look like news
  'yahoo.com', 'msn.com', 'medium.com', 'substack.com',
  // Phase 1.7: analyst / research / consulting publishers — they discuss many
  // companies in industry-wide reports. The companies named in these reports are
  // NOT necessarily active buyers; the AI tends to over-extract them. Treat as
  // aggregator so scoreBatch requires real evidence (specific event in snippet),
  // not category-based inference.
  'spglobal.com', 'mckinsey.com', 'bcg.com', 'bain.com', 'deloitte.com',
  'pwc.com', 'kpmg.com', 'ey.com', 'accenture.com', 'capgemini.com',
  'gartner.com', 'forrester.com', 'idc.com', 'statista.com',
  'mordorintelligence.com', 'grandviewresearch.com', 'marketresearchfuture.com',
  'globaldata.com', 'researchandmarkets.com', 'fortunebusinessinsights.com',
  'gminsights.com', 'gmiresearch.com', 'datainsightsmarket.com',
  'expertmarketresearch.com', 'imarcgroup.com', 'futuremarketinsights.com',
  'transparencymarketresearch.com', 'alliedmarketresearch.com',
];
function isNewsDomain(url = '') {
  const d = normDomain(url);
  if (NEWS_DOMAINS.some(n => d.includes(n))) return true;
  // Heuristic: many regional/industry press sites aren't on the list. URL path
  // segments like /news/, /article/, /press-release/, /blog/, /story/, /post/
  // strongly signal article content rather than a buyer/company page.
  // Phase 1.7: added /research-insights/, /special-reports/, /reports/,
  // /whitepaper/, /perspectives/, /analysis/, /market-research/ — analyst-style
  // content where the AI tends to infer rather than find evidence.
  if (/\/(news|article|articles|press|press-release|blog|story|stories|post|posts|insight|insights|research-insights|case-stud(y|ies)|special-reports?|reports?|whitepapers?|white-papers?|perspectives?|analysis|market-research|publications?|thought-leadership)\//i.test(url)) {
    return true;
  }
  return false;
}

// Placeholders the AI sometimes hallucinates as `extractedCompany`. These are not
// real company names — when the AI returns one of these, we throw the lead away
// rather than rewriting it (otherwise the post-save Clearbit-style fuzzy lookup
// will map "Unknown" → unknownworlds.com or similar garbage).
const PLACEHOLDER_COMPANY_NAMES = new Set([
  'unknown', 'unknown company', 'unknown buyer', 'unspecified', 'undisclosed',
  'n/a', 'na', 'none', 'not specified', 'not available', 'not mentioned',
  'multiple', 'multiple companies', 'various', 'various companies', 'several',
  'several companies', 'company', 'companies', 'tbd', 'tba', 'anonymous',
  'the company', 'the buyer', 'the client', 'client', 'buyer', 'organization',
  'business', 'enterprise',
]);

// Substrings that, if present at the START of a name, mean the AI gave up and
// returned a placeholder description rather than a real company name.
// e.g., "Unnamed Buyer in Hanover, Virginia", "Unknown company in UAE",
// "Anonymous client" — all should be dropped, not saved.
const PLACEHOLDER_PREFIXES = [
  'unnamed ', 'unknown ', 'unspecified ', 'undisclosed ', 'anonymous ',
  'a buyer ', 'a company ', 'the buyer ', 'the company ', 'the client ',
  'some buyer', 'some company',
];

function isPlaceholderName(name = '') {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return true;
  if (PLACEHOLDER_COMPANY_NAMES.has(trimmed)) return true;
  if (PLACEHOLDER_PREFIXES.some(p => trimmed.startsWith(p))) return true;
  // Require at least one letter and minimum 3 chars of real content
  if (!/[a-z]/i.test(trimmed)) return true;
  if (trimmed.replace(/[^a-z0-9]/gi, '').length < 3) return true;
  return false;
}

// Detects when the AI's own reason text reveals that the "extracted" company is
// actually a seller/manufacturer/provider, not a buyer. The AI sometimes lifts
// the page subject without considering whether it's the buyer or the vendor.
const SELLER_REASON_PATTERNS = [
  /\bseller\b/i, /\bmanufactur(er|ing)\b/i, /\bsupplier\b/i, /\bvendor\b/i,
  /\bprovides?\b.*\b(service|rental|generator|equipment)/i,
  /\boffer(s|ing)?\b.*\b(rental|service|generator|equipment)/i,
  /\brent(s|al)?\b.*\b(out|service|company)/i,
  /\bsells?\b/i, /\bmakes?\b.*\bgenerator/i,
];

function extractedLooksLikeSeller(reason = '') {
  if (!reason) return false;
  return SELLER_REASON_PATTERNS.some(rx => rx.test(reason));
}

// Phase 1: detect "weak signal" extractions where the AI's reason indicates the
// entity is only an investor/stakeholder/casual mention — not an actual operational
// buyer of the offer. Qatar Investment Authority "invested in Anthropic" is NOT a
// buyer of cloud migration services; a city government "mentioned in an article
// about construction" is too thin to act on. These extractions inflate the funnel
// with noise. We reject them at the score stage.
const WEAK_SIGNAL_PATTERNS = [
  // External investor / shareholder signals
  /\binvests?\s+in\b/i,
  /\binvested\s+in\b/i,
  /\binvesting\s+in\b/i,
  /\binvestor\s+in\b/i,
  /\bstakeholder\b/i,
  /\bshareholder\b/i,
  /\bacquired\s+stake\b/i,
  /\bsovereign\s+wealth\b/i,
  /\bventure\s+capital\b/i,
  /\bequity\s+(stake|investment)\b/i,
  // Casual / non-actionable mentions
  /^\s*mentioned\b/i,
  /\bonly\s+mentioned\b/i,
  /\bbriefly\s+mentioned\b/i,
  /\bnamed\s+in\s+passing\b/i,
  // Generic / non-specific reasons
  /\bgeneric\s+(news|article|content)\b/i,
  // Phase 1.7: inferential reasoning — the AI is guessing from category/scale
  // ("major bank, so they probably need cloud") rather than citing real evidence.
  // These are not actual buyer signals.
  /\bno\s+direct\s+signal\b/i,
  /\bno\s+explicit\s+(intent|signal)\b/i,
  /\bno\s+current\s+(intent|signal|posting|announcement)\b/i,
  /\blikely\s+(operating|using|needs?|need|require|requires|to\s+need|to\s+require)\b/i,
  /\bcould\s+(benefit|need|use|require)\b/i,
  /\bmay\s+(benefit|need|require|use)\b/i,
  /\bmight\s+(benefit|need|require|use)\b/i,
  /\bwould\s+(benefit|need|require|use)\b/i,
  /\bpotential(ly)?\s+(buyer|need|require|user|customer|client)\b/i,
  /\bindustry\s+(and\s+scale\s+)?suggests?\b/i,
  /\bscale\s+suggests?\b/i,
  /\bgiven\s+(their|its|the)\s+(industry|size|scale|sector)\b/i,
  /\bas\s+a\s+(major|large|big)\s+(bank|institution|company|enterprise|player)\b.*\b(likely|may|might|could|would|suggests?)/i,
  /\bplausible\s+buyer\b/i,
  /\bassumed\s+to\b/i,
  /\binferred\s+(from|based)\b/i,
];

function extractionIsWeakSignal(reason = '') {
  if (!reason) return false;
  return WEAK_SIGNAL_PATTERNS.some(rx => rx.test(reason));
}

// Detects when a "company name" is actually a page title / article headline / sentence
// fragment rather than a real org. Real company names are typically 1–4 capitalized
// words with no verbs, years, or sentence structure. Anything else is a headline.
function looksLikePageTitle(name = '') {
  const n = name.trim();
  if (!n) return false;

  // 1. Truncation marker — SerpAPI cuts long titles with ellipsis
  if (n.endsWith('...') || n.endsWith('…')) return true;

  // 2. Possessive — "Hilton's first ...", "Apple's new ..."
  if (/['']s\s/.test(n)) return true;

  // 3. Listicle starters — "New X in ...", "Top 10 ...", "5 Best ..."
  if (/^(new|top|best|the\s+best|\d+\s+(best|top|reasons|tips|ways|things))\s+/i.test(n)) return true;

  // 4. Case-study / partnership headline verbs (anywhere in the string)
  if (/\b(relies on|powered by|partners with|chooses|selects|signs (deal|contract|mou) with|teams up with|joins forces with)\b/i.test(n)) return true;

  // 5. Document / report keywords — "X Annual Report", "Q3 Report", "Press Release"
  if (/\b(annual report|quarterly report|press release|whitepaper|case study|earnings call|investor day|conference|summit|forum|webinar|podcast|newsletter|briefing|fact sheet|datasheet)\b/i.test(n)) return true;

  // 6. Year tokens or quarters — real company names don't contain "2024", "Q3", etc.
  if (/\b(19|20)\d{2}\b/.test(n)) return true;
  if (/\bQ[1-4]\b/i.test(n)) return true;

  // 7. Mid-sentence action verbs — "X to increase Y", "X to launch Y", "X opens Y",
  //    "X enters Y". These are clear headline structures, not company names.
  //    "to <verb>" anywhere in the string is a strong signal.
  if (/\bto\s+(increase|decrease|expand|grow|launch|open|build|construct|establish|enter|invest|acquire|merge|partner|develop|deploy|introduce|unveil|announce|sign|raise|win|secure|hire|cut|reduce|double|triple)\b/i.test(n)) return true;

  // 8. Headline action verbs in present/past tense (without "to") — capture
  //    "Oracle launches X", "Marriott opens Y", "Tesla acquires Z"
  if (/\b(launches?|opens?|announces?|unveils?|introduces?|builds?|constructs?|completes?|signs?|wins?|secures?|acquires?|merges?|raises?|expands?|enters?|invests?|partners?|deploys?|releases?|reports?)\s+/i.test(n)) return true;

  // 9. Colon-style headlines — "TITLE: subtitle", "BRAND: news"
  if (/:\s+[A-Z]/.test(n)) return true;

  // 10. Em-dash / en-dash subtitle separators (when not part of a short brand mark)
  //     e.g. "Ras Al Khaimah – New Desert", "Brand — Tagline"
  if (/\s[–—]\s/.test(n) && n.split(/\s+/).length >= 4) return true;

  // 11. Length cap — real company names are 1-5 words (e.g. "Bharat Heavy Electricals
  //     Limited" is 4; "Hong Kong Exchanges and Clearing" is 5). Anything >5 words is
  //     almost certainly a sentence.
  if (n.split(/\s+/).length > 5) return true;

  // Note: we intentionally do NOT flag lowercase function words ("of", "and", "the")
  //       mid-string — many real company names contain them ("Bank of America",
  //       "State Bank of India", "Hong Kong Exchanges and Clearing").

  return false;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Fetch product page (URL input)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

function buildFilterContext(filters = {}) {
  return [
    filters.targetIndustry ? `Target industry: ${filters.targetIndustry}` : '',
    filters.targetRegion ? `Target region: ${filters.targetRegion}` : '',
    filters.companySize ? `Company size: ${filters.companySize}` : '',
    filters.companyType ? `Company type: ${filters.companyType}` : '',
    filters.annualRevenue ? `Annual revenue: ${filters.annualRevenue}` : '',
    filters.decisionMakers?.length ? `Buyer roles: ${filters.decisionMakers.join(', ')}` : '',
    filters.seniorityLevel ? `Buyer seniority: ${filters.seniorityLevel}` : '',
    filters.preferredContactChannel ? `Preferred contact channel: ${filters.preferredContactChannel}` : '',
  ].filter(Boolean).join('\n');
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];

  for (const value of values) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }

  return out;
}

function buildDefaultCompanyQueries(profile = {}) {
  // Generic buyer-EVENT fallback queries. We intentionally do NOT include the offer
  // keyword here — that's the whole point of the buyer-intent inversion. These
  // queries target the kinds of events that create demand for almost any B2B offer:
  // new facilities, expansions, project announcements, openings. The runtime
  // appends the geography filter afterwards.
  // Phase 1: removed hardcoded year tokens — SerpAPI freshness filter (tbs=qdr:m3)
  // now constrains recency, so year tokens just bias toward stale results.
  return [
    '"new facility" OR "new plant" OR "new factory" announcement',
    '"expansion project" OR "facility expansion" announcement',
    '"breaks ground" OR "groundbreaking" OR "construction begins"',
    '"new data center" OR "new data centre" announcement',
    '"hotel opening" OR "resort inaugurated"',
    '"infrastructure project" award announcement',
    '"capacity expansion" manufacturing',
    '"opens new" facility OR plant OR office',
  ];
}

function normalizeDiscoveryProfile(profile = {}) {
  const strategy = (profile.searchStrategy || 'BOTH').toUpperCase();
  const serpProfile = { ...(profile.serpProfile || {}) };
  const preferCompanyFirst = profile.isPhysicalProduct || profile.isRentalOrService || strategy === 'SERP';

  serpProfile.buyerIntentQueries = uniqueStrings(serpProfile.buyerIntentQueries);
  serpProfile.rfpQueries = uniqueStrings(serpProfile.rfpQueries);
  serpProfile.retailerQueries = uniqueStrings(serpProfile.retailerQueries);
  serpProfile.caseStudyQueries = uniqueStrings(serpProfile.caseStudyQueries);

  if (preferCompanyFirst) {
    serpProfile.useJobSignals = false;
    serpProfile.jobTitleSearches = [];

    if (!serpProfile.buyerIntentQueries.length) {
      serpProfile.buyerIntentQueries = buildDefaultCompanyQueries(profile);
    }
  } else {
    serpProfile.useJobSignals = Boolean(serpProfile.useJobSignals);
    serpProfile.jobTitleSearches = serpProfile.useJobSignals
      ? uniqueStrings(serpProfile.jobTitleSearches)
      : [];
  }

  return {
    ...profile,
    searchStrategy: strategy,
    serpProfile,
  };
}

function shouldUseJobSignals(profile = {}) {
  return Boolean(
    profile?.serpProfile?.useJobSignals &&
    Array.isArray(profile?.serpProfile?.jobTitleSearches) &&
    profile.serpProfile.jobTitleSearches.length
  );
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 1 â€” ONE AI call: understand product, pick search strategy
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const PROFILE_SYSTEM_PROMPT = `You are a B2B/B2C lead generation expert.

Analyze this offer - it could be a product, service, rental, software, equipment, or hybrid solution.
Your job is to figure out:
1. What TYPE of offer it is (digital/software/service vs physical/industrial/rental vs consumer)
2. WHO needs to buy it (real buyer companies, not job postings, not service providers)
3. HOW to find those buyer companies through Google Search signals

CORE PRINCIPLE: We discover BUYER COMPANIES first via Google Search (procurement, tenders,
projects, expansions, operator pages). Apollo is used ONLY afterwards to enrich those
already-discovered companies with decision-maker contacts. Apollo is NEVER the primary
discovery source for services, rentals, or physical products.

Return ONLY valid JSON, no markdown:
{
  "productName": "short offer name",
  "productSummary": "one sentence describing what it is and why companies buy it",
  "isRentalOrService": true or false,
  "isPhysicalProduct": true or false,
  "buyerType": "B2B" or "B2C" or "BOTH",
  "buyerDescription": "one sentence: who buys this and why",
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
      "keyword describing what buyer companies do - not what the product is",
      "keyword 2",
      "keyword 3"
    ],
    "personSeniority": ["manager", "director", "vp", "c_suite", "owner"]
  },
  "serpProfile": {
    "useJobSignals": true or false,
    "jobTitleSearches": [
      "optional Google Jobs title for a secondary hiring-signal search",
      "title 2",
      "title 3",
      "title 4"
    ],
    "buyerIntentQueries": [
      "BUYER-EVENT query 1 — does NOT contain the offer keyword; targets a project, expansion, opening, breakdown, or operator-facing event that creates demand for this offer",
      "query 2",
      "query 3",
      "query 4",
      "query 5",
      "query 6",
      "query 7",
      "query 8"
    ],
    "rfpQueries": [
      "site: tender-database query 1, e.g., 'site:tendersinfo.com <demand-noun> <region>'",
      "site: tender-database query 2",
      "site: tender-database query 3"
    ],
    "caseStudyQueries": [
      "Inversion query — searches a competitor's own case-study/customer pages to learn who their BUYERS are. Format: '\"<competitor name>\" case study OR customer story <region>'",
      "query 2",
      "query 3"
    ],
    "retailerQueries": [
      "Google query to find retailers or distributors (only for B2C products)",
      "query 2"
    ]
  },
  "sellerSignals": [
    "phrase in a company description meaning they sell or make this same offer",
    "phrase 2",
    "phrase 3"
  ],
  "buyerSignals": [
    "phrase confirming a company needs or uses this offer",
    "phrase 2"
  ]
}

CRITICAL RULES:

searchStrategy:
  - "SERP"   = DEFAULT for: physical products (generators, machines, equipment, parts, tools, vehicles, hardware, construction materials), field services, rental equipment, ALL services (consulting, agencies, IT services, professional services), food, clothing, toys, consumer goods, industrial supplies. Apollo will run AFTERWARDS as a contact-enrichment layer on the companies SERP discovers.
  - "APOLLO" = use ONLY for pure digital/software products (SaaS platforms, CRM, ERP, HR software, marketing platforms, cloud services, cybersecurity software) where the buying company is itself a tech company easy to find in Apollo's database by job-title search. Even here, prefer SERP if there are strong project/expansion/procurement signals.
  - "BOTH"   = avoid; pick SERP unless this is unambiguously a pure-software product

  WHY: Apollo's database is mostly tech/software companies. Searching Apollo as primary for "diesel generator" or "generator rental" returns software companies and irrelevant managers. For real buyer discovery, Google Search procurement/tender/project/expansion signals find the actual buying companies. Apollo then enriches those companies with decision-maker contacts.

isPhysicalProduct:
  - true  = generator, machine, equipment, tool, vehicle, food, clothing, hardware, construction material, industrial supply, medical device, rental equipment
  - false = software, SaaS, app, platform, digital service, IT consulting, staffing, agency service, cloud

apolloProfile: ALWAYS fill — even for SERP strategy. Apollo runs as a contact-enrichment
layer on every SERP-discovered company, so we always need buyer titles.
  - buyerTitles: realistic decision-maker job titles at BUYER companies who would purchase
    this offer (procurement leads, facilities managers, operations heads, etc. — NOT job titles
    that describe the offer itself, e.g., for "generator rental" don't put "Generator Operator").
    Provide 6 titles; pick generic, real-world buyer-side titles that exist on LinkedIn.
  - buyerKeywords: what buyer companies DO (not what you sell)
  - personSeniority: at least ["manager","director","vp","c_suite","owner"] unless very specific reason to narrow

serpProfile: fill ONLY if searchStrategy is SERP or BOTH
  - useJobSignals: almost always false for physical products, rentals, field services, and company-first discovery
  - jobTitleSearches: leave empty unless the user explicitly wants hiring signals as a secondary backup source

  - buyerIntentQueries — THE MOST IMPORTANT FIELD. This is where bad queries silently
    return SELLERS instead of buyers. Read these rules carefully.

    GOLDEN RULE: A buyer-intent query should NEVER contain the offer's own product/service
    keyword (e.g., "generator rental", "CNC machine", "DevOps consulting"). When you
    Google "generator rental construction UAE", Google shows you generator rental COMPANIES
    that SEO-optimized for those keywords — i.e., the SELLERS, the people you do NOT want.

    INSTEAD, generate queries that target BUYER-SIDE EVENTS — situations that CREATE
    demand for the offer without naming the offer itself:

      * Project announcements: "new data center" OR "data centre expansion" UAE
      * Facility openings:     "hotel opening" OR "resort inaugurated" UAE
      * Construction kickoffs: "breaks ground" OR "topping out" UAE
      * Capacity expansion:    "factory expansion" OR "new plant" UAE
      * Infrastructure events: "power outage" OR "blackout" UAE site:gulfnews.com
      * Sector rosters:        "data center operators in UAE" -rental -hire
      * Operator news:         "Etisalat" OR "STC" data centre expansion
      * Funding/buildout:      "raised funding" "data center" UAE site:zawya.com

    DO NOT include hardcoded year tokens like "2024" or "2025" — the runtime
    applies a 3-month freshness filter to SerpAPI (tbs=qdr:m3), so year tokens
    only bias the query toward stale articles when the year passes. Just describe
    the EVENT TYPE; let the date filter handle recency.

    DO NOT include the geography in the query body — the runtime appends the
    target region ONCE at the end of every query. If you ALSO embed "USA" or
    "UAE" in the query, Google sees the region twice ("USA ... USA, India") and
    your query becomes confused. Just describe the event type.

    DO NOT use the literal keyword "AND" — Google treats it as a stop word and
    pollutes relevance. Combine clauses with just spaces (Google's implicit AND)
    or with "OR" for synonyms.

      ❌ BAD:  "facility expansion" AND "new plant" USA
      ✅ GOOD: "facility expansion" OR "new plant"

    Add the geography to each query (already filled in by the runtime, but include it
    when it changes the result quality). Use Google operators where they help:
      - quoted phrases for exact match
      - OR between synonyms
      - -keyword to exclude (e.g., -rental -hire -supplier)
      - site:<news-or-tender-domain> when you know a high-signal source

    Worked examples:
      ❌ BAD  for "generator rental":  "generator rental" construction UAE
      ❌ BAD  for "generator rental":  "data center expansion" UAE 2024 -rental  (year token — drop it)
      ✅ GOOD for "generator rental":  "data center expansion" UAE -rental
      ✅ GOOD for "generator rental":  "groundbreaking" OR "construction begins" UAE site:gulfnews.com
      ✅ GOOD for "generator rental":  "hotel opening" OR "resort launches" UAE -rental -hire

      ❌ BAD  for "CNC machine":  "CNC machine" plant expansion
      ✅ GOOD for "CNC machine":  "new manufacturing facility" India -supplier -dealer
      ✅ GOOD for "CNC machine":  "production line expansion" automotive India

      ❌ BAD  for "DevOps consulting":  "DevOps consulting" company scaling
      ✅ GOOD for "DevOps consulting":  "Series B" OR "Series C" SaaS announcement site:techcrunch.com
      ✅ GOOD for "DevOps consulting":  "migrating to cloud" OR "infrastructure modernization" engineering blog

    Generate 8 queries. Diversify across event types — don't just give 8 variations of one pattern.

  - rfpQueries — tender/procurement aggregator searches. Use site: operators:
      site:tendersinfo.com <demand-noun> <region>
      site:bidnetdirect.com <demand-noun> <region>
      site:globaltenders.com <demand-noun> <region>
      site:tenderdirect.com.my OR site:gem.gov.in OR site:procurement.gov.<cc>
    The product keyword IS allowed here because tender sites need it.

  - caseStudyQueries — sellers publish case studies that name their buyers. We search
    competitors' own sites for those case studies and back-extract the buyer.
    Format: "<competitor name>" case study OR customer story <region>
    Examples for generator rental:
      "Aggreko" case study UAE
      "Caterpillar Rental" customer story Middle East
      "Cummins Power Rent" testimonial Gulf
    Generate 3 — pick the 3 largest sellers in this offer's category and region.

  - retailerQueries: ONLY for B2C products — finding retailers/distributors

sellerSignals: phrases that identify competitor companies to exclude from results`;

// Phase 2.2: industry graph integration.
//
// Approach (combined): look up the bucket BEFORE calling the AI, pass the
// bucket's hints into the prompt as anchoring context, then AFTER the AI
// returns, merge bucket fields into the profile to fill any gaps. This:
//   - improves AI query generation (anchored to proven patterns)
//   - guarantees buyerTitles / industries / signals are present even if the
//     AI omits them, so downstream code (Apollo enrichment, source router)
//     always has good defaults

// Build a short text block describing the graph bucket — embedded into the
// AI user prompt before the offer description. Keeps total prompt size small.
function formatBucketHintForPrompt(bucket) {
  if (!bucket) return '';
  const lines = [
    `Likely offer category: ${bucket.label || bucket.key}`,
    bucket.industries?.length     ? `Target industries: ${bucket.industries.slice(0, 8).join(', ')}` : null,
    bucket.buyerTitleSeeds?.length ? `Typical buyer titles: ${bucket.buyerTitleSeeds.slice(0, 6).join(', ')}` : null,
    bucket.demandSignals?.length   ? `Demand signals that create buyer intent: ${bucket.demandSignals.slice(0, 8).join(', ')}` : null,
    bucket.queryPatterns?.length   ? `High-yield query patterns for this category:\n  - ${bucket.queryPatterns.slice(0, 6).join('\n  - ')}` : null,
    bucket.preferredSources?.length ? `High-signal news/press sources: ${bucket.preferredSources.slice(0, 6).join(', ')}` : null,
    bucket.avoidSources?.length     ? `Avoid sources (irrelevant for this category): ${bucket.avoidSources.slice(0, 4).join(', ')}` : null,
    bucket.typicalCompanySize       ? `Typical buyer company size: ${bucket.typicalCompanySize} employees` : null,
  ].filter(Boolean);
  return '\n\nINDUSTRY GRAPH CONTEXT (use these as anchors for your buyer queries and decision-maker titles — do not contradict them unless the offer description clearly disagrees):\n' + lines.join('\n');
}

// Merge bucket data INTO the AI-generated profile. The merge is gap-fill only —
// we never overwrite a value the AI provided. This way the AI stays authoritative
// on offer-specific phrasing, but the graph guarantees minimum coverage.
function mergeBucketIntoProfile(profile, bucket) {
  if (!bucket || !profile) return profile;

  // Top-level booleans only fill if AI didn't decide
  if (profile.isPhysicalProduct == null && bucket.isPhysicalProduct != null) {
    profile.isPhysicalProduct = bucket.isPhysicalProduct;
  }
  if (profile.isRentalOrService == null && bucket.isRentalOrService != null) {
    profile.isRentalOrService = bucket.isRentalOrService;
  }
  if (!profile.buyerType && bucket.buyerType) {
    profile.buyerType = bucket.buyerType;
  }

  // Apollo profile — fill buyer titles if AI gave fewer than 3
  profile.apolloProfile = profile.apolloProfile || {};
  const titles = Array.isArray(profile.apolloProfile.buyerTitles)
    ? profile.apolloProfile.buyerTitles.filter(Boolean)
    : [];
  if (titles.length < 3 && bucket.buyerTitleSeeds?.length) {
    const merged = [...new Set([...titles, ...bucket.buyerTitleSeeds])].slice(0, 8);
    profile.apolloProfile.buyerTitles = merged;
  }

  // Decorative metadata (used by Strategy Preview card + downstream router)
  if (!Array.isArray(profile.buyerIndustries) || !profile.buyerIndustries.length) {
    profile.buyerIndustries = bucket.industries || [];
  }
  if (!Array.isArray(profile.buyerPersonas) || !profile.buyerPersonas.length) {
    profile.buyerPersonas = bucket.buyerPersonas || [];
  }
  if (!Array.isArray(profile.demandSignals) || !profile.demandSignals.length) {
    profile.demandSignals = bucket.demandSignals || [];
  }

  // Stash the matched bucket key so source router (P2.3) can use it without
  // re-running the lookup
  profile._industryBucket = bucket.key || null;
  profile._industryBucketLabel = bucket.label || null;

  return profile;
}

async function buildProductProfile(productInput, filters = {}) {
  let urlText = '';
  if (productInput.url) {
    urlText = (await fetchProductPageText(productInput.url)) || '';
  }

  const parts = [
    productInput.url         ? `Offer URL: ${productInput.url}`                            : '',
    urlText                  ? `Page content:\n${urlText.slice(0, 1500)}`                  : '',
    productInput.description ? `Offer details:\n${productInput.description.slice(0, 1500)}` : '',
    productInput.docText     ? `Document:\n${productInput.docText.slice(0, 1500)}`         : '',
    productInput.content && !productInput.description && !productInput.docText
      ? `Info:\n${productInput.content.slice(0, 1000)}` : '',
    buildFilterContext(filters),
  ].filter(Boolean);

  const combined = parts.join('\n\n');
  if (!combined.trim()) throw new Error('No product information provided');

  const isServiceOffer = productInput.type === 'service';

  // Phase 2.2: industry graph lookup BEFORE the AI call. Uses raw productInput
  // text so we don't need a profile yet. Result is passed into the AI prompt
  // as anchoring context and merged into the profile after the AI returns.
  const bucket = lookupOfferBucket(
    { productName: productInput.productName, productSummary: productInput.description || productInput.content },
    productInput,
  );

  // If user edited the AI prompt, use that directly
  if (productInput.customPrompt && productInput.customPrompt.trim().length > 20) {
    logger.info('Using user-edited custom prompt');
    return buildProfileFromText(
      `User-approved buyer discovery brief:\n\n${productInput.customPrompt.trim()}`,
      { forceServiceMode: isServiceOffer, bucket }
    );
  }

  return buildProfileFromText(combined, { forceServiceMode: isServiceOffer, bucket });
}

async function buildProfileFromText(combined, { forceServiceMode = false, bucket = null } = {}) {
  const offerHint = forceServiceMode
    ? '\n\nNote: this offer was submitted from the SERVICE tab. Treat it as a service that needs company-first discovery via Google Search (project, expansion, procurement, operator signals). Set searchStrategy to "SERP".'
    : '';

  // Phase 2.2: inject industry-graph hint before the offer text
  const bucketHint = formatBucketHintForPrompt(bucket);

  try {
    const raw     = await callOpenAI(PROFILE_SYSTEM_PROMPT, `Offer:\n\n${combined}${bucketHint}${offerHint}`, 1600);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    let profile = JSON.parse(cleaned);

    if (forceServiceMode) {
      profile.searchStrategy = 'SERP';
      profile.isRentalOrService = true;
    }

    // Phase 2.2: merge bucket fields into profile (gap-fill, never overwrite).
    // Falls back to default bucket only if no match was found AND the AI's
    // profile is missing critical fields.
    if (bucket) {
      profile = mergeBucketIntoProfile(profile, bucket);
    } else if (!profile.apolloProfile?.buyerTitles?.length || !profile.buyerIndustries?.length) {
      const fallback = getDefaultBucket();
      if (fallback) profile = mergeBucketIntoProfile(profile, { key: '_default', ...fallback });
    }

    logger.info('Product profile built', {
      name:             profile.productName,
      isPhysical:       profile.isPhysicalProduct,
      searchStrategy:   profile.searchStrategy,
      buyerType:        profile.buyerType,
      forceServiceMode,
      industryBucket:   profile._industryBucket || null,
      apolloTitles:     profile.apolloProfile?.buyerTitles?.length,
      serpJobTitles:    profile.serpProfile?.jobTitleSearches?.length,
      serpBuyerQueries: profile.serpProfile?.buyerIntentQueries?.length,
    });

    return normalizeDiscoveryProfile(profile);
  } catch (err) {
    logger.error('Product profile AI failed â€” minimal fallback', { err: err.message });
    const words = combined.split(/\s+/).slice(0, 5).join(' ');
    // Phase 2.2: even on AI failure, use the bucket (if any) to give the
    // fallback profile non-trivial buyer titles and demand-signal queries.
    const fb = bucket || getDefaultBucket();
    const fbTitles = fb?.buyerTitleSeeds?.slice(0, 6) || ['Procurement Lead', 'Head of Facilities', 'Operations Lead'];
    const fbQueries = fb?.queryPatterns?.slice(0, 6) || [`"${words}" procurement`, `"${words}" tender`, `companies needing "${words}"`];
    const fallbackProfile = {
      productName:       words,
      productSummary:    combined.slice(0, 150),
      isRentalOrService: forceServiceMode || fb?.isRentalOrService || false,
      isPhysicalProduct: fb?.isPhysicalProduct || false,
      buyerType:         fb?.buyerType || 'B2B',
      searchStrategy:    'SERP',
      buyerDescription:  'Companies that need this offer',
      apolloProfile: {
        buyerTitles:   fbTitles,
        buyerKeywords: [words],
        personSeniority: ['manager', 'director', 'vp', 'c_suite'],
      },
      serpProfile: {
        useJobSignals: false,
        jobTitleSearches:    [],
        buyerIntentQueries:  fbQueries,
        rfpQueries:          [`"${words}" RFP tender`],
        retailerQueries:     [],
      },
      sellerSignals: [],
      buyerSignals:  [],
      buyerIndustries: fb?.industries || [],
      buyerPersonas:   fb?.buyerPersonas || [],
      demandSignals:   fb?.demandSignals || [],
      _industryBucket:      bucket?.key || (fb ? '_default' : null),
      _industryBucketLabel: bucket?.label || fb?.label || null,
    };
    return normalizeDiscoveryProfile(fallbackProfile);
  }
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Competitor filter â€” AI-generated signals only, zero static lists
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function isCompetitor(lead, profile) {
  if (!profile?.sellerSignals?.length) return false;
  const text = [lead.companyName, lead.description, lead.signalText]
    .filter(Boolean).join(' ').toLowerCase();
  return profile.sellerSignals.some(s => text.includes(s.toLowerCase()));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Apollo API â€” used ONLY for digital/software products
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const APOLLO_BASE = 'https://api.apollo.io/api/v1';

async function apolloPeopleSearch(params, page = 1) {
  if (!config.apollo?.apiKey) {
    logger.warn('APOLLO_API_KEY not set â€” skipping');
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
    logger.warn('APOLLO_API_KEY not set â€” skipping');
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
    signalText:        `${org.industry || 'Company'} â€” potential buyer for: ${profile.productSummary?.slice(0, 80)}`,
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Parse a free-text region string into an array of SerpAPI-compatible locations.
// Google Jobs only accepts ONE location per request, so we search each separately.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// SerpAPI â€” used for physical products AND B2C products
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// Phase 1: freshness window. tbs=qdr:m3 limits Google to results from the last 3 months.
// Buyer-intent signals (expansions, project announcements, RFPs) lose value fast — a
// 2024 facility expansion article doesn't help in 2026. Callers can override.
const DEFAULT_SERP_RECENCY = 'qdr:m3';

// Phase 1.8: SerpAPI 429 handling. Rate limits are per-minute / per-second and can
// fire even when monthly credits remain. Strategy:
//   1. Detect 429 → wait (honor Retry-After header if present), retry up to 2 times
//   2. After 3 consecutive scan-wide 429s (across queries), trip the circuit breaker
//      and abort SERP — continuing is wasted work and burns nothing useful
//   3. Pass the breaker state via a closure object created per-scan
const MAX_RETRIES_429 = 2;
const RETRY_BASE_MS = 5000; // first retry wait
const CIRCUIT_TRIP_COUNT = 3; // consecutive scan-wide failures before abort

function createSerpRateLimiter() {
  return {
    consecutiveFailures: 0,
    tripped: false,
    note() { return this.tripped ? 'circuit_tripped' : `failures=${this.consecutiveFailures}`; },
  };
}

// Phase 2.5: SERP provider abstraction. searchOrganic owns retry / circuit /
// rate-limit policy and delegates the HTTP call to the configured provider.
// This decouples retry policy from any specific vendor; future providers
// (Serper, Brave, DataForSEO) plug in via the SerpProvider interface.
//
// Phase 2.7: result cache. Checked BEFORE provider call. On cache hit we skip
// the provider entirely, saving a SerpAPI credit. On cache miss we call the
// provider and write a successful response back. Failures (429, network, etc.)
// are NOT cached so the next attempt gets a fresh chance.
async function searchOrganic(query, { recency = DEFAULT_SERP_RECENCY, limiter = null } = {}) {
  if (limiter?.tripped) {
    return []; // circuit tripped earlier — skip without burning more time
  }
  const provider = getSerpProvider();
  const cacheOpts = { recency, provider: provider.name, numResults: 10 };

  // Phase 2.7: try cache first
  const cached = await getCachedResults(query, cacheOpts);
  if (cached) {
    if (limiter) limiter.consecutiveFailures = 0;
    return cached;
  }

  for (let attempt = 0; attempt <= MAX_RETRIES_429; attempt++) {
    const { results, statusCode, headers, providerError } = await provider.search(query, {
      recency,
      numResults: 10,
      timeoutMs: 15000,
    });

    // Hard config / network error — no retry, just bail (statusCode 0 means
    // network failure or missing key)
    if (statusCode === 0) {
      if (providerError === 'missing_api_key') {
        return [];
      }
      logger.error('SERP provider error (network)', { query: query.slice(0, 80), providerError });
      return [];
    }

    // Success path
    if (statusCode >= 200 && statusCode < 400) {
      if (limiter) limiter.consecutiveFailures = 0;
      // Phase 2.7: cache the successful response so subsequent identical
      // queries within the TTL window skip the provider entirely
      await setCachedResults(query, cacheOpts, results);
      return results;
    }

    // Non-rate-limit error (e.g., 400 invalid query) — log + bail without retry
    const isRateLimit = statusCode === 429 || statusCode === 503;
    if (!isRateLimit) {
      logger.error('SERP provider error', {
        query: query.slice(0, 80),
        statusCode,
        providerError: providerError?.slice ? providerError.slice(0, 200) : providerError,
      });
      return [];
    }

    // 429 / 503 — honor Retry-After if provider sent one, else exponential backoff
    const retryAfter = parseInt(headers?.['retry-after'], 10);
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : RETRY_BASE_MS * Math.pow(2, attempt);
    logger.warn('SERP rate-limited (429/503), backing off', {
      provider: provider.name,
      query: query.slice(0, 80),
      attempt: attempt + 1,
      maxAttempts: MAX_RETRIES_429 + 1,
      waitMs,
      retryAfterHeader: headers?.['retry-after'] || null,
      providerError: providerError?.slice ? providerError.slice(0, 200) : providerError,
    });
    if (attempt < MAX_RETRIES_429) {
      await sleep(waitMs);
      continue;
    }
    // Exhausted retries on this query — increment circuit breaker counter
    if (limiter) {
      limiter.consecutiveFailures += 1;
      if (limiter.consecutiveFailures >= CIRCUIT_TRIP_COUNT) {
        limiter.tripped = true;
        logger.error('SERP circuit breaker tripped — aborting SERP phase', {
          provider: provider.name,
          consecutiveFailures: limiter.consecutiveFailures,
          hint: 'Check provider dashboard for rate-limit or paused-account status',
        });
      }
    }
    return [];
  }
  return [];
}

// Phase 1: strip hardcoded year tokens (2024, 2025) from AI-generated queries. The
// tbs=qdr:m3 freshness filter already restricts to recent results, and hardcoded
// years bias SERP toward stale articles when the year passes. Standalone 4-digit
// year tokens are removed; year tokens embedded inside quoted phrases are kept.
function stripYearTokens(query = '') {
  if (typeof query !== 'string') return '';
  // Split by quoted phrases so we only mutate unquoted segments
  return query
    .split(/("[^"]*")/g)
    .map(segment => segment.startsWith('"')
      ? segment
      : segment.replace(/\b(19|20)\d{2}\b/g, '').replace(/\s{2,}/g, ' '))
    .join('')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

// Phase 1.8: clean Google query of common AI-generated artifacts.
//   1. Drop literal "AND" — Google treats AND as a stop word but it pollutes the
//      query and burns relevance. Just spaces work (implicit AND).
//   2. Deduplicate repeated geography tokens — AI sometimes puts "USA" inside the
//      query AND the runtime appends "USA, INDIA" as suffix → "USA ... USA, INDIA".
//      Collapse repeated country/region tokens to a single occurrence at end.
const COMMON_GEO_TOKENS = [
  'USA', 'US', 'U.S.', 'U.S.A.', 'United States',
  'UAE', 'U.A.E.', 'United Arab Emirates',
  'India', 'INDIA', 'Bharat',
  'UK', 'U.K.', 'United Kingdom', 'Britain',
  'Saudi Arabia', 'KSA',
  'Singapore', 'Malaysia', 'Indonesia', 'Vietnam', 'Thailand',
  'Australia', 'Canada', 'Mexico', 'Brazil', 'Germany', 'France',
  'Europe', 'EU', 'EMEA', 'MENA', 'APAC', 'ASEAN', 'GCC',
];

function cleanSerpQuery(query = '') {
  if (typeof query !== 'string') return '';
  let q = query;

  // 1. Drop standalone literal AND (case-insensitive), but preserve "AND" inside quotes.
  q = q.split(/("[^"]*")/g).map(seg =>
    seg.startsWith('"') ? seg : seg.replace(/\b(AND|OR\s+AND|AND\s+OR)\b/g, (m) => m.toUpperCase() === 'AND' ? '' : m)
  ).join('');

  // 2. Deduplicate geography tokens — keep first occurrence only (outside quotes).
  const seenGeo = new Set();
  q = q.split(/("[^"]*")/g).map(seg => {
    if (seg.startsWith('"')) return seg;
    let out = seg;
    for (const tok of COMMON_GEO_TOKENS) {
      // Match the token as a whole word/phrase, case-sensitive (most geo tokens
      // are proper nouns or acronyms; we don't want to clobber regular words).
      const escaped = tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const rx = new RegExp(`\\b${escaped}\\b`, 'g');
      out = out.replace(rx, (match) => {
        const key = match.toLowerCase().replace(/[.\s]/g, '');
        if (seenGeo.has(key)) return ''; // duplicate — drop
        seenGeo.add(key);
        return match;
      });
    }
    return out;
  }).join('');

  // 3. Normalize commas: outside quoted phrases, replace commas with spaces (Google
  //    treats them identically and this avoids orphan commas after geo dedup, e.g.
  //    "USA, INDIA" → "USA " when USA was already present elsewhere.
  q = q.split(/("[^"]*")/g).map(seg =>
    seg.startsWith('"') ? seg : seg.replace(/,/g, ' ')
  ).join('');

  // 4. Collapse whitespace
  q = q.replace(/\s{2,}/g, ' ').trim();
  return q;
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
  // Job-board leads are demoted: capped at 70 so buyer-intent (organic) leads always
  // outrank them when results are merged and trimmed to maxLeads.
  const freshScore = /hour|today|1 day/i.test(postedAt) ? 70
                   : /[2-3] days?/i.test(postedAt)      ? 65
                   : 60;

  return {
    companyName,
    website,
    industry:    '',
    location:    jr.location || '',
    companySize: '',
    description: '',
    techStack:   [],
    signalType:  'hiring_signal',
    signalText:  `Hiring "${jr.title}" â€” weak hiring signal of possible need for: ${profile.productSummary?.slice(0, 80)}`,
    confidence:  65,
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
    source:    `Google Jobs â€” ${jr.via || 'Job Board'}`,
    sourceUrl: jr.apply_options?.[0]?.link || '',
    _rawDescription: jr.description || '',
    _isJobLead: true,
  };
}

function organicToLead(result, profile) {
  if (!result.link) return null;
  if (isAggregator(result.link)) return null;
  const website = normDomain(result.link);
  const title   = result.title   || '';
  const snippet = result.snippet || '';
  const companyName = title.replace(/[-â€“|].*$/, '').trim().slice(0, 80);
  if (!companyName || companyName.length < 3) return null;

  // News / publisher pages: the URL points to the news site, not to a buyer.
  // The real subject company gets extracted by scoreBatch (extractedCompany field).
  // We keep this entry so scoreBatch can see title+snippet, but strip the publisher
  // website and tag it so downstream code knows companyName is placeholder.
  const newsArticle = isNewsDomain(result.link);

  return {
    companyName,
    website:     newsArticle ? '' : website,
    industry:    '',
    location:    '',
    companySize: '',
    description: snippet.slice(0, 200),
    techStack:   [],
    signalType:  newsArticle ? 'news_signal' : 'product_interest',
    signalText:  snippet.slice(0, 150),
    confidence:  newsArticle ? 60 : 65,
    relevanceScore: newsArticle ? 62 : 68,
    contactName:     null,
    contactTitle:    null,
    contactEmail:    null,
    contactLinkedin: null,
    companyLinkedinUrl: null,
    source:    newsArticle ? `News article — ${normDomain(result.link)}` : 'Google Search',
    sourceUrl: result.link,
    _rawDescription: snippet,
    _rawTitle:       title,
    _isNewsArticle:  newsArticle,
    _publisherDomain: newsArticle ? website : '',
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

// Maps UI company size labels â†’ Apollo organization_num_employees_ranges format ["min,max"]
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

// Maps UI seniority labels â†’ Apollo person_seniority values
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STRATEGY A â€” Apollo search (software / digital products only)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
    // NOTE: q_keywords is intentionally omitted from people search â€”
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STRATEGY B â€” SerpAPI search (physical products, industrial, B2C)
//
// THREE sub-phases:
//   B1: Buyer-intent organic â€” procurement signals, operators, facilities, projects
//   B2: RFP/tender search â€” active sourcing signals
//   B3: Retailer/distributor search (only for B2C products)
//   Optional fallback: Google Jobs only if explicitly enabled as a secondary signal
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runSerpSearch(profile, filters, tryAdd, rawTarget = 125, rawLeads = []) {
  const { targetRegion = '', targetIndustry = '' } = filters;
  const reg = targetRegion   ? ` ${targetRegion}`   : '';
  const ind = targetIndustry ? ` ${targetIndustry}` : '';
  const sp  = profile.serpProfile || {};
  const useJobSignals = shouldUseJobSignals(profile);
  // Phase 1.8: shared rate-limiter / circuit breaker for this scan
  const limiter = createSerpRateLimiter();

  // Phase 2.3: source routing plan — sourced from the matched industry bucket.
  // Provides preferred-source queries (site: operators on bucket's preferred
  // domains), extra query patterns from the bucket, and an avoid-domain list
  // that downstream filters use to drop irrelevant results.
  const routingPlan = buildRoutingPlan(profile, filters);

  // Scale query counts based on target. Higher floors than before so even small
  // scans get enough query diversity — buyer-event queries each return very different
  // result sets, so under-budgeting them was a major cause of low yield.
  const maxJobTitles   = TEST_MODE ? 2 : Math.min(6, Math.max(2, Math.ceil(rawTarget / 15)));
  const maxBuyerQs     = TEST_MODE ? 2 : Math.min(10, Math.max(6, Math.ceil(rawTarget / 15)));
  const maxRfpQs       = TEST_MODE ? 1 : Math.min(4, Math.max(2, Math.ceil(rawTarget / 30)));
  const maxCaseStudyQs = TEST_MODE ? 1 : 3;
  const maxJobsPages   = TEST_MODE ? TEST_MAX_PAGES : Math.min(5, Math.max(1, Math.ceil(rawTarget / 30)));

  // Helper: convert a SERP organic result to a lead, applying the routing plan's
  // avoid-domain filter (Phase 2.3). Returns null when the URL is on a bucket's
  // avoid list (e.g., GitHub for a generator-rental scan).
  function routedOrganicToLead(result, prof) {
    const url = result?.link || result?.url || '';
    const blocked = urlIsOnAvoidDomain(url, routingPlan.avoidDomains);
    if (blocked) {
      logger.debug('Source router: dropped result on avoid-domain', { url, avoidDomain: blocked });
      return null;
    }
    return organicToLead(result, prof);
  }

  // B1: Buyer-EVENT organic queries (project announcements, expansions, openings).
  // These do NOT contain the offer keyword — that's what stops SERP returning sellers.
  // Phase 1: strip hardcoded year tokens; the tbs=qdr:m3 freshness filter handles recency.
  // Phase 2.3: blend in bucket's extra query patterns at the FRONT (high-yield
  // patterns for this industry, e.g. "groundbreaking OR construction begins" for
  // industrial_rental). AI-generated queries follow for offer-specific phrasing.
  const aiBuyerQueries = (sp.buyerIntentQueries || []).slice(0, maxBuyerQs);
  const bucketPatterns = routingPlan.extraQueryPatterns || [];
  // Take the smaller of (3, half the buyer budget) from the bucket to leave room for AI queries
  const bucketSlots = Math.min(bucketPatterns.length, Math.max(2, Math.floor(maxBuyerQs / 2)));
  const aiSlots = Math.max(2, maxBuyerQs - bucketSlots);
  const mergedBuyerQueries = [
    ...bucketPatterns.slice(0, bucketSlots),
    ...aiBuyerQueries.slice(0, aiSlots),
  ];
  // De-duplicate (normalize lowercase + trim) so identical patterns aren't double-fired
  const seenBQ = new Set();
  const buyerQueries = mergedBuyerQueries
    .map(q => cleanSerpQuery(stripYearTokens(`${q}${ind}${reg}`)))
    .filter(Boolean)
    .filter(q => {
      const k = q.toLowerCase();
      if (seenBQ.has(k)) return false;
      seenBQ.add(k);
      return true;
    });

  logger.info('SerpAPI buyer-event queries', {
    count: buyerQueries.length,
    queries: buyerQueries,
    routedBucket: routingPlan.bucketKey,
    bucketPatternsUsed: bucketSlots,
    aiPatternsUsed: aiSlots,
  });

  for (const query of buyerQueries) {
    if (rawLeads.length >= rawTarget) break;
    if (limiter.tripped) break;
    const results = await searchOrganic(query, { limiter });
    let kept = 0;
    for (const result of results) {
      if (rawLeads.length >= rawTarget) break;
      const lead = routedOrganicToLead(result, profile);
      if (lead && tryAdd(lead)) kept++;
    }
    logger.info('SERP query result', {
      query,
      organicResults: results.length,
      addedToRaw: kept,
      droppedByFilters: results.length - kept,
      rawSoFar: rawLeads.length,
    });
    // Phase 1.8: bigger inter-query sleep to avoid burst rate limits (was 800ms)
    await sleep(TEST_MODE ? 300 : 1500);
  }

  // Phase 2.3: B1.5 — preferred-source queries (bucket's global press) AND
  // Phase 2.4: regional-source queries (region-specific press per resolved
  // canonical region). Both treat results as news articles so scoreBatch
  // extracts the buyer subject instead of treating the publisher as the buyer.
  // Note: regional queries already have `site:` baked in; do NOT re-append `reg`.
  const preferredSourceQueriesRaw = (routingPlan.preferredSourceQueries || [])
    .slice(0, TEST_MODE ? 1 : 3)
    .map(q => cleanSerpQuery(stripYearTokens(`${q}${reg}`)));
  const regionalSourceQueriesRaw = (routingPlan.regionalSourceQueries || [])
    .slice(0, TEST_MODE ? 1 : 4)
    .map(q => cleanSerpQuery(stripYearTokens(q)));
  const sourceQueriesAll = [...preferredSourceQueriesRaw, ...regionalSourceQueriesRaw]
    .filter(Boolean);
  // De-dupe (regional + preferred could overlap if a bucket's preferredSource
  // is also a region's top press, e.g., zawya.com)
  const seenSQ = new Set();
  const sourceQueries = sourceQueriesAll.filter(q => {
    const k = q.toLowerCase();
    if (seenSQ.has(k)) return false;
    seenSQ.add(k);
    return true;
  });

  for (const query of sourceQueries) {
    if (rawLeads.length >= rawTarget) break;
    if (limiter.tripped) break;
    const results = await searchOrganic(query, { limiter });
    let kept = 0;
    for (const result of results) {
      if (rawLeads.length >= rawTarget) break;
      const lead = routedOrganicToLead(result, profile);
      if (lead) {
        lead.signalType     = 'preferred_source';
        lead._isNewsArticle = true;
        lead.source         = lead.source || 'Preferred-source press';
        if (tryAdd(lead)) kept++;
      }
    }
    logger.info('SERP preferred-source query result', {
      query, organicResults: results.length, addedToRaw: kept, rawSoFar: rawLeads.length,
    });
    await sleep(TEST_MODE ? 300 : 1500);
  }

  // B2: RFP / procurement (site: tender-aggregator queries — product keyword OK here)
  const rfpQueries = (sp.rfpQueries || [])
    .slice(0, maxRfpQs)
    .map(q => cleanSerpQuery(stripYearTokens(`${q}${ind}${reg}`)))
    .filter(Boolean);

  for (const query of rfpQueries) {
    if (rawLeads.length >= rawTarget) break;
    if (limiter.tripped) break;
    const results = await searchOrganic(query, { limiter });
    let kept = 0;
    for (const result of results) {
      if (rawLeads.length >= rawTarget) break;
      const lead = routedOrganicToLead(result, profile);
      if (lead) {
        lead.signalType     = 'procurement';
        lead.relevanceScore = 85;
        lead.confidence     = 88;
        lead.source         = 'RFP / Procurement Signal';
        if (tryAdd(lead)) kept++;
      }
    }
    logger.info('SERP RFP query result', {
      query, organicResults: results.length, addedToRaw: kept, rawSoFar: rawLeads.length,
    });
    await sleep(TEST_MODE ? 300 : 1500);
  }

  // B2.5: Case-study inversion — search competitors' own case-study pages. These
  // name real BUYERS (the competitor's customers), which the scoreBatch then
  // extracts via the extractedCompany path. High signal-to-noise.
  const caseStudyQueries = (sp.caseStudyQueries || [])
    .slice(0, maxCaseStudyQs)
    .map(q => cleanSerpQuery(stripYearTokens(`${q}${reg}`)))
    .filter(Boolean);

  for (const query of caseStudyQueries) {
    if (rawLeads.length >= rawTarget) break;
    if (limiter.tripped) break;
    const results = await searchOrganic(query, { limiter });
    let kept = 0;
    for (const result of results) {
      if (rawLeads.length >= rawTarget) break;
      const lead = routedOrganicToLead(result, profile);
      if (lead) {
        lead.signalType     = 'case_study_inversion';
        lead.relevanceScore = Math.max(lead.relevanceScore, 70);
        lead.source         = 'Competitor case study';
        // Mark as aggregator-like so scoreBatch tries to extract the buyer subject
        lead._isNewsArticle = true;
        if (tryAdd(lead)) kept++;
      }
    }
    logger.info('SERP case-study query result', {
      query, organicResults: results.length, addedToRaw: kept, rawSoFar: rawLeads.length,
    });
    await sleep(TEST_MODE ? 300 : 1500);
  }

  // B3: Retailer/distributor queries (B2C only)
  if (profile.buyerType === 'B2C' || profile.buyerType === 'BOTH') {
    const retailQueries = (sp.retailerQueries || [])
      .slice(0, TEST_MODE ? 1 : 3)
      .map(q => `${q}${reg}`);

    for (const query of retailQueries) {
      if (rawLeads.length >= rawTarget) break;
      if (limiter.tripped) break;
      const results = await searchOrganic(query, { limiter });
      for (const result of results) {
        if (rawLeads.length >= rawTarget) break;
        const lead = routedOrganicToLead(result, profile);
        if (lead) {
          lead.source = 'Retailer / Distributor Search';
          tryAdd(lead);
        }
      }
      await sleep(TEST_MODE ? 300 : 1500);
    }
  }

  // Google Jobs fallback — DEMOTED to a weak last-resort signal.
  // Only fires when user explicitly enabled job signals AND organic SERP returned
  // less than 30% of the raw target (i.e., genuine starvation, not just under-target).
  const jobFallbackThreshold = Math.max(1, Math.floor(rawTarget * 0.3));
  if (useJobSignals && rawLeads.length < jobFallbackThreshold) {
    const jobTitles = (sp.jobTitleSearches || []).slice(0, maxJobTitles);
    logger.info('SerpAPI Google Jobs fallback (weak signal, organic was starved)', {
      titles: jobTitles, rawTarget, organicFound: rawLeads.length, threshold: jobFallbackThreshold,
    });

    for (const title of jobTitles) {
      if (rawLeads.length >= rawTarget) break;
      const query = `${title}${ind}${reg}`;
      const jobs  = await fetchAllJobPages(query, filters, maxJobsPages);
      logger.info('Jobs fetched', { title, count: jobs.length });

      for (const jr of jobs) {
        if (rawLeads.length >= rawTarget) break;
        const lead = jobToLead(jr, profile);
        if (lead) tryAdd(lead);
      }
      await sleep(TEST_MODE ? 300 : 700);
    }
  } else if (useJobSignals) {
    logger.info('Skipping Google Jobs fallback — organic SERP yielded enough leads', {
      organicFound: rawLeads.length, threshold: jobFallbackThreshold,
    });
  } else {
    logger.info('Skipping Google Jobs for company-first SERP search', {
      strategy: profile.searchStrategy,
      isPhysicalProduct: profile.isPhysicalProduct,
      isRentalOrService: profile.isRentalOrService,
    });
  }

  logger.info('SerpAPI search done', {
    rawCollected: rawLeads.length,
    rawTarget,
    rateLimiter: limiter.note(),
  });
  if (limiter.tripped) {
    logger.warn('SerpAPI rate-limit circuit tripped during scan', {
      rawCollected: rawLeads.length,
      hint: 'SerpAPI returned 429/503 repeatedly. Try again later or check SerpAPI dashboard for per-minute / concurrency limits.',
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Apollo ENRICHMENT layer — runs AFTER SerpAPI discovers buyer companies.
//
// Takes the top 30 SERP-discovered companies (by relevanceScore) that don't
// already have a decision-maker contact, looks each up in Apollo by company
// name, and attaches the best-matching buyer-role person back onto the lead.
//
// This is the "Apollo as enrichment, not discovery" change from the new
// buyer-intent direction. We do NOT create new leads here — we only fill in
// contact details on companies SERP already discovered.
// ─────────────────────────────────────────────────────────────────────────────

const APOLLO_ENRICH_CAP = 30;

// Phase 1: minimum company size for Apollo enrichment. A 2-employee "company"
// (PPME) won't be a real buyer for industrial/enterprise services. Skip enrichment
// for micro-orgs unless the user explicitly requested SMB targeting.
const MIN_COMPANY_SIZE_FOR_ENRICHMENT = 20;

// Generic role tokens that don't disambiguate buyer-vs-irrelevant. We need a
// non-generic content word to overlap (e.g., "Procurement", "Facilities") between
// the buyer title and the Apollo person's title for a real match.
const GENERIC_TITLE_WORDS = new Set([
  'manager', 'director', 'head', 'lead', 'leader', 'chief', 'officer', 'vp',
  'svp', 'evp', 'avp', 'president', 'senior', 'principal', 'staff', 'global',
  'regional', 'general', 'group', 'executive', 'associate', 'assistant', 'of',
  'the', 'and', 'for', 'a', 'an',
]);

function titleContentWords(title = '') {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3 && !GENERIC_TITLE_WORDS.has(w));
}

// Returns true when the person's title shares a non-generic content word with
// any of the buyer titles. "Park Director" vs ["Procurement Manager",
// "Facilities Manager"] → no overlap → false → skip. "Procurement Lead" vs
// ["Procurement Manager"] → "procurement" overlap → true → keep.
function personTitleMatchesBuyerRoles(personTitle = '', buyerTitles = []) {
  const personWords = new Set(titleContentWords(personTitle));
  if (!personWords.size) return false;
  for (const bt of buyerTitles) {
    for (const w of titleContentWords(bt)) {
      if (personWords.has(w)) return true;
    }
  }
  return false;
}

// User explicitly targets small business (Micro/Small) → don't skip small orgs.
function userTargetsSmb(filters = {}) {
  const size = (filters.companySize || '').toLowerCase();
  return size.startsWith('1-10') || size.startsWith('11-50') || /\b(smb|small business|micro)\b/.test(size);
}

async function enrichSerpLeadsWithApollo(rawLeads, profile, filters = {}) {
  if (!config.apollo?.apiKey) {
    logger.info('Apollo enrichment skipped — APOLLO_API_KEY not set');
    return;
  }

  // Eligible: SERP-source leads without a contact, sorted by relevanceScore desc
  const eligible = rawLeads
    .filter(l => !l.contactName && l.companyName && l.source !== 'Apollo People Search' && l.source !== 'Apollo Company Search')
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))
    .slice(0, APOLLO_ENRICH_CAP);

  if (!eligible.length) {
    logger.info('Apollo enrichment skipped — no eligible SERP leads');
    return;
  }

  const ap = profile.apolloProfile || {};
  const aiTitles = (ap.buyerTitles || []).slice(0, 6);
  const userTitles = (filters.decisionMakers || []).filter(Boolean);

  // Generic buyer-side decision-maker fallback. Used when the AI profile (and the
  // user) provide no titles — common when AI picks SERP strategy and skips
  // apolloProfile. These are broad enough that Apollo will find SOMEONE at most
  // mid-to-large companies, and `include_similar_titles: true` widens the net further.
  const FALLBACK_BUYER_TITLES = [
    'Procurement Manager', 'Procurement Director', 'Head of Procurement',
    'Facilities Manager', 'Operations Director', 'Operations Manager',
    'Chief Operating Officer', 'VP Operations',
  ];

  let titles = [...new Set([...userTitles, ...aiTitles])];
  if (!titles.length) {
    titles = FALLBACK_BUYER_TITLES.slice(0, 6);
    logger.info('Apollo enrichment: using fallback buyer titles', { titles });
  }
  titles = titles.slice(0, 8);

  const userSeniority = seniorityToApolloValues(filters.seniorityLevel);
  const seniority = userSeniority || ap.personSeniority || ['manager', 'director', 'vp', 'c_suite', 'owner'];

  logger.info('Apollo enrichment START', {
    candidates: eligible.length,
    titles: titles.length,
    seniorityCount: seniority.length,
  });

  const smbAllowed = userTargetsSmb(filters);
  let enrichedCount = 0;
  for (const lead of eligible) {
    try {
      // Step 1: find the company in Apollo by name
      const { organizations } = await apolloCompanySearch({
        q_organization_name: lead.companyName,
      }, 1);

      if (!organizations.length) {
        logger.debug('Apollo enrichment: org not found', { company: lead.companyName });
        await sleep(250);
        continue;
      }

      // Best match: prefer exact name match, fall back to first result
      const targetName = normName(lead.companyName);
      const org = organizations.find(o => normName(o.name || '') === targetName) || organizations[0];
      if (!org?.id) { await sleep(250); continue; }

      // Phase 1: size gate — skip micro-orgs unless user explicitly targets SMB.
      // A 2-employee company won't realistically buy enterprise/industrial services.
      const orgSize = Number(org.estimated_num_employees) || 0;
      if (!smbAllowed && orgSize > 0 && orgSize < MIN_COMPANY_SIZE_FOR_ENRICHMENT) {
        logger.info('Apollo enrichment: skipping micro-org (size gate)', {
          company: lead.companyName, employees: orgSize, threshold: MIN_COMPANY_SIZE_FOR_ENRICHMENT,
        });
        await sleep(250);
        continue;
      }

      // Step 2: search people at that org filtered by buyer titles + seniority
      const { people } = await apolloPeopleSearch({
        organization_ids: [org.id],
        person_titles: titles,
        person_seniority: seniority,
        include_similar_titles: true,
      }, 1);

      if (!people.length) {
        logger.debug('Apollo enrichment: no people matched', { company: lead.companyName });
        await sleep(300);
        continue;
      }

      // Phase 1: title-strict mode — Apollo's `include_similar_titles` is lenient
      // and sometimes returns "Recreation Director" / "Park Director" when we asked
      // for "Procurement Manager". Filter people whose title shares no content
      // word with any of our buyer titles. Prefer ones with email when multiple match.
      const titleMatched = people.filter(p => personTitleMatchesBuyerRoles(p.title || '', titles));
      if (!titleMatched.length) {
        logger.info('Apollo enrichment: people found but none matched buyer roles (strict mode)', {
          company: lead.companyName,
          buyerTitles: titles,
          apolloTitles: people.slice(0, 5).map(p => p.title).filter(Boolean),
        });
        await sleep(300);
        continue;
      }

      // Pick the first matched person with an email, else the first matched person
      const best = titleMatched.find(p => p.email) || titleMatched[0];
      const contactName = [best.first_name, best.last_name].filter(Boolean).join(' ') || null;

      // Mutate lead in place — don't create a new lead
      lead.contactName        = contactName;
      lead.contactTitle       = best.title || null;
      lead.contactEmail       = best.email || null;
      lead.contactLinkedin    = best.linkedin_url || null;
      lead.companyLinkedinUrl = lead.companyLinkedinUrl || org.linkedin_url || null;
      if (!lead.industry)    lead.industry    = org.industry || '';
      if (!lead.companySize) lead.companySize = empSize(org.estimated_num_employees || 0);
      if (!lead.website)     lead.website     = normDomain(org.website_url || org.primary_domain || '');
      lead.signalText = `${contactName || 'Buyer'} (${best.title || 'decision-maker'}) at ${org.name} — ${lead.signalText || ''}`.slice(0, 400);
      // Boost relevance modestly when we successfully attached a real contact
      lead.relevanceScore = Math.min(95, (lead.relevanceScore || 70) + 8);
      lead._apolloEnriched = true;

      enrichedCount++;
      await sleep(300);
    } catch (err) {
      logger.warn('Apollo enrichment failed for lead', { company: lead.companyName, err: err.message });
      await sleep(300);
    }
  }

  logger.info('Apollo enrichment DONE', {
    candidates: eligible.length,
    enriched: enrichedCount,
  });
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// STEP 3 â€” AI batch scoring: BUYER vs SELLER (10 per AI call)
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

// Phase 2.8: build a richer signalText that includes both the article headline
// AND a short excerpt from the body. Replaces the older 160-char headline-only
// signalText. Total budget ~400 chars so the Intent Signals card stays compact.
//
//   "<Extracted> mentioned in: \"<headline>\" — <first ~200 chars of body>..."
//
// When the scraped body is unavailable (rare), gracefully degrades to the
// headline-only form.
function buildSubjectSignalText(extracted, lead) {
  const headline = String(lead._scrapedTitle || lead._rawTitle || '').slice(0, 160).trim();
  const body = String(lead._rawDescription || '').replace(/\s+/g, ' ').trim();
  const excerpt = body.slice(0, 200).trim();
  const head = `${extracted} mentioned in: "${headline}"`;
  if (!excerpt) return head.slice(0, 400);
  const truncated = body.length > 200 ? '…' : '';
  return `${head} — ${excerpt}${truncated}`.slice(0, 400);
}

async function scoreBatch(leads, profile) {
  if (!leads.length) return leads;

  const list = leads.map((l, i) => {
    // Phase 2.6: when deep-scrape succeeded, use a longer slice of the article
    // body so the AI sees the actual buyer event in context (not the truncated
    // SerpAPI snippet). For non-scraped leads keep the 220-char cap to bound
    // total prompt size.
    const scraped = l._scrapeStatus === 'ok';
    const bodyCap = scraped ? 900 : 220;
    const desc  = (l._rawDescription || l.description || '').slice(0, bodyCap);
    // Prefer the scraped title (cleaner than truncated SerpAPI title) when present
    const title = (l._scrapedTitle || l._rawTitle || '').slice(0, 160);
    const url   = l.sourceUrl || '';
    const domain = url ? normDomain(url) : (l.website || '');
    const tag   = l._isNewsArticle ? ` | Source: NEWS_ARTICLE (publisher=${l._publisherDomain || domain || '?'})` : '';
    const scrapedTag = scraped ? ' | Body: FULL_ARTICLE' : '';
    return `${i + 1}. Name/Title: ${title || l.companyName} | URL: ${domain || '?'} | Industry: ${l.industry || '?'}${tag}${scrapedTag} | Content: ${desc || 'none'}`;
  }).join('\n');

  const systemPrompt = `For each entry, identify the REAL BUYER COMPANY behind the result.

Classify each entry as:
  BUYER = an actual company that PURCHASES, USES, RENTS, or NEEDS this product/service
  SELLER = a company that SELLS, MAKES, RENTS-OUT, or PROVIDES this same product/service (competitor)
  AGGREGATOR = the entry is NOT itself a buyer. This includes:
    - news articles, press releases, blog posts (the publisher is NOT the buyer — the company mentioned IN the article is)
    - listing sites, marketplaces, RFP portals, directories, comparison sites
    - job boards (LinkedIn, Indeed, Glassdoor, Monster, ZipRecruiter, Naukri, etc.)
    - recruitment/staffing agencies posting jobs on behalf of unnamed clients
    - online training courses, certification programs, tutorials
    - Wikipedia, Reddit threads, Quora answers, forum posts
    - generic content pages (e.g., "Top 10 generator rental companies in X")

CRITICAL — extractedCompany:
ALWAYS provide a clean company name in extractedCompany. This applies BOTH to BUYER
and AGGREGATOR classifications:
  - For BUYER: if the entry's Name/Title is a clean company name like "Meta" or "IHG",
    just repeat that name in extractedCompany. If the Name/Title is a headline like
    "Oracle to increase Abu Dhabi investment" or "IHG Annual Report 2024", extract the
    underlying real company ("Oracle", "IHG") in extractedCompany.
  - For AGGREGATOR: extract the real BUYER company being discussed in the title/snippet.
    The buyer is the company that NEEDS / RENTS / USES the offer, not the one providing it.

HEADLINE DETECTION — these are NOT company names, they are headlines/titles:
  - Anything containing a year ("2024", "2025"), quarter ("Q3"), or document keyword
    ("Annual Report", "Press Release", "Whitepaper", "Case Study")
  - Anything with mid-sentence verbs ("X to launch Y", "X opens Y", "X acquires Y",
    "X enters Y", "X invests in Y", "X partners with Y")
  - Anything with colon-style structure ("BRAND: news", "TITLE: subtitle")
  - Anything longer than 5 words
  - Listicle starters ("New X Openings in 2024", "Top 10 X", "Best X for Y")
  - Truncated text ending in "..." or "…"
  - Possessive constructs ("Hilton's first ...", "Apple's new ...")
When you see a headline like this, NEVER use it verbatim as extractedCompany. Pull out
the underlying company name, or leave extractedCompany blank if no specific company
can be identified.

Examples:
  - Title "AWS Data Center In UAE Damaged Amid Regional Strikes" on cioafrica.co
    → extractedCompany: "Amazon Web Services" (AWS needs power continuity = buyer)
  - Title "Marriott opens new resort in Dubai" on gulfnews.com
    → extractedCompany: "Marriott International" (new property needs generators = buyer)
  - Title "Hilton's first Galicia hotel relies on Genesal Energy backup" on genesalenergy.com
    → extractedCompany: "Hilton" (Hilton is the buyer; Genesal is the seller — IGNORE Genesal)
  - Title "Cummins launches new home standby generator" on cummins.com
    → classification: SELLER (Cummins is the manufacturer, no buyer in the entry)
  - Title "Powermax Generator Rental Services" on scribd.com
    → classification: SELLER (the entry is about a rental company itself)

DO NOT extract the SELLER as the buyer:
  - If the URL is on a manufacturer/seller domain (e.g., cummins.com, caterpillar.com,
    aggreko.com, genesalenergy.com, albahar.com), and the article is a case study about
    that seller's product, the BUYER is the customer named in the case study (Hilton,
    Marriott, etc.) — NOT the seller hosting the page.
  - If no specific buyer is named, classify as SELLER and leave extractedCompany blank.

DO NOT use page titles, article headlines, or sentence fragments as extractedCompany.
Real company names are typically 1–4 words, capitalized, without verbs.
  - "Building a digital future" → NOT a company name (sentence fragment) → leave blank
  - "Securing Power: Global Strategies..." → NOT a company name → leave blank
  - "Unnamed Buyer in Hanover, Virginia" → placeholder, NOT a real name → leave blank
  - If you cannot name a specific real company, leave extractedCompany blank.

Be strict — when in doubt between BUYER and AGGREGATOR, choose AGGREGATOR.
Service-provider companies (e.g., a "generator rental company" entry when offer IS
generator rental) are SELLER, not BUYER.

EVIDENCE RULE (CRITICAL):
A BUYER classification MUST be supported by a SPECIFIC EVENT or SIGNAL visible
in the entry's title or snippet. Do NOT infer buyer intent from category, size,
or industry alone. The following reasoning patterns are ALL invalid and must
result in AGGREGATOR (or rejection) instead of BUYER:

  ❌ "As a major bank, they likely operate legacy systems and need cloud migration"
  ❌ "Given their industry and scale, they could benefit from this service"
  ❌ "Large enterprises typically need this — no direct signal but plausible buyer"
  ❌ "Although there is no explicit intent, their sector suggests need"
  ❌ "Potential buyer due to industry trends"

Valid BUYER reasons cite a CONCRETE event in the entry:
  ✅ "Announced new $200M facility expansion in Texas"
  ✅ "Filed RFP for cloud migration services on Aug 2024"
  ✅ "Hired new CIO and announced digital transformation roadmap"
  ✅ "Reports indicate ongoing data center build-out in UAE"
  ✅ "Just raised Series C funding earmarked for IT modernization"

If the title/snippet only NAMES a company without describing a specific buyer
event for that company, classify as AGGREGATOR (with extractedCompany only if
you can identify a real concrete buyer signal elsewhere in the snippet — not
just because the company appears in an industry report).

Reason field rules:
  - Always cite the SPECIFIC fact from the title/snippet that drives your classification
  - Never use "likely", "may need", "could benefit", "industry suggests", "scale suggest"
  - Never write "no direct signal but ..." — if there's no direct signal, it's AGGREGATOR
  - 1-2 sentences max

Return JSON: {"results":[
  {"index":1, "classification":"BUYER", "reason":"Announced new manufacturing plant in Illinois (specific event in snippet)"},
  {"index":3, "classification":"AGGREGATOR", "extractedCompany":"Amazon Web Services", "reason":"News about AWS data center in UAE - AWS named as buyer of power continuity in snippet"}
]}`;

  const userPrompt = `Offer: ${profile.productSummary}
Seller signals: ${(profile.sellerSignals || []).join(', ')}
Buyer signals: ${(profile.buyerSignals || []).join(', ')}

Entries:
${list}`;

  try {
    // Phase 2.6: bumped from 1100 → 1400 to give the AI room for more detailed
    // reason text now that the prompt contains full article bodies (not snippets).
    const raw     = await callOpenAI(systemPrompt, userPrompt, 1400);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);
    const buyers  = [];
    for (const r of (parsed.results || [])) {
      const lead = leads[r.index - 1];
      if (!lead) continue;

      if (r.classification === 'BUYER') {
        // Phase 1.7: reject inferential BUYER classifications — when the AI's
        // reason is category-based reasoning ("major bank, so likely needs cloud
        // migration") instead of citing a specific event. These produce noise
        // leads like RBI from an S&P Global industry analyst report.
        if (extractionIsWeakSignal(r.reason)) {
          logger.info('Dropped BUYER — inferential reasoning, no direct signal', {
            name: lead.companyName, reason: r.reason,
          });
          continue;
        }

        const originalIsPlaceholder = isPlaceholderName(lead.companyName);
        const originalIsHeadline = looksLikePageTitle(lead.companyName);
        const extracted = (r.extractedCompany || '').trim();
        const extractedClean = extracted && !isPlaceholderName(extracted) && !looksLikePageTitle(extracted);

        // Case 1: original name is clean → save as-is, optionally upgrade name from extracted
        if (!originalIsPlaceholder && !originalIsHeadline) {
          const cleanerName = extractedClean && extracted.length < lead.companyName.length
            ? extracted
            : lead.companyName;
          buyers.push({
            ...lead,
            companyName: cleanerName,
            relevanceScore: Math.min(95, lead.relevanceScore + 10),
          });
          continue;
        }

        // Case 2: original name is a headline/placeholder, but AI gave a clean extraction
        // → rewrite to extracted company (same path as AGGREGATOR + extraction)
        if (extractedClean) {
          const rewritten = {
            ...lead,
            companyName: extracted,
            website: '',
            companyLinkedinUrl: null,
            source: lead._isNewsArticle
              ? `News mention — ${lead._publisherDomain || 'press'}`
              : (lead.source || 'Subject extracted from headline'),
            signalText: buildSubjectSignalText(extracted, lead),
            relevanceScore: Math.min(85, (lead.relevanceScore || 60) + 10),
            _subjectExtracted: true,
          };
          buyers.push(rewritten);
          logger.info('Rewrote BUYER name from headline to extracted company', {
            original: lead.companyName, extracted, reason: r.reason,
          });
          continue;
        }

        // Case 3: headline/placeholder with no usable extraction → drop
        logger.info('Dropped BUYER classification — name looks like page title/placeholder and no clean extraction', {
          name: lead.companyName, extracted, reason: r.reason,
        });
        continue;
      }

      // Recover the real subject when AI extracted it from an aggregator/news article.
      // Replace placeholder companyName, clear publisher website so Apollo enrichment
      // looks up the actual subject company.
      const extracted = (r.extractedCompany || '').trim();

      // Reject extractions that are clearly the seller (not the buyer) — AI sometimes
      // just lifts the page subject regardless of role.
      if (extracted && extractedLooksLikeSeller(r.reason)) {
        logger.info('Dropped extractedCompany — AI reason indicates seller, not buyer', {
          extracted, reason: r.reason,
        });
        continue;
      }

      // Phase 1: reject weak-signal extractions — investors, stakeholders, or
      // entities that were only casually mentioned. These are not real buyers of
      // the offer being sold. e.g., Qatar Investment Authority investing in
      // Anthropic ≠ cloud migration buyer.
      if (extracted && extractionIsWeakSignal(r.reason)) {
        logger.info('Dropped extractedCompany — weak signal (investor/mentioned/stakeholder)', {
          extracted, reason: r.reason,
        });
        continue;
      }

      if (extracted && !isPlaceholderName(extracted) && !looksLikePageTitle(extracted)) {
        const rewritten = {
          ...lead,
          companyName: extracted,
          website: '',                 // let Apollo enrichment find the right domain
          companyLinkedinUrl: null,
          source: lead._isNewsArticle
            ? `News mention — ${lead._publisherDomain || 'press'}`
            : (lead.source || 'Subject extracted from aggregator'),
          signalText: buildSubjectSignalText(extracted, lead),
          // News-mention leads are weaker than direct buyer pages; keep below 75
          relevanceScore: Math.min(75, (lead.relevanceScore || 60) + 5),
          _isNewsArticle: lead._isNewsArticle || r.classification === 'AGGREGATOR',
          _subjectExtracted: true,
        };
        buyers.push(rewritten);
        logger.info('Subject extracted from aggregator/news', {
          publisher: lead._publisherDomain || normDomain(lead.sourceUrl || ''),
          extracted,
          reason: r.reason,
        });
        continue;
      }

      logger.debug('Filtered non-buyer', {
        name: lead.companyName,
        classification: r.classification,
        reason: r.reason,
      });
    }
    logger.info('Batch scored', { total: leads.length, buyers: buyers.length });
    return buyers;
  } catch (err) {
    logger.warn('Scoring failed â€” keeping all leads', { err: err.message });
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

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Main scan runner
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function runProductDiscoveryScan(job, productInput, filters = {}, progressCallback, maxLeads = 50) {
  logger.info('Product scan START', { jobId: job.id, maxLeads });
  if (progressCallback) await progressCallback(3, 0);

  // Fetch ~2.5Ã— the requested leads as raw buffer to absorb AI scoring filter-outs (~30-40% filtered)
  const rawTarget = Math.ceil(maxLeads * 2.5);

  // STEP 1: ONE AI call
  let profile;
  try {
    profile = await buildProductProfile(productInput, filters);
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
  const rawLeads    = [];
  const seenNames   = new Set();
  const seenDomains = new Set();

  function tryAdd(lead) {
    if (!lead?.companyName) return false;
    if (isPlaceholderName(lead.companyName)) {
      logger.debug('Filtered placeholder company name', { name: lead.companyName });
      return false;
    }
    const nk = normName(lead.companyName);
    const dk = lead.website ? normDomain(lead.website) : '';
    if (!nk || seenNames.has(nk)) return false;
    if (dk && seenDomains.has(dk)) return false;
    if (isCompetitor(lead, profile)) {
      logger.debug('Filtered competitor', { name: lead.companyName });
      return false;
    }
    seenNames.add(nk);
    if (dk) seenDomains.add(dk);
    rawLeads.push(lead);
    return true;
  }

  function hasEnoughRaw() { return rawLeads.length >= rawTarget; }

  const strategy = (profile.searchStrategy || 'BOTH').toUpperCase();

  // STEP 2: Run the right search strategy (discovery only — no enrichment yet)
  if (strategy === 'APOLLO') {
    // Software/digital products — Apollo is best for both discovery and contacts
    logger.info('Running Apollo search (software/digital product)', { jobId: job.id });
    await runApolloSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    if (progressCallback) await progressCallback(55, rawLeads.length);

  } else if (strategy === 'SERP') {
    logger.info('Running SerpAPI search (buyer-company discovery)', { jobId: job.id });
    await runSerpSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    if (progressCallback) await progressCallback(55, rawLeads.length);

  } else {
    logger.info('Running BOTH searches (SERP-led)', { jobId: job.id });
    await runSerpSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    if (progressCallback) await progressCallback(40, rawLeads.length);
    if (!hasEnoughRaw()) {
      await runApolloSearch(profile, filters, tryAdd, rawTarget, rawLeads);
    }
    if (progressCallback) await progressCallback(55, rawLeads.length);
  }

  // Pipeline funnel — count how many leads survive each phase so we can diagnose
  // where volume gets lost. Phase 1 = raw discovery (SERP/Apollo combined).
  const funnel = {
    discovered: rawLeads.length,
    afterScoring: 0,
    afterPostScoreDedup: 0,
    apolloEnriched: 0,
    final: 0,
  };
  logger.info('FUNNEL · discovered', { jobId: job.id, count: funnel.discovered, strategy });

  // Phase 2.6: selective deep scrape — fetch the actual article body for the
  // top news/aggregator candidates. The AI scorer otherwise sees only the
  // ~200-char SerpAPI snippet, which often truncates the buyer event. With the
  // full body it can cite the specific signal in its reason text. Best-effort:
  // failures fall back to the snippet.
  if (rawLeads.length > 0) {
    try {
      const summary = await deepScrapeTopCandidates(rawLeads, { topN: 10, concurrency: 3 });
      logger.info('FUNNEL · deepScraped', {
        jobId: job.id,
        scraped: summary.scraped,
        ok: summary.ok,
        failed: summary.failed,
      });
    } catch (err) {
      logger.warn('Deep scrape phase failed (non-fatal)', { err: err.message });
    }
  }

  // STEP 3: AI scoring FIRST — filters out sellers/aggregators AND rewrites
  // news/article entries with the real subject company (extractedCompany).
  // We score before enrichment so we don't waste Apollo calls on entries that
  // get filtered out, and so news-article leads carry the real buyer name when
  // they reach Apollo.
  logger.info('AI scoring START', { jobId: job.id, toScore: rawLeads.length });
  let scoredLeads = await scoreAllLeads(rawLeads, profile);
  funnel.afterScoring = scoredLeads.length;
  logger.info('FUNNEL · afterScoring', {
    jobId:    job.id,
    discovered: funnel.discovered,
    afterScoring: funnel.afterScoring,
    droppedBySellerAggregatorFilter: funnel.discovered - funnel.afterScoring,
  });

  // Dedup again after scoring — multiple news articles can extract the same subject
  const seenScoredNames = new Set();
  scoredLeads = scoredLeads.filter(l => {
    const nk = normName(l.companyName);
    if (!nk || seenScoredNames.has(nk)) return false;
    seenScoredNames.add(nk);
    return true;
  });
  funnel.afterPostScoreDedup = scoredLeads.length;
  logger.info('FUNNEL · afterPostScoreDedup', {
    jobId: job.id,
    afterScoring: funnel.afterScoring,
    afterPostScoreDedup: funnel.afterPostScoreDedup,
    dedupedDuplicates: funnel.afterScoring - funnel.afterPostScoreDedup,
  });

  if (progressCallback) await progressCallback(72, scoredLeads.length);

  // STEP 4: Apollo ENRICHMENT — only on scored buyers (skips for pure APOLLO path
  // since those leads already have contacts from people search).
  if (strategy !== 'APOLLO') {
    await enrichSerpLeadsWithApollo(scoredLeads, profile, filters);
  }
  funnel.apolloEnriched = scoredLeads.filter(l => l._apolloEnriched).length;
  logger.info('FUNNEL · apolloEnriched', {
    jobId: job.id,
    candidates: scoredLeads.length,
    enriched: funnel.apolloEnriched,
    note: 'leads without Apollo match still saved without contact',
  });
  if (progressCallback) await progressCallback(90, scoredLeads.length);

  // Trim to exactly what the user requested
  const finalLeads = scoredLeads.slice(0, maxLeads);
  funnel.final = finalLeads.length;
  logger.info('FUNNEL · final', { jobId: job.id, ...funnel });

  if (progressCallback) await progressCallback(100, finalLeads.length);

  logger.info('Product scan DONE', {
    jobId:    job.id,
    strategy,
    total:    finalLeads.length,
  });

  return { leads: finalLeads, profile };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// generateProductPrompt â€” called before scan, user reviews/edits the prompt
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function generateProductPrompt(productInput, filters = {}) {
  let urlText = '';
  if (productInput.url) {
    urlText = (await fetchProductPageText(productInput.url)) || '';
  }

  const parts = [
    productInput.url         ? `Offer URL: ${productInput.url}` : '',
    urlText                  ? `Page content:\n${urlText.slice(0, 1500)}` : '',
    productInput.description ? `Offer details:\n${productInput.description.slice(0, 1500)}` : '',
    productInput.docText     ? `Document:\n${productInput.docText.slice(0, 1500)}` : '',
    productInput.content && !productInput.description && !productInput.docText
      ? `Info:\n${productInput.content.slice(0, 1000)}` : '',
  ].filter(Boolean);

  const combined = parts.join('\n\n');
  if (!combined.trim()) throw new Error('No product information provided');

  const context = buildFilterContext(filters);
  const isServiceOffer = productInput.type === 'service';

  const systemPrompt = `You are a B2B/B2C lead generation expert specializing in BUYER-INTENT discovery.

Analyze this offer (software, generator rental, industrial equipment, food, consulting, agency service, or hybrid) and generate a buyer-discovery strategy preview the user will review before scanning.

CORE PRINCIPLE:
- We discover BUYER COMPANIES first via Google Search (procurement, tenders, projects, expansions, operator signals).
- Apollo runs AFTERWARDS only to enrich those discovered companies with decision-maker contacts.
- Apollo is NEVER the primary discovery source for services, rentals, or physical products.
- Google Jobs is a weak fallback signal, not a primary source. Do NOT frame discovery around job postings.

For a diesel generator rental, the plan should be: "Google Search for construction expansion, data-center buildout, hotel openings, telecom rollouts; tender/RFP queries for temporary power; operator and facility pages. Then Apollo enriches the top 30 companies with Procurement, Facilities, and Operations decision-makers."
For DevOps consulting, the plan should be: "Google Search for companies posting about scaling infrastructure, funding rounds, platform-team expansion, migration projects; community pain-point signals. Then Apollo enriches the top 30 companies with CTOs and Heads of Infrastructure."

Return ONLY valid JSON (use \\n for line breaks inside strings):
{
  "promptText": "detailed prompt with sections, line breaks using \\n",
  "productName": "short name",
  "buyerType": "B2B" or "B2C" or "BOTH",
  "isPhysicalProduct": true or false,
  "searchStrategy": "SERP" or "APOLLO" or "BOTH",
  "summary": "one sentence summarizing the buyer-company search approach",
  "suggestedEdits": ["thing user might want to customize 1", "suggestion 2"],
  "buyerIndustries": ["industry 1 likely to need this", "industry 2", "industry 3", "industry 4"],
  "buyerPersonas": ["job title / persona at buyer company 1", "persona 2", "persona 3", "persona 4"],
  "demandSignals": ["signal 1 that indicates a company needs this now", "signal 2", "signal 3", "signal 4"],
  "searchPlan": ["concrete search step 1", "step 2", "step 3", "step 4"],
  "exclusions": ["type of result to exclude (competitors, job boards, aggregators, etc.)", "exclusion 2", "exclusion 3"],
  "expectedQuality": "one-line honest estimate of lead quality and volume given the inputs"
}`;

  const userHint = isServiceOffer
    ? '\n\nNote: this offer was submitted from the SERVICE tab — set searchStrategy to "SERP" and frame the plan as company-first discovery via Google Search, with Apollo as a contact-enrichment layer afterwards.'
    : '';

  const raw = await callOpenAI(
    systemPrompt,
    `Offer:\n\n${combined}${context ? '\n\nDiscovery filters:\n' + context : ''}${userHint}`,
    2000
  );
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);

  if (isServiceOffer) {
    parsed.searchStrategy = 'SERP';
  }
  return parsed;
}

module.exports = { runProductDiscoveryScan, buildProductProfile, generateProductPrompt };


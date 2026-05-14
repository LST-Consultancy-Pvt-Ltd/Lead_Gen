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

  "buyerSignals": [
    "phrase confirming a company NEEDS or USES this product",
    "phrase 2"
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

sellerSignals: phrases that identify COMPETITOR companies to exclude from results`;

async function buildProductProfile(productInput) {
  let urlText = '';
  if (productInput.url) {
    urlText = (await fetchProductPageText(productInput.url)) || '';
  }

  const parts = [
    productInput.url         ? `Product URL: ${productInput.url}`                          : '',
    urlText                  ? `Page content:\n${urlText.slice(0, 1500)}`                  : '',
    productInput.description ? `Description:\n${productInput.description.slice(0, 1500)}`  : '',
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
// STEP 3 — AI batch scoring: BUYER vs SELLER (10 per AI call)
// ─────────────────────────────────────────────────────────────────────────────

async function scoreBatch(leads, profile) {
  if (!leads.length) return leads;

  const list = leads.map((l, i) => {
    const desc = (l._rawDescription || l.description || '').slice(0, 200);
    return `${i + 1}. Name: ${l.companyName} | Industry: ${l.industry || '?'} | Desc: ${desc || 'none'}`;
  }).join('\n');

  const systemPrompt = `Classify each entry as:
  BUYER = actual company that PURCHASES/USES this product
  SELLER = company that SELLS/MAKES this product (competitor)  
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
  const rawLeads    = [];
  const seenNames   = new Set();
  const seenDomains = new Set();

  function tryAdd(lead) {
    if (!lead?.companyName) return false;
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

  // STEP 2: Run the right search strategy
  if (strategy === 'APOLLO') {
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
    productInput.description ? `Description:\n${productInput.description.slice(0, 1500)}`  : '',
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

module.exports = { runProductDiscoveryScan, buildProductProfile, generateProductPrompt };
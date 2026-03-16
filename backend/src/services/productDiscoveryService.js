// /**
//  * productDiscoveryService.js
//  *
//  * Finds leads for a product by:
//  *   - URL: fetches the product page, extracts description, then searches for buyers
//  *   - Document text: parses uploaded brochure/PDF content
//  *   - Plain description: uses as-is
//  *
//  * Returns the same lead shape as discoveryService so processScan can handle it uniformly.
//  */

// const axios = require('axios');
// const config = require('../config');
// const logger = require('../utils/logger');
// const { extractLeadFromSearchResult, callOpenAI } = require('./aiService');

// // ── Fetch & extract product info from a URL ───────────────────────────────────

// async function fetchProductPageText(url) {
//   try {
//     const { data } = await axios.get(url, {
//       timeout: 12000,
//       headers: { 'User-Agent': 'Mozilla/5.0 (compatible; LeadForgeBot/1.0)' },
//       maxContentLength: 500000,
//     });

//     // Strip HTML tags, collapse whitespace
//     const text = data
//       .replace(/<script[\s\S]*?<\/script>/gi, '')
//       .replace(/<style[\s\S]*?<\/style>/gi, '')
//       .replace(/<[^>]+>/g, ' ')
//       .replace(/\s+/g, ' ')
//       .trim()
//       .slice(0, 4000); // Keep first 4k chars for AI

//     return text;
//   } catch (err) {
//     logger.error('productDiscovery: failed to fetch product URL', { url, err: err.message });
//     return null;
//   }
// }

// // ── Use GPT to summarise the product and generate search queries ──────────────

// async function buildProductProfile(input) {
//   // input: { type: 'url'|'document'|'description', content: string, url?: string }
//   let rawText = input.content;

//   if (input.type === 'url' && input.url) {
//     const fetched = await fetchProductPageText(input.url);
//     rawText = fetched || input.content || input.url;
//   }

//   if (!rawText || rawText.trim().length < 10) {
//     throw new Error('Insufficient product information to generate search queries');
//   }

//   const systemPrompt = `You are a B2B lead generation AI. Given a product description, extract:
// 1. What the product does (1–2 sentences)
// 2. The target buyer personas (job titles, roles)
// 3. Industries most likely to buy it
// 4. Problems it solves
// 5. 8–12 specific Google search queries to find companies or people actively seeking this type of product or solution.

// Queries should target: job postings, Reddit/forums complaints, company announcements, and competitor comparisons.
// Return ONLY valid JSON matching this shape:
// {
//   "productSummary": "...",
//   "targetPersonas": ["CTO", "IT Manager", ...],
//   "targetIndustries": ["SaaS", "E-Commerce", ...],
//   "problemsSolved": ["..."],
//   "searchQueries": ["query 1", "query 2", ...]
// }`;

//   const userPrompt = `Product information:\n${rawText.slice(0, 3500)}`;

//   try {
//     const aiResponse = await callOpenAI(systemPrompt, userPrompt, 800);
//     const cleaned = aiResponse.replace(/```json|```/g, '').trim();
//     return JSON.parse(cleaned);
//   } catch (err) {
//     logger.error('productDiscovery: AI profile extraction failed', { err: err.message });
//     // Fallback: basic generic queries
//     return {
//       productSummary: rawText.slice(0, 200),
//       targetPersonas: ['CTO', 'IT Manager', 'VP Engineering'],
//       targetIndustries: [],
//       problemsSolved: [],
//       searchQueries: [
//         `${rawText.slice(0, 60)} alternative`,
//         `${rawText.slice(0, 60)} solution company hiring`,
//         `${rawText.slice(0, 60)} help Reddit`,
//       ],
//     };
//   }
// }

// // ── SerpAPI search (reusable) ─────────────────────────────────────────────────

// async function searchSerpAPI(query) {
//   if (!config.serpapi?.key) {
//     return getMockProductResults(query);
//   }
//   try {
//     const { data } = await axios.get('https://serpapi.com/search', {
//       params: { api_key: config.serpapi.key, q: query, num: 10, engine: 'google' },
//       timeout: 10000,
//     });
//     return data.organic_results || [];
//   } catch (err) {
//     logger.error('productDiscovery: SerpAPI failed', { query, err: err.message });
//     return getMockProductResults(query);
//   }
// }

// // ── Main export ───────────────────────────────────────────────────────────────

// async function runProductDiscoveryScan(job, productInput, filters = {}, progressCallback) {
//   const { targetIndustry, targetRegion } = filters;

//   logger.info('Product discovery scan started', { jobId: job.id, type: productInput.type });

//   // Step 1: Build product profile + queries
//   let profile;
//   try {
//     profile = await buildProductProfile(productInput);
//   } catch (err) {
//     logger.error('productDiscovery: profile build failed', { err: err.message });
//     throw err;
//   }

//   if (progressCallback) await progressCallback(10, 0);

//   // Optionally enrich queries with region/industry
//   const regionSuffix = targetRegion ? ` ${targetRegion}` : '';
//   const industrySuffix = targetIndustry ? ` ${targetIndustry}` : '';
//  const queries = [
//   ...profile.searchQueries.map(q => `${q}${industrySuffix}${regionSuffix}`),
//   // NEW: People searches using target personas
//   ...profile.targetPersonas.slice(0, 3).map(p =>
//     `site:linkedin.com/in "${p}" ${profile.targetIndustries[0] || ''}${regionSuffix}`
//   ),
// ];

//   const allLeads = [];
//   const total = queries.length;

//   for (let i = 0; i < queries.length; i++) {
//     const query = queries[i];
//     const progress = 10 + Math.round(((i + 1) / total) * 85);

//     try {
//       const results = await searchSerpAPI(query);

//       for (const result of results.slice(0, 4)) {
//         // Inject product context so AI can score relevance properly
//         const productContext = {
//           productSummary: profile.productSummary,
//           targetPersonas: profile.targetPersonas,
//           problemsSolved: profile.problemsSolved,
//         };
//         const extracted = await extractLeadFromSearchResult(result, [profile.productSummary], { productContext, ...filters });
//         if (extracted && extracted.relevanceScore > 45) {
//           allLeads.push({
//             ...extracted,
//             sourceUrl: result.link,
//             source: 'Product Discovery / SerpAPI',
//             signalType: 'product_interest',
//           });
//         }
//       }

//       if (progressCallback) await progressCallback(progress, allLeads.length);
//       await new Promise(r => setTimeout(r, 1100));
//     } catch (err) {
//       logger.error('productDiscovery: query failed', { query, err: err.message });
//     }
//   }

//   if (progressCallback) await progressCallback(100, allLeads.length);

//   // Deduplicate by company name
//   const seen = new Set();
//   const deduped = allLeads.filter(l => {
//     const key = l.companyName?.toLowerCase().trim();
//     if (!key || seen.has(key)) return false;
//     seen.add(key);
//     return true;
//   });

//   logger.info('Product discovery scan complete', { jobId: job.id, found: deduped.length });
//   return { leads: deduped, profile };
// }

// function getMockProductResults(query) {
//   return [
//     { title: 'Company A looking for project management solution', link: 'https://reddit.com/r/productivity/123', snippet: 'We are evaluating tools to replace our current workflow management system...' },
//     { title: 'TechStart hiring Product Operations Manager - Indeed', link: 'https://indeed.com/job/456', snippet: 'TechStart is looking for someone to evaluate and implement new SaaS tools for our growing team...' },
//     { title: 'FinCorp announces digital transformation initiative', link: 'https://businesswire.com/fincorp', snippet: 'FinCorp is investing $5M in modernizing their operations stack with best-in-class software solutions...' },
//   ];
// }

// module.exports = { runProductDiscoveryScan, buildProductProfile };


/**
 * productDiscoveryService.js — BUYER-INTENT REWRITE
 *
 * Finds companies that NEED your product (not companies that sell similar products).
 *
 * Strategy:
 *  1. AI analyzes your product → generates buyer personas, pain points, industries
 *  2. Pain-point queries:  "struggling with X", "looking for a solution to X"
 *  3. Competitor comparison queries: companies evaluating alternatives → high buyer intent
 *  4. Job posting queries: companies hiring for roles that USE your product = they need it
 *  5. Technology gap queries: companies using outdated/competing tech → migration opportunity
 *  6. Forum/community queries: people asking for recommendations for exactly your product category
 *  7. Funding signals: recently funded companies investing in new tech = need your product
 */

/**
 * productDiscoveryService.js — BUYER-INTENT REWRITE
 *
 * Finds companies that NEED your product (not companies that sell similar products).
 *
 * Strategy:
 *  1. AI analyzes your product → generates buyer personas, pain points, industries
 *  2. Pain-point queries:  "struggling with X", "looking for a solution to X"
 *  3. Competitor comparison queries: companies evaluating alternatives → high buyer intent
 *  4. Job posting queries: companies hiring for roles that USE your product = they need it
 *  5. Technology gap queries: companies using outdated/competing tech → migration opportunity
 *  6. Forum/community queries: people asking for recommendations for exactly your product category
 *  7. Funding signals: recently funded companies investing in new tech = need your product
 */

const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { extractLeadFromSearchResult, callOpenAI } = require('./aiService');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ── Fetch & strip product page ────────────────────────────────────────────────

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
    logger.error('productDiscovery: fetch failed', { url, err: err.message });
    return null;
  }
}

// ── AI: build product profile + buyer-intent queries ─────────────────────────

async function buildProductProfile(input) {
  let rawText = input.content;
  if (input.type === 'url' && input.url) {
    rawText = (await fetchProductPageText(input.url)) || input.content || input.url;
  }
  if (!rawText || rawText.trim().length < 10) {
    throw new Error('Insufficient product information');
  }

  const systemPrompt = `You are a B2B lead generation expert. Analyze this product and generate search queries to find companies that NEED this product — not companies that sell it.

Return ONLY valid JSON:
{
  "productSummary": "1-2 sentence description",
  "category": "what category of software/service this is",
  "targetPersonas": ["CTO", "VP Engineering", "IT Manager", ...],
  "targetIndustries": ["SaaS", "E-Commerce", "Manufacturing", ...],
  "problemsSolved": ["problem 1", "problem 2", ...],
  "competitorProducts": ["Competitor A", "Competitor B", ...],
  "buyerIntentQueries": [
    "companies struggling with [pain point]",
    "\"looking for\" [product category] solution",
    "[competitor] alternative company",
    "site:reddit.com [problem they face] help",
    "[role that uses product] job posting company",
    "company replacing [old technology]",
    "[industry] company needs [capability]",
    "site:crunchbase.com [industry] funded 2024",
    ...12-18 total queries
  ],
  "rolesThatUseProduct": ["NetSuite Admin", "Salesforce Developer", ...]
}`;

  try {
    const aiResponse = await callOpenAI(systemPrompt, `Product:\n${rawText.slice(0, 3500)}`, 1000);
    const cleaned = aiResponse.replace(/```json|```/g, '').trim();
    return JSON.parse(cleaned);
  } catch (err) {
    logger.error('productDiscovery: AI profile failed', { err: err.message });
    return {
      productSummary: rawText.slice(0, 200),
      category: 'business software',
      targetPersonas: ['CTO', 'IT Manager', 'VP Engineering', 'Operations Manager'],
      targetIndustries: ['SaaS', 'Technology', 'Retail', 'Finance'],
      problemsSolved: [],
      competitorProducts: [],
      buyerIntentQueries: [
        `${rawText.slice(0, 50)} alternative company`,
        `"looking for" ${rawText.slice(0, 40)} solution`,
        `${rawText.slice(0, 40)} help site:reddit.com`,
      ],
      rolesThatUseProduct: [],
    };
  }
}

// ── SerpAPI organic ───────────────────────────────────────────────────────────

async function searchSerpAPI(query) {
  if (!config.serpapi?.key) return getMockProductResults(query);
  try {
    const { data } = await axios.get('https://serpapi.com/search', {
      params: { api_key: config.serpapi.key, q: query, num: 10, engine: 'google' },
      timeout: 10000,
    });
    return data.organic_results || [];
  } catch (err) {
    logger.error('productDiscovery: SerpAPI failed', { query, err: err.message });
    return getMockProductResults(query);
  }
}

// ── Google Jobs for roles that USE the product (hiring = they need it) ────────
// (defined below near the end of file as searchGoogleJobsForProduct + searchGoogleJobsAllPagesProduct)

function jobToProductLead(jr, profile) {
  if (!jr.company_name) return null;
  const postedAt = jr.detected_extensions?.posted_at || '';
  return {
    companyName: jr.company_name,
    website: '',
    industry: '',
    location: jr.location || '',
    companySize: '',
    signalType: 'hiring',
    signalText: `Hiring "${jr.title}" — indicates active use/need of ${profile.productSummary?.slice(0, 80)}`,
    confidence: 85,
    relevanceScore: 78,
    contactName: null, contactTitle: null,
    contactLinkedin: null, companyLinkedinUrl: null,
    jobPostings: [{
      title: jr.title,
      url: jr.apply_options?.[0]?.link || '',
      snippet: (jr.description || '').slice(0, 200),
      postedAt,
      platform: jr.via || '',
    }],
    source: `Product Discovery — Job Signal (${jr.via || 'Job Board'})`,
    sourceUrl: jr.apply_options?.[0]?.link || '',
    signalType: 'product_interest',
    _isJobLead: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scan
// ─────────────────────────────────────────────────────────────────────────────

async function runProductDiscoveryScan(job, productInput, filters = {}, progressCallback) {
  const { targetIndustry = '', targetRegion = '' } = filters;
  const regionSuffix   = targetRegion   ? ` ${targetRegion}`   : '';
  const industrySuffix = targetIndustry ? ` ${targetIndustry}` : '';

  logger.info('Product discovery scan started', { jobId: job.id, type: productInput.type });

  // Step 1: Build product profile
  let profile;
  try {
    profile = await buildProductProfile(productInput);
  } catch (err) {
    logger.error('productDiscovery: profile build failed', { err: err.message });
    throw err;
  }

  if (progressCallback) await progressCallback(5, 0);

  // Step 2: Build full query set
  const allQueries = [
    // AI-generated buyer-intent queries (enriched with filters)
    ...profile.buyerIntentQueries.map(q => `${q}${industrySuffix}${regionSuffix}`),

    // Competitor comparison (highest buyer intent — actively evaluating)
    ...(profile.competitorProducts || []).slice(0, 3).flatMap(comp => [
      `"${comp}" alternative${industrySuffix}${regionSuffix}`,
      `"vs ${comp}" company${industrySuffix}${regionSuffix}`,
      `"${comp}" vs "${profile.category || 'alternative'}"${regionSuffix}`,
    ]),

    // Communities asking for solutions (Reddit/forums)
    ...(profile.problemsSolved || []).slice(0, 3).flatMap(problem => [
      `"${problem}" solution site:reddit.com`,
      `"${problem}" help site:reddit.com`,
    ]),

    // Funded companies (investment = budget to buy new products)
    `site:crunchbase.com ${profile.category || ''}${industrySuffix} funded${regionSuffix}`,
    `${profile.category || ''} company "raised" "series A" OR "series B"${industrySuffix}${regionSuffix}`,

    // LinkedIn personas (decision-makers at target companies)
    ...profile.targetPersonas.slice(0, 2).map(p =>
      `site:linkedin.com/in "${p}"${industrySuffix}${regionSuffix}`
    ),
  ];

  const allLeads    = [];
  const seenNames   = new Set();
  const seenDomains = new Set();

  function tryAddLead(lead) {
    if (!lead?.companyName) return false;
    const nk = lead.companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const dk = (lead.website || '').replace('www.', '').split('/')[0].toLowerCase();
    if (!nk || seenNames.has(nk)) return false;
    if (dk && seenDomains.has(dk)) return false;
    seenNames.add(nk);
    if (dk) seenDomains.add(dk);
    allLeads.push(lead);
    return true;
  }

  const totalSteps = allQueries.length + (profile.rolesThatUseProduct?.length || 0) * 2 + 2;
  let step = 0;

  async function tick(label) {
    step++;
    const pct = 5 + Math.min(85, Math.round((step / totalSteps) * 85));
    if (progressCallback) await progressCallback(pct, allLeads.length);
  }

  // Phase A: Buyer-intent organic queries
  for (const query of allQueries) {
    const results = await searchSerpAPI(query);
    for (const result of results.slice(0, 6)) {
      const productContext = {
        productSummary: profile.productSummary,
        targetPersonas: profile.targetPersonas,
        problemsSolved: profile.problemsSolved,
      };
      const extracted = await extractLeadFromSearchResult(
        result, [profile.productSummary || profile.category], { productContext, ...filters }
      );
      if (extracted && extracted.relevanceScore > 40) {
        tryAddLead({ ...extracted, sourceUrl: result.link, source: 'Product Discovery', signalType: 'product_interest' });
      }
      await sleep(150);
    }
    await tick(`Organic: ${query.slice(0, 45)}`);
    await sleep(900);
  }

  // Phase B: Google Jobs for roles that USE the product
  for (const role of (profile.rolesThatUseProduct || []).slice(0, 4)) {
    const jobResults = await searchGoogleJobsAllPagesProduct(`${role}${industrySuffix}${regionSuffix}`, 3);
    logger.info('Product Jobs results', { role, count: jobResults.length });
    for (const jr of jobResults) {
      const lead = jobToProductLead(jr, profile);
      if (lead) tryAddLead(lead);
    }
    await tick(`Jobs for role: ${role}`);
    await sleep(500);
  }

  if (progressCallback) await progressCallback(100, allLeads.length);

  logger.info('Product discovery scan complete', { jobId: job.id, found: allLeads.length });
  return { leads: allLeads, profile };
}

async function searchGoogleJobsForProduct(query, nextPageToken = null) {
  if (!config.serpapi?.key) return { results: getMockJobsForProduct(query), nextToken: null };
  try {
    const params = {
      api_key: config.serpapi.key,
      engine:  'google_jobs',
      q:       query,
      hl:      'en',
    };
    if (nextPageToken) params.next_page_token = nextPageToken;

    const { data } = await axios.get('https://serpapi.com/search', { params, timeout: 15000 });
    return {
      results:   data.jobs_results || [],
      nextToken: data.serpapi_pagination?.next_page_token || null,
    };
  } catch (err) {
    logger.error('productDiscovery: Jobs search failed', { query, err: err.message });
    return { results: [], nextToken: null };
  }
}

async function searchGoogleJobsAllPagesProduct(query, maxPages = 3) {
  if (!config.serpapi?.key) return getMockJobsForProduct(query);
  const allResults = [];
  let token = null;
  for (let page = 0; page < maxPages; page++) {
    const { results, nextToken } = await searchGoogleJobsForProduct(query, token);
    allResults.push(...results);
    token = nextToken;
    if (!token || results.length === 0) break;
    await new Promise(r => setTimeout(r, 700));
  }
  return allResults;
}

function getMockProductResults(query) {
  return [
    { title: 'Company evaluating project management software alternatives', link: 'https://reddit.com/r/productivity/123', snippet: 'We are a 150-person SaaS company currently using spreadsheets and looking to upgrade to a proper solution. Budget approved for Q1.' },
    { title: 'TechStart hiring Operations Manager to implement new SaaS tools', link: 'https://indeed.com/job/456', snippet: 'TechStart (techstart.io) is evaluating and rolling out new workflow tools for our growing team of 200+. linkedin.com/company/techstart' },
    { title: 'FinCorp announces $5M digital transformation for operations stack', link: 'https://businesswire.com/fincorp', snippet: 'FinCorp (fincorp.io) is investing in best-in-class software solutions. CTO linkedin.com/in/fincorp-cto leads initiative.' },
  ];
}

function getMockJobsForProduct(query) {
  return [
    { company_name: 'MegaCorp Ltd', location: 'New York, NY', title: query, via: 'LinkedIn', description: 'We need an experienced professional to administer and optimize our current tech stack.', detected_extensions: { posted_at: '1 day ago', schedule_type: 'Full-time' }, apply_options: [{ link: 'https://linkedin.com/jobs/megacorp' }] },
    { company_name: 'StartupXYZ', location: 'San Francisco, CA', title: query, via: 'Indeed', description: 'Fast-growing startup needs someone to own our operations tools and integrations.', detected_extensions: { posted_at: '3 days ago', schedule_type: 'Contract', work_from_home: true }, apply_options: [{ link: 'https://indeed.com/startupxyz' }] },
  ];
}

module.exports = { runProductDiscoveryScan, buildProductProfile };
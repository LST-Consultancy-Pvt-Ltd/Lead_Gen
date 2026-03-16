// /**
//  * discoveryService.js  —  REWRITTEN FOR VOLUME
//  *
//  * Goal: generate 100-1000 leads per service/position per scan.
//  *
//  * Key changes vs old version:
//  *  - 30+ distinct query patterns per service (not just 1 per source)
//  *  - Every query runs separately so we get fresh 10 results each time
//  *  - Dedup by BOTH company name AND domain (catches same company listed twice)
//  *  - Relevance threshold lowered to 40 to capture more leads
//  *  - Rate limit 700ms between calls (SerpAPI allows ~1.5 req/s on paid plans)
//  *  - NO SignalHire / Apollo during scan — contact enrichment is manual on lead page
//  */

// const axios  = require('axios');
// const config = require('../config');
// const logger = require('../utils/logger');
// const { extractLeadFromSearchResult } = require('./aiService');

// // ─────────────────────────────────────────────────────────────────────────────
// // Build query list
// // Each service gets 30+ patterns covering: job boards, LinkedIn, Crunchbase,
// // Reddit, GitHub, news, funding, AngelList, direct hiring signals
// // ─────────────────────────────────────────────────────────────────────────────

// function buildAllQueries(services, filters = {}) {
//   const {
//     targetIndustry = '',
//     targetRegion   = '',
//     workTypes      = [],
//     sources        = [],
//   } = filters;

//   const ind = targetIndustry ? ` ${targetIndustry}` : '';
//   const reg = targetRegion   ? ` ${targetRegion}`   : '';
//   const wt  = workTypes.length
//     ? ` (${workTypes.map(w => w.toLowerCase()).join(' OR ')})`
//     : '';

//   const allQueries = [];

//   for (const svc of services) {
//     const q = [
//       // ── Hiring intent (highest signal) ──
//       `"${svc}" hiring${ind}${reg}${wt}`,
//       `"${svc}" "job opening"${ind}${reg}`,
//       `"${svc}" "we are hiring"${ind}${reg}`,
//       `"${svc}" "open position"${ind}${reg}`,
//       `"${svc}" careers page${ind}${reg}`,
//       `"${svc}" "apply now"${ind}${reg}`,

//       // ── Job boards (volume) ──
//       `"${svc}" site:linkedin.com/jobs${ind}${reg}`,
//       `"${svc}" site:indeed.com${ind}${reg}`,
//       `"${svc}" site:glassdoor.com${ind}${reg}`,
//       `"${svc}" site:dice.com${ind}${reg}`,
//       `"${svc}" site:ziprecruiter.com${ind}${reg}`,
//       `"${svc}" site:monster.com${ind}${reg}`,
//       `"${svc}" site:simplyhired.com${ind}${reg}`,
//       `"${svc}" site:naukri.com${ind}`,       // Asia
//       `"${svc}" site:seek.com.au${ind}`,       // AU/NZ
//       `"${svc}" site:totaljobs.com${ind}`,     // UK

//       // ── LinkedIn company pages ──
//       `site:linkedin.com/company "${svc}"${ind}${reg}`,
//       `"${svc}" company page linkedin.com/company${ind}${reg}`,

//       // ── Decision-maker profiles ──
//       `site:linkedin.com/in "${svc}" (CTO OR CEO OR Founder OR "VP Engineering" OR "Head of IT")${ind}${reg}`,
//       `site:linkedin.com/in "${svc}" (Director OR Manager OR "Head of" OR "VP of" OR "Managing Director")${ind}${reg}`,

//       // ── Funding / growth signals ──
//       `"${svc}" ("series A" OR "series B" OR "series C" OR funding OR raised)${ind}${reg}`,
//       `"${svc}" startup company${ind}${reg}`,
//       `"${svc}" site:crunchbase.com${ind}${reg}`,
//       `"${svc}" site:angel.co${ind}${reg}`,

//       // ── Communities / forums ──
//       `"${svc}" site:reddit.com${ind}`,
//       `"${svc}" (help OR needed OR looking) site:reddit.com`,
//       `"${svc}" implementation OR migration site:reddit.com`,

//       // ── Tech / integration signals ──
//       `company "needs ${svc}"${ind}${reg}`,
//       `"${svc}" implementation project company${ind}${reg}`,
//       `"${svc}" integration company${ind}${reg}`,

//       // ── News & press ──
//       `"${svc}" company "press release"${ind}${reg}`,
//       `"${svc}" announcement company${ind}${reg}`,
//       `"${svc}" site:businesswire.com OR site:prnewswire.com${ind}`,

//       // ── GitHub / dev signals ──
//       `"${svc}" site:github.com company${ind}`,
//     ];
//     allQueries.push(...q);
//   }

//   // If user picked specific sources, filter queries to match those sources
//   if (sources.length > 0) {
//     const sl = sources.map(s => s.toLowerCase());
//     return allQueries.filter(q => {
//       if (sl.some(s => s.includes('linkedin'))   && q.includes('linkedin'))   return true;
//       if (sl.some(s => s.includes('job'))        && (q.includes('indeed') || q.includes('glassdoor') || q.includes('hiring') || q.includes('job') || q.includes('career'))) return true;
//       if (sl.some(s => s.includes('crunchbase')) && q.includes('crunchbase')) return true;
//       if (sl.some(s => s.includes('reddit'))     && q.includes('reddit'))     return true;
//       if (sl.some(s => s.includes('github'))     && q.includes('github'))     return true;
//       if (sl.some(s => s.includes('angel'))      && q.includes('angel'))      return true;
//       if (sl.some(s => s.includes('news') || s.includes('press')) &&
//           (q.includes('announcement') || q.includes('press') || q.includes('businesswire'))) return true;
//       if (sl.some(s => s.includes('tech') || s.includes('built')) &&
//           (q.includes('integration') || q.includes('implementation') || q.includes('github'))) return true;
//       return false;
//     });
//   }

//   return allQueries;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // SerpAPI call
// // ─────────────────────────────────────────────────────────────────────────────

// async function searchSerpAPI(query) {
//   if (!config.serpapi?.key) {
//     return getMockResults();
//   }
//   try {
//     const { data } = await axios.get('https://serpapi.com/search', {
//       params: {
//         api_key: config.serpapi.key,
//         q:       query,
//         num:     10,
//         engine:  'google_jobs',
//       },
//       timeout: 12000,
//     });
//     return data.organic_results || [];
//   } catch (err) {
//     logger.error('SerpAPI failed', { query, err: err.message });
//     return [];
//   }
// }

// function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// // ─────────────────────────────────────────────────────────────────────────────
// // Main scan runner
// // ─────────────────────────────────────────────────────────────────────────────

// async function runDiscoveryScan(job, services, filters = {}, progressCallback) {
//   const allLeads = [];
//   const seenKeys = new Set();   // dedup by normalised name + domain
//   const queries  = buildAllQueries(services, filters);
//   const total    = queries.length;

//   logger.info('Discovery scan START', {
//     jobId: job.id, totalQueries: total, services,
//   });

//   for (let i = 0; i < queries.length; i++) {
//     const query    = queries[i];
//     const progress = Math.round(((i + 1) / total) * 100);

//     try {
//       const results = await searchSerpAPI(query);

//       for (const result of results) {
//         const extracted = await extractLeadFromSearchResult(result, services, filters);
//         if (!extracted) continue;
//         if (extracted.relevanceScore < 40) continue;    // low threshold = more leads

//         // Dedup key: normalised company name OR domain
//         const nameKey   = (extracted.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
//         const domainKey = (extracted.website     || '').toLowerCase()
//           .replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
//         const key = nameKey || domainKey;
//         if (!key || seenKeys.has(key)) continue;
//         seenKeys.add(key);

//         allLeads.push({
//           ...extracted,
//           sourceUrl:   result.link,
//           source:      'SerpAPI / Google',
//           jobPostings: (query.includes('hiring') || query.includes('job') || query.includes('career'))
//             ? [{ title: result.title, url: result.link, snippet: result.snippet }]
//             : [],
//         });
//       }

//       if (progressCallback) await progressCallback(progress, allLeads.length);

//       // Polite delay — SerpAPI paid: 1-2 req/s is safe
//       await sleep(700);
//     } catch (err) {
//       logger.error('Query failed', { query, err: err.message });
//     }
//   }

//   logger.info('Discovery scan DONE', { jobId: job.id, totalLeads: allLeads.length });
//   return allLeads;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Mock data (dev / no API key)
// // ─────────────────────────────────────────────────────────────────────────────

// function getMockResults() {
//   const pool = [
//     { title: 'TechFlow Inc — NetSuite Administrator opening',       link: 'https://linkedin.com/jobs/techflow-123',   snippet: 'TechFlow Inc is hiring a NetSuite Admin. Company: linkedin.com/company/techflow-inc. Website: techflow.io' },
//     { title: 'ShopMatrix raised $20M — expanding ERP team',        link: 'https://techcrunch.com/shopmatrix',        snippet: 'ShopMatrix.io raised $20M Series A. Seeking NetSuite Consultant. linkedin.com/company/shopmatrix CEO Jane Doe.' },
//     { title: 'FinSync seeking NetSuite-Salesforce integration',     link: 'https://reddit.com/r/netsuite/finsync',   snippet: 'FinSync (finsync.io) migrated to NetSuite. CTO: linkedin.com/in/bob-smith-finsync. Need consultant.' },
//     { title: 'GrowthBase hiring NetSuite Analyst — remote OK',      link: 'https://growthbase.io/careers',           snippet: 'GrowthBase.io expanding finance ops. linkedin.com/company/growthbase NetSuite experience required.' },
//     { title: 'CloudNine SaaS — NetSuite Consultant position',       link: 'https://cloudninesaas.com/careers',       snippet: 'CloudNine (cloudninesaas.com) hiring. linkedin.com/company/cloudnine-saas VP Eng: linkedin.com/in/cloudnine-vp' },
//     { title: 'DataSync Corp needs NetSuite Developer immediately',  link: 'https://indeed.com/jobs/datasync',        snippet: 'DataSync Corp (datasync.io) — urgent NetSuite Developer role. linkedin.com/company/datasync-corp' },
//     { title: 'PeakOps looking for NetSuite Consultant worldwide',   link: 'https://glassdoor.com/jobs/peakops',      snippet: 'PeakOps (peakops.com) growing fast. Full-time NetSuite role. linkedin.com/company/peakops' },
//     { title: 'BlueBridge Finance — Series B, ERP setup needed',     link: 'https://angel.co/bluebridge',             snippet: 'BlueBridge raised Series B. Need ERP consultant immediately. linkedin.com/company/bluebridge-finance' },
//     { title: 'NexaCorp announced NetSuite migration project Q1',    link: 'https://businesswire.com/nexacorp',       snippet: 'NexaCorp (nexacorp.com) starting NetSuite rollout. linkedin.com/company/nexacorp CTO: linkedin.com/in/nexacorp-cto' },
//     { title: 'Streamline Ops hiring — NetSuite-Shopify integration', link: 'https://linkedin.com/jobs/streamline',   snippet: 'Streamline Ops (streamlineops.io) needs NetSuite + Shopify integration. linkedin.com/company/streamline-ops' },
//     { title: 'Vertex Retail — NetSuite ERP customisation needed',   link: 'https://vertexretail.com/careers',        snippet: 'Vertex Retail (vertexretail.com) expanding. linkedin.com/company/vertex-retail 200-500 employees.' },
//     { title: 'AlphaLogix seeking NetSuite Consultant — contract',   link: 'https://alphalogix.com/jobs',             snippet: 'AlphaLogix (alphalogix.com) 6-month contract. linkedin.com/company/alphalogix Founder: linkedin.com/in/alphalogix-ceo' },
//   ];
//   const shuffled = pool.sort(() => Math.random() - 0.5);
//   return shuffled.slice(0, Math.floor(Math.random() * 4) + 3);
// }

// module.exports = { runDiscoveryScan };


/**
 * discoveryService.js — BUYER-INTENT REWRITE
 *
 * THE CORE PROBLEM FIXED:
 *   OLD: "NetSuite consultant" hiring → Google organic → returns CONSULTING FIRMS (your competitors)
 *   NEW: Google Jobs engine → returns EMPLOYERS HIRING consultants (your actual buyers/clients)
 *
 * HOW VOLUME 500–1000 IS ACHIEVED:
 *   Phase 1 — Google Jobs engine (primary):
 *     • engine:'google_jobs' returns structured employer data — no AI extraction needed
 *     • Paginated: start=0,10,20,30,40 = 50 results per query variant
 *     • 8 query variants × 5 pages × 10 results = ~400 job-sourced leads per service
 *     • Zero false-positives — every result is a company actively hiring for your service
 *
 *   Phase 2 — Buyer-intent organic search (secondary):
 *     • Queries specifically for NEED signals: "looking for NetSuite consultant",
 *       "NetSuite implementation partner needed", "ERP migration project"
 *     • Funding signals: companies raising money need to implement new systems
 *     • Reddit/forums: companies asking for help with the exact service
 *
 * COMPETITOR FILTERING:
 *   Heuristic removes companies that look like service providers (competitors).
 */













// /**
//  * discoveryService.js — BUYER-INTENT REWRITE
//  *
//  * THE CORE PROBLEM FIXED:
//  *   OLD: "NetSuite consultant" hiring → Google organic → returns CONSULTING FIRMS (your competitors)
//  *   NEW: Google Jobs engine → returns EMPLOYERS HIRING consultants (your actual buyers/clients)
//  *
//  * HOW VOLUME 500–1000 IS ACHIEVED:
//  *   Phase 1 — Google Jobs engine (primary):
//  *     • engine:'google_jobs' returns structured employer data — no AI extraction needed
//  *     • Paginated: start=0,10,20,30,40 = 50 results per query variant
//  *     • 8 query variants × 5 pages × 10 results = ~400 job-sourced leads per service
//  *     • Zero false-positives — every result is a company actively hiring for your service
//  *
//  *   Phase 2 — Buyer-intent organic search (secondary):
//  *     • Queries specifically for NEED signals: "looking for NetSuite consultant",
//  *       "NetSuite implementation partner needed", "ERP migration project"
//  *     • Funding signals: companies raising money need to implement new systems
//  *     • Reddit/forums: companies asking for help with the exact service
//  *
//  * COMPETITOR FILTERING:
//  *   Heuristic removes companies that look like service providers (competitors).
//  */

// const axios  = require('axios');
// const config = require('../config');
// const logger = require('../utils/logger');
// const { extractLeadFromSearchResult } = require('./aiService');

// function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// function nameKey(name = '') {
//   return name.toLowerCase()
//     .replace(/\b(inc|llc|ltd|corp|co|company|group|solutions|services|consulting|technologies|technology|the)\b/g, '')
//     .replace(/[^a-z0-9]/g, '').trim();
// }

// const AGGREGATORS = [
//   'linkedin.com','indeed.com','glassdoor.com','reddit.com','techcrunch.com',
//   'crunchbase.com','github.com','angel.co','angellist.com','naukri.com',
//   'monster.com','twitter.com','x.com','facebook.com','ziprecruiter.com',
//   'simplyhired.com','dice.com','seek.com.au','totaljobs.com','wellfound.com',
//   'builtin.com','lever.co','greenhouse.io','workday.com','myworkdayjobs.com',
// ];

// function extractDomain(url = '') {
//   try {
//     const h = new URL(url).hostname.replace('www.', '');
//     return AGGREGATORS.some(a => h.includes(a)) ? '' : h;
//   } catch { return ''; }
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Phase 1 — Google Jobs engine
// // engine:'google_jobs' returns EMPLOYERS = your buyers
// // ─────────────────────────────────────────────────────────────────────────────

// function buildJobQueryVariants(service, filters = {}) {
//   const { targetRegion = '', targetIndustry = '' } = filters;
//   const reg = targetRegion   ? ` ${targetRegion}`   : '';
//   const ind = targetIndustry ? ` ${targetIndustry}` : '';
//   return [
//     `${service}${ind}${reg}`,
//     `${service} implementation${ind}${reg}`,
//     `${service} administrator${ind}${reg}`,
//     `${service} specialist${ind}${reg}`,
//     `${service} developer${ind}${reg}`,
//     `${service} analyst${ind}${reg}`,
//     `${service} manager${ind}${reg}`,
//     `${service} project${ind}${reg}`,
//   ];
// }

// /**
//  * Fetch one page of Google Jobs results.
//  * First page: no token. Subsequent pages: pass next_page_token from previous response.
//  * NOTE: google_jobs does NOT support `start` — it causes HTTP 400.
//  *       Pagination is done via next_page_token returned in serpapi_pagination.
//  */
// async function fetchGoogleJobsPage(query, nextPageToken = null) {
//   if (!config.serpapi?.key) return { results: getMockJobResults(query), nextToken: null };
//   try {
//     const params = {
//       api_key: config.serpapi.key,
//       engine:  'google_jobs',
//       q:       query,
//       hl:      'en',
//     };
//     if (nextPageToken) params.next_page_token = nextPageToken;

//     const { data } = await axios.get('https://serpapi.com/search', { params, timeout: 15000 });
//     return {
//       results:   data.jobs_results || [],
//       nextToken: data.serpapi_pagination?.next_page_token || null,
//     };
//   } catch (err) {
//     logger.error('Google Jobs search failed', { query, err: err.message });
//     return { results: [], nextToken: null };
//   }
// }

// /**
//  * Fetch up to maxPages of Google Jobs results for a query, following next_page_token.
//  */
// async function searchGoogleJobsAllPages(query, maxPages = 5) {
//   if (!config.serpapi?.key) return getMockJobResults(query);

//   const allResults = [];
//   let token = null;

//   for (let page = 0; page < maxPages; page++) {
//     const { results, nextToken } = await fetchGoogleJobsPage(query, token);
//     allResults.push(...results);
//     token = nextToken;
//     if (!token || results.length === 0) break;
//     await sleep(700); // pace between pages
//   }

//   return allResults;
// }

// function jobResultToLead(jobResult) {
//   const companyName = jobResult.company_name || '';
//   if (!companyName) return null;

//   let website = '';
//   if (jobResult.related_links?.length > 1) {
//     for (const link of jobResult.related_links.slice(1)) {
//       const domain = extractDomain(link.link || '');
//       if (domain) { website = domain; break; }
//     }
//   }

//   const extStr = (jobResult.extensions || []).join(' ').toLowerCase();
//   const isRemote = extStr.includes('remote') || !!jobResult.detected_extensions?.work_from_home;
//   const schedule = jobResult.detected_extensions?.schedule_type || '';
//   const postedAt = jobResult.detected_extensions?.posted_at || '';
//   const isRecent = /hour|today|yesterday|1 day/i.test(postedAt);

//   return {
//     companyName,
//     website,
//     industry: '',
//     location: jobResult.location || '',
//     companySize: '',
//     signalType: 'hiring',
//     signalText: `Actively hiring: "${jobResult.title}" — ${(jobResult.description || '').slice(0, 120)}`,
//     confidence: 90,
//     relevanceScore: isRecent ? 85 : 72,
//     contactName: null,
//     contactTitle: null,
//     contactLinkedin: null,
//     companyLinkedinUrl: null,
//     jobPostings: [{
//       title: jobResult.title,
//       url: jobResult.apply_options?.[0]?.link || jobResult.related_links?.[0]?.link || '',
//       snippet: (jobResult.description || '').slice(0, 200),
//       postedAt,
//       workArrangement: isRemote ? 'Remote' : schedule || 'On-site',
//       platform: jobResult.via || '',
//     }],
//     source: `Google Jobs — ${jobResult.via || 'Job Board'}`,
//     sourceUrl: jobResult.apply_options?.[0]?.link || '',
//     _isJobLead: true,
//   };
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Phase 2 — Buyer-intent organic queries
// // ─────────────────────────────────────────────────────────────────────────────

// function buildBuyerIntentQueries(services, filters = {}) {
//   const { targetIndustry = '', targetRegion = '', workTypes = [] } = filters;
//   const ind = targetIndustry ? ` ${targetIndustry}` : '';
//   const reg = targetRegion   ? ` ${targetRegion}`   : '';
//   const wt  = workTypes.length ? ` (${workTypes.map(w => w.toLowerCase()).join(' OR ')})` : '';
//   const queries = [];

//   for (const svc of services) {
//     queries.push(
//       `"looking for ${svc}"${ind}${reg}`,
//       `"need a ${svc}"${ind}${reg}`,
//       `"seeking ${svc}"${ind}${reg}`,
//       `"${svc} needed" company${ind}${reg}`,
//       `"hire a ${svc}"${ind}${reg}${wt}`,
//       `"${svc} implementation" company project${ind}${reg}`,
//       `"${svc} migration" company${ind}${reg}`,
//       `"${svc} rollout" company${ind}${reg}`,
//       `"${svc} integration" company hiring${ind}${reg}`,
//       `site:linkedin.com/jobs "${svc}"${ind}${reg}${wt}`,
//       `site:indeed.com "${svc}" job${ind}${reg}`,
//       `site:glassdoor.com/Jobs "${svc}"${ind}${reg}`,
//       `"${svc}" help needed site:reddit.com${ind}`,
//       `"${svc}" company ("series A" OR "series B" OR "raised" OR "funding")${ind}${reg}`,
//       `"${svc}" startup "growing team"${ind}${reg}`,
//       `site:linkedin.com/company "${svc}"${ind}${reg}`,
//       `"${svc}" RFP OR "request for proposal"${ind}${reg}`,
//     );
//   }
//   return queries;
// }

// async function searchSerpAPIorganic(query) {
//   if (!config.serpapi?.key) return getMockOrganicResults();
//   try {
//     const { data } = await axios.get('https://serpapi.com/search', {
//       params: { api_key: config.serpapi.key, q: query, num: 10, engine: 'google' },
//       timeout: 12000,
//     });
//     return data.organic_results || [];
//   } catch (err) {
//     logger.error('Organic search failed', { query, err: err.message });
//     return [];
//   }
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Competitor filter — removes service PROVIDERS (your competitors, not buyers)
// // ─────────────────────────────────────────────────────────────────────────────

// const COMPETITOR_SIGNALS = [
//   'consulting firm', 'consultancy', 'staffing agency', 'recruitment agency',
//   'managed services provider', 'implementation partner', 'erp partner',
//   'certified partner', 'value-added reseller', 'var ',
// ];

// function looksLikeCompetitor(lead, services) {
//   const text = `${lead.companyName} ${lead.signalText || ''} ${lead.description || ''}`.toLowerCase();
//   const hasCompetitorWord = COMPETITOR_SIGNALS.some(w => text.includes(w));
//   const serviceTerms = services.map(s => s.toLowerCase());
//   const hasServiceInName = serviceTerms.some(s =>
//     (lead.companyName || '').toLowerCase().includes(s.split(' ')[0])
//   );
//   // Only flag if BOTH signals are present (reduces false positives)
//   return hasServiceInName && hasCompetitorWord;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Main scan runner
// // ─────────────────────────────────────────────────────────────────────────────

// async function runDiscoveryScan(job, services, filters = {}, progressCallback) {
//   const allLeads    = [];
//   const seenNames   = new Set();
//   const seenDomains = new Set();

//   function tryAddLead(lead) {
//     if (!lead?.companyName) return false;
//     const nk = nameKey(lead.companyName);
//     const dk = lead.website ? lead.website.replace('www.', '').split('/')[0].toLowerCase() : '';
//     if (!nk || seenNames.has(nk)) return false;
//     if (dk && seenDomains.has(dk)) return false;
//     if (looksLikeCompetitor(lead, services)) return false;
//     seenNames.add(nk);
//     if (dk) seenDomains.add(dk);
//     allLeads.push(lead);
//     return true;
//   }

//   let step = 0;
//   const jobVariantsPerService = 8;
//   const buyerQueryCount   = services.length * 17;
//   const fundingQueryCount = services.length * 2;
//   // Phase 1: one tick per variant (pagination happens inside searchGoogleJobsAllPages)
//   const totalSteps = services.length * jobVariantsPerService + buyerQueryCount + fundingQueryCount;

//   async function tick(label) {
//     step++;
//     const pct = Math.min(95, Math.round((step / totalSteps) * 100));
//     if (progressCallback) await progressCallback(pct, allLeads.length);
//     logger.debug('Scan progress', { jobId: job.id, pct, label, leads: allLeads.length });
//   }

//   logger.info('Discovery scan START', { jobId: job.id, services, filters });

//   // ══════════════════════════════════════════════════════════════════════════
//   // PHASE 1 — Google Jobs (direct buyer intent)
//   // google_jobs engine returns structured employer data.
//   // Pagination via next_page_token — up to 5 pages per variant = ~50 results each.
//   // Every result = a company ACTIVELY HIRING for your service = your client.
//   // ══════════════════════════════════════════════════════════════════════════

//   for (const svc of services) {
//     const variants = buildJobQueryVariants(svc, filters);
//     for (const variant of variants) {
//       const results = await searchGoogleJobsAllPages(variant, 5);
//       logger.info('Google Jobs results', { variant, count: results.length });
//       for (const jr of results) {
//         const lead = jobResultToLead(jr);
//         if (lead && lead.relevanceScore >= 60) tryAddLead(lead);
//       }
//       await tick(`Jobs: ${variant}`);
//       await sleep(400); // brief pause between variants
//     }
//   }

//   logger.info('Phase 1 done', { jobId: job.id, count: allLeads.length });

//   // ══════════════════════════════════════════════════════════════════════════
//   // PHASE 2 — Buyer-intent organic queries
//   // ══════════════════════════════════════════════════════════════════════════

//   const buyerQueries = buildBuyerIntentQueries(services, filters);
//   for (const query of buyerQueries) {
//     const results = await searchSerpAPIorganic(query);
//     for (const result of results) {
//       const domain = extractDomain(result.link || '');
//       if (!domain) {
//         // Job board result — extract company from title heuristically
//         const m = (result.title || '').match(/^(.+?)\s+(is hiring|seeks|looking for|needs)/i);
//         if (m) {
//           tryAddLead({
//             companyName: m[1].trim(), website: '', industry: '', location: '',
//             companySize: '', signalType: 'hiring',
//             signalText: (result.snippet || '').slice(0, 150),
//             confidence: 65, relevanceScore: 65,
//             contactName: null, contactTitle: null,
//             contactLinkedin: null, companyLinkedinUrl: null,
//             source: 'Job Board Signal', sourceUrl: result.link,
//           });
//         }
//         continue;
//       }
//       // Real company page — use AI
//       const extracted = await extractLeadFromSearchResult(result, services, filters);
//       if (extracted && extracted.relevanceScore >= 45) {
//         tryAddLead({ ...extracted, source: 'Buyer-Intent Search', sourceUrl: result.link });
//       }
//       await sleep(150);
//     }
//     await tick(`Organic: ${query.slice(0, 45)}`);
//     await sleep(700);
//   }

//   logger.info('Phase 2 done', { jobId: job.id, count: allLeads.length });

//   // ══════════════════════════════════════════════════════════════════════════
//   // PHASE 3 — Funding & tech signals (growth = implementation need)
//   // ══════════════════════════════════════════════════════════════════════════

//   const fundingQueries = services.flatMap(svc => [
//     `site:crunchbase.com "${svc}"${filters.targetIndustry ? ` ${filters.targetIndustry}` : ''}`,
//     `"${svc}" company "series A" OR "series B" OR raised${filters.targetRegion ? ` ${filters.targetRegion}` : ''}`,
//   ]);

//   for (const query of fundingQueries) {
//     const results = await searchSerpAPIorganic(query);
//     for (const result of results.slice(0, 5)) {
//       const extracted = await extractLeadFromSearchResult(result, services, filters);
//       if (extracted && extracted.relevanceScore >= 50) {
//         tryAddLead({ ...extracted, source: 'Funding Signal', sourceUrl: result.link, signalType: 'funding' });
//       }
//       await sleep(150);
//     }
//     await tick(`Funding: ${query.slice(0, 40)}`);
//     await sleep(600);
//   }

//   if (progressCallback) await progressCallback(100, allLeads.length);

//   logger.info('Discovery scan DONE', {
//     jobId: job.id, total: allLeads.length,
//     jobSourced: allLeads.filter(l => l._isJobLead).length,
//     organicSourced: allLeads.filter(l => !l._isJobLead).length,
//   });

//   return allLeads;
// }

// // ─────────────────────────────────────────────────────────────────────────────
// // Mock data (dev / no API key)
// // ─────────────────────────────────────────────────────────────────────────────

// function getMockJobResults(query) {
//   return [
//     { company_name: 'TechFlow Inc',       location: 'New York, NY',     title: query, via: 'LinkedIn',     description: 'We are seeking an experienced consultant to join our operations team. Must have 3+ years implementing ERP systems for mid-market companies.', detected_extensions: { posted_at: '2 days ago', schedule_type: 'Full-time' }, apply_options: [{ link: 'https://linkedin.com/jobs/techflow-123' }] },
//     { company_name: 'ShopMatrix Ltd',     location: 'London, UK',       title: query, via: 'Indeed',       description: 'Growing e-commerce company (Series B) building out our finance team. Need an experienced professional to own the implementation project.', detected_extensions: { posted_at: '1 day ago', schedule_type: 'Contract', work_from_home: true }, apply_options: [{ link: 'https://indeed.com/shopmatrix' }] },
//     { company_name: 'FinSync Corp',       location: 'Chicago, IL',      title: query, via: 'Glassdoor',    description: 'FinSync is expanding our IT department. We need someone to manage and optimize our current system. Competitive package for the right candidate.', detected_extensions: { posted_at: '5 days ago', schedule_type: 'Full-time' }, apply_options: [{ link: 'https://glassdoor.com/finsync' }] },
//     { company_name: 'GrowthBase Inc',     location: 'Austin, TX',       title: query, via: 'ZipRecruiter', description: 'Fast-growing SaaS company needs consultant for 6-month project. Implementation experience essential. Budget approved, looking to hire ASAP.', detected_extensions: { posted_at: '3 hours ago', schedule_type: 'Contract' }, apply_options: [{ link: 'https://ziprecruiter.com/growthbase' }] },
//     { company_name: 'BlueBridge Finance', location: 'Toronto, Canada',  title: query, via: 'LinkedIn',     description: 'Post-Series A fintech scaling our operations. Looking for a consultant who has done full-cycle rollouts for financial services companies.', detected_extensions: { posted_at: 'Today', schedule_type: 'Full-time', work_from_home: true }, apply_options: [{ link: 'https://linkedin.com/jobs/bluebridge' }] },
//     { company_name: 'Vertex Retail',      location: 'Los Angeles, CA',  title: query, via: 'Indeed',       description: 'Retail chain with 50+ locations modernizing back-office systems. This role leads the full implementation lifecycle across all sites.', detected_extensions: { posted_at: '1 week ago', schedule_type: 'Full-time' }, apply_options: [{ link: 'https://indeed.com/vertex' }] },
//     { company_name: 'NexaCorp',           location: 'Sydney, Australia', title: query, via: 'SEEK',        description: 'NexaCorp announced our digital transformation Q1. Need experienced professional for migration project. Contract-to-perm available.', detected_extensions: { posted_at: '2 days ago', schedule_type: 'Contract' }, apply_options: [{ link: 'https://seek.com.au/nexacorp' }] },
//     { company_name: 'DataSync Corp',      location: 'Boston, MA',       title: query, via: 'Dice',         description: 'Technology company requiring immediate assistance. Strong integration and API skills needed. Urgent requirement.', detected_extensions: { posted_at: '6 hours ago', schedule_type: 'Full-time' }, apply_options: [{ link: 'https://dice.com/datasync' }] },
//     { company_name: 'AlphaLogix',         location: 'Dublin, Ireland',  title: query, via: 'LinkedIn',     description: 'Rapidly scaling startup. 6-month contract to permanent. Founder has signed off on this hire as highest priority for Q1.', detected_extensions: { posted_at: '4 days ago', schedule_type: 'Contract', work_from_home: true }, apply_options: [{ link: 'https://linkedin.com/jobs/alphalogix' }] },
//     { company_name: 'PeakOps Global',     location: 'Singapore',        title: query, via: 'JobStreet',    description: 'Global operations company. Must be available for occasional travel across APAC. Full-time permanent with relocation assistance.', detected_extensions: { posted_at: '3 days ago', schedule_type: 'Full-time' }, apply_options: [{ link: 'https://jobstreet.com/peakops' }] },
//   ].sort(() => Math.random() - 0.5).slice(0, 6);
// }

// function getMockOrganicResults() {
//   return [
//     { title: 'TechStart Inc needs NetSuite Administrator urgently', link: 'https://techstart.io/careers', snippet: 'TechStart Inc (techstart.io) seeking experienced ERP specialist for immediate start. linkedin.com/company/techstart-inc. 200+ employees, Series A funded.' },
//     { title: 'CloudNine SaaS looking for implementation partner', link: 'https://cloudninesaas.com/blog/erp', snippet: 'CloudNine (cloudninesaas.com) is running an ERP rollout project. linkedin.com/company/cloudnine CTO: linkedin.com/in/cloudnine-cto leads the project.' },
//   ];
// }

// module.exports = { runDiscoveryScan };


/**
 * discoveryService.js — APOLLO-POWERED LEAD DISCOVERY
 *
 * WHY APOLLO INSTEAD OF SERPAPI:
 *   SerpAPI scrapes Google → gets blogs, news, competitor sites → needs AI to extract data
 *   Apollo has 275M+ people & 73M+ companies in a structured database → returns clean data directly
 *
 * HOW WE FIND BUYERS (not competitors):
 *   When you enter "NetSuite Consultant" we search Apollo for:
 *     1. PEOPLE with titles like "NetSuite Administrator", "NetSuite Developer" at companies
 *        → These people WORK at companies that USE NetSuite → those companies need your services
 *     2. ORGANIZATIONS that use NetSuite in their tech stack
 *        → Companies running NetSuite often need consultants to customize/integrate it
 *     3. DECISION MAKERS (CTO, IT Director, VP Engineering) at companies in target industries
 *        → People who would actually hire your service
 *
 * VOLUME: Apollo allows 50 results per page, up to 10 pages = 500 per query variant
 *         Multiple variants = 500–1000+ leads per scan
 *
 * DATA QUALITY: Every result already has company name, domain, industry, size, location
 *               + contact name, title — no AI extraction needed at all
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Normalise company name for dedup
function nameKey(name = '') {
  return name.toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|co|company|group|solutions|services|consulting|technologies|technology|the)\b/g, '')
    .replace(/[^a-z0-9]/g, '').trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// Apollo API helpers
// ─────────────────────────────────────────────────────────────────────────────

const APOLLO_BASE = 'https://api.apollo.io/v1';

/**
 * Apollo People Search
 * Finds people by job title, company size, industry, geography.
 * Each result includes the person's organization — that organization is your lead.
 *
 * Docs: https://apolloio.github.io/apollo-api-docs/?shell#people-search
 */
async function apolloPeopleSearch(params, page = 1) {
  if (!config.apollo?.apiKey) return getMockPeopleResults();
  try {
    const { data } = await axios.post(
      `${APOLLO_BASE}/mixed_people/search`,
      { page, per_page: 50, ...params },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': config.apollo.apiKey,
        },
        timeout: 20000,
      }
    );
    return {
      people:     data.people     || [],
      totalPages: data.pagination?.total_pages || 1,
      totalCount: data.pagination?.total_entries || 0,
    };
  } catch (err) {
    // Apollo returns 422 if query params are invalid — log clearly
    const detail = err.response?.data?.error || err.response?.data?.message || err.message;
    logger.error('Apollo people search failed', { params, page, err: detail });
    return { people: [], totalPages: 0, totalCount: 0 };
  }
}

/**
 * Apollo Organization Search
 * Finds companies directly by keyword, industry, tech stack, size.
 *
 * Docs: https://apolloio.github.io/apollo-api-docs/?shell#organization-search
 */
async function apolloOrgSearch(params, page = 1) {
  if (!config.apollo?.apiKey) return getMockOrgResults();
  try {
    const { data } = await axios.post(
      `${APOLLO_BASE}/mixed_companies/search`,
      { page, per_page: 50, ...params },
      {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache',
          'X-Api-Key': config.apollo.apiKey,
        },
        timeout: 20000,
      }
    );
    return {
      organizations: data.organizations || [],
      totalPages:    data.pagination?.total_pages || 1,
      totalCount:    data.pagination?.total_entries || 0,
    };
  } catch (err) {
    const detail = err.response?.data?.error || err.response?.data?.message || err.message;
    logger.error('Apollo org search failed', { params, page, err: detail });
    return { organizations: [], totalPages: 0, totalCount: 0 };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert Apollo service/position name → search parameters
//
// "NetSuite Consultant" entered by user means:
//   - Search for people TITLED NetSuite Administrator/Developer/Manager
//     (they work at companies that USE NetSuite → those companies are your buyers)
//   - Search for companies with NetSuite in their tech stack
//   - Search for decision-makers at companies in ERP-related industries
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Given a service like "NetSuite Consultant", build the Apollo job titles to search.
 * We search for people who USE this technology at their company
 * (not people who PROVIDE the service — that would be competitors).
 */
function buildUserTitlesFromService(service) {
  const s = service.toLowerCase();

  // ERP / NetSuite specific
  if (s.includes('netsuite')) return [
    'NetSuite Administrator', 'NetSuite Developer', 'NetSuite Analyst',
    'ERP Manager', 'ERP Administrator', 'ERP Analyst',
    'Finance Systems Manager', 'Business Systems Manager',
    'IT Director', 'CTO', 'VP Finance', 'CFO',
  ];

  if (s.includes('salesforce')) return [
    'Salesforce Administrator', 'Salesforce Developer', 'Salesforce Analyst',
    'CRM Manager', 'CRM Administrator', 'Revenue Operations Manager',
    'VP Sales', 'Sales Operations Manager', 'IT Director',
  ];

  if (s.includes('sap')) return [
    'SAP Administrator', 'SAP Analyst', 'SAP Developer',
    'ERP Manager', 'IT Director', 'Business Systems Director',
    'CTO', 'VP Technology',
  ];

  if (s.includes('shopify') || s.includes('ecommerce') || s.includes('e-commerce')) return [
    'E-Commerce Manager', 'Shopify Developer', 'Digital Commerce Manager',
    'Head of E-Commerce', 'VP E-Commerce', 'Director of Digital',
  ];

  if (s.includes('aws') || s.includes('cloud') || s.includes('devops')) return [
    'DevOps Engineer', 'Cloud Architect', 'Infrastructure Manager',
    'VP Engineering', 'CTO', 'Head of Infrastructure',
  ];

  if (s.includes('data') || s.includes('analytics') || s.includes('bi') || s.includes('power bi')) return [
    'Data Analyst', 'BI Manager', 'Head of Data', 'Data Engineer',
    'VP Analytics', 'Chief Data Officer', 'Analytics Manager',
  ];

  if (s.includes('quickbooks') || s.includes('accounting')) return [
    'Finance Manager', 'Controller', 'CFO', 'Accounting Manager',
    'VP Finance', 'Finance Director',
  ];

  // Generic fallback — target decision-makers + users of the technology
  const keyword = service.split(' ')[0]; // first word e.g. "NetSuite" from "NetSuite Consultant"
  return [
    `${keyword} Administrator`,
    `${keyword} Manager`,
    `${keyword} Developer`,
    'IT Director',
    'CTO',
    'VP Engineering',
    'Head of IT',
    'IT Manager',
  ];
}

/**
 * Build Apollo organization search params from a service name.
 * Finds companies by keyword tags + technology stack.
 */
function buildOrgSearchParams(service, filters = {}) {
  const { targetIndustry = '', targetRegion = '' } = filters;
  const s = service.toLowerCase();

  const params = {};

  // Map service to Apollo keyword tags
  if (s.includes('netsuite'))  params.q_organization_keyword_tags = ['netsuite', 'erp'];
  else if (s.includes('salesforce')) params.q_organization_keyword_tags = ['salesforce', 'crm'];
  else if (s.includes('sap'))  params.q_organization_keyword_tags = ['sap', 'erp'];
  else if (s.includes('shopify')) params.q_organization_keyword_tags = ['shopify', 'ecommerce'];
  else if (s.includes('aws') || s.includes('cloud')) params.q_organization_keyword_tags = ['aws', 'cloud'];
  else params.q_organization_keyword_tags = [service.split(' ')[0].toLowerCase()];

  // Industry filter
  if (targetIndustry) {
    params.organization_industry_tag_ids = [targetIndustry];
  }

  // Region/country filter — Apollo uses country codes
  if (targetRegion) {
    const regionMap = {
      'usa': 'US', 'us': 'US', 'united states': 'US', 'america': 'US',
      'uk': 'GB', 'united kingdom': 'GB', 'england': 'GB',
      'india': 'IN', 'canada': 'CA', 'australia': 'AU',
      'germany': 'DE', 'france': 'FR', 'singapore': 'SG',
    };
    const code = regionMap[targetRegion.toLowerCase()];
    if (code) params.organization_locations = [code];
  }

  return params;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert Apollo person result → lead object
// ─────────────────────────────────────────────────────────────────────────────

function personToLead(person, service) {
  const org = person.organization || person.employment_history?.[0] || {};

  const companyName = org.name || person.organization_name || '';
  if (!companyName) return null;

  // Extract domain — prefer org.website_url, fallback to org.primary_domain
  let website = org.website_url || org.primary_domain || '';
  if (website) {
    website = website.replace(/^https?:\/\//, '').replace('www.', '').split('/')[0];
  }

  const contactName  = [person.first_name, person.last_name].filter(Boolean).join(' ') || null;
  const contactTitle = person.title || null;

  // Map Apollo employee_count to readable size
  const empCount = org.estimated_num_employees || 0;
  const companySize = empCount > 10000 ? '10000+' :
                      empCount > 1000  ? '1000-10000' :
                      empCount > 200   ? '200-1000' :
                      empCount > 50    ? '50-200' :
                      empCount > 10    ? '10-50' : '';

  return {
    companyName,
    website,
    industry:        org.industry       || org.keywords?.[0] || '',
    location:        org.city && org.country ? `${org.city}, ${org.country}` : (org.country || ''),
    companySize,
    description:     org.short_description || '',
    techStack:       org.technology_names  || [],
    signalType:      'hiring',
    signalText:      `Has ${contactTitle || 'staff'} managing ${service} — active user company`,
    confidence:      85,
    relevanceScore:  80,
    contactName,
    contactTitle,
    contactEmail:    person.email   || null,
    contactLinkedin: person.linkedin_url || null,
    companyLinkedinUrl: org.linkedin_url || null,
    source:          'Apollo People Search',
    sourceUrl:       org.website_url || `https://www.apollo.io/companies/${org.id || ''}`,
    _fromApollo:     true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert Apollo organization result → lead object
// ─────────────────────────────────────────────────────────────────────────────

function orgToLead(org, service) {
  if (!org.name) return null;

  let website = org.website_url || org.primary_domain || '';
  if (website) {
    website = website.replace(/^https?:\/\//, '').replace('www.', '').split('/')[0];
  }

  const empCount = org.estimated_num_employees || 0;
  const companySize = empCount > 10000 ? '10000+' :
                      empCount > 1000  ? '1000-10000' :
                      empCount > 200   ? '200-1000' :
                      empCount > 50    ? '50-200' :
                      empCount > 10    ? '10-50' : '';

  return {
    companyName:     org.name,
    website,
    industry:        org.industry       || org.keywords?.[0] || '',
    location:        org.city && org.country ? `${org.city}, ${org.country}` : (org.country || ''),
    companySize,
    description:     org.short_description || '',
    techStack:       org.technology_names  || [],
    signalType:      'tech_stack',
    signalText:      `Uses ${service}-related technology — likely needs consulting/support`,
    confidence:      75,
    relevanceScore:  72,
    contactName:     null,
    contactTitle:    null,
    contactEmail:    null,
    contactLinkedin: null,
    companyLinkedinUrl: org.linkedin_url || null,
    source:          'Apollo Organization Search',
    sourceUrl:       org.website_url || `https://www.apollo.io/companies/${org.id || ''}`,
    _fromApollo:     true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scan runner
// ─────────────────────────────────────────────────────────────────────────────

async function runDiscoveryScan(job, services, filters = {}, progressCallback) {
  const allLeads    = [];
  const seenNames   = new Set();
  const seenDomains = new Set();

  function tryAddLead(lead) {
    if (!lead?.companyName) return false;
    const nk = nameKey(lead.companyName);
    const dk = lead.website ? lead.website.toLowerCase() : '';
    if (!nk || seenNames.has(nk)) return false;
    if (dk && seenDomains.has(dk)) return false;
    seenNames.add(nk);
    if (dk) seenDomains.add(dk);
    allLeads.push(lead);
    return true;
  }

  // Progress tracking
  // Per service: 3 people-search variants (3 pages each) + 1 org search (3 pages)
  // = (3 × 3) + 3 = 12 ticks per service
  const ticksPerService = 12;
  const totalTicks = services.length * ticksPerService;
  let tick = 0;

  async function progress(label) {
    tick++;
    const pct = Math.min(95, Math.round((tick / totalTicks) * 100));
    if (progressCallback) await progressCallback(pct, allLeads.length);
    logger.debug('Scan progress', { jobId: job.id, pct, label, leads: allLeads.length });
  }

  logger.info('Apollo discovery scan START', { jobId: job.id, services, filters });

  for (const svc of services) {
    const userTitles = buildUserTitlesFromService(svc);
    const orgParams  = buildOrgSearchParams(svc, filters);

    // Build people-search filter base
    const peopleBase = {};
    if (filters.targetRegion) {
      const regionMap = {
        'usa': 'US', 'us': 'US', 'united states': 'US',
        'uk': 'GB', 'united kingdom': 'GB',
        'india': 'IN', 'canada': 'CA', 'australia': 'AU',
        'germany': 'DE', 'france': 'FR', 'singapore': 'SG',
      };
      const code = regionMap[filters.targetRegion.toLowerCase()];
      if (code) peopleBase.person_locations = [code];
    }
    if (filters.targetIndustry) {
      peopleBase.organization_industry_tag_ids = [filters.targetIndustry];
    }

    // ── PHASE A: People search ───────────────────────────────────────────────
    // Split titles into 3 groups of 4 to get diverse results
    const titleChunks = [
      userTitles.slice(0, 4),
      userTitles.slice(4, 8),
      userTitles.slice(8),
    ].filter(chunk => chunk.length > 0);

    for (const titleGroup of titleChunks) {
      // Fetch 3 pages per title group = 150 people = up to 150 companies
      const maxPages = config.apollo?.apiKey ? 3 : 1;

      for (let page = 1; page <= maxPages; page++) {
        const result = await apolloPeopleSearch({
          ...peopleBase,
          person_titles: titleGroup,
        }, page);

        for (const person of result.people) {
          const lead = personToLead(person, svc);
          if (lead) tryAddLead(lead);
        }

        logger.info('People search page done', {
          service: svc, titles: titleGroup, page,
          found: result.people.length, totalLeads: allLeads.length,
        });

        await progress(`People: ${titleGroup[0]} p${page}`);
        await sleep(500); // Apollo rate limit — ~2 req/s on paid plans
      }
    }

    // ── PHASE B: Organization search ─────────────────────────────────────────
    // Finds companies by tech stack / keywords directly
    const maxOrgPages = config.apollo?.apiKey ? 3 : 1;

    for (let page = 1; page <= maxOrgPages; page++) {
      const result = await apolloOrgSearch(orgParams, page);

      for (const org of result.organizations) {
        const lead = orgToLead(org, svc);
        if (lead) tryAddLead(lead);
      }

      logger.info('Org search page done', {
        service: svc, page,
        found: result.organizations.length, totalLeads: allLeads.length,
      });

      await progress(`Orgs: ${svc} p${page}`);
      await sleep(500);
    }
  }

  if (progressCallback) await progressCallback(100, allLeads.length);

  logger.info('Apollo discovery scan DONE', {
    jobId: job.id,
    total: allLeads.length,
    fromPeople: allLeads.filter(l => l.source?.includes('People')).length,
    fromOrgs:   allLeads.filter(l => l.source?.includes('Organization')).length,
  });

  return allLeads;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mock data — used when APOLLO_API_KEY is not set (dev/testing)
// ─────────────────────────────────────────────────────────────────────────────

function getMockPeopleResults() {
  return {
    people: [
      { first_name: 'Sarah', last_name: 'Chen', title: 'NetSuite Administrator', linkedin_url: 'https://linkedin.com/in/schen', email: null, organization: { name: 'TechFlow Inc', website_url: 'techflow.io', industry: 'Software', country: 'US', city: 'New York', estimated_num_employees: 250, linkedin_url: 'https://linkedin.com/company/techflow', short_description: 'SaaS platform for operations' } },
      { first_name: 'James', last_name: 'Patel', title: 'ERP Manager', linkedin_url: 'https://linkedin.com/in/jpatel', email: null, organization: { name: 'ShopMatrix Ltd', website_url: 'shopmatrix.io', industry: 'E-Commerce', country: 'GB', city: 'London', estimated_num_employees: 500, linkedin_url: 'https://linkedin.com/company/shopmatrix', short_description: 'Multi-channel retail platform' } },
      { first_name: 'Priya', last_name: 'Sharma', title: 'IT Director', linkedin_url: 'https://linkedin.com/in/psharma', email: null, organization: { name: 'FinSync Corp', website_url: 'finsync.io', industry: 'Financial Services', country: 'US', city: 'Chicago', estimated_num_employees: 1200, linkedin_url: 'https://linkedin.com/company/finsync', short_description: 'Financial data reconciliation platform' } },
      { first_name: 'Tom', last_name: 'Walker', title: 'NetSuite Developer', linkedin_url: 'https://linkedin.com/in/twalker', email: null, organization: { name: 'GrowthBase Inc', website_url: 'growthbase.io', industry: 'SaaS', country: 'US', city: 'Austin', estimated_num_employees: 180, linkedin_url: 'https://linkedin.com/company/growthbase', short_description: 'Growth analytics for mid-market companies' } },
      { first_name: 'Michelle', last_name: 'Kim', title: 'Finance Systems Manager', linkedin_url: 'https://linkedin.com/in/mkim', email: null, organization: { name: 'BlueBridge Finance', website_url: 'bluebridgefinance.com', industry: 'Financial Services', country: 'CA', city: 'Toronto', estimated_num_employees: 320, linkedin_url: 'https://linkedin.com/company/bluebridge', short_description: 'Investment management platform' } },
    ],
    pagination: { total_pages: 3, total_entries: 120 },
  };
}

function getMockOrgResults() {
  return {
    organizations: [
      { name: 'Vertex Retail', website_url: 'vertexretail.com', industry: 'Retail', country: 'US', city: 'Los Angeles', estimated_num_employees: 800, linkedin_url: 'https://linkedin.com/company/vertex-retail', short_description: 'Omnichannel retail chain with 50+ locations', technology_names: ['NetSuite', 'Shopify'] },
      { name: 'NexaCorp', website_url: 'nexacorp.com', industry: 'Manufacturing', country: 'AU', city: 'Sydney', estimated_num_employees: 600, linkedin_url: 'https://linkedin.com/company/nexacorp', short_description: 'Industrial equipment manufacturer', technology_names: ['NetSuite', 'Salesforce'] },
      { name: 'AlphaLogix', website_url: 'alphalogix.com', industry: 'Technology', country: 'IE', city: 'Dublin', estimated_num_employees: 150, linkedin_url: 'https://linkedin.com/company/alphalogix', short_description: 'Enterprise workflow automation', technology_names: ['NetSuite'] },
    ],
    pagination: { total_pages: 3, total_entries: 90 },
  };
}

module.exports = { runDiscoveryScan };
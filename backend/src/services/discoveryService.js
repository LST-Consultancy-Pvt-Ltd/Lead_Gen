/**
 * discoveryService.js — FULLY DYNAMIC, ZERO STATIC LISTS
 *
 * ONE AI call per service takes whatever the user typed and returns:
 *   - jobTitleVariants       → searched on Google Jobs engine
 *   - staffingPhrases        → phrases in job descriptions that mean a
 *                              staffing agency is posting, not the end client
 *   - competitorNamePhrases  → phrases in company names that mean the company
 *                              IS a service provider (competitor), not a buyer
 *
 * Everything is dynamically generated from the user input.
 * No if/else. No keyword maps. No hardcoded arrays anywhere.
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const { callOpenAI } = require('./aiService');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const TEST_MODE         = process.env.TEST_MODE === 'true';
const TEST_MAX_VARIANTS = 2;
const TEST_MAX_PAGES    = 1;
const TEST_MAX_LEADS    = 10;

function normName(n = '') {
  return n.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}
function normDomain(url = '') {
  return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase().trim();
}

// ─────────────────────────────────────────────────────────────────────────────
// ONE AI call — generates everything needed for the scan dynamically
// ─────────────────────────────────────────────────────────────────────────────

async function buildServiceProfile(service, filters = {}) {
  const context = [
    filters.targetIndustry ? `Target industry: ${filters.targetIndustry}` : '',
    filters.targetRegion   ? `Target region: ${filters.targetRegion}`     : '',
    filters.workTypes?.length ? `Work type preference: ${filters.workTypes.join(', ')}` : '',
  ].filter(Boolean).join('\n');

  const systemPrompt = `You are a B2B lead generation expert.

Given a service or position name, generate everything needed to find companies on Google Jobs that are ACTIVELY HIRING for this role — meaning they are the END CLIENT that NEEDS this service, not companies that provide it.

Return ONLY valid JSON, no markdown:
{
  "jobTitleVariants": [
    "exact job title 1 as it appears on a job posting",
    "exact job title 2",
    "exact job title 3",
    "exact job title 4",
    "exact job title 5",
    "exact job title 6",
    "exact job title 7",
    "exact job title 8"
  ],
  "staffingPhrases": [
    "phrase that appears in a job description when a RECRUITMENT AGENCY is posting on behalf of their client",
    "another phrase"
  ],
  "competitorNamePhrases": [
    "word or phrase in a company NAME that means they PROVIDE this service (competitor), not buy it",
    "another phrase"
  ]
}

Rules:
- jobTitleVariants: exact job titles that appear on job boards when a company needs someone with this skill
  Include: the exact role entered + close variants + related seniority levels + related role names
  Example for "NetSuite Consultant": NetSuite Consultant, NetSuite Administrator, NetSuite Developer, NetSuite Analyst, NetSuite ERP Consultant, NetSuite Implementation Specialist, ERP Analyst NetSuite, NetSuite Business Analyst
  Example for "React Developer": React Developer, Frontend Developer React, React Engineer, Frontend Engineer, JavaScript Developer React, UI Developer React, React.js Developer, Frontend Software Engineer
  Example for "HVAC Technician": HVAC Technician, HVAC Engineer, Heating and Cooling Technician, Air Conditioning Technician, Building Services Engineer, Mechanical Technician HVAC, HVAC Maintenance Technician, Refrigeration and Air Conditioning Engineer

- staffingPhrases: phrases like "our client", "on behalf of our client", "we are a staffing agency", "working with our client" — these mean the job is posted by a recruiter, not the actual hiring company

- competitorNamePhrases: words that appear in company NAMES when the company PROVIDES this service
  Example for "NetSuite Consultant": "netsuite", "erp solutions", "consulting group", "it consulting"
  Example for "React Developer": "software agency", "dev shop", "tech solutions", "it services"
  Example for "HVAC Technician": "hvac services", "cooling solutions", "air conditioning services", "mechanical services"
  Keep these very specific — only words that strongly signal the company IS the service provider`;

  const userPrompt = `Service/position entered: "${service}"
${context}`;

  try {
    const raw     = await callOpenAI(systemPrompt, userPrompt, 700);
    const cleaned = raw.replace(/```json|```/g, '').trim();
    const parsed  = JSON.parse(cleaned);

    logger.info('Service profile built', {
      service,
      variants:    parsed.jobTitleVariants?.length,
      staffing:    parsed.staffingPhrases?.length,
      competitors: parsed.competitorNamePhrases?.length,
    });

    return {
      jobTitleVariants:      parsed.jobTitleVariants      || [service],
      staffingPhrases:       parsed.staffingPhrases       || [],
      competitorNamePhrases: parsed.competitorNamePhrases || [],
    };
  } catch (err) {
    logger.warn('Service profile AI failed — using service name only', { service, err: err.message });
    return {
      jobTitleVariants:      [service],
      staffingPhrases:       [],
      competitorNamePhrases: [],
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter: is this a staffing agency posting, not the end client?
// Uses AI-generated phrases — no static lists
// ─────────────────────────────────────────────────────────────────────────────

function isStaffingAgency(companyName, description, profile) {
  const desc = (description || '').toLowerCase();
  // Check AI-generated staffing phrases against the job description
  return (profile.staffingPhrases || []).some(phrase =>
    desc.includes(phrase.toLowerCase())
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter: is this company a service provider (competitor), not a buyer?
// Uses AI-generated competitor name phrases — no static lists
// ─────────────────────────────────────────────────────────────────────────────

function isCompetitor(companyName, profile) {
  const name = (companyName || '').toLowerCase();
  return (profile.competitorNamePhrases || []).some(phrase =>
    name.includes(phrase.toLowerCase())
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// SerpAPI Google Jobs — fetches one page
// ─────────────────────────────────────────────────────────────────────────────

async function fetchJobsPage(query, filters = {}, nextPageToken = null) {
  if (!config.serpapi?.key) {
    logger.warn('SERPAPI_KEY not set — skipping', { query });
    return { jobs: [], nextToken: null };
  }

  const params = {
    api_key: config.serpapi.key,
    engine:  'google_jobs',
    q:       query,
    hl:      'en',
  };

  if (filters.targetRegion)          params.location = filters.targetRegion;
  if (filters.workTypes?.includes('Remote')) params.ltype = 'Y';
  if (nextPageToken)                 params.next_page_token = nextPageToken;

  try {
    const { data } = await axios.get('https://serpapi.com/search', {
      params,
      timeout: 15000,
    });
    return {
      jobs:      data.jobs_results || [],
      nextToken: data.serpapi_pagination?.next_page_token || null,
    };
  } catch (err) {
    logger.error('Google Jobs fetch failed', {
      query,
      status: err.response?.status,
      err:    err.response?.data?.error || err.message,
    });
    return { jobs: [], nextToken: null };
  }
}

async function fetchAllJobPages(query, filters = {}, maxPages = 5) {
  const all = [];
  let token = null;
  for (let p = 0; p < maxPages; p++) {
    const { jobs, nextToken } = await fetchJobsPage(query, filters, token);
    all.push(...jobs);
    token = nextToken;
    if (!token || jobs.length === 0) break;
    await sleep(600);
  }
  return all;
}

// ─────────────────────────────────────────────────────────────────────────────
// Convert a Google Jobs result → lead shape
// ─────────────────────────────────────────────────────────────────────────────

function jobToLead(jr, service, profile) {
  const companyName = (jr.company_name || '').trim();
  if (!companyName) return null;

  // Skip staffing agencies — AI-generated phrases
  if (isStaffingAgency(companyName, jr.description || '', profile)) return null;

  // Skip competitors — AI-generated name phrases
  if (isCompetitor(companyName, profile)) return null;

  // Extract company's own website from related_links
  const jobBoardHints = [
    'linkedin.com', 'indeed.com', 'glassdoor.com', 'monster.com',
    'ziprecruiter.com', 'dice.com', 'seek.com', 'naukri.com',
    'lever.co', 'greenhouse.io', 'workday.com', 'wellfound.com',
    'jobs.', 'careers.', 'jobstreet.com', 'totaljobs.com', 'reed.co',
  ];

  let website = '';
  for (const link of (jr.related_links || [])) {
    const href = link.link || '';
    const isBoard = jobBoardHints.some(h => href.includes(h));
    if (!isBoard && href.startsWith('http')) {
      website = normDomain(href);
      break;
    }
  }

  const postedAt     = jr.detected_extensions?.posted_at     || '';
  const scheduleType = jr.detected_extensions?.schedule_type || '';
  const isRemote     = !!(jr.detected_extensions?.work_from_home);
  const salary       = jr.detected_extensions?.salary        || '';
  const applyUrl     = jr.apply_options?.[0]?.link           || '';

  const freshScore = /hour|today|just now/i.test(postedAt)  ? 95
                   : /1 day|yesterday/i.test(postedAt)      ? 90
                   : /[2-3] days?/i.test(postedAt)          ? 85
                   : /[4-7] days?|week/i.test(postedAt)     ? 78
                   : 72;

  return {
    companyName,
    website,
    industry:        '',
    location:        jr.location || '',
    companySize:     '',
    description:     '',
    techStack:       [],
    signalType:      'hiring',
    signalText:      `Actively hiring: "${jr.title}" — ${(jr.description || '').slice(0, 160)}`,
    confidence:      92,
    relevanceScore:  freshScore,
    contactName:     null,
    contactTitle:    null,
    contactEmail:    null,
    contactLinkedin: null,
    companyLinkedinUrl: null,
    jobPostings: [{
      title:           jr.title || service,
      url:             applyUrl,
      snippet:         (jr.description || '').slice(0, 300),
      postedAt,
      workArrangement: isRemote ? 'Remote' : scheduleType || 'On-site',
      platform:        jr.via   || '',
      salary,
    }],
    source:    `Google Jobs — ${jr.via || 'Job Board'}`,
    sourceUrl: applyUrl,
    _isJobLead: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scan runner
// ─────────────────────────────────────────────────────────────────────────────

async function runDiscoveryScan(job, services, filters = {}, progressCallback) {
  const allLeads    = [];
  const seenNames   = new Set();
  const seenDomains = new Set();

  function tryAdd(lead) {
    if (!lead?.companyName) return false;
    const nk = normName(lead.companyName);
    const dk = lead.website ? normDomain(lead.website) : '';
    if (!nk || seenNames.has(nk)) return false;
    if (dk && seenDomains.has(dk)) return false;
    seenNames.add(nk);
    if (dk) seenDomains.add(dk);
    allLeads.push(lead);
    return true;
  }

  logger.info('Dynamic service scan START', { jobId: job.id, services });

  let totalTicks  = services.length * 8; // estimated, updated after AI call
  let currentTick = 0;

  async function tick(label) {
    currentTick++;
    const pct = Math.min(98, Math.round((currentTick / totalTicks) * 100));
    if (progressCallback) await progressCallback(pct, allLeads.length);
    logger.debug('Scan tick', { pct, label, leads: allLeads.length });
  }

  for (const service of services) {

    // ── ONE AI call: build full profile for this service ──────────────────
    const profile = await buildServiceProfile(service, filters);

    const allVariants = profile.jobTitleVariants;
    const variants    = TEST_MODE ? allVariants.slice(0, TEST_MAX_VARIANTS) : allVariants;

    totalTicks = (totalTicks - 8) + variants.length;

    logger.info('Searching Google Jobs', { service, variants: variants.length });

    for (const variant of variants) {
      const pages = TEST_MODE ? TEST_MAX_PAGES : 5;
      const jobs  = await fetchAllJobPages(variant, filters, pages);

      logger.info('Jobs fetched', { variant, count: jobs.length });

      for (const jr of jobs) {
        if (TEST_MODE && allLeads.length >= TEST_MAX_LEADS) break;
        const lead = jobToLead(jr, service, profile);
        if (lead && lead.relevanceScore >= 70) tryAdd(lead);
      }

      await tick(variant);
      await sleep(TEST_MODE ? 300 : 700);

      if (TEST_MODE && allLeads.length >= TEST_MAX_LEADS) {
        logger.info('TEST_MODE cap reached', { leads: allLeads.length });
        break;
      }
    }

    if (TEST_MODE && allLeads.length >= TEST_MAX_LEADS) break;
  }

  if (progressCallback) await progressCallback(100, allLeads.length);

  logger.info('Dynamic service scan DONE', { jobId: job.id, total: allLeads.length });
  return allLeads;
}

module.exports = { runDiscoveryScan };
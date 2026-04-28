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

/**
 * Truncate text at a sentence boundary near maxLen.
 * Avoids cutting mid-sentence (the "half sentence" problem).
 */
function truncateAtSentence(text, maxLen = 300) {
  if (!text || text.length <= maxLen) return text;
  // Find the last sentence-ending punctuation within maxLen
  const chunk = text.slice(0, maxLen + 50); // look a bit ahead
  const sentenceEnd = chunk.search(/[.!?]\s/g);
  let cutIdx = -1;
  let lastIdx = 0;
  const regex = /[.!?]\s/g;
  let match;
  while ((match = regex.exec(chunk)) !== null) {
    if (match.index <= maxLen) {
      cutIdx = match.index + 1; // include the punctuation
    }
  }
  if (cutIdx > maxLen * 0.4) return text.slice(0, cutIdx).trim();
  // Fallback: cut at last space before maxLen
  const spaceIdx = text.lastIndexOf(' ', maxLen);
  return (spaceIdx > 0 ? text.slice(0, spaceIdx) : text.slice(0, maxLen)).trim() + '…';
}

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
    filters.companySize    ? `Target company size: ${filters.companySize}` : '',
    filters.companyType    ? `Target company type: ${filters.companyType}` : '',
    filters.revenueRanges?.length ? `Target revenue range: ${filters.revenueRanges.join(', ')}` : '',
    filters.valueProp      ? `Value proposition: ${filters.valueProp}` : '',
    filters.keywords       ? `Keywords / pain points: ${filters.keywords}` : '',
    filters.seniorityLevel ? `Target seniority: ${filters.seniorityLevel}` : '',
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

  // Retry up to 3 times with exponential backoff
  const MAX_RETRIES = 3;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const { data } = await axios.get('https://serpapi.com/search', {
        params,
        timeout: 30000,
      });

      // SerpAPI returns 200 with error field when Google has no results or rate limits
      if (data.error) {
        logger.warn('SerpAPI returned error in response body', {
          query, attempt, error: data.error,
          location: params.location || 'none',
        });

        if (attempt < MAX_RETRIES) {
          const delay = 4000 * attempt + Math.random() * 1000;
          logger.info('Retrying SerpAPI after delay', { query, attempt, delayMs: Math.round(delay) });
          await sleep(delay);

          // On 2nd retry, drop location filter — it may be too restrictive
          if (attempt === 2 && params.location) {
            logger.info('Retrying without location filter', { query, droppedLocation: params.location });
            delete params.location;
          }
          continue;
        }

        return { jobs: [], nextToken: null };
      }

      const jobs = data.jobs_results || [];

      // If 0 results and we have a location filter, retry without it
      if (jobs.length === 0 && attempt < MAX_RETRIES) {
        logger.warn('SerpAPI returned 0 jobs', {
          query, attempt,
          location: params.location || 'none',
          responseKeys: Object.keys(data),
        });

        const delay = 3000 * attempt + Math.random() * 1000;
        await sleep(delay);

        if (params.location && attempt === 1) {
          logger.info('Retrying without location filter', { query, droppedLocation: params.location });
          delete params.location;
        }
        continue;
      }

      if (jobs.length === 0) {
        logger.warn('SerpAPI: no jobs after all retries', { query, location: params.location || 'none' });
      }

      return {
        jobs,
        nextToken: data.serpapi_pagination?.next_page_token || null,
      };
    } catch (err) {
      const status = err.response?.status;
      logger.error('Google Jobs fetch failed', {
        query, attempt,
        status,
        err: err.response?.data?.error || err.message,
      });

      if (attempt < MAX_RETRIES) {
        // 503 = SerpAPI overloaded — wait longer
        const base = status === 503 ? 8000 : 4000;
        const delay = base * attempt + Math.random() * 2000;
        logger.info('Retrying after error', { query, attempt, delayMs: Math.round(delay), status });
        await sleep(delay);

        // Drop location on retry — network errors sometimes caused by bad location param
        if (params.location && attempt === 2) {
          delete params.location;
        }
        continue;
      }

      return { jobs: [], nextToken: null };
    }
  }

  return { jobs: [], nextToken: null };
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
    signalText:      `Actively hiring: "${jr.title}" — ${jr.description || ''}`,
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
      snippet:         jr.description || '',
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
// Reddit & community intent search
// Searches Google for Reddit/community discussions mentioning pain points
// related to the service — signals buying intent even before a job is posted
// ─────────────────────────────────────────────────────────────────────────────

async function searchCommunityLeads(service, filters = {}) {
  if (!config.serpapi?.key) return [];

  const queries = [
    `site:reddit.com "${service}" looking for company OR vendor OR recommend`,
    `site:reddit.com "${service}" need help OR implementation OR migration`,
    `site:reddit.com "${service}" hiring OR consultant OR freelancer`,
  ];

  const rawResults = [];

  for (const query of queries) {
    try {
      const { data } = await axios.get('https://serpapi.com/search', {
        params: {
          api_key: config.serpapi.key,
          engine:  'google',
          q:       query,
          num:     10,
          tbs:     'qdr:m',   // last month only
        },
        timeout: 20000,
      });

      const results = data.organic_results || [];
      for (const r of results) {
        const link = r.link || '';
        // Only keep Reddit/Quora links
        if (!link.includes('reddit.com') && !link.includes('quora.com')) continue;
        rawResults.push({
          title:   r.title || '',
          snippet: r.snippet || '',
          link,
          source:  link.includes('reddit.com') ? 'Reddit' : 'Quora',
        });
      }

      await sleep(1500 + Math.random() * 500);
    } catch (err) {
      logger.warn('Community search failed', { query, err: err.message });
    }
  }

  if (rawResults.length === 0) {
    logger.info('Community search: no results found', { service });
    return [];
  }

  // Deduplicate by link
  const uniqueResults = [];
  const seenLinks = new Set();
  for (const r of rawResults) {
    if (!seenLinks.has(r.link)) {
      seenLinks.add(r.link);
      uniqueResults.push(r);
    }
  }

  // ── AI filter: extract real companies with buying intent ──────────────
  // Send all snippets to AI in one call for efficiency
  const leads = [];
  try {
    const systemPrompt = `You are a B2B lead qualification expert. You will be given snippets from Reddit/Quora posts about "${service}".

For each snippet, determine if it mentions a REAL company (not a product, subreddit, or generic term) that has buying intent for ${service}-related services.

Return ONLY valid JSON array. Each item must have:
- "index": the snippet index (0-based)
- "companyName": the real company name mentioned (must be an actual business, not a product name or generic word)  
- "buyingIntent": brief explanation of why this is buying intent
- "isValid": true only if a REAL company with REAL buying intent is mentioned

If a snippet has no real company or no buying intent, set isValid to false.
Return an empty array [] if none are valid.`;

    const userPrompt = uniqueResults.map((r, i) =>
      `[${i}] Title: ${r.title}\nSnippet: ${r.snippet}\nURL: ${r.link}`
    ).join('\n\n');

    const aiResponse = await callOpenAI(systemPrompt, userPrompt, 800);

    // Parse AI response
    let parsed = [];
    try {
      const jsonMatch = aiResponse.match(/\[[\s\S]*\]/);
      if (jsonMatch) parsed = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      logger.warn('Community AI filter: failed to parse response', { err: parseErr.message });
    }

    for (const item of parsed) {
      if (!item.isValid || !item.companyName) continue;
      const idx = item.index;
      if (idx < 0 || idx >= uniqueResults.length) continue;

      const r = uniqueResults[idx];

      leads.push({
        companyName:       item.companyName.trim(),
        website:           '',
        industry:          '',
        location:          '',
        companySize:       '',
        description:       '',
        techStack:         [],
        signalType:        'community_intent',
        signalText:        `${r.source} post: "${r.title}" — ${r.snippet}`,
        confidence:        70,
        relevanceScore:    75,
        contactName:       null,
        contactTitle:      null,
        contactEmail:      null,
        contactLinkedin:   null,
        companyLinkedinUrl: null,
        jobPostings:       [],
        source:            `${r.source} — ${r.link}`,
        sourceUrl:         r.link,
        _isJobLead:        false,
      });

      logger.info('Community lead validated by AI', {
        company: item.companyName,
        intent: item.buyingIntent,
        source: r.source,
        url: r.link,
      });
    }
  } catch (err) {
    logger.warn('Community AI filter failed', { err: err.message });
  }

  logger.info('Community intent search done', { service, rawResults: uniqueResults.length, validLeads: leads.length });
  return leads;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main scan runner
// ─────────────────────────────────────────────────────────────────────────────

async function runDiscoveryScan(job, services, filters = {}, progressCallback) {
  const allLeads  = [];
  const seenKeys  = new Set();   // composite: company + job title

  function tryAdd(lead) {
    if (!lead?.companyName) return false;
    const nk = normName(lead.companyName);
    if (!nk) return false;

    // Build composite key: company + job title (so same company with different job = new lead)
    const jobTitle = normName(lead.jobPostings?.[0]?.title || lead.signalText || '');
    const compositeKey = `${nk}::${jobTitle}`;

    if (seenKeys.has(compositeKey)) {
      logger.debug('Lead skipped (exact duplicate)', {
        company: lead.companyName,
        jobTitle: lead.jobPostings?.[0]?.title || 'N/A',
      });
      return false;
    }
    seenKeys.add(compositeKey);
    allLeads.push(lead);
    logger.info('Lead discovered', {
      company: lead.companyName,
      source: lead.source,
      signalType: lead.signalType,
      website: lead.website || 'N/A',
      location: lead.location || 'N/A',
      relevance: lead.relevanceScore,
      jobTitle: lead.jobPostings?.[0]?.title || 'N/A',
      totalSoFar: allLeads.length,
    });
    return true;
  }

  logger.info('Dynamic service scan START', {
    jobId: job.id,
    services,
    filters: {
      targetRegion: filters.targetRegion || 'none',
      targetIndustry: filters.targetIndustry || 'none',
      workTypes: filters.workTypes || [],
    },
  });

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

  // ── Phase 2: Reddit & community intent signals ──────────────────────────
  if (!TEST_MODE || allLeads.length < TEST_MAX_LEADS) {
    for (const service of services) {
      const communityLeads = await searchCommunityLeads(service, filters);
      for (const lead of communityLeads) {
        if (TEST_MODE && allLeads.length >= TEST_MAX_LEADS) break;
        tryAdd(lead);
      }
      await tick('community-' + service);
    }
  }

  if (progressCallback) await progressCallback(100, allLeads.length);

  logger.info('Dynamic service scan DONE', { jobId: job.id, total: allLeads.length });
  return allLeads;
}

module.exports = { runDiscoveryScan };
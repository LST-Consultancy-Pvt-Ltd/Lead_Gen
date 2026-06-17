/**
 * leadEnrichmentPipeline.js
 *
 * Full aggregated enrichment pipeline for a lead.
 *
 * Step 1 — Company data aggregation (free/cheap sources):
 *   • Clearbit Autocomplete (free) → logo, description, industry, location
 *   • SerpAPI Knowledge Graph     → companySize, founded, revenue, employees, headquarters
 *   • SerpAPI organic             → company LinkedIn URL
 *
 * Step 2 — Domain resolution (if website missing):
 *   • SerpAPI organic search for company name → extract domain
 *
 * Step 3 — Contact enrichment (paid, user-triggered):
 *   • SignalHire → email, phone, personal LinkedIn
 *   • Apollo.io  → email, phone, personal LinkedIn (fallback)
 *     Apollo pipeline (mirrors working Python code):
 *       GET  /organizations/enrich  → org_id   (FREE)
 *       POST /mixed_people/api_search with organization_ids (FREE)
 *       POST /people/match with { id: apollo_person_id }    (1 CREDIT)
 *
 * All functions are independently callable.
 * The pipeline runs in background after save — Steps 1+2 only.
 * Step 3 is user-triggered via POST /leads/:id/enrich/signalhire or /apollo.
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');
const signalhirePending = require('./signalhirePending');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const AGGREGATOR_DOMAINS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'reddit.com', 'techcrunch.com',
  'crunchbase.com', 'github.com', 'angel.co', 'angellist.com', 'naukri.com',
  'monster.com', 'twitter.com', 'x.com', 'facebook.com', 'youtube.com', 'google.com',
  'wikipedia.org', 'bloomberg.com', 'forbes.com', 'ycombinator.com',
];

function normDomain(url = '') {
  try {
    const hostname = new URL(url.startsWith('http') ? url : `https://${url}`).hostname;
    return hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return url.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0].toLowerCase();
  }
}

function isAggregator(url = '') {
  const d = normDomain(url);
  return AGGREGATOR_DOMAINS.some(a => d.includes(a));
}

function extractLinkedinCompanyUrl(text) {
  const m = (text || '').match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_%-]+)/i);
  return m ? `https://www.linkedin.com/company/${m[1]}` : null;
}

function extractLinkedinPersonUrl(text) {
  const m = (text || '').match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_%-]{3,})/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

async function serpSearch(query, num = 5) {
  if (!config.serpapi?.key) return [];
  try {
    const { data } = await axios.get('https://serpapi.com/search', {
      params: { api_key: config.serpapi.key, q: query, num, engine: 'google' },
      timeout: 12000,
    });
    return data.organic_results || [];
  } catch (err) {
    logger.warn('serpSearch failed', { query, err: err.message });
    return [];
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1a — Clearbit Autocomplete (free, no key)
// Returns: { name, domain, description, logo, industry, location, employees }
// ─────────────────────────────────────────────────────────────────────────────

async function clearbitLookup(lead) {
  const query = lead.website
    ? normDomain(lead.website)
    : encodeURIComponent(lead.companyName);

  try {
    const { data } = await axios.get(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${query}`,
      { timeout: 8000 }
    );
    const matches = Array.isArray(data) ? data : [];

    // Find best match
    const name = lead.companyName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const match = matches.find(m => {
      const n = (m.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      return n === name || (lead.website && normDomain(m.domain || '') === normDomain(lead.website));
    }) || matches[0];

    if (!match) return null;

    return {
      name:        match.name        || null,
      domain:      match.domain      || null,
      description: match.description || null,
      logo:        match.logo        || null,
      industry:    null,
      employees:   null,
    };
  } catch (err) {
    logger.debug('Clearbit lookup failed', { err: err.message });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1b — SerpAPI Knowledge Graph
// Returns structured company info: employees, founded, headquarters, revenue, etc.
// ─────────────────────────────────────────────────────────────────────────────

async function kgLookup(lead) {
  if (!config.serpapi?.key) return null;

  const query = lead.website
    ? `${lead.companyName} site:${normDomain(lead.website)}`
    : `${lead.companyName} company`;

  try {
    const { data } = await axios.get('https://serpapi.com/search', {
      params: { api_key: config.serpapi.key, q: query, engine: 'google', num: 3 },
      timeout: 12000,
    });

    const kg = data.knowledge_graph;
    if (!kg) return null;

    let companySize = null;
    let rawEmployeeCount = undefined;
    const empRaw = kg.employees || kg.number_of_employees || '';
    if (empRaw) {
      const num = parseInt(empRaw.toString().replace(/[^0-9]/g, ''));
      if (!isNaN(num)) {
        rawEmployeeCount = num;
        if (num > 10000) companySize = '10000+';
        else if (num > 1000) companySize = '1000-10000';
        else if (num > 200)  companySize = '200-1000';
        else if (num > 50)   companySize = '50-200';
        else if (num > 10)   companySize = '10-50';
        else companySize = '1-10';
      }
    }

    const industry    = kg.type || kg.industry || null;
    const headquarters = kg.headquarters || kg.location || null;
    const founded     = kg.founded || kg.inception || null;
    const revenue     = kg.revenue || null;
    const description = kg.description || kg.snippet || null;

    let linkedinUrl = null;
    const profiles  = kg.profiles || [];
    for (const p of profiles) {
      const u = p.link || p.url || '';
      if (u.includes('linkedin.com/company')) {
        linkedinUrl = extractLinkedinCompanyUrl(u);
        break;
      }
    }

    return {
      companySize,
      rawEmployeeCount,
      industry,
      location:      headquarters,
      description,
      founded,
      revenue,
      linkedinUrl,
      website:       kg.website || null,
    };
  } catch (err) {
    logger.debug('KG lookup failed', { err: err.message });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 1c — Find company LinkedIn URL via SerpAPI organic
// ─────────────────────────────────────────────────────────────────────────────

async function findLinkedinUrl(lead) {
  if (!config.serpapi?.key) return null;

  const domain = lead.website ? normDomain(lead.website) : '';
  const query  = domain
    ? `site:linkedin.com/company "${lead.companyName}"`
    : `"${lead.companyName}" linkedin.com/company`;

  const results = await serpSearch(query, 5);

  for (const r of results) {
    const url = extractLinkedinCompanyUrl(r.link || r.displayed_link || r.snippet || '');
    if (url) return url;
    const fromSnippet = extractLinkedinCompanyUrl(r.snippet || '');
    if (fromSnippet) return fromSnippet;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 2 — Domain resolution (if website is missing)
// ─────────────────────────────────────────────────────────────────────────────

async function resolveDomain(companyName) {
  if (!config.serpapi?.key) return null;

  const query = `"${companyName}" official website`;
  const results = await serpSearch(query, 5);

  for (const r of results) {
    const link = r.link || '';
    if (!link || isAggregator(link)) continue;
    return normDomain(link);
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3a — SignalHire contact enrichment
// ─────────────────────────────────────────────────────────────────────────────

function normalizeLinkedinUrl(url) {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  if (/^(?:www\.)?linkedin\.com\//i.test(url)) return `https://www.${url.replace(/^www\./, '')}`;
  return `https://www.linkedin.com/${url.replace(/^\//, '')}`;
}

// SignalHire is webhook-only: we submit a search WITH a callbackUrl and SignalHire
// PUSHES the result to that URL (it cannot be polled). So this function submits the
// search and registers the lead as pending; the actual contact is filled in later by
// the webhook handler (controllers/webhooks.controller.js). It returns a status
// object, NOT a contact.
async function enrichViaSignalHire(lead, meta = {}) {
  if (!config.signalhire?.apiKey) {
    logger.warn('SignalHire: SIGNALHIRE_API_KEY not set — skipping');
    return { skipped: 'no_api_key' };
  }
  if (!config.signalhire?.callbackUrl) {
    logger.warn('SignalHire: SIGNALHIRE_CALLBACK_URL not set — cannot receive results, skipping');
    return { skipped: 'no_callback_url' };
  }

  const domain = lead.website ? normDomain(lead.website) : null;

  // SignalHire only accepts PERSON identifiers: a personal LinkedIn (/in/), an email,
  // a phone, a person's name, or a company DOMAIN. It REJECTS company LinkedIn URLs
  // (/company/…) with "No valid items given" — so we must filter those out.
  const personLinkedin = (u) => (u && /linkedin\.com\/in\//i.test(u)) ? normalizeLinkedinUrl(u) : null;

  let item = null;
  if (personLinkedin(lead.contactLinkedin))      item = personLinkedin(lead.contactLinkedin);
  else if (personLinkedin(lead.linkedinUrl))     item = personLinkedin(lead.linkedinUrl);
  else if (lead.contactEmail)                    item = lead.contactEmail;
  else if (lead.contactName && domain)           item = `${lead.contactName} ${domain}`;
  else if (lead.contactName)                     item = lead.contactName;
  else if (domain)                               item = domain;            // accepted by SignalHire
  else if (lead.companyName)                     item = lead.companyName;

  if (!item) {
    logger.warn('SignalHire: not enough data (no person identifier or domain)', { leadId: lead.id });
    return { skipped: 'insufficient_data' };
  }

  logger.info('SignalHire: submitting search', { item, leadId: lead.id, callbackUrl: config.signalhire.callbackUrl });

  try {
    const res = await axios.post(
      'https://www.signalhire.com/api/v1/candidate/search',
      { items: [item], callbackUrl: config.signalhire.callbackUrl },
      { headers: { apikey: config.signalhire.apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    const requestId = res.data?.requestId;
    if (!requestId) {
      logger.warn('SignalHire: no requestId returned', { leadId: lead.id, data: res.data });
      return { skipped: 'no_request_id' };
    }

    // Optional synchronous wait: register a resolver the webhook will call when the
    // result arrives, then await it (bounded). If it times out we still return
    // submitted — the webhook updates the lead asynchronously as a fallback.
    const waitMs = Number(meta.waitMs) || 0;
    let resolveResult = null;
    const resultPromise = waitMs > 0 ? new Promise((r) => { resolveResult = r; }) : null;

    signalhirePending.register([requestId, item], {
      leadId: lead.id,
      organizationId: lead.organizationId,
      createdById: meta.createdById || null,
      resolve: resolveResult,   // present only in synchronous mode
    });

    logger.info('SignalHire: search submitted, awaiting webhook', { leadId: lead.id, requestId, item, waitMs });

    if (waitMs > 0) {
      const contact = await Promise.race([
        resultPromise,
        sleep(waitMs).then(() => null),
      ]);
      if (contact) return { submitted: true, found: true, requestId, contact };
      return { submitted: true, found: false, pending: true, requestId };
    }

    return { submitted: true, requestId };
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error('SignalHire: submit failed', { err: detail, leadId: lead.id });
    return { skipped: 'submit_error', error: typeof detail === 'string' ? detail : JSON.stringify(detail) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// STEP 3b — Apollo contact enrichment
//
// Mirrors the working Python pipeline:
//   1. GET  /organizations/enrich?domain=...  → get Apollo org_id  (FREE)
//   2. POST /mixed_people/api_search with organization_ids          (FREE)
//   3. POST /people/match with { id: apollo_person_id }             (1 CREDIT per person)
// ─────────────────────────────────────────────────────────────────────────────

async function apolloEnrichOrganization(domain, headers) {
  try {
    const { data } = await axios.get(
      'https://api.apollo.io/api/v1/organizations/enrich',
      { headers, params: { domain }, timeout: 15000 }
    );
    const org = data?.organization;
    if (!org) {
      logger.info('Apollo: no organization found for domain', { domain });
      return null;
    }
    logger.info('Apollo: org enriched', {
      domain,
      orgId: org.id,
      name: org.name,
      employees: org.estimated_num_employees,
    });
    return org;
  } catch (err) {
    logger.warn('Apollo: org enrich failed', { domain, err: err.message });
    return null;
  }
}

// ── Title synonym groups ──
// Each array contains equivalent title variations. When a user searches for
// any variant, all variants in the group are sent to Apollo, and the post-filter
// treats all variants as matches.
const TITLE_SYNONYM_GROUPS = [
  ['ceo', 'chief executive officer'],
  ['cto', 'chief technology officer'],
  ['cfo', 'chief financial officer'],
  ['coo', 'chief operating officer'],
  ['cmo', 'chief marketing officer'],
  ['cio', 'chief information officer'],
  ['ciso', 'chief information security officer'],
  ['cpo', 'chief product officer'],
  ['cro', 'chief revenue officer'],
  ['cdo', 'chief data officer', 'chief digital officer'],
  ['clo', 'chief legal officer'],
  ['chro', 'chief human resources officer'],
  ['it director', 'director of it', 'director of information technology'],
  ['hr director', 'director of hr', 'director of human resources'],
  ['finance director', 'director of finance'],
  ['sales director', 'director of sales'],
  ['marketing director', 'director of marketing'],
  ['operations director', 'director of operations'],
  ['engineering director', 'director of engineering'],
  ['vp engineering', 'vice president of engineering', 'vice president engineering'],
  ['vp sales', 'vice president of sales', 'vice president sales'],
  ['vp marketing', 'vice president of marketing', 'vice president marketing'],
  ['vp operations', 'vice president of operations', 'vice president operations'],
  ['vp product', 'vice president of product', 'vice president product'],
  ['vp finance', 'vice president of finance', 'vice president finance'],
  ['vp hr', 'vice president of hr', 'vice president hr'],
  ['vp it', 'vice president of it', 'vice president it'],
  ['vp technology', 'vice president of technology', 'vice president technology'],
  ['vp business development', 'vice president of business development'],
  ['erp manager', 'enterprise resource planning manager'],
  ['it manager', 'information technology manager'],
  ['hr manager', 'human resources manager'],
  ['c suite', 'c-suite', 'csuite'],
];

/**
 * Expand an array of titles by adding known synonyms.
 * E.g. ['CEO', 'IT Director'] → ['CEO', 'Chief Executive Officer', 'IT Director', 'Director of IT', ...]
 */
function expandTitlesWithSynonyms(titles) {
  const expanded = new Set(titles.map(t => t.toLowerCase().trim()));
  for (const title of titles) {
    const lower = title.toLowerCase().trim();
    for (const group of TITLE_SYNONYM_GROUPS) {
      if (group.includes(lower)) {
        group.forEach(syn => expanded.add(syn));
      }
    }
  }
  return [...expanded];
}

/**
 * Check if a person's title matches any of the user-selected titles,
 * accounting for synonyms and word-boundary-aware matching.
 */
function titleMatchesAny(personTitle, searchTitles) {
  if (!personTitle) return false;
  const pTitle = personTitle.toLowerCase().trim();

  // Build expanded set of all acceptable titles (with synonyms)
  const expandedTitles = expandTitlesWithSynonyms(searchTitles);

  // 1) Exact match against expanded synonyms
  if (expandedTitles.some(t => pTitle === t)) return true;

  // 2) Word-boundary match: search term appears as whole words inside the person's title
  //    E.g. "Finance Manager" matches "Senior Finance Manager"
  //    But "CEO" does NOT match "Process Coordinator"
  //    Uses word boundary regex (\b) for precise matching
  for (const t of expandedTitles) {
    const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`\\b${escaped}\\b`, 'i');
    if (re.test(pTitle)) return true;
  }

  return false;
}

async function apolloSearchPeopleByOrgId(orgId, headers, jobTitle = null, perPage = 10, personTitles = null) {
  const payload = {
    organization_ids: [orgId],
    per_page: perPage,
    page: 1,
  };
  if (personTitles && personTitles.length > 0) {
    // Expand with synonyms so Apollo can find both "CEO" and "Chief Executive Officer"
    const expandedTitles = expandTitlesWithSynonyms(personTitles);
    payload.person_titles = expandedTitles;
    payload.include_similar_titles = true;
  } else if (jobTitle) {
    // Expand single title too
    const expandedTitles = expandTitlesWithSynonyms([jobTitle]);
    payload.person_titles = expandedTitles;
    payload.include_similar_titles = true;
  }

  try {
    const { data } = await axios.post(
      'https://api.apollo.io/api/v1/mixed_people/api_search',
      payload,
      { headers, timeout: 15000 }
    );
    let people = data?.people || [];
    logger.info('Apollo: people search by org_id', { orgId, found: people.length });

    // Post-filter: keep only people whose title matches the user's selected titles
    // Uses synonym-aware + contains matching instead of exact match
    if (personTitles && personTitles.length > 0 && people.length > 0) {
      const filtered = people.filter(p => titleMatchesAny(p.title, personTitles));
      logger.info('Apollo: title filter (synonym-aware)', { before: people.length, after: filtered.length, titles: personTitles });
      people = filtered;
    }

    return people;
  } catch (err) {
    logger.warn('Apollo: people search by org_id failed', { orgId, err: err.message });
    return [];
  }
}

async function apolloEnrichPersonById(apolloId, headers) {
  const payload = {
    id: apolloId,
    reveal_personal_emails: false,
    reveal_phone_number: false,
  };

  try {
    const { data } = await axios.post(
      'https://api.apollo.io/api/v1/people/match',
      payload,
      { headers, timeout: 15000 }
    );
    const person = data?.person;
    if (!person) return null;

    const org = person.organization || {};
    return {
      email:       person.email ?? null,
      phone:       person.sanitized_phone ?? person.phone_numbers?.[0]?.raw_number ?? null,
      linkedinUrl: person.linkedin_url ?? null,
      name:        [person.first_name, person.last_name || person.last_name_obfuscated].filter(Boolean).join(' ') || null,
      title:       person.title ?? null,
      source:      'apollo',
      company:     org.name ?? null,
    };
  } catch (err) {
    logger.warn('Apollo: enrich person by ID failed', { apolloId, err: err.message });
    return null;
  }
}

async function enrichViaApollo(lead, options = {}) {
  if (!config.apollo?.apiKey) {
    logger.warn('Apollo: APOLLO_API_KEY not set — skipping');
    return null;
  }

  const { personTitles, returnAll = false } = options;
  const userTitles = Array.isArray(personTitles) && personTitles.length > 0 ? personTitles : null;

  const domain = lead.website ? normDomain(lead.website) : null;
  if (!domain && !lead.companyName) return null;

  const apolloHeaders = {
    'accept': 'application/json',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'x-api-key': config.apollo.apiKey,
  };

  // ── Step 1: Enrich organization by domain → get org ID (FREE) ──
  let orgId = null;
  let orgPhone = null;
  if (domain) {
    const org = await apolloEnrichOrganization(domain, apolloHeaders);
    orgId = org?.id || null;
    orgPhone = org?.sanitized_phone || org?.phone || null;
    if (orgPhone) {
      logger.info('Apollo: org phone found', { domain, orgPhone });
    }
  }

  // ── Step 2: Search people by org ID (FREE, more reliable) ──
  let people = [];
  const titlesToSearch = userTitles || ['CEO', 'CTO', 'Founder', 'Managing Director', 'Director'];

  if (orgId) {
    if (userTitles) {
      // User selected specific titles — search all at once with higher limit
      people = await apolloSearchPeopleByOrgId(orgId, apolloHeaders, null, 25, userTitles);
    } else {
      // Default behavior: try each title until we find someone
      for (const title of titlesToSearch) {
        people = await apolloSearchPeopleByOrgId(orgId, apolloHeaders, title, 5);
        if (people.length > 0) break;
      }
    }
    // If no title match, search without title filter
    if (people.length === 0 && !userTitles) {
      people = await apolloSearchPeopleByOrgId(orgId, apolloHeaders, null, 10);
    }
  }

  if (!people.length) {
    logger.info('Apollo: no people found at all', { leadId: lead.id });
    return returnAll ? [] : null;
  }

  // ── Step 3: Enrich people by Apollo ID (1 CREDIT per person) ──
  const sorted = [...people].sort((a, b) => {
    if (a.has_email && !b.has_email) return -1;
    if (!a.has_email && b.has_email) return 1;
    return 0;
  });

  if (returnAll) {
    // Multi-contact mode: enrich each person by Apollo ID to get full name/email/linkedin/phone
    // Each enrich costs 1 credit, but reveals the real (unmasked) data
    const allContacts = [];
    const seenKeys = new Set();   // dedup by email or name

    for (const person of sorted) {
      const apolloId = person.id;
      if (!apolloId) continue;

      // Try enrich-by-ID to get full data (1 CREDIT per person)
      const enriched = await apolloEnrichPersonById(apolloId, apolloHeaders);

      let contact;
      if (enriched && (enriched.name || enriched.email)) {
        contact = enriched;
      } else {
        // Fallback: use raw search data (masked last name)
        const lastName = person.last_name || person.last_name_obfuscated || null;
        contact = {
          name:        [person.first_name, lastName].filter(Boolean).join(' ') || null,
          email:       person.email ?? null,
          phone:       person.phone_numbers?.[0]?.raw_number ?? null,
          linkedinUrl: person.linkedin_url ?? null,
          title:       person.title ?? null,
          source:      'apollo',
        };
      }

      if (!contact.name && !contact.email) continue;

      // Dedup by email if available, otherwise by name+title
      const dedupKey = contact.email
        ? `email:${contact.email.toLowerCase()}`
        : `name:${(contact.name || '').toLowerCase()}|${(contact.title || '').toLowerCase()}`;
      if (seenKeys.has(dedupKey)) continue;
      seenKeys.add(dedupKey);

      allContacts.push(contact);
    }

    // Attach org phone to the result metadata
    if (orgPhone) {
      allContacts._orgPhone = orgPhone;
    }

    logger.info('Apollo: multi-contact search done', { leadId: lead.id, total: allContacts.length, orgPhone });
    return allContacts;
  }

  // Single contact mode (original behavior)
  for (const person of sorted) {
    const apolloId = person.id;
    if (!apolloId) continue;

    logger.info('Apollo: enriching person by ID', {
      apolloId,
      name: [person.first_name, person.last_name].filter(Boolean).join(' '),
      title: person.title,
      hasEmail: person.has_email,
      leadId: lead.id,
    });

    const result = await apolloEnrichPersonById(apolloId, apolloHeaders);
    if (result && (result.email || result.linkedinUrl)) {
      logger.info('Apollo: contact found via person ID enrich', {
        leadId: lead.id,
        email: result.email,
        name: result.name,
      });
      return result;
    }
  }

  // Last fallback: return best search result data as-is (no credit spent)
  const best = sorted[0];
  const fallback = {
    email:       best.email ?? null,
    phone:       best.phone_numbers?.[0]?.raw_number ?? null,
    linkedinUrl: best.linkedin_url ?? null,
    name:        [best.first_name, best.last_name_obfuscated || best.last_name].filter(Boolean).join(' ') || null,
    title:       best.title ?? null,
    source:      'apollo',
  };
  if (fallback.email || fallback.linkedinUrl) return fallback;

  logger.info('Apollo: no usable contact data', { leadId: lead.id });
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// MAIN — Full background enrichment pipeline (Steps 1 + 2)
// Called after a lead is saved. Safe to fail — never throws.
// ─────────────────────────────────────────────────────────────────────────────

async function runBackgroundEnrichment(lead, prisma) {
  let cur = { ...lead };
  const patch = {};

  try {
    // ── Step 2: Resolve domain if missing ────────────────────────────────
    if (!cur.website && cur.companyName) {
      const domain = await resolveDomain(cur.companyName);
      if (domain) {
        patch.website = domain;
        cur.website   = domain;
        logger.info('Domain resolved', { leadId: cur.id, domain });
      }
    }

    // ── Step 1a: Clearbit ─────────────────────────────────────────────────
    const clearbit = await clearbitLookup(cur);
    if (clearbit) {
      if (clearbit.description && !cur.description) patch.description = clearbit.description;
      if (clearbit.domain && !cur.website)          patch.website     = `https://${clearbit.domain}`;
    }

    // ── Step 1b: SerpAPI Knowledge Graph ──────────────────────────────────
    const kg = await kgLookup(cur);
    if (kg) {
      if (kg.industry    && !cur.industry)    patch.industry    = kg.industry;
      if (kg.location    && !cur.location)    patch.location    = kg.location;
      if (kg.companySize && !cur.companySize) patch.companySize = kg.companySize;
      if (kg.description && !cur.description) patch.description = kg.description;
      if (kg.linkedinUrl && !cur.linkedinUrl) patch.linkedinUrl = kg.linkedinUrl;
      if (kg.website     && !cur.website)     patch.website     = kg.website;

      const extra = {};
      if (kg.founded)  extra.founded  = kg.founded;
      if (kg.revenue)  extra.revenue  = kg.revenue;
      if (extra.founded || extra.revenue) {
        patch.fundingInfo = JSON.stringify(extra);
      }
    }

    // ── Step 1c: LinkedIn URL ─────────────────────────────────────────────
    if (!patch.linkedinUrl && !cur.linkedinUrl) {
      const liUrl = await findLinkedinUrl({ ...cur, ...patch });
      if (liUrl) patch.linkedinUrl = liUrl;
    }

    // Save if we have anything new
    if (Object.keys(patch).length > 0) {
      const safeFields = ['website', 'description', 'industry', 'location', 'companySize', 'linkedinUrl'];
      const safePatch  = {};
      for (const k of safeFields) {
        if (patch[k] !== undefined) safePatch[k] = patch[k];
      }
      if (Object.keys(safePatch).length > 0) {
        await prisma.lead.update({ where: { id: cur.id }, data: safePatch });
        logger.info('Background enrichment saved', { leadId: cur.id, fields: Object.keys(safePatch) });
      }
    }

    // ── Auto-archive tiny companies (0-1 employees) ──────────────────────
    const finalSize = patch.companySize || cur.companySize || '';
    if (finalSize === '1-10') {
      // Check if KG gave us the raw employee count — if ≤ 1, archive
      const rawEmpCount = kg?.rawEmployeeCount;
      if (rawEmpCount !== undefined && rawEmpCount <= 1) {
        await prisma.lead.update({
          where: { id: cur.id },
          data: { status: 'disqualified', notes: (cur.notes || '') + '\n[Auto] Disqualified: company has 0-1 employees.' },
        });
        logger.info('Auto-disqualified tiny company', { leadId: cur.id, employees: rawEmpCount });
      }
    }
  } catch (err) {
    logger.warn('Background enrichment failed (non-fatal)', { leadId: lead.id, err: err.message });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Aggregate all company data into a rich profile for the lead detail page
// ─────────────────────────────────────────────────────────────────────────────

async function aggregateCompanyProfile(lead) {
  const [clearbit, kg] = await Promise.allSettled([
    clearbitLookup(lead),
    kgLookup(lead),
  ]);

  const cb = clearbit.status === 'fulfilled' ? clearbit.value : null;
  const kg_ = kg.status === 'fulfilled'     ? kg.value       : null;

  return {
    logo:        cb?.logo        || null,
    description: kg_?.description || cb?.description || lead.description || null,
    industry:    kg_?.industry   || lead.industry    || null,
    location:    kg_?.location   || lead.location    || null,
    companySize: kg_?.companySize || lead.companySize || null,
    founded:     kg_?.founded    || null,
    revenue:     kg_?.revenue    || null,
    linkedinUrl: kg_?.linkedinUrl || lead.linkedinUrl || null,
    website:     lead.website    || cb?.domain && `https://${cb.domain}` || kg_?.website || null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto Apollo enrichment — called in background after a lead is saved during a scan.
// Finds contacts for the decision-maker roles chosen by the user on the discovery page.
// Safe to fire-and-forget; never throws.
// ─────────────────────────────────────────────────────────────────────────────

async function runApolloEnrichmentBackground(lead, prisma, { organizationId, createdById = null, roles = [] } = {}) {
  try {
    if (!config.apollo?.apiKey) {
      logger.info('Apollo auto-enrich: skipped (no API key)', { leadId: lead.id });
      return;
    }

    const personTitles = Array.isArray(roles) && roles.length > 0 ? roles : null;

    logger.info('Apollo auto-enrich: starting', {
      leadId: lead.id,
      company: lead.companyName,
      roles: personTitles || 'defaults',
    });

    const contacts = await enrichViaApollo(lead, {
      personTitles,
      returnAll: !!(personTitles && personTitles.length > 0),
    });

    if (!contacts || (Array.isArray(contacts) ? contacts.length === 0 : !contacts.email && !contacts.name)) {
      logger.info('Apollo auto-enrich: no contacts found', { leadId: lead.id });
      return;
    }

    const contactList = Array.isArray(contacts) ? contacts : [contacts];
    const orgPhone = contacts._orgPhone || null;

    // Save org phone on lead if missing
    if (orgPhone) {
      await prisma.lead.update({ where: { id: lead.id }, data: { companyPhone: orgPhone } }).catch(() => {});
    }

    // Save first contact as primary if lead has none
    const freshLead = await prisma.lead.findUnique({ where: { id: lead.id } }).catch(() => lead);
    let primarySaved = !!(freshLead?.contactEmail || freshLead?.contactName);

    for (const c of contactList) {
      if (!c.name && !c.email) continue;

      if (!primarySaved) {
        // Set as primary contact on the lead record
        await prisma.lead.update({
          where: { id: lead.id },
          data: {
            contactName:     c.name  || null,
            contactTitle:    c.title || null,
            contactEmail:    c.email || null,
            contactPhone:    c.phone || null,
            contactLinkedin: c.linkedinUrl || null,
          },
        }).catch(err => logger.warn('Apollo auto-enrich: failed to set primary contact', { err: err.message }));
        primarySaved = true;
      }

      // Save as a Contact record (dedup by email or name+title)
      try {
        let existing = null;
        if (c.email) {
          existing = await prisma.contact.findFirst({ where: { leadId: lead.id, email: c.email } });
        } else if (c.name) {
          existing = await prisma.contact.findFirst({ where: { leadId: lead.id, name: c.name, title: c.title || undefined } });
        }
        if (!existing) {
          await prisma.contact.create({
            data: {
              leadId:         lead.id,
              organizationId: organizationId || lead.organizationId,
              name:           c.name  || 'Unknown',
              title:          c.title || null,
              email:          c.email || null,
              phone:          c.phone || null,
              linkedin:       c.linkedinUrl || null,
              designation:    c.title || null,
            },
          });
        }
      } catch (err) {
        logger.warn('Apollo auto-enrich: failed to save contact record', { err: err.message });
      }
    }

    logger.info('Apollo auto-enrich: done', { leadId: lead.id, saved: contactList.length });
  } catch (err) {
    logger.warn('Apollo auto-enrich: failed (non-fatal)', { leadId: lead.id, err: err.message });
  }
}

module.exports = {
  enrichViaSignalHire,
  enrichViaApollo,
  runBackgroundEnrichment,
  runApolloEnrichmentBackground,
  aggregateCompanyProfile,
  resolveDomain,
  findLinkedinUrl,
  clearbitLookup,
  kgLookup,
  normDomain,
  normalizeLinkedinUrl,
};
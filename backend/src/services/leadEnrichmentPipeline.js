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
    const empRaw = kg.employees || kg.number_of_employees || '';
    if (empRaw) {
      const num = parseInt(empRaw.toString().replace(/[^0-9]/g, ''));
      if (!isNaN(num)) {
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

async function enrichViaSignalHire(lead) {
  if (!config.signalhire?.apiKey) {
    logger.warn('SignalHire: SIGNALHIRE_API_KEY not set — skipping');
    return null;
  }

  const domain = lead.website ? normDomain(lead.website) : null;

  let candidate = null;
  if (lead.contactLinkedin) {
    candidate = { linkedin: normalizeLinkedinUrl(lead.contactLinkedin) };
  } else if (lead.linkedinUrl) {
    candidate = { linkedin: normalizeLinkedinUrl(lead.linkedinUrl) };
  } else if (domain && lead.contactName) {
    candidate = { name: lead.contactName, current_employer: domain };
  } else if (domain) {
    candidate = { current_employer: domain };
  } else if (lead.companyName) {
    candidate = { name: lead.companyName };
  }

  if (!candidate) {
    logger.warn('SignalHire: not enough data', { leadId: lead.id });
    return null;
  }

  logger.info('SignalHire: starting search', { candidate, leadId: lead.id });

  try {
    const initRes = await axios.post(
      'https://www.signalhire.com/api/v1/candidate/search',
      { items: [candidate], callback_url: null },
      { headers: { apikey: config.signalhire.apiKey, 'Content-Type': 'application/json' }, timeout: 15000 }
    );

    const requestId = initRes.data?.requestId;
    if (!requestId) return null;

    for (let attempt = 0; attempt < 8; attempt++) {
      await sleep(5000);
      try {
        const pollRes = await axios.get(
          `https://www.signalhire.com/api/v1/request/${requestId}`,
          { headers: { apikey: config.signalhire.apiKey }, timeout: 10000 }
        );

        const item = pollRes.data?.items?.[0];
        if (!item) continue;
        if (item.status === 'notFound') return null;

        if (item.contacts?.length > 0) {
          const contacts = item.contacts;
          return {
            email:       contacts.find(c => c.type === 'email')?.value  ?? null,
            phone:       contacts.find(c => c.type === 'phone' || c.type === 'mobile')?.value ?? null,
            linkedinUrl: contacts.find(c => c.type === 'linkedin')?.value ?? null,
            name:        item.fullName ?? item.name ?? null,
            title:       item.title ?? item.position ?? null,
            source:      'signalhire',
          };
        }
      } catch (pollErr) {
        logger.warn('SignalHire: poll attempt failed', { attempt, err: pollErr.message });
      }
    }
    return null;
  } catch (err) {
    logger.error('SignalHire: search failed', { err: err.message, leadId: lead.id });
    return null;
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

async function apolloSearchPeopleByOrgId(orgId, headers, jobTitle = null, perPage = 10, personTitles = null) {
  const payload = {
    organization_ids: [orgId],
    per_page: perPage,
    page: 1,
  };
  if (personTitles && personTitles.length > 0) {
    payload.person_titles = personTitles;
    payload.include_similar_titles = false;
  } else if (jobTitle) {
    payload.person_titles = [jobTitle];
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

    // Apollo's person_titles does substring matching (e.g. "Director" matches "Managing Director").
    // When user picked specific titles, filter to exact title matches only.
    if (personTitles && personTitles.length > 0 && people.length > 0) {
      const lowerTitles = personTitles.map(t => t.toLowerCase().trim());
      const filtered = people.filter(p => {
        const pTitle = (p.title || '').toLowerCase().trim();
        return lowerTitles.some(t => pTitle === t);
      });
      logger.info('Apollo: exact title filter', { before: people.length, after: filtered.length, titles: personTitles });
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

module.exports = {
  enrichViaSignalHire,
  enrichViaApollo,
  runBackgroundEnrichment,
  aggregateCompanyProfile,
  resolveDomain,
  findLinkedinUrl,
  clearbitLookup,
  kgLookup,
  normDomain,
  normalizeLinkedinUrl,
};
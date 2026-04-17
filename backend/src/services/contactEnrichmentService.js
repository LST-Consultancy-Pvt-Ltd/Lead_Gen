/**
 * contactEnrichmentService.js
 *
 * Two independently callable enrichment functions:
 *   enrichViaSignalHire(lead)  →  ContactResult | null
 *   enrichViaApollo(lead)      →  ContactResult | null
 *
 * Apollo pipeline (mirrors working Python code):
 *   GET  /organizations/enrich  → org_id   (FREE)
 *   POST /mixed_people/api_search with organization_ids (FREE)
 *   POST /people/match with { id: apollo_person_id }    (1 CREDIT)
 *
 * ContactResult {
 *   email       : string | null
 *   phone       : string | null
 *   linkedinUrl : string | null
 *   name        : string | null
 *   title       : string | null
 *   source      : 'signalhire' | 'apollo'
 * }
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const AGGREGATOR_DOMAINS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'reddit.com', 'techcrunch.com',
  'crunchbase.com', 'github.com', 'angel.co', 'angellist.com', 'naukri.com',
  'monster.com', 'twitter.com', 'x.com', 'facebook.com', 'youtube.com', 'google.com',
];

function extractCompanyDomain(lead) {
  if (lead.website) {
    return lead.website.replace(/^https?:\/\//, '').split('/')[0].replace('www.', '');
  }
  if (lead.sourceUrl) {
    try {
      const hostname = new URL(lead.sourceUrl).hostname.replace('www.', '');
      return AGGREGATOR_DOMAINS.some(d => hostname.includes(d)) ? null : hostname;
    } catch { return null; }
  }
  return null;
}

function normalizeLinkedinUrl(url) {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  if (/^(?:www\.)?linkedin\.com\//i.test(url)) return `https://www.${url.replace(/^www\./, '')}`;
  return `https://www.linkedin.com/${url.replace(/^\//, '')}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. SignalHire
//
// Search priority (best signal → least signal):
//   1. contactLinkedin URL    → most specific, person profile
//   2. companyLinkedinUrl     → company page, SH returns employees
//   3. name + domain          → classic approach
//   4. domain only            → least specific
//   5. company name           → last resort
//
// API flow:
//   POST /candidate/search → { requestId }
//   GET  /request/:id      → poll every 5s, up to 8 attempts (40s max)
// ─────────────────────────────────────────────────────────────────────────────

async function enrichViaSignalHire(lead) {
  if (!config.signalhire?.apiKey) {
    logger.warn('SignalHire: SIGNALHIRE_API_KEY not set — skipping');
    return null;
  }

  const domain = extractCompanyDomain(lead);

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
    logger.warn('SignalHire: not enough data to build candidate', { leadId: lead.id });
    return null;
  }

  logger.info('SignalHire: starting search', { candidate, leadId: lead.id });

  try {
    const initRes = await axios.post(
      'https://www.signalhire.com/api/v1/candidate/search',
      { items: [candidate], callback_url: null },
      {
        headers: { apikey: config.signalhire.apiKey, 'Content-Type': 'application/json' },
        timeout: 15000,
      }
    );

    const requestId = initRes.data?.requestId;
    if (!requestId) {
      logger.warn('SignalHire: no requestId returned', { body: initRes.data });
      return null;
    }

    for (let attempt = 0; attempt < 8; attempt++) {
      await new Promise(r => setTimeout(r, 5000));

      try {
        const pollRes = await axios.get(
          `https://www.signalhire.com/api/v1/request/${requestId}`,
          { headers: { apikey: config.signalhire.apiKey }, timeout: 10000 }
        );

        const item = pollRes.data?.items?.[0];
        if (!item) continue;

        if (item.status === 'notFound') {
          logger.info('SignalHire: candidate not in database', { requestId });
          return null;
        }

        if (item.contacts?.length > 0) {
          const contacts = item.contacts;
          const result = {
            email:       contacts.find(c => c.type === 'email')?.value  ?? null,
            phone:       contacts.find(c => c.type === 'phone' || c.type === 'mobile')?.value ?? null,
            linkedinUrl: contacts.find(c => c.type === 'linkedin')?.value ?? null,
            name:        item.fullName ?? item.name ?? null,
            title:       item.title    ?? item.position ?? null,
            source:      'signalhire',
          };
          logger.info('SignalHire: contact found', { leadId: lead.id, email: result.email });
          return result;
        }
      } catch (pollErr) {
        logger.warn('SignalHire: poll attempt failed', { attempt, err: pollErr.message });
      }
    }

    logger.info('SignalHire: timed out, no result', { requestId });
    return null;
  } catch (err) {
    logger.error('SignalHire: search failed', { err: err.message, leadId: lead.id });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Apollo.io — mirrors working Python pipeline:
//   GET  /organizations/enrich  → org_id (FREE)
//   POST /mixed_people/api_search with organization_ids (FREE)
//   POST /people/match with { id } (1 CREDIT)
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

async function apolloSearchPeopleByOrgId(orgId, headers, jobTitle = null, perPage = 10) {
  const payload = {
    organization_ids: [orgId],
    per_page: perPage,
    page: 1,
  };
  if (jobTitle) {
    payload.person_titles = [jobTitle];
    payload.include_similar_titles = true;
  }

  try {
    const { data } = await axios.post(
      'https://api.apollo.io/api/v1/mixed_people/api_search',
      payload,
      { headers, timeout: 15000 }
    );
    const people = data?.people || [];
    logger.info('Apollo: people search by org_id', { orgId, found: people.length });
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

async function enrichViaApollo(lead) {
  if (!config.apollo?.apiKey) {
    logger.warn('Apollo: APOLLO_API_KEY not set — skipping');
    return null;
  }

  const domain = extractCompanyDomain(lead);
  if (!domain && !lead.companyName) {
    logger.warn('Apollo: no domain or company name', { leadId: lead.id });
    return null;
  }

  const apolloHeaders = {
    'accept': 'application/json',
    'Cache-Control': 'no-cache',
    'Content-Type': 'application/json',
    'x-api-key': config.apollo.apiKey,
  };

  // ── Step 1: Enrich org by domain → get org_id (FREE) ──
  let orgId = null;
  if (domain) {
    const org = await apolloEnrichOrganization(domain, apolloHeaders);
    orgId = org?.id || null;
  }

  // ── Step 2: Search people by org_id (FREE) ──
  let people = [];
  if (orgId) {
    for (const title of ['CEO', 'CTO', 'Founder', 'Managing Director', 'Director']) {
      people = await apolloSearchPeopleByOrgId(orgId, apolloHeaders, title, 5);
      if (people.length > 0) break;
    }
    if (people.length === 0) {
      people = await apolloSearchPeopleByOrgId(orgId, apolloHeaders, null, 10);
    }
  }

  // Fallback: domain/name search if org_id route failed
  if (people.length === 0) {
    logger.info('Apollo: org_id route found no people, falling back to domain/name search', { leadId: lead.id });
    const searchBody = {
      page: 1,
      per_page: 5,
      person_titles: [
        'CEO', 'CTO', 'Founder', 'Co-Founder', 'Managing Director',
        'VP Engineering', 'Head of IT', 'Director',
      ],
    };
    if (domain) {
      searchBody.organization_domains = [domain];
    } else if (lead.companyName) {
      searchBody.organization_names = [lead.companyName];
    }

    try {
      const searchRes = await axios.post(
        'https://api.apollo.io/api/v1/mixed_people/api_search',
        searchBody,
        { headers: apolloHeaders, timeout: 15000 }
      );
      people = searchRes.data?.people || [];
    } catch (err) {
      logger.error('Apollo: fallback search failed', { err: err.message, leadId: lead.id });
    }
  }

  if (!people.length) {
    logger.info('Apollo: no people found', { leadId: lead.id });
    return null;
  }

  // ── Step 3: Enrich person by Apollo ID (1 CREDIT) ──
  // Sort: people with has_email=true first
  const sorted = [...people].sort((a, b) => {
    if (a.has_email && !b.has_email) return -1;
    if (!a.has_email && b.has_email) return 1;
    return 0;
  });

  for (const person of sorted) {
    const apolloId = person.id;
    if (!apolloId) continue;

    logger.info('Apollo: enriching person by ID', {
      apolloId,
      name: [person.first_name, person.last_name || person.last_name_obfuscated].filter(Boolean).join(' '),
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

  // Last fallback: return best search data as-is (no credit spent)
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

async function enrichLeadContacts(lead) {
  const sh = await enrichViaSignalHire(lead);
  if (sh && (sh.email || sh.phone || sh.linkedinUrl)) return sh;
  return enrichViaApollo(lead);
}

module.exports = { enrichViaSignalHire, enrichViaApollo, enrichLeadContacts, normalizeLinkedinUrl };
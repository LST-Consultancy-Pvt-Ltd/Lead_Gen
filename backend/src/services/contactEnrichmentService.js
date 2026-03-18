/**
 * contactEnrichmentService.js
 *
 * Two independently callable enrichment functions:
 *   enrichViaSignalHire(lead)  →  ContactResult | null
 *   enrichViaApollo(lead)      →  ContactResult | null
 *
 * KEY IMPROVEMENTS over previous version:
 *  - SignalHire now tries companyLinkedinUrl (company page search) first,
 *    then contactLinkedin (person profile), then domain, then company name
 *  - Apollo now searches by companyLinkedinUrl domain if available
 *  - Both pass richer candidate data to get better hit rates
 *
 * ContactResult {
 *   email       : string | null
 *   phone       : string | null
 *   linkedinUrl : string | null   ← contact person's linkedin
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
  // Try to derive from companyLinkedinUrl (e.g. linkedin.com/company/techflow-inc → skip)
  if (lead.sourceUrl) {
    try {
      const hostname = new URL(lead.sourceUrl).hostname.replace('www.', '');
      return AGGREGATOR_DOMAINS.some(d => hostname.includes(d)) ? null : hostname;
    } catch { return null; }
  }
  return null;
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

  // Build best candidate descriptor
  let candidate = null;

  if (lead.contactLinkedin) {
    // Best: specific person profile
    candidate = { linkedin: normalizeLinkedinUrl(lead.contactLinkedin) };
  } else if (lead.linkedinUrl) {
    // Company LinkedIn page — SignalHire can find decision-makers from it
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

    // Poll up to 8 × 5s = 40s
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
// 2. Apollo.io
//
// Search priority:
//   1. domain from website          → most accurate org match
//   2. domain from companyLinkedin  → e.g. linkedin.com/company/techflow-inc → try techflow.com
//   3. organization name            → fallback
//
// API flow:
//   POST /v1/mixed_people/search → { people: [...] }
//   POST /v1/people/match        → reveal email (if not present)
// ─────────────────────────────────────────────────────────────────────────────

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

  // Build search body WITHOUT api_key (goes in header)
  const searchBody = {
    page: 1,
    per_page: 1,
  };

  // Company targeting
  if (domain) {
    searchBody.organization_domains = [domain];
  } else if (lead.companyName) {
    searchBody.organization_names = [lead.companyName];
  }

  // Contact targeting
  if (lead.contactName) {
    searchBody.q_keywords = lead.contactName;
  } else {
    // Target decision-makers when we have no specific name
    searchBody.person_titles = [
      'CTO', 'Chief Technology Officer',
      'VP Engineering', 'VP of Engineering',
      'Head of Engineering', 'Head of IT',
      'IT Manager', 'IT Director',
      'Director of Technology', 'Director of IT',
      'CEO', 'Chief Executive Officer',
      'Founder', 'Co-Founder',
      'Managing Director'
    ];
  }

  logger.info('Apollo: starting people search', { 
    domain,
    company: lead.companyName,
    leadId: lead.id
  });

  try {
    const searchRes = await axios.post(
      'https://api.apollo.io/api/v1/mixed_people/api_search',
      searchBody,
      {
        headers: { 
          'Cache-Control': 'no-cache',
          'Content-Type': 'application/json',
          'accept': 'application/json',
          'X-Api-Key': config.apollo.apiKey
        },
        timeout: 15000,
      }
    );

    const person = searchRes.data?.people?.[0];
    if (!person) {
      logger.info('Apollo: no person found', { domain, leadId: lead.id });
      return null;
    }

    // Log what Apollo returned
    logger.info('Apollo: raw person data', { 
      leadId: lead.id,
      personId: person.id,
      firstName: person.first_name,
      lastName: person.last_name,
      name: person.name,
      email: person.email,
      title: person.title,
      hasEmailStatus: person.email_status,
      organizationName: person.organization?.name
    });

    // Try to get email - Apollo often requires reveal/match call
    let email = person.email ?? null;
    
    if (!email && person.id) {
      try {
        logger.info('Apollo: attempting email reveal', { personId: person.id });
        
        const matchRes = await axios.post(
          'https://api.apollo.io/v1/people/match',
          { 
            id: person.id,
            reveal_personal_emails: true  // Changed to true to attempt reveal
          },
          {
            headers: { 
              'Cache-Control': 'no-cache',
              'Content-Type': 'application/json',
              'accept': 'application/json',
              'X-Api-Key': config.apollo.apiKey
            },
            timeout: 10000
          }
        );
        
        email = matchRes.data?.person?.email ?? null;
        logger.info('Apollo: email reveal result', { 
          personId: person.id,
          emailFound: !!email,
          email: email
        });
      } catch (matchErr) {
        logger.warn('Apollo: people/match failed', { 
          err: matchErr.message,
          responseData: matchErr.response?.data
        });
      }
    }

    // Construct full name - try multiple fields
    let fullName = null;
    if (person.first_name || person.last_name) {
      fullName = [person.first_name, person.last_name].filter(Boolean).join(' ');
    } else if (person.name) {
      fullName = person.name;
    }

    const result = {
      email,
      phone: person.phone_numbers?.[0]?.raw_number ?? null,
      linkedinUrl: person.linkedin_url ?? null,
      name: fullName,
      title: person.title ?? null,
      source: 'apollo',
    };

    logger.info('Apollo: final contact result', { 
      leadId: lead.id,
      email: result.email,
      name: result.name,
      title: result.title,
      phone: result.phone
    });
    
    return result;
  } catch (err) {
    logger.error('Apollo: search failed', { 
      err: err.message,
      responseData: err.response?.data,
      leadId: lead.id
    });
    return null;
  }
}
async function enrichLeadContacts(lead) {
  const sh = await enrichViaSignalHire(lead);
  if (sh && (sh.email || sh.phone || sh.linkedinUrl)) return sh;
  return enrichViaApollo(lead);
}

function normalizeLinkedinUrl(url) {
  if (!url) return url;
  if (url.startsWith('http')) return url;
  if (/^(?:www\.)?linkedin\.com\//i.test(url)) return `https://www.${url.replace(/^www\./, '')}`;
  return `https://www.linkedin.com/${url.replace(/^\//, '')}`;
}

module.exports = { enrichViaSignalHire, enrichViaApollo, enrichLeadContacts, normalizeLinkedinUrl };

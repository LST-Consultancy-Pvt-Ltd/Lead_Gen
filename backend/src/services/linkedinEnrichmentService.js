/**
 * linkedinEnrichmentService.js
 *
 * Fully automatic enrichment run after a lead is saved.
 * No extra API keys needed — uses SerpAPI (already configured)
 * and Clearbit Autocomplete (free, no key).
 *
 * Exports:
 *   findCompanyLinkedin(lead)   → { companyLinkedinUrl, contactLinkedin } | null
 *   fetchBasicCompanyInfo(lead) → { industry, location, companySize, description, logo } | null
 *   findDecisionMakerLinkedin(lead) → string (linkedin.com/in/...) | null
 */

const axios  = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function extractLinkedinCompanyUrl(text) {
  const m = (text || '').match(
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/company\/([a-zA-Z0-9_%-]+)/i
  );
  return m ? `https://www.linkedin.com/company/${m[1]}` : null;
}

function extractLinkedinPersonUrl(text) {
  // Exclude company pages accidentally matched as /in/
  const m = (text || '').match(
    /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([a-zA-Z0-9_%-]{3,})/i
  );
  return m ? `https://www.linkedin.com/in/${m[1]}` : null;
}

function getDomain(lead) {
  if (!lead.website) return null;
  return lead.website.replace(/^https?:\/\//, '').split('/')[0].replace('www.', '');
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
    logger.warn('linkedinEnrichment: SerpAPI failed', { query, err: err.message });
    return [];
  }
}

async function serpFull(query) {
  if (!config.serpapi?.key) return null;
  try {
    const { data } = await axios.get('https://serpapi.com/search', {
      params: { api_key: config.serpapi.key, q: query, num: 3, engine: 'google' },
      timeout: 12000,
    });
    return data;
  } catch (err) {
    logger.warn('linkedinEnrichment: SerpAPI full failed', { query, err: err.message });
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Find company LinkedIn URL
//
// Strategies tried in order:
//   A. site:linkedin.com/company "CompanyName"   ← direct, exact
//   B. "CompanyName" LinkedIn company page        ← broader
//   C. companyDomain site:linkedin.com/company    ← domain-based
//
// Also grabs any decision-maker linkedin.com/in/ URL found along the way.
// ─────────────────────────────────────────────────────────────────────────────

async function findCompanyLinkedin(lead) {
  const name   = lead.companyName;
  const domain = getDomain(lead);
  if (!name) return null;

  let companyLinkedinUrl = null;
  let contactLinkedin   = null;

  // Strategy A — most precise
  const resultsA = await serpSearch(`site:linkedin.com/company "${name}"`);
  for (const r of resultsA) {
    const combined = `${r.link} ${r.title || ''} ${r.snippet || ''}`;
    if (!companyLinkedinUrl) companyLinkedinUrl = extractLinkedinCompanyUrl(combined);
    if (!contactLinkedin)   contactLinkedin    = extractLinkedinPersonUrl(combined);
    if (companyLinkedinUrl) break;
  }
  if (companyLinkedinUrl) {
    logger.info('LinkedIn company found (A)', { company: name, companyLinkedinUrl });
    return { companyLinkedinUrl, contactLinkedin };
  }

  // Strategy B — broader query
  const resultsB = await serpSearch(`"${name}" LinkedIn company page`);
  for (const r of resultsB) {
    const combined = `${r.link} ${r.title || ''} ${r.snippet || ''}`;
    if (!companyLinkedinUrl) companyLinkedinUrl = extractLinkedinCompanyUrl(combined);
    if (!contactLinkedin)   contactLinkedin    = extractLinkedinPersonUrl(combined);
    if (companyLinkedinUrl) break;
  }
  if (companyLinkedinUrl) {
    logger.info('LinkedIn company found (B)', { company: name, companyLinkedinUrl });
    return { companyLinkedinUrl, contactLinkedin };
  }

  // Strategy C — domain-based
  if (domain) {
    const resultsC = await serpSearch(`${domain} site:linkedin.com/company`);
    for (const r of resultsC) {
      const combined = `${r.link} ${r.title || ''} ${r.snippet || ''}`;
      if (!companyLinkedinUrl) companyLinkedinUrl = extractLinkedinCompanyUrl(combined);
      if (!contactLinkedin)   contactLinkedin    = extractLinkedinPersonUrl(combined);
      if (companyLinkedinUrl) break;
    }
  }

  if (!companyLinkedinUrl && !contactLinkedin) {
    logger.info('LinkedIn not found', { company: name });
    return null;
  }

  logger.info('LinkedIn result', { company: name, companyLinkedinUrl, contactLinkedin });
  return { companyLinkedinUrl, contactLinkedin };
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Find decision-maker LinkedIn profile
//
// Used in Phase 2 when SignalHire/Apollo fail — searches Google for
// a CTO/CEO/VP profile at the company so we can pass the URL to SignalHire.
// ─────────────────────────────────────────────────────────────────────────────

async function findDecisionMakerLinkedin(lead) {
  const name   = lead.companyName;
  const domain = getDomain(lead);
  if (!name) return null;

  const qualifier = domain || name;
  const titles    = '(CTO OR CEO OR Founder OR "VP Engineering" OR "Head of IT" OR "IT Director" OR "Managing Director")';
  const query     = `site:linkedin.com/in "${qualifier}" ${titles}`;

  const results = await serpSearch(query, 5);
  for (const r of results) {
    // Result link itself is usually the LinkedIn profile URL
    const url = extractLinkedinPersonUrl(r.link);
    if (url) {
      logger.info('Decision-maker LinkedIn found', { company: name, url });
      return url;
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Fetch basic company info
//
// Sources (no new API keys):
//   A. Clearbit Autocomplete — free, no key → domain, logo
//   B. SerpAPI Knowledge Graph              → description, industry, HQ, employees
//   C. SerpAPI organic snippet fallback     → description if KG empty
// ─────────────────────────────────────────────────────────────────────────────

async function fetchBasicCompanyInfo(lead) {
  const name   = lead.companyName;
  const domain = getDomain(lead);

  const result = {
    industry:    lead.industry    || null,
    location:    lead.location    || null,
    companySize: lead.companySize || null,
    description: lead.description || null,
    logo:        null,
  };

  // ── A. Clearbit Autocomplete ──
  try {
    const query = encodeURIComponent(domain || name);
    const { data } = await axios.get(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${query}`,
      { timeout: 6000 }
    );
    const match = Array.isArray(data) && data.length > 0 ? data[0] : null;
    if (match) {
      if (match.logo)                      result.logo    = match.logo;
      if (match.domain && !result.website) result.website = match.domain;
      logger.info('basicInfo: Clearbit hit', { company: name });
    }
  } catch (err) {
    logger.debug('basicInfo: Clearbit skipped', { err: err.message });
  }

  // ── B + C. SerpAPI Knowledge Graph ──
  if (!result.description || !result.industry || !result.location) {
    const serpData = await serpFull(`${name} company`);
    if (serpData) {
      const kg = serpData.knowledge_graph;
      if (kg) {
        if (kg.description  && !result.description) result.description = kg.description;
        if (kg.type         && !result.industry)    result.industry    = kg.type;
        if (kg.headquarters && !result.location)    result.location    = kg.headquarters;
        if (kg.employees    && !result.companySize) result.companySize = String(kg.employees);
        logger.info('basicInfo: KG hit', { company: name, type: kg.type });
      }
      if (!result.description) {
        const first = serpData.organic_results?.[0];
        if (first?.snippet) result.description = first.snippet.slice(0, 300);
      }
    }
  }

  const hasNewInfo = result.industry || result.location || result.companySize ||
                     result.description || result.logo;
  return hasNewInfo ? result : null;
}

module.exports = { findCompanyLinkedin, findDecisionMakerLinkedin, fetchBasicCompanyInfo };

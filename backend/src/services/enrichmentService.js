const axios = require('axios');
const config = require('../config');
const logger = require('../utils/logger');

const AGGREGATOR_DOMAINS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'reddit.com',
  'techcrunch.com', 'crunchbase.com', 'github.com', 'angel.co',
  'angellist.com', 'naukri.com', 'monster.com', 'twitter.com',
  'x.com', 'facebook.com', 'youtube.com', 'google.com',
];

function extractDomain(url) {
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    const isAggregator = AGGREGATOR_DOMAINS.some(d => hostname.includes(d));
    return isAggregator ? null : hostname;
  } catch {
    return null;
  }
}

// SignalHire is async — you POST a request, then poll for results
async function findContactEmail(lead) {
  if (!config.signalhire.apiKey) return null;

  // Resolve best available domain: website > sourceUrl domain
  const domain = lead.website
    ? lead.website.replace(/^https?:\/\//, '').split('/')[0]
    : (lead.sourceUrl ? extractDomain(lead.sourceUrl) : null);

  // Build candidate — LinkedIn is best, then name+domain, then companyName+domain
  let candidate = null;
  if (lead.contactLinkedin) {
    candidate = { linkedin: lead.contactLinkedin };
  } else if (domain) {
    candidate = {
      name: lead.contactName || lead.companyName,
      current_employer: domain,
    };
  } else if (lead.companyName) {
    candidate = { name: lead.companyName };
  }

  if (!candidate) {
    logger.warn('SignalHire: not enough data to search for lead', { leadId: lead.id });
    return null;
  }

  logger.info('SignalHire search candidate', { candidate });

  try {
    const { data } = await axios.post(
      'https://www.signalhire.com/api/v1/candidate/search',
      { items: [candidate], callback_url: null },
      { headers: { apikey: config.signalhire.apiKey } }
    );

    const requestId = data?.requestId;
    if (!requestId) return null;

    for (let i = 0; i < 6; i++) {
      await new Promise(r => setTimeout(r, 5000));
      const poll = await axios.get(
        `https://www.signalhire.com/api/v1/request/${requestId}`,
        { headers: { apikey: config.signalhire.apiKey } }
      );

      const result = poll.data?.items?.[0];
      if (result?.contacts) {
        const emailContact = result.contacts.find(c => c.type === 'email');
        return emailContact?.value ?? null;
      }
    }
    return null;
  } catch (err) {
    logger.error('SignalHire enrichment failed', { err: err.message });
    return null;
  }
}

module.exports = { findContactEmail };
const OpenAI = require('openai');
const config = require('../config');
const logger = require('../utils/logger');

let openai;
function getOpenAI() {
  if (!openai && config.openai.apiKey) {
    openai = new OpenAI({ apiKey: config.openai.apiKey });
  }
  return openai;
}

function parseJSONResponse(text) {
  const stripped = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  return JSON.parse(stripped);
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead scoring / analysis
// ─────────────────────────────────────────────────────────────────────────────

async function analyzeLeadIntent(lead, services) {
  const client = getOpenAI();
  if (!client) return fallbackScoring(lead);

  try {
    const prompt = `You are an expert B2B sales intelligence analyst.

Company: ${lead.companyName}
Industry: ${lead.industry || 'Unknown'}
Tech Stack: ${(lead.techStack || []).join(', ')}
Job Postings: ${JSON.stringify(lead.jobPostings?.slice(0, 3))}
Signals: ${JSON.stringify(lead.intentSignals?.slice(0, 5))}

Our Services: ${services.join(', ')}

Analyze this lead and respond with ONLY valid JSON (no markdown):
{
  "leadScore": <0-100>,
  "intentScore": <0-100>,
  "intentLevel": <"hot"|"warm"|"cold">,
  "opportunity": "<concise opportunity description>",
  "aiSummary": "<2-3 sentence company analysis>",
  "aiPitch": "<personalized 2-sentence sales pitch>",
  "reasoning": "<brief scoring reasoning>"
}`;

    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });

    return parseJSONResponse(response.choices[0].message.content.trim());
  } catch (err) {
    logger.error('AI analysis failed', { err: err.message });
    return fallbackScoring(lead);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Outreach email generation
// ─────────────────────────────────────────────────────────────────────────────

async function generateOutreachEmail(lead, senderName, services) {
  const client = getOpenAI();
  if (!client) return fallbackEmail(lead, senderName, services);

  try {
    const signals = (lead.intentSignals || []).map(s => s.text || s).join('; ');
    const prompt = `Write a concise, personalized B2B outreach email.

Target:
- Name: ${lead.contactName || 'there'}
- Title: ${lead.contactTitle || 'Decision Maker'}
- Company: ${lead.companyName}
- Industry: ${lead.industry}
- Tech Stack: ${(lead.techStack || []).join(', ')}
- Intent Signals: ${signals}
- Opportunity: ${lead.opportunity || 'General consulting'}

Sender: ${senderName}
Our Services: ${services.join(', ')}

Rules:
- Max 150 words
- Reference a specific signal (job posting, funding, tech stack)
- Clear value proposition
- Single soft CTA (15-min call)
- No generic openers like "Hope this finds you well"

Respond ONLY with JSON (no markdown):
{
  "subject": "<compelling subject line>",
  "body": "<email body with line breaks>"
}`;

    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 400,
    });

    return parseJSONResponse(response.choices[0].message.content.trim());
  } catch (err) {
    logger.error('Email generation failed', { err: err.message });
    return fallbackEmail(lead, senderName, services);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Lead extraction from search result
//
// KEY IMPROVEMENT: now extracts
//   - companyLinkedinUrl  (linkedin.com/company/...)
//   - contactLinkedin     (linkedin.com/in/...)
//   - contactName / contactTitle from the snippet
//   - industry, location, companySize if inferrable
// ─────────────────────────────────────────────────────────────────────────────

async function extractLeadFromSearchResult(searchResult, services, filters = {}) {
  const client = getOpenAI();
  if (!client) return fallbackExtract(searchResult);

  const { workTypes = [], targetIndustry = '', targetRegion = '' } = filters;

  const filterContext = [
    targetIndustry ? `Target Industry: ${targetIndustry}` : null,
    targetRegion   ? `Target Region: ${targetRegion}`     : null,
    workTypes.length ? `Work Arrangement: ${workTypes.join(' or ')}` : null,
  ].filter(Boolean).join('\n');

  try {
    const prompt = `Extract B2B lead data from this search result.

Search Result:
Title: ${searchResult.title}
Snippet: ${searchResult.snippet}
URL: ${searchResult.link}

Our Services: ${services.join(', ')}
${filterContext ? `\nTarget Profile:\n${filterContext}` : ''}

RULES:
1. "website": the company's OWN domain (e.g. techflow.com). NEVER use linkedin.com, indeed.com, reddit.com, techcrunch.com, crunchbase.com, glassdoor.com, github.com, etc.
2. "companyLinkedinUrl": if you see a linkedin.com/company/... URL anywhere in the title, snippet, or source URL — extract it EXACTLY. Otherwise null.
3. "contactLinkedin": if you see a linkedin.com/in/... URL — extract it EXACTLY. Otherwise null.
4. "contactName" / "contactTitle": extract any person mentioned as CEO, CTO, VP, Director, Head of, Founder. Otherwise null.
5. "industry": infer from snippet. "location": infer city/country if mentioned. "companySize": infer (e.g. "50-200") if mentioned.
6. Return null (not an object) if this is not a valid B2B company lead.

Respond ONLY with JSON or the literal string null:
{
  "companyName": "",
  "website": "",
  "companyLinkedinUrl": null,
  "industry": "",
  "location": "",
  "companySize": "",
  "signalType": "hiring|funding|tech|social|content",
  "signalText": "",
  "confidence": <0-100>,
  "relevanceScore": <0-100>,
  "contactName": null,
  "contactTitle": null,
  "contactLinkedin": null,
  "linkedinUrl": null
}`;

    const response = await client.chat.completions.create({
      model: config.openai.model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.1,
      max_tokens: 300,
    });

    const text = response.choices[0].message.content.trim();
    if (text === 'null' || text === '{}') return null;
    const parsed = parseJSONResponse(text);

    // Normalise: contactLinkedin wins over linkedinUrl for person profiles
    if (!parsed.contactLinkedin && parsed.linkedinUrl &&
        parsed.linkedinUrl.includes('linkedin.com/in/')) {
      parsed.contactLinkedin = parsed.linkedinUrl;
    }

    return parsed;
  } catch {
    return fallbackExtract(searchResult);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Fallbacks (no OpenAI)
// ─────────────────────────────────────────────────────────────────────────────

const AGGREGATOR_DOMAINS = [
  'linkedin.com', 'indeed.com', 'glassdoor.com', 'reddit.com',
  'techcrunch.com', 'crunchbase.com', 'github.com', 'angel.co',
  'angellist.com', 'naukri.com', 'monster.com', 'twitter.com',
  'x.com', 'facebook.com',
];

function fallbackExtract(result) {
  const title   = result.title   || '';
  const snippet = result.snippet || '';
  const url     = result.link    || '';

  const companyMatch = title.match(/^([A-Z][^|–-]+?)\s+(?:hiring|announces|raises|is|seeks|looking)/i);
  const companyName  = companyMatch ? companyMatch[1].trim() : title.split(' ').slice(0, 3).join(' ');

  let website = '';
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    if (!AGGREGATOR_DOMAINS.some(a => hostname.includes(a))) website = hostname;
  } catch {}

  // Extract LinkedIn URLs from snippet/title
  const companyLinkedinMatch = (snippet + ' ' + title).match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/i);
  const companyLinkedinUrl   = companyLinkedinMatch
    ? `https://www.linkedin.com/company/${companyLinkedinMatch[1]}`
    : null;

  const contactLinkedinMatch = (snippet + ' ' + title).match(/linkedin\.com\/in\/([a-zA-Z0-9_-]+)/i);
  const contactLinkedin      = contactLinkedinMatch
    ? `https://www.linkedin.com/in/${contactLinkedinMatch[1]}`
    : null;

  // Also check if the source URL itself is a person LinkedIn profile
  let contactLinkedinFinal = contactLinkedin;
  try {
    const u = new URL(url);
    if (u.hostname.includes('linkedin.com') && u.pathname.startsWith('/in/')) {
      contactLinkedinFinal = url;
    }
  } catch {}

  const isHiring  = /hiring|job|career|recruit/i.test(title + snippet);
  const isFunding = /raised|funding|series|million|\$\d/i.test(title + snippet);

  return {
    companyName,
    website,
    companyLinkedinUrl,
    industry: 'Technology',
    location: '',
    companySize: '',
    signalType:  isHiring ? 'hiring' : isFunding ? 'funding' : 'content',
    signalText:  snippet.slice(0, 120),
    confidence:  55,
    relevanceScore: 60,
    contactName:    null,
    contactTitle:   null,
    contactLinkedin: contactLinkedinFinal,
  };
}

function fallbackScoring(lead) {
  const signals      = lead.intentSignals?.length || 0;
  const hasPostings  = lead.jobPostings?.length > 0;
  const score        = Math.min(95, 40 + signals * 10 + (hasPostings ? 20 : 0));
  return {
    leadScore:    score,
    intentScore:  Math.max(score - 5, 10),
    intentLevel:  score >= 75 ? 'hot' : score >= 50 ? 'warm' : 'cold',
    opportunity:  `Potential need for ${lead.techStack?.[0] || 'ERP'} consulting services`,
    aiSummary:    `${lead.companyName} is a ${lead.industry || 'technology'} company showing signals of needing consulting services.`,
    aiPitch:      `We specialize in helping ${lead.industry || 'technology'} companies optimize their operations. I'd love to explore how we can help ${lead.companyName}.`,
    reasoning:    'Score based on available signals (AI unavailable)',
  };
}

function fallbackEmail(lead, senderName, services) {
  const firstName = lead.contactName?.split(' ')[0] || 'there';
  const signal    = lead.intentSignals?.[0]?.text || `your work at ${lead.companyName}`;
  return {
    subject: `Quick question about ${lead.companyName}'s ${lead.techStack?.[0] || 'tech'} setup`,
    body: `Hi ${firstName},\n\nI noticed ${signal} and thought there might be a natural fit.\n\nWe help ${lead.industry || 'technology'} companies with ${services[0] || 'consulting services'} — typically saving teams significant time and reducing manual work.\n\nWould you be open to a quick 15-minute call to see if there's a fit?\n\nBest,\n${senderName}`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Generic OpenAI caller used by productDiscoveryService
// ─────────────────────────────────────────────────────────────────────────────

async function callOpenAI(systemPrompt, userPrompt, maxTokens = 600) {
  const client = getOpenAI();
  if (!client) throw new Error('OpenAI not configured');
  const res = await client.chat.completions.create({
    model: config.openai.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content: userPrompt },
    ],
    max_tokens: maxTokens,
    temperature: 0.3,
  });
  return res.choices[0].message.content;
}

module.exports = {
  analyzeLeadIntent,
  generateOutreachEmail,
  extractLeadFromSearchResult,
  callOpenAI,
};

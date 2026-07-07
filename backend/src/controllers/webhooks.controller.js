/**
 * webhooks.controller.js
 *
 * Receives asynchronous results pushed by external providers. Currently:
 *   POST /api/webhooks/signalhire  — SignalHire posts candidate results here.
 *
 * This route is PUBLIC (no auth) — SignalHire cannot send our JWT. We match the
 * pushed result back to the lead via the pending store (by requestId or the query
 * identifier we submitted), then write the contact onto the lead.
 */
const prisma = require('../utils/prisma');
const logger = require('../utils/logger');
const signalhirePending = require('../services/signalhirePending');
const { companyLinkedinForDomain } = require('../services/leadEnrichmentPipeline');

function pick(contacts = [], types) {
  const hit = contacts.find(c => types.includes(String(c.type || '').toLowerCase()));
  return hit ? hit.value : null;
}

// Free/personal email providers — anything NOT in this set with a real domain is
// treated as a corporate (work) email.
const FREE_EMAIL_DOMAINS = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.co.uk', 'ymail.com',
  'hotmail.com', 'hotmail.co.uk', 'outlook.com', 'live.com', 'msn.com', 'aol.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'gmx.com',
  'zoho.com', 'mail.com', 'yandex.com', 'rediffmail.com', 'inbox.com', 'fastmail.com',
]);
function emailDomain(e) { return String(e || '').toLowerCase().split('@')[1] || ''; }
function isCorporateEmail(e) { const d = emailDomain(e); return !!d && !FREE_EMAIL_DOMAINS.has(d); }

// Pick a CORPORATE email only (skip personal/free providers). Prefers one whose
// domain matches the company's, then any work-tagged corporate email, then any
// corporate email. Returns null if only personal emails exist.
function pickCorporateEmail(contacts, companyDomain) {
  const emails = contacts
    .filter(c => String(c.type || '').toLowerCase().includes('email') && c.value)
    .map(c => ({ value: c.value, sub: String(c.subType || c.info || c.type || '').toLowerCase() }));
  if (!emails.length) return null;
  if (companyDomain) {
    const m = emails.find(e => emailDomain(e.value) === companyDomain.toLowerCase());
    if (m) return m.value;
  }
  const work = emails.find(e => e.sub.includes('work') && isCorporateEmail(e.value));
  if (work) return work.value;
  const corp = emails.find(e => isCorporateEmail(e.value));
  return corp ? corp.value : null;
}

// Pick a work/office phone; skip ones explicitly tagged personal/home. Prefers a
// work-tagged number, else the first non-personal one.
function pickWorkPhone(contacts) {
  const phones = contacts
    .filter(c => /phone|tel|mobile/.test(String(c.type || '').toLowerCase()) && c.value)
    .map(c => ({ value: c.value, sub: String(c.subType || c.type || c.info || '').toLowerCase() }));
  if (!phones.length) return null;
  const work = phones.find(p => /work|office|direct|company/.test(p.sub));
  if (work) return work.value;
  const nonPersonal = phones.find(p => !/personal|home/.test(p.sub));
  return nonPersonal ? nonPersonal.value : null;
}

// LinkedIn can live in `contacts`, in a `social`/`socials`/`links` array, or as a
// direct field on the candidate — check all of them.
function extractLinkedin(candidate = {}, contacts = []) {
  const fromContacts = pick(contacts, ['linkedin'])
    || (contacts.find(c => String(c.value || '').includes('linkedin.com')) || {}).value;
  if (fromContacts) return fromContacts;

  const socials = candidate.social || candidate.socials || candidate.links || [];
  if (Array.isArray(socials)) {
    for (const s of socials) {
      const v = typeof s === 'string' ? s : (s.link || s.url || s.value || '');
      if (String(v).includes('linkedin.com')) return v;
    }
  }
  for (const k of ['linkedinUrl', 'linkedin', 'linkedIn']) {
    if (candidate[k] && String(candidate[k]).includes('linkedin')) return candidate[k];
  }
  return null;
}

// SignalHire's payload often carries the current employer's LinkedIn URL either on
// the current experience entry (companyUrl / companyLinkedInUrl / company.linkedInUrl)
// or on a top-level organization/company sub-object. We check all of the shapes
// they've been observed to use and return the first /company/ URL we find.
function extractCompanyLinkedin(candidate = {}) {
  const exp = Array.isArray(candidate.experience) ? candidate.experience : [];
  const current =
    exp.find(e => e && (e.current === true || e.current === 'true')) ||
    exp.find(e => e && e.started && (e.ended == null || e.ended === '')) ||
    exp[0] || {};
  const urls = [
    current.companyLinkedInUrl, current.companyLinkedinUrl, current.companyUrl,
    current.company?.linkedInUrl, current.company?.linkedinUrl, current.company?.url,
    current.organization?.linkedInUrl, current.organization?.linkedinUrl, current.organization?.url,
    candidate.organization?.linkedInUrl, candidate.organization?.linkedinUrl, candidate.organization?.url,
    candidate.company?.linkedInUrl, candidate.company?.linkedinUrl, candidate.company?.url,
  ];
  for (const u of urls) {
    if (u && /linkedin\.com\/company\//i.test(String(u))) return String(u);
  }
  return null;
}

function extractPerson(it, found) {
  const candidate = it.candidate || it.profile || it;
  const contacts  = candidate.contacts || it.contacts || [];
  const title = candidate.title || candidate.position
    || (Array.isArray(candidate.experience) ? candidate.experience[0]?.title || candidate.experience[0]?.position : null)
    || found.contactTitle || null;
  // Corporate-only: skip personal emails (free providers) and personal phones.
  return {
    email:    pickCorporateEmail(contacts, found.companyDomain || ''),
    phone:    pickWorkPhone(contacts),
    linkedin: extractLinkedin(candidate, contacts),
    name:     candidate.fullName || candidate.name || found.contactName || null,
    title,
  };
}

async function handleSignalHire(req, res) {
  // Acknowledge immediately so SignalHire doesn't retry; process inline (fast).
  const body = req.body;
  logger.info('SignalHire webhook received', { payload: JSON.stringify(body).slice(0, 3000) });

  try {
    const topRequestId = body?.requestId ?? body?.request_id;
    // Body shape varies: a bare array of results, or { items: [...] } / { candidates: [...] }.
    const items = Array.isArray(body) ? body : (body?.items || body?.candidates || []);

    // Track revealed company-search contacts so we can promote the highest-ranked one
    // to the lead's PRIMARY contact (so it shows on All Leads + Lead Details).
    // Also carry the first company LinkedIn URL we see, so we can save it on the lead
    // when the lead doesn't have one yet.
    const revealedByLead = new Map(); // leadId -> { organizationId, best: {rank, contact}, companyLinkedin }

    for (const it of items) {
      // The original query identifier SignalHire echoes back (key for matching).
      const queryItem = it.item || it.query || it.uid || null;
      const found = signalhirePending.consume([topRequestId, it.requestId, queryItem]);
      if (!found) {
        logger.warn('SignalHire webhook: no pending lead matched', { requestId: topRequestId, queryItem, status: it.status });
        continue;
      }

      const p = extractPerson(it, found);
      const hasAny = p.email || p.phone || p.linkedin;

      // ── Multi-contact (company search) → create a Contact record ──
      if (found.mode === 'contact') {
        if (!hasAny && !p.name) {
          logger.info('SignalHire webhook: no usable data for contact', { leadId: found.leadId, status: it.status });
          continue;
        }
        try {
          let existing = null;
          if (p.email)     existing = await prisma.contact.findFirst({ where: { leadId: found.leadId, email: p.email } });
          else if (p.name) existing = await prisma.contact.findFirst({ where: { leadId: found.leadId, name: p.name } });
          if (!existing) {
            await prisma.contact.create({
              data: {
                leadId:         found.leadId,
                organizationId: found.organizationId,
                name:           p.name || 'Unknown',
                title:          p.title || null,
                designation:    p.title || null,
                email:          p.email || null,
                phone:          p.phone || null,
                linkedin:       p.linkedin || null,
                decisionMaker:  true,
                createdById:    found.createdById || null,
              },
            });
            logger.info('SignalHire webhook: contact created', { leadId: found.leadId, name: p.name, email: p.email, phone: p.phone, linkedin: p.linkedin });
          } else {
            logger.info('SignalHire webhook: contact already exists', { leadId: found.leadId, name: p.name });
          }
        } catch (e) {
          logger.error('SignalHire webhook: contact create failed', { leadId: found.leadId, err: e.message });
        }

        // Remember the best (lowest-rank = highest role) revealed person per lead so
        // we can promote it to the lead's primary contact after the loop. Also
        // capture the first company LinkedIn URL we see from any of this lead's
        // revealed candidates — SignalHire attaches it to the current-employer entry.
        const candidate = it.candidate || it.profile || it;
        const companyLi = extractCompanyLinkedin(candidate);
        const rank = Number.isFinite(found.rank) ? found.rank : 999;
        const cur = revealedByLead.get(found.leadId);
        const nextBest = (hasAny && (!cur || rank < cur.best.rank))
          ? { rank, contact: p }
          : (cur?.best || null);
        if (hasAny || companyLi) {
          revealedByLead.set(found.leadId, {
            organizationId: found.organizationId,
            best: nextBest,
            companyLinkedin: cur?.companyLinkedin || companyLi || null,
          });
        }
        continue;
      }

      // ── Single reveal (no company) → update the lead's PRIMARY contact ──
      if (!hasAny) {
        logger.info('SignalHire webhook: matched lead but no contact in result', { leadId: found.leadId, status: it.status });
        if (typeof found.resolve === 'function') {
          try { found.resolve({ found: false, status: it.status || 'failed' }); } catch (_) {}
        }
        continue;
      }
      const data = {};
      if (p.email)    data.contactEmail    = p.email;
      if (p.phone)    data.contactPhone    = p.phone;
      if (p.linkedin) data.contactLinkedin = p.linkedin;
      if (p.name)     data.contactName     = p.name;
      if (p.title)    data.contactTitle    = p.title;

      // If SignalHire returned a company LinkedIn URL for the contact's current
      // employer and the lead doesn't have one yet, save it (validated so a
      // mis-tagged / previous-employer link can't overwrite anything).
      const companyLi = extractCompanyLinkedin(it.candidate || it.profile || it);
      if (companyLi) {
        try {
          const lead = await prisma.lead.findUnique({
            where: { id: found.leadId },
            select: { linkedinUrl: true, companyName: true, website: true },
          });
          if (lead && !lead.linkedinUrl) {
            const validated = companyLinkedinForDomain(
              companyLi,
              lead.companyName || '',
              lead.website || found.companyDomain || ''
            );
            if (validated) data.linkedinUrl = validated;
          }
        } catch (e) {
          logger.warn('SignalHire webhook: company LinkedIn lookup failed', { leadId: found.leadId, err: e.message });
        }
      }

      await prisma.lead.update({ where: { id: found.leadId }, data })
        .then(() => logger.info('SignalHire webhook: lead enriched', { leadId: found.leadId, email: p.email, phone: p.phone, linkedin: p.linkedin }))
        .catch(e => logger.error('SignalHire webhook: lead update failed', { leadId: found.leadId, err: e.message }));

      if (typeof found.resolve === 'function') {
        try { found.resolve({ found: true, contact: p }); }
        catch (e) { logger.warn('SignalHire webhook: resolve failed', { err: e.message }); }
      }
    }

    // Promote the highest-ranked revealed person to the lead's PRIMARY contact when
    // the lead doesn't already have one, and save the company LinkedIn URL from the
    // revealed profile if the lead doesn't have one. These are independent — we may
    // update just linkedinUrl on a lead that already has a primary contact.
    for (const [leadId, entry] of revealedByLead) {
      try {
        const lead = await prisma.lead.findUnique({ where: { id: leadId } });
        if (!lead) continue;
        const data = {};

        if (entry.companyLinkedin && !lead.linkedinUrl) {
          const validated = companyLinkedinForDomain(
            entry.companyLinkedin,
            lead.companyName || '',
            lead.website || ''
          );
          if (validated) data.linkedinUrl = validated;
        }

        let promoted = null;
        if (entry.best && !lead.contactName && !lead.contactEmail) {
          const c = entry.best.contact;
          data.contactName     = c.name || null;
          data.contactTitle    = c.title || null;
          data.contactEmail    = c.email || null;
          data.contactPhone    = c.phone || null;
          data.contactLinkedin = c.linkedin || null;
          promoted = c;
        }

        if (Object.keys(data).length === 0) continue;
        await prisma.lead.update({ where: { id: leadId }, data });

        // The promoted person was already inserted as a Contact record earlier in
        // the loop — leaving it there means the Lead Details "Contact Details"
        // table renders the same person twice (once as Primary from the lead
        // fields, once from the Contact row). Remove the matching Contact row so
        // the primary is only shown once.
        if (promoted) {
          const or = [];
          if (promoted.email) or.push({ email: promoted.email });
          if (promoted.name)  or.push({ name: promoted.name, email: null });
          if (or.length) {
            await prisma.contact.deleteMany({ where: { leadId, OR: or } }).catch(err =>
              logger.warn('SignalHire webhook: dedup Contact delete failed', { leadId, err: err.message })
            );
          }
        }
        logger.info('SignalHire webhook: lead updated post-reveal', {
          leadId,
          fields: Object.keys(data),
          promotedRank: entry.best?.rank,
        });
      } catch (e) {
        logger.error('SignalHire webhook: post-reveal update failed', { leadId, err: e.message });
      }
    }
  } catch (err) {
    logger.error('SignalHire webhook error', { err: err.message });
  }

  return res.status(200).json({ received: true });
}

module.exports = { handleSignalHire };

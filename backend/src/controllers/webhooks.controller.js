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

function pick(contacts = [], types) {
  const hit = contacts.find(c => types.includes(String(c.type || '').toLowerCase()));
  return hit ? hit.value : null;
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

function extractPerson(it, found) {
  const candidate = it.candidate || it.profile || it;
  const contacts  = candidate.contacts || it.contacts || [];
  const title = candidate.title || candidate.position
    || (Array.isArray(candidate.experience) ? candidate.experience[0]?.title || candidate.experience[0]?.position : null)
    || found.contactTitle || null;
  return {
    email:    pick(contacts, ['email', 'work_email', 'personal_email']),
    phone:    pick(contacts, ['phone', 'mobile', 'work_phone', 'tel']),
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

      await prisma.lead.update({ where: { id: found.leadId }, data })
        .then(() => logger.info('SignalHire webhook: lead enriched', { leadId: found.leadId, email: p.email, phone: p.phone, linkedin: p.linkedin }))
        .catch(e => logger.error('SignalHire webhook: lead update failed', { leadId: found.leadId, err: e.message }));

      if (typeof found.resolve === 'function') {
        try { found.resolve({ found: true, contact: p }); }
        catch (e) { logger.warn('SignalHire webhook: resolve failed', { err: e.message }); }
      }
    }
  } catch (err) {
    logger.error('SignalHire webhook error', { err: err.message });
  }

  return res.status(200).json({ received: true });
}

module.exports = { handleSignalHire };

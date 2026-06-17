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

function extractContacts(contacts = []) {
  return {
    email:    pick(contacts, ['email', 'work_email', 'personal_email']),
    phone:    pick(contacts, ['phone', 'mobile', 'work_phone', 'tel']),
    linkedin: pick(contacts, ['linkedin'])
              || (contacts.find(c => String(c.value || '').includes('linkedin.com')) || {}).value
              || null,
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

      const candidate = it.candidate || it.profile || it;
      const contacts  = candidate.contacts || it.contacts || [];
      const picked    = extractContacts(contacts);

      if (!picked.email && !picked.phone && !picked.linkedin) {
        logger.info('SignalHire webhook: matched lead but no contact in result', { leadId: found.leadId, status: it.status });
        continue;
      }

      const data = {};
      if (picked.email)    data.contactEmail    = picked.email;
      if (picked.phone)    data.contactPhone    = picked.phone;
      if (picked.linkedin) data.contactLinkedin = picked.linkedin;
      const fullName = candidate.fullName || candidate.name;
      if (fullName)        data.contactName     = data.contactName || fullName;
      const title = candidate.title || candidate.position
        || (Array.isArray(candidate.experience) ? candidate.experience[0]?.position : null);
      if (title)           data.contactTitle    = title;

      await prisma.lead.update({ where: { id: found.leadId }, data })
        .then(() => logger.info('SignalHire webhook: lead enriched', { leadId: found.leadId, ...picked }))
        .catch(e => logger.error('SignalHire webhook: lead update failed', { leadId: found.leadId, err: e.message }));

      // If a synchronous request is waiting on this result, unblock it with the contact.
      if (typeof found.resolve === 'function') {
        try { found.resolve({ ...picked, name: data.contactName || null, title: data.contactTitle || null }); }
        catch (e) { logger.warn('SignalHire webhook: resolve failed', { err: e.message }); }
      }
    }
  } catch (err) {
    logger.error('SignalHire webhook error', { err: err.message });
  }

  return res.status(200).json({ received: true });
}

module.exports = { handleSignalHire };

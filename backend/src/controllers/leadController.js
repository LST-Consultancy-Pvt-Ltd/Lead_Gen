/**
 * leadController.js — full rewrite with domain/industry/contact aggregation
 */
const prisma  = require('../utils/prisma');
const { success, error, paginated } = require('../utils/response');
const dashboardEvents = require('../utils/dashboardEvents');
const { analyzeLeadIntent, generateOutreachEmail } = require('../services/aiService');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');
const { scopeLeadWhere } = require('../middleware/rbac');
const XLSX = require('xlsx');
const { enrichViaSignalHire, enrichViaApollo } = require('../services/leadEnrichmentPipeline');
const { decrementLeadUsage } = require('../utils/leadQuota');

async function getLeads(req, res) {
  try {
    const { page=1, limit=20, status, intent, search, assignedTo, scanJobId, sortBy='createdAt', sortDir='desc' } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = { organizationId: req.user.organizationId };
    if (status)     where.status      = status;
    if (intent)     where.intentLevel = intent;
    if (assignedTo) where.assignedToId = assignedTo;
    if (scanJobId)  where.scanJobId    = scanJobId;   // note: GET /api/leads is served by leads.controller.js → leads.service.js (this handler is legacy)
    if (search) {
      where.OR = [
        { companyName:  { contains: search, mode: 'insensitive' } },
        { contactName:  { contains: search, mode: 'insensitive' } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
        { industry:     { contains: search, mode: 'insensitive' } },
        { website:      { contains: search, mode: 'insensitive' } },
      ];
    }
    if (req.user.role === 'sales_user') where.assignedToId = req.user.id;
    const [leads, total] = await Promise.all([
      prisma.lead.findMany({ where, skip, take: parseInt(limit), orderBy: { [sortBy]: sortDir },
        include: { assignedTo: { select: { id:true, name:true, email:true } } } }),
      prisma.lead.count({ where }),
    ]);
    return paginated(res, leads, total, page, limit);
  } catch (err) {
    logger.error('getLeads error', { err: err.message });
    return error(res, 'Failed to fetch leads', 500);
  }
}

async function getLead(req, res) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        assignedTo: { select: { id:true, name:true, email:true } },
        emails:     { orderBy: { createdAt: 'desc' }, take: 10 },
        activities: { orderBy: { createdAt: 'desc' }, take: 20,
          include: { user: { select: { id:true, name:true } } } },
      },
    });
    if (!lead) return error(res, 'Lead not found', 404);

    // Build aggregated profile shown in the lead detail page
    const domainName = lead.website
      ? lead.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0]
      : null;
    const website = lead.website
      ? (lead.website.startsWith('http') ? lead.website : `https://${lead.website}`)
      : null;

    const aggregated = {
      companyName: lead.companyName, domainName, website,
      industry: lead.industry || null, companySize: lead.companySize || null,
      location: lead.location || null, description: lead.description || null,
      techStack: lead.techStack || [], linkedinUrl: lead.linkedinUrl || null,
      contactName: lead.contactName || null, contactTitle: lead.contactTitle || null,
      contactEmail: lead.contactEmail || null, contactLinkedin: lead.contactLinkedin || null,
      contactPhone: lead.contactPhone || null,
      leadScore: lead.leadScore, intentScore: lead.intentScore,
      intentLevel: lead.intentLevel, opportunity: lead.opportunity,
      aiSummary: lead.aiSummary, aiPitch: lead.aiPitch,
      intentSignals: lead.intentSignals || [], jobPostings: lead.jobPostings || [],
      source: lead.source, sourceUrl: lead.sourceUrl,
    };
    return success(res, { ...lead, aggregated });
  } catch (err) {
    logger.error('getLead error', { err: err.message });
    return error(res, 'Failed to fetch lead', 500);
  }
}

const LEAD_ALLOWED_FIELDS = new Set([
  'companyName','website','linkedinUrl','industry','companySize','location','description',
  'contactName','contactTitle','contactEmail','contactPhone','contactLinkedin','companyPhone',
  'techStack','intentSignals','funding','jobPostings','leadScore','intentScore','intentLevel',
  'status','opportunity','aiSummary','aiPitch','notes','source','sourceUrl','pipeline',
  'followUpDate','leadCost','utmSource','utmMedium','utmCampaign','utmContent','subSource',
  'accountId','importBatchId','lastContactedAt','firstName','lastName','requirementType',
  'requirementDescription','budgetRange','timeline','temperature','disqualificationReason',
  'lastContactedDate','matchScore','leadType','assignedToId',
]);

async function createLead(req, res) {
  try {
    // Lead quota only applies to Lead Discovery leads, not manual creation

    // Strip fields not in the Prisma schema (e.g. ignoreDuplicate) to prevent Prisma errors
    const filtered = Object.fromEntries(
      Object.entries(req.body).filter(([k]) => LEAD_ALLOWED_FIELDS.has(k))
    );

    // ── Duplicate check (Phone OR Email) ──────────────────────────────────
    const ignoreDuplicate = req.body.ignoreDuplicate === true || req.body.ignoreDuplicate === 'true';

    if (!ignoreDuplicate) {
      const incomingEmail = filtered.contactEmail?.trim().toLowerCase() || null;
      const incomingPhone = filtered.contactPhone?.trim() || null;

      if (incomingEmail || incomingPhone) {
        const orConditions = [];
        if (incomingEmail) {
          orConditions.push({ contactEmail: { equals: incomingEmail, mode: 'insensitive' } });
        }
        if (incomingPhone) {
          orConditions.push({ contactPhone: { equals: incomingPhone, mode: 'insensitive' } });
        }

        const existingLead = await prisma.lead.findFirst({
          where: {
            organizationId: req.user.organizationId,
            OR: orConditions,
          },
          select: { id: true, companyName: true, contactEmail: true, contactPhone: true },
        });

        if (existingLead) {
          return res.status(409).json({
            success: false,
            message: `Duplicate lead: a lead already exists with the same ${
              incomingEmail && existingLead.contactEmail?.toLowerCase() === incomingEmail
                ? 'email'
                : 'phone number'
            }.`,
            possibleDuplicate: existingLead,
          });
        }
      }
    }
    // ── END duplicate check ────────────────────────────────────────────────

    const data = {
      ...filtered,
      organizationId: req.user.organizationId,
      createdById: req.user.id,
      subSource: filtered.subSource || 'created',
    };
    const lead = await prisma.lead.create({ data });
    await prisma.activityLog.create({ data: { organizationId: req.user.organizationId, userId: req.user.id,
      leadId: lead.id, action: 'lead_created', description: `Lead created: ${lead.companyName}` } }).catch(()=>{});

    dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    return success(res, lead, 'Lead created', 201);
  } catch (err) {
    logger.error('createLead error', { err: err.message, stack: err.stack });
    return error(res, 'Failed to create lead', 500);
  }
}

async function updateLead(req, res) {
  try {
    const existing = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: req.params.id }) });
    if (!existing) return error(res, 'Lead not found', 404);
    const lead = await prisma.lead.update({ where: { id: req.params.id }, data: req.body });
    await prisma.activityLog.create({ data: { organizationId: req.user.organizationId, userId: req.user.id,
      leadId: lead.id, action: 'lead_updated', description: `Lead updated: ${lead.companyName}` } }).catch(()=>{});
    dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    return success(res, lead);
  } catch (err) {
    return error(res, 'Failed to update lead', 500);
  }
}

async function deleteLead(req, res) {
  try {
    const existing = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: req.params.id }) });
    if (!existing) return error(res, 'Lead not found', 404);
    await prisma.notification.deleteMany({ where: { entityType: 'Lead', entityId: req.params.id } });
    await prisma.lead.delete({ where: { id: req.params.id } });

    // Decrement lead usage counter (only Lead Discovery leads count)
    if (existing.scanJobId) await decrementLeadUsage(req.user.organizationId);

    dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    return success(res, null, 'Lead deleted');
  } catch (err) {
    return error(res, 'Failed to delete lead', 500);
  }
}

async function analyzeLead(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: req.params.id }) });
    if (!lead) return error(res, 'Lead not found', 404);
    const services = await prisma.service.findMany({ where: { organizationId: req.user.organizationId, isActive: true }, select: { name:true } });
    const analysis = await analyzeLeadIntent(lead, services.map(s => s.name));
    const updated  = await prisma.lead.update({ where: { id: lead.id }, data: {
      leadScore: analysis.leadScore, intentScore: analysis.intentScore,
      intentLevel: analysis.intentLevel, opportunity: analysis.opportunity,
      aiSummary: analysis.aiSummary, aiPitch: analysis.aiPitch,
    }});
    dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    return success(res, { lead: updated, analysis });
  } catch (err) {
    return error(res, 'AI analysis failed', 500);
  }
}

async function _saveContact(lead, contact, userId, organizationId) {
  const updateData = {};
  if (contact.email       && !lead.contactEmail)    updateData.contactEmail    = contact.email;
  if (contact.linkedinUrl && !lead.contactLinkedin) updateData.contactLinkedin = contact.linkedinUrl;
  if (contact.name        && !lead.contactName)     updateData.contactName     = contact.name;
  if (contact.title       && !lead.contactTitle)    updateData.contactTitle    = contact.title;
  if (contact.phone       && !lead.contactPhone)    updateData.contactPhone    = contact.phone;
  let updated = lead;
  if (Object.keys(updateData).length > 0) {
    updated = await prisma.lead.update({ where: { id: lead.id }, data: updateData });
  }
  await prisma.activityLog.create({ data: { organizationId, userId, leadId: lead.id,
    action: 'contact_enriched',
    description: `Contact found via ${contact.source}: ${contact.email || contact.linkedinUrl || contact.name}`,
  }}).catch(()=>{});
  return updated;
}

function hasContact(c) { return !!(c && (c.email || c.linkedinUrl || c.phone)); }

async function enrichLeadViaSignalHire(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: req.params.id }) });
    if (!lead) return error(res, 'Lead not found', 404);
    logger.info('Enriching via SignalHire', { leadId: lead.id, company: lead.companyName, website: lead.website, linkedinUrl: lead.linkedinUrl });
    // Synchronous wrapper: submit + wait up to 25s for the webhook to deliver (kept
    // under the 30s frontend axios timeout). If it arrives, return the contact now;
    // if it times out, the webhook still updates the lead asynchronously.
    // Reuse the scan's decision-maker filter when available: if the lead came from
    // a scan where the user targeted specific roles (e.g. CFO, VP Sales), reveal
    // those roles first and fall back to the generic leadership pool.
    let preferredTitles = [];
    if (lead.scanJobId) {
      const scanJob = await prisma.scanJob.findFirst({
        where: { id: lead.scanJobId, organizationId: req.user.organizationId },
        select: { sources: true },
      }).catch(() => null);
      const sources = scanJob?.sources || {};
      const roles = Array.isArray(sources.decisionMakers)
        ? sources.decisionMakers
        : (Array.isArray(sources.decisionMakerRoles) ? sources.decisionMakerRoles : []);
      preferredTitles = roles.filter(Boolean);
    }
    const result = await enrichViaSignalHire(lead, { createdById: req.user.id, waitMs: 25000, preferredTitles });
    if (result?.peopleFound) {
      return success(res, { submitted: true, peopleFound: result.peopleFound, async: true, enrichedVia: 'signalhire' },
        `SignalHire is revealing ${result.peopleFound} decision-maker${result.peopleFound > 1 ? 's' : ''} — they'll appear in Contacts shortly.`);
    }
    if (result?.found) {
      const updated = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: lead.id }) });
      return success(res, {
        found: true, async: false, enrichedVia: 'signalhire',
        contactEmail: updated?.contactEmail, contactName: updated?.contactName,
        contactTitle: updated?.contactTitle, contactLinkedin: updated?.contactLinkedin,
        contactPhone: updated?.contactPhone, lead: updated,
      }, 'Contact found via SignalHire');
    }
    if (result?.noContact) {
      return success(res, { found: false, noContact: true, enrichedVia: 'signalhire' },
        'SignalHire found no contact for this lead (needs a person name or personal LinkedIn — a company/domain alone often returns nothing).');
    }
    if (result?.submitted) {
      return success(res, { found: false, submitted: true, pending: true, requestId: result.requestId, enrichedVia: 'signalhire' },
        'SignalHire is still processing — the contact will appear on the lead shortly.');
    }
    return success(res, { submitted: false, reason: result?.skipped || 'unknown', enrichedVia: 'signalhire' },
      `SignalHire not run: ${result?.skipped || 'unknown'}`);
  } catch (err) {
    logger.error('enrichLeadViaSignalHire error', { err: err.message });
    return error(res, 'SignalHire enrichment failed', 500);
  }
}

async function enrichLeadViaApollo(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: req.params.id }) });
    if (!lead) return error(res, 'Lead not found', 404);

    const personTitles = Array.isArray(req.body?.personTitles) ? req.body.personTitles : null;
    const returnAll = !!(personTitles && personTitles.length > 0);

    logger.info('Enriching via Apollo', {
      leadId: lead.id, company: lead.companyName, website: lead.website,
      personTitles: personTitles || 'default', returnAll,
    });

    if (returnAll) {
      // Multi-contact mode: return all matching contacts
      const contacts = await enrichViaApollo(lead, { personTitles, returnAll: true });
      if (!contacts || contacts.length === 0) {
        return success(res, { found: false, enrichedVia: 'apollo', contacts: [] }, 'Apollo: no contacts found');
      }

      // Save org phone to companyPhone (company-level, not personal contact)
      const orgPhone = contacts._orgPhone || null;
      if (orgPhone && !lead.companyPhone) {
        try {
          await prisma.lead.update({
            where: { id: lead.id },
            data: { companyPhone: orgPhone },
          });
          lead.companyPhone = orgPhone;
        } catch (phoneErr) {
          logger.warn('Failed to save companyPhone (non-fatal)', { err: phoneErr.message });
        }
      }

      // Save first contact as primary if lead has no primary contact yet
      let updated = lead;
      if (!lead.contactEmail && !lead.contactName) {
        updated = await _saveContact(lead, contacts[0], req.user.id, req.user.organizationId);
      }

      // Save remaining contacts as additional contacts
      const savedAdditional = [];
      const startIdx = (!lead.contactEmail && !lead.contactName) ? 1 : 0;
      for (let i = startIdx; i < contacts.length; i++) {
        const c = contacts[i];
        try {
          // Deduplicate: check by email if available, otherwise by name+title
          let existing = null;
          if (c.email) {
            existing = await prisma.contact.findFirst({
              where: { leadId: lead.id, email: c.email },
            });
          } else if (c.name) {
            existing = await prisma.contact.findFirst({
              where: { leadId: lead.id, name: c.name, title: c.title || undefined },
            });
          }
          if (!existing) {
            const saved = await prisma.contact.create({
              data: {
                leadId:         lead.id,
                organizationId: req.user.organizationId,
                name:           c.name || 'Unknown',
                title:          c.title || null,
                email:          c.email || null,
                phone:          c.phone || null,
                linkedin:       c.linkedinUrl || null,
                designation:    c.title || null,
              },
            });
            savedAdditional.push(saved);
          }
        } catch (err) {
          logger.warn('Failed to save additional Apollo contact', { err: err.message });
        }
      }

      await prisma.activityLog.create({ data: {
        organizationId: req.user.organizationId, userId: req.user.id, leadId: lead.id,
        action: 'contact_enriched',
        description: `Found ${contacts.length} contacts via Apollo (titles: ${personTitles.join(', ')})`,
      }}).catch(()=>{});

      return success(res, {
        found: true, enrichedVia: 'apollo',
        contactsFound: contacts.length,
        contacts,
        lead: updated,
      }, `Found ${contacts.length} contacts via Apollo`);
    }

    // Single contact mode (original behavior)
    const contact = await enrichViaApollo(lead);
    if (!hasContact(contact)) return success(res, { found: false, enrichedVia: 'apollo' }, 'Apollo: no contact found');
    const updated = await _saveContact(lead, contact, req.user.id, req.user.organizationId);
    return success(res, { found: true, enrichedVia: 'apollo',
      contactEmail: updated.contactEmail, contactName: updated.contactName,
      contactTitle: updated.contactTitle, contactLinkedin: updated.contactLinkedin,
      contactPhone: updated.contactPhone, lead: updated }, 'Contact found via Apollo');
  } catch (err) {
    logger.error('enrichLeadViaApollo error', { err: err.message });
    return error(res, 'Apollo enrichment failed', 500);
  }
}

async function generateEmail(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: req.params.id }) });
    if (!lead) return error(res, 'Lead not found', 404);
    const [services, templates] = await Promise.all([
      prisma.service.findMany({ where: { organizationId: req.user.organizationId } }),
      prisma.emailTemplate.findMany({ where: { organizationId: req.user.organizationId }, orderBy: { createdAt: 'desc' } }),
    ]);
    const { name: contactName, title: contactTitle } = req.body || {};
    const targetLead = {
      ...lead,
      contactName: contactName || lead.contactName,
      contactTitle: contactTitle || lead.contactTitle,
    };
    const emailContent = await generateOutreachEmail(targetLead, req.user.name, services.map(s => s.name), templates);
    return success(res, emailContent);
  } catch (err) {
    return error(res, 'Email generation failed', 500);
  }
}

async function sendOutreach(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: scopeLeadWhere(req.user, { id: req.params.id }) });
    if (!lead)             return error(res, 'Lead not found', 404);
    if (!lead.contactEmail) return error(res, 'No contact email on this lead', 422);
    const { subject, body } = req.body;
    await sendEmail({ to: lead.contactEmail, subject, html: body.replace(/\n/g,'<br>'), text: body });
    await prisma.emailLog.create({ data: { organizationId: req.user.organizationId,
      leadId: lead.id, userId: req.user.id, toEmail: lead.contactEmail, subject, body, status: 'sent', sentAt: new Date() } });
    await prisma.lead.update({ where: { id: lead.id }, data: { status: 'contacted' } });
    return success(res, null, 'Email sent');
  } catch (err) {
    return error(res, 'Send failed', 500);
  }
}

async function exportLeads(req, res) {
  try {
    const isSalesUser = req.user.role === 'sales_user';
    // Filters are ANDed with the role scope (admin: org, manager: created/assigned,
    // sales_user: assigned) — no query param can widen it.
    const filters = {};

    if (req.query.ids) {
      filters.id = { in: req.query.ids.split(',') };
    } else {
      if (req.query.search) {
        filters.OR = [
          { companyName: { contains: req.query.search, mode: 'insensitive' } },
          { contactName: { contains: req.query.search, mode: 'insensitive' } },
          { contactEmail: { contains: req.query.search, mode: 'insensitive' } },
        ];
      }
      if (req.query.status) {
        filters.status = { equals: String(req.query.status), mode: 'insensitive' };
      }
      // Only non-sales roles can pick whose leads are exported (still within scope)
      if (!isSalesUser) {
        if (req.query.assignedTo) {
          filters.assignedToId = req.query.assignedTo;
        }
        if (req.query.unassigned === 'true') {
          filters.assignedToId = null;
        }
        if (req.query.assignedToMe === 'true') {
          filters.assignedToId = req.user.id;
        }
      }
    }
    const where = scopeLeadWhere(req.user, filters);

    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        leadContacts: true,
        assignedTo: { select: { name: true } },
        createdBy: { select: { name: true } },
      },
    });

    // Org dropdown values, so Status / Source are written exactly as the import expects
    const dropdowns = await prisma.dropdownConfig.findMany({
      where: { organizationId: req.user.organizationId, category: { in: ['lead_status', 'lead_source'] }, isActive: true },
      select: { category: true, value: true },
    });
    const pick = (category, raw) => {
      if (!raw) return '';
      const hit = dropdowns.find((d) => d.category === category && d.value.toLowerCase() === String(raw).trim().toLowerCase());
      return hit ? hit.value : null;
    };
    const titleCase = (v) => String(v || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    const leadTypeLabel = (v) => {
      const t = String(v || '').trim().toLowerCase();
      if (!t) return '';
      if (t.startsWith('product')) return 'Product';
      if (t.startsWith('service')) return 'Services';
      return v;
    };
    // DD/MM/YYYY — the format the import reads
    const ddmmyyyy = (date) => {
      if (!date) return '';
      const d = new Date(date);
      return `${String(d.getUTCDate()).padStart(2, '0')}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${d.getUTCFullYear()}`;
    };
    const stamp = (date) => {
      if (!date) return '';
      const d = new Date(date);
      const pad = (n) => String(n).padStart(2, '0');
      return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };

    // Sheet 1 — same columns as the import template, one row per lead (re-importable)
    const IMPORT_COLUMNS = [
      'Company Name', 'Lead Type', 'Contact Name', 'Job Title', 'Email', 'Phone',
      'Lead Status', 'Lead Source', 'Score', 'Follow-up Date', 'Assign Lead To',
      'Website', 'Industry', 'Location', 'Description / Notes',
    ];
    const leadRows = leads.map((l) => {
      const source = pick('lead_source', l.source);
      return [
        l.companyName || '',
        leadTypeLabel(l.leadType),
        l.contactName || '',
        l.contactTitle || '',
        l.contactEmail || '',
        l.contactPhone || '',
        pick('lead_status', l.status) ?? titleCase(l.status),
        source ?? '', // non-standard sources (e.g. discovery) are kept on the Lead Details sheet
        Number.isFinite(l.leadScore) ? l.leadScore : '',
        ddmmyyyy(l.followUpDate),
        l.assignedTo?.name || '',
        l.website || '',
        l.industry || '',
        l.location || '',
        l.notes || '',
      ];
    });

    // Sheet 2 — everything else about the lead
    const DETAIL_COLUMNS = [
      'Company Name', 'Contact Name', 'Email', 'Domain', 'Company Size', 'Company Phone',
      'Company LinkedIn', 'Contact LinkedIn', 'Intent Level', 'Intent Signals',
      'Original Source', 'Source URL', 'Created By', 'Created At',
    ];
    const detailRows = leads.map((l) => [
      l.companyName || '',
      l.contactName || '',
      l.contactEmail || '',
      l.website ? l.website.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0] : '',
      l.companySize || '',
      l.companyPhone || '',
      l.linkedinUrl || '',
      l.contactLinkedin || '',
      titleCase(l.intentLevel),
      (l.intentSignals || []).map((s) => s.text || s.type || JSON.stringify(s)).join('; '),
      l.source || '',
      l.sourceUrl || '',
      l.createdBy?.name || '',
      stamp(l.createdAt),
    ]);

    // Sheet 3 — additional contacts, one row per email/phone value
    const CONTACT_COLUMNS = ['Company Name', 'Contact Name', 'Job Title', 'Email', 'Phone', 'LinkedIn'];
    const contactRows = [];
    for (const l of leads) {
      for (const c of l.leadContacts || []) {
        const emails = [c.email, ...(Array.isArray(c.additionalEmails) ? c.additionalEmails : [])]
          .map((v) => (v || '').trim()).filter(Boolean);
        const phones = [c.phone, ...(Array.isArray(c.additionalPhones) ? c.additionalPhones : [])]
          .map((v) => (v || '').trim()).filter(Boolean);
        const count = Math.max(emails.length, phones.length, 1);
        for (let i = 0; i < count; i++) {
          contactRows.push([
            i === 0 ? (l.companyName || '') : '',
            i === 0 ? (c.name || '') : '',
            i === 0 ? (c.title || c.designation || '') : '',
            emails[i] || '',
            phones[i] || '',
            i === 0 ? (c.linkedin || '') : '',
          ]);
        }
      }
    }

    // Cells are written as plain text/number cells, so values such as "=..." are
    // never evaluated as formulas by Excel/Sheets.
    const sheet = (header, rows, widths) => {
      const ws = XLSX.utils.aoa_to_sheet([header, ...rows]);
      ws['!cols'] = widths.map((wch) => ({ wch }));
      return ws;
    };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, sheet(IMPORT_COLUMNS, leadRows, [28, 12, 22, 20, 30, 16, 14, 18, 8, 14, 20, 30, 18, 16, 40]), 'Leads');
    XLSX.utils.book_append_sheet(wb, sheet(DETAIL_COLUMNS, detailRows, [28, 22, 30, 24, 14, 16, 30, 30, 12, 40, 40, 40, 20, 18]), 'Lead Details');
    XLSX.utils.book_append_sheet(wb, sheet(CONTACT_COLUMNS, contactRows, [28, 22, 20, 30, 16, 30]), 'Additional Contacts');
    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.xlsx');
    res.send(buffer);
  } catch (err) {
    logger.error('exportLeads failed', { err: err.message });
    return error(res, 'Export failed', 500);
  }
}

module.exports = {
  getLeads, getLead, createLead, updateLead, deleteLead, analyzeLead,
  enrichLeadViaSignalHire, enrichLeadViaApollo, generateEmail, sendOutreach, exportLeads,
};

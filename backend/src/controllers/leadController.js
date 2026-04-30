/**
 * leadController.js — full rewrite with domain/industry/contact aggregation
 */
const prisma  = require('../utils/prisma');
const { success, error, paginated } = require('../utils/response');
const dashboardEvents = require('../utils/dashboardEvents');
const { analyzeLeadIntent, generateOutreachEmail } = require('../services/aiService');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');
const { Parser } = require('json2csv');
const { enrichViaSignalHire, enrichViaApollo } = require('../services/leadEnrichmentPipeline');
const { checkLeadQuota, incrementLeadUsage, decrementLeadUsage } = require('../utils/leadQuota');

async function getLeads(req, res) {
  try {
    const { page=1, limit=20, status, intent, search, assignedTo, sortBy='createdAt', sortDir='desc' } = req.query;
    const skip  = (parseInt(page) - 1) * parseInt(limit);
    const where = { organizationId: req.user.organizationId };
    if (status)     where.status      = status;
    if (intent)     where.intentLevel = intent;
    if (assignedTo) where.assignedToId = assignedTo;
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

async function createLead(req, res) {
  try {
    // Check lead quota
    const quota = await checkLeadQuota(req.user.organizationId);
    if (!quota.allowed) {
      return error(res, `Lead limit reached (${quota.quota}). You have used all your available leads. Please upgrade your plan to add more.`, 403);
    }

    const data = { ...req.body, organizationId: req.user.organizationId, createdById: req.user.id };
    const lead = await prisma.lead.create({ data });
    await prisma.activityLog.create({ data: { organizationId: req.user.organizationId, userId: req.user.id,
      leadId: lead.id, action: 'lead_created', description: `Lead created: ${lead.companyName}` } }).catch(()=>{});

    // Increment lead usage counter
    await incrementLeadUsage(req.user.organizationId);

    dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    return success(res, lead, 'Lead created', 201);
  } catch (err) {
    return error(res, 'Failed to create lead', 500);
  }
}

async function updateLead(req, res) {
  try {
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
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
    const existing = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!existing) return error(res, 'Lead not found', 404);
    await prisma.lead.delete({ where: { id: req.params.id } });

    // Decrement lead usage counter
    await decrementLeadUsage(req.user.organizationId);

    dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    return success(res, null, 'Lead deleted');
  } catch (err) {
    return error(res, 'Failed to delete lead', 500);
  }
}

async function analyzeLead(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
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
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!lead) return error(res, 'Lead not found', 404);
    logger.info('Enriching via SignalHire', { leadId: lead.id, company: lead.companyName, website: lead.website, linkedinUrl: lead.linkedinUrl });
    const contact = await enrichViaSignalHire(lead);
    if (!hasContact(contact)) return success(res, { found: false, enrichedVia: 'signalhire' }, 'SignalHire: no contact found');
    const updated = await _saveContact(lead, contact, req.user.id, req.user.organizationId);
    return success(res, { found: true, enrichedVia: 'signalhire',
      contactEmail: updated.contactEmail, contactName: updated.contactName,
      contactTitle: updated.contactTitle, contactLinkedin: updated.contactLinkedin,
      contactPhone: updated.contactPhone, lead: updated }, 'Contact found via SignalHire');
  } catch (err) {
    logger.error('enrichLeadViaSignalHire error', { err: err.message });
    return error(res, 'SignalHire enrichment failed', 500);
  }
}

async function enrichLeadViaApollo(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
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
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!lead) return error(res, 'Lead not found', 404);
    const services = await prisma.service.findMany({ where: { organizationId: req.user.organizationId } });
    const emailContent = await generateOutreachEmail(lead, req.user.name, services.map(s => s.name));
    return success(res, emailContent);
  } catch (err) {
    return error(res, 'Email generation failed', 500);
  }
}

async function sendOutreach(req, res) {
  try {
    const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
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
    const where = { organizationId: req.user.organizationId };
    
    // Handle selected leads export
    if (req.query.ids) {
      where.id = { in: req.query.ids.split(',') };
    } else {
      // Apply filters when no specific IDs are selected
      if (req.query.search) {
        where.OR = [
          { companyName: { contains: req.query.search, mode: 'insensitive' } },
          { contactName: { contains: req.query.search, mode: 'insensitive' } },
          { contactEmail: { contains: req.query.search, mode: 'insensitive' } },
        ];
      }
      if (req.query.status) {
        where.status = req.query.status;
      }
      if (req.query.assignedTo) {
        where.assignedToId = req.query.assignedTo;
      }
      if (req.query.unassigned === 'true') {
        where.assignedToId = null;
      }
      if (req.query.assignedToMe === 'true') {
        where.assignedToId = req.user.userId;
      }
    }
    
    const leads = await prisma.lead.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { leadContacts: true },
    });
    const rows = [];
    const formatDate = (date) => {
      if (!date) return '';
      const d = new Date(date);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hours = String(d.getHours()).padStart(2, '0');
      const minutes = String(d.getMinutes()).padStart(2, '0');
      const seconds = String(d.getSeconds()).padStart(2, '0');
      return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
    };

    for (const l of leads) {
      const base = {
        companyName:  l.companyName,
        domainName:   l.website ? l.website.replace(/^https?:\/\//,'').replace(/^www\./,'').split('/')[0] : '',
        website:      l.website || '',
        industry:     l.industry || '',
        location:     l.location || '',
        companySize:  l.companySize || '',
        companyPhone: l.companyPhone || '',
        linkedinUrl:  l.linkedinUrl || '',
        leadScore:    l.leadScore,
        intentLevel:  l.intentLevel,
        status:       l.status,
        intentSignals: (l.intentSignals||[]).map(s=>s.text||s.type||JSON.stringify(s)).join('; '),
        source:       l.source || '',
        createdAt:    formatDate(l.createdAt),
      };

      // Primary contact row
      rows.push({
        ...base,
        contactType:    'Primary',
        contactName:    l.contactName || '',
        contactTitle:   l.contactTitle || '',
        contactEmail:   l.contactEmail || '',
        contactPhone:   l.contactPhone || '',
        contactLinkedin: l.contactLinkedin || '',
      });

      // Additional contact rows
      if (l.leadContacts && l.leadContacts.length > 0) {
        for (const c of l.leadContacts) {
          rows.push({
            ...base,
            contactType:    'Additional',
            contactName:    c.name || '',
            contactTitle:   c.title || c.designation || '',
            contactEmail:   c.email || '',
            contactPhone:   c.phone || '',
            contactLinkedin: c.linkedin || '',
          });
        }
      }
    }

    const parser = new Parser({ fields: [
      'companyName','domainName','website','industry','location','companySize','companyPhone',
      'contactType','contactName','contactTitle','contactEmail','contactPhone','contactLinkedin',
      'linkedinUrl','leadScore','intentLevel','status','intentSignals','source','createdAt',
    ]});
    const csv = parser.parse(rows);
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-Disposition','attachment; filename=leads.csv');
    res.send(csv);
  } catch (err) {
    return error(res, 'Export failed', 500);
  }
}

module.exports = {
  getLeads, getLead, createLead, updateLead, deleteLead, analyzeLead,
  enrichLeadViaSignalHire, enrichLeadViaApollo, generateEmail, sendOutreach, exportLeads,
};

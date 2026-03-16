// const prisma = require("../utils/prisma");
// const { success, error, paginated } = require("../utils/response");
// const { analyzeLeadIntent, generateOutreachEmail } = require("../services/aiService");
// const { sendEmail } = require("../services/emailService");
// const logger = require("../utils/logger");
// const { findContactEmail } = require("../services/enrichmentService");

// async function getLeads(req, res) {
//   try {
//     const {
//       page = 1,
//       limit = 20,
//       status,
//       intent,
//       search,
//       assignedTo,
//       sortBy = "createdAt",
//       sortDir = "desc",
//     } = req.query;
//     const skip = (parseInt(page) - 1) * parseInt(limit);
//     const where = { organizationId: req.user.organizationId };

//     if (status) where.status = status;
//     if (intent) where.intentLevel = intent;
//     if (assignedTo) where.assignedToId = assignedTo;
//     if (search) {
//       where.OR = [
//         { companyName: { contains: search, mode: "insensitive" } },
//         { contactName: { contains: search, mode: "insensitive" } },
//         { contactEmail: { contains: search, mode: "insensitive" } },
//         { industry: { contains: search, mode: "insensitive" } },
//       ];
//     }

//     // Sales users see only their leads
//     if (req.user.role === "sales_user") {
//       where.assignedToId = req.user.id;
//     }

//     const [leads, total] = await Promise.all([
//       prisma.lead.findMany({
//         where,
//         skip,
//         take: parseInt(limit),
//         orderBy: { [sortBy]: sortDir },
//         include: { assignedTo: { select: { id: true, name: true, email: true } } },
//       }),
//       prisma.lead.count({ where }),
//     ]);

//     return paginated(res, leads, total, page, limit);
//   } catch (err) {
//     logger.error("getLeads error", { err: err.message });
//     return error(res, "Failed to fetch leads", 500);
//   }
// }

// async function getLead(req, res) {
//   try {
//     const lead = await prisma.lead.findFirst({
//       where: { id: req.params.id, organizationId: req.user.organizationId },
//       include: {
//         assignedTo: { select: { id: true, name: true, email: true } },
//         emails: { orderBy: { createdAt: "desc" }, take: 10 },
//         activities: {
//           orderBy: { createdAt: "desc" },
//           take: 20,
//           include: { user: { select: { id: true, name: true } } },
//         },
//       },
//     });
//     if (!lead) return error(res, "Lead not found", 404);
//     return success(res, lead);
//   } catch (err) {
//     return error(res, "Failed to fetch lead", 500);
//   }
// }

// async function createLead(req, res) {
//   try {
//     const data = { ...req.body, organizationId: req.user.organizationId, createdById: req.user.id };
//     const lead = await prisma.lead.create({ data });

//     await prisma.activityLog.create({
//       data: {
//         organizationId: req.user.organizationId,
//         userId: req.user.id,
//         leadId: lead.id,
//         action: "lead_created",
//         description: `Lead created: ${lead.companyName}`,
//       },
//     });

//     return success(res, lead, "Lead created", 201);
//   } catch (err) {
//     logger.error("createLead error", { err: err.message });
//     return error(res, "Failed to create lead", 500);
//   }
// }

// async function updateLead(req, res) {
//   try {
//     const existing = await prisma.lead.findFirst({
//       where: { id: req.params.id, organizationId: req.user.organizationId },
//     });
//     if (!existing) return error(res, "Lead not found", 404);

//     const lead = await prisma.lead.update({ where: { id: req.params.id }, data: req.body });

//     await prisma.activityLog.create({
//       data: {
//         organizationId: req.user.organizationId,
//         userId: req.user.id,
//         leadId: lead.id,
//         action: "lead_updated",
//         description: `Lead updated: ${lead.companyName}`,
//       },
//     });

//     return success(res, lead);
//   } catch (err) {
//     return error(res, "Failed to update lead", 500);
//   }
// }

// async function deleteLead(req, res) {
//   try {
//     const existing = await prisma.lead.findFirst({
//       where: { id: req.params.id, organizationId: req.user.organizationId },
//     });
//     if (!existing) return error(res, "Lead not found", 404);
//     await prisma.lead.delete({ where: { id: req.params.id } });
//     return success(res, null, "Lead deleted");
//   } catch (err) {
//     return error(res, "Failed to delete lead", 500);
//   }
// }

// async function analyzeLead(req, res) {
//   try {
//     const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
//     if (!lead) return error(res, "Lead not found", 404);

//     const services = await prisma.service.findMany({
//       where: { organizationId: req.user.organizationId, isActive: true },
//       select: { name: true },
//     });

//     const email = await findContactEmail(lead);
//     if (email) {
//       await prisma.lead.update({
//         where: { id: lead.id },
//         data: { contactEmail: email },
//       });
//     }

//     const analysis = await analyzeLeadIntent(
//       lead,
//       services.map((s) => s.name),
//     );
//     const updated = await prisma.lead.update({
//       where: { id: lead.id },
//       data: {
//         leadScore: analysis.leadScore,
//         intentScore: analysis.intentScore,
//         intentLevel: analysis.intentLevel,
//         opportunity: analysis.opportunity,
//         aiSummary: analysis.aiSummary,
//         aiPitch: analysis.aiPitch,
//       },
//     });

//     return success(res, { lead: updated, analysis });
//   } catch (err) {
//     logger.error("analyzeLead error", { err: err.message });
//     return error(res, "AI analysis failed", 500);
//   }
// }

// async function generateEmail(req, res) {
//   try {
//     const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
//     if (!lead) return error(res, "Lead not found", 404);

//     const services = await prisma.service.findMany({
//       where: { organizationId: req.user.organizationId, isActive: true },
//     });

//     const email = await generateOutreachEmail(
//       lead,
//       req.user.name,
//       services.map((s) => s.name),
//     );
//     return success(res, email);
//   } catch (err) {
//     return error(res, "Email generation failed", 500);
//   }
// }

// async function sendOutreach(req, res) {
//   try {
//     const { subject, body } = req.body;
//     const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
//     if (!lead) return error(res, "Lead not found", 404);
//     if (!lead.contactEmail) return error(res, "No contact email for this lead", 422);

//     const result = await sendEmail({
//       toEmail: lead.contactEmail,
//       toName: lead.contactName,
//       subject,
//       body,
//       leadId: lead.id,
//       sentById: req.user.id,
//       organizationId: req.user.organizationId,
//     });

//     return success(res, result, "Email sent successfully");
//   } catch (err) {
//     return error(res, "Failed to send email", 500);
//   }
// }

// async function exportLeads(req, res) {
//   try {
//     const leads = await prisma.lead.findMany({
//       where: { organizationId: req.user.organizationId },
//       orderBy: { leadScore: "desc" },
//     });

//     const csv = [
//       "Company,Website,Industry,Size,Location,Contact,Title,Email,Lead Score,Intent Score,Status,Tech Stack,Opportunity",
//       ...leads.map((l) =>
//         [
//           `"${l.companyName}"`,
//           l.website || "",
//           l.industry || "",
//           l.companySize || "",
//           `"${l.location || ""}"`,
//           `"${l.contactName || ""}"`,
//           `"${l.contactTitle || ""}"`,
//           l.contactEmail || "",
//           l.leadScore,
//           l.intentScore,
//           l.status,
//           `"${(l.techStack || []).join(", ")}"`,
//           `"${l.opportunity || ""}"`,
//         ].join(","),
//       ),
//     ].join("\n");

//     res.setHeader("Content-Type", "text/csv");
//     res.setHeader("Content-Disposition", 'attachment; filename="leads.csv"');
//     return res.send(csv);
//   } catch (err) {
//     return error(res, "Export failed", 500);
//   }
// }

// async function enrichLead(req, res) {
//   try {
//     const lead = await prisma.lead.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
//     if (!lead) return error(res, 'Lead not found', 404);

//     const email = await findContactEmail(lead);
//     if (!email) return error(res, 'Could not find email for this lead. Try adding a LinkedIn URL or website first.', 404);

//     const updated = await prisma.lead.update({
//       where: { id: lead.id },
//       data: { contactEmail: email },
//     });

//     await prisma.activityLog.create({
//       data: {
//         organizationId: req.user.organizationId,
//         userId: req.user.id,
//         leadId: lead.id,
//         action: 'email_enriched',
//         description: `Contact email found via SignalHire: ${email}`,
//       },
//     });

//     return success(res, { contactEmail: email, lead: updated }, 'Email found successfully');
//   } catch (err) {
//     logger.error('enrichLead error', { err: err.message });
//     return error(res, 'Email enrichment failed', 500);
//   }
// }

// module.exports = {
//   getLeads,
//   getLead,
//   createLead,
//   updateLead,
//   deleteLead,
//   analyzeLead,
//   generateEmail,
//   sendOutreach,
//   exportLeads,
//   enrichLead,
// };


const prisma = require('../utils/prisma');
const { success, error, paginated } = require('../utils/response');
const { analyzeLeadIntent, generateOutreachEmail } = require('../services/aiService');
const { enrichViaSignalHire, enrichViaApollo } = require('../services/contactEnrichmentService');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');
const { Parser } = require('json2csv');

// GET /leads
async function getLeads(req, res) {
  try {
    const {
      page = 1, limit = 20, status, intent,
      search, assignedTo, sortBy = 'createdAt', sortDir = 'desc',
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
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
      ];
    }
    if (req.user.role === 'sales_user') where.assignedToId = req.user.id;

    const [items, total] = await Promise.all([
      prisma.lead.findMany({
        where, skip,
        take: parseInt(limit),
        orderBy: { [sortBy]: sortDir },
        include: { assignedTo: { select: { id: true, name: true, avatarUrl: true } } },
      }),
      prisma.lead.count({ where }),
    ]);

    // Use paginated helper — response shape:
    // { success, data: [...items], pagination: { total, page, limit, totalPages } }
    return paginated(res, items, total, page, parseInt(limit));
  } catch (err) {
    logger.error('getLeads error', { err: err.message });
    return error(res, 'Failed to fetch leads', 500);
  }
}

// GET /leads/:id
async function getLead(req, res) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        assignedTo: { select: { id: true, name: true, avatarUrl: true } },
        emails:     { orderBy: { createdAt: 'desc' }, take: 10 },
        activities: { orderBy: { createdAt: 'desc' }, take: 20 }, // ← correct relation name
      },
    });
    if (!lead) return error(res, 'Lead not found', 404);
    return success(res, lead);
  } catch (err) {
    logger.error('getLead error', { err: err.message });
    return error(res, 'Failed to fetch lead', 500);
  }
}

// POST /leads
async function createLead(req, res) {
  try {
    const lead = await prisma.lead.create({
      data: { ...req.body, organizationId: req.user.organizationId, createdById: req.user.id },
    });
    return success(res, lead, 'Lead created', 201);
  } catch (err) {
    logger.error('createLead error', { err: err.message });
    return error(res, 'Failed to create lead', 500);
  }
}

// PATCH /leads/:id
async function updateLead(req, res) {
  try {
    const lead = await prisma.lead.update({
      where: { id: req.params.id },
      data: req.body,
    });
    return success(res, lead, 'Lead updated');
  } catch (err) {
    logger.error('updateLead error', { err: err.message });
    return error(res, 'Failed to update lead', 500);
  }
}

// DELETE /leads/:id
async function deleteLead(req, res) {
  try {
    await prisma.lead.delete({ where: { id: req.params.id } });
    return success(res, null, 'Lead deleted');
  } catch (err) {
    return error(res, 'Failed to delete lead', 500);
  }
}

// POST /leads/:id/analyze
async function analyzeLead(req, res) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!lead) return error(res, 'Lead not found', 404);

    const services = await prisma.service.findMany({
      where: { organizationId: req.user.organizationId },
    });
    const analysis = await analyzeLeadIntent(lead, services.map(s => s.name));

    const updated = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        leadScore:   analysis.leadScore,
        intentScore: analysis.intentScore,
        intentLevel: analysis.intentLevel,
        opportunity: analysis.opportunity,
        aiSummary:   analysis.aiSummary,
        aiPitch:     analysis.aiPitch,
      },
    });
    return success(res, updated, 'Analysis complete');
  } catch (err) {
    logger.error('analyzeLead error', { err: err.message });
    return error(res, 'Analysis failed', 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ENRICHMENT
// Two independent endpoints — frontend calls them sequentially.
//
// POST /leads/:id/enrich/signalhire
//   → calls SignalHire async poll (up to 40 s)
//   → returns { found: true, enrichedVia: 'signalhire', ...contacts }
//      or     { found: false, enrichedVia: 'signalhire' }
//
// POST /leads/:id/enrich/apollo
//   → called by frontend ONLY if signalhire returned found:false
//   → calls Apollo people search + enrich
//   → returns { found: true, enrichedVia: 'apollo', ...contacts }
//      or     { found: false, enrichedVia: 'apollo' }
// ─────────────────────────────────────────────────────────────────────────────

async function _saveContact(lead, contact, userId, organizationId) {
  const updateData = {};
  // Only save fields that exist in the Lead schema
  if (contact.email       && !lead.contactEmail)    updateData.contactEmail    = contact.email;
  if (contact.linkedinUrl && !lead.contactLinkedin) updateData.contactLinkedin = contact.linkedinUrl;
  if (contact.name        && !lead.contactName)     updateData.contactName     = contact.name;
  if (contact.title       && !lead.contactTitle)    updateData.contactTitle    = contact.title;

  let updated = lead;
  if (Object.keys(updateData).length > 0) {
    updated = await prisma.lead.update({ where: { id: lead.id }, data: updateData });
  }

  await prisma.activityLog.create({
    data: {
      organizationId,
      userId,
      leadId:      lead.id,
      action:      'contact_enriched',
      description: `Contact found via ${contact.source}: ${contact.email || contact.linkedinUrl || contact.name}`,
    },
  }).catch(() => {});

  return updated;
}

function hasContact(c) {
  return !!(c && (c.email || c.linkedinUrl));
}

// POST /leads/:id/enrich/signalhire
async function enrichLeadViaSignalHire(req, res) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!lead) return error(res, 'Lead not found', 404);

    const contact = await enrichViaSignalHire(lead);

    if (!hasContact(contact)) {
      return success(res, { found: false, enrichedVia: 'signalhire' }, 'SignalHire: no contact found');
    }

    const updated = await _saveContact(lead, contact, req.user.id, req.user.organizationId);
    return success(res, {
      found:           true,
      enrichedVia:     'signalhire',
      contactEmail:    updated.contactEmail,
      contactName:     updated.contactName,
      contactTitle:    updated.contactTitle,
      contactLinkedin: updated.contactLinkedin,
      lead:            updated,
    }, 'Contact found via SignalHire');
  } catch (err) {
    logger.error('enrichLeadViaSignalHire error', { err: err.message });
    return error(res, 'SignalHire enrichment failed', 500);
  }
}

// POST /leads/:id/enrich/apollo
async function enrichLeadViaApollo(req, res) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!lead) return error(res, 'Lead not found', 404);

    const contact = await enrichViaApollo(lead);

    if (!hasContact(contact)) {
      return success(res, { found: false, enrichedVia: 'apollo' }, 'Apollo: no contact found');
    }

    const updated = await _saveContact(lead, contact, req.user.id, req.user.organizationId);
    return success(res, {
      found:           true,
      enrichedVia:     'apollo',
      contactEmail:    updated.contactEmail,
      contactName:     updated.contactName,
      contactTitle:    updated.contactTitle,
      contactLinkedin: updated.contactLinkedin,
      lead:            updated,
    }, 'Contact found via Apollo');
  } catch (err) {
    logger.error('enrichLeadViaApollo error', { err: err.message });
    return error(res, 'Apollo enrichment failed', 500);
  }
}

// POST /leads/:id/generate-email
async function generateEmail(req, res) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!lead) return error(res, 'Lead not found', 404);

    const services = await prisma.service.findMany({
      where: { organizationId: req.user.organizationId },
    });
    const emailContent = await generateOutreachEmail(lead, req.user.name, services.map(s => s.name));
    return success(res, emailContent);
  } catch (err) {
    logger.error('generateEmail error', { err: err.message });
    return error(res, 'Email generation failed', 500);
  }
}

// POST /leads/:id/send-outreach
async function sendOutreach(req, res) {
  try {
    const lead = await prisma.lead.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!lead)             return error(res, 'Lead not found', 404);
    if (!lead.contactEmail) return error(res, 'No contact email on this lead', 422);

    const { subject, body } = req.body;
    await sendEmail({
      to: lead.contactEmail,
      subject,
      html: body.replace(/\n/g, '<br>'),
      text: body,
    });

    await prisma.emailLog.create({
      data: {
        organizationId: req.user.organizationId,
        leadId:  lead.id,
        userId:  req.user.id,
        toEmail: lead.contactEmail,
        subject,
        body,
        status:  'sent',
        sentAt:  new Date(),
      },
    });

    await prisma.lead.update({
      where: { id: lead.id },
      data:  { status: 'contacted' },
    });

    return success(res, null, 'Email sent');
  } catch (err) {
    logger.error('sendOutreach error', { err: err.message });
    return error(res, 'Send failed', 500);
  }
}

// GET /leads/export  — must be registered BEFORE /:id route in routes file
async function exportLeads(req, res) {
  try {
    const leads = await prisma.lead.findMany({
      where: { organizationId: req.user.organizationId },
    });

    // Serialize intentSignals array to a readable string for CSV
    const rows = leads.map(l => ({
      ...l,
      intentSignals: (l.intentSignals || [])
        .map(s => s.text || s.type || JSON.stringify(s))
        .join('; '),
    }));

 const parser = new Parser({
  fields: [
    'companyName', 'contactName', 'contactEmail', 'industry',
    'leadScore', 'intentLevel', 'status', 'website',
    'linkedinUrl',      // ← ADD THIS
    'intentSignals',
    'createdAt',
  ],
});

    const csv = parser.parse(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=leads.csv');
    res.send(csv);
  } catch (err) {
    return error(res, 'Export failed', 500);
  }
}

module.exports = {
  getLeads,
  getLead,
  createLead,
  updateLead,
  deleteLead,
  analyzeLead,
  enrichLeadViaSignalHire,
  enrichLeadViaApollo,
  generateEmail,
  sendOutreach,
  exportLeads,
};


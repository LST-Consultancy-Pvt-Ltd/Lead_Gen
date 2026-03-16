const prisma = require('../utils/prisma');
const { success, error, paginated } = require('../utils/response');
const { generateOutreachEmail } = require('../services/aiService');
const { sendEmail } = require('../services/emailService');
const logger = require('../utils/logger');

async function getCampaigns(req, res) {
  try {
    const campaigns = await prisma.campaign.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { leads: true, emails: true } } },
    });
    return success(res, campaigns);
  } catch (err) {
    return error(res, 'Failed to fetch campaigns', 500);
  }
}

async function getCampaign(req, res) {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        leads: { include: { lead: true } },
        emails: { orderBy: { createdAt: 'desc' }, take: 50 },
      },
    });
    if (!campaign) return error(res, 'Campaign not found', 404);
    return success(res, campaign);
  } catch (err) {
    return error(res, 'Failed to fetch campaign', 500);
  }
}

async function createCampaign(req, res) {
  try {
    const campaign = await prisma.campaign.create({
      data: { ...req.body, organizationId: req.user.organizationId },
    });
    return success(res, campaign, 'Campaign created', 201);
  } catch (err) {
    return error(res, 'Failed to create campaign', 500);
  }
}

async function updateCampaign(req, res) {
  try {
    const existing = await prisma.campaign.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!existing) return error(res, 'Campaign not found', 404);
    const campaign = await prisma.campaign.update({ where: { id: req.params.id }, data: req.body });
    return success(res, campaign);
  } catch (err) {
    return error(res, 'Failed to update campaign', 500);
  }
}

async function addLeadsToCampaign(req, res) {
  try {
    const { leadIds } = req.body;
    const campaign = await prisma.campaign.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!campaign) return error(res, 'Campaign not found', 404);

    const records = await Promise.all(
      leadIds.map(leadId =>
        prisma.campaignLead.upsert({
          where: { campaignId_leadId: { campaignId: campaign.id, leadId } },
          update: {},
          create: { campaignId: campaign.id, leadId },
        })
      )
    );
    return success(res, { added: records.length });
  } catch (err) {
    return error(res, 'Failed to add leads', 500);
  }
}

async function launchCampaign(req, res) {
  try {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: { leads: { include: { lead: true } } },
    });
    if (!campaign) return error(res, 'Campaign not found', 404);
    if (!campaign.leads.length) return error(res, 'No leads in campaign', 422);

    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: 'active' } });

    const services = await prisma.service.findMany({
      where: { organizationId: req.user.organizationId, isActive: true },
    });

    let sentCount = 0;
    for (const cl of campaign.leads) {
      const lead = cl.lead;
      if (!lead.contactEmail) continue;

      try {
        let subject = campaign.subject;
        let body = campaign.bodyTemplate;

        // Auto-generate if not set
        if (!subject || !body) {
          const generated = await generateOutreachEmail(lead, req.user.name, services.map(s => s.name));
          subject = subject || generated.subject;
          body = body || generated.body;
        }

        // Replace variables
        subject = subject.replace(/{{company}}/g, lead.companyName).replace(/{{name}}/g, lead.contactName || 'there');
        body = body.replace(/{{company}}/g, lead.companyName).replace(/{{name}}/g, lead.contactName?.split(' ')[0] || 'there');

        await sendEmail({
          toEmail: lead.contactEmail,
          toName: lead.contactName,
          subject, body,
          leadId: lead.id,
          campaignId: campaign.id,
          sentById: req.user.id,
          organizationId: req.user.organizationId,
        });

        sentCount++;
      } catch (err) {
        logger.error('Failed to send campaign email', { leadId: lead.id, err: err.message });
      }
    }

    await prisma.campaign.update({ where: { id: campaign.id }, data: { sentCount } });
    return success(res, { sent: sentCount, total: campaign.leads.length });
  } catch (err) {
    logger.error('Launch campaign error', { err: err.message });
    return error(res, 'Failed to launch campaign', 500);
  }
}

module.exports = { getCampaigns, getCampaign, createCampaign, updateCampaign, addLeadsToCampaign, launchCampaign };

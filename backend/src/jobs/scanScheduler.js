const cron = require('node-cron');
const prisma = require('../utils/prisma');
const logger = require('../utils/logger');
const { runDiscoveryScan } = require('../services/discoveryService');
const { analyzeLeadIntent } = require('../services/aiService');
const { createBulkNotifications } = require('../utils/notificationService');

// ── Follow-up Alert ──────────────────────────────────────────────────────────
// Rule: Follow-up date passes with no activity logged →
//       notify exec (assignedToId) + their manager
async function checkFollowUpAlerts() {
  logger.info('[Scheduler] Running follow-up alert check');
  try {
    const now = new Date();
    const overdueLeads = await prisma.lead.findMany({
      where: {
        followUpDate: { lt: now },
        status: { notIn: ['closed_won', 'closed_lost', 'disqualified'] },
        assignedToId: { not: null },
      },
      select: {
        id: true,
        companyName: true,
        followUpDate: true,
        organizationId: true,
        assignedToId: true,
        assignedTo: { select: { id: true, managerId: true } },
      },
    });

    const notifications = [];

    for (const lead of overdueLeads) {
      // Check if any activity was logged on or after the follow-up date
      const recentActivity = await prisma.activityLog.findFirst({
        where: {
          leadId: lead.id,
          createdAt: { gte: lead.followUpDate },
        },
        select: { id: true },
      });
      if (recentActivity) continue; // Activity exists — no alert needed

      const title = 'Follow-up Overdue';
      const message = `No activity logged for "${lead.companyName}" — follow-up was due on ${lead.followUpDate.toDateString()}.`;
      const base = {
        organizationId: lead.organizationId,
        type: 'follow_up_overdue',
        title,
        message,
        entityType: 'Lead',
        entityId: lead.id,
      };

      // Notify the exec
      notifications.push({ ...base, userId: lead.assignedToId });

      // Notify their manager if one exists
      if (lead.assignedTo?.managerId) {
        notifications.push({ ...base, userId: lead.assignedTo.managerId });
      }
    }

    if (notifications.length) {
      await createBulkNotifications(prisma, notifications);
      logger.info(`[Scheduler] Follow-up alerts sent: ${notifications.length}`);
    }
  } catch (err) {
    logger.error('[Scheduler] Follow-up alert check failed', { err: err.message });
  }
}

// ── Stuck Deal Alert ─────────────────────────────────────────────────────────
// Rule: Opportunity in same stage for N days (configurable via org.settings.stuckDealDays) →
//       notify sales owner + managers in the org
async function checkStuckDeals() {
  logger.info('[Scheduler] Running stuck deal alert check');
  try {
    const organizations = await prisma.organization.findMany({
      select: { id: true, settings: true },
    });

    for (const org of organizations) {
      const stuckDays = (org.settings?.stuckDealDays) || 14;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - stuckDays);

      const stuckOpps = await prisma.opportunity.findMany({
        where: {
          organizationId: org.id,
          stage: { notIn: ['closed_won', 'closed_lost'] },
          OR: [
            { stageChangedAt: { lt: cutoff } },
            // Fall back to updatedAt for opps created before stageChangedAt existed
            { stageChangedAt: null, updatedAt: { lt: cutoff } },
          ],
          assignedToId: { not: null },
        },
        select: {
          id: true,
          title: true,
          opportunityName: true,
          stage: true,
          stageChangedAt: true,
          updatedAt: true,
          assignedToId: true,
          organizationId: true,
        },
      });

      if (!stuckOpps.length) continue;

      // Collect manager IDs in this org
      const managers = await prisma.user.findMany({
        where: {
          organizationId: org.id,
          role: { in: ['manager', 'org_admin'] },
          isActive: true,
        },
        select: { id: true },
      });
      const managerIds = managers.map((m) => m.id);

      const notifications = [];
      for (const opp of stuckOpps) {
        const sinceDate = opp.stageChangedAt || opp.updatedAt;
        const dayCount = Math.floor((Date.now() - sinceDate.getTime()) / 86_400_000);
        const dealName = opp.opportunityName || opp.title;
        const base = {
          organizationId: org.id,
          type: 'stuck_deal',
          title: 'Stuck Deal Alert',
          message: `"${dealName}" has been in ${opp.stage.replace(/_/g, ' ')} stage for ${dayCount} days.`,
          entityType: 'Opportunity',
          entityId: opp.id,
        };

        // Notify the sales owner
        notifications.push({ ...base, userId: opp.assignedToId });

        // Notify all managers (avoid duplicate if manager is also the owner)
        for (const managerId of managerIds) {
          if (managerId !== opp.assignedToId) {
            notifications.push({ ...base, userId: managerId });
          }
        }
      }

      if (notifications.length) {
        await createBulkNotifications(prisma, notifications);
        logger.info(`[Scheduler] Stuck deal alerts sent for org ${org.id}: ${notifications.length}`);
      }
    }
  } catch (err) {
    logger.error('[Scheduler] Stuck deal check failed', { err: err.message });
  }
}

// Daily scan at 2 AM
function startScheduler() {
  logger.info('Starting scan scheduler');

  cron.schedule('0 2 * * *', async () => {
    logger.info('Running scheduled daily scan');
    try {
      const organizations = await prisma.organization.findMany({
        include: { services: { where: { isActive: true } } },
      });

      for (const org of organizations) {
        if (!org.services.length) continue;
        const services = org.services.map(s => s.name);

        const job = await prisma.scanJob.create({
          data: {
            organizationId: org.id,
            status: 'running',
            services,
            startedAt: new Date(),
          },
        });

        try {
          const discovered = await runDiscoveryScan({ id: job.id }, services, async (progress) => {
            await prisma.scanJob.update({ where: { id: job.id }, data: { progress } });
          });

          for (const item of discovered) {
            const existing = await prisma.lead.findFirst({
              where: { organizationId: org.id, companyName: { equals: item.companyName, mode: 'insensitive' } },
            });
            if (existing) continue;

            const analysis = await analyzeLeadIntent(item, services);
            await prisma.lead.create({
              data: {
                organizationId: org.id,
                companyName: item.companyName,
                website: item.website,
                industry: item.industry,
                techStack: item.techStack || [],
                intentSignals: [{ type: item.signalType, text: item.signalText }],
                ...analysis,
                source: 'Scheduled Scan',
                sourceUrl: item.sourceUrl,
              },
            });
          }

          await prisma.scanJob.update({
            where: { id: job.id },
            data: { status: 'completed', progress: 100, leadsFound: discovered.length, completedAt: new Date() },
          });

          logger.info(`Scheduled scan complete for org ${org.name}`, { leadsFound: discovered.length });
        } catch (err) {
          await prisma.scanJob.update({ where: { id: job.id }, data: { status: 'failed', error: err.message } });
          logger.error(`Scheduled scan failed for org ${org.name}`, { err: err.message });
        }
      }
    } catch (err) {
      logger.error('Scheduler error', { err: err.message });
    }
  });

  // Follow-up alerts + stuck deal checks — run every morning at 8 AM
  cron.schedule('0 8 * * *', async () => {
    await checkFollowUpAlerts();
    await checkStuckDeals();
  });
}

module.exports = { startScheduler };

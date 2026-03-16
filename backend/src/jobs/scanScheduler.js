const cron = require('node-cron');
const prisma = require('../utils/prisma');
const logger = require('../utils/logger');
const { runDiscoveryScan } = require('../services/discoveryService');
const { analyzeLeadIntent } = require('../services/aiService');

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
}

module.exports = { startScheduler };

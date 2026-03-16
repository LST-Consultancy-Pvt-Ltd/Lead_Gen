const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');

async function getOverview(req, res) {
  try {
    const orgId = req.user.organizationId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);

    const [
      totalLeads, leadsToday, hotLeads,
      emailsSent, emailsToday,
      meetings, campaigns, scanJobs,
    ] = await Promise.all([
      prisma.lead.count({ where: { organizationId: orgId } }),
      prisma.lead.count({ where: { organizationId: orgId, createdAt: { gte: today } } }),
      prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'hot' } }),
      prisma.emailLog.count({ where: { organizationId: orgId, status: { in: ['sent', 'opened', 'replied'] } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, createdAt: { gte: today } } }),
      prisma.lead.count({ where: { organizationId: orgId, status: 'meeting_booked' } }),
      prisma.campaign.count({ where: { organizationId: orgId, status: 'active' } }),
      prisma.scanJob.count({ where: { organizationId: orgId, status: 'completed' } }),
    ]);

    const totalOpened = await prisma.emailLog.count({ where: { organizationId: orgId, openedAt: { not: null } } });
    const totalReplied = await prisma.emailLog.count({ where: { organizationId: orgId, repliedAt: { not: null } } });

    const topLeads = await prisma.lead.findMany({ where: { organizationId: orgId }, orderBy: { leadScore: 'desc' }, take: 5, select: { id: true, companyName: true, industry: true, companySize: true, leadScore: true, intentScore: true, intentLevel: true } });
    const hotToday = await prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'hot', createdAt: { gte: today } } });
    const warmLeads = await prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'warm' } });
    const coldLeads = await prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'cold' } });
    return success(res, {
      totalLeads, leadsToday, hotLeads, hotToday, warmLeads, coldLeads,
      emailsSent, emailsToday,
      meetingsBooked: meetings, meetingsToday: 0, campaigns, scanJobs,
      openRate: emailsSent > 0 ? ((totalOpened / emailsSent) * 100).toFixed(1) : 0,
      replyRate: emailsSent > 0 ? ((totalReplied / emailsSent) * 100).toFixed(1) : 0,
      replyRateDelta: '+2.1% vs last week',
      conversionRate: totalLeads > 0 ? ((meetings / totalLeads) * 100).toFixed(1) : 0,
      topLeads,
    });
  } catch (err) {
    return error(res, 'Failed to fetch analytics', 500);
  }
}

async function getLeadsByMonth(req, res) {
  try {
    const orgId = req.user.organizationId;
    const months = 12;
    const data = [];

    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      const start = new Date(d.getFullYear(), d.getMonth(), 1);
      const end = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);

      const count = await prisma.lead.count({
        where: { organizationId: orgId, createdAt: { gte: start, lte: end } },
      });

      data.push({
        month: start.toLocaleString('default', { month: 'short' }),
        year: start.getFullYear(),
        count,
      });
    }
    return success(res, data);
  } catch (err) {
    return error(res, 'Failed to fetch monthly data', 500);
  }
}

async function getLeadsByStatus(req, res) {
  try {
    const orgId = req.user.organizationId;
    const statuses = ['new', 'contacted', 'replied', 'meeting_booked', 'qualified', 'closed_won', 'closed_lost'];
    const data = await Promise.all(
      statuses.map(async status => ({
        status,
        count: await prisma.lead.count({ where: { organizationId: orgId, status } }),
      }))
    );
    return success(res, data);
  } catch (err) {
    return error(res, 'Failed to fetch status breakdown', 500);
  }
}

async function getTopSources(req, res) {
  try {
    const orgId = req.user.organizationId;
    const leads = await prisma.lead.groupBy({
      by: ['source'],
      where: { organizationId: orgId, source: { not: null } },
      _count: { source: true },
      orderBy: { _count: { source: 'desc' } },
      take: 10,
    });
    return success(res, leads.map(l => ({ source: l.source, count: l._count.source })));
  } catch (err) {
    return error(res, 'Failed to fetch sources', 500);
  }
}

module.exports = { getOverview, getLeadsByMonth, getLeadsByStatus, getTopSources };

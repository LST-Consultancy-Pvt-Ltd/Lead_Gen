const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');

// ─── Shared constants & date helpers ────────────────────────────
const CLOSED_LEAD_STATUSES = ['disqualified', 'closed_won', 'closed_lost'];
const CLOSED_OPP_STAGES = ['closed_won', 'closed_lost'];

function _today() {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
}

function _tomorrow(today) {
  const t = new Date(today);
  t.setDate(t.getDate() + 1);
  return t;
}

function _weekStart(today) {
  const d = today.getDay();
  const ws = new Date(today);
  ws.setDate(today.getDate() - (d === 0 ? 6 : d - 1)); // Monday
  return ws;
}

function _parseDateRange(query) {
  const today = _today();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  return {
    from: query.dateFrom ? new Date(query.dateFrom) : thirtyDaysAgo,
    to: query.dateTo ? new Date(query.dateTo) : _tomorrow(today),
  };
}

/**
 * Build role-scoped WHERE fragments for leads and opportunities.
 *   sales_user → own records only
 *   manager    → self + direct reports
 *   admin      → whole organisation
 */
async function _buildScope(user) {
  const { getTeamMemberIds, ADMIN_ROLES } = require('../middleware/rbac');
  const orgId = user.organizationId;
  const ids = await getTeamMemberIds(user);
  const userIds = ids.includes(user.id) ? ids : [user.id, ...ids];
  const isAll = ADMIN_ROLES.includes(user.role);
  const assigned = isAll
    ? {}
    : user.role === 'sales_user'
      ? { assignedToId: user.id }
      : { assignedToId: { in: userIds } };

  return {
    orgId,
    userIds,
    leadWhere: { organizationId: orgId, ...assigned },
    oppWhere: { organizationId: orgId, ...assigned },
  };
}

// ─── Widget helpers (accept scoped WHERE fragments) ─────────────

/**
 * Follow-up rows go to the UI tagged with the record they belong to, so a
 * click opens the right page. Without entityType a lead and an opportunity
 * are indistinguishable once both lists are merged.
 */
function _tagLead(l) {
  return { ...l, entityType: 'lead', entityId: l.id };
}

function _tagOpp(o) {
  return {
    ...o,
    entityType: 'opportunity',
    entityId: o.id,
    // Display name the follow-up widgets read
    companyName: o.opportunityName || o.title || o.lead?.companyName || null,
  };
}

async function _wLeadsToday(leadWhere) {
  const today = _today();
  return prisma.lead.count({
    where: { ...leadWhere, createdAt: { gte: today, lt: _tomorrow(today) } },
  });
}

async function _wLeadsThisWeek(leadWhere) {
  const today = _today();
  return prisma.lead.count({
    where: { ...leadWhere, createdAt: { gte: _weekStart(today) } },
  });
}

async function _wFollowUpsDueToday(leadWhere, oppWhere) {
  const today = _today();
  const tomorrow = _tomorrow(today);
  const [leads, opportunities] = await Promise.all([
    prisma.lead.findMany({
      where: { ...leadWhere, followUpDate: { gte: today, lt: tomorrow }, status: { notIn: CLOSED_LEAD_STATUSES } },
      orderBy: { temperature: 'asc' }, // enum order hot→warm→cold, asc = Hot first
      select: { id: true, companyName: true, contactName: true, followUpDate: true, status: true, temperature: true },
    }),
    prisma.opportunity.findMany({
      where: { ...oppWhere, followUpDate: { gte: today, lt: tomorrow }, stage: { notIn: CLOSED_OPP_STAGES } },
      select: { id: true, title: true, opportunityName: true, stage: true, dealValue: true,
        followUpDate: true, expectedCloseDate: true,
        lead: { select: { id: true, companyName: true } },
        assignedTo: { select: { id: true, name: true } } },
    }),
  ]);
  return { leads: leads.map(_tagLead), opportunities: opportunities.map(_tagOpp) };
}

async function _wOverdueFollowUps(leadWhere, oppWhere) {
  const today = _today();
  const [leads, opportunities] = await Promise.all([
    prisma.lead.findMany({
      where: { ...leadWhere, followUpDate: { lt: today }, status: { notIn: CLOSED_LEAD_STATUSES } },
      orderBy: { followUpDate: 'asc' },
      select: { id: true, companyName: true, contactName: true, followUpDate: true, status: true, temperature: true,
        assignedTo: { select: { id: true, name: true } } },
      take: 50,
    }),
    prisma.opportunity.findMany({
      where: { ...oppWhere, followUpDate: { lt: today }, stage: { notIn: CLOSED_OPP_STAGES } },
      orderBy: { followUpDate: 'asc' },
      select: { id: true, title: true, opportunityName: true, stage: true, dealValue: true,
        followUpDate: true, expectedCloseDate: true,
        lead: { select: { id: true, companyName: true } },
        assignedTo: { select: { id: true, name: true } } },
      take: 50,
    }),
  ]);
  return { leads: leads.map(_tagLead), opportunities: opportunities.map(_tagOpp) };
}

async function _wOpenOpportunitiesByStage(oppWhere) {
  const raw = await prisma.opportunity.groupBy({
    by: ['stage'],
    where: { ...oppWhere, stage: { notIn: CLOSED_OPP_STAGES } },
    _count: { id: true },
    _sum: { dealValue: true },
  });
  return raw.map((r) => ({ stage: r.stage, count: r._count.id, totalValue: r._sum.dealValue || 0 }));
}

async function _wConversionRate(leadWhere, since) {
  const dateFilter = since ? { createdAt: { gte: since } } : {};
  const [total, converted] = await Promise.all([
    prisma.lead.count({ where: { ...leadWhere, ...dateFilter } }),
    prisma.lead.count({ where: { ...leadWhere, ...dateFilter, opportunities: { some: {} } } }),
  ]);
  return { total, converted, rate: total > 0 ? ((converted / total) * 100).toFixed(1) : '0.0' };
}

async function _wLeadsByExecutive(orgId, userIds, dateFrom, dateTo) {
  const members = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: orgId, isActive: true },
    select: { id: true, name: true, email: true },
  });
  return Promise.all(
    members.map(async (m) => ({
      user: m,
      count: await prisma.lead.count({
        where: { organizationId: orgId, assignedToId: m.id, createdAt: { gte: dateFrom, lte: dateTo } },
      }),
    }))
  );
}

async function _wConversionRateByExecutive(orgId, userIds, dateFrom, dateTo) {
  const members = await prisma.user.findMany({
    where: { id: { in: userIds }, organizationId: orgId, isActive: true },
    select: { id: true, name: true, email: true },
  });
  return Promise.all(
    members.map(async (m) => {
      const w = { organizationId: orgId, assignedToId: m.id, createdAt: { gte: dateFrom, lte: dateTo } };
      const [total, converted] = await Promise.all([
        prisma.lead.count({ where: w }),
        prisma.lead.count({ where: { ...w, opportunities: { some: {} } } }),
      ]);
      return { user: m, total, converted, rate: total > 0 ? ((converted / total) * 100).toFixed(1) : '0.0' };
    })
  );
}

async function _wPipelineByStage(oppWhere) {
  const raw = await prisma.opportunity.groupBy({
    by: ['stage'],
    where: { ...oppWhere, stage: { notIn: CLOSED_OPP_STAGES } },
    _count: { id: true },
    _sum: { dealValue: true },
  });
  return raw.map((r) => ({ stage: r.stage, count: r._count.id, totalValue: r._sum.dealValue || 0 }));
}

async function _wStuckDeals(oppWhere, staleDays = 7) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - staleDays);
  return prisma.opportunity.findMany({
    where: {
      ...oppWhere,
      stage: { notIn: CLOSED_OPP_STAGES },
      OR: [
        { stageChangedAt: { not: null, lt: cutoff } },
        { stageChangedAt: null, updatedAt: { lt: cutoff } },
      ],
    },
    select: {
      id: true, title: true, stage: true, dealValue: true, stageChangedAt: true, updatedAt: true,
      assignedTo: { select: { id: true, name: true } },
      lead: { select: { id: true, companyName: true } },
    },
    orderBy: { updatedAt: 'asc' },
    take: 50,
  });
}

async function _wLossReasonBreakdown(oppWhere, dateFrom, dateTo) {
  const lost = await prisma.opportunity.findMany({
    where: { ...oppWhere, stage: 'closed_lost', updatedAt: { gte: dateFrom, lte: dateTo } },
    select: { wonLostReason: true, dealValue: true },
  });
  const map = {};
  for (const o of lost) {
    const r = o.wonLostReason || 'Not specified';
    if (!map[r]) map[r] = { count: 0, totalValue: 0 };
    map[r].count++;
    map[r].totalValue += o.dealValue || 0;
  }
  return Object.entries(map)
    .map(([reason, d]) => ({ reason, ...d }))
    .sort((a, b) => b.count - a.count);
}

async function _wRevenueClosed(oppWhere, dateFrom, dateTo) {
  const agg = await prisma.opportunity.aggregate({
    where: { ...oppWhere, stage: 'closed_won', updatedAt: { gte: dateFrom, lte: dateTo } },
    _sum: { dealValue: true },
    _count: { id: true },
  });
  return { totalValue: agg._sum.dealValue || 0, dealCount: agg._count.id };
}

async function _wRevenueForecast(oppWhere) {
  const opps = await prisma.opportunity.findMany({
    where: { ...oppWhere, stage: { notIn: CLOSED_OPP_STAGES } },
    select: { dealValue: true, probability: true },
  });
  const weighted = opps.reduce((sum, o) => sum + (o.dealValue || 0) * ((o.probability || 0) / 100), 0);
  return { weightedValue: Math.round(weighted * 100) / 100, openDeals: opps.length };
}

async function getOverview(req, res) {
  try {
    const orgId = req.user.organizationId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const twoWeeksAgo = new Date(today); twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    const [
      totalLeads, leadsToday, hotLeads,
      emailsSent, emailsToday,
      meetings, meetingsToday, campaigns, scanJobs,
    ] = await Promise.all([
      prisma.lead.count({ where: { organizationId: orgId } }),
      prisma.lead.count({ where: { organizationId: orgId, createdAt: { gte: today } } }),
      prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'hot' } }),
      prisma.emailLog.count({ where: { organizationId: orgId, status: { in: ['sent', 'opened', 'replied'] } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, createdAt: { gte: today, lt: tomorrow }, status: { in: ['sent', 'opened', 'replied'] } } }),
      prisma.lead.count({ where: { organizationId: orgId, status: 'meeting_booked' } }),
      prisma.lead.count({ where: { organizationId: orgId, status: 'meeting_booked', updatedAt: { gte: today, lt: tomorrow } } }),
      prisma.campaign.count({ where: { organizationId: orgId, status: 'active' } }),
      prisma.scanJob.count({ where: { organizationId: orgId, status: 'completed' } }),
    ]);

    const [totalOpened, totalReplied, emailsThisWeek, repliesThisWeek, emailsLastWeek, repliesLastWeek] = await Promise.all([
      prisma.emailLog.count({ where: { organizationId: orgId, openedAt: { not: null } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, repliedAt: { not: null } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, createdAt: { gte: weekAgo }, status: { in: ['sent', 'opened', 'replied'] } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, repliedAt: { gte: weekAgo } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, createdAt: { gte: twoWeeksAgo, lt: weekAgo }, status: { in: ['sent', 'opened', 'replied'] } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, repliedAt: { gte: twoWeeksAgo, lt: weekAgo } } }),
    ]);

    const thisWeekReplyRate = emailsThisWeek > 0 ? (repliesThisWeek / emailsThisWeek) * 100 : 0;
    const lastWeekReplyRate = emailsLastWeek > 0 ? (repliesLastWeek / emailsLastWeek) * 100 : 0;
    const delta = thisWeekReplyRate - lastWeekReplyRate;
    const replyRateDelta = `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}% vs last week`;

    const topLeads = await prisma.lead.findMany({ where: { organizationId: orgId }, orderBy: { leadScore: 'desc' }, take: 5, select: { id: true, companyName: true, industry: true, companySize: true, leadScore: true, intentScore: true, intentLevel: true } });
    const hotToday = await prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'hot', createdAt: { gte: today } } });
    const warmLeads = await prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'warm' } });
    const coldLeads = await prisma.lead.count({ where: { organizationId: orgId, intentLevel: 'cold' } });
    return success(res, {
      totalLeads, leadsToday, hotLeads, hotToday, warmLeads, coldLeads,
      emailsSent, emailsToday,
      meetingsBooked: meetings, meetingsToday, campaigns, scanJobs,
      openRate: emailsSent > 0 ? ((totalOpened / emailsSent) * 100).toFixed(1) : 0,
      replyRate: emailsSent > 0 ? ((totalReplied / emailsSent) * 100).toFixed(1) : 0,
      replyRateDelta,
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

/**
 * GET /api/analytics/team-performance
 * Org-wide per-user lead stats â€” manager/admin only
 */
async function getTeamPerformance(req, res) {
  try {
    const orgId = req.user.organizationId;
    const members = await prisma.user.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, email: true, role: true, avatarUrl: true },
    });

    const stats = await Promise.all(
      members.map(async (member) => {
        const [totalLeads, hotLeads, meetings, emailsSent, activitiesCount] = await Promise.all([
          prisma.lead.count({ where: { organizationId: orgId, assignedToId: member.id } }),
          prisma.lead.count({ where: { organizationId: orgId, assignedToId: member.id, intentLevel: 'hot' } }),
          prisma.lead.count({ where: { organizationId: orgId, assignedToId: member.id, status: 'meeting_booked' } }),
          prisma.emailLog.count({ where: { organizationId: orgId, sentById: member.id, status: { in: ['sent', 'opened', 'replied'] } } }),
          prisma.activityLog.count({ where: { organizationId: orgId, userId: member.id } }),
        ]);
        return { ...member, totalLeads, hotLeads, meetings, emailsSent, activitiesCount };
      })
    );

    return success(res, stats);
  } catch (err) {
    return error(res, 'Failed to fetch team performance', 500);
  }
}

/**
 * GET /api/analytics/my
 * Personal stats for the authenticated user â€” all roles
 */
async function getMyAnalytics(req, res) {
  try {
    const userId = req.user.id;
    const orgId = req.user.organizationId;
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7);
    const monthAgo = new Date(today); monthAgo.setDate(monthAgo.getDate() - 30);

    const [
      totalLeads, hotLeads, warmLeads,
      newLeads, contactedLeads, qualifiedLeads, closedWon,
      leadsThisWeek, leadsThisMonth,
      emailsSent, emailsThisWeek,
      activities, activitiesThisWeek,
      meetings,
    ] = await Promise.all([
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, intentLevel: 'hot' } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, intentLevel: 'warm' } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, status: 'new' } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, status: 'contacted' } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, status: 'qualified' } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, status: 'closed_won' } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, createdAt: { gte: weekAgo } } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, createdAt: { gte: monthAgo } } }),
      prisma.emailLog.count({ where: { organizationId: orgId, sentById: userId } }),
      prisma.emailLog.count({ where: { organizationId: orgId, sentById: userId, createdAt: { gte: weekAgo } } }),
      prisma.activityLog.count({ where: { organizationId: orgId, userId } }),
      prisma.activityLog.count({ where: { organizationId: orgId, userId, createdAt: { gte: weekAgo } } }),
      prisma.lead.count({ where: { organizationId: orgId, assignedToId: userId, status: 'meeting_booked' } }),
    ]);

    const recentActivities = await prisma.activityLog.findMany({
      where: { organizationId: orgId, userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { lead: { select: { id: true, companyName: true } } },
    });

    return success(res, {
      leads: { total: totalLeads, hot: hotLeads, warm: warmLeads, new: newLeads, contacted: contactedLeads, qualified: qualifiedLeads, closedWon, thisWeek: leadsThisWeek, thisMonth: leadsThisMonth },
      emails: { total: emailsSent, thisWeek: emailsThisWeek },
      activities: { total: activities, thisWeek: activitiesThisWeek, recent: recentActivities },
      meetings,
    });
  } catch (err) {
    return error(res, 'Failed to fetch personal analytics', 500);
  }
}

/**
 * GET /api/analytics/dashboard/sales
 * Sales Executive — 6 widgets, always scoped to the current user's own records.
 * Widgets: leadsToday, leadsThisWeek, followUpsDueToday (Hot→Warm→Cold),
 *          overdueFollowUps, openOpportunitiesByStage, conversionRateLast30Days
 */
async function getSalesDashboard(req, res) {
  try {
    const orgId = req.user.organizationId;
    const userId = req.user.id;
    const leadWhere = { organizationId: orgId, assignedToId: userId };
    const oppWhere = { organizationId: orgId, assignedToId: userId };
    const thirtyDaysAgo = new Date(_today());
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const monthStart = new Date(_today());
    monthStart.setDate(1);

    const [
      leadsToday,
      leadsThisWeek,
      leadsThisMonth,
      totalMyLeads,
      followUpsDueToday,
      overdueFollowUps,
      openOpportunitiesByStage,
      conversionRate,
      myLeads,
      statusGroups,
    ] = await Promise.all([
      _wLeadsToday(leadWhere),
      _wLeadsThisWeek(leadWhere),
      prisma.lead.count({ where: { ...leadWhere, createdAt: { gte: monthStart } } }),
      prisma.lead.count({ where: leadWhere }),
      _wFollowUpsDueToday(leadWhere, oppWhere),
      _wOverdueFollowUps(leadWhere, oppWhere),
      _wOpenOpportunitiesByStage(oppWhere),
      _wConversionRate(leadWhere, thirtyDaysAgo),
      // myLeads[]: 10 most recent leads assigned to this exec
      prisma.lead.findMany({
        where: leadWhere,
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true, companyName: true, industry: true, location: true,
          contactName: true, status: true, source: true, createdAt: true,
        },
      }),
      prisma.lead.groupBy({ by: ['status'], where: leadWhere, _count: { _all: true } }),
    ]);

    const statusBreakdown = Object.fromEntries(statusGroups.map((g) => [g.status, g._count._all]));

    return success(res, {
      leadsToday,
      leadsThisWeek,
      leadsThisMonth,
      totalMyLeads,
      followUpsDueToday,
      overdueFollowUps,
      openOpportunitiesByStage,
      conversionRateLast30Days: conversionRate,
      myLeads,
      statusBreakdown,
    });
  } catch (err) {
    console.error('[getSalesDashboard]', err);
    return error(res, 'Failed to fetch sales dashboard', 500);
  }
}

/**
 * Sales Manager — 8 widgets, full team scope, all filterable by date range.
 * Query params: ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&staleDays=7
 * Widgets: leadsByExecutive, conversionRateByExecutive, pipelineByStage,
 *          stuckDeals, overdueFollowUps, lossReasonBreakdown,
 *          revenueClosed, revenueForecast
 */
async function getManagerDashboard(req, res) {
  try {
    const { orgId, userIds: allUserIds, leadWhere: baseLead, oppWhere: baseOpp } = await _buildScope(req.user);
    const { from, to } = _parseDateRange(req.query);
    const staleDays = parseInt(req.query.staleDays, 10) || 7;

    // Optional executive filter — one or more, each a member of the team
    let userIds = allUserIds;
    let leadWhere = baseLead;
    let oppWhere = baseOpp;
    const execIds = _csvParam(req.query.executiveId);
    if (execIds.length) {
      if (execIds.some((id) => !allUserIds.includes(id))) {
        return error(res, 'Executive not in your team', 403);
      }
      userIds = execIds;
      leadWhere = { ...baseLead, assignedToId: { in: execIds } };
      oppWhere = { ...baseOpp, assignedToId: { in: execIds } };
    }

    const [
      leadsByExecutive,
      conversionRateByExecutive,
      pipelineByStage,
      stuckDeals,
      overdueFollowUps,
      lossReasonBreakdown,
      revenueClosed,
      revenueForecast,
      leadsCountByStatus,
    ] = await Promise.all([
      _wLeadsByExecutive(orgId, userIds, from, to),
      _wConversionRateByExecutive(orgId, userIds, from, to),
      _wPipelineByStage(oppWhere),
      _wStuckDeals(oppWhere, staleDays),
      _wOverdueFollowUps(leadWhere, oppWhere),
      _wLossReasonBreakdown(oppWhere, from, to),
      _wRevenueClosed(oppWhere, from, to),
      _wRevenueForecast(oppWhere),
      prisma.lead.groupBy({
        by: ['status'],
        where: { organizationId: orgId, assignedToId: { in: userIds }, createdAt: { gte: from, lte: to } },
        _count: { _all: true },
      }),
    ]);

    const leadsStatusMap = Object.fromEntries(leadsCountByStatus.map((g) => [g.status, g._count._all]));

    return success(res, {
      leadsByExecutive,
      conversionRateByExecutive,
      pipelineByStage,
      stuckDeals,
      overdueFollowUps,
      lossReasonBreakdown,
      revenueClosed,
      revenueForecast,
      leadsStatusMap,
    });
  } catch (err) {
    console.error('[getManagerDashboard]', err);
    return error(res, 'Failed to fetch manager dashboard', 500);
  }
}

/**
 * GET /api/analytics/dashboard/ceo
 * Admin / CEO — inherits all 8 manager widgets with system-wide data scope
 * (all teams, all executives). Adds admin extras: totalActiveUsers,
 * recentAuditLogs.
 * Query params: ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&staleDays=7
 */
async function getCEODashboard(req, res) {
  try {
    const { orgId, userIds: allUserIds, leadWhere: baseLeadWhere, oppWhere: baseOppWhere } = await _buildScope(req.user);
    const { from, to } = _parseDateRange(req.query);
    const staleDays = parseInt(req.query.staleDays, 10) || 7;
    const period = req.query.period || 'month'; // today | week | month | quarter

    // Optional manager / executive filter — admin can scope the dashboard to a
    // specific manager's team or a single executive within that team.
    let userIds = allUserIds;
    let leadWhere = baseLeadWhere;
    let oppWhere = baseOppWhere;

    const managerIds = _csvParam(req.query.managerId);
    if (managerIds.length) {
      const teamMembers = await prisma.user.findMany({
        where: { managerId: { in: managerIds }, organizationId: orgId },
        select: { id: true },
      });
      const teamIds = teamMembers.map((m) => m.id);
      userIds = [...new Set([...managerIds, ...teamIds])];
      leadWhere = { organizationId: orgId, assignedToId: { in: userIds } };
      oppWhere = { organizationId: orgId, assignedToId: { in: userIds } };

      const execIds = _csvParam(req.query.executiveId);
      if (execIds.length) {
        if (execIds.some((id) => !teamIds.includes(id))) {
          return error(res, "Executive not in this manager's team", 403);
        }
        userIds = execIds;
        leadWhere = { organizationId: orgId, assignedToId: { in: execIds } };
        oppWhere = { organizationId: orgId, assignedToId: { in: execIds } };
      }
    }

    // Date-scoped where clause — used for KPIs and breakdowns
    const leadWhereScoped = { ...leadWhere, createdAt: { gte: from, lte: to } };

    const [
      leadsByExecutive,
      conversionRateByExecutive,
      pipelineByStage,
      stuckDeals,
      overdueFollowUps,
      lossReasonBreakdown,
      revenueClosed,
      revenueForecast,
      totalActiveUsers,
      recentAuditLogs,
      totalLeads,
      leadsPeriod,
      leadSourceGroups,
    ] = await Promise.all([
      _wLeadsByExecutive(orgId, userIds, from, to),
      _wConversionRateByExecutive(orgId, userIds, from, to),
      _wPipelineByStage(oppWhere),
      _wStuckDeals(oppWhere, staleDays),
      _wOverdueFollowUps(leadWhere, oppWhere),
      _wLossReasonBreakdown(oppWhere, from, to),
      _wRevenueClosed(oppWhere, from, to),
      _wRevenueForecast(oppWhere),
      prisma.user.count({ where: { organizationId: orgId, isActive: true } }),
      prisma.auditLog.findMany({
        where: { organizationId: orgId },
        orderBy: { changedAt: 'desc' },
        take: 20,
        select: {
          id: true, action: true, entityType: true, entityId: true, changedAt: true,
          changedBy: { select: { id: true, name: true, email: true } },
        },
      }),
      // all-time total (scope only, no date filter) — for the "Total leads" KPI card
      prisma.lead.count({ where: leadWhere }),
      // period-scoped count — changes with the period dropdown
      prisma.lead.count({ where: leadWhereScoped }),
      // lead source breakdown over every lead in scope, so it adds up to the
      // "Total leads" KPI rather than to whatever the period dropdown says
      prisma.lead.groupBy({
        by: ['source'],
        where: leadWhere,
        _count: { _all: true },
        orderBy: { _count: { source: 'desc' } },
      }),
    ]);

    // ── leadsOverTime: granularity depends on the selected period ────────────
    let leadsOverTime;
    if (period === 'today') {
      // 24 hourly buckets
      leadsOverTime = await Promise.all(
        Array.from({ length: 24 }, (_, h) => {
          const start = new Date(from);
          start.setHours(h, 0, 0, 0);
          const end = new Date(from);
          end.setHours(h + 1, 0, 0, 0);
          return prisma.lead
            .count({ where: { ...leadWhere, createdAt: { gte: start, lt: end } } })
            .then((count) => ({ month: `${String(h).padStart(2, '0')}:00`, year: from.getFullYear(), count }));
        })
      );
    } else if (period === 'week') {
      // 7 daily buckets starting from `from`
      leadsOverTime = await Promise.all(
        Array.from({ length: 7 }, (_, i) => {
          const start = new Date(from);
          start.setDate(from.getDate() + i);
          const end = new Date(start);
          end.setDate(start.getDate() + 1);
          return prisma.lead
            .count({ where: { ...leadWhere, createdAt: { gte: start, lt: end } } })
            .then((count) => ({
              month: start.toLocaleString('default', { weekday: 'short' }),
              year: start.getFullYear(),
              count,
            }));
        })
      );
    } else if (period === 'quarter') {
      // 3 monthly buckets for the quarter
      leadsOverTime = await Promise.all(
        Array.from({ length: 3 }, (_, i) => {
          const start = new Date(from.getFullYear(), from.getMonth() + i, 1);
          const end = new Date(from.getFullYear(), from.getMonth() + i + 1, 1);
          return prisma.lead
            .count({ where: { ...leadWhere, createdAt: { gte: start, lt: end } } })
            .then((count) => ({
              month: start.toLocaleString('default', { month: 'short' }),
              year: start.getFullYear(),
              count,
            }));
        })
      );
    } else {
      // month (default): daily buckets for each day of the selected month
      const daysInMonth = new Date(from.getFullYear(), from.getMonth() + 1, 0).getDate();
      leadsOverTime = await Promise.all(
        Array.from({ length: daysInMonth }, (_, i) => {
          const start = new Date(from.getFullYear(), from.getMonth(), i + 1);
          const end = new Date(from.getFullYear(), from.getMonth(), i + 2);
          return prisma.lead
            .count({ where: { ...leadWhere, createdAt: { gte: start, lt: end } } })
            .then((count) => ({
              month: String(i + 1),
              year: start.getFullYear(),
              count,
            }));
        })
      );
    }

    // Leads with a null source and leads with source 'manual' are separate groups; merge them
    const sourceCounts = new Map();
    for (const g of leadSourceGroups) {
      const type = g.source || 'manual';
      sourceCounts.set(type, (sourceCounts.get(type) || 0) + g._count._all);
    }
    const leadSourceBreakdown = [...sourceCounts].map(([type, count]) => ({ type, count }));

    return success(res, {
      leadsByExecutive,
      conversionRateByExecutive,
      pipelineByStage,
      stuckDeals,
      overdueFollowUps,
      lossReasonBreakdown,
      revenueClosed,
      revenueForecast,
      leadsOverTime,
      kpis: { totalLeads, leadsPeriod, leadSourceBreakdown },
      admin: {
        totalActiveUsers,
        recentAuditLogs,
      },
    });
  } catch (err) {
    return error(res, 'Failed to fetch CEO dashboard', 500);
  }
}

/**
 * GET /api/analytics/dashboard
 * Fully dynamic — returns the right set of widgets based on the caller's role.
 *   sales_user              → 6 executive widgets  (own records)
 *   manager                 → 8 manager widgets    (team scope)
 *   org_admin / super_admin → 8 manager widgets    (org-wide) + admin extras
 * Query params: ?dateFrom=YYYY-MM-DD&dateTo=YYYY-MM-DD&staleDays=7
 */
async function getDashboard(req, res) {
  try {
    const { ADMIN_ROLES, MANAGER_AND_ABOVE } = require('../middleware/rbac');
    const role = req.user.role;
    const { orgId, userIds, leadWhere, oppWhere } = await _buildScope(req.user);

    // ── Executive widgets (every role gets these) ───────────────
    const thirtyDaysAgo = new Date(_today());
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const executivePromises = {
      leadsToday:              _wLeadsToday(leadWhere),
      leadsThisWeek:           _wLeadsThisWeek(leadWhere),
      followUpsDueToday:       _wFollowUpsDueToday(leadWhere, oppWhere),
      overdueFollowUps:        _wOverdueFollowUps(leadWhere, oppWhere),
      openOpportunitiesByStage: _wOpenOpportunitiesByStage(oppWhere),
      conversionRateLast30Days: _wConversionRate(leadWhere, thirtyDaysAgo),
    };

    // ── Manager widgets (manager + admin only) ──────────────────
    let managerPromises = {};
    if (MANAGER_AND_ABOVE.includes(role)) {
      const { from, to } = _parseDateRange(req.query);
      const staleDays = parseInt(req.query.staleDays, 10) || 7;
      managerPromises = {
        leadsByExecutive:           _wLeadsByExecutive(orgId, userIds, from, to),
        conversionRateByExecutive:  _wConversionRateByExecutive(orgId, userIds, from, to),
        pipelineByStage:            _wPipelineByStage(oppWhere),
        stuckDeals:                 _wStuckDeals(oppWhere, staleDays),
        lossReasonBreakdown:        _wLossReasonBreakdown(oppWhere, from, to),
        revenueClosed:              _wRevenueClosed(oppWhere, from, to),
        revenueForecast:            _wRevenueForecast(oppWhere),
      };
    }

    // ── Admin extras (admin only) ───────────────────────────────
    let adminPromises = {};
    if (ADMIN_ROLES.includes(role)) {
      adminPromises = {
        totalActiveUsers: prisma.user.count({ where: { organizationId: orgId, isActive: true } }),
        recentAuditLogs: prisma.auditLog.findMany({
          where: { organizationId: orgId },
          orderBy: { changedAt: 'desc' },
          take: 20,
          select: {
            id: true, action: true, entityType: true, entityId: true, changedAt: true,
            changedBy: { select: { id: true, name: true, email: true } },
          },
        }),
      };
    }

    // Resolve all promises in parallel
    const allKeys = { ...executivePromises, ...managerPromises, ...adminPromises };
    const keys = Object.keys(allKeys);
    const values = await Promise.all(Object.values(allKeys));
    const data = {};
    keys.forEach((k, i) => { data[k] = values[i]; });

    // Nest admin extras under an `admin` key when present
    if (ADMIN_ROLES.includes(role)) {
      data.admin = {
        totalActiveUsers: data.totalActiveUsers,
        recentAuditLogs: data.recentAuditLogs,
      };
      delete data.totalActiveUsers;
      delete data.recentAuditLogs;
    }

    // Attach metadata so the frontend knows what it received
    data._meta = {
      role,
      scope: ADMIN_ROLES.includes(role) ? 'organization' : role === 'manager' ? 'team' : 'own',
      widgetCount: keys.length - Object.keys(adminPromises).length + (ADMIN_ROLES.includes(role) ? 1 : 0),
    };

    return success(res, data);
  } catch (err) {
    return error(res, 'Failed to fetch dashboard', 500);
  }
}

/**
 * GET /api/analytics/dashboard/stream
 * SSE endpoint — keeps connection open and pushes { event: "dashboard:change", entity }
 * whenever a lead/opportunity/activity mutation occurs in the user's org.
 * The frontend should call GET /api/analytics/dashboard on each event to refresh data.
 */
function getDashboardStream(req, res) {
  const dashboardEvents = require('../utils/dashboardEvents');
  const orgId = req.user.organizationId;
  const role = req.user.role;

  // SSE headers
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no', // nginx passthrough
  });

  // Send initial heartbeat so client knows connection is live
  res.write(`data: ${JSON.stringify({ event: 'connected', role, timestamp: new Date().toISOString() })}\n\n`);

  // Keep-alive every 30s to prevent proxy/load-balancer timeouts
  const heartbeat = setInterval(() => {
    try { res.write(': heartbeat\n\n'); } catch (_) { /* noop */ }
  }, 30000);

  // Register this client
  const removeClient = dashboardEvents.addClient(orgId, role, res);

  // Cleanup on disconnect
  req.on('close', () => {
    clearInterval(heartbeat);
    removeClient();
  });
}

// ─── Follow-up Calendar ─────────────────────────────────────────

const CAL_ENTITY_TYPES = ['lead', 'opportunity'];
const CAL_STATUSES = ['overdue', 'today', 'upcoming'];
const CAL_MAX_RANGE_DAYS = 400;

function _endOfDay(d) {
  const e = new Date(d);
  e.setHours(23, 59, 59, 999);
  return e;
}

function _bucket(date, today, tomorrow) {
  const d = new Date(date);
  if (d < today) return 'overdue';
  if (d < tomorrow) return 'today';
  return 'upcoming';
}

/**
 * GET /api/analytics/follow-ups/calendar
 *
 * Query: from, to (ISO dates — default: current month)
 *        entityType = lead | opportunity   (default: both)
 *        assignedToId                      (manager/admin, inside own scope)
 *        status = overdue | today | upcoming
 *
 * Returns every follow-up inside the window, plus the caller's full overdue
 * backlog (which mostly falls outside the window) for the side list.
 *
 * Every item carries entityType + entityId so the UI opens the right record.
 * Never navigate by company name — a lead and an opportunity can share one.
 */
/** "a,b" | "a" | ["a","b"] | undefined → ["a","b"]. Blanks and dupes dropped. */
function _csvParam(raw) {
  if (raw == null) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(',');
  return [...new Set(parts.map((v) => String(v).trim()).filter(Boolean))];
}

async function getFollowUpCalendar(req, res) {
  try {
    const { ADMIN_ROLES } = require('../middleware/rbac');
    const { orgId, userIds, leadWhere, oppWhere } = await _buildScope(req.user);
    const today = _today();
    const tomorrow = _tomorrow(today);

    // ── Window (defaults to the calendar month we're in) ──────────────────
    const from = req.query.from
      ? new Date(req.query.from)
      : new Date(today.getFullYear(), today.getMonth(), 1);
    const to = req.query.to
      ? new Date(req.query.to)
      : new Date(today.getFullYear(), today.getMonth() + 1, 0);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return error(res, 'from/to must be valid dates', 400);
    }
    const rangeEnd = _endOfDay(to);
    if (rangeEnd < from) return error(res, '"to" must not be before "from"', 400);
    if ((rangeEnd - from) / 86_400_000 > CAL_MAX_RANGE_DAYS) {
      return error(res, `Date range must be ${CAL_MAX_RANGE_DAYS} days or less`, 400);
    }

    // ── Filters ───────────────────────────────────────────────────────────
    const entityType = req.query.entityType;
    if (entityType && !CAL_ENTITY_TYPES.includes(entityType)) {
      return error(res, "entityType must be 'lead' or 'opportunity'", 400);
    }
    const statusFilter = _csvParam(req.query.status);
    const badStatus = statusFilter.find((v) => !CAL_STATUSES.includes(v));
    if (badStatus) {
      return error(res, `status must be one of: ${CAL_STATUSES.join(', ')}`, 400);
    }

    let assignedFilter = {};
    const assignedIds = _csvParam(req.query.assignedToId);
    if (assignedIds.length) {
      // A manager may only ask about their own reports; admins see the org.
      const allowed =
        ADMIN_ROLES.includes(req.user.role) || assignedIds.every((id) => userIds.includes(id));
      if (!allowed) return error(res, 'Not allowed to view those users\' follow-ups', 403);
      assignedFilter = { assignedToId: { in: assignedIds } };
    }

    const wantLeads = entityType !== 'opportunity';
    const wantOpps = entityType !== 'lead';

    const leadBase = { ...leadWhere, ...assignedFilter, status: { notIn: CLOSED_LEAD_STATUSES } };
    const oppBase = { ...oppWhere, ...assignedFilter, stage: { notIn: CLOSED_OPP_STAGES } };

    const leadSelect = {
      id: true, companyName: true, contactName: true, status: true,
      temperature: true, followUpDate: true, source: true,
      assignedTo: { select: { id: true, name: true } },
    };
    const oppSelect = {
      id: true, title: true, opportunityName: true, stage: true, dealValue: true,
      followUpDate: true, expectedCloseDate: true, leadId: true,
      lead: { select: { id: true, companyName: true } },
      assignedTo: { select: { id: true, name: true } },
    };

    const [rangeLeads, rangeOpps, overdueLeads, overdueOpps] = await Promise.all([
      wantLeads
        ? prisma.lead.findMany({
            where: { ...leadBase, followUpDate: { gte: from, lte: rangeEnd } },
            select: leadSelect, orderBy: { followUpDate: 'asc' }, take: 500,
          })
        : [],
      wantOpps
        ? prisma.opportunity.findMany({
            where: { ...oppBase, followUpDate: { gte: from, lte: rangeEnd } },
            select: oppSelect, orderBy: { followUpDate: 'asc' }, take: 500,
          })
        : [],
      wantLeads
        ? prisma.lead.findMany({
            where: { ...leadBase, followUpDate: { lt: today } },
            select: leadSelect, orderBy: { followUpDate: 'asc' }, take: 100,
          })
        : [],
      wantOpps
        ? prisma.opportunity.findMany({
            where: { ...oppBase, followUpDate: { lt: today } },
            select: oppSelect, orderBy: { followUpDate: 'asc' }, take: 100,
          })
        : [],
    ]);

    // ── Activity type per record (Call / Email / Meeting …) ───────────────
    const leadIds = [...new Set([...rangeLeads, ...overdueLeads].map((l) => l.id))];
    const oppIds = [...new Set([...rangeOpps, ...overdueOpps].map((o) => o.id))];
    const orClauses = [
      ...(leadIds.length ? [{ leadId: { in: leadIds }, opportunityId: null }] : []),
      ...(oppIds.length ? [{ opportunityId: { in: oppIds } }] : []),
    ];
    const actions = orClauses.length
      ? await prisma.activityLog.findMany({
          where: { organizationId: orgId, nextActionDate: { not: null }, OR: orClauses },
          select: { leadId: true, opportunityId: true, action: true },
          orderBy: { createdAt: 'desc' },
          take: 2000,
        })
      : [];
    const actionByLead = new Map();
    const actionByOpp = new Map();
    for (const a of actions) {
      if (a.opportunityId) {
        if (!actionByOpp.has(a.opportunityId)) actionByOpp.set(a.opportunityId, a.action);
      } else if (a.leadId && !actionByLead.has(a.leadId)) {
        actionByLead.set(a.leadId, a.action);
      }
    }

    const mapLead = (l) => ({
      id: `lead:${l.id}`,
      entityType: 'lead',
      entityId: l.id,
      title: l.companyName || 'Untitled lead',
      subtitle: l.contactName || null,
      followUpDate: l.followUpDate,
      activityType: actionByLead.get(l.id) || 'follow_up',
      status: _bucket(l.followUpDate, today, tomorrow),
      recordStatus: l.status,
      temperature: l.temperature,
      source: l.source,
      assignedTo: l.assignedTo,
    });

    const mapOpp = (o) => ({
      id: `opportunity:${o.id}`,
      entityType: 'opportunity',
      entityId: o.id,
      title: o.opportunityName || o.title || o.lead?.companyName || 'Untitled opportunity',
      subtitle: o.lead?.companyName || null,
      followUpDate: o.followUpDate,
      activityType: actionByOpp.get(o.id) || 'follow_up',
      status: _bucket(o.followUpDate, today, tomorrow),
      recordStatus: o.stage,
      dealValue: o.dealValue,
      expectedCloseDate: o.expectedCloseDate,
      assignedTo: o.assignedTo,
    });

    const byDate = (a, b) => new Date(a.followUpDate) - new Date(b.followUpDate);
    let items = [...rangeLeads.map(mapLead), ...rangeOpps.map(mapOpp)].sort(byDate);
    const overdue = [...overdueLeads.map(mapLead), ...overdueOpps.map(mapOpp)].sort(byDate);

    const counts = {
      overdue: overdue.length,
      today: items.filter((i) => i.status === 'today').length,
      upcoming: items.filter((i) => i.status === 'upcoming').length,
      inRange: items.length,
    };

    if (statusFilter.length) items = items.filter((i) => statusFilter.includes(i.status));

    return success(res, {
      range: { from: from.toISOString(), to: rangeEnd.toISOString() },
      items,
      overdue,
      counts,
    });
  } catch (err) {
    console.error('[getFollowUpCalendar]', err);
    return error(res, 'Failed to fetch follow-up calendar', 500);
  }
}

module.exports = { getOverview, getLeadsByMonth, getLeadsByStatus, getTopSources, getTeamPerformance, getMyAnalytics, getCEODashboard, getManagerDashboard, getSalesDashboard, getDashboard, getDashboardStream, getFollowUpCalendar };

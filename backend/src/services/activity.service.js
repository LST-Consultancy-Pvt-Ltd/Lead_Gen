/**
 * activity.service.js
 * Service for logging and retrieving activities
 *
 * Spec rules:
 * - activity_date cannot be future
 * - outcome is required
 * - next_action_date must be future (if provided)
 * - exec (sales_user) can only log activities for records they own
 * - After save: parent record's lastContactedDate = today, followUpDate = nextActionDate
 */

const prisma = require("../utils/prisma");
const logger = require("../utils/logger");
const dashboardEvents = require("../utils/dashboardEvents");
const { logAudit } = require("../utils/auditLogger");

const ADMIN_ROLES = ["org_admin", "super_admin"];
const CONTACT_ACTIONS = [
  "call",
  "email",
  "meeting",
  "demo",
  "whatsapp",
  "follow-up",
  "follow_up",
];
const VALID_TYPES = [
  "call",
  "email",
  "meeting",
  "demo",
  "follow-up",
  "follow_up",
  "whatsapp",
  "note",
  "linkedin",
  "sms",
  "other",
];

class ActivityService {
  /**
   * Low-level activity logger used internally (does not throw)
   */
  async logActivity(data) {
    try {
      const activity = await prisma.activityLog.create({
        data: {
          organizationId: data.organizationId,
          userId: data.userId,
          leadId: data.leadId,
          opportunityId: data.opportunityId,
          action: data.action,
          description: data.description,
          outcome: data.outcome,
          notes: data.notes,
          activityDate: data.activityDate,
          duration: data.duration,
          nextActionDate: data.nextActionDate,
          linkedType: data.linkedType,
          metadata: data.metadata || {},
        },
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      });
      return activity;
    } catch (err) {
      logger.error("Failed to log activity (non-fatal)", {
        error: err.message,
      });
      return null;
    }
  }

  /**
   * Create a new activity (full spec validation)
   * Required body fields: action, outcome, linkedType ('lead'|'opportunity'), linkedId
   * Optional: activityDate (defaults to now), nextActionDate, duration, notes
   */
  async createActivity(data, user) {
    const {
      action,
      type,
      outcome,
      description,
      notes,
      duration,
      activityDate,
      nextActionDate,
      linkedType,
      linkedId,
      leadId,
      opportunityId,
      metadata,
    } = data;

    // Support legacy 'type' field alias
    const activityAction = (action || type || "")
      .toLowerCase()
      .replace(" ", "_");

    // Resolve linked entity — support both explicit linkedType/linkedId and legacy leadId/opportunityId
    const resolvedLinkedType =
      linkedType || (leadId ? "lead" : opportunityId ? "opportunity" : null);
    const resolvedLinkedId = linkedId || leadId || opportunityId || null;

    // ── Validate required fields ────────────────────────────────────────────
    if (!activityAction || !VALID_TYPES.includes(activityAction)) {
      return {
        success: false,
        statusCode: 400,
        message: `Action is required and must be one of: ${VALID_TYPES.join(", ")}`,
      };
    }

    // outcome is optional - removed required check

    if (
      !resolvedLinkedType ||
      !["lead", "opportunity"].includes(resolvedLinkedType)
    ) {
      return {
        success: false,
        statusCode: 400,
        message: "linkedType must be 'lead' or 'opportunity'",
      };
    }

    if (!resolvedLinkedId) {
      return {
        success: false,
        statusCode: 400,
        message: "A lead ID or opportunity ID must be provided",
      };
    }

    // ── activityDate must not be future (defaults to now) ───────────────────
    const resolvedDate = activityDate ? new Date(activityDate) : new Date();
    if (isNaN(resolvedDate.getTime())) {
      return {
        success: false,
        statusCode: 400,
        message: "activityDate is not a valid date",
      };
    }
    if (resolvedDate > new Date()) {
      return {
        success: false,
        statusCode: 400,
        message: "activityDate cannot be a future date",
      };
    }

    // ── nextActionDate is required and must be future ──────────────────────
    if (!nextActionDate) {
      return {
        success: false,
        statusCode: 400,
        message: "Next Action Date is required",
      };
    }
    let resolvedNextActionDate = new Date(nextActionDate);
    if (isNaN(resolvedNextActionDate.getTime())) {
      return {
        success: false,
        statusCode: 400,
        message: "nextActionDate is not a valid date",
      };
    }
    const _todayStart = new Date();
    _todayStart.setHours(0, 0, 0, 0);
    if (resolvedNextActionDate < _todayStart) {
      return {
        success: false,
        statusCode: 400,
        message: "nextActionDate must be today or a future date",
      };
    }

    // ── Verify linked record exists + check ownership ────────────────────────
    let resolvedLeadId = null;
    let resolvedOpportunityId = null;

    if (resolvedLinkedType === "lead") {
      const lead = await prisma.lead.findFirst({
        where: { id: resolvedLinkedId, organizationId: user.organizationId },
      });
      if (!lead)
        return { success: false, statusCode: 404, message: "Lead not found" };

      if (user.role === "sales_user" && lead.assignedToId !== user.id) {
        return {
          success: false,
          statusCode: 403,
          message: "You can only log activities for leads assigned to you",
        };
      }
      resolvedLeadId = lead.id;
    } else {
      const opp = await prisma.opportunity.findFirst({
        where: { id: resolvedLinkedId, organizationId: user.organizationId },
      });
      if (!opp)
        return {
          success: false,
          statusCode: 404,
          message: "Opportunity not found",
        };

      if (user.role === "sales_user" && opp.assignedToId !== user.id) {
        return {
          success: false,
          statusCode: 403,
          message:
            "You can only log activities for opportunities assigned to you",
        };
      }
      resolvedOpportunityId = opp.id;
      // Also capture the lead for context
      resolvedLeadId = opp.leadId || null;
    }

    // ── Create the activity ──────────────────────────────────────────────────
    const activity = await prisma.activityLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        leadId: resolvedLeadId,
        opportunityId: resolvedOpportunityId,
        linkedType: resolvedLinkedType,
        action: activityAction,
        description: description || "",
        outcome: outcome ? outcome.trim() : null,
        notes: notes || null,
        activityDate: resolvedDate,
        duration: duration ? parseInt(duration) : null,
        nextActionDate: resolvedNextActionDate,
        metadata: metadata || {},
      },
      include: {
        user: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, companyName: true } },
      },
    });

    // ── Post-save: update parent record ──────────────────────────────────────
    try {
      const parentUpdate = {
        lastContactedDate: new Date(),
        ...(resolvedNextActionDate
          ? { followUpDate: resolvedNextActionDate }
          : {}),
      };

      if (resolvedLinkedType === "lead" && resolvedLeadId) {
        await prisma.lead.update({
          where: { id: resolvedLeadId },
          data: parentUpdate,
        });
      } else if (
        resolvedLinkedType === "opportunity" &&
        resolvedOpportunityId
      ) {
        // Opportunity doesn't have followUpDate — update lead if linked
        if (resolvedLeadId) {
          await prisma.lead.update({
            where: { id: resolvedLeadId },
            data: parentUpdate,
          });
        }
      }
    } catch (updateErr) {
      logger.warn("Failed to update parent record after activity (non-fatal)", {
        error: updateErr.message,
      });
    }

    dashboardEvents.notifyOrg(user.organizationId, "activity");
    return { success: true, activity };
  }

  /**
   * Update an existing activity.
   * Cannot change leadId, opportunityId, or createdById.
   * sales_user can only edit their own activities.
   */
  async updateActivity(id, data, user) {
    const existing = await prisma.activityLog.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, companyName: true } },
      },
    });
    if (!existing) return { success: false, statusCode: 404, message: "Activity not found" };

    if (user.role === "sales_user" && existing.userId !== user.id) {
      return { success: false, statusCode: 403, message: "You can only edit activities you created" };
    }

    const { action, type, activityDate, duration, outcome, nextActionDate, notes, description } = data;

    const rawAction = action || type;
    const activityAction = rawAction ? rawAction.toLowerCase().replace(" ", "_") : null;
    if (activityAction && !VALID_TYPES.includes(activityAction)) {
      return { success: false, statusCode: 400, message: `Action must be one of: ${VALID_TYPES.join(", ")}` };
    }

    let resolvedDate = existing.activityDate;
    if (activityDate !== undefined) {
      resolvedDate = new Date(activityDate);
      if (isNaN(resolvedDate.getTime())) return { success: false, statusCode: 400, message: "activityDate is not a valid date" };
      if (resolvedDate > new Date()) return { success: false, statusCode: 400, message: "activityDate cannot be a future date" };
    }

    let resolvedNextActionDate = existing.nextActionDate;
    if (nextActionDate !== undefined) {
      resolvedNextActionDate = new Date(nextActionDate);
      if (isNaN(resolvedNextActionDate.getTime())) return { success: false, statusCode: 400, message: "nextActionDate is not a valid date" };
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      if (resolvedNextActionDate < todayStart) return { success: false, statusCode: 400, message: "nextActionDate must be today or a future date" };
    }

    const updateData = {
      ...(activityAction ? { action: activityAction } : {}),
      activityDate: resolvedDate,
      nextActionDate: resolvedNextActionDate,
      ...(duration !== undefined ? { duration: duration ? parseInt(duration) : null } : {}),
      ...(outcome !== undefined ? { outcome: outcome ? outcome.trim() : null } : {}),
      ...(notes !== undefined ? { notes: notes || null } : {}),
      ...(description !== undefined ? { description: description || "" } : {}),
    };

    const activity = await prisma.activityLog.update({
      where: { id },
      data: updateData,
      include: {
        user: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, companyName: true } },
      },
    });

    dashboardEvents.notifyOrg(user.organizationId, "activity");
    return { success: true, activity };
  }

  /**
   * Get activities with role-scoped filtering + full UI filter support.
   *
   * Query params:
   *   page, limit          — pagination
   *   leadId               — filter to a specific lead
   *   opportunityId        — filter to a specific opportunity
   *   userId               — filter by logger (internal use / my-activities)
   *   executiveId          — manager/admin: filter by which exec logged it
   *   type                 — activity type (call|email|meeting|demo|follow-up|whatsapp …)
   *   search               — text search across outcome + notes
   *   dateFrom / dateTo    — ISO date range on activityDate
   *   linkedId             — filter to a specific lead OR opportunity ID (any)
   *   linkedType           — 'lead' | 'opportunity' (used with linkedId)
   *   overdue              — 'true' → only activities where nextActionDate < now
   */
  async getActivities(queryParams, user) {
    const {
      page = 1,
      limit = 50,
      leadId,
      opportunityId,
      userId,
      executiveId,
      type,
      search,
      dateFrom,
      dateTo,
      linkedId,
      linkedType,
      overdue,
    } = queryParams;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = { organizationId: user.organizationId };

    // ── Role-based scope ────────────────────────────────────────────────────
    if (user.role === "sales_user") {
      // sales_user only sees activities on their own assigned records or logged by themselves
      const [ownLeadIds, ownOppIds] = await Promise.all([
        prisma.lead
          .findMany({
            where: {
              organizationId: user.organizationId,
              assignedToId: user.id,
            },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
        prisma.opportunity
          .findMany({
            where: {
              organizationId: user.organizationId,
              assignedToId: user.id,
            },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
      ]);

      where.OR = [
        { leadId: { in: ownLeadIds } },
        { opportunityId: { in: ownOppIds } },
        { userId: user.id },
      ];
    } else if (user.role === "manager") {
      // Manager sees their own + all direct reports' activities
      const teamMemberIds = (
        await prisma.user.findMany({
          where: { managerId: user.id, organizationId: user.organizationId },
          select: { id: true },
        })
      ).map((m) => m.id);

      where.userId = { in: [...teamMemberIds, user.id] };
    }
    // org_admin / super_admin → no extra scope (all org data)

    // ── Optional filters applied on top of role scope ───────────────────────

    // Filter by specific lead
    if (leadId) where.leadId = leadId;

    // Filter by specific opportunity
    if (opportunityId) where.opportunityId = opportunityId;

    // Filter by logger (used by /my and executiveId)
    if (userId) where.userId = userId;

    // Manager/admin: filter by a specific executive who logged the activity
    if (executiveId && user.role !== "sales_user") where.userId = executiveId;

    // Filter by linkedId regardless of type (lead OR opportunity)
    if (linkedId && linkedType === "lead") where.leadId = linkedId;
    if (linkedId && linkedType === "opportunity")
      where.opportunityId = linkedId;
    if (linkedId && !linkedType) {
      where.OR = [
        ...(where.OR || []),
        { leadId: linkedId },
        { opportunityId: linkedId },
      ];
    }

    // Activity type filter (normalise follow up variants)
    if (type) {
      const normalised = type.toLowerCase().replace(" ", "_");
      // match both 'follow-up' and 'follow_up' stored values
      if (normalised === "follow_up" || normalised === "follow-up") {
        where.action = { in: ["follow-up", "follow_up"] };
      } else {
        where.action = normalised;
      }
    }

    // Date range on activityDate
    if (dateFrom || dateTo) {
      where.activityDate = {};
      if (dateFrom) where.activityDate.gte = new Date(dateFrom);
      if (dateTo) {
        const end = new Date(dateTo);
        end.setHours(23, 59, 59, 999);
        where.activityDate.lte = end;
      }
    }

    // Text search across outcome and notes
    if (search && search.trim().length >= 2) {
      const searchConditions = [
        { outcome: { contains: search.trim(), mode: "insensitive" } },
        { notes: { contains: search.trim(), mode: "insensitive" } },
        { description: { contains: search.trim(), mode: "insensitive" } },
      ];
      // Merge with existing OR (role scope) safely
      if (where.OR) {
        where.AND = [{ OR: where.OR }, { OR: searchConditions }];
        delete where.OR;
      } else {
        where.OR = searchConditions;
      }
    }

    // Overdue filter — nextActionDate is in the past
    if (overdue === "true") {
      where.nextActionDate = { lt: new Date() };
    }

    const [activities, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        skip,
        take,
        orderBy: [{ activityDate: "desc" }, { createdAt: "desc" }],
        include: {
          user: { select: { id: true, name: true, email: true } },
          lead: { select: { id: true, companyName: true, contactName: true } },
          opportunity: {
            select: { id: true, title: true, opportunityName: true },
          },
        },
      }),
      prisma.activityLog.count({ where }),
    ]);

    // Annotate each activity with overdue status for the UI
    const now = new Date();
    const activitiesWithStatus = activities.map((a) => {
      let nextActionStatus = null;
      if (a.nextActionDate) {
        const nad = new Date(a.nextActionDate);
        const isToday = nad.toDateString() === now.toDateString();
        if (nad < now && !isToday) nextActionStatus = "overdue";
        else if (isToday) nextActionStatus = "due_today";
        else nextActionStatus = "upcoming";
      }
      return { ...a, nextActionStatus };
    });

    return {
      success: true,
      activities: activitiesWithStatus,
      pagination: {
        total,
        page: parseInt(page),
        limit: take,
        totalPages: Math.ceil(total / take),
      },
    };
  }

  /**
   * GET /api/activities/stats
   * Returns 4 summary counts for the Activities page header strip.
   * Scoped the same way as getActivities:
   *   - sales_user → own records only
   *   - manager    → own + direct reports
   *   - admin      → whole org
   */
  async getActivityStats(user) {
    const now = new Date();

    // Start of today
    const todayStart = new Date(now);
    todayStart.setHours(0, 0, 0, 0);

    // Start of this week (Monday)
    const weekStart = new Date(now);
    weekStart.setDate(
      now.getDate() - now.getDay() + (now.getDay() === 0 ? -6 : 1),
    );
    weekStart.setHours(0, 0, 0, 0);

    // Build role-scoped base where
    const baseWhere = { organizationId: user.organizationId };

    if (user.role === "sales_user") {
      const [ownLeadIds, ownOppIds] = await Promise.all([
        prisma.lead
          .findMany({
            where: {
              organizationId: user.organizationId,
              assignedToId: user.id,
            },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
        prisma.opportunity
          .findMany({
            where: {
              organizationId: user.organizationId,
              assignedToId: user.id,
            },
            select: { id: true },
          })
          .then((rows) => rows.map((r) => r.id)),
      ]);
      baseWhere.OR = [
        { leadId: { in: ownLeadIds } },
        { opportunityId: { in: ownOppIds } },
        { userId: user.id },
      ];
    } else if (user.role === "manager") {
      const teamMemberIds = (
        await prisma.user.findMany({
          where: { managerId: user.id, organizationId: user.organizationId },
          select: { id: true },
        })
      ).map((m) => m.id);
      baseWhere.userId = { in: [...teamMemberIds, user.id] };
    }

    const [todayCount, weekCount, followUpsToday, overdueCount] =
      await Promise.all([
        // Activities logged today
        prisma.activityLog.count({
          where: { ...baseWhere, activityDate: { gte: todayStart } },
        }),

        // Activities logged this week
        prisma.activityLog.count({
          where: { ...baseWhere, activityDate: { gte: weekStart } },
        }),

        // Follow-ups due today (nextActionDate = today)
        prisma.activityLog.count({
          where: {
            ...baseWhere,
            nextActionDate: {
              gte: todayStart,
              lt: new Date(todayStart.getTime() + 86400000),
            },
          },
        }),

        // Overdue follow-ups (nextActionDate < today start)
        prisma.activityLog.count({
          where: { ...baseWhere, nextActionDate: { lt: todayStart } },
        }),
      ]);

    return {
      success: true,
      stats: {
        todayCount,
        weekCount,
        followUpsToday,
        overdueCount,
        // Admin/CEO: total activities since go-live
        ...(ADMIN_ROLES.includes(user.role) && {
          totalAllTime: await prisma.activityLog.count({
            where: { organizationId: user.organizationId },
          }),
        }),
        // Manager: leads with no activity logged in last 7 days
        ...(user.role === "manager" &&
          (await (async () => {
            const sevenDaysAgo = new Date(now);
            sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
            // Get teamMemberIds for context (already built in baseWhere.userId)
            const teamMemberIds = (
              await prisma.user.findMany({
                where: {
                  managerId: user.id,
                  organizationId: user.organizationId,
                },
                select: { id: true },
              })
            ).map((m) => m.id);
            const teamIds = [...teamMemberIds, user.id];
            const activeLeadIds = (
              await prisma.activityLog.findMany({
                where: {
                  organizationId: user.organizationId,
                  userId: { in: teamIds },
                  activityDate: { gte: sevenDaysAgo },
                },
                select: { leadId: true },
                distinct: ["leadId"],
              })
            )
              .map((a) => a.leadId)
              .filter(Boolean);
            const noActivity7d = await prisma.lead.count({
              where: {
                organizationId: user.organizationId,
                assignedToId: { in: teamIds },
                id: {
                  notIn: activeLeadIds.length ? activeLeadIds : ["__none__"],
                },
                status: {
                  notIn: ["closed_won", "closed_lost", "disqualified"],
                },
              },
            });
            return { noActivity7d };
          })())),
      },
    };
  }

  /**
   * Get activities for a specific lead (with ownership check)
   */
  async getLeadActivities(leadId, user) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: user.organizationId },
    });
    if (!lead) return { success: false, message: "Lead not found" };

    if (user.role === "sales_user" && lead.assignedToId !== user.id) {
      return { success: false, message: "Not authorized" };
    }

    return this.getActivities({ leadId }, user);
  }

  // ── Helpers used by leads/opportunity controllers ──────────────────────────

  async logLeadCreated(lead, user) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: "lead_created",
      description: `Lead created: ${lead.companyName}`,
      metadata: { leadId: lead.id },
    });
  }

  async logLeadUpdated(lead, user, changedFields) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: "lead_updated",
      description: `Lead updated: ${Array.isArray(changedFields) ? changedFields.join(", ") : Object.keys(changedFields).join(", ")}`,
      metadata: { changedFields },
    });
  }

  async logLeadStatusChanged(lead, user, oldStatus, newStatus) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: "status_changed",
      description: `Status changed from ${oldStatus} to ${newStatus}`,
      metadata: { oldStatus, newStatus },
    });
  }

  async logLeadAssigned(lead, user, assignedToId) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: "lead_assigned",
      description: `Lead assigned to user ${assignedToId}`,
      metadata: { assignedToId },
    });
  }

  async logLeadDeleted(leadId, user, leadData) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId,
      action: "lead_deleted",
      description: `Lead deleted: ${leadData.companyName}`,
      metadata: { deletedData: leadData },
    });
  }

  /**
   * Get a single activity by ID (with org + role scope check)
   */
  async getActivityById(id, user) {
    const activity = await prisma.activityLog.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, companyName: true, contactName: true } },
        opportunity: {
          select: { id: true, title: true, opportunityName: true },
        },
      },
    });
    if (!activity)
      return { success: false, statusCode: 404, message: "Activity not found" };

    // sales_user can only see their own activities or on their own records
    if (user.role === "sales_user" && activity.userId !== user.id) {
      return {
        success: false,
        statusCode: 403,
        message: "You do not have access to this activity",
      };
    }
    return { success: true, activity };
  }

  /**
   * Delete an activity. Admin/CEO only. Audit-logged.
   */
  async deleteActivity(id, user) {
    if (!ADMIN_ROLES.includes(user.role)) {
      return {
        success: false,
        statusCode: 403,
        message: "Only admins can delete activities",
      };
    }

    const activity = await prisma.activityLog.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { user: { select: { id: true, name: true } } },
    });
    if (!activity)
      return { success: false, statusCode: 404, message: "Activity not found" };

    await prisma.activityLog.delete({ where: { id } });

    try {
      await logAudit(prisma, {
        organizationId: user.organizationId,
        entityType: "ActivityLog",
        entityId: id,
        action: "delete",
        changedById: user.id,
        fieldName: "activity",
        oldValue: JSON.stringify({
          action: activity.action,
          outcome: activity.outcome,
          loggedBy: activity.user?.name,
          activityDate: activity.activityDate,
        }),
        newValue: null,
      });
    } catch (_e) {
      // non-fatal
    }

    dashboardEvents.notifyOrg(user.organizationId, "activity");
    return { success: true };
  }

  /**
   * Coaching alerts: overdue follow-ups across team, grouped by executive.
   * Returns activities where nextActionDate < today, not yet re-actioned.
   * Manager → own team only. Admin → whole org.
   */
  async getCoachingAlerts(user) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const where = {
      organizationId: user.organizationId,
      nextActionDate: { lt: today },
    };

    if (user.role === "manager") {
      const teamMemberIds = (
        await prisma.user.findMany({
          where: { managerId: user.id, organizationId: user.organizationId },
          select: { id: true },
        })
      ).map((m) => m.id);
      where.userId = { in: [...teamMemberIds, user.id] };
    } else if (!ADMIN_ROLES.includes(user.role)) {
      return {
        success: false,
        statusCode: 403,
        message: "Insufficient permissions",
      };
    }

    const alerts = await prisma.activityLog.findMany({
      where,
      orderBy: { nextActionDate: "asc" },
      take: 100,
      include: {
        user: { select: { id: true, name: true, email: true } },
        lead: { select: { id: true, companyName: true, contactName: true } },
        opportunity: {
          select: { id: true, title: true, opportunityName: true },
        },
      },
    });

    const now = new Date();
    const result = alerts.map((a) => {
      const daysOverdue = Math.floor(
        (now - new Date(a.nextActionDate)) / 86400000,
      );
      return { ...a, daysOverdue };
    });

    return { success: true, alerts: result };
  }
}

module.exports = new ActivityService();

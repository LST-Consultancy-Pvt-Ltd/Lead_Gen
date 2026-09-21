/**
 * leads.service.js
 * Business logic layer for Lead operations
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');
const { buildOrganizationFilter } = require('../middleware/rbac');
const { sendLeadAssignmentEmail } = require('./emailService');
const { logAudit } = require('../utils/auditLogger');
const { createBulkNotifications } = require('../utils/notificationService');
const dashboardEvents = require('../utils/dashboardEvents');
const { checkLeadQuota, incrementLeadUsage, decrementLeadUsage } = require('../utils/leadQuota');

// Statuses that require a follow-up date
const FOLLOW_UP_REQUIRED_STATUSES = ['new', 'contacted', 'replied'];

class LeadsService {
  /**
   * Compute follow-up urgency based on the followUpDate.
   * Returns { followUpUrgency, followUpLabel } for UI rendering.
   */
  computeFollowUpUrgency(followUpDate) {
    if (!followUpDate) return { followUpUrgency: 'none', followUpLabel: null };

    const now = new Date();
    const fDate = new Date(followUpDate);

    // Strip time for day-level comparison
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    if (fDate < todayStart) {
      return { followUpUrgency: 'overdue', followUpLabel: 'Overdue' };
    }
    if (fDate < todayEnd) {
      return { followUpUrgency: 'today', followUpLabel: 'Today' };
    }
    return { followUpUrgency: 'future', followUpLabel: 'Planned' };
  }

  /**
   * Build per-lead permissions for UI action rendering.
   */
  buildLeadPermissions(lead, user) {
    const canEdit = user.role === 'sales_user'
      ? lead.assignedToId === user.id
      : ['manager', 'org_admin', 'super_admin'].includes(user.role);

    return {
      canView: true,
      canEdit,
      canDelete: ['org_admin', 'super_admin'].includes(user.role),
      canReassign: ['manager', 'org_admin', 'super_admin'].includes(user.role),
    };
  }

  /**
   * Check if user has access to a specific lead based on their role
   */
  async checkLeadAccess(leadId, user) {
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId: user.organizationId,
      },
    });

    if (!lead) {
      return { hasAccess: false, lead: null, reason: 'Lead not found' };
    }

    // sales_user can only access their assigned leads
    if (user.role === 'sales_user' && lead.assignedToId !== user.id) {
      return { hasAccess: false, lead: null, reason: 'Not authorized to access this lead' };
    }

    return { hasAccess: true, lead };
  }

  /**
   * Build query filters based on user role and query params.
   * Uses buildOrganizationFilter for role-scoped data visibility.
   */
  async buildLeadFilters(user, queryParams) {
    const { status, intent, search, assignedTo, assignedToMe, unassigned, scanJobId } = queryParams;

    const baseFilter = await buildOrganizationFilter(user);
    const where = Object.assign({}, baseFilter);

    // Status filter
    if (status) where.status = status;

    // Intent level filter
    if (intent) where.intentLevel = intent;

    // Restrict to leads produced by a specific scan (Scan History → expand)
    if (scanJobId) where.scanJobId = scanJobId;

    // Assigned-to-me filter (sales users or explicit filter)
    if (assignedToMe === 'true' || assignedToMe === true) {
      where.assignedToId = user.id;
    // Unassigned filter (managers/admins only)
    } else if ((unassigned === 'true' || unassigned === true) && ['manager', 'org_admin', 'super_admin'].includes(user.role)) {
      where.assignedToId = null;
    // Assigned to specific user (managers/admins only)
    } else if (assignedTo && ['manager', 'org_admin', 'super_admin'].includes(user.role)) {
      where.assignedToId = assignedTo;
    }

    // Follow-up urgency filter
    const { followUp } = queryParams;
    if (followUp) {
      const now = new Date();
      const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);

      if (followUp === 'overdue') {
        where.followUpDate = { lt: todayStart };
      } else if (followUp === 'today') {
        where.followUpDate = { gte: todayStart, lt: todayEnd };
      } else if (followUp === 'future') {
        where.followUpDate = { gte: todayEnd };
      } else if (followUp === 'none') {
        where.followUpDate = null;
      }
    }

    // Search across multiple fields
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { contactName: { contains: search, mode: 'insensitive' } },
        { contactEmail: { contains: search, mode: 'insensitive' } },
        { industry: { contains: search, mode: 'insensitive' } },
        { website: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  /**
   * Get paginated leads with filters
   */
  async getLeads(user, queryParams) {
    const { page = 1, limit = 20, sortBy = 'createdAt', sortDir = 'desc' } = queryParams;
    
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = await this.buildLeadFilters(user, queryParams);

    const orderBy = sortBy === 'assignedTo'
      ? { assignedTo: { name: sortDir } }
      : sortBy === 'createdBy'
      ? { createdBy: { name: sortDir } }
      : { [sortBy]: sortDir };

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take,
        orderBy,
        include: {
          assignedTo: {
            select: { id: true, name: true, email: true },
          },
          createdBy: {
            select: { id: true, name: true },
          },
        },
      }),
      prisma.lead.count({ where }),
    ]);

    const leadsWithPermissions = leads.map((lead) => {
      const permissions = this.buildLeadPermissions(lead, user);
      const { followUpUrgency, followUpLabel } = this.computeFollowUpUrgency(lead.followUpDate);
      return {
        ...lead,
        followUpUrgency,
        followUpLabel,
        permissions,
        canEdit: permissions.canEdit,
      };
    });

    return {
      leads: leadsWithPermissions,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  /**
   * Get single lead by ID with access control
   */
  async getLeadById(leadId, user) {
    const accessCheck = await this.checkLeadAccess(leadId, user);
    
    if (!accessCheck.hasAccess) {
      return { success: false, message: accessCheck.reason };
    }

    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        createdBy: {
          select: { id: true, name: true },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 50,
          include: {
            user: {
              select: { id: true, name: true },
            },
          },
        },
        emails: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
      },
    });

    const permissions = this.buildLeadPermissions(lead, user);
    const { followUpUrgency, followUpLabel } = this.computeFollowUpUrgency(lead.followUpDate);
    const leadWithPermissions = {
      ...lead,
      followUpUrgency,
      followUpLabel,
      permissions,
      canEdit: permissions.canEdit,
    };

    return { success: true, lead: leadWithPermissions };
  }

  /**
   * Create a new lead with spec validations and soft duplicate detection
   */
  async createLead(data, user) {
    // ── Lead Quota Check ───────────────────────────────────────────────────────
    const quota = await checkLeadQuota(user.organizationId);
    if (!quota.allowed) {
      return {
        success: false,
        message: `Lead limit reached (${quota.quota}). You have used all your available leads. Please upgrade your plan to add more.`,
        statusCode: 403,
      };
    }

    // ── Validation: followUpDate ──────────────────────────────────────────────
    // Follow-up date is now optional, but if provided, it cannot be in the past
    if (data.followUpDate) {
      const fud = new Date(data.followUpDate);
      const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
      if (isNaN(fud.getTime()) || fud < todayStart) {
        return { success: false, message: 'Follow-up date cannot be in the past', statusCode: 400 };
      }
    }

    // ── Validation: disqualificationReason required when status = disqualified ─
    if (data.status === 'disqualified' && !data.disqualificationReason?.trim()) {
      return { success: false, message: 'Disqualification reason is required when disqualifying a lead', statusCode: 400 };
    }

    // ── Validation: requirementDescription max 2000 chars ───────────────────
    if (data.requirementDescription && data.requirementDescription.length > 2000) {
      return { success: false, message: 'Requirement description must be 2000 characters or less', statusCode: 400 };
    }

    // ── Real-time duplicate detection (soft — returns possibleDuplicate) ─────
    let possibleDuplicate = null;
    try {
      // Check exact email / phone match first
      const exactMatch = await prisma.lead.findFirst({
        where: {
          organizationId: user.organizationId,
          OR: [
            ...(data.contactEmail ? [{ contactEmail: { equals: data.contactEmail, mode: 'insensitive' } }] : []),
            ...(data.contactPhone ? [{ contactPhone: data.contactPhone }] : []),
          ].filter(Boolean),
        },
        select: { id: true, companyName: true },
      });
      if (exactMatch) {
        possibleDuplicate = { id: exactMatch.id, companyName: exactMatch.companyName };
      }

      // Fuzzy company name match via ILIKE (no pg_trgm extension required)
      if (!possibleDuplicate && data.companyName) {
        const similar = await prisma.lead.findFirst({
          where: {
            organizationId: user.organizationId,
            companyName: { contains: data.companyName, mode: 'insensitive' },
          },
          select: { id: true, companyName: true },
        });
        if (similar) {
          possibleDuplicate = { id: similar.id, companyName: similar.companyName };
        }
      }
    } catch (_err) {
      // Duplicate detection is non-fatal — continue with create
    }

    // If duplicate found and caller hasn't confirmed, stop here (no lead created)
    if (possibleDuplicate && !data.ignoreDuplicate) {
      return { success: false, statusCode: 409, message: 'Similar lead already exists', possibleDuplicate };
    }

    // Enforce ownership rules based on role
    // sales_user always owns their own leads; other roles only assign if explicitly chosen
    let assignedToId = data.assignedToId || null;

    if (user.role === 'sales_user') {
      assignedToId = user.id;
    } else if (user.role === 'manager' && data.assignedToId) {
      const isTeamMember = await prisma.user.findFirst({
        where: { id: data.assignedToId, managerId: user.id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!isTeamMember) assignedToId = null;
    }

    // ── Normalise requirementType — always store as JSON array ──────────────
    let requirementType = data.requirementType || [];
    if (!Array.isArray(requirementType)) {
      if (typeof requirementType === 'string') {
        try { requirementType = JSON.parse(requirementType); }
        catch { requirementType = [requirementType]; }
      } else {
        requirementType = [];
      }
    }

    // ── Normalise date fields — Prisma requires full Date objects ───────────
    const toDate = (val) => {
      if (!val) return undefined;
      // Handle DD-MM-YYYY format
      const m = String(val).match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (m) return new Date(`${m[3]}-${m[2]}-${m[1]}`);
      return new Date(val);
    };

    const createData = {
      ...data,
      requirementType,
      followUpDate: toDate(data.followUpDate),
      lastContactedDate: toDate(data.lastContactedDate),
      lastContactedAt: toDate(data.lastContactedAt),
      organizationId: user.organizationId,
      createdById: user.id,
      assignedToId,
      status: (data.status || 'new').toLowerCase(),
      temperature: data.temperature ? data.temperature.toLowerCase() : undefined,
      intentLevel: data.intentLevel ? data.intentLevel.toLowerCase() : undefined,
    };

    // Remove undefined values and non-schema fields to avoid Prisma errors
    const PRISMA_LEAD_FIELDS = new Set([
      'companyName','website','linkedinUrl','industry','companySize','location','description',
      'contactName','contactTitle','contactEmail','contactPhone','contactLinkedin','companyPhone',
      'techStack','intentSignals','funding','jobPostings','leadScore','intentScore','intentLevel',
      'status','opportunity','aiSummary','aiPitch','notes','source','sourceUrl','pipeline',
      'followUpDate','leadCost','utmSource','utmMedium','utmCampaign','utmContent','subSource',
      'accountId','importBatchId','lastContactedAt','firstName','lastName','requirementType',
      'requirementDescription','budgetRange','timeline','temperature','disqualificationReason',
      'lastContactedDate','matchScore','leadType','assignedToId','organizationId','createdById',
    ]);
    Object.keys(createData).forEach((k) => {
      if (createData[k] === undefined || !PRISMA_LEAD_FIELDS.has(k)) delete createData[k];
    });

    // Create lead with proper ownership
    const lead = await prisma.lead.create({
      data: createData,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Notify assignee if lead was assigned to someone else
    if (lead.assignedToId && lead.assignedToId !== user.id) {
      try {
        const assignee = await prisma.user.findUnique({
          where: { id: lead.assignedToId },
          select: { name: true, email: true },
        });
        if (assignee) {
          await sendLeadAssignmentEmail({
            assigneeName: assignee.name,
            assigneeEmail: assignee.email,
            assignerName: user.name,
            leadCompanyName: lead.companyName,
            leadContactName: lead.contactName,
            leadSource: lead.source,
            followUpDate: lead.followUpDate,
            dashboardLink: `${process.env.FRONTEND_URL}/dashboard/leads/${lead.id}`,
          });
        }
      } catch (emailErr) {
        logger.warn('Lead assignment email failed (non-fatal)', { error: emailErr.message });
      }
    }

    // ── Increment lead usage counter ──────────────────────────────────────────
    await incrementLeadUsage(user.organizationId);

    dashboardEvents.notifyOrg(user.organizationId, 'lead');
    return { success: true, lead, possibleDuplicate };
  }

  /**
   * Update lead with permission checks
   */
  async updateLead(leadId, data, user) {
    const accessCheck = await this.checkLeadAccess(leadId, user);
    
    if (!accessCheck.hasAccess) {
      return { success: false, message: accessCheck.reason };
    }

    const updateData = { ...data };

    if (data.assignedToId) {
      if (user.role === 'sales_user') {
        delete updateData.assignedToId;
      } else if (user.role === 'manager') {
        const isTeamMember = await prisma.user.findFirst({
          where: { id: data.assignedToId, managerId: user.id, organizationId: user.organizationId },
          select: { id: true },
        });
        if (!isTeamMember) delete updateData.assignedToId;
      }
    }

    // ── Spec validations ──────────────────────────────────────────────────────
    // Follow-up date is now optional, but if provided and changed, it cannot be in the past
    if (data.followUpDate) {
      const existingFud = accessCheck.lead.followUpDate
        ? new Date(accessCheck.lead.followUpDate).toISOString()
        : null;
      const incomingFud = new Date(data.followUpDate).toISOString();
      const isNewValue = existingFud !== incomingFud;

      if (isNewValue) {
        const fud = new Date(data.followUpDate);
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        if (isNaN(fud.getTime()) || fud < todayStart) {
          return { success: false, message: 'Follow-up date cannot be in the past', statusCode: 400 };
        }
      }
    }
    if (data.status === 'disqualified' && !data.disqualificationReason?.trim()) {
      return { success: false, message: 'Disqualification reason is required when disqualifying a lead', statusCode: 400 };
    }
    if (data.requirementDescription && data.requirementDescription.length > 2000) {
      return { success: false, message: 'Requirement description must be 2000 characters or less', statusCode: 400 };
    }

    // Prevent changing organizationId
    delete updateData.organizationId;
    delete updateData.createdById;
    delete updateData.id;

    // ── Normalise date fields ─────────────────────────────────────────────────
    const toDate = (val) => (val ? new Date(val) : null);
    if ('followUpDate' in updateData) updateData.followUpDate = toDate(updateData.followUpDate);
    if ('lastContactedDate' in updateData) updateData.lastContactedDate = toDate(updateData.lastContactedDate);
    if ('lastContactedAt' in updateData) updateData.lastContactedAt = toDate(updateData.lastContactedAt);

    const previousLead = await prisma.lead.findUnique({
      where: { id: leadId },
      select: { assignedToId: true, companyName: true, status: true, followUpDate: true, temperature: true },
    });

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // ── Audit log: record each changed field ─────────────────────────────────
    const auditableFields = Object.keys(updateData).filter(
      (k) => JSON.stringify(previousLead[k]) !== JSON.stringify(updateData[k])
    );
    for (const fieldName of auditableFields) {
      await logAudit(prisma, {
        organizationId: user.organizationId,
        entityType: 'Lead',
        entityId: leadId,
        action: 'update',
        changedById: user.id,
        fieldName,
        oldValue: previousLead[fieldName] != null ? String(previousLead[fieldName]) : null,
        newValue: updateData[fieldName] != null ? String(updateData[fieldName]) : null,
      });
    }

    // ── Reassignment: send email + in-app notifications ──────────────────────
    if (updateData.assignedToId && updateData.assignedToId !== previousLead.assignedToId) {
      try {
        const [assignee, oldOwner] = await Promise.all([
          prisma.user.findUnique({ where: { id: updateData.assignedToId }, select: { name: true, email: true } }),
          previousLead.assignedToId
            ? prisma.user.findUnique({ where: { id: previousLead.assignedToId }, select: { name: true, email: true } })
            : null,
        ]);

        // Email notification
        if (assignee) {
          await sendLeadAssignmentEmail({
            assigneeName: assignee.name,
            assigneeEmail: assignee.email,
            assignerName: user.name,
            leadCompanyName: lead.companyName,
            leadContactName: lead.contactName,
            leadSource: lead.source,
            followUpDate: lead.followUpDate,
            dashboardLink: `${process.env.FRONTEND_URL}/dashboard/leads/${lead.id}`,
          });
        }

        // In-app notifications
        const notifs = [];
        if (oldOwner && previousLead.assignedToId) {
          notifs.push({
            userId: previousLead.assignedToId,
            organizationId: user.organizationId,
            type: 'lead_reassigned',
            title: 'Lead Reassigned',
            message: `${user.name} has reassigned ${lead.companyName} to ${assignee?.name || 'another user'}`,
            entityType: 'Lead',
            entityId: leadId,
          });
        }
        if (assignee) {
          notifs.push({
            userId: updateData.assignedToId,
            organizationId: user.organizationId,
            type: 'lead_assigned',
            title: 'New Lead Assigned',
            message: `${user.name} has assigned ${lead.companyName} to you`,
            entityType: 'Lead',
            entityId: leadId,
          });
        }
        if (notifs.length) await createBulkNotifications(prisma, notifs);
      } catch (emailErr) {
        logger.warn('Lead reassignment email/notification failed (non-fatal)', { error: emailErr.message });
      }
    }

    dashboardEvents.notifyOrg(user.organizationId, 'lead');
    return { success: true, lead };
  }

  /**
   * Delete lead (admin only)
   */
  async deleteLead(leadId, user) {
    // Only admins can delete
    if (!['org_admin', 'super_admin'].includes(user.role)) {
      return { success: false, message: 'Only admins can delete leads' };
    }

    const accessCheck = await this.checkLeadAccess(leadId, user);
    
    if (!accessCheck.hasAccess) {
      return { success: false, message: accessCheck.reason };
    }

    // Delete in dependency order inside a transaction to avoid FK constraint errors
    await prisma.$transaction([
      // Activity logs linked to this lead's opportunities
      prisma.activityLog.deleteMany({ where: { opportunity: { leadId } } }),
      // Activity logs linked directly to this lead
      prisma.activityLog.deleteMany({ where: { leadId } }),
      // Opportunities linked to this lead
      prisma.opportunity.deleteMany({ where: { leadId } }),
      // Campaign-lead join table entries
      prisma.campaignLead.deleteMany({ where: { leadId } }),
      // Finally the lead itself
      prisma.lead.delete({ where: { id: leadId } }),
    ]);

    // ── Decrement lead usage counter ─────────────────────────────────────────
    await decrementLeadUsage(user.organizationId);

    dashboardEvents.notifyOrg(user.organizationId, 'lead');
    return { success: true, message: 'Lead deleted successfully' };
  }

  /**
   * Bulk-assign multiple leads to a sales executive.
   * Manager can only assign leads within their org; admin can assign any org lead.
   * Returns a summary of assigned and failed lead IDs.
   */
  async bulkAssignLeads(leadIds, assignedToId, user) {
    if (!Array.isArray(leadIds) || leadIds.length === 0) {
      return { success: false, message: 'leadIds must be a non-empty array', statusCode: 400 };
    }

    // Verify target user belongs to the same org and is active
    const target = await prisma.user.findFirst({
      where: { id: assignedToId, organizationId: user.organizationId, isActive: true },
      select: { id: true, name: true, email: true },
    });
    if (!target) {
      return { success: false, message: 'Target user not found or inactive', statusCode: 404 };
    }

    // For manager: target must be a direct report
    if (user.role === 'manager') {
      const isDirectReport = await prisma.user.findFirst({
        where: { id: assignedToId, managerId: user.id, organizationId: user.organizationId },
        select: { id: true },
      });
      if (!isDirectReport) {
        return { success: false, message: 'You can only assign leads to your direct reports', statusCode: 403 };
      }
    }

    // Fetch all requested leads scoped to this org
    const leads = await prisma.lead.findMany({
      where: { id: { in: leadIds }, organizationId: user.organizationId },
      select: { id: true, companyName: true, assignedToId: true },
    });

    const foundIds = new Set(leads.map((l) => l.id));
    const notFoundIds = leadIds.filter((id) => !foundIds.has(id));

    if (leads.length === 0) {
      return { success: false, message: 'No valid leads found for the given IDs', statusCode: 404 };
    }

    // Bulk update
    await prisma.lead.updateMany({
      where: { id: { in: leads.map((l) => l.id) } },
      data: { assignedToId },
    });

    // Audit log + notifications per lead
    const auditAndNotifPromises = leads.map(async (lead) => {
      if (lead.assignedToId === assignedToId) return; // unchanged — skip

      await logAudit(prisma, {
        organizationId: user.organizationId,
        entityType: 'Lead',
        entityId: lead.id,
        action: 'reassign',
        changedById: user.id,
        fieldName: 'assignedToId',
        oldValue: lead.assignedToId,
        newValue: assignedToId,
      });

      const notifs = [];
      if (lead.assignedToId && lead.assignedToId !== assignedToId) {
        notifs.push({
          userId: lead.assignedToId,
          organizationId: user.organizationId,
          type: 'lead_reassigned',
          title: 'Lead Reassigned',
          message: `${user.name} has reassigned ${lead.companyName} to ${target.name}`,
          entityType: 'Lead',
          entityId: lead.id,
        });
      }
      notifs.push({
        userId: assignedToId,
        organizationId: user.organizationId,
        type: 'lead_assigned',
        title: 'New Lead Assigned',
        message: `${user.name} has assigned ${lead.companyName} to you`,
        entityType: 'Lead',
        entityId: lead.id,
      });
      await createBulkNotifications(prisma, notifs);
    });

    await Promise.allSettled(auditAndNotifPromises);

    return {
      success: true,
      assigned: leads.map((l) => l.id),
      notFound: notFoundIds,
      assignedTo: target,
    };
  }

  /**
   * Reassign a lead to a new owner (manager/admin only — enforced at route level).
   */
  async reassignLead(leadId, assignedToId, user) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: user.organizationId },
    });
    if (!lead) return { success: false, message: 'Lead not found', statusCode: 404 };

    // Verify the target user belongs to the same org
    const target = await prisma.user.findFirst({
      where: { id: assignedToId, organizationId: user.organizationId, isActive: true },
    });
    if (!target) return { success: false, message: 'Target user not found or inactive', statusCode: 404 };

    const oldOwnerId = lead.assignedToId;

    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { assignedToId },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    });

    // Audit + notifications for reassign
    await logAudit(prisma, {
      organizationId: user.organizationId,
      entityType: 'Lead',
      entityId: leadId,
      action: 'reassign',
      changedById: user.id,
      fieldName: 'assignedToId',
      oldValue: oldOwnerId,
      newValue: assignedToId,
    });

    const notifs = [];
    if (oldOwnerId && oldOwnerId !== assignedToId) {
      notifs.push({
        userId: oldOwnerId,
        organizationId: user.organizationId,
        type: 'lead_reassigned',
        title: 'Lead Reassigned',
        message: `${user.name} has reassigned ${lead.companyName} to ${target.name}`,
        entityType: 'Lead',
        entityId: leadId,
      });
    }
    notifs.push({
      userId: assignedToId,
      organizationId: user.organizationId,
      type: 'lead_assigned',
      title: 'New Lead Assigned',
      message: `${user.name} has assigned ${lead.companyName} to you`,
      entityType: 'Lead',
      entityId: leadId,
    });
    await createBulkNotifications(prisma, notifs);

    dashboardEvents.notifyOrg(user.organizationId, 'lead');
    return { success: true, lead: updated };
  }

  /**
   * Get leads statistics
   */
  async getLeadStats(user) {
    const where = {
      organizationId: user.organizationId,
    };

    // sales_user can only see their own stats
    if (user.role === 'sales_user') {
      where.assignedToId = user.id;
    }

    const [
      totalLeads,
      newLeads,
      contactedLeads,
      qualifiedLeads,
      hotLeads,
      warmLeads,
    ] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.count({ where: { ...where, status: 'new' } }),
      prisma.lead.count({ where: { ...where, status: 'contacted' } }),
      prisma.lead.count({ where: { ...where, status: 'qualified' } }),
      prisma.lead.count({ where: { ...where, intentLevel: 'hot' } }),
      prisma.lead.count({ where: { ...where, intentLevel: 'warm' } }),
    ]);

    return {
      totalLeads,
      newLeads,
      contactedLeads,
      qualifiedLeads,
      hotLeads,
      warmLeads,
    };
  }
}

const leadsServiceInstance = new LeadsService();
leadsServiceInstance.FOLLOW_UP_REQUIRED_STATUSES = FOLLOW_UP_REQUIRED_STATUSES;
module.exports = leadsServiceInstance;

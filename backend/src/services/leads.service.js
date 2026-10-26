/**
 * leads.service.js
 * Business logic layer for Lead operations
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');
const activityService = require('./activity.service');
const { buildLeadScope, scopeLeadWhere, canAssignLeadTo, canAccessLead, ADMIN_ROLES } = require('../middleware/rbac');
const { toList, ownerWhere, followUpWhere } = require('../utils/leadFilters');

// Display names for a set of user ids (used in the assignment note)
const userNames = async (ids) => {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return {};
  const rows = await prisma.user.findMany({ where: { id: { in: unique } }, select: { id: true, name: true } });
  return Object.fromEntries(rows.map((u) => [u.id, u.name]));
};

// Duplicate detection stays org-wide, but never reveals a lead the caller cannot access
const redactDuplicate = (lead, user) =>
  canAccessLead(user, lead) ? { id: lead.id, companyName: lead.companyName } : { id: null, companyName: null };
const { sendLeadAssignmentEmail } = require('./emailService');
const { logAudit } = require('../utils/auditLogger');
const { createBulkNotifications } = require('../utils/notificationService');
const { getReportingLineIds, roleLabel } = require('../utils/reportingLine');
const dashboardEvents = require('../utils/dashboardEvents');
const { decrementLeadUsage } = require('../utils/leadQuota');
const { syncOpenOpportunityOwner } = require('../utils/opportunityOwner');

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
    // Lead must be inside the caller's role scope (org / created-or-assigned / assigned)
    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(user, { id: leadId }),
    });

    if (!lead) {
      return { hasAccess: false, lead: null, reason: 'Lead not found' };
    }

    return { hasAccess: true, lead };
  }

  /**
   * Build query filters based on user role and query params.
   * Uses buildLeadScope (ANDed with filters/search) for role-scoped visibility.
   */
  async buildLeadFilters(user, queryParams) {
    const { status, intent, search, assignedTo, assignedToMe, unassigned, scanJobId } = queryParams;

    // Filters/search live in their own object and are ANDed with the role scope,
    // so no filter (notably the search OR) can widen or replace the scope.
    const where = {};
    // Filters that need their own OR (owner, follow-up) go here so they can't clash with search
    const and = [];

    // Status filter — one value or a comma-separated list
    const statuses = toList(status);
    if (statuses.length) where.status = { in: statuses };

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
    // Assigned to specific user(s), optionally plus "unassigned" (managers/admins only)
    } else if (assignedTo && ['manager', 'org_admin', 'super_admin'].includes(user.role)) {
      const owner = ownerWhere(toList(assignedTo));
      if (owner) and.push(owner);
    }

    // Follow-up date filter — one bucket or a comma-separated list
    const followUp = followUpWhere(toList(queryParams.followUp), { tzOffset: queryParams.tzOffset });
    if (followUp) and.push(followUp);
    if (and.length) where.AND = and;

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

    return scopeLeadWhere(user, where);
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
    // Lead quota only applies to leads generated by Lead Discovery, so manually
    // created leads are neither checked against it nor counted towards it.

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
        select: { id: true, companyName: true, organizationId: true, assignedToId: true, createdById: true },
      });
      if (exactMatch) {
        possibleDuplicate = redactDuplicate(exactMatch, user);
      }

      // Fuzzy company name match via ILIKE (no pg_trgm extension required)
      if (!possibleDuplicate && data.companyName) {
        const similar = await prisma.lead.findFirst({
          where: {
            organizationId: user.organizationId,
            companyName: { contains: data.companyName, mode: 'insensitive' },
          },
          select: { id: true, companyName: true, organizationId: true, assignedToId: true, createdById: true },
        });
        if (similar) {
          possibleDuplicate = redactDuplicate(similar, user);
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
      // Managers may assign a new lead to themselves or to a member of their own team
      const isSelfOrTeamMember = data.assignedToId === user.id || await prisma.user.findFirst({
        where: { id: data.assignedToId, managerId: user.id, organizationId: user.organizationId, isActive: true },
        select: { id: true },
      });
      if (!isSelfOrTeamMember) assignedToId = null;
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
      'keyword',
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

    // Created for someone else → Activity Timeline entry for the new owner
    if (lead.assignedToId && lead.assignedToId !== user.id) {
      await activityService.logLeadAssigned(lead.id, user, lead.assignedToId);
    }

    // Notify the creator's reporting line that a lead was created, up to and including
    // their own admin:  manager → their admin;  sales executive → their manager + that
    // manager's admin. (The assignee, if any, gets "New Lead Assigned" instead.)
    if (['manager', 'sales_user'].includes(user.role)) {
      try {
        const recipients = await getReportingLineIds(user);
        await createBulkNotifications(
          prisma,
          recipients
            .filter((id) => id !== lead.assignedToId)
            .map((id) => ({
              userId: id,
              organizationId: user.organizationId,
              type: 'lead_created',
              title: 'New Lead Created',
              message: `${user.name} (${roleLabel(user.role)}) created a new lead: ${lead.companyName}`,
              entityType: 'Lead',
              entityId: lead.id,
            })),
          { actorId: user.id },
        );
      } catch (notifyErr) {
        // Never fail lead creation because of a notification problem
        logger.warn('Lead-created notification failed (non-fatal)', { error: notifyErr.message });
      }
    }

    // Notify assignee if lead was assigned to someone else
    if (lead.assignedToId && lead.assignedToId !== user.id) {
      await createBulkNotifications(prisma, [{
        userId: lead.assignedToId,
        organizationId: user.organizationId,
        type: 'lead_assigned',
        title: 'New Lead Assigned',
        message: `${user.name} has assigned ${lead.companyName} to you`,
        entityType: 'Lead',
        entityId: lead.id,
      }], { actorId: user.id });
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

    dashboardEvents.notifyOrg(user.organizationId, 'lead');
    return { success: true, lead, possibleDuplicate };
  }

  /**
   * Update lead with permission checks
   */
  /**
   * After a lead's company is renamed, replace the old name in the places that keep
   * their own text copy of it. Screens that read the lead through a relation
   * (lists, opportunity "Linked Lead", activity lead name) update by themselves.
   *  - this lead's opportunity titles / names (often generated from the company name)
   *  - this lead's Activity Timeline descriptions ("Lead created: …")
   *  - notifications about this lead and its opportunities
   *  - the linked Account, when it carries the same name
   */
  async propagateCompanyRename(leadId, oldName, newName, accountId) {
    // Replace the whole name only — never inside a longer word ("Pro" must not touch "Professional")
    const escaped = oldName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wholeName = new RegExp(`(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`, 'gu');
    const swap = (text) => {
      if (typeof text !== 'string' || !text.includes(oldName)) return null;
      const next = text.replace(wholeName, () => newName);
      return next === text ? null : next;
    };
    try {
      const opps = await prisma.opportunity.findMany({
        where: { leadId },
        select: { id: true, title: true, opportunityName: true },
      });
      const oppIds = opps.map((o) => o.id);
      const writes = [];

      for (const o of opps) {
        const data = {};
        const t = swap(o.title); if (t !== null) data.title = t;
        const n = swap(o.opportunityName); if (n !== null) data.opportunityName = n;
        if (Object.keys(data).length) writes.push(prisma.opportunity.update({ where: { id: o.id }, data }));
      }

      const acts = await prisma.activityLog.findMany({
        where: { OR: [{ leadId }, ...(oppIds.length ? [{ opportunityId: { in: oppIds } }] : [])], description: { contains: oldName } },
        select: { id: true, description: true },
      });
      for (const a of acts) {
        // Keep rename history ("Company name (old → new)") exactly as it was recorded
        if (/Company name \(/.test(a.description)) continue;
        const d = swap(a.description); if (d === null) continue; // old name only inside a longer word
        writes.push(prisma.activityLog.update({ where: { id: a.id }, data: { description: d } }));
      }

      const notifs = await prisma.notification.findMany({
        where: {
          OR: [
            { entityType: 'Lead', entityId: leadId },
            ...(oppIds.length ? [{ entityType: 'Opportunity', entityId: { in: oppIds } }] : []),
          ],
        },
        select: { id: true, title: true, message: true },
      });
      for (const nt of notifs) {
        const data = {};
        const m = swap(nt.message); if (m !== null) data.message = m;
        const t = swap(nt.title); if (t !== null) data.title = t;
        if (Object.keys(data).length) writes.push(prisma.notification.update({ where: { id: nt.id }, data }));
      }

      if (accountId) {
        const account = await prisma.account.findUnique({ where: { id: accountId }, select: { companyName: true } });
        if (account && account.companyName === oldName) {
          writes.push(prisma.account.update({ where: { id: accountId }, data: { companyName: newName } }));
        }
      }

      if (writes.length) await prisma.$transaction(writes);
      logger.info('Lead company renamed', { leadId, oldName, newName, updated: writes.length });
    } catch (err) {
      // The rename itself is saved; a failed propagation is logged, not fatal
      logger.warn('Company rename propagation failed (non-fatal)', { leadId, error: err.message });
    }
  }

  async updateLead(leadId, data, user) {
    const accessCheck = await this.checkLeadAccess(leadId, user);
    
    if (!accessCheck.hasAccess) {
      return { success: false, message: accessCheck.reason };
    }

    const updateData = { ...data };

    if (data.assignedToId) {
      // Same assignment rule as reassign: admin → any active org user,
      // manager → own team only, sales_user → never.
      const target = await prisma.user.findUnique({
        where: { id: data.assignedToId },
        select: { id: true, organizationId: true, managerId: true, isActive: true },
      });
      if (!canAssignLeadTo(user, target)) delete updateData.assignedToId;
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
    if ('companyName' in data) {
      const name = typeof data.companyName === 'string' ? data.companyName.trim() : '';
      if (name.length < 2) {
        return { success: false, message: 'Company name is required (at least 2 characters)', statusCode: 400 };
      }
      updateData.companyName = name;
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
      select: { assignedToId: true, companyName: true, status: true, followUpDate: true, temperature: true, accountId: true },
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

    // ── Company renamed: update every stored copy of the old name ────────────
    if ('companyName' in updateData && previousLead.companyName && previousLead.companyName !== updateData.companyName) {
      await this.propagateCompanyRename(leadId, previousLead.companyName, updateData.companyName, previousLead.accountId);
    }

    // ── Reassignment: open opportunities move with the lead ──────────────────
    if (updateData.assignedToId && updateData.assignedToId !== previousLead.assignedToId) {
      await syncOpenOpportunityOwner([leadId], updateData.assignedToId);
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

        // Activity Timeline entry (the lead's own fields are not touched)
        await activityService.logLeadAssigned(leadId, user, updateData.assignedToId, oldOwner?.name || null);

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
        if (notifs.length) await createBulkNotifications(prisma, notifs, { actorId: user.id });
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

    const oppIds = (await prisma.opportunity.findMany({ where: { leadId }, select: { id: true } })).map((o) => o.id);

    // Delete in dependency order inside a transaction to avoid FK constraint errors
    await prisma.$transaction([
      // Notifications pointing at this lead's opportunities (e.g. Deal Won)
      prisma.notification.deleteMany({ where: { entityType: 'Opportunity', entityId: { in: oppIds } } }),
      // Activity logs linked to this lead's opportunities
      prisma.activityLog.deleteMany({ where: { opportunity: { leadId } } }),
      // Activity logs linked directly to this lead
      prisma.activityLog.deleteMany({ where: { leadId } }),
      // Opportunities linked to this lead
      prisma.opportunity.deleteMany({ where: { leadId } }),
      // Campaign-lead join table entries
      prisma.campaignLead.deleteMany({ where: { leadId } }),
      // Notifications pointing at this lead
      prisma.notification.deleteMany({ where: { entityType: 'Lead', entityId: leadId } }),
      // Finally the lead itself
      prisma.lead.delete({ where: { id: leadId } }),
    ]);

    // ── Decrement lead usage counter (only Lead Discovery leads count) ───────
    if (accessCheck.lead.scanJobId) {
      await decrementLeadUsage(user.organizationId);
    }

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
    if (!['manager', ...ADMIN_ROLES].includes(user.role)) {
      return { success: false, message: 'Insufficient permissions', statusCode: 403 };
    }

    // Verify target user belongs to the same org and is active
    const target = await prisma.user.findFirst({
      where: { id: assignedToId, organizationId: user.organizationId, isActive: true },
      select: { id: true, name: true, email: true, organizationId: true, managerId: true, isActive: true },
    });
    if (!target) {
      return { success: false, message: 'Target user not found or inactive', statusCode: 404 };
    }

    // Manager: target must be in their own team
    if (!canAssignLeadTo(user, target)) {
      return { success: false, message: 'You can only assign leads to users in your own team', statusCode: 403 };
    }

    // Only leads inside the caller's scope can be touched
    const leads = await prisma.lead.findMany({
      where: scopeLeadWhere(user, { id: { in: leadIds } }),
      select: { id: true, companyName: true, assignedToId: true },
    });

    const foundIds = new Set(leads.map((l) => l.id));
    const notFoundIds = leadIds.filter((id) => !foundIds.has(id));

    if (leads.length === 0) {
      return { success: false, message: 'No valid leads found for the given IDs', statusCode: 404 };
    }

    // Only the owner changes; the assignment is recorded on the Activity Timeline below
    await prisma.lead.updateMany({
      where: { id: { in: leads.map((l) => l.id) } },
      data: { assignedToId },
    });
    await syncOpenOpportunityOwner(
      leads.filter((l) => l.assignedToId !== assignedToId).map((l) => l.id),
      assignedToId,
    );
    const names = await userNames(leads.map((l) => l.assignedToId));
    await Promise.all(
      leads
        .filter((l) => l.assignedToId !== assignedToId)
        .map((l) => activityService.logLeadAssigned(l.id, user, assignedToId, l.assignedToId ? names[l.assignedToId] : null)),
    );

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
      await createBulkNotifications(prisma, notifs, { actorId: user.id });
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
    if (!['manager', ...ADMIN_ROLES].includes(user.role)) {
      return { success: false, message: 'Insufficient permissions', statusCode: 403 };
    }

    // Lead must be inside the caller's scope (also enforces organization isolation)
    const lead = await prisma.lead.findFirst({
      where: scopeLeadWhere(user, { id: leadId }),
    });
    if (!lead) return { success: false, message: 'Lead not found', statusCode: 404 };

    // Verify the target user belongs to the same org
    const target = await prisma.user.findFirst({
      where: { id: assignedToId, organizationId: user.organizationId, isActive: true },
    });
    if (!target) return { success: false, message: 'Target user not found or inactive', statusCode: 404 };

    // Manager may only assign within their own team
    if (!canAssignLeadTo(user, target)) {
      return { success: false, message: 'You can only assign leads to users in your own team', statusCode: 403 };
    }

    const oldOwnerId = lead.assignedToId;

    // Only the owner changes — every other field of the lead stays exactly as it is
    const updated = await prisma.lead.update({
      where: { id: leadId },
      data: { assignedToId },
      include: { assignedTo: { select: { id: true, name: true, email: true } } },
    });

    if (oldOwnerId !== assignedToId) await syncOpenOpportunityOwner([leadId], assignedToId);

    if (oldOwnerId !== assignedToId) {
      await activityService.logLeadAssigned(
        leadId, user, assignedToId, oldOwnerId ? (await userNames([oldOwnerId]))[oldOwnerId] : null,
      );
    }

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
    await createBulkNotifications(prisma, notifs, { actorId: user.id });

    dashboardEvents.notifyOrg(user.organizationId, 'lead');
    return { success: true, lead: updated };
  }

  /**
   * Get leads statistics
   */
  async getLeadStats(user) {
    // Same role scope as the leads list (admin: org, manager: created/assigned, rep: assigned)
    const where = buildLeadScope(user);

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

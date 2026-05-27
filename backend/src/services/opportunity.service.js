/**
 * opportunity.service.js
 * Business logic for Opportunity operations with RBAC and stage-progression validation
 */

const prisma = require('../utils/prisma');
const { MANAGER_AND_ABOVE, buildOrganizationFilter } = require('../middleware/rbac');
const { createBulkNotifications } = require('../utils/notificationService');
const { logAudit } = require('../utils/auditLogger');
const dashboardEvents = require('../utils/dashboardEvents');

const STAGE_ORDER = ['prospecting', 'qualification', 'qualified', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];

// Auto-probability map per stage
const STAGE_PROBABILITY = {
  prospecting: 10,
  qualification: 20,
  qualified: 20,
  demo: 40,
  proposal: 60,
  negotiation: 80,
  closed_won: 100,
  closed_lost: 0,
};

class OpportunityService {
  _canAccess(user, opportunity) {
    if (MANAGER_AND_ABOVE.includes(user.role)) return true;
    return opportunity.assignedToId === user.id;
  }

  async _generateOpportunityId() {
    const last = await prisma.opportunity.findFirst({
      where: { opportunityId: { not: null } },
      orderBy: { opportunityId: 'desc' },
      select: { opportunityId: true },
    });
    let nextNum = 1;
    if (last?.opportunityId) {
      const match = last.opportunityId.match(/OPP-(\d+)/);
      if (match) nextNum = parseInt(match[1], 10) + 1;
    }
    return `OPP-${String(nextNum).padStart(5, '0')}`;
  }

  _buildWhere(user) {
    const where = { organizationId: user.organizationId };
    if (user.role === 'sales_user') where.assignedToId = user.id;
    return where;
  }

  async getAll(user, queryParams = {}) {
    const { page = 1, limit = 20, stage, leadId } = queryParams;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = this._buildWhere(user);
    if (stage) where.stage = stage;
    if (leadId) where.leadId = leadId;

    const [opportunities, total] = await Promise.all([
      prisma.opportunity.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          lead: { select: { id: true, companyName: true, contactName: true, contactEmail: true, contactPhone: true } },
          assignedTo: { select: { id: true, name: true, email: true } },
          createdBy: { select: { id: true, name: true } },
          salesOwner: { select: { id: true, name: true } },
          contact: { select: { id: true, name: true, email: true, phone: true } },
        },
      }),
      prisma.opportunity.count({ where }),
    ]);

    return {
      opportunities,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    };
  }

  async getById(id, user) {
    const opportunity = await prisma.opportunity.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        lead: { select: { id: true, companyName: true, contactName: true, contactEmail: true, contactPhone: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        salesOwner: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, email: true, phone: true } },
      },
    });
    if (!opportunity) return { success: false, message: 'Opportunity not found', statusCode: 404 };
    if (!this._canAccess(user, opportunity)) {
      return { success: false, message: 'You do not have access to this opportunity', statusCode: 403 };
    }
    return { success: true, opportunity };
  }

  async create(data, user) {
    // Verify lead belongs to org (leadId is optional)
    let lead = null;
    if (data.leadId) {
      lead = await prisma.lead.findFirst({
        where: { id: data.leadId, organizationId: user.organizationId },
        include: { leadContacts: { take: 1, select: { id: true } } },
      });
      if (!lead) return { success: false, message: 'Lead not found', statusCode: 404 };
    }

    // sales_user can only create opportunities for their own leads
    if (lead && user.role === 'sales_user' && lead.assignedToId !== user.id) {
      return { success: false, message: 'You can only create opportunities for your own leads', statusCode: 403 };
    }
    // Prevent sales_user from assigning to others
    if (user.role === 'sales_user') delete data.assignedToId;

    // Derive title from name/opportunityName if not provided
    const title = data.title || data.name || data.opportunityName || lead?.companyName || 'New Opportunity';

    // Auto-set probability from stage unless explicitly provided
    const stage = data.stage || 'prospecting';
    const probability = data.probability != null ? data.probability : (STAGE_PROBABILITY[stage] ?? 10);

    // Auto-populate contactId from lead's first linked contact if not provided
    const contactId = data.contactId || lead?.leadContacts?.[0]?.id || undefined;

    // Normalise date-only strings to full ISO DateTime (Prisma requires it)
    const toDateTime = (val) => val ? new Date(val) : undefined;

    // Generate formatted opportunity ID
    const opportunityId = await this._generateOpportunityId();

    const opportunity = await prisma.opportunity.create({
      data: {
        ...data,
        opportunityId,
        expectedCloseDate: toDateTime(data.expectedCloseDate),
        title,
        opportunityName: data.opportunityName || title,
        stage,
        probability,
        contactId,
        organizationId: user.organizationId,
        createdById: user.id,
        assignedToId: data.assignedToId || user.id,
      },
      include: {
        lead: { select: { id: true, companyName: true, contactName: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
        createdBy: { select: { id: true, name: true } },
        contact: { select: { id: true, name: true, email: true } },
      },
    });
    dashboardEvents.notifyOrg(user.organizationId, 'opportunity');
    return { success: true, opportunity };
  }

  async update(id, data, user) {
    const existing = await prisma.opportunity.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return { success: false, message: 'Opportunity not found', statusCode: 404 };
    if (!this._canAccess(user, existing)) {
      return { success: false, message: 'You do not have access to this opportunity', statusCode: 403 };
    }

    // No stage progression restrictions — any stage change is allowed

    // Prevent sales_user from reassigning
    const updateData = { ...data };
    if (user.role === 'sales_user') {
      delete updateData.assignedToId;
    }
    delete updateData.organizationId;
    delete updateData.createdById;
    delete updateData.id;

    // Normalise date-only strings to full ISO DateTime (Prisma requires it)
    if (updateData.expectedCloseDate) {
      updateData.expectedCloseDate = new Date(updateData.expectedCloseDate);
    }

    // Auto-update probability when stage changes (unless explicitly provided)
    if (updateData.stage && updateData.probability == null) {
      updateData.probability = STAGE_PROBABILITY[updateData.stage] ?? existing.probability;
    }

    // Track when stage last changed (used for stuck-deal detection)
    if (updateData.stage && updateData.stage !== existing.stage) {
      updateData.stageChangedAt = new Date();
    }

    const opportunity = await prisma.opportunity.update({
      where: { id },
      data: updateData,
      include: {
        lead: { select: { id: true, companyName: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    // ── Audit log: stage change ───────────────────────────────────────────────
    if (updateData.stage && updateData.stage !== existing.stage) {
      await logAudit(prisma, {
        organizationId: user.organizationId,
        entityType: 'Opportunity',
        entityId: id,
        action: 'update',
        changedById: user.id,
        fieldName: 'stage',
        oldValue: existing.stage,
        newValue: updateData.stage,
      });
    }

    // ── Audit log: reassignment ───────────────────────────────────────────────
    if (updateData.assignedToId && updateData.assignedToId !== existing.assignedToId) {
      await logAudit(prisma, {
        organizationId: user.organizationId,
        entityType: 'Opportunity',
        entityId: id,
        action: 'update',
        changedById: user.id,
        fieldName: 'assignedToId',
        oldValue: existing.assignedToId,
        newValue: updateData.assignedToId,
      });
    }

    // Notify managers and admins when a deal is won
    if (data.stage === 'closed_won' && existing.stage !== 'closed_won') {
      try {
        const managersAndAdmins = await prisma.user.findMany({
          where: {
            organizationId: user.organizationId,
            role: { in: ['manager', 'org_admin'] },
            isActive: true,
          },
          select: { id: true },
        });
        const ownerName = opportunity.assignedTo?.name || user.name;
        const dealValue = opportunity.dealValue || 0;
        const notifs = managersAndAdmins.map((m) => ({
          userId: m.id,
          organizationId: user.organizationId,
          type: 'deal_won',
          title: 'Deal Won',
          message: `${opportunity.opportunityName || opportunity.title} - $${dealValue.toLocaleString()} closed by ${ownerName}`,
          entityType: 'Opportunity',
          entityId: id,
        }));
        await createBulkNotifications(prisma, notifs);
      } catch (_err) {
        // non-fatal
      }
    }

    dashboardEvents.notifyOrg(user.organizationId, 'opportunity');
    return { success: true, opportunity };
  }

  async delete(id, user) {
    const existing = await prisma.opportunity.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!existing) return { success: false, message: 'Opportunity not found', statusCode: 404 };

    await prisma.opportunity.delete({ where: { id } });
    dashboardEvents.notifyOrg(user.organizationId, 'opportunity');
    return { success: true };
  }

  /**
   * Convert a qualified lead into an opportunity.
   * Only leads with status = 'qualified' can be converted.
   */
  async convertLeadToOpportunity(leadId, user) {
    const lead = await prisma.lead.findFirst({
      where: { id: leadId, organizationId: user.organizationId },
    });
    if (!lead) return { success: false, message: 'Lead not found', statusCode: 404 };

    // sales_user can only convert their own leads
    if (user.role === 'sales_user' && lead.assignedToId !== user.id) {
      return { success: false, message: 'You do not have permission to convert this lead', statusCode: 403 };
    }

    if (lead.status !== 'qualified') {
      return { success: false, message: 'Only qualified leads can be converted to opportunities', statusCode: 400 };
    }

    const requirementType = Array.isArray(lead.requirementType) ? lead.requirementType : [];
    const businessLine = requirementType[0] || null;
    const opportunityName = requirementType.length
      ? `${lead.companyName} - ${requirementType.join(', ')}`
      : lead.companyName;

    const opportunityId = await this._generateOpportunityId();

    const opportunity = await prisma.opportunity.create({
      data: {
        opportunityId,
        organizationId: user.organizationId,
        leadId: lead.id,
        title: opportunityName,
        opportunityName,
        businessLine,
        stage: 'qualification',
        probability: STAGE_PROBABILITY['qualification'],
        salesOwnerId: lead.assignedToId || user.id,
        assignedToId: lead.assignedToId || user.id,
        createdById: user.id,
      },
      include: {
        lead: { select: { id: true, companyName: true } },
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    // Mark lead as meeting_booked to indicate conversion
    await prisma.lead.update({
      where: { id: leadId },
      data: { status: 'meeting_booked' },
    });

    dashboardEvents.notifyOrg(user.organizationId, 'opportunity');
    return { success: true, opportunity };
  }
}

module.exports = new OpportunityService();

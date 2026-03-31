/**
 * leads.service.js
 * Business logic layer for Lead operations
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

class LeadsService {
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
   * Build query filters based on user role and query params
   */
  buildLeadFilters(user, queryParams) {
    const { status, intent, search, assignedTo } = queryParams;
    
    const where = {
      organizationId: user.organizationId,
    };

    // Role-based filtering: sales_user can only see assigned leads
    if (user.role === 'sales_user') {
      where.assignedToId = user.id;
    }

    // Status filter
    if (status) {
      where.status = status;
    }

    // Intent level filter
    if (intent) {
      where.intentLevel = intent;
    }

    // Assigned to filter (only for managers/admins)
    if (assignedTo && ['manager', 'org_admin', 'super_admin'].includes(user.role)) {
      where.assignedToId = assignedTo;
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

    const where = this.buildLeadFilters(user, queryParams);

    const [leads, total] = await Promise.all([
      prisma.lead.findMany({
        where,
        skip,
        take,
        orderBy: { [sortBy]: sortDir },
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

    return {
      leads,
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

    return { success: true, lead };
  }

  /**
   * Create a new lead with duplicate detection
   */
  async createLead(data, user) {
    // Check for duplicates based on companyName + contactEmail
    if (data.companyName && data.contactEmail) {
      const existing = await prisma.lead.findFirst({
        where: {
          organizationId: user.organizationId,
          companyName: {
            equals: data.companyName,
            mode: 'insensitive',
          },
          contactEmail: {
            equals: data.contactEmail,
            mode: 'insensitive',
          },
        },
      });

      if (existing) {
        return {
          success: false,
          message: 'Duplicate lead: A lead with this company name and email already exists',
          duplicateId: existing.id,
        };
      }
    }

    // Create lead with proper ownership
    const lead = await prisma.lead.create({
      data: {
        ...data,
        organizationId: user.organizationId,
        createdById: user.id,
        assignedToId: data.assignedToId || user.id, // Default to creator if not specified
        status: data.status || 'new',
      },
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return { success: true, lead };
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

    // Only managers and admins can reassign leads
    if (data.assignedToId && user.role === 'sales_user') {
      delete updateData.assignedToId;
    }

    // Prevent changing organizationId
    delete updateData.organizationId;
    delete updateData.createdById;
    delete updateData.id;

    const lead = await prisma.lead.update({
      where: { id: leadId },
      data: updateData,
      include: {
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
      },
    });

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

    await prisma.lead.delete({
      where: { id: leadId },
    });

    return { success: true, message: 'Lead deleted successfully' };
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

module.exports = new LeadsService();

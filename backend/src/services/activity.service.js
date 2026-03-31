/**
 * activity.service.js
 * Service for logging and retrieving activities
 */

const prisma = require('../utils/prisma');
const logger = require('../utils/logger');

class ActivityService {
  /**
   * Log an activity
   */
  async logActivity(data) {
    try {
      const activity = await prisma.activityLog.create({
        data: {
          organizationId: data.organizationId,
          userId: data.userId,
          leadId: data.leadId,
          action: data.action,
          description: data.description,
          metadata: data.metadata || {},
        },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
      });

      return activity;
    } catch (error) {
      logger.error('Failed to log activity', { error: error.message, data });
      // Don't throw - activity logging should not break main operations
      return null;
    }
  }

  /**
   * Get activities for a specific lead
   */
  async getLeadActivities(leadId, user) {
    // Check access to lead
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId: user.organizationId,
      },
    });

    if (!lead) {
      return { success: false, message: 'Lead not found' };
    }

    // sales_user can only access assigned leads
    if (user.role === 'sales_user' && lead.assignedToId !== user.id) {
      return { success: false, message: 'Not authorized' };
    }

    const activities = await prisma.activityLog.findMany({
      where: {
        leadId,
        organizationId: user.organizationId,
      },
      orderBy: { createdAt: 'desc' },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return { success: true, activities };
  }

  /**
   * Create a new activity (call, meeting, note) for a lead
   */
  async createActivity(data, user) {
    const { leadId, action, description, metadata } = data;

    // Verify lead access
    const lead = await prisma.lead.findFirst({
      where: {
        id: leadId,
        organizationId: user.organizationId,
      },
    });

    if (!lead) {
      return { success: false, message: 'Lead not found' };
    }

    // sales_user can only add activities to assigned leads
    if (user.role === 'sales_user' && lead.assignedToId !== user.id) {
      return { success: false, message: 'Not authorized to add activities to this lead' };
    }

    // Create activity directly with user included
    const activity = await prisma.activityLog.create({
      data: {
        organizationId: user.organizationId,
        userId: user.id,
        leadId,
        action,
        description,
        metadata: metadata || {},
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Update lead's lastContactedAt if this is a contact-related activity
    const contactActions = ['call', 'email', 'meeting', 'demo', 'whatsapp'];
    if (contactActions.includes(action)) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { lastContactedAt: new Date() },
      });
    }

    return { success: true, activity };
  }

  /**
   * Activity helpers for common operations
   */
  async logLeadCreated(lead, user) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: 'lead_created',
      description: `Lead created: ${lead.companyName}`,
      metadata: { leadId: lead.id },
    });
  }

  async logLeadUpdated(lead, user, changedFields) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: 'lead_updated',
      description: `Lead updated: ${Object.keys(changedFields).join(', ')}`,
      metadata: { changedFields },
    });
  }

  async logLeadStatusChanged(lead, user, oldStatus, newStatus) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: 'status_changed',
      description: `Status changed from ${oldStatus} to ${newStatus}`,
      metadata: { oldStatus, newStatus },
    });
  }

  async logLeadAssigned(lead, user, assignedToId) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId: lead.id,
      action: 'lead_assigned',
      description: `Lead assigned to user ${assignedToId}`,
      metadata: { assignedToId },
    });
  }

  async logLeadDeleted(leadId, user, leadData) {
    return this.logActivity({
      organizationId: user.organizationId,
      userId: user.id,
      leadId,
      action: 'lead_deleted',
      description: `Lead deleted: ${leadData.companyName}`,
      metadata: { deletedData: leadData },
    });
  }
}

module.exports = new ActivityService();

/**
 * leads.controller.js
 * Production-ready Lead controller with RBAC and activity logging
 */

const leadsService = require('../services/leads.service');
const activityService = require('../services/activity.service');
const { success, error, paginated } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * GET /api/leads
 * Get leads with filters and pagination
 * Access: All roles (filtered by role)
 */
async function getLeads(req, res) {
  try {
    const result = await leadsService.getLeads(req.user, req.query);
    
    return paginated(
      res,
      result.leads,
      result.pagination.total,
      result.pagination.page,
      result.pagination.limit
    );
  } catch (err) {
    logger.error('getLeads error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch leads', 500);
  }
}

/**
 * GET /api/leads/stats
 * Get lead statistics
 * Access: All roles (filtered by role)
 */
async function getLeadStats(req, res) {
  try {
    const stats = await leadsService.getLeadStats(req.user);
    return success(res, stats);
  } catch (err) {
    logger.error('getLeadStats error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch lead statistics', 500);
  }
}

/**
 * GET /api/leads/:id
 * Get single lead by ID
 * Access: Role-based (sales_user: only assigned, others: all org leads)
 */
async function getLeadById(req, res) {
  try {
    const result = await leadsService.getLeadById(req.params.id, req.user);
    
    if (!result.success) {
      return error(res, result.message, 404);
    }

    return success(res, result.lead);
  } catch (err) {
    logger.error('getLeadById error', { error: err.message, leadId: req.params.id });
    return error(res, 'Failed to fetch lead', 500);
  }
}

/**
 * POST /api/leads
 * Create a new lead
 * Access: All authenticated users
 */
async function createLead(req, res) {
  try {
    const result = await leadsService.createLead(req.body, req.user);
    
    if (!result.success) {
      return error(res, result.message, 400, { duplicateId: result.duplicateId });
    }

    // Log activity
    await activityService.logLeadCreated(result.lead, req.user);

    logger.info('Lead created', {
      leadId: result.lead.id,
      companyName: result.lead.companyName,
      userId: req.user.id,
    });

    return success(res, result.lead, 'Lead created successfully', 201);
  } catch (err) {
    logger.error('createLead error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to create lead', 500);
  }
}

/**
 * PUT /api/leads/:id
 * Update a lead
 * Access: Role-based (sales_user: only assigned, others: all org leads)
 * Note: sales_user cannot reassign leads
 */
async function updateLead(req, res) {
  try {
    const leadId = req.params.id;
    
    // Get current lead for comparison
    const currentLead = await leadsService.getLeadById(leadId, req.user);
    if (!currentLead.success) {
      return error(res, currentLead.message, 404);
    }

    const result = await leadsService.updateLead(leadId, req.body, req.user);
    
    if (!result.success) {
      return error(res, result.message, 403);
    }

    // Log status change if status was updated
    if (req.body.status && req.body.status !== currentLead.lead.status) {
      await activityService.logLeadStatusChanged(
        result.lead,
        req.user,
        currentLead.lead.status,
        req.body.status
      );
    }

    // Log assignment change if assignedToId was updated
    if (req.body.assignedToId && req.body.assignedToId !== currentLead.lead.assignedToId) {
      await activityService.logLeadAssigned(result.lead, req.user, req.body.assignedToId);
    }

    // Log general update
    const changedFields = Object.keys(req.body);
    await activityService.logLeadUpdated(result.lead, req.user, changedFields);

    logger.info('Lead updated', {
      leadId: result.lead.id,
      changedFields,
      userId: req.user.id,
    });

    return success(res, result.lead, 'Lead updated successfully');
  } catch (err) {
    logger.error('updateLead error', { error: err.message, leadId: req.params.id });
    return error(res, 'Failed to update lead', 500);
  }
}

/**
 * DELETE /api/leads/:id
 * Delete a lead
 * Access: Admin only
 */
async function deleteLead(req, res) {
  try {
    const leadId = req.params.id;
    
    // Get lead data before deletion for logging
    const leadData = await leadsService.getLeadById(leadId, req.user);
    if (!leadData.success) {
      return error(res, leadData.message, 404);
    }

    const result = await leadsService.deleteLead(leadId, req.user);
    
    if (!result.success) {
      return error(res, result.message, 403);
    }

    // Log deletion
    await activityService.logLeadDeleted(leadId, req.user, leadData.lead);

    logger.info('Lead deleted', {
      leadId,
      companyName: leadData.lead.companyName,
      userId: req.user.id,
    });

    return success(res, null, 'Lead deleted successfully');
  } catch (err) {
    logger.error('deleteLead error', { error: err.message, leadId: req.params.id });
    return error(res, 'Failed to delete lead', 500);
  }
}

/**
 * GET /api/leads/:id/activities
 * Get activities for a specific lead
 * Access: Role-based (sales_user: only assigned, others: all org leads)
 */
async function getLeadActivities(req, res) {
  try {
    const result = await activityService.getLeadActivities(req.params.id, req.user);
    
    if (!result.success) {
      return error(res, result.message, result.message === 'Lead not found' ? 404 : 403);
    }

    return success(res, result.activities);
  } catch (err) {
    logger.error('getLeadActivities error', { error: err.message, leadId: req.params.id });
    return error(res, 'Failed to fetch activities', 500);
  }
}

/**
 * POST /api/leads/:id/activities
 * Create an activity for a lead
 * Access: Role-based (sales_user: only assigned, others: all org leads)
 */
async function createLeadActivity(req, res) {
  try {
    const { action, description, metadata } = req.body;
    
    const result = await activityService.createActivity(
      {
        leadId: req.params.id,
        action,
        description,
        metadata,
      },
      req.user
    );
    
    if (!result.success) {
      return error(res, result.message, result.message === 'Lead not found' ? 404 : 403);
    }

    logger.info('Activity created', {
      leadId: req.params.id,
      action,
      userId: req.user.id,
    });

    return success(res, result.activity, 'Activity created successfully', 201);
  } catch (err) {
    logger.error('createLeadActivity error', { error: err.message, leadId: req.params.id });
    return error(res, 'Failed to create activity', 500);
  }
}

module.exports = {
  getLeads,
  getLeadStats,
  getLeadById,
  createLead,
  updateLead,
  deleteLead,
  getLeadActivities,
  createLeadActivity,
};

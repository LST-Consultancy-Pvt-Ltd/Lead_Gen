/**
 * activityController.js
 * Controller for activity management
 */

const activityService = require('../services/activity.service');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * POST /api/activities
 * Create a new activity for a lead
 * Access: All authenticated users (with RBAC checks in service)
 */
async function createActivity(req, res) {
  try {
    // Accept both 'type' and 'action' field names from frontend
    const { leadId, type, action, outcome, description, metadata } = req.body;
    const activityType = type || action;

    // Validate required fields
    if (!leadId) {
      return error(res, 'Lead ID is required', 400);
    }

    if (!activityType) {
      return error(res, 'Action type is required', 400);
    }

    const result = await activityService.createActivity(
      {
        leadId,
        action: activityType.toLowerCase(),
        description: description || outcome || 'N/A',
        metadata: metadata || {},
      },
      req.user
    );

    if (!result.success) {
      return error(res, result.message, result.message.includes('not found') ? 404 : 403);
    }

    logger.info('Activity created', {
      activityId: result.activity?.id,
      leadId,
      action,
      userId: req.user.id,
    });

    return success(res, result.activity, 'Activity created successfully', 201);
  } catch (err) {
    logger.error('createActivity error', { 
      error: err.message, 
      userId: req.user.id,
      body: req.body 
    });
    return error(res, 'Failed to create activity', 500);
  }
}

/**
 * GET /api/activities/lead/:leadId
 * Get all activities for a specific lead
 * Access: Role-based (sales_user: only assigned leads)
 */
async function getLeadActivities(req, res) {
  try {
    const { leadId } = req.params;

    const result = await activityService.getLeadActivities(leadId, req.user);

    if (!result.success) {
      return error(res, result.message, result.message.includes('not found') ? 404 : 403);
    }

    return success(res, result.activities);
  } catch (err) {
    logger.error('getLeadActivities error', {
      error: err.message,
      leadId: req.params.leadId,
      userId: req.user.id,
    });
    return error(res, 'Failed to fetch activities', 500);
  }
}

module.exports = {
  createActivity,
  getLeadActivities,
};

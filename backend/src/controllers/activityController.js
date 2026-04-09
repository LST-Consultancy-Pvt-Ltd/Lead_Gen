/**
 * activityController.js
 * Controller for Activity management
 *
 * Spec rules enforced:
 * - activity_date cannot be future
 * - outcome required
 * - next_action_date must be future (if provided)
 * - sales_user can only link to owned records
 * - After save: parent lastContactedDate = today, followUpDate = nextActionDate
 */

const activityService = require('../services/activity.service');
const { success, error, paginated } = require('../utils/response');
const logger = require('../utils/logger');

/**
 * GET /api/activities/stats
 * Summary counts for the Activities page header strip.
 * Scoped by role: sales_user → own, manager → team, admin → org.
 */
async function getActivityStats(req, res) {
  try {
    const result = await activityService.getActivityStats(req.user);
    if (!result.success) return error(res, result.message, result.statusCode || 400);
    return success(res, result.stats);
  } catch (err) {
    logger.error('getActivityStats error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch activity stats', 500);
  }
}

/**
 * POST /api/activities
 * Create a new activity linked to a lead or opportunity.
 */
async function createActivity(req, res) {
  try {
    const result = await activityService.createActivity(req.body, req.user);

    if (!result.success) {
      const status = result.statusCode || (result.message.includes('not found') ? 404 : 400);
      return error(res, result.message, status);
    }

    logger.info('Activity created', { activityId: result.activity.id, userId: req.user.id });
    return success(res, result.activity, 'Activity created successfully', 201);
  } catch (err) {
    logger.error('createActivity error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to create activity', 500);
  }
}

/**
 * GET /api/activities
 * List activities. sales_user sees only own; manager/admin see all org.
 * Supports ?leadId=, ?opportunityId=, ?page=, ?limit= query params.
 */
async function getActivities(req, res) {
  try {
    const result = await activityService.getActivities(req.query, req.user);

    if (!result.success) {
      return error(res, result.message, result.statusCode || 400);
    }

    return paginated(res, result.activities, result.pagination.total, result.pagination.page, result.pagination.limit);
  } catch (err) {
    logger.error('getActivities error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch activities', 500);
  }
}

/**
 * GET /api/activities/all
 * Organization-wide activity feed. Manager/admin only (enforced at route level).
 */
async function getAllActivities(req, res) {
  return getActivities(req, res);
}

/**
 * GET /api/activities/my
 * Personal activity log for the authenticated user.
 */
async function getMyActivities(req, res) {
  try {
    const result = await activityService.getActivities(
      { ...req.query, userId: req.user.id },
      req.user
    );

    if (!result.success) {
      return error(res, result.message, result.statusCode || 400);
    }

    return paginated(res, result.activities, result.pagination.total, result.pagination.page, result.pagination.limit);
  } catch (err) {
    logger.error('getMyActivities error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch activities', 500);
  }
}

/**
 * GET /api/activities/lead/:leadId
 * Get activities for a specific lead.
 */
async function getLeadActivities(req, res) {
  try {
    const result = await activityService.getActivities(
      { leadId: req.params.leadId },
      req.user
    );

    if (!result.success) {
      return error(res, result.message, result.statusCode || 403);
    }

    return success(res, result.activities);
  } catch (err) {
    logger.error('getLeadActivities error', { error: err.message, leadId: req.params.leadId });
    return error(res, 'Failed to fetch activities', 500);
  }
}

/**
 * GET /api/activities/coaching-alerts
 * Overdue follow-ups across the team with responsible executive details.
 * Manager/admin only.
 */
async function getCoachingAlerts(req, res) {
  try {
    const result = await activityService.getCoachingAlerts(req.user);
    if (!result.success) return error(res, result.message, result.statusCode || 403);
    return success(res, result.alerts);
  } catch (err) {
    logger.error('getCoachingAlerts error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch coaching alerts', 500);
  }
}

/**
 * GET /api/activities/:id
 * Get a single activity by ID.
 */
async function getActivityById(req, res) {
  try {
    const result = await activityService.getActivityById(req.params.id, req.user);
    if (!result.success) return error(res, result.message, result.statusCode || 404);
    return success(res, result.activity);
  } catch (err) {
    logger.error('getActivityById error', { error: err.message, id: req.params.id });
    return error(res, 'Failed to fetch activity', 500);
  }
} 

/**
 * DELETE /api/activities/:id
 * Delete an activity. Admin/CEO only. Audit-logged.
 */
async function deleteActivity(req, res) {
  try {
    const result = await activityService.deleteActivity(req.params.id, req.user);
    if (!result.success) return error(res, result.message, result.statusCode || 403);
    return success(res, null, 'Activity deleted');
  } catch (err) {
    logger.error('deleteActivity error', { error: err.message, id: req.params.id });
    return error(res, 'Failed to delete activity', 500);
  }
}

module.exports = {
  getActivityStats,
  createActivity,
  getActivities,
  getAllActivities,
  getMyActivities,
  getLeadActivities,
  getCoachingAlerts,
  getActivityById,
  deleteActivity,
};

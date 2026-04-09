/**
 * opportunityController.js
 * CRUD for Opportunities with ownership-based RBAC
 */

const opportunityService = require('../services/opportunity.service');
const { success, error, paginated } = require('../utils/response');
const logger = require('../utils/logger');

async function getOpportunities(req, res) {
  try {
    const result = await opportunityService.getAll(req.user, req.query);
    return paginated(res, result.opportunities, result.pagination.total, result.pagination.page, result.pagination.limit);
  } catch (err) {
    logger.error('getOpportunities error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch opportunities', 500);
  }
}

async function getOpportunity(req, res) {
  try {
    const result = await opportunityService.getById(req.params.id, req.user);
    if (!result.success) return error(res, result.message, result.statusCode);
    return success(res, result.opportunity);
  } catch (err) {
    logger.error('getOpportunity error', { error: err.message, id: req.params.id });
    return error(res, 'Failed to fetch opportunity', 500);
  }
}

async function createOpportunity(req, res) {
  try {
    const result = await opportunityService.create(req.body, req.user);
    if (!result.success) return error(res, result.message, result.statusCode || 400);
    return success(res, result.opportunity, 'Opportunity created', 201);
  } catch (err) {
    logger.error('createOpportunity error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to create opportunity', 500);
  }
}

async function updateOpportunity(req, res) {
  try {
    const result = await opportunityService.update(req.params.id, req.body, req.user);
    if (!result.success) return error(res, result.message, result.statusCode || 400);
    return success(res, result.opportunity, 'Opportunity updated');
  } catch (err) {
    logger.error('updateOpportunity error', { error: err.message, id: req.params.id });
    return error(res, 'Failed to update opportunity', 500);
  }
}

async function deleteOpportunity(req, res) {
  try {
    const result = await opportunityService.delete(req.params.id, req.user);
    if (!result.success) return error(res, result.message, result.statusCode || 400);
    return success(res, null, 'Opportunity deleted');
  } catch (err) {
    logger.error('deleteOpportunity error', { error: err.message, id: req.params.id });
    return error(res, 'Failed to delete opportunity', 500);
  }
}

module.exports = { getOpportunities, getOpportunity, createOpportunity, updateOpportunity, deleteOpportunity };



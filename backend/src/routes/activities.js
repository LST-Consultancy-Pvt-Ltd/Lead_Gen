/**
 * activities.js
 * Routes for activity management
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireManagerOrAdmin, requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const activityController = require('../controllers/activityController');

const VALID_TYPES = ['call', 'email', 'meeting', 'demo', 'follow-up', 'follow_up', 'whatsapp', 'telegram', 'note', 'linkedin', 'sms', 'other'];

// Validation rules
const createActivityValidation = [
  // action/type � at least one required
  body()
    .custom((value, { req }) => {
      const a = req.body.action || req.body.type;
      if (!a) throw new Error('action is required');
      const normalized = a.toLowerCase().replace(' ', '_');
      if (!VALID_TYPES.includes(normalized)) {
        throw new Error(`action must be one of: ${VALID_TYPES.join(', ')}`);
      }
      return true;
    }),

  // outcome is optional
  body('outcome')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Outcome must be 1000 characters or less'),

  // Must link to a lead or opportunity
  body()
    .custom((value, { req }) => {
      const hasLead = !!req.body.leadId || (req.body.linkedType === 'lead' && !!req.body.linkedId);
      const hasOpp  = !!req.body.opportunityId || (req.body.linkedType === 'opportunity' && !!req.body.linkedId);
      if (!hasLead && !hasOpp) {
        throw new Error('Either leadId or opportunityId (or linkedType + linkedId) is required');
      }
      return true;
    }),

  body('linkedType')
    .optional()
    .isIn(['lead', 'opportunity'])
    .withMessage("linkedType must be 'lead' or 'opportunity'"),

  body('leadId').optional().isUUID().withMessage('leadId must be a valid UUID'),
  body('opportunityId').optional().isUUID().withMessage('opportunityId must be a valid UUID'),
  body('linkedId').optional().isUUID().withMessage('linkedId must be a valid UUID'),

  body('activityDate')
    .optional()
    .isISO8601()
    .withMessage('activityDate must be a valid ISO date')
    .custom((val) => {
      if (new Date(val) > new Date()) throw new Error('activityDate cannot be a future date');
      return true;
    }),

  body('nextActionDate')
    .notEmpty()
    .withMessage('Next Action Date is required')
    .isISO8601()
    .withMessage('nextActionDate must be a valid ISO date (YYYY-MM-DD or YYYY-MM-DDTHH:MM:SS)')
    .custom((val) => {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      if (new Date(val) < today) throw new Error('nextActionDate must be today or a future date');
      return true;
    }),

  body('duration')
    .optional()
    .isInt({ min: 1 })
    .withMessage('duration must be a positive integer (minutes)'),

  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be 2000 characters or less'),

  body('notes')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Notes must be 2000 characters or less'),

  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object'),
];

const getLeadActivitiesValidation = [
  param('leadId')
    .isUUID()
    .withMessage('Lead ID must be a valid UUID'),
];

const getActivitiesValidation = [
  query('page').optional().isInt({ min: 1 }).withMessage('page must be a positive integer'),
  query('limit').optional().isInt({ min: 1, max: 1000 }).withMessage('limit must be between 1 and 1000'),
  query('type').optional().isIn(['call', 'email', 'meeting', 'demo', 'follow-up', 'follow_up', 'whatsapp', 'telegram', 'note', 'linkedin', 'sms', 'other'])
    .withMessage('Invalid activity type'),
  query('search').optional().isLength({ min: 2, max: 200 }).withMessage('search must be 2�200 characters'),
  query('dateFrom').optional().isISO8601().withMessage('dateFrom must be a valid ISO date'),
  query('dateTo').optional().isISO8601().withMessage('dateTo must be a valid ISO date'),
  query('leadId').optional().isUUID().withMessage('leadId must be a valid UUID'),
  query('opportunityId').optional().isUUID().withMessage('opportunityId must be a valid UUID'),
  query('linkedId').optional().isUUID().withMessage('linkedId must be a valid UUID'),
  query('linkedType').optional().isIn(['lead', 'opportunity']).withMessage("linkedType must be 'lead' or 'opportunity'"),
  query('executiveId').optional().isUUID().withMessage('executiveId must be a valid UUID'),
  query('overdue').optional().isIn(['true', 'false']).withMessage("overdue must be 'true' or 'false'"),
];

// Routes

// GET /api/activities/stats � summary counts for the page header strip
router.get(
  '/stats',
  authenticate,
  activityController.getActivityStats
);

// POST /api/activities — create activity for a lead (ownership enforced in service)
router.post(
  '/',
  authenticate,
  createActivityValidation,
  validate,
  activityController.createActivity
);

// GET /api/activities/all -- org-wide activity log, manager/admin only
router.get(
  '/all',
  authenticate,
  requireManagerOrAdmin,
  getActivitiesValidation,
  validate,
  activityController.getAllActivities
);

// GET /api/activities/my -- personal activity log for the authenticated user
router.get(
  '/my',
  authenticate,
  getActivitiesValidation,
  validate,
  activityController.getMyActivities
);

// GET /api/activities -- full filter support
router.get(
  '/',
  authenticate,
  getActivitiesValidation,
  validate,
  activityController.getActivities
);

// GET /api/activities/lead/:leadId � per-lead activities, ownership enforced in service
router.get(
  '/lead/:leadId',
  authenticate,
  getLeadActivitiesValidation,
  validate,
  activityController.getLeadActivities
);
// GET /api/activities/coaching-alerts — overdue follow-ups with executive info (manager/admin)
router.get(
  '/coaching-alerts',
  authenticate,
  requireManagerOrAdmin,
  activityController.getCoachingAlerts
);

// GET /api/activities/:id — single activity (ownership enforced in service)
router.get(
  '/:id',
  authenticate,
  [param('id').isUUID().withMessage('Activity ID must be a valid UUID')],
  validate,
  activityController.getActivityById
);

// PUT /api/activities/:id — update activity (ownership enforced in service)
router.put(
  '/:id',
  authenticate,
  [param('id').isUUID().withMessage('Activity ID must be a valid UUID')],
  validate,
  activityController.updateActivity
);

// DELETE /api/activities/:id — creator or admin only, audit-logged
router.delete(
  '/:id',
  authenticate,
  [param('id').isUUID().withMessage('Activity ID must be a valid UUID')],
  validate,
  activityController.deleteActivity
);
module.exports = router;

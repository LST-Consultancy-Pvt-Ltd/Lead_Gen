/**
 * activities.js
 * Routes for activity management
 */

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const activityController = require('../controllers/activityController');

// Validation rules
const createActivityValidation = [
  body('leadId')
    .notEmpty()
    .withMessage('Lead ID is required')
    .isUUID()
    .withMessage('Lead ID must be a valid UUID'),
  
  // Validate 'type' field (primary field name from frontend)
  body('type')
    .optional()
    .customSanitizer(value => value ? value.toLowerCase() : value)
    .isIn(['call', 'email', 'meeting', 'demo', 'whatsapp', 'note', 'linkedin', 'sms', 'other'])
    .withMessage('Invalid action type'),
  
  // Validate 'action' field (alternative field name)
  body('action')
    .optional()
    .customSanitizer(value => value ? value.toLowerCase() : value)
    .isIn(['call', 'email', 'meeting', 'demo', 'whatsapp', 'note', 'linkedin', 'sms', 'other'])
    .withMessage('Invalid action type'),
  
  // Custom validation to ensure at least one of type/action exists
  body()
    .custom((value, { req }) => {
      if (!req.body.type && !req.body.action) {
        throw new Error('Action type is required (use "type" or "action" field)');
      }
      return true;
    }),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Description must be less than 2000 characters'),
  
  body('outcome')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Outcome must be less than 500 characters'),
  
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

const getActivitiesQueryValidation = [
  query('leadId')
    .notEmpty()
    .withMessage('Lead ID query parameter is required')
    .isUUID()
    .withMessage('Lead ID must be a valid UUID'),
];

// Routes
router.post(
  '/',
  authenticate,
  createActivityValidation,
  validate,
  activityController.createActivity
);

// GET /api/activities?leadId=xxx (query param format)
router.get(
  '/',
  authenticate,
  getActivitiesQueryValidation,
  validate,
  (req, res) => {
    // Convert query param to path param for the controller
    req.params.leadId = req.query.leadId;
    return activityController.getLeadActivities(req, res);
  }
);

// GET /api/activities/lead/:leadId (path param format)
router.get(
  '/lead/:leadId',
  authenticate,
  getLeadActivitiesValidation,
  validate,
  activityController.getLeadActivities
);

module.exports = router;

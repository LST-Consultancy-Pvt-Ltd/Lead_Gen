/**
 * leads.routes.js
 * Production-ready Lead routes with validation and RBAC
 */

const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const leadsController = require('../controllers/leads.controller');

// Validation rules
const createLeadValidation = [
  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Company name is required')
    .isLength({ min: 2, max: 200 })
    .withMessage('Company name must be between 2 and 200 characters'),
  
  body('website')
    .optional()
    .trim()
    .isURL()
    .withMessage('Website must be a valid URL'),
  
  body('contactEmail')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Contact email must be valid')
    .normalizeEmail(),
  
  body('contactPhone')
    .optional()
    .trim()
    .matches(/^[+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/)
    .withMessage('Contact phone must be valid'),
  
  body('status')
    .optional()
    .isIn(['new', 'contacted', 'replied', 'meeting_booked', 'qualified', 'disqualified', 'closed_won', 'closed_lost'])
    .withMessage('Invalid status'),
  
  body('intentLevel')
    .optional()
    .isIn(['hot', 'warm', 'cold'])
    .withMessage('Invalid intent level'),
  
  body('assignedToId')
    .optional()
    .isUUID()
    .withMessage('Assigned to ID must be a valid UUID'),
  
  body('industry')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Industry must be less than 100 characters'),
  
  body('location')
    .optional()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Location must be less than 200 characters'),
];

const updateLeadValidation = [
  param('id')
    .isUUID()
    .withMessage('Lead ID must be a valid UUID'),
  
  body('companyName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Company name must be between 2 and 200 characters'),
  
  body('website')
    .optional()
    .trim()
    .isURL()
    .withMessage('Website must be a valid URL'),
  
  body('contactEmail')
    .optional()
    .trim()
    .isEmail()
    .withMessage('Contact email must be valid')
    .normalizeEmail(),
  
  body('contactPhone')
    .optional()
    .trim(),
  
  body('status')
    .optional()
    .isIn(['new', 'contacted', 'replied', 'meeting_booked', 'qualified', 'disqualified', 'closed_won', 'closed_lost'])
    .withMessage('Invalid status'),
  
  body('intentLevel')
    .optional()
    .isIn(['hot', 'warm', 'cold'])
    .withMessage('Invalid intent level'),
  
  body('assignedToId')
    .optional()
    .isUUID()
    .withMessage('Assigned to ID must be a valid UUID'),
  
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Notes must be less than 5000 characters'),
];

const getLeadsValidation = [
  query('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  query('limit')
    .optional()
    .isInt({ min: 1, max: 100 })
    .withMessage('Limit must be between 1 and 100'),
  
  query('status')
    .optional()
    .isIn(['new', 'contacted', 'replied', 'meeting_booked', 'qualified', 'disqualified', 'closed_won', 'closed_lost'])
    .withMessage('Invalid status'),
  
  query('intent')
    .optional()
    .isIn(['hot', 'warm', 'cold'])
    .withMessage('Invalid intent level'),
  
  query('search')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Search must be between 2 and 100 characters'),
  
  query('assignedTo')
    .optional()
    .isUUID()
    .withMessage('Assigned to must be a valid UUID'),
  
  query('sortBy')
    .optional()
    .isIn(['createdAt', 'updatedAt', 'companyName', 'leadScore', 'intentScore'])
    .withMessage('Invalid sort field'),
  
  query('sortDir')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort direction must be asc or desc'),
];

const leadIdValidation = [
  param('id')
    .isUUID()
    .withMessage('Lead ID must be a valid UUID'),
];

const createActivityValidation = [
  param('id')
    .isUUID()
    .withMessage('Lead ID must be a valid UUID'),
  
  body('action')
    .trim()
    .notEmpty()
    .withMessage('Action is required')
    .isIn(['call', 'email', 'meeting', 'demo', 'note', 'whatsapp', 'linkedin'])
    .withMessage('Invalid action type'),
  
  body('description')
    .trim()
    .notEmpty()
    .withMessage('Description is required')
    .isLength({ min: 5, max: 2000 })
    .withMessage('Description must be between 5 and 2000 characters'),
  
  body('metadata')
    .optional()
    .isObject()
    .withMessage('Metadata must be an object'),
];

// Routes

/**
 * GET /api/leads
 * Get all leads with filters and pagination
 * Access: All authenticated users (filtered by role)
 */
router.get(
  '/',
  authenticate,
  getLeadsValidation,
  validate,
  leadsController.getLeads
);

/**
 * GET /api/leads/stats
 * Get lead statistics
 * Access: All authenticated users (filtered by role)
 */
router.get(
  '/stats',
  authenticate,
  leadsController.getLeadStats
);

/**
 * GET /api/leads/:id
 * Get single lead by ID
 * Access: All authenticated users (with RBAC check in controller)
 */
router.get(
  '/:id',
  authenticate,
  leadIdValidation,
  validate,
  leadsController.getLeadById
);

/**
 * POST /api/leads
 * Create a new lead
 * Access: All authenticated users
 */
router.post(
  '/',
  authenticate,
  createLeadValidation,
  validate,
  leadsController.createLead
);

/**
 * PUT /api/leads/:id
 * Update a lead
 * Access: All authenticated users (with RBAC check in controller)
 */
router.put(
  '/:id',
  authenticate,
  updateLeadValidation,
  validate,
  leadsController.updateLead
);

/**
 * DELETE /api/leads/:id
 * Delete a lead
 * Access: Admin only
 */
router.delete(
  '/:id',
  authenticate,
  requireAdmin,
  leadIdValidation,
  validate,
  leadsController.deleteLead
);

/**
 * GET /api/leads/:id/activities
 * Get activities for a specific lead
 * Access: All authenticated users (with RBAC check in controller)
 */
router.get(
  '/:id/activities',
  authenticate,
  leadIdValidation,
  validate,
  leadsController.getLeadActivities
);

/**
 * POST /api/leads/:id/activities
 * Create an activity for a lead
 * Access: All authenticated users (with RBAC check in controller)
 */
router.post(
  '/:id/activities',
  authenticate,
  createActivityValidation,
  validate,
  leadsController.createLeadActivity
);

module.exports = router;

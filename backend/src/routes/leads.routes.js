/**
 * leads.routes.js
 * Production-ready Lead routes with validation and RBAC
 */

const express = require('express');
const router = express.Router();
const { body, query, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireAdmin, requireManagerOrAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const leadsController = require('../controllers/leads.controller');
const legacyLeadController = require('../controllers/leadController');

// Validation rules
const createLeadValidation = [
  // Spec required fields
  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('First name must be 100 characters or less'),

  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Last name must be 100 characters or less'),

  body('contactEmail')
    .optional({ checkFalsy: true })
    .trim()
    .isEmail()
    .withMessage('Contact email must be valid')
    .normalizeEmail(),

  body('companyName')
    .trim()
    .notEmpty()
    .withMessage('Company name is required')
    .isLength({ min: 2, max: 200 })
    .withMessage('Company name must be between 2 and 200 characters'),

  body('source')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 100 })
    .withMessage('Source must be 100 characters or less'),

  body('requirementType')
    .optional({ checkFalsy: true })
    .customSanitizer((val) => {
      if (!val || (Array.isArray(val) && val.length === 0)) return [];
      if (Array.isArray(val)) return val;
      if (typeof val === 'string') {
        try { const parsed = JSON.parse(val); return Array.isArray(parsed) ? parsed : [val]; }
        catch { return [val]; }
      }
      return [];
    }),

  body('status')
    .optional({ checkFalsy: true })
    .customSanitizer((val) => (val ? val.toLowerCase() : val))
    .isIn(['new', 'contacted', 'replied', 'meeting_booked', 'qualified', 'disqualified', 'closed_won', 'closed_lost'])
    .withMessage('Invalid status'),

  body('followUpDate')
    .optional({ checkFalsy: true })
    .customSanitizer((val) => {
      if (!val) return val;
      // Convert DD-MM-YYYY → YYYY-MM-DD so isISO8601 passes
      const m = val.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      return m ? `${m[3]}-${m[2]}-${m[1]}` : val;
    })
    .isISO8601()
    .withMessage('followUpDate must be a valid date (YYYY-MM-DD or DD-MM-YYYY)'),

  // Spec: disqualificationReason required if status = disqualified
  body('disqualificationReason')
    .if(body('status').equals('disqualified'))
    .trim()
    .notEmpty()
    .withMessage('Disqualification reason is required when disqualifying a lead'),

  body('website')
    .optional({ checkFalsy: true })
    .trim()
    .isURL()
    .withMessage('Website must be a valid URL'),

  body('contactPhone')
    .optional({ checkFalsy: true })
    .trim()
    .isLength({ max: 30 })
    .withMessage('Contact phone must be 30 characters or less'),

  body('intentLevel')
    .optional({ checkFalsy: true })
    .customSanitizer((val) => (val ? val.toLowerCase() : val))
    .isIn(['hot', 'warm', 'cold'])
    .withMessage('Invalid intent level'),

  body('temperature')
    .optional({ checkFalsy: true })
    .customSanitizer((val) => (val ? val.toLowerCase() : val))
    .isIn(['hot', 'warm', 'cold'])
    .withMessage('Invalid temperature'),

  body('assignedToId')
    .optional({ checkFalsy: true })
    .isUUID()
    .withMessage('Assigned to ID must be a valid UUID'),

  body('industry')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Industry must be less than 100 characters'),

  body('requirementDescription')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Requirement description must be 2000 characters or less'),
];

const updateLeadValidation = [
  param('id')
    .isUUID()
    .withMessage('Lead ID must be a valid UUID'),

  body('firstName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('First name must be 100 characters or less'),

  body('lastName')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Last name must be 100 characters or less'),
  
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

  // Spec: disqualificationReason required when setting status to disqualified
  body('disqualificationReason')
    .if(body('status').equals('disqualified'))
    .trim()
    .notEmpty()
    .withMessage('Disqualification reason is required when disqualifying a lead'),
  
  body('intentLevel')
    .optional()
    .isIn(['hot', 'warm', 'cold'])
    .withMessage('Invalid intent level'),

  body('temperature')
    .optional()
    .isIn(['hot', 'warm', 'cold'])
    .withMessage('Invalid temperature'),
  
  body('assignedToId')
    .optional()
    .isUUID()
    .withMessage('Assigned to ID must be a valid UUID'),
  
  body('notes')
    .optional()
    .trim()
    .isLength({ max: 5000 })
    .withMessage('Notes must be less than 5000 characters'),

  body('followUpDate')
    .optional()
    .isISO8601()
    .withMessage('followUpDate must be a valid ISO date'),

  body('requirementDescription')
    .optional()
    .trim()
    .isLength({ max: 2000 })
    .withMessage('Requirement description must be 2000 characters or less'),
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
    .isIn(['createdAt', 'updatedAt', 'companyName', 'leadScore', 'intentScore', 'followUpDate'])
    .withMessage('Invalid sort field'),
  
  query('sortDir')
    .optional()
    .isIn(['asc', 'desc'])
    .withMessage('Sort direction must be asc or desc'),

  query('followUp')
    .optional()
    .isIn(['overdue', 'today', 'future', 'none'])
    .withMessage('followUp must be one of: overdue, today, future, none'),
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
 * GET /api/leads/config
 * Returns lead form config (follow-up required statuses, all statuses)
 * Access: All authenticated users
 */
router.get(
  '/config',
  authenticate,
  leadsController.getLeadConfig
);

/**
 * GET /api/leads/assignable-users
 * Returns only sales_user members the caller can assign leads to.
 * manager     → their direct reports (sales_user) only
 * org_admin / super_admin → all active sales_users in the org
 * sales_user  → empty array (they always assign to themselves)
 * Used to populate the "Assign To" dropdown in the bulk-assign UI.
 * Access: All authenticated users
 */
router.get(
  '/assignable-users',
  authenticate,
  leadsController.getAssignableUsers
);

/**
 * POST /api/leads/bulk-assign
 * Bulk-assign selected leads to a sales executive.
 * Manager selects one or more leads via checkbox and assigns them in one action.
 * Access: Manager and above only
 */
router.post(
  '/bulk-assign',
  authenticate,
  requireManagerOrAdmin,
  [
    body('leadIds')
      .isArray({ min: 1 })
      .withMessage('leadIds must be a non-empty array')
      .custom((arr) => arr.every((id) => typeof id === 'string' && id.trim().length > 0))
      .withMessage('Each leadId must be a non-empty string'),
    body('assignedToId')
      .isUUID()
      .withMessage('assignedToId must be a valid UUID'),
  ],
  validate,
  leadsController.bulkAssignLeads
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
 * PATCH /api/leads/:id
 * Partially update a lead
 * Access: All authenticated users (with RBAC check in controller)
 */
router.patch(
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

/**
 * PATCH /api/leads/:id/reassign
 * Reassign lead to a different user
 * Access: Manager and above only
 */
router.patch(
  '/:id/reassign',
  authenticate,
  requireManagerOrAdmin,
  [
    param('id').isUUID().withMessage('Lead ID must be a valid UUID'),
    body('assignedToId').isUUID().withMessage('assignedToId must be a valid UUID'),
  ],
  validate,
  leadsController.reassignLead
);

/**
 * POST /api/leads/:id/convert
 * Convert a qualified lead to an opportunity
 * Access: All authenticated users (ownership enforced in service)
 */
router.post(
  '/:id/convert',
  authenticate,
  [param('id').isUUID().withMessage('Lead ID must be a valid UUID')],
  validate,
  leadsController.convertLead
);

/**
 * POST /api/leads/:id/enrich/signalhire
 * Enrich lead contact via SignalHire
 * Access: All authenticated users
 */
router.post(
  '/:id/enrich/signalhire',
  authenticate,
  leadIdValidation,
  validate,
  legacyLeadController.enrichLeadViaSignalHire
);

/**
 * POST /api/leads/:id/enrich/apollo
 * Enrich lead contact via Apollo
 * Access: All authenticated users
 */
router.post(
  '/:id/enrich/apollo',
  authenticate,
  leadIdValidation,
  validate,
  legacyLeadController.enrichLeadViaApollo
);

module.exports = router;

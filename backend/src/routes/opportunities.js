/**
 * opportunities.js
 * Routes for Opportunity Management
 * - sales_user: own opportunities only (enforced in service)
 * - manager/admin: all opportunities
 * - Deletion restricted to admin roles
 */

const router = require('express').Router();
const { body, param, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/opportunityController');

const VALID_STAGES = ['prospecting', 'qualification', 'qualified', 'demo', 'proposal', 'negotiation', 'closed_won', 'closed_lost'];

const createValidation = [
  body('leadId').isUUID().withMessage('leadId must be a valid UUID'),
  body('title').optional().trim().isLength({ max: 200 }),
  body('name').optional().trim().isLength({ max: 200 }),
  body('opportunityName').optional().trim().isLength({ max: 200 }),
  body('stage').optional().isIn(VALID_STAGES).withMessage('Invalid stage'),
  body('dealValue').optional().isFloat({ min: 0 }).withMessage('Deal value must be a positive number'),
  body('value').optional().isFloat({ min: 0 }).withMessage('Value must be a positive number'),
  body('closeProbability').optional().isInt({ min: 0, max: 100 }).withMessage('Close probability must be 0-100'),
  body('probability').optional().isInt({ min: 0, max: 100 }).withMessage('Probability must be 0-100'),
  body('expectedCloseDate').optional().isISO8601().withMessage('Expected close date must be a valid date'),
  body('assignedToId').optional().isUUID().withMessage('assignedToId must be a valid UUID'),
  body('wonLostReason').optional().trim().isLength({ max: 1000 }),
  body('notes').optional().trim().isLength({ max: 5000 }),
];

const updateValidation = [
  param('id').isUUID().withMessage('Opportunity ID must be a valid UUID'),
  body('title').optional().trim().isLength({ max: 200 }),
  body('stage').optional().isIn(VALID_STAGES).withMessage('Invalid stage'),
  body('dealValue').optional().isFloat({ min: 0 }),
  body('value').optional().isFloat({ min: 0 }),
  body('closeProbability').optional().isInt({ min: 0, max: 100 }),
  body('probability').optional().isInt({ min: 0, max: 100 }),
  body('expectedCloseDate').optional().isISO8601(),
  body('assignedToId').optional().isUUID(),
  body('wonLostReason').optional().trim().isLength({ max: 1000 }),
  body('notes').optional().trim().isLength({ max: 5000 }),
];

router.use(authenticate);

// GET /api/opportunities — own for sales_user, all for manager/admin
router.get('/', ctrl.getOpportunities);

// GET /api/opportunities/:id — ownership enforced in service
router.get('/:id', [param('id').isUUID()], validate, ctrl.getOpportunity);

// POST /api/opportunities — all authenticated users can create
router.post('/', createValidation, validate, ctrl.createOpportunity);

// PATCH /api/opportunities/:id — ownership enforced in service; stage change validated for 7-day activity
router.patch('/:id', updateValidation, validate, ctrl.updateOpportunity);

// DELETE /api/opportunities/:id — admin only
router.delete('/:id', requireAdmin, [param('id').isUUID()], validate, ctrl.deleteOpportunity);

module.exports = router;

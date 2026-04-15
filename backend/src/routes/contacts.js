/**
 * contacts.js
 * Routes for Contact management
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/contacts.controller');

router.use(authenticate);

router.get('/', ctrl.getContacts);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getContactById);
router.post('/', [
  // All fields are optional for lead-linked contacts — at least one must be provided (validated in controller)
  body('name').optional({ checkFalsy: true }).trim(),
  body('email').optional({ checkFalsy: true }).isEmail().normalizeEmail().withMessage('Valid email required'),
  body('influenceLevel').optional().isIn(['low', 'medium', 'high']),
  body('decisionMaker').optional().isBoolean(),
  body('leadId').optional().isUUID().withMessage('leadId must be a valid UUID'),
], validate, ctrl.createContact);
router.patch('/:id', [param('id').isUUID()], validate, ctrl.updateContact);
router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteContact);

module.exports = router;

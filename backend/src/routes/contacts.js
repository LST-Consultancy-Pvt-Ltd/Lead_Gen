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
  body('name').trim().notEmpty().withMessage('Name is required'),
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('influenceLevel').optional().isIn(['low', 'medium', 'high']),
  body('decisionMaker').optional().isBoolean(),
], validate, ctrl.createContact);
router.patch('/:id', [param('id').isUUID()], validate, ctrl.updateContact);
router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteContact);

module.exports = router;

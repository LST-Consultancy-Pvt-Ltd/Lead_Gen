/**
 * accounts.js
 * Routes for Account management
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/accounts.controller');

router.use(authenticate);

router.get('/', ctrl.getAccounts);
router.get('/:id', [param('id').isUUID()], validate, ctrl.getAccountById);
router.post('/', [
  body('companyName').trim().notEmpty().withMessage('Company name is required'),
  body('customerType').optional().isIn(['prospect', 'customer', 'partner', 'churned']),
  body('website').optional().trim().customSanitizer((val) => {
  if (!val) return val;
  return /^https?:\/\//i.test(val) ? val : `https://${val}`;
}).isURL({ require_protocol: false, require_tld: true }).withMessage('Invalid website URL'),
], validate, ctrl.createAccount);
router.patch('/:id', [param('id').isUUID()], validate, ctrl.updateAccount);
router.delete('/:id', [param('id').isUUID()], validate, ctrl.deleteAccount);

module.exports = router;

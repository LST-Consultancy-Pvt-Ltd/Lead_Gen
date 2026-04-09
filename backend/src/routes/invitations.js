/**
 * invitations.js
 * Invitation routes
 */

const router = require('express').Router();
const { body, param } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const ctrl = require('../controllers/invitationController');

const sendValidation = [
  body('email').isEmail().normalizeEmail().withMessage('Valid email is required'),
  body('role').isIn(['manager', 'sales_user', 'org_admin', 'super_admin']).withMessage('Invalid role'),
  body('name').optional().trim().isLength({ min: 1, max: 100 }),
];

const acceptValidation = [
  body('token').notEmpty().withMessage('Token is required'),
  body('name').trim().notEmpty().withMessage('Name is required').isLength({ max: 100 }),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
];

// Protected routes
router.use('/accept', (req, res, next) => next()); // bypass authenticate for accept

router.post('/', authenticate, sendValidation, validate, ctrl.sendInvitation);
router.post('/accept', acceptValidation, validate, ctrl.acceptInvitation);
router.get('/', authenticate, ctrl.getInvitations);
router.delete('/:id', authenticate, [param('id').isUUID()], validate, ctrl.revokeInvitation);

module.exports = router;

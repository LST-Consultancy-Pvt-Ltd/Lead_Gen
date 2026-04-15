const router = require('express').Router();
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');

router.post('/register',
  [body('name').notEmpty(), body('email').isEmail(), body('password').isLength({ min: 8 }), body('orgName').notEmpty()],
  validate, ctrl.register
);
router.post('/verify-otp',
  [body('email').isEmail(), body('otp').isLength({ min: 4, max: 4 }).isNumeric()],
  validate, ctrl.verifyOtp
);
router.post('/resend-otp',
  [body('email').isEmail()],
  validate, ctrl.resendOtp
);
router.post('/forgot-password',
  [body('email').isEmail()],
  validate, ctrl.forgotPassword
);
router.post('/verify-reset-otp',
  [body('email').isEmail(), body('otp').isLength({ min: 4, max: 4 }).isNumeric()],
  validate, ctrl.verifyResetOtp
);
router.post('/reset-password',
  [body('email').isEmail(), body('resetToken').notEmpty(), body('newPassword').isLength({ min: 8 })],
  validate, ctrl.resetPassword
);
router.post('/login',
  [body('email').isEmail(), body('password').notEmpty()],
  validate, ctrl.login
);
router.post('/google', [body('credential').notEmpty()], validate, ctrl.googleAuth);
router.post('/refresh', [body('refreshToken').notEmpty()], validate, ctrl.refresh);
router.post('/logout', authenticate, ctrl.logout);
router.get('/me', authenticate, ctrl.me);

module.exports = router;

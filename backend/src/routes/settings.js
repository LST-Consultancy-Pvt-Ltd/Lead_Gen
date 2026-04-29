const router = require('express').Router();
const ctrl = require('../controllers/settingsController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// GET /api/settings — all authenticated roles
router.get('/', authenticate, ctrl.getSettings);

// PATCH /api/settings — admin only
router.patch('/', authenticate, requireAdmin, ctrl.updateSettings);

module.exports = router;

const router = require('express').Router();
const ctrl = require('../controllers/dropdownController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// GET /api/dropdowns?category=lead_source — all authenticated roles
router.get('/', authenticate, ctrl.listByCategory);

// GET /api/dropdowns/all — org_admin only
router.get('/all', authenticate, requireAdmin, ctrl.listAllCategories);

// POST /api/dropdowns — org_admin only
router.post('/', authenticate, requireAdmin, ctrl.addValue);

// PATCH /api/dropdowns/:id — org_admin only
router.patch('/:id', authenticate, requireAdmin, ctrl.updateValue);

module.exports = router;

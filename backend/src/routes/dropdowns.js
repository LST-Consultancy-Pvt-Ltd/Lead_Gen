const router = require('express').Router();
const ctrl = require('../controllers/dropdownController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// GET /api/dropdowns?category=lead_source — all authenticated roles
router.get('/', authenticate, ctrl.listByCategory);

// GET /api/dropdowns/all — org_admin only
router.get('/all', authenticate, requireAdmin, ctrl.listAllCategories);

// POST /api/dropdowns — all authenticated roles
router.post('/', authenticate, ctrl.addValue);

// PATCH /api/dropdowns/:id — all authenticated roles
router.patch('/:id', authenticate, ctrl.updateValue);

// DELETE /api/dropdowns/:id — all authenticated roles
router.delete('/:id', authenticate, ctrl.deleteValue);

module.exports = router;

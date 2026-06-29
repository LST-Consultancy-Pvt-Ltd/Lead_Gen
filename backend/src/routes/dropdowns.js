const router = require('express').Router();
const ctrl = require('../controllers/dropdownController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

// Allow any authenticated user to add a `location` value (sales execs/managers
// create locations on the fly from the Create Lead modal). All other categories
// remain admin-only.
const requireAdminUnlessLocation = (req, res, next) => {
  if (req.body?.category === 'location') return next();
  return requireAdmin(req, res, next);
};

// GET /api/dropdowns?category=lead_source — all authenticated roles
router.get('/', authenticate, ctrl.listByCategory);

// GET /api/dropdowns/active — all authenticated roles, flat array of all active items
router.get('/active', authenticate, ctrl.listActive);

// GET /api/dropdowns/discovery — all authenticated roles, all discovery categories grouped
router.get('/discovery', authenticate, ctrl.listDiscoveryDropdowns);

// GET /api/dropdowns/all — org_admin only
router.get('/all', authenticate, requireAdmin, ctrl.listAllCategories);

// POST /api/dropdowns/seed — admin only; seeds default values for the org
router.post('/seed', authenticate, requireAdmin, ctrl.seedOrgDropdowns);

// POST /api/dropdowns — admin only, except `location` which any authenticated user may add
router.post('/', authenticate, requireAdminUnlessLocation, ctrl.addValue);

// PUT /api/dropdowns/:id/set-default — admin only
router.put('/:id/set-default', authenticate, requireAdmin, ctrl.setDefaultDropdown);

// PATCH /api/dropdowns/:id — admin only
router.patch('/:id', authenticate, requireAdmin, ctrl.updateValue);

// DELETE /api/dropdowns/:id — admin only
router.delete('/:id', authenticate, requireAdmin, ctrl.deleteValue);

module.exports = router;

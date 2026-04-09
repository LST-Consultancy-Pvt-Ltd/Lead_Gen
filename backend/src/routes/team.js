const router = require('express').Router();
const ctrl = require('../controllers/teamController');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');

router.use(authenticate);

// All authenticated users can view team members
router.get('/', ctrl.getTeam);

// Only org_admin / super_admin can manage team membership and roles
router.post('/', requireAdmin, ctrl.inviteUser);
router.patch('/bulk-reassign', requireAdmin, ctrl.bulkReassignLeads);
router.patch('/:id', requireAdmin, ctrl.updateUser);
router.delete('/:id', requireAdmin, ctrl.deleteUser);

module.exports = router;

const router = require('express').Router();
const ctrl = require('../controllers/teamController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', ctrl.getTeam);
router.post('/', authorize('org_admin'), ctrl.inviteUser);
router.patch('/:id', authorize('org_admin'), ctrl.updateUser);
router.delete('/:id', authorize('org_admin'), ctrl.deleteUser);

module.exports = router;

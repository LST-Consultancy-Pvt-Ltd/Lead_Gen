const router = require('express').Router();
const ctrl = require('../controllers/emailTemplateController');
const { authenticate } = require('../middleware/auth');
const { authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/',     ctrl.list);
router.post('/',    authorize('org_admin', 'manager'), ctrl.create);
router.patch('/:id', authorize('org_admin', 'manager'), ctrl.update);
router.delete('/:id', authorize('org_admin', 'manager'), ctrl.remove);

module.exports = router;

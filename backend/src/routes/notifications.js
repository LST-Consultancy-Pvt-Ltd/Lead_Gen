const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

router.get('/', ctrl.getNotifications);
router.patch('/read', ctrl.markAsRead);

module.exports = router;

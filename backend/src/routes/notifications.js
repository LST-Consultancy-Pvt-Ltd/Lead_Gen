const router = require('express').Router();
const ctrl = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Get paginated notifications (with optional unreadOnly filter)
router.get('/', ctrl.getNotifications);

// Get unread count
router.get('/unread-count', ctrl.getUnreadCount);

// Mark all notifications as read
router.patch('/mark-all-read', ctrl.markAllAsRead);

// Mark multiple notifications as read (bulk)
router.patch('/read', ctrl.markAsRead);

// Mark single notification as read
router.patch('/:id/read', ctrl.markSingleAsRead);

module.exports = router;

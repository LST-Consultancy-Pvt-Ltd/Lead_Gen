/**
 * notificationController.js
 * In-app notifications for authenticated users
 */

const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');

// GET /api/notifications — unread notifications for current user
async function getNotifications(req, res) {
  try {
    const notifications = await prisma.notification.findMany({
      where: {
        userId: req.user.id,
        isRead: false,
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, notifications);
  } catch (err) {
    return error(res, 'Failed to fetch notifications', 500);
  }
}

// PATCH /api/notifications/read — mark provided IDs as read for current user
async function markAsRead(req, res) {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      return error(res, 'ids must be a non-empty array', 400);
    }

    await prisma.notification.updateMany({
      where: {
        id: { in: ids },
        userId: req.user.id, // Prevents marking other users' notifications
      },
      data: { isRead: true },
    });
    return success(res, null, 'Notifications marked as read');
  } catch (err) {
    return error(res, 'Failed to mark notifications as read', 500);
  }
}

module.exports = { getNotifications, markAsRead };

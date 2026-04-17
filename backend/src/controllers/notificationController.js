/**
 * notificationController.js
 * In-app notifications for authenticated users
 */

const prisma = require('../utils/prisma');
const { success, error, paginated } = require('../utils/response');

/**
 * GET /api/notifications
 * Fetch notifications for current user with pagination
 * Query params:
 *  - page (default: 1)
 *  - limit (default: 20)
 *  - unreadOnly (default: false) — if true, returns only unread notifications
 */
async function getNotifications(req, res) {
  try {
    const { page = 1, limit = 20, unreadOnly = 'false' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const take = parseInt(limit);

    const where = {
      userId: req.user.id,
    };

    // Filter by unread if requested
    if (unreadOnly === 'true') {
      where.isRead = false;
    }

    const [notifications, total, unreadCount] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
      prisma.notification.count({
        where: {
          userId: req.user.id,
          isRead: false,
        },
      }),
    ]);

    // Add leadId field for easier frontend access
    const notificationsWithLeadId = notifications.map(notification => ({
      ...notification,
      leadId: notification.entityType === 'Lead' ? notification.entityId : null,
    }));

    return paginated(res, notificationsWithLeadId, total, page, limit, { unreadCount });
  } catch (err) {
    return error(res, 'Failed to fetch notifications', 500);
  }
}

/**
 * GET /api/notifications/unread-count
 * Get the count of unread notifications for the current user
 */
async function getUnreadCount(req, res) {
  try {
    const unreadCount = await prisma.notification.count({
      where: {
        userId: req.user.id,
        isRead: false,
      },
    });

    return success(res, { unreadCount });
  } catch (err) {
    return error(res, 'Failed to fetch unread count', 500);
  }
}

/**
 * PATCH /api/notifications/:id/read
 * Mark a single notification as read for the current user
 */
async function markSingleAsRead(req, res) {
  try {
    const { id } = req.params;

    // Check if notification exists and belongs to the user
    const notification = await prisma.notification.findFirst({
      where: {
        id,
        userId: req.user.id,
      },
    });

    if (!notification) {
      return error(res, 'Notification not found', 404);
    }

    await prisma.notification.update({
      where: { id },
      data: { isRead: true },
    });

    // Return leadId for navigation (only if entityType is Lead)
    const leadId = notification.entityType === 'Lead' ? notification.entityId : null;

    return success(res, { id, leadId }, 'Notification marked as read');
  } catch (err) {
    return error(res, 'Failed to mark notification as read', 500);
  }
}

/**
 * PATCH /api/notifications/read
 * Mark multiple notifications as read for current user
 */
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

/**
 * PATCH /api/notifications/mark-all-read
 * Mark all notifications as read for the current user
 */
async function markAllAsRead(req, res) {
  try {
    await prisma.notification.updateMany({
      where: {
        userId: req.user.id,
        isRead: false,
      },
      data: { isRead: true },
    });

    return success(res, null, 'All notifications marked as read');
  } catch (err) {
    return error(res, 'Failed to mark all notifications as read', 500);
  }
}

module.exports = { 
  getNotifications, 
  getUnreadCount, 
  markSingleAsRead, 
  markAsRead, 
  markAllAsRead 
};

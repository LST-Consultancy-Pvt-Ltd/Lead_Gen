/**
 * notificationService.js
 * Non-throwing notification helpers. Failures never crash the caller.
 */

async function createNotification(prisma, { userId, organizationId, type, title, message, entityType, entityId }) {
  try {
    await prisma.notification.create({
      data: {
        userId,
        organizationId,
        type,
        title,
        message,
        entityType: entityType || null,
        entityId: entityId || null,
      },
    });
  } catch (_err) {
    // Intentionally swallowed
  }
}

async function createBulkNotifications(prisma, notifications) {
  try {
    await prisma.notification.createMany({
      data: notifications.map((n) => ({
        userId: n.userId,
        organizationId: n.organizationId,
        type: n.type,
        title: n.title,
        message: n.message,
        entityType: n.entityType || null,
        entityId: n.entityId || null,
      })),
      skipDuplicates: true,
    });
  } catch (_err) {
    // Intentionally swallowed
  }
}

module.exports = { createNotification, createBulkNotifications };

/**
 * notificationService.js
 * Non-throwing notification helpers. Failures never crash the caller.
 */

// `actorId` (optional) is the user who performed the action — they never get a
// notification about their own action.
async function createNotification(prisma, { userId, organizationId, type, title, message, entityType, entityId, actorId }) {
  if (!userId || (actorId && userId === actorId)) return;
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

async function createBulkNotifications(prisma, notifications, { actorId } = {}) {
  // Drop self-notifications and duplicate recipients for the same entity
  const seen = new Set();
  const list = notifications.filter((n) => {
    if (!n.userId || (actorId && n.userId === actorId)) return false;
    const key = `${n.userId}|${n.type}|${n.entityId || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (!list.length) return;
  try {
    await prisma.notification.createMany({
      data: list.map((n) => ({
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

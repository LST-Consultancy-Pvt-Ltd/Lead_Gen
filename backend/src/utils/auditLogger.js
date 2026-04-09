/**
 * auditLogger.js
 * Non-throwing audit log helper. Failures never crash the caller.
 */

async function logAudit(prisma, { organizationId, entityType, entityId, action, changedById, fieldName, oldValue, newValue }) {
  try {
    await prisma.auditLog.create({
      data: {
        organizationId,
        entityType,
        entityId,
        action,
        changedById,
        fieldName: fieldName || null,
        oldValue: oldValue != null ? String(oldValue) : null,
        newValue: newValue != null ? String(newValue) : null,
      },
    });
  } catch (_err) {
    // Intentionally swallowed — audit failures must never crash the main operation
  }
}

module.exports = { logAudit };

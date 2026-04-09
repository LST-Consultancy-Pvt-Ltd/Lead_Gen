const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');
const { createNotification } = require('../utils/notificationService');
const dashboardEvents = require('../utils/dashboardEvents');

async function getTeam(req, res) {
  try {
    const caller = req.user;
    let where = { organizationId: caller.organizationId };

    if (caller.role === 'manager') {
      // Managers see only their direct reports + themselves
      where = { organizationId: caller.organizationId, OR: [{ managerId: caller.id }, { id: caller.id }] };
    } else if (caller.role === 'sales_user') {
      // Sales users see only themselves
      where = { id: caller.id };
    }

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        lastLoginAt: true, avatarUrl: true, createdAt: true, managerId: true,
        _count: { select: { assignedLeads: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return success(res, users);
  } catch (err) {
    return error(res, 'Failed to fetch team', 500);
  }
}

async function inviteUser(req, res) {
  try {
    const { name, email, role } = req.body;
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return error(res, 'Email already registered', 409);

    const tempPassword = Math.random().toString(36).slice(-10);
    const passwordHash = await bcrypt.hash(tempPassword, 12);

    const user = await prisma.user.create({
      data: { name, email, passwordHash, role: role || 'sales_user', organizationId: req.user.organizationId },
    });

    // In production: send invite email here
    return success(res, {
      id: user.id, name: user.name, email: user.email, role: user.role,
      tempPassword, // Remove in production, send via email
    }, 'User invited', 201);
  } catch (err) {
    return error(res, 'Failed to invite user', 500);
  }
}

async function updateUser(req, res) {
  try {
    const { role, isActive, name } = req.body;
    const target = await prisma.user.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!target) return error(res, 'User not found', 404);
    if (target.id === req.user.id && isActive === false) return error(res, 'Cannot disable your own account', 422);

    // Only org_admin / super_admin can change roles
    if (role && req.user.role === 'manager') {
      return error(res, 'Managers cannot change user roles', 403);
    }

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: { ...(role && { role }), ...(isActive !== undefined && { isActive }), ...(name && { name }) },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    return success(res, user);
  } catch (err) {
    return error(res, 'Failed to update user', 500);
  }
}

async function deleteUser(req, res) {
  try {
    const target = await prisma.user.findFirst({ where: { id: req.params.id, organizationId: req.user.organizationId } });
    if (!target) return error(res, 'User not found', 404);
    if (target.id === req.user.id) return error(res, 'Cannot delete your own account', 422);
    await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false } });
    return success(res, null, 'User deactivated');
  } catch (err) {
    return error(res, 'Failed to delete user', 500);
  }
}

// PATCH /api/team/bulk-reassign — org_admin only
async function bulkReassignLeads(req, res) {
  try {
    const { fromUserId, toUserId, leadIds } = req.body;
    if (!fromUserId || !toUserId) {
      return error(res, 'fromUserId and toUserId are required', 400);
    }

    const orgId = req.user.organizationId;

    // Verify both users belong to the organization
    const [fromUser, toUser] = await Promise.all([
      prisma.user.findFirst({ where: { id: fromUserId, organizationId: orgId }, select: { id: true, name: true } }),
      prisma.user.findFirst({ where: { id: toUserId, organizationId: orgId, isActive: true }, select: { id: true, name: true } }),
    ]);
    if (!fromUser) return error(res, 'Source user not found in organization', 404);
    if (!toUser) return error(res, 'Target user not found or inactive in organization', 404);

    let where = {
      organizationId: orgId,
      assignedToId: fromUserId,
      status: { not: 'disqualified' },
    };

    if (Array.isArray(leadIds) && leadIds.length > 0) {
      where.id = { in: leadIds };
    }

    const updated = await prisma.lead.updateMany({
      where,
      data: { assignedToId: toUserId },
    });

    await createNotification(prisma, {
      userId: toUserId,
      organizationId: orgId,
      type: 'bulk_assignment',
      title: 'Leads Bulk Assigned',
      message: `${req.user.name} has assigned ${updated.count} lead(s) to you from ${fromUser.name}`,
      entityType: 'Lead',
    });

    dashboardEvents.notifyOrg(orgId, 'lead');
    return success(res, { reassignedCount: updated.count }, `${updated.count} lead(s) reassigned successfully`);
  } catch (err) {
    return error(res, 'Failed to bulk reassign leads', 500);
  }
}

module.exports = { getTeam, inviteUser, updateUser, deleteUser, bulkReassignLeads };

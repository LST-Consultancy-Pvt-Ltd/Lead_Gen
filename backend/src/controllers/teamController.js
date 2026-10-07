const bcrypt = require('bcryptjs');
const activityService = require('../services/activity.service');
const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');
const { createNotification } = require('../utils/notificationService');
const dashboardEvents = require('../utils/dashboardEvents');

const ADMIN_ROLES = ['org_admin', 'super_admin'];

// Ids of every user in the caller's own team: the caller plus everyone reachable
// through invitedById / managerId links. Other admins' teams are never included.
async function getOwnedUserIds(caller) {
  const users = await prisma.user.findMany({
    where: { organizationId: caller.organizationId },
    select: { id: true, email: true, role: true, invitedById: true, managerId: true },
  });
  // Legacy users have no invitedById; recover it from their accepted invitation
  const accepted = await prisma.invitation.findMany({
    where: { organizationId: caller.organizationId, status: 'accepted' },
    select: { email: true, invitedById: true },
  });
  const inviterByEmail = new Map(accepted.map((i) => [i.email.toLowerCase(), i.invitedById]));
  for (const u of users) {
    if (!u.invitedById) u.invitedById = inviterByEmail.get((u.email || '').toLowerCase()) || null;
  }
  const children = new Map();
  for (const u of users) {
    for (const parent of new Set([u.invitedById, u.managerId])) {
      if (!parent || parent === u.id) continue;
      if (!children.has(parent)) children.set(parent, []);
      children.get(parent).push(u.id);
    }
  }
  const owned = new Set([caller.id]);
  const queue = [caller.id];
  while (queue.length) {
    for (const c of children.get(queue.pop()) || []) {
      if (!owned.has(c)) { owned.add(c); queue.push(c); }
    }
  }
  return owned;
}

// Reporting line above a non-admin user: manager (or inviter) all the way up to the main admin.
async function getAncestorIds(caller) {
  const users = await prisma.user.findMany({
    where: { organizationId: caller.organizationId },
    select: { id: true, email: true, role: true, invitedById: true, managerId: true },
  });
  const accepted = await prisma.invitation.findMany({
    where: { organizationId: caller.organizationId, status: 'accepted' },
    select: { email: true, invitedById: true },
  });
  const inviterByEmail = new Map(accepted.map((i) => [i.email.toLowerCase(), i.invitedById]));
  const byId = new Map(users.map((u) => [u.id, u]));
  const chain = new Set();
  let cur = byId.get(caller.id);
  while (cur) {
    const pid = cur.managerId || cur.invitedById || inviterByEmail.get((cur.email || '').toLowerCase());
    const parent = pid && pid !== cur.id ? byId.get(pid) : null;
    if (!parent || chain.has(parent.id)) break;
    chain.add(parent.id);
    cur = parent;
  }
  return chain;
}

// Resolves a target user the caller is allowed to act on (own org + own team).
async function findManageableUser(caller, id, extraWhere = {}) {
  const target = await prisma.user.findFirst({
    where: { id, organizationId: caller.organizationId, ...extraWhere },
  });
  if (!target) return null;
  if (ADMIN_ROLES.includes(caller.role) && target.id !== caller.id) {
    const owned = await getOwnedUserIds(caller);
    if (!owned.has(target.id)) return null;
  }
  return target;
}

async function getTeam(req, res) {
  try {
    const caller = req.user;
    // Everyone sees only their own line: the reporting chain above them (Admin -> Manager)
    // plus themselves and everyone below. No peers (other managers / executives).
    const ids = await getOwnedUserIds(caller);
    if (!ADMIN_ROLES.includes(caller.role)) {
      (await getAncestorIds(caller)).forEach((id) => ids.add(id));
    }
    const where = { organizationId: caller.organizationId, id: { in: [...ids] } };

    const users = await prisma.user.findMany({
      where,
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        lastLoginAt: true, avatarUrl: true, createdAt: true, managerId: true, invitedById: true,
        _count: { select: { assignedLeads: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    // Resolve legacy rows missing invitedById so the UI can build the hierarchy
    const accepted = await prisma.invitation.findMany({
      where: { organizationId: caller.organizationId, status: 'accepted' },
      select: { email: true, invitedById: true },
    });
    const inviterByEmail = new Map(accepted.map((i) => [i.email.toLowerCase(), i.invitedById]));
    return success(res, users.map((u) => ({
      ...u, invitedById: u.invitedById || inviterByEmail.get(u.email.toLowerCase()) || null,
    })));
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
      data: { name, email, passwordHash, role: role || 'sales_user', organizationId: req.user.organizationId, invitedById: req.user.id },
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
    const target = await findManageableUser(req.user, req.params.id);
    if (!target) return error(res, 'User not found', 404);
    if (target.id === req.user.id && isActive === false) return error(res, 'Cannot disable your own account', 422);

    // Only org_admin / super_admin can change roles
    if (role && req.user.role === 'manager') {
      return error(res, 'Managers cannot change user roles', 403);
    }

    const updateData = {
      ...(role && { role, roleChangedAt: new Date() }),
      ...(isActive !== undefined && { isActive }),
      ...(isActive === false && { refreshToken: null }),
      ...(name && { name }),
    };

    const user = await prisma.user.update({
      where: { id: req.params.id },
      data: updateData,
      select: { id: true, name: true, email: true, role: true, isActive: true },
    });
    return success(res, user);
  } catch (err) {
    return error(res, 'Failed to update user', 500);
  }
}

async function deleteUser(req, res) {
  try {
    const target = await findManageableUser(req.user, req.params.id);
    if (!target) return error(res, 'User not found', 404);
    if (target.id === req.user.id) return error(res, 'Cannot delete your own account', 422);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: false }, select: { id: true, isActive: true } });
    return success(res, user, 'User deactivated');
  } catch (err) {
    return error(res, 'Failed to delete user', 500);
  }
}

async function activateUser(req, res) {
  try {
    const target = await findManageableUser(req.user, req.params.id);
    if (!target) return error(res, 'User not found', 404);
    const user = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: true }, select: { id: true, isActive: true } });
    return success(res, user, 'User activated');
  } catch (err) {
    return error(res, 'Failed to activate user', 500);
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

    // Verify both users belong to the caller's own team
    const [fromUser, toUser] = await Promise.all([
      findManageableUser(req.user, fromUserId),
      findManageableUser(req.user, toUserId, { isActive: true }),
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

    // Only the owner changes; each lead gets an Activity Timeline entry
    const toReassign = await prisma.lead.findMany({ where, select: { id: true } });
    const updated = await prisma.lead.updateMany({
      where: { id: { in: toReassign.map((l) => l.id) } },
      data: { assignedToId: toUserId },
    });
    await Promise.all(toReassign.map((l) => activityService.logLeadAssigned(l.id, req.user, toUserId, fromUser.name)));

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

module.exports = {
  activateUser, getOwnedUserIds, getTeam, inviteUser, updateUser, deleteUser, bulkReassignLeads };

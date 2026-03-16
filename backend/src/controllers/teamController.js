const bcrypt = require('bcryptjs');
const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');

async function getTeam(req, res) {
  try {
    const users = await prisma.user.findMany({
      where: { organizationId: req.user.organizationId },
      select: {
        id: true, name: true, email: true, role: true, isActive: true,
        lastLoginAt: true, avatarUrl: true, createdAt: true,
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

module.exports = { getTeam, inviteUser, updateUser, deleteUser };

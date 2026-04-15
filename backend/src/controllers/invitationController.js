/**
 * invitationController.js
 * Handles invitation lifecycle: send, accept, list, revoke
 */

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const config = require('../config');
const emailService = require('../services/emailService');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  const refreshToken = jwt.sign({ userId }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
  return { accessToken, refreshToken };
}

/**
 * POST /api/invitations
 * Send an invitation email to a new user.
 * org_admin  → can invite manager or sales_user
 * manager    → can only invite sales_user (auto-linked to their team)
 * sales_user → 403
 */
async function sendInvitation(req, res) {
  try {
    const { email, role, name } = req.body;
    const caller = req.user;

    // Role gate
    if (caller.role === 'sales_user') {
      return error(res, 'Sales users cannot send invitations', 403);
    }
    if (caller.role === 'manager' && role !== 'sales_user') {
      return error(res, 'Managers can only invite sales users', 403);
    }
    if (!['manager', 'sales_user', 'org_admin', 'super_admin'].includes(role)) {
      return error(res, 'Invalid role', 400);
    }

    // Check if user already exists in org
    const existingUser = await prisma.user.findFirst({
      where: { email, organizationId: caller.organizationId },
    });
    if (existingUser) {
      return error(res, 'A user with this email already exists in your organization', 400);
    }

    // Determine managerId
    const managerId = caller.role === 'manager' ? caller.id : (req.body.managerId || null);

    // Generate fresh secure token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hours

    // Delete any previous invitation (pending, accepted, or expired) so we can create a fresh one
    await prisma.invitation.deleteMany({
      where: { organizationId: caller.organizationId, email },
    });

    const invitation = await prisma.invitation.create({
      data: {
        organizationId: caller.organizationId,
        email,
        role,
        invitedById: caller.id,
        managerId,
        token,
        status: 'pending',
        expiresAt,
      },
    });

    // Send invitation email — fire and forget so SMTP delays never block the response
    const inviteLink = `${config.frontendUrl}/auth/accept-invite?token=${token}`;
    const org = await prisma.organization.findUnique({ where: { id: caller.organizationId }, select: { name: true } });
    emailService.sendInvitationEmail({
      inviterName: caller.name,
      inviterRole: caller.role,
      inviteeEmail: email,
      inviteeRole: role,
      organizationName: org ? org.name : caller.organizationId,
      invitationLink: inviteLink,
      expiresAt: new Date(expiresAt).toLocaleString(),
    }).catch(emailErr => logger.warn('Invitation email failed (non-fatal)', { error: emailErr.message }));

    logger.info('Invitation sent', { invitationId: invitation.id, email, role, sentBy: caller.id });

    return success(res, {
      id: invitation.id,
      email,
      role,
      expiresAt,
      inviteLink: config.env !== 'production' ? inviteLink : undefined,
    }, 'Invitation sent successfully', 201);
  } catch (err) {
    logger.error('sendInvitation error', { error: err.message, stack: err.stack });
    const msg = process.env.NODE_ENV !== 'production' ? `Failed to send invitation: ${err.message}` : 'Failed to send invitation';
    return error(res, msg, 500);
  }
}

/**
 * POST /api/invitations/accept  (public — no auth required)
 * Accept an invitation and create / activate the user account.
 */
async function acceptInvitation(req, res) {
  try {
    const { token, name, password } = req.body;

    if (!token) return error(res, 'Invitation token is required', 400);
    if (!password) return error(res, 'Password is required', 400);
    if (!name) return error(res, 'Name is required', 400);

    // Find valid invitation
    const invitation = await prisma.invitation.findFirst({
      where: {
        token,
        status: 'pending',
        expiresAt: { gt: new Date() },
      },
    });

    if (!invitation) {
      return error(res, 'Invitation is invalid or expired', 400);
    }

    const { email, role, organizationId, managerId } = invitation;
    const passwordHash = await bcrypt.hash(password, 12);

    let user = await prisma.user.findUnique({ where: { email } });

    if (user) {
      // Reactivate existing user account
      user = await prisma.user.update({
        where: { id: user.id },
        data: { organizationId, role, managerId, isActive: true, passwordHash },
      });
    } else {
      // Create new user
      user = await prisma.user.create({
        data: { name, email, passwordHash, role, organizationId, managerId, isActive: true },
      });
    }

    // Mark invitation as accepted
    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'accepted' },
    });

    const { accessToken, refreshToken } = generateTokens(user.id);
    await prisma.user.update({
      where: { id: user.id },
      data: { refreshToken, lastLoginAt: new Date() },
    });

    const organization = await prisma.organization.findUnique({ where: { id: organizationId } });

    // Send welcome email — fire and forget
    emailService.sendWelcomeEmail({
      userName: user.name,
      userEmail: user.email,
      organizationName: organization ? organization.name : organizationId,
      role: user.role,
    }).catch(emailErr => logger.warn('Welcome email failed (non-fatal)', { error: emailErr.message }));

    logger.info('Invitation accepted', { userId: user.id, email });

    return success(res, {
      accessToken,
      refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, organization },
    }, 'Account created successfully', 201);
  } catch (err) {
    logger.error('acceptInvitation error', { error: err.message });
    return error(res, 'Failed to accept invitation', 500);
  }
}

/**
 * GET /api/invitations
 * org_admin → all invitations for the org
 * manager   → only invitations they sent
 */
async function getInvitations(req, res) {
  try {
    const caller = req.user;
    const where = { organizationId: caller.organizationId, status: 'pending' };

    if (caller.role === 'manager') {
      where.invitedById = caller.id;
    }

    const invitations = await prisma.invitation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        invitedBy: { select: { id: true, name: true, email: true } },
      },
    });

    return success(res, invitations);
  } catch (err) {
    logger.error('getInvitations error', { error: err.message });
    return error(res, 'Failed to fetch invitations', 500);
  }
}

/**
 * DELETE /api/invitations/:id
 * org_admin → can revoke any invitation
 * manager   → can only revoke their own invitations
 */
async function revokeInvitation(req, res) {
  try {
    const caller = req.user;
    const invitation = await prisma.invitation.findFirst({
      where: { id: req.params.id, organizationId: caller.organizationId },
    });

    if (!invitation) return error(res, 'Invitation not found', 404);

    // Managers can only revoke their own invitations
    if (caller.role === 'manager' && invitation.invitedById !== caller.id) {
      return error(res, 'You can only revoke your own invitations', 403);
    }
    if (caller.role === 'sales_user') {
      return error(res, 'Insufficient permissions', 403);
    }

    await prisma.invitation.update({
      where: { id: invitation.id },
      data: { status: 'expired' },
    });

    return success(res, null, 'Invitation revoked');
  } catch (err) {
    logger.error('revokeInvitation error', { error: err.message });
    return error(res, 'Failed to revoke invitation', 500);
  }
}

module.exports = { sendInvitation, acceptInvitation, getInvitations, revokeInvitation };

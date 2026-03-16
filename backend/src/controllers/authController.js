const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../utils/prisma');
const config = require('../config');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

const googleClient = new OAuth2Client(config.google.clientId);

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  const refreshToken = jwt.sign({ userId }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
  return { accessToken, refreshToken };
}

async function register(req, res) {
  try {
    const { name, email, password, orgName } = req.body;

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return error(res, 'Email already registered', 409);

    const slug = orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') + '-' + Date.now();
    const org = await prisma.organization.create({
      data: { name: orgName, slug, settings: {} },
    });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email, passwordHash, organizationId: org.id, role: 'org_admin' },
    });

    const { accessToken, refreshToken } = generateTokens(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken, lastLoginAt: new Date() } });

    logger.info('User registered', { userId: user.id, orgId: org.id });
    return success(res, {
      accessToken, refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, organization: org },
    }, 'Registration successful', 201);
  } catch (err) {
    logger.error('Register error', { err: err.message });
    return error(res, 'Registration failed', 500);
  }
}

async function login(req, res) {
  try {
    const { email, password } = req.body;
    console.log("Login attempt",req.body);
    const user = await prisma.user.findUnique({
      where: { email },
      // include: { organization: true },
    });

    console.log("user", user);

    if (!user || !user.passwordHash) return error(res, 'Invalid credentials', 401);
    if (!user.isActive) return error(res, 'Account disabled', 403);

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return error(res, 'Invalid credentials', 401);

    const { accessToken, refreshToken } = generateTokens(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken, lastLoginAt: new Date() } });

    return success(res, {
      accessToken, refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, organization: user.organization },
    });
  } catch (err) {
    logger.error('Login error', { err: err.message });
    return error(res, 'Login failed', 500);
  }
}

async function googleAuth(req, res) {
  try {
    const { credential } = req.body;
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: config.google.clientId });
    const payload = ticket.getPayload();

    let user = await prisma.user.findFirst({
      where: { OR: [{ googleId: payload.sub }, { email: payload.email }] },
      include: { organization: true },
    });

    if (!user) {
      const slug = payload.email.split('@')[0] + '-org-' + Date.now();
      const org = await prisma.organization.create({ data: { name: payload.name + "'s Org", slug, settings: {} } });
      user = await prisma.user.create({
        data: {
          name: payload.name,
          email: payload.email,
          googleId: payload.sub,
          avatarUrl: payload.picture,
          organizationId: org.id,
          role: 'org_admin',
        },
        include: { organization: true },
      });
    }

    if (!user.isActive) return error(res, 'Account disabled', 403);

    const { accessToken, refreshToken } = generateTokens(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken, lastLoginAt: new Date(), googleId: payload.sub } });

    return success(res, {
      accessToken, refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, organization: user.organization },
    });
  } catch (err) {
    logger.error('Google auth error', { err: err.message });
    return error(res, 'Google authentication failed', 500);
  }
}

async function refresh(req, res) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return error(res, 'Refresh token required', 401);

    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);
    const user = await prisma.user.findFirst({
      where: { id: decoded.userId, refreshToken },
      include: { organization: true },
    });
    if (!user) return error(res, 'Invalid refresh token', 401);

    const tokens = generateTokens(user.id);
    await prisma.user.update({ where: { id: user.id }, data: { refreshToken: tokens.refreshToken } });

    return success(res, {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, organization: user.organization },
    });
  } catch (err) {
    return error(res, 'Token refresh failed', 401);
  }
}

async function logout(req, res) {
  await prisma.user.update({ where: { id: req.user.id }, data: { refreshToken: null } });
  return success(res, null, 'Logged out');
}

async function me(req, res) {
  return success(res, {
    id: req.user.id,
    name: req.user.name,
    email: req.user.email,
    role: req.user.role,
    avatarUrl: req.user.avatarUrl,
    organization: req.user.organization,
    lastLoginAt: req.user.lastLoginAt,
  });
}

module.exports = { register, login, googleAuth, refresh, logout, me };

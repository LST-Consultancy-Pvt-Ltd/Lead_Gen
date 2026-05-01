const jwt = require('jsonwebtoken');
const config = require('../config');
const prisma = require('../utils/prisma');
const { error } = require('../utils/response');
const { authorizeRole } = require('./rbac');

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const token = authHeader?.startsWith('Bearer ')
      ? authHeader.split(' ')[1]
      : req.query.token;

    if (!token) {
      return error(res, 'No token provided', 401);
    }
    const decoded = jwt.verify(token, config.jwt.secret);
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { organization: true },
    });
    if (!user || !user.isActive) return error(res, 'Unauthorized', 401);

    // If role was changed AFTER this token was issued → force logout
    if (user.roleChangedAt) {
      const tokenIssuedAt = decoded.iat; // seconds
      const roleChangedAtSeconds = Math.floor(user.roleChangedAt.getTime() / 1000);
      if (roleChangedAtSeconds > tokenIssuedAt) {
        // Invalidate refresh token so auto-refresh also fails
        await prisma.user.update({
          where: { id: user.id },
          data: { refreshToken: null },
        });
        return error(res, 'Session invalidated. Your role was changed. Please log in again.', 401);
      }
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return error(res, 'Token expired', 401);
    return error(res, 'Invalid token', 401);
  }
};

const authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.role)) {
    return error(res, 'Insufficient permissions', 403);
  }
  next();
};

module.exports = { authenticate, authorize, authorizeRole };

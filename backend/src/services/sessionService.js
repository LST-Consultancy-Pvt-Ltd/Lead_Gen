/**
 * Per-device login sessions (like a Google account: one user, many devices).
 *
 * Every login creates a UserSession row. Its refresh token is rotated on each refresh
 * (only a SHA-256 hash is stored) and its 7-day window rolls forward each time.
 * Access and refresh tokens carry the session id (`sid`), so a device can be signed
 * out on its own (logout) while every other device stays signed in.
 */
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const prisma = require('../utils/prisma');
const config = require('../config');

// A rotated-out refresh token presented again normally ends that session (theft).
// Within this window after the last rotation it is almost certainly two tabs of the
// same browser racing, so the request is only rejected.
const REUSE_GRACE_MS = 30 * 1000;

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

function signTokens(userId, sessionId) {
  const accessToken = jwt.sign({ userId, sid: sessionId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  // jti keeps every rotated token unique, even when two are signed in the same second
  const refreshToken = jwt.sign({ userId, sid: sessionId }, config.jwt.refreshSecret, {
    expiresIn: config.jwt.refreshExpiresIn,
    jwtid: crypto.randomUUID(),
  });
  return { accessToken, refreshToken, expiresAt: new Date(jwt.decode(refreshToken).exp * 1000) };
}

/** Starts a new device session for a successful login. */
async function createSession(userId, req) {
  const sessionId = crypto.randomUUID();
  const { accessToken, refreshToken, expiresAt } = signTokens(userId, sessionId);
  await prisma.userSession.create({
    data: {
      id: sessionId,
      userId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: req?.headers?.['user-agent']?.slice(0, 255) || null,
    },
  });
  // housekeeping: drop this user's sessions whose refresh token has expired
  await prisma.userSession.deleteMany({ where: { userId, expiresAt: { lt: new Date() } } });
  return { accessToken, refreshToken };
}

/**
 * Replaces the session's refresh token with a new one (fresh 7-day window).
 * Compare-and-swap on the old hash: of several concurrent refreshes with the same
 * token, exactly one succeeds. Returns null when it lost the race.
 */
async function rotateSession(session, presentedToken) {
  const { accessToken, refreshToken, expiresAt } = signTokens(session.userId, session.id);
  const { count } = await prisma.userSession.updateMany({
    where: { id: session.id, refreshTokenHash: hashToken(presentedToken) },
    data: { refreshTokenHash: hashToken(refreshToken), expiresAt, lastUsedAt: new Date() },
  });
  return count === 1 ? { accessToken, refreshToken } : null;
}

/** True when the token is a replay of a token this session already rotated away from. */
function isReuse(session, presentedToken) {
  return session.refreshTokenHash !== hashToken(presentedToken);
}

/** Whether a reuse should end the session (outside the same-browser race window). */
function reuseEndsSession(session) {
  return Date.now() - session.lastUsedAt.getTime() > REUSE_GRACE_MS;
}

const revokeSession = (sessionId) => prisma.userSession.deleteMany({ where: { id: sessionId } });

/** Signs the user out on every device (role change, deactivation, password reset). */
const revokeAllSessions = (userId) => prisma.userSession.deleteMany({ where: { userId } });

module.exports = {
  createSession, rotateSession, isReuse, reuseEndsSession, revokeSession, revokeAllSessions, hashToken, REUSE_GRACE_MS,
};

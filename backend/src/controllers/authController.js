const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { OAuth2Client } = require('google-auth-library');
const prisma = require('../utils/prisma');
const config = require('../config');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');
const { seedDefaultDropdowns } = require('./dropdownController');

const googleClient = new OAuth2Client(config.google.clientId);

function generateTokens(userId) {
  const accessToken = jwt.sign({ userId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
  const refreshToken = jwt.sign({ userId }, config.jwt.refreshSecret, { expiresIn: config.jwt.refreshExpiresIn });
  return { accessToken, refreshToken };
}

function generateOtp() {
  return Math.floor(1000 + Math.random() * 9000).toString(); // 4-digit
}

async function sendOtpEmail(email, name, otp) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: Number(process.env.EMAIL_SERVER_PORT),
      secure: process.env.EMAIL_SERVER_SECURE === 'true',
      auth: { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD },
      family: 4,
      tls: { rejectUnauthorized: false, servername: process.env.EMAIL_SERVER_HOST },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 60000,
    });

    const html = `
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08);overflow:hidden;max-width:560px;">
      <tr><td style="background:#1a2e4a;padding:28px 40px;text-align:center;">
        <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">LeadForge <span style="color:#4f9ef8;">CRM</span></h1>
      </td></tr>
      <tr><td style="padding:36px 40px;">
        <p style="margin:0 0 12px;font-size:16px;color:#333;">Hi <strong>${name}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;color:#555;">Your email verification code is:</p>
        <div style="text-align:center;margin:24px 0;">
          <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#1a2e4a;background:#f0f4ff;padding:16px 28px;border-radius:10px;border:2px solid #dbe4ff;display:inline-block;">${otp}</span>
        </div>
        <p style="margin:16px 0 0;font-size:13px;color:#888;text-align:center;">Valid for <strong>10 minutes</strong>. Do not share this code.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 40px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#aaa;">&copy; 2026 LeadForge CRM</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>`;

    await transporter.sendMail({
      from: `"LeadForge CRM" <${process.env.EMAIL_FROM}>`,
      to: `"${name}" <${email}>`,
      subject: `${otp} is your LeadForge verification code`,
      text: `Hi ${name},\n\nYour OTP is: ${otp}\n\nValid for 10 minutes.`,
      html,
    });
    logger.info('OTP email sent', { email });
  } catch (err) {
    logger.error('OTP email failed', { email, err: err.message });
    throw err;
  }
}

// ── Step 1: Register → store pending data + send OTP ──────────────────────────
async function register(req, res) {
  try {
    const name = (req.body.name || '').trim();
    const email = (req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();
    const orgName = (req.body.orgName || '').trim();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return error(res, 'Email already registered', 409);

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const passwordHash = await bcrypt.hash(password, 12);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otpVerification.upsert({
      where: { email },
      create: { email, name, orgName, passwordHash, otpHash, expiresAt, attempts: 0 },
      update: { name, orgName, passwordHash, otpHash, expiresAt, attempts: 0 },
    });

    await sendOtpEmail(email, name, otp);

    logger.info('OTP sent for registration', { email });
    return success(res, { email }, 'OTP sent to your email. Please verify to complete registration.');
  } catch (err) {
    logger.error('Register error', { err: err.message });
    return error(res, 'Registration failed', 500);
  }
}

// ── Step 2: Verify OTP → create org + user, redirect to login ─────────────────
async function verifyOtp(req, res) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const otp = (req.body.otp || '').trim();

    const record = await prisma.otpVerification.findUnique({ where: { email } });
    if (!record) return error(res, 'No pending registration found. Please register again.', 404);

    if (record.attempts >= 5) {
      await prisma.otpVerification.delete({ where: { email } });
      return error(res, 'Too many wrong attempts. Please register again.', 429);
    }

    if (new Date() > record.expiresAt) {
      await prisma.otpVerification.delete({ where: { email } });
      return error(res, 'OTP has expired. Please register again.', 410);
    }

    const valid = await bcrypt.compare(otp, record.otpHash);
    if (!valid) {
      await prisma.otpVerification.update({
        where: { email },
        data: { attempts: record.attempts + 1 },
      });
      const remaining = 4 - record.attempts;
      return error(res, `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, 400);
    }

    // OTP correct — create organisation and user
    const slug = record.orgName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-') + '-' + Date.now();
    const org = await prisma.organization.create({
      data: { name: record.orgName, slug, settings: {} },
    });

    const user = await prisma.user.create({
      data: {
        name: record.name,
        email: record.email,
        passwordHash: record.passwordHash,
        organizationId: org.id,
        role: 'org_admin',
      },
    });

    await prisma.otpVerification.delete({ where: { email } });

    // Seed default dropdown values for the new org (non-blocking)
    seedDefaultDropdowns(org.id).catch(e =>
      logger.error('Failed to seed default dropdowns for new org', { orgId: org.id, err: e.message })
    );

    logger.info('User registered via OTP', { userId: user.id, orgId: org.id });
    return success(res, null, 'Email verified! You can now sign in.', 201);
  } catch (err) {
    logger.error('OTP verify error', { err: err.message });
    return error(res, 'Verification failed', 500);
  }
}

// ── Resend OTP ────────────────────────────────────────────────────────────────
async function resendOtp(req, res) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) return error(res, 'Email already registered', 409);

    const record = await prisma.otpVerification.findUnique({ where: { email } });
    if (!record) return error(res, 'No pending registration found. Please register again.', 404);

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.otpVerification.update({
      where: { email },
      data: { otpHash, expiresAt, attempts: 0 },
    });

    await sendOtpEmail(email, record.name, otp);

    logger.info('OTP resent', { email });
    return success(res, { email }, 'New OTP sent to your email.');
  } catch (err) {
    logger.error('Resend OTP error', { err: err.message });
    return error(res, 'Failed to resend OTP', 500);
  }
}

async function login(req, res) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const password = (req.body.password || '').trim();
    const user = await prisma.user.findUnique({ where: { email } });

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
      // Seed default dropdown values for the new org (non-blocking)
      seedDefaultDropdowns(org.id).catch(e =>
        logger.error('Failed to seed default dropdowns for Google org', { orgId: org.id, err: e.message })
      );
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

// ── Forgot Password → send OTP ────────────────────────────────────────────────
async function forgotPassword(req, res) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();

    const user = await prisma.user.findUnique({ where: { email } });
    // Always return success to avoid leaking user existence
    if (!user) {
      return success(res, null, 'If that email is registered, an OTP has been sent.');
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await prisma.passwordResetOtp.upsert({
      where: { email },
      create: { email, otpHash, expiresAt, attempts: 0 },
      update: { otpHash, expiresAt, attempts: 0, resetToken: null, tokenExpiresAt: null },
    });

    // Send OTP email
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: Number(process.env.EMAIL_SERVER_PORT),
      secure: process.env.EMAIL_SERVER_SECURE === 'true',
      auth: { user: process.env.EMAIL_SERVER_USER, pass: process.env.EMAIL_SERVER_PASSWORD },
      family: 4,
      tls: { rejectUnauthorized: false, servername: process.env.EMAIL_SERVER_HOST },
    });

    const html = `
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:40px 20px;">
    <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08);overflow:hidden;max-width:560px;">
      <tr><td style="background:#1a2e4a;padding:28px 40px;text-align:center;">
        <h1 style="margin:0;color:#fff;font-size:24px;font-weight:700;">LeadForge <span style="color:#4f9ef8;">CRM</span></h1>
      </td></tr>
      <tr><td style="padding:36px 40px;">
        <p style="margin:0 0 12px;font-size:16px;color:#333;">Hi <strong>${user.name}</strong>,</p>
        <p style="margin:0 0 24px;font-size:15px;color:#555;">We received a request to reset your password. Your verification code is:</p>
        <div style="text-align:center;margin:24px 0;">
          <span style="font-size:40px;font-weight:700;letter-spacing:12px;color:#1a2e4a;background:#f0f4ff;padding:16px 28px;border-radius:10px;border:2px solid #dbe4ff;display:inline-block;">${otp}</span>
        </div>
        <p style="margin:16px 0 0;font-size:13px;color:#888;text-align:center;">Valid for <strong>10 minutes</strong>. If you did not request this, ignore this email.</p>
      </td></tr>
      <tr><td style="background:#f8fafc;padding:16px 40px;text-align:center;">
        <p style="margin:0;font-size:12px;color:#aaa;">&copy; 2026 LeadForge CRM</p>
      </td></tr>
    </table>
  </td></tr></table>
</body>`;

    await transporter.sendMail({
      from: `"LeadForge CRM" <${process.env.EMAIL_FROM}>`,
      to: `"${user.name}" <${email}>`,
      subject: `${otp} is your LeadForge password reset code`,
      text: `Hi ${user.name},\n\nYour password reset OTP is: ${otp}\n\nValid for 10 minutes.`,
      html,
    });

    logger.info('Password reset OTP sent', { email });
    return success(res, null, 'If that email is registered, an OTP has been sent.');
  } catch (err) {
    logger.error('Forgot password error', { err: err.message });
    return error(res, 'Failed to send OTP', 500);
  }
}

// ── Verify Reset OTP → return short-lived reset token ─────────────────────────
async function verifyResetOtp(req, res) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const otp = (req.body.otp || '').trim();

    const record = await prisma.passwordResetOtp.findUnique({ where: { email } });
    if (!record) return error(res, 'No password reset request found. Please request again.', 404);

    if (record.attempts >= 5) {
      await prisma.passwordResetOtp.delete({ where: { email } });
      return error(res, 'Too many wrong attempts. Please request a new OTP.', 429);
    }

    if (new Date() > record.expiresAt) {
      await prisma.passwordResetOtp.delete({ where: { email } });
      return error(res, 'OTP has expired. Please request a new one.', 410);
    }

    const valid = await bcrypt.compare(otp, record.otpHash);
    if (!valid) {
      await prisma.passwordResetOtp.update({
        where: { email },
        data: { attempts: record.attempts + 1 },
      });
      const remaining = 4 - record.attempts;
      return error(res, `Incorrect OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`, 400);
    }

    // OTP correct — issue a short-lived reset token (valid 15 min)
    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiresAt = new Date(Date.now() + 15 * 60 * 1000);

    await prisma.passwordResetOtp.update({
      where: { email },
      data: { resetToken, tokenExpiresAt, attempts: 0 },
    });

    logger.info('Reset OTP verified', { email });
    return success(res, { resetToken }, 'OTP verified. You may now reset your password.');
  } catch (err) {
    logger.error('Verify reset OTP error', { err: err.message });
    return error(res, 'Verification failed', 500);
  }
}

// ── Reset Password ─────────────────────────────────────────────────────────────
async function resetPassword(req, res) {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    const { resetToken, newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return error(res, 'Password must be at least 8 characters.', 400);
    }

    const record = await prisma.passwordResetOtp.findUnique({ where: { email } });
    if (!record || !record.resetToken) {
      return error(res, 'Invalid or expired reset request. Please start over.', 400);
    }

    if (record.resetToken !== resetToken) {
      return error(res, 'Invalid reset token.', 400);
    }

    if (!record.tokenExpiresAt || new Date() > record.tokenExpiresAt) {
      await prisma.passwordResetOtp.delete({ where: { email } });
      return error(res, 'Reset session has expired. Please request a new OTP.', 410);
    }

    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { email }, data: { passwordHash } });
    await prisma.passwordResetOtp.delete({ where: { email } });

    logger.info('Password reset successful', { email });
    return success(res, null, 'Password updated successfully. You can now sign in.');
  } catch (err) {
    logger.error('Reset password error', { err: err.message });
    return error(res, 'Password reset failed', 500);
  }
}

module.exports = { register, verifyOtp, resendOtp, login, googleAuth, refresh, logout, me, forgotPassword, verifyResetOtp, resetPassword };

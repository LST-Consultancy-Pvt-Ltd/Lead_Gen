const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');
const prisma = require('../utils/prisma');

async function createTransporter() {
  if (config.sendgrid.apiKey) {
    return nodemailer.createTransport({
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: { user: 'apikey', pass: config.sendgrid.apiKey },
    });
  }
  // Dev fallback — log to console
  return nodemailer.createTransport({ jsonTransport: true });
}

async function sendEmail({ toEmail, toName, subject, body, leadId, campaignId, sentById, organizationId }) {
  const log = await prisma.emailLog.create({
    data: {
      toEmail,
      toName,
      subject,
      body,
      leadId,
      campaignId,
      sentById,
      organizationId,
      status: 'queued',
      provider: config.sendgrid.apiKey ? 'sendgrid' : 'console',
    },
  });

  try {
    const transporter = await createTransporter();

    if (!config.sendgrid.apiKey) {
      logger.info('Email (dev mode — not actually sent)', { to: toEmail, subject });
    } else {
      await transporter.sendMail({
        from: `"${config.sendgrid.fromName}" <${config.sendgrid.fromEmail}>`,
        to: toName ? `"${toName}" <${toEmail}>` : toEmail,
        subject,
        text: body,
        html: body.replace(/\n/g, '<br>'),
        headers: { 'X-LeadForge-LogId': log.id },
      });
    }

    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'sent' },
    });

    // Update lead lastContactedAt
    if (leadId) {
      await prisma.lead.update({
        where: { id: leadId },
        data: { lastContactedAt: new Date(), status: 'contacted' },
      });
    }

    return { success: true, logId: log.id };
  } catch (err) {
    logger.error('Email send failed', { err: err.message, toEmail });
    await prisma.emailLog.update({
      where: { id: log.id },
      data: { status: 'failed' },
    });
    throw err;
  }
}

async function trackEmailOpen(logId) {
  await prisma.emailLog.updateMany({
    where: { id: logId, openedAt: null },
    data: { openedAt: new Date(), status: 'opened' },
  });
}

async function trackEmailReply(messageId) {
  await prisma.emailLog.updateMany({
    where: { messageId, repliedAt: null },
    data: { repliedAt: new Date(), status: 'replied' },
  });
}

// ─── Role label helper ──────────────────────────────────────────────────────
function roleLabel(role) {
  const map = {
    org_admin: 'Admin',
    super_admin: 'Super Admin',
    manager: 'Sales Manager',
    sales_user: 'Lead Generation Executive',
  };
  return map[role] || role;
}

// ─── Base SMTP sendEmail (nodemailer pattern) ────────────────────────────────
async function sendSmtpEmail({ name, email, subject, txt, html }) {
  try {
    const transporter = nodemailer.createTransport({
      host: process.env.EMAIL_SERVER_HOST,
      port: Number(process.env.EMAIL_SERVER_PORT) || 587,
      secure: process.env.EMAIL_SERVER_SECURE === 'true',
      auth: {
        user: process.env.EMAIL_SERVER_USER,
        pass: process.env.EMAIL_SERVER_PASSWORD,
      },
      connectionTimeout: 5000,
      greetingTimeout: 15000,
      socketTimeout: 30000,
    });
    console.log(`[emailService] Sending to ${email} via ${process.env.EMAIL_SERVER_HOST}:${process.env.EMAIL_SERVER_PORT}`);
    const result = await transporter.sendMail({
      from: `"${name}" <${process.env.EMAIL_FROM}>`,
      to: email,
      subject,
      text: txt,
      html,
    });
    return result;
  } catch (err) {
    console.error('[emailService] SMTP send error:', err.message);
  }
}

// ─── Invitation email ────────────────────────────────────────────────────────
async function sendInvitationEmail({
  inviterName,
  inviterRole,
  inviteeEmail,
  inviteeRole,
  organizationName,
  invitationLink,
  expiresAt,
}) {
  try {
    const html = `
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="background:#ffffff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08);overflow:hidden;max-width:600px;">
          <!-- Header -->
          <tr>
            <td style="background:#1a2e4a;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#ffffff;font-size:26px;font-weight:700;letter-spacing:-0.5px;">
                LeadForge <span style="color:#4f9ef8;">CRM</span>
              </h1>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding:40px;">
              <p style="margin:0 0 24px;font-size:16px;color:#333;line-height:1.6;">
                You have been invited to join <strong>${organizationName}</strong> on LeadForge CRM.
              </p>
              <!-- Details card -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#f8fafc;border-radius:8px;margin-bottom:32px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <table width="100%" cellpadding="0" cellspacing="8" border="0">
                      <tr>
                        <td style="font-size:13px;color:#6b7280;padding:8px 0;border-bottom:1px solid #e5e7eb;">
                          <strong style="color:#374151;">Invited By</strong>
                        </td>
                        <td style="font-size:13px;color:#374151;padding:8px 0;border-bottom:1px solid #e5e7eb;text-align:right;">
                          ${inviterName} &mdash; <em>${roleLabel(inviterRole)}</em>
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#6b7280;padding:8px 0;">
                          <strong style="color:#374151;">Your Role</strong>
                        </td>
                        <td style="font-size:13px;color:#374151;padding:8px 0;text-align:right;">
                          ${roleLabel(inviteeRole)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
              <!-- CTA button -->
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:24px;">
                <tr>
                  <td align="center">
                    <a href="${invitationLink}"
                      style="display:inline-block;background:#2563eb;color:#ffffff;font-size:16px;font-weight:600;
                             text-decoration:none;padding:14px 40px;border-radius:8px;letter-spacing:0.3px;">
                      Accept Invitation
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 8px;font-size:13px;color:#6b7280;text-align:center;">
                This invitation expires at <strong>${expiresAt}</strong>
              </p>
              <p style="margin:0 0 24px;font-size:12px;color:#9ca3af;text-align:center;">
                If the button doesn&apos;t work, copy and paste this link into your browser:<br>
                <a href="${invitationLink}" style="color:#2563eb;word-break:break-all;">${invitationLink}</a>
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">
                This is an automated message from LeadForge CRM. Please do not reply to this email.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;

    await sendSmtpEmail({
      name: 'LeadForge CRM',
      email: inviteeEmail,
      subject: `You've been invited to join ${organizationName} on LeadForge CRM`,
      txt: `You have been invited to join ${organizationName} on LeadForge CRM as ${roleLabel(inviteeRole)}. Accept here: ${invitationLink}`,
      html,
    });
  } catch (err) {
    console.error('[emailService] sendInvitationEmail error:', err.message);
  }
}

// ─── Lead assignment email ───────────────────────────────────────────────────
async function sendLeadAssignmentEmail({
  assigneeName,
  assigneeEmail,
  assignerName,
  leadCompanyName,
  leadContactName,
  leadSource,
  followUpDate,
  dashboardLink,
}) {
  try {
    const html = `
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="background:#ffffff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;">
          <tr>
            <td style="background:#1a2e4a;padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">LeadForge <span style="color:#4f9ef8;">CRM</span></h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <h2 style="margin:0 0 8px;font-size:20px;color:#1a2e4a;">A new lead has been assigned to you</h2>
              <p style="margin:0 0 28px;font-size:14px;color:#6b7280;">Assigned by <strong>${assignerName}</strong></p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0"
                style="background:#f8fafc;border-radius:8px;margin-bottom:28px;">
                <tr><td style="padding:20px 24px;">
                  <table width="100%" cellpadding="6" cellspacing="0" border="0">
                    <tr>
                      <td style="font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Company</td>
                      <td style="font-size:13px;color:#374151;font-weight:600;text-align:right;border-bottom:1px solid #e5e7eb;">${leadCompanyName || '—'}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Contact</td>
                      <td style="font-size:13px;color:#374151;text-align:right;border-bottom:1px solid #e5e7eb;">${leadContactName || '—'}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;border-bottom:1px solid #e5e7eb;">Source</td>
                      <td style="font-size:13px;color:#374151;text-align:right;border-bottom:1px solid #e5e7eb;">${leadSource || '—'}</td>
                    </tr>
                    <tr>
                      <td style="font-size:13px;color:#6b7280;">Follow Up Date</td>
                      <td style="font-size:13px;color:#374151;text-align:right;">${followUpDate ? new Date(followUpDate).toLocaleDateString() : '—'}</td>
                    </tr>
                  </table>
                </td></tr>
              </table>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center">
                  <a href="${dashboardLink}"
                    style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:600;
                           text-decoration:none;padding:13px 36px;border-radius:8px;">
                    View Lead
                  </a>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated message from LeadForge CRM. Please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;

    await sendSmtpEmail({
      name: 'LeadForge CRM',
      email: assigneeEmail,
      subject: `New Lead Assigned: ${leadCompanyName}`,
      txt: `Hi ${assigneeName}, a new lead (${leadCompanyName}) has been assigned to you by ${assignerName}. View it here: ${dashboardLink}`,
      html,
    });
  } catch (err) {
    console.error('[emailService] sendLeadAssignmentEmail error:', err.message);
  }
}

// ─── Lead reminder email ─────────────────────────────────────────────────────
async function sendLeadReminderEmail({
  userName,
  userEmail,
  leadCompanyName,
  followUpDate,
  dashboardLink,
}) {
  try {
    const html = `
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="background:#ffffff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;">
          <tr>
            <td style="background:#92400e;padding:28px 40px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:22px;font-weight:700;">&#9888; Follow-up Reminder</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:36px 40px;">
              <h2 style="margin:0 0 16px;font-size:20px;color:#1a2e4a;">You have a follow-up due</h2>
              <p style="margin:0 0 8px;font-size:15px;color:#374151;">Hi <strong>${userName}</strong>,</p>
              <p style="margin:0 0 28px;font-size:14px;color:#6b7280;">
                A follow-up is due for lead <strong>${leadCompanyName}</strong> on
                <strong>${followUpDate ? new Date(followUpDate).toLocaleDateString() : '—'}</strong>.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td align="center">
                  <a href="${dashboardLink}"
                    style="display:inline-block;background:#d97706;color:#fff;font-size:15px;font-weight:600;
                           text-decoration:none;padding:13px 36px;border-radius:8px;">
                    View Lead
                  </a>
                </td></tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:16px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated message from LeadForge CRM. Please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;

    await sendSmtpEmail({
      name: 'LeadForge CRM',
      email: userEmail,
      subject: `Follow-up Reminder: ${leadCompanyName}`,
      txt: `Hi ${userName}, you have a follow-up due for ${leadCompanyName} on ${followUpDate}. View it: ${dashboardLink}`,
      html,
    });
  } catch (err) {
    console.error('[emailService] sendLeadReminderEmail error:', err.message);
  }
}

// ─── Welcome email ───────────────────────────────────────────────────────────
async function sendWelcomeEmail({ userName, userEmail, organizationName, role }) {
  try {
    const dashboardLink = `${process.env.FRONTEND_URL}/dashboard`;
    const html = `
<body style="margin:0;padding:0;background:#f0f2f5;font-family:Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0">
    <tr>
      <td align="center" style="padding:40px 20px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0"
          style="background:#ffffff;border-radius:12px;box-shadow:0 4px 16px rgba(0,0,0,0.08);max-width:600px;">
          <tr>
            <td style="background:#1a2e4a;padding:32px 40px;text-align:center;">
              <h1 style="margin:0;color:#fff;font-size:26px;font-weight:700;">LeadForge <span style="color:#4f9ef8;">CRM</span></h1>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;text-align:center;">
              <p style="font-size:40px;margin:0 0 16px;">&#127881;</p>
              <h2 style="margin:0 0 12px;font-size:24px;color:#1a2e4a;">Welcome to LeadForge CRM</h2>
              <p style="margin:0 0 28px;font-size:15px;color:#6b7280;line-height:1.6;">
                Hi <strong>${userName}</strong>, you have successfully joined
                <strong>${organizationName}</strong> as a <strong>${roleLabel(role)}</strong>.
              </p>
              <a href="${dashboardLink}"
                style="display:inline-block;background:#2563eb;color:#fff;font-size:15px;font-weight:600;
                       text-decoration:none;padding:14px 40px;border-radius:8px;">
                Go to Dashboard
              </a>
            </td>
          </tr>
          <tr>
            <td style="background:#f8fafc;padding:20px 40px;text-align:center;border-top:1px solid #e5e7eb;">
              <p style="margin:0;font-size:12px;color:#9ca3af;">This is an automated message from LeadForge CRM. Please do not reply.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>`;

    await sendSmtpEmail({
      name: 'LeadForge CRM',
      email: userEmail,
      subject: 'Welcome to LeadForge CRM',
      txt: `Welcome to LeadForge CRM, ${userName}! You have joined ${organizationName} as ${roleLabel(role)}. Go to dashboard: ${dashboardLink}`,
      html,
    });
  } catch (err) {
    console.error('[emailService] sendWelcomeEmail error:', err.message);
  }
}

module.exports = {
  sendEmail,
  trackEmailOpen,
  trackEmailReply,
  sendInvitationEmail,
  sendLeadAssignmentEmail,
  sendLeadReminderEmail,
  sendWelcomeEmail,
};

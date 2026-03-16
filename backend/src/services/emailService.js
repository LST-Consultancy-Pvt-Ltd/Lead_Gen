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

module.exports = { sendEmail, trackEmailOpen, trackEmailReply };

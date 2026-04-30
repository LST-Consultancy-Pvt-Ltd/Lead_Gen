/**
 * leadQuota.js
 * Centralised helpers for lead-quota enforcement.
 * Every place that creates or deletes leads should use these.
 */

const prisma = require('./prisma');
const logger = require('./logger');

/**
 * Check whether the organisation still has remaining lead quota.
 * @param {string} organizationId
 * @param {number} [needed=1]  How many leads we want to create.
 * @returns {{ allowed: boolean, remaining: number, quota: number, used: number }}
 */
async function checkLeadQuota(organizationId, needed = 1) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { leadQuota: true, leadUsed: true },
  });

  if (!org) {
    return { allowed: false, remaining: 0, quota: 0, used: 0 };
  }

  const remaining = Math.max(0, org.leadQuota - org.leadUsed);
  return {
    allowed: remaining >= needed,
    remaining,
    quota: org.leadQuota,
    used: org.leadUsed,
  };
}

/**
 * Increment the organisation's leadUsed counter after creating leads.
 * @param {string} organizationId
 * @param {number} [count=1]
 */
async function incrementLeadUsage(organizationId, count = 1) {
  try {
    await prisma.organization.update({
      where: { id: organizationId },
      data: { leadUsed: { increment: count } },
    });
  } catch (err) {
    logger.error('incrementLeadUsage failed', { organizationId, count, err: err.message });
  }
}

/**
 * Decrement the organisation's leadUsed counter after deleting leads.
 * Ensures the counter never goes below 0.
 * @param {string} organizationId
 * @param {number} [count=1]
 */
async function decrementLeadUsage(organizationId, count = 1) {
  try {
    const org = await prisma.organization.findUnique({
      where: { id: organizationId },
      select: { leadUsed: true },
    });
    if (!org) return;

    const newValue = Math.max(0, org.leadUsed - count);
    await prisma.organization.update({
      where: { id: organizationId },
      data: { leadUsed: newValue },
    });
  } catch (err) {
    logger.error('decrementLeadUsage failed', { organizationId, count, err: err.message });
  }
}

/**
 * Get the current quota info for an organisation (useful for API/frontend).
 * @param {string} organizationId
 * @returns {{ quota: number, used: number, remaining: number }}
 */
async function getQuotaInfo(organizationId) {
  const org = await prisma.organization.findUnique({
    where: { id: organizationId },
    select: { leadQuota: true, leadUsed: true },
  });
  if (!org) return { quota: 0, used: 0, remaining: 0 };
  return {
    quota: org.leadQuota,
    used: org.leadUsed,
    remaining: Math.max(0, org.leadQuota - org.leadUsed),
  };
}

module.exports = { checkLeadQuota, incrementLeadUsage, decrementLeadUsage, getQuotaInfo };

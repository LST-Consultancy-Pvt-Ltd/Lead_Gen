const prisma = require('./prisma');

const CLOSED_STAGES = ['closed_won', 'closed_lost'];

/**
 * Open opportunities follow their lead's owner. Pipeline metrics count
 * Opportunity.assignedToId, so without this a reassigned lead's deals stay
 * credited to the previous owner. Closed deals keep the owner who closed them.
 * Returns the number of opportunities updated.
 */
async function syncOpenOpportunityOwner(leadIds, assignedToId) {
  if (!assignedToId || !Array.isArray(leadIds) || leadIds.length === 0) return 0;
  const { count } = await prisma.opportunity.updateMany({
    where: { leadId: { in: leadIds }, stage: { notIn: CLOSED_STAGES } },
    data: { assignedToId },
  });
  return count;
}

module.exports = { syncOpenOpportunityOwner };

/**
 * searchController.js
 * Global search across Leads, Contacts, Accounts, and Opportunities.
 * RBAC: same scoping rules applied in each entity's own controller/service.
 *   - sales_user → only records assigned to themselves
 *   - manager    → their team's records
 *   - admin      → all org records
 *
 * GET /api/search?q=<term>&limit=5
 * Returns: { leads[], contacts[], accounts[], opportunities[] }
 */

const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');
const { buildOrganizationFilter, MANAGER_AND_ABOVE } = require('../middleware/rbac');
const logger = require('../utils/logger');

async function globalSearch(req, res) {
  try {
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return error(res, 'Search query must be at least 2 characters', 400);
    }

    const limit = Math.min(parseInt(req.query.limit) || 5, 20);
    const user = req.user;

    // Build the org-scoped base filter once
    const baseFilter = await buildOrganizationFilter(user);
    const orgId = baseFilter.organizationId;

    // ── RBAC: determine which user IDs are visible ───────────────────────────
    // For leads/opportunities: assignedToId restriction
    const assignedFilter = baseFilter.assignedToId
      ? { assignedToId: baseFilter.assignedToId }
      : {};

    // For accounts: ownership via accountOwnerId
    const accountOwnerFilter = baseFilter.assignedToId
      ? { accountOwnerId: baseFilter.assignedToId }
      : {};

    // For contacts: ownership via ownerId
    const contactOwnerFilter = baseFilter.assignedToId
      ? { ownerId: baseFilter.assignedToId }
      : {};

    // ── Run all 4 searches in parallel ──────────────────────────────────────
    const [leads, contacts, accounts, opportunities] = await Promise.all([

      // Leads
      prisma.lead.findMany({
        where: {
          organizationId: orgId,
          ...assignedFilter,
          OR: [
            { companyName: { contains: q, mode: 'insensitive' } },
            { contactName: { contains: q, mode: 'insensitive' } },
            { contactEmail: { contains: q, mode: 'insensitive' } },
            { industry: { contains: q, mode: 'insensitive' } },
            { website: { contains: q, mode: 'insensitive' } },
            { firstName: { contains: q, mode: 'insensitive' } },
            { lastName: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          companyName: true,
          contactName: true,
          contactEmail: true,
          status: true,
          intentLevel: true,
          assignedTo: { select: { id: true, name: true } },
        },
      }),

      // Contacts
      prisma.contact.findMany({
        where: {
          organizationId: orgId,
          ...contactOwnerFilter,
          OR: [
            { name: { contains: q, mode: 'insensitive' } },
            { email: { contains: q, mode: 'insensitive' } },
            { designation: { contains: q, mode: 'insensitive' } },
            { phone: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          name: true,
          email: true,
          designation: true,
          linkedAccount: { select: { id: true, companyName: true } },
        },
      }),

      // Accounts
      prisma.account.findMany({
        where: {
          organizationId: orgId,
          ...accountOwnerFilter,
          OR: [
            { companyName: { contains: q, mode: 'insensitive' } },
            { industry: { contains: q, mode: 'insensitive' } },
            { website: { contains: q, mode: 'insensitive' } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          companyName: true,
          industry: true,
          website: true,
          customerType: true,
        },
      }),

      // Opportunities
      prisma.opportunity.findMany({
        where: {
          organizationId: orgId,
          ...assignedFilter,
          OR: [
            { title: { contains: q, mode: 'insensitive' } },
            { opportunityName: { contains: q, mode: 'insensitive' } },
            { businessLine: { contains: q, mode: 'insensitive' } },
            { lead: { companyName: { contains: q, mode: 'insensitive' } } },
          ],
        },
        take: limit,
        orderBy: { updatedAt: 'desc' },
        select: {
          id: true,
          title: true,
          stage: true,
          dealValue: true,
          lead: { select: { id: true, companyName: true } },
          assignedTo: { select: { id: true, name: true } },
        },
      }),
    ]);

    return success(res, {
      query: q,
      results: {
        leads,
        contacts,
        accounts,
        opportunities,
      },
      counts: {
        leads: leads.length,
        contacts: contacts.length,
        accounts: accounts.length,
        opportunities: opportunities.length,
        total: leads.length + contacts.length + accounts.length + opportunities.length,
      },
    });
  } catch (err) {
    logger.error('globalSearch error', { error: err.message, userId: req.user?.id });
    return error(res, 'Search failed', 500);
  }
}

module.exports = { globalSearch };

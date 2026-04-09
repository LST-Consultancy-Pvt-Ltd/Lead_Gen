/**
 * accounts.controller.js
 * CRUD for Account model with hierarchy-aware RBAC
 */

const prisma = require('../utils/prisma');
const { buildOrganizationFilter } = require('../middleware/rbac');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

async function getAccounts(req, res) {
  try {
    const { page = 1, limit = 20, search, customerType } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const baseFilter = await buildOrganizationFilter(req.user);
    // For accounts, ownership is via accountOwnerId
    const where = { organizationId: baseFilter.organizationId };
    if (baseFilter.assignedToId) {
      where.accountOwnerId = baseFilter.assignedToId;
    }
    if (customerType) where.customerType = customerType;
    if (search) {
      where.OR = [
        { companyName: { contains: search, mode: 'insensitive' } },
        { industry: { contains: search, mode: 'insensitive' } },
        { website: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [accounts, total] = await Promise.all([
      prisma.account.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          accountOwner: { select: { id: true, name: true, email: true } },
          _count: { select: { contacts: true, opportunities: true } },
        },
      }),
      prisma.account.count({ where }),
    ]);

    return res.json({
      success: true,
      data: accounts,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    logger.error('getAccounts error', { error: err.message });
    return error(res, 'Failed to fetch accounts', 500);
  }
}

async function getAccountById(req, res) {
  try {
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        accountOwner: { select: { id: true, name: true, email: true } },
        contacts: true,
        opportunities: { include: { salesOwner: { select: { id: true, name: true } } } },
      },
    });

    if (!account) return error(res, 'Account not found', 404);

    // Scope check for non-admin roles
    if (req.user.role === 'sales_user' && account.accountOwnerId !== req.user.id) {
      return error(res, 'Access denied', 403);
    }

    return success(res, account);
  } catch (err) {
    logger.error('getAccountById error', { error: err.message });
    return error(res, 'Failed to fetch account', 500);
  }
}

async function createAccount(req, res) {
  try {
    const data = req.body;
    let accountOwnerId = data.accountOwnerId || req.user.id;

    if (req.user.role === 'sales_user') {
      accountOwnerId = req.user.id;
    } else if (req.user.role === 'manager' && data.accountOwnerId) {
      const isTeamMember = await prisma.user.findFirst({
        where: { id: data.accountOwnerId, managerId: req.user.id, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (!isTeamMember) accountOwnerId = req.user.id;
    }

    const account = await prisma.account.create({
      data: {
        ...data,
        organizationId: req.user.organizationId,
        createdById: req.user.id,
        accountOwnerId,
      },
      include: { accountOwner: { select: { id: true, name: true, email: true } } },
    });

    return success(res, account, 'Account created', 201);
  } catch (err) {
    logger.error('createAccount error', { error: err.message });
    return error(res, 'Failed to create account', 500);
  }
}

async function updateAccount(req, res) {
  try {
    const account = await prisma.account.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!account) return error(res, 'Account not found', 404);

    if (req.user.role === 'sales_user' && account.accountOwnerId !== req.user.id) {
      return error(res, 'Access denied', 403);
    }

    const updateData = { ...req.body };
    delete updateData.organizationId;
    delete updateData.createdById;
    delete updateData.id;

    // Validate reassignment
    if (updateData.accountOwnerId) {
      if (req.user.role === 'sales_user') {
        delete updateData.accountOwnerId;
      } else if (req.user.role === 'manager') {
        const isTeamMember = await prisma.user.findFirst({
          where: { id: updateData.accountOwnerId, managerId: req.user.id, organizationId: req.user.organizationId },
          select: { id: true },
        });
        if (!isTeamMember) delete updateData.accountOwnerId;
      }
    }

    const updated = await prisma.account.update({
      where: { id: req.params.id },
      data: updateData,
      include: { accountOwner: { select: { id: true, name: true, email: true } } },
    });

    return success(res, updated, 'Account updated');
  } catch (err) {
    logger.error('updateAccount error', { error: err.message });
    return error(res, 'Failed to update account', 500);
  }
}

async function deleteAccount(req, res) {
  try {
    if (!['org_admin', 'super_admin'].includes(req.user.role)) {
      return error(res, 'Only admins can delete accounts', 403);
    }

    const account = await prisma.account.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!account) return error(res, 'Account not found', 404);

    await prisma.account.delete({ where: { id: req.params.id } });
    return success(res, null, 'Account deleted');
  } catch (err) {
    logger.error('deleteAccount error', { error: err.message });
    return error(res, 'Failed to delete account', 500);
  }
}

module.exports = { getAccounts, getAccountById, createAccount, updateAccount, deleteAccount };

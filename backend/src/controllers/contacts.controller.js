/**
 * contacts.controller.js
 * CRUD for Contact model with hierarchy-aware RBAC
 */

const prisma = require('../utils/prisma');
const { buildOrganizationFilter } = require('../middleware/rbac');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

async function getContacts(req, res) {
  try {
    const { page = 1, limit = 20, search, accountId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const baseFilter = await buildOrganizationFilter(req.user);
    const where = { organizationId: baseFilter.organizationId };
    if (baseFilter.assignedToId) {
      where.ownerId = baseFilter.assignedToId;
    }
    if (accountId) where.linkedAccountId = accountId;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { designation: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [contacts, total] = await Promise.all([
      prisma.contact.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          owner: { select: { id: true, name: true, email: true } },
          linkedAccount: { select: { id: true, companyName: true } },
        },
      }),
      prisma.contact.count({ where }),
    ]);

    return res.json({
      success: true,
      data: contacts,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) },
    });
  } catch (err) {
    logger.error('getContacts error', { error: err.message });
    return error(res, 'Failed to fetch contacts', 500);
  }
}

async function getContactById(req, res) {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        linkedAccount: { select: { id: true, companyName: true } },
        opportunities: true,
      },
    });

    if (!contact) return error(res, 'Contact not found', 404);

    if (req.user.role === 'sales_user' && contact.ownerId !== req.user.id) {
      return error(res, 'Access denied', 403);
    }

    return success(res, contact);
  } catch (err) {
    logger.error('getContactById error', { error: err.message });
    return error(res, 'Failed to fetch contact', 500);
  }
}

async function createContact(req, res) {
  try {
    const data = req.body;
    let ownerId = data.ownerId || req.user.id;

    if (req.user.role === 'sales_user') {
      ownerId = req.user.id;
    } else if (req.user.role === 'manager' && data.ownerId) {
      const isTeamMember = await prisma.user.findFirst({
        where: { id: data.ownerId, managerId: req.user.id, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (!isTeamMember) ownerId = req.user.id;
    }

    const contact = await prisma.contact.create({
      data: {
        ...data,
        organizationId: req.user.organizationId,
        createdById: req.user.id,
        ownerId,
      },
      include: { owner: { select: { id: true, name: true, email: true } } },
    });

    return success(res, contact, 'Contact created', 201);
  } catch (err) {
    logger.error('createContact error', { error: err.message });
    return error(res, 'Failed to create contact', 500);
  }
}

async function updateContact(req, res) {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!contact) return error(res, 'Contact not found', 404);

    if (req.user.role === 'sales_user' && contact.ownerId !== req.user.id) {
      return error(res, 'Access denied', 403);
    }

    const updateData = { ...req.body };
    delete updateData.organizationId;
    delete updateData.createdById;
    delete updateData.id;

    if (updateData.ownerId) {
      if (req.user.role === 'sales_user') {
        delete updateData.ownerId;
      } else if (req.user.role === 'manager') {
        const isTeamMember = await prisma.user.findFirst({
          where: { id: updateData.ownerId, managerId: req.user.id, organizationId: req.user.organizationId },
          select: { id: true },
        });
        if (!isTeamMember) delete updateData.ownerId;
      }
    }

    const updated = await prisma.contact.update({
      where: { id: req.params.id },
      data: updateData,
      include: { owner: { select: { id: true, name: true, email: true } } },
    });

    return success(res, updated, 'Contact updated');
  } catch (err) {
    logger.error('updateContact error', { error: err.message });
    return error(res, 'Failed to update contact', 500);
  }
}

async function deleteContact(req, res) {
  try {
    if (!['org_admin', 'super_admin'].includes(req.user.role)) {
      return error(res, 'Only admins can delete contacts', 403);
    }

    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!contact) return error(res, 'Contact not found', 404);

    await prisma.contact.delete({ where: { id: req.params.id } });
    return success(res, null, 'Contact deleted');
  } catch (err) {
    logger.error('deleteContact error', { error: err.message });
    return error(res, 'Failed to delete contact', 500);
  }
}

module.exports = { getContacts, getContactById, createContact, updateContact, deleteContact };

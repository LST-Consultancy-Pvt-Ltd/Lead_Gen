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
    const { page = 1, limit = 20, search, accountId, leadId } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const baseFilter = await buildOrganizationFilter(req.user);
    const where = { organizationId: baseFilter.organizationId };
    // When fetching lead-specific contacts, skip the ownership restriction
    if (!leadId && baseFilter.assignedToId) {
      where.ownerId = baseFilter.assignedToId;
    }
    if (accountId) where.linkedAccountId = accountId;
    if (leadId)    where.leadId = leadId;
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

    // If leadId is provided, verify it belongs to this organization
    if (data.leadId) {
      const lead = await prisma.lead.findFirst({
        where: { id: data.leadId, organizationId: req.user.organizationId },
        select: { id: true },
      });
      if (!lead) return error(res, 'Lead not found', 404);
    }

    // Build explicit field list to avoid unknown-field errors and injection
    const contactData = {
      organizationId:  req.user.organizationId,
      createdById:     req.user.id,
      ownerId,
      name:            data.name        || '',
      email:           data.email       || null,
      phone:           data.phone       || null,
      designation:     data.designation || data.title || null,
      title:           data.title       || null,
      linkedin:        data.linkedin    || null,
      leadId:          data.leadId      || null,
      linkedAccountId: data.linkedAccountId || null,
      decisionMaker:   data.decisionMaker ?? false,
      influenceLevel:  data.influenceLevel || 'medium',
      additionalEmails:       Array.isArray(data.additionalEmails)       ? data.additionalEmails.filter(Boolean)       : [],
      additionalPhones:       Array.isArray(data.additionalPhones)       ? data.additionalPhones.filter(Boolean)       : [],
      additionalLinkedinUrls: Array.isArray(data.additionalLinkedinUrls) ? data.additionalLinkedinUrls.filter(Boolean) : [],
    };

    const contact = await prisma.contact.create({
      data: contactData,
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

    // Sanitize array fields
    if (updateData.additionalEmails !== undefined) {
      updateData.additionalEmails = Array.isArray(updateData.additionalEmails)
        ? updateData.additionalEmails.filter(Boolean) : [];
    }
    if (updateData.additionalPhones !== undefined) {
      updateData.additionalPhones = Array.isArray(updateData.additionalPhones)
        ? updateData.additionalPhones.filter(Boolean) : [];
    }
    if (updateData.additionalLinkedinUrls !== undefined) {
      updateData.additionalLinkedinUrls = Array.isArray(updateData.additionalLinkedinUrls)
        ? updateData.additionalLinkedinUrls.filter(Boolean) : [];
    }

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
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!contact) return error(res, 'Contact not found', 404);

    const isAdmin = ['org_admin', 'super_admin'].includes(req.user.role);
    const isLeadContact = !!contact.leadId;

    if (!isAdmin && !isLeadContact) {
      return error(res, 'Only admins can delete contacts', 403);
    }

    // For lead-linked contacts, allow the creator or any manager+ to delete
    if (!isAdmin && isLeadContact) {
      const canDelete =
        contact.createdById === req.user.id ||
        ['manager', 'org_admin', 'super_admin'].includes(req.user.role);
      if (!canDelete) return error(res, 'Access denied', 403);
    }

    await prisma.contact.delete({ where: { id: req.params.id } });
    return success(res, null, 'Contact deleted');
  } catch (err) {
    logger.error('deleteContact error', { error: err.message });
    return error(res, 'Failed to delete contact', 500);
  }
}

module.exports = { getContacts, getContactById, createContact, updateContact, deleteContact };

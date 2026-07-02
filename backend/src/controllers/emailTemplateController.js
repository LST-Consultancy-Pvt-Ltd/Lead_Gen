const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');

async function list(req, res) {
  try {
    const templates = await prisma.emailTemplate.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, templates);
  } catch (err) {
    logger.error('emailTemplate list error', { err: err.message });
    return error(res, 'Failed to fetch templates', 500);
  }
}

async function create(req, res) {
  try {
    const { name, body } = req.body;
    if (!name?.trim()) return error(res, 'Template name is required', 400);
    if (!body?.trim())  return error(res, 'Template body is required', 400);
    const template = await prisma.emailTemplate.create({
      data: { name: name.trim(), body: body.trim(), organizationId: req.user.organizationId },
    });
    return success(res, template, 'Template created', 201);
  } catch (err) {
    logger.error('emailTemplate create error', { err: err.message });
    return error(res, 'Failed to create template', 500);
  }
}

async function update(req, res) {
  try {
    const existing = await prisma.emailTemplate.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) return error(res, 'Template not found', 404);
    const { name, body } = req.body;
    const updated = await prisma.emailTemplate.update({
      where: { id: req.params.id },
      data: {
        ...(name?.trim() && { name: name.trim() }),
        ...(body?.trim() && { body: body.trim() }),
      },
    });
    return success(res, updated);
  } catch (err) {
    logger.error('emailTemplate update error', { err: err.message });
    return error(res, 'Failed to update template', 500);
  }
}

async function remove(req, res) {
  try {
    const existing = await prisma.emailTemplate.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) return error(res, 'Template not found', 404);
    await prisma.emailTemplate.delete({ where: { id: req.params.id } });
    return success(res, null, 'Template deleted');
  } catch (err) {
    logger.error('emailTemplate delete error', { err: err.message });
    return error(res, 'Failed to delete template', 500);
  }
}

module.exports = { list, create, update, remove };

/**
 * importController.js
 * Admin-only CSV/XLSX lead import with logging
 */

const XLSX = require('xlsx');
const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');
const { getTeamMemberIds } = require('../middleware/rbac');
const dashboardEvents = require('../utils/dashboardEvents');

const ALLOWED_MIME_TYPES = [
  'text/csv',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

const MAX_ROWS = 5000;

/**
 * POST /api/import/leads
 * Upload a CSV or XLSX file and bulk-create leads.
 * Access: admin only (enforced at route level)
 */
async function importLeads(req, res) {
  if (!req.file) return error(res, 'No file uploaded', 400);

  const mime = req.file.mimetype;
  if (!ALLOWED_MIME_TYPES.includes(mime)) {
    return error(res, 'Invalid file type. Allowed: CSV, XLS, XLSX', 400);
  }

  try {
    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });

    if (rows.length === 0) return error(res, 'File contains no data rows', 422);
    if (rows.length > MAX_ROWS) return error(res, `File exceeds maximum of ${MAX_ROWS} rows`, 422);

    // ── Round-robin assignment setup ────────────────────────────────────────
    const roundRobin = req.body.roundRobin === true || req.body.roundRobin === 'true';
    const fixedAssignedToId = req.body.assignedToId || null;
    let roundRobinUsers = [];

    if (roundRobin && !fixedAssignedToId) {
      const allTeamIds = await getTeamMemberIds(req.user);
      roundRobinUsers = await prisma.user.findMany({
        where: {
          id: { in: allTeamIds },
          organizationId: req.user.organizationId,
          role: 'sales_user',
          isActive: true,
        },
        select: { id: true },
      });
      if (roundRobinUsers.length === 0) {
        // Fallback to self if no sales_users found
        roundRobinUsers = [{ id: req.user.id }];
      }
    }

    const successLeads = [];
    const importErrors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        const companyName = String(row.companyName || row['Company Name'] || row.company || '').trim();
        if (!companyName) {
          importErrors.push({ row: i + 2, error: 'companyName is required' });
          continue;
        }

        const contactEmail = String(row.contactEmail || row['Contact Email'] || row.email || '').trim().toLowerCase();
        if (contactEmail) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(contactEmail)) {
            importErrors.push({ row: i + 2, field: 'contactEmail', error: 'Invalid email format', value: contactEmail });
            continue;
          }
        }

        // Check for duplicate within same org
        const duplicate = await prisma.lead.findFirst({
          where: {
            organizationId: req.user.organizationId,
            companyName: { equals: companyName, mode: 'insensitive' },
            ...(contactEmail ? { contactEmail: { equals: contactEmail, mode: 'insensitive' } } : {}),
          },
        });
        if (duplicate) {
          importErrors.push({ row: i + 2, error: `Duplicate: lead with companyName "${companyName}" already exists`, duplicateId: duplicate.id });
          continue;
        }

        const lead = await prisma.lead.create({
          data: {
            organizationId: req.user.organizationId,
            createdById: req.user.id,
            assignedToId: roundRobin && roundRobinUsers.length > 0
              ? roundRobinUsers[successLeads.length % roundRobinUsers.length].id
              : (fixedAssignedToId || req.user.id),
            companyName,
            website: String(row.website || row.Website || '').trim() || null,
            industry: String(row.industry || row.Industry || '').trim() || null,
            companySize: String(row.companySize || row['Company Size'] || '').trim() || null,
            location: String(row.location || row.Location || '').trim() || null,
            contactName: String(row.contactName || row['Contact Name'] || '').trim() || null,
            contactTitle: String(row.contactTitle || row['Contact Title'] || row.title || '').trim() || null,
            contactEmail: contactEmail || null,
            contactPhone: String(row.contactPhone || row['Contact Phone'] || row.phone || '').trim() || null,
            linkedinUrl: String(row.linkedinUrl || row['LinkedIn URL'] || '').trim() || null,
            source: 'import',
            status: 'new',
          },
        });
        successLeads.push(lead.id);
      } catch (rowErr) {
        importErrors.push({ row: i + 2, error: rowErr.message });
      }
    }

    // Persist import log
    await prisma.importLog.create({
      data: {
        organizationId: req.user.organizationId,
        userId: req.user.id,
        fileName: req.file.originalname,
        totalRows: rows.length,
        successRows: successLeads.length,
        failedRows: importErrors.length,
        errors: importErrors,
        status: 'completed',
      },
    });

    logger.info('Lead import completed', {
      userId: req.user.id,
      orgId: req.user.organizationId,
      fileName: req.file.originalname,
      total: rows.length,
      success: successLeads.length,
      failed: importErrors.length,
    });

    if (successLeads.length > 0) dashboardEvents.notifyOrg(req.user.organizationId, 'lead');

    return success(res, {
      totalRows: rows.length,
      successRows: successLeads.length,
      failedRows: importErrors.length,
      errors: importErrors.slice(0, 50), // cap error list in response
    }, `Import complete: ${successLeads.length} leads created, ${importErrors.length} skipped`, 201);
  } catch (err) {
    logger.error('importLeads error', { error: err.message, userId: req.user.id });
    return error(res, 'Import failed due to a server error', 500);
  }
}

/**
 * GET /api/import/logs
 * Fetch import history for the organization
 * Access: admin only (enforced at route level)
 */
async function getImportLogs(req, res) {
  try {
    const { page = 1, limit = 20 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [logs, total] = await Promise.all([
      prisma.importLog.findMany({
        where: { organizationId: req.user.organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
        include: { user: { select: { id: true, name: true, email: true } } },
      }),
      prisma.importLog.count({ where: { organizationId: req.user.organizationId } }),
    ]);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        totalPages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (err) {
    logger.error('getImportLogs error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to fetch import logs', 500);
  }
}

module.exports = { importLeads, getImportLogs };

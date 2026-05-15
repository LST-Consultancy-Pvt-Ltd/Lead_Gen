/**
 * importController.js
 * Admin-only CSV/XLSX lead import with logging
 */

const ExcelJS = require('exceljs');
const { Readable } = require('stream');
const path = require('path');
const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');
const logger = require('../utils/logger');
const { getTeamMemberIds } = require('../middleware/rbac');
const dashboardEvents = require('../utils/dashboardEvents');
const { checkLeadQuota, incrementLeadUsage } = require('../utils/leadQuota');
const { validateExcelFile } = require('../services/excelValidationService');
const { generateTemplate } = require('../services/excelTemplateService');

const ALLOWED_MIME_TYPES = [
  'text/csv',
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
    return error(res, 'Invalid file type. Allowed: CSV, XLSX', 400);
  }

  try {
    const workbook = new ExcelJS.Workbook();

    if (mime === 'text/csv' || mime === 'text/plain') {
      const stream = Readable.from(req.file.buffer);
      await workbook.csv.read(stream);
    } else {
      await workbook.xlsx.load(req.file.buffer);
    }

    const sheet = workbook.worksheets[0];
    if (!sheet) return error(res, 'File contains no data', 422);

    // Extract headers from first row (ExcelJS row.values is 1-indexed, index 0 is undefined)
    const headerValues = sheet.getRow(1).values;
    const headers = Array.isArray(headerValues) ? headerValues.slice(1) : [];
    if (headers.length === 0) return error(res, 'File contains no valid headers', 422);

    // Build rows as array of objects (same shape xlsx produced)
    const rows = [];
    for (let r = 2; r <= sheet.rowCount; r++) {
      const rowVals = sheet.getRow(r).values;
      const vals = Array.isArray(rowVals) ? rowVals.slice(1) : [];
      const obj = {};
      let hasData = false;
      headers.forEach((h, i) => {
        if (h != null) {
          const val = vals[i];
          obj[String(h)] = val ?? '';
          if (val !== undefined && val !== null && val !== '') hasData = true;
        }
      });
      if (hasData) rows.push(obj);
    }

    if (rows.length === 0) return error(res, 'File contains no data rows', 422);
    if (rows.length > MAX_ROWS) return error(res, `File exceeds maximum of ${MAX_ROWS} rows`, 422);

    // ── Lead Quota Check ────────────────────────────────────────────────────
    const quota = await checkLeadQuota(req.user.organizationId, 1);
    if (!quota.allowed) {
      return error(res, `Lead limit reached (${quota.quota}). You have used all your available leads. Please upgrade your plan to import more.`, 403);
    }
    // Cap importable rows to remaining quota
    const maxImportable = quota.remaining;
    let quotaExhaustedWarning = false;
    if (rows.length > maxImportable) {
      quotaExhaustedWarning = true;
    }

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
        roundRobinUsers = [{ id: req.user.id }];
      }
    }

    const successLeads = [];
    const importErrors = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // Check if quota is exhausted mid-import
        if (successLeads.length >= maxImportable) {
          importErrors.push({ row: i + 2, error: `Lead quota exhausted (limit: ${quota.quota}). Remaining rows skipped.` });
          break;
        }

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

    // ── Update lead usage counter ───────────────────────────────────────────
    if (successLeads.length > 0) {
      await incrementLeadUsage(req.user.organizationId, successLeads.length);
      dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    }

    let message = `Import complete: ${successLeads.length} leads created, ${importErrors.length} skipped`;
    if (quotaExhaustedWarning) {
      message += `. Note: Only ${maxImportable} of ${rows.length} rows were imported due to your lead quota (${quota.quota}).`;
    }

    return success(res, {
      totalRows: rows.length,
      successRows: successLeads.length,
      failedRows: importErrors.length,
      errors: importErrors.slice(0, 50),
      quotaRemaining: quota.remaining - successLeads.length,
    }, message, 201);
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

function normaliseLeadType(raw) {
  if (!raw) return null;
  const v = raw.toString().trim().toLowerCase();
  if (v === 'product') return 'product';
  if (v === 'service' || v === 'services') return 'service';
  return v || null;
}

/**
 * POST /api/import/leads/excel
 * Upload a structured Excel file (.xlsx/.xls) and bulk-create leads.
 * Columns: Company, Contact, Assign To, Score, Status, Product / Service, Source URL
 * Access: any authenticated user (no admin required)
 */
async function importLeadsFromExcel(req, res) {
  if (!req.file) return error(res, 'No file uploaded', 400);

  const ext = path.extname(req.file.originalname).toLowerCase();
  if (ext !== '.xlsx' && ext !== '.xls') {
    return error(res, 'Only Excel files (.xlsx, .xls) are allowed', 400);
  }

  try {
    const validation = await validateExcelFile(req.file.buffer);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        message: 'Excel validation failed',
        errors: validation.errors,
      });
    }

    const { records } = validation;
    const organizationId = req.user.organizationId;

    // ── Assign To lookup — one query for all unique names ──────────────────
    const uniqueAssignToValues = [
      ...new Set(
        records
          .map(r => String(r['Assign To'] ?? '').trim())
          .filter(v => v !== '')
      ),
    ];

    const userMap = new Map();
    if (uniqueAssignToValues.length > 0) {
      const matchedUsers = await prisma.user.findMany({
        where: {
          organizationId,
          isActive: true,
          OR: uniqueAssignToValues.map(name => ({
            name: { equals: name, mode: 'insensitive' },
          })),
        },
        select: { id: true, name: true },
      });
      matchedUsers.forEach(u => userMap.set(u.name.toLowerCase(), u.id));
    }

    // ── Map records to Lead model objects ──────────────────────────────────
    const leadsData = records.map(record => {
      const followUpRaw = record['Next Follow-up'];
      const followUpDate =
        followUpRaw && !isNaN(new Date(followUpRaw))
          ? new Date(followUpRaw)
          : null;

      return {
        companyName:  String(record['Company']).trim(),
        contactName:  record['Contact']?.toString().trim() || null,
        assignedToId: userMap.get(record['Assign To']?.toString().trim().toLowerCase()) || null,
        leadScore:    parseInt(record['Score'], 10) || 0,
        status:       record['Status']?.toString().trim().toLowerCase() || 'new',
        leadType:     normaliseLeadType(record['Product / Service']),
        sourceUrl:    record['Source URL']?.toString().trim() || null,
        followUpDate,
        organizationId,
        createdById:  req.user.id,
        source:       'Excel Import',
      };
    });

    // ── Bulk insert ────────────────────────────────────────────────────────
    const createResult = await prisma.lead.createMany({
      data: leadsData,
      skipDuplicates: false,
    });

    logger.info('Excel import completed', {
      userId: req.user.id,
      orgId: organizationId,
      fileName: req.file.originalname,
      total: leadsData.length,
      inserted: createResult.count,
    });

    return res.status(201).json({
      success: true,
      message: 'File imported successfully',
      totalRecords: records.length,
      successRows: createResult.count,
      failedRows: records.length - createResult.count,
      data: [],
    });
  } catch (err) {
    logger.error('importLeadsFromExcel error', { error: err.message, userId: req.user.id });
    return error(res, 'Import failed', 500);
  }
}

/**
 * GET /api/import/template/excel
 * Download the Excel import template with correct column headers and a sample row.
 * Access: any authenticated user (no admin required)
 */
async function downloadExcelTemplate(req, res) {
  try {
    const buffer = generateTemplate();
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      'attachment; filename="crm-import-template.xlsx"'
    );
    return res.send(buffer);
  } catch (err) {
    logger.error('downloadExcelTemplate error', { error: err.message, userId: req.user.id });
    return error(res, 'Failed to generate template', 500);
  }
}

module.exports = { importLeads, getImportLogs, importLeadsFromExcel, downloadExcelTemplate };

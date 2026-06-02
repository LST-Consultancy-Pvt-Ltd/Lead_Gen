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

        // Duplicate check: Phone OR Email (not companyName)
        const contactPhone = String(row.contactPhone || row['Contact Phone'] || row.phone || '').trim() || null;

        const dupOrConditions = [];
        if (contactEmail) dupOrConditions.push({ contactEmail: { equals: contactEmail, mode: 'insensitive' } });
        if (contactPhone) dupOrConditions.push({ contactPhone: { equals: contactPhone, mode: 'insensitive' } });

        if (dupOrConditions.length > 0) {
          const duplicate = await prisma.lead.findFirst({
            where: {
              organizationId: req.user.organizationId,
              OR: dupOrConditions,
            },
            select: { id: true, companyName: true },
          });
          if (duplicate) {
            importErrors.push({
              row: i + 2,
              error: `Duplicate: a lead already exists with the same email or phone (existing lead: "${duplicate.companyName}", id: ${duplicate.id})`,
              duplicateId: duplicate.id,
            });
            continue;
          }
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
          .map(r => String(r['Assign Lead To'] ?? '').trim())
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

    // ── Load valid statuses from org's dropdown config ─────────────────────
    const statusRows = await prisma.dropdownConfig.findMany({
      where: { organizationId, category: 'lead_status', isActive: true },
      select: { value: true, isDefault: true },
    });
    const validStatuses = new Set(statusRows.map(r => r.value.toLowerCase()));
    const defaultStatus = (statusRows.find(r => r.isDefault)?.value ?? statusRows[0]?.value ?? 'new').toLowerCase();

    // ── Load valid sources from org's dropdown config ──────────────────────
    const sourceRows = await prisma.dropdownConfig.findMany({
      where: { organizationId, category: 'lead_source', isActive: true },
      select: { value: true, isDefault: true },
    });
    const validSources = new Set(sourceRows.map(r => r.value.toLowerCase()));
    const defaultSource = (sourceRows.find(r => r.isDefault)?.value ?? sourceRows[0]?.value ?? null)?.toLowerCase() ?? null;

    // ── Map records to Lead model objects ──────────────────────────────────
    const isSalesUser = req.user.role === 'sales_user';

    const leadsData = records.map(record => {
      const followUpRaw = record['Follow-up Date'];
      let followUpDate = null;
      if (followUpRaw) {
        if (followUpRaw instanceof Date) {
          followUpDate = isNaN(followUpRaw.getTime()) ? null : followUpRaw;
        } else if (typeof followUpRaw === 'number') {
          followUpDate = new Date((followUpRaw - 25569) * 86400 * 1000);
        } else {
          const parsed = new Date(followUpRaw);
          followUpDate = isNaN(parsed.getTime()) ? null : parsed;
        }
      }

      const resolvedAssignedToId = isSalesUser
        ? req.user.id
        : (userMap.get(record['Assign Lead To']?.toString().trim().toLowerCase()) || null);

      return {
        companyName:  String(record['Company Name']).trim(),
        contactName:  record['Contact Name']?.toString().trim() || null,
        contactTitle: record['Job Title']?.toString().trim() || null,
        contactEmail: record['Email']?.toString().trim().toLowerCase() || null,
        contactPhone: record['Phone']?.toString().trim() || null,
        assignedToId: resolvedAssignedToId,
        leadScore:    parseInt(record['Score'], 10) || 0,
        leadType:     normaliseLeadType(record['Lead Type']),
        website:      record['Website']?.toString().trim() || null,
        industry:     record['Industry']?.toString().trim() || null,
        location:     record['Location']?.toString().trim() || null,
        notes:        record['Description / Notes']?.toString().trim() || null,
        followUpDate,
        organizationId,
        createdById:  req.user.id,
      };
    });

    // ── Row-by-row insert with Phone OR Email duplicate check ─────────────
    let insertedCount = 0;
    const excelImportErrors = [];

    for (let i = 0; i < leadsData.length; i++) {
      const leadData = leadsData[i];
      const record = records[i];

      // ── Status validation against DB ──────────────────────────────────────
      const rawStatus = String(record['Lead Status'] ?? '').trim().toLowerCase();
      if (rawStatus && !validStatuses.has(rawStatus)) {
        excelImportErrors.push({
          row: i + 2,
          field: 'Lead Status',
          invalidValue: record['Lead Status'],
          validOptions: [...validStatuses].join(', '),
          error: `Invalid status "${record['Lead Status']}" in row ${i + 2}. Allowed values are: ${[...validStatuses].join(', ')}. Row skipped.`,
          isStatusError: true,
        });
        continue;
      }
      const resolvedStatus = rawStatus && validStatuses.has(rawStatus) ? rawStatus : defaultStatus;

      // ── Source validation against DB ──────────────────────────────────────
      const rawSource = String(record['Lead Source'] ?? '').trim().toLowerCase();
      if (rawSource && validSources.size > 0 && !validSources.has(rawSource)) {
        excelImportErrors.push({
          row: i + 2,
          field: 'Lead Source',
          invalidValue: record['Lead Source'],
          validOptions: [...validSources].join(', '),
          error: `Invalid source "${record['Lead Source']}" in row ${i + 2}. Allowed values are: ${[...validSources].join(', ')}. Row skipped.`,
          isSourceError: true,
        });
        continue;
      }
      const resolvedSource = (rawSource && validSources.has(rawSource)) ? rawSource : (defaultSource ?? 'Excel Import');

      // ── Field validations (Email, Phone, Score, Date, Website) ───────────
      const fieldErrors = [];

      const emailVal = String(record['Email'] ?? '').trim();
      if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        fieldErrors.push({ field: 'Email', invalidValue: emailVal, reason: 'Must be a valid email address (e.g. john@example.com)' });
      }

      const phoneVal = String(record['Phone'] ?? '').trim();
      if (phoneVal && !/^[+\d\s\-().]{6,20}$/.test(phoneVal)) {
        fieldErrors.push({ field: 'Phone', invalidValue: phoneVal, reason: 'Only digits, spaces, +, −, (, ) allowed · 6–20 characters' });
      }

      const scoreRaw = record['Score'];
      if (scoreRaw !== undefined && scoreRaw !== null && scoreRaw !== '') {
        const scoreNum = Number(scoreRaw);
        if (isNaN(scoreNum) || !Number.isInteger(scoreNum) || scoreNum < 0 || scoreNum > 100) {
          fieldErrors.push({ field: 'Score', invalidValue: String(scoreRaw), reason: 'Must be a whole number between 0 and 100' });
        }
      }

      const followUpRaw = record['Follow-up Date'];
      if (followUpRaw && typeof followUpRaw === 'string') {
        const dateStr = followUpRaw.trim();
        const dateMatch = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(dateStr);
        if (!dateMatch) {
          fieldErrors.push({ field: 'Follow-up Date', invalidValue: dateStr, reason: 'Use DD/MM/YYYY or DD-MM-YYYY only (e.g. 10/10/2026 or 31-12-2026).' });
        } else {
          const day = parseInt(dateMatch[1], 10);
          const month = parseInt(dateMatch[2], 10);
          if (day < 1 || day > 31) {
            fieldErrors.push({ field: 'Follow-up Date', invalidValue: dateStr, reason: `Day "${dateMatch[1]}" is invalid — must be between 01 and 31` });
          } else if (month < 1 || month > 12) {
            fieldErrors.push({ field: 'Follow-up Date', invalidValue: dateStr, reason: `Month "${dateMatch[2]}" is invalid — must be between 01 and 12` });
          }
        }
      }

      const websiteVal = String(record['Website'] ?? '').trim();
      if (websiteVal) {
        const validWebsite = /^(https?:\/\/)?(www\.)?[\w\-]+(\.[\w\-]+)+([\w\-._~:/?#[\]@!$&'()*+,;=%]*)?$/.test(websiteVal) && !websiteVal.includes(' ') && websiteVal.length <= 500;
        if (!validWebsite) {
          fieldErrors.push({ field: 'Website', invalidValue: websiteVal, reason: 'Must be a valid URL with no spaces (e.g. https://example.com)' });
        }
      }

      if (fieldErrors.length > 0) {
        fieldErrors.forEach(fe => {
          excelImportErrors.push({
            row: i + 2,
            field: fe.field,
            invalidValue: fe.invalidValue,
            reason: fe.reason,
            error: `Row ${i + 2} – ${fe.field}: ${fe.reason} (got: "${fe.invalidValue}")`,
            isFieldError: true,
          });
        });
        continue;
      }

      try {
        const rawPhone = String(record['Phone'] || record['Contact Phone'] || record['phone'] || '').trim() || null;
        const rawEmail = String(record['Email'] || record['Contact Email'] || record['email'] || '').trim().toLowerCase() || null;

        const dupOrConditions = [];
        if (rawEmail) dupOrConditions.push({ contactEmail: { equals: rawEmail, mode: 'insensitive' } });
        if (rawPhone) dupOrConditions.push({ contactPhone: { equals: rawPhone, mode: 'insensitive' } });

        if (dupOrConditions.length > 0) {
          const duplicate = await prisma.lead.findFirst({
            where: {
              organizationId,
              OR: dupOrConditions,
            },
            select: { id: true, companyName: true },
          });
          if (duplicate) {
            excelImportErrors.push({
              row: i + 2,
              error: `Duplicate: a lead already exists with the same email or phone (existing lead: "${duplicate.companyName}", id: ${duplicate.id})`,
              duplicateId: duplicate.id,
            });
            continue;
          }
        }

        await prisma.lead.create({ data: { ...leadData, status: resolvedStatus, source: resolvedSource } });
        insertedCount++;
      } catch (rowErr) {
        excelImportErrors.push({ row: i + 2, error: rowErr.message });
      }
    }

    logger.info('Excel import completed', {
      userId: req.user.id,
      orgId: organizationId,
      fileName: req.file.originalname,
      total: leadsData.length,
      inserted: insertedCount,
      skipped: excelImportErrors.length,
    });

    const statusErrors = excelImportErrors.filter(e => e.isStatusError === true);
    const sourceErrors = excelImportErrors.filter(e => e.isSourceError === true);
    const fieldValErrors = excelImportErrors.filter(e => e.isFieldError === true);
    const otherErrors  = excelImportErrors.filter(e => !e.isStatusError && !e.isSourceError && !e.isFieldError);

    return res.status(201).json({
      success: true,
      message: `File imported successfully: ${insertedCount} leads created, ${excelImportErrors.length} skipped`,
      totalRecords:   records.length,
      successRows:    insertedCount,
      failedRows:     excelImportErrors.length,
      statusErrors:   statusErrors.slice(0, 50),
      sourceErrors:   sourceErrors.slice(0, 50),
      fieldErrors:    fieldValErrors.slice(0, 50),
      otherErrors:    otherErrors.slice(0, 50),
      errors:         excelImportErrors.slice(0, 50),
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

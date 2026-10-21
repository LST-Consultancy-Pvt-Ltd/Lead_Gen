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
const { validateExcelFile } = require('../services/excelValidationService');
const { generateTemplate } = require('../services/excelTemplateService');
const { createBulkNotifications } = require('../utils/notificationService');
const { getReportingLineIds, roleLabel } = require('../utils/reportingLine');

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
      if (hasData) {
        Object.defineProperty(obj, '__row', { value: r, enumerable: false });
        rows.push(obj);
      }
    }

    if (rows.length === 0) return error(res, 'File contains no data rows', 422);
    if (rows.length > MAX_ROWS) return error(res, `File exceeds maximum of ${MAX_ROWS} rows`, 422);

    // Lead quota only applies to Lead Discovery leads, so imports are not capped or counted

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
      const rowNo = row.__row ?? i + 2;
      try {
        const companyName = String(row.companyName || row['Company Name'] || row.company || '').trim();
        if (!companyName) {
          importErrors.push({ row: rowNo, error: 'companyName is required' });
          continue;
        }

        const contactEmail = String(row.contactEmail || row['Contact Email'] || row.email || '').trim().toLowerCase();
        if (contactEmail) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(contactEmail)) {
            importErrors.push({ row: rowNo, field: 'contactEmail', error: 'Invalid email format', value: contactEmail });
            continue;
          }
        }

        // Duplicate check: Phone OR Email (not companyName)
        const contactPhone = String(row.contactPhone || row['Contact Phone'] || row.phone || '').trim() || null;

        if (contactPhone) {
          const problem = phoneProblem(contactPhone);
          if (problem) {
            importErrors.push({ row: rowNo, field: 'contactPhone', error: problem, value: contactPhone });
            continue;
          }
        }

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
              row: rowNo,
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
        importErrors.push({ row: rowNo, error: rowErr.message });
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

    if (successLeads.length > 0) {
      dashboardEvents.notifyOrg(req.user.organizationId, 'lead');
    }

    let message = `Import complete: ${successLeads.length} leads created, ${importErrors.length} skipped`;

    return success(res, {
      totalRows: rows.length,
      successRows: successLeads.length,
      failedRows: importErrors.length,
      errors: importErrors.slice(0, 50),
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


/**
 * Parse an Excel "Follow-up Date" cell. Text must be DD/MM/YYYY or DD-MM-YYYY
 * (day first, as the template says); Excel date cells arrive as serial numbers
 * or Date objects. Returns null for empty or impossible dates (e.g. 31/02/2026).
 */
function parseFollowUpDate(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  if (raw instanceof Date) return isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') return new Date(Math.round((raw - 25569) * 86400 * 1000));
  const m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(String(raw).trim());
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return d;
}

/**
 * Phone check for imports: digits with optional formatting — a leading "+",
 * spaces, dashes and brackets (e.g. +91 98765 43210, (555) 123-4567).
 * Returns an error reason, or null when the number is acceptable.
 */
function phoneProblem(value) {
  const v = String(value).trim();
  if (!/^\+?[\d\s\-()]+$/.test(v)) {
    return 'Phone number may contain only digits, a leading +, spaces, dashes and brackets';
  }
  const digits = v.replace(/\D/g, '').length;
  if (digits < 3 || digits > 16) return 'Phone number must have between 3 and 16 digits';
  return null;
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

    const { records, skippedRows = [] } = validation;
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
        select: { id: true, name: true, managerId: true },
      });
      matchedUsers.forEach(u => userMap.set(u.name.toLowerCase(), u));
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

    // ── Load valid lead types from org's dropdown config ───────────────────
    const leadTypeRows = await prisma.dropdownConfig.findMany({
      where: { organizationId, category: 'lead_type', isActive: true },
      select: { value: true },
    });
    const validLeadTypes = leadTypeRows.length ? leadTypeRows.map(r => r.value) : ['Services', 'Product'];
    // Services / Product keep their canonical stored form; custom types are stored as configured
    const resolveLeadType = (raw) => {
      const v = String(raw ?? '').trim();
      if (!v) return null;
      const match = validLeadTypes.find(t =>
        t.toLowerCase() === v.toLowerCase() ||
        (['service', 'product'].includes(normaliseLeadType(t)) && normaliseLeadType(t) === normaliseLeadType(v)));
      if (!match) return undefined;
      const canonical = normaliseLeadType(match);
      return ['service', 'product'].includes(canonical) ? canonical : match;
    };

    // ── Map records to Lead model objects ──────────────────────────────────
    const isSalesUser = req.user.role === 'sales_user';

    const leadsData = records.map(record => {
      const followUpDate = parseFollowUpDate(record['Follow-up Date']);

      const resolvedAssignedToId = isSalesUser
        ? req.user.id
        : (userMap.get(record['Assign Lead To']?.toString().trim().toLowerCase())?.id || null);

      return {
        companyName:  record['Company Name']?.toString().trim() || null,
        contactName:  record['Contact Name']?.toString().trim() || null,
        contactTitle: record['Job Title']?.toString().trim() || null,
        contactEmail: record['Email']?.toString().trim().toLowerCase() || null,
        contactPhone: record['Phone']?.toString().trim() || null,
        assignedToId: resolvedAssignedToId,
        leadScore:    parseInt(record['Score'], 10) || 0,
        leadType:     resolveLeadType(record['Lead Type']) || null,
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
    const pendingNotifications = [];
    const excelImportErrors = skippedRows.map(s => ({
      row: s.row,
      missingFields: s.missingFields,
      error: `Row ${s.row}: Missing required field(s): ${s.missingFields.join(', ')}`,
      isMissingError: true,
    }));

    for (let i = 0; i < leadsData.length; i++) {
      const leadData = leadsData[i];
      const record = records[i];
      const rowNo = record.__row ?? i + 2;

      // ── Status validation against DB ──────────────────────────────────────
      const rawStatus = String(record['Lead Status'] ?? '').trim().toLowerCase();
      if (rawStatus && !validStatuses.has(rawStatus)) {
        excelImportErrors.push({
          row: rowNo,
          field: 'Lead Status',
          invalidValue: record['Lead Status'],
          validOptions: [...validStatuses].join(', '),
          error: `Invalid status "${record['Lead Status']}" in row ${rowNo}. Allowed values are: ${[...validStatuses].join(', ')}. Row skipped.`,
          isStatusError: true,
        });
        continue;
      }
      const resolvedStatus = rawStatus && validStatuses.has(rawStatus) ? rawStatus : defaultStatus;

      // ── Source validation against DB ──────────────────────────────────────
      const rawSource = String(record['Lead Source'] ?? '').trim().toLowerCase();
      if (rawSource && validSources.size > 0 && !validSources.has(rawSource)) {
        excelImportErrors.push({
          row: rowNo,
          field: 'Lead Source',
          invalidValue: record['Lead Source'],
          validOptions: [...validSources].join(', '),
          error: `Invalid source "${record['Lead Source']}" in row ${rowNo}. Allowed values are: ${[...validSources].join(', ')}. Row skipped.`,
          isSourceError: true,
        });
        continue;
      }
      const resolvedSource = (rawSource && validSources.has(rawSource)) ? rawSource : null;

      // ── Field validations (Email, Phone, Score, Date, Website) ───────────
      const fieldErrors = [];

      const emailVal = String(record['Email'] ?? '').trim();
      if (emailVal && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        fieldErrors.push({ field: 'Email', invalidValue: emailVal, reason: 'Must be a valid email address (e.g. john@example.com)' });
      }

      const phoneVal = String(record['Phone'] ?? '').trim();
      if (phoneVal) {
        const problem = phoneProblem(phoneVal);
        if (problem) fieldErrors.push({ field: 'Phone', invalidValue: phoneVal, reason: problem });
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
          } else if (!parseFollowUpDate(dateStr)) {
            fieldErrors.push({ field: 'Follow-up Date', invalidValue: dateStr, reason: 'This date does not exist in the calendar (e.g. 31/02)' });
          }
        }
      }

      const leadTypeVal = String(record['Lead Type'] ?? '').trim();
      if (leadTypeVal && resolveLeadType(leadTypeVal) === undefined) {
        fieldErrors.push({ field: 'Lead Type', invalidValue: leadTypeVal, reason: `Must be one of: ${validLeadTypes.join(', ')}` });
      }

      // Assign Lead To (ignored for sales executives — their imports are always their own)
      if (!isSalesUser) {
        const assignName = String(record['Assign Lead To'] ?? '').trim();
        const target = assignName ? userMap.get(assignName.toLowerCase()) : null;
        if (assignName && !target) {
          fieldErrors.push({ field: 'Assign Lead To', invalidValue: assignName, reason: 'No active user with this name in your organisation' });
        } else if (target && req.user.role === 'manager' && target.id !== req.user.id && target.managerId !== req.user.id) {
          // Managers may only assign to themselves or their own team members
          fieldErrors.push({ field: 'Assign Lead To', invalidValue: assignName, reason: 'You can only assign leads to yourself or members of your own team' });
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
            row: rowNo,
            field: fe.field,
            invalidValue: fe.invalidValue,
            reason: fe.reason,
            error: `Row ${rowNo} – ${fe.field}: ${fe.reason} (got: "${fe.invalidValue}")`,
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
            const reason = `Duplicate — a lead with this email or phone already exists${duplicate.companyName ? ` ("${duplicate.companyName}")` : ''}`;
            excelImportErrors.push({
              row: rowNo,
              field: 'Email / Phone',
              invalidValue: [rawEmail, rawPhone].filter(Boolean).join(' / '),
              reason,
              error: `Row ${rowNo} – ${reason}`,
              duplicateId: duplicate.id,
              isFieldError: true,
            });
            continue;
          }
        }

        const createdLead = await prisma.lead.create({ data: { ...leadData, status: resolvedStatus, source: resolvedSource } });
        insertedCount++;
        if (leadData.assignedToId && leadData.assignedToId !== req.user.id) {
          pendingNotifications.push({
            userId: leadData.assignedToId,
            organizationId,
            type: 'lead_assigned',
            title: 'New lead assigned to you',
            message: `Lead "${createdLead.companyName}" was assigned to you via Excel import`,
            entityType: 'Lead',
            entityId: createdLead.id,
            isRead: false,
          });
        }
      } catch (rowErr) {
        logger.warn('Excel import row failed', { row: rowNo, err: rowErr.message });
        excelImportErrors.push({
          row: rowNo,
          field: 'Row',
          invalidValue: '',
          reason: 'Could not save this row',
          error: `Row ${rowNo} – could not be saved`,
          isFieldError: true,
        });
      }
    }

    if (pendingNotifications.length > 0) {
      await prisma.notification.createMany({ data: pendingNotifications });
    }

    // One summary notification to the importer's reporting line (manager / admin)
    if (insertedCount > 0 && ['manager', 'sales_user'].includes(req.user.role)) {
      try {
        const recipients = await getReportingLineIds(req.user);
        await createBulkNotifications(prisma, recipients.map((id) => ({
          userId: id,
          organizationId,
          type: 'leads_imported',
          title: 'Leads Imported',
          message: `${req.user.name} (${roleLabel(req.user.role)}) imported ${insertedCount} lead${insertedCount !== 1 ? 's' : ''} from Excel`,
          entityType: 'Lead',
        })), { actorId: req.user.id });
      } catch (notifyErr) {
        logger.warn('Import summary notification failed (non-fatal)', { error: notifyErr.message });
      }
    }

    await prisma.importLog.create({
      data: {
        organizationId,
        userId: req.user.id,
        fileName: req.file.originalname,
        totalRows: records.length + skippedRows.length,
        successRows: insertedCount,
        failedRows: excelImportErrors.length,
        errors: excelImportErrors.slice(0, 200).map(({ row, field, invalidValue, reason, error: msg }) => ({ row, field, invalidValue, reason, error: msg })),
        status: 'completed',
      },
    }).catch((e) => logger.warn('Excel import log failed', { err: e.message }));

    logger.info('Excel import completed', {
      userId: req.user.id,
      orgId: organizationId,
      fileName: req.file.originalname,
      total: leadsData.length,
      inserted: insertedCount,
      skipped: excelImportErrors.length,
    });

    const statusErrors  = excelImportErrors.filter(e => e.isStatusError  === true);
    const sourceErrors  = excelImportErrors.filter(e => e.isSourceError  === true);
    const missingErrors = excelImportErrors.filter(e => e.isMissingError === true);
    const fieldValErrors = excelImportErrors.filter(e => e.isFieldError  === true);
    const otherErrors   = excelImportErrors.filter(e => !e.isStatusError && !e.isSourceError && !e.isMissingError && !e.isFieldError);

    return res.status(201).json({
      success: true,
      message: `File imported successfully: ${insertedCount} leads created, ${excelImportErrors.length} skipped`,
      totalRecords:   records.length,
      successRows:    insertedCount,
      failedRows:     excelImportErrors.length,
      statusErrors:   statusErrors.slice(0, 50),
      sourceErrors:   sourceErrors.slice(0, 50),
      missingErrors:  missingErrors.slice(0, 50),
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

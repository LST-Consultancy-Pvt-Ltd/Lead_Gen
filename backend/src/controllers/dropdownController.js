/**
 * dropdownController.js
 * Admin-configurable dropdown values for CRM fields
 */

const prisma = require("../utils/prisma");
const { success, error } = require("../utils/response");
const logger = require("../utils/logger");

const VALID_CATEGORIES = [
  // Shared / Leads module
  "lead_source", "lead_status", "pipeline_stage", "loss_reason", "job_title", "location",
  // Legacy shared (kept for backward compat)
  "industry", "company_size", "company_type", "decision_maker",
  "preferred_contact_channel", "seniority_level", "annual_revenue_range",
  // Lead Discovery — Resource mode (independent)
  "resource_industry", "resource_company_size", "resource_company_type",
  "resource_decision_maker", "resource_preferred_contact_channel", "resource_seniority_level",
  // Lead Discovery — Product mode (independent)
  "product_industry", "product_company_size", "product_company_type",
  "product_annual_revenue_range", "product_decision_maker",
  "product_preferred_contact_channel", "product_seniority_level",
];

// Default values seeded for every new organisation
const DEFAULT_DROPDOWN_SEEDS = [
  { category: 'lead_status', values: [
    'New', 'Contacted', 'Qualified', 'Warm', 'Hot',
    'Proposal Sent', 'Negotiation', 'Won', 'Lost', 'On Hold', 'Unqualified',
  ]},
  { category: 'lead_source', values: [
    'Manual Entry', 'Website Form', 'LinkedIn', 'Cold Email', 'Referral',
    'Lead Generation Tool', 'Advertisement', 'Event / Conference',
    'Inbound Call', 'WhatsApp', 'Partner / Channel', 'Imported / CSV Upload',
  ]},
  { category: 'job_title', values: [
    'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
    'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
    'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
  ]},
  { category: 'pipeline_stage', values: [
    'Lead', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost',
  ]},
  { category: 'loss_reason', values: [
    'Price too high', 'Chose competitor', 'No budget', 'No decision made',
    'Wrong fit', 'Timing not right', 'No response',
  ]},
  { category: 'industry', values: [
    'Any Industry', 'Information Technology (IT)', 'Software / SaaS',
    'Banking & Financial Services (BFSI)', 'Healthcare & Pharmaceuticals',
    'Manufacturing & Industrial', 'Retail & E-commerce', 'Education & EdTech',
    'Logistics & Supply Chain', 'Real Estate & Construction', 'Media & Advertising',
    'Telecommunications', 'Energy & Utilities', 'Automotive',
    'Government & Public Sector', 'NGO / Non-profit', 'Hospitality & Travel',
    'Agriculture & Food Processing', 'Legal & Compliance',
    'Consulting & Professional Services',
  ]},
  { category: 'company_size', values: [
    'Any Size', '1-10 (Micro)', '11-50 (Small)', '51-200 (Mid-size)',
    '201-500 (Growing)', '501-1000 (Large)', '1000-5000 (Enterprise)',
    '5000+ (Global Enterprise)',
  ]},
  { category: 'company_type', values: [
    'Any', 'Private Limited', 'Public Listed', 'Startup', 'MNC', 'SME',
    'Government / PSU', 'NGO / Non-profit', 'Partnership Firm', 'LLP',
    'Sole Proprietorship', 'Family Business',
  ]},
  { category: 'decision_maker', values: [
    'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
    'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
    'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
  ]},
  { category: 'preferred_contact_channel', values: [
    'Any', 'Email', 'LinkedIn', 'Phone / Call', 'WhatsApp', 'In-person / Visit',
  ]},
  { category: 'seniority_level', values: [
    'Any', 'C-suite', 'VP / SVP Level', 'Director Level', 'Manager Level',
    'Team Lead', 'Individual Contributor', 'Board / Advisor Level',
  ]},
  { category: 'annual_revenue_range', values: [
    'Any', 'Under $1M', '$1M – $5M', '$5M – $10M', '$10M – $25M',
    '$25M – $50M', '$50M – $100M', '$100M – $250M', '$250M – $500M',
    '$500M – $1B', 'Above $1B',
  ]},
  // ── Lead Discovery: Resource mode ────────────────────────────────────────
  { category: 'resource_industry', values: [
    'Any Industry', 'Information Technology (IT)', 'Software / SaaS',
    'Banking & Financial Services (BFSI)', 'Healthcare & Pharmaceuticals',
    'Manufacturing & Industrial', 'Retail & E-commerce', 'Education & EdTech',
    'Logistics & Supply Chain', 'Real Estate & Construction', 'Media & Advertising',
    'Telecommunications', 'Energy & Utilities', 'Automotive',
    'Government & Public Sector', 'NGO / Non-profit', 'Hospitality & Travel',
    'Agriculture & Food Processing', 'Legal & Compliance',
    'Consulting & Professional Services',
  ]},
  { category: 'resource_company_size', values: [
    'Any Size', '1-10 (Micro)', '11-50 (Small)', '51-200 (Mid-size)',
    '201-500 (Growing)', '501-1000 (Large)', '1000-5000 (Enterprise)', '5000+ (Global Enterprise)',
  ]},
  { category: 'resource_company_type', values: [
    'Any', 'Private Limited', 'Public Listed', 'Startup', 'MNC', 'SME',
    'Government / PSU', 'NGO / Non-profit', 'Partnership Firm', 'LLP',
    'Sole Proprietorship', 'Family Business',
  ]},
  { category: 'resource_decision_maker', values: [
    'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
    'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
    'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
  ]},
  { category: 'resource_preferred_contact_channel', values: [
    'Any', 'Email', 'LinkedIn', 'Phone / Call', 'WhatsApp', 'In-person / Visit',
  ]},
  { category: 'resource_seniority_level', values: [
    'Any', 'C-suite', 'VP / SVP Level', 'Director Level', 'Manager Level',
    'Team Lead', 'Individual Contributor', 'Board / Advisor Level',
  ]},
  // ── Lead Discovery: Product mode ─────────────────────────────────────────
  { category: 'product_industry', values: [
    'Any Industry', 'Information Technology (IT)', 'Software / SaaS',
    'Banking & Financial Services (BFSI)', 'Healthcare & Pharmaceuticals',
    'Manufacturing & Industrial', 'Retail & E-commerce', 'Education & EdTech',
    'Logistics & Supply Chain', 'Real Estate & Construction', 'Media & Advertising',
    'Telecommunications', 'Energy & Utilities', 'Automotive',
    'Government & Public Sector', 'NGO / Non-profit', 'Hospitality & Travel',
    'Agriculture & Food Processing', 'Legal & Compliance',
    'Consulting & Professional Services',
  ]},
  { category: 'product_company_size', values: [
    'Any Size', '1-10 (Micro)', '11-50 (Small)', '51-200 (Mid-size)',
    '201-500 (Growing)', '501-1000 (Large)', '1000-5000 (Enterprise)', '5000+ (Global Enterprise)',
  ]},
  { category: 'product_company_type', values: [
    'Any', 'Private Limited', 'Public Listed', 'Startup', 'MNC', 'SME',
    'Government / PSU', 'NGO / Non-profit', 'Partnership Firm', 'LLP',
    'Sole Proprietorship', 'Family Business',
  ]},
  { category: 'product_annual_revenue_range', values: [
    'Any', 'Under $1M', '$1M – $5M', '$5M – $10M', '$10M – $25M',
    '$25M – $50M', '$50M – $100M', '$100M – $250M', '$250M – $500M',
    '$500M – $1B', 'Above $1B',
  ]},
  { category: 'product_decision_maker', values: [
    'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
    'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
    'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
  ]},
  { category: 'product_preferred_contact_channel', values: [
    'Any', 'Email', 'LinkedIn', 'Phone / Call', 'WhatsApp', 'In-person / Visit',
  ]},
  { category: 'product_seniority_level', values: [
    'Any', 'C-suite', 'VP / SVP Level', 'Director Level', 'Manager Level',
    'Team Lead', 'Individual Contributor', 'Board / Advisor Level',
  ]},
];

/**
 * Seed default dropdown values for a newly created organisation.
 * Uses createMany with skipDuplicates so it is safe to call multiple times.
 */
async function seedDefaultDropdowns(organizationId) {
  const rows = [];
  DEFAULT_DROPDOWN_SEEDS.forEach(({ category, values }) => {
    values.forEach((value, index) => {
      rows.push({ organizationId, category, value, displayOrder: index, isActive: true });
    });
  });
  await prisma.dropdownConfig.createMany({ data: rows, skipDuplicates: true });
}

// GET /api/dropdowns?category=lead_source — all authenticated roles
async function listByCategory(req, res) {
  try {
    const { category } = req.query;
    if (!category)
      return error(res, "category query parameter is required", 400);

    const items = await prisma.dropdownConfig.findMany({
      where: {
        organizationId: req.user.organizationId,
        category,
        isActive: true,
      },
      orderBy: { displayOrder: "asc" },
      select: {
        id: true,
        category: true,
        value: true,
        displayOrder: true,
        isActive: true,
      },
    });
    return success(res, items);
  } catch (err) {
    return error(res, "Failed to fetch dropdown values", 500);
  }
}

// GET /api/dropdowns/active — all authenticated roles, flat array of active items for the org
async function listActive(req, res) {
  try {
    const items = await prisma.dropdownConfig.findMany({
      where: {
        organizationId: req.user.organizationId,
        isActive: true,
      },
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
      select: {
        id: true,
        category: true,
        value: true,
        displayOrder: true,
        isActive: true,
      },
    });
    return success(res, items);
  } catch (err) {
    return error(res, 'Failed to fetch dropdown values', 500);
  }
}

// GET /api/dropdowns/discovery?mode=resource|product — all authenticated roles
// Returns mode-specific discovery categories. Falls back to legacy shared keys
// if the prefixed rows haven't been seeded yet (backward compat).
const RESOURCE_DISCOVERY_CATEGORIES = [
  'resource_industry', 'resource_company_size', 'resource_company_type',
  'resource_decision_maker', 'resource_preferred_contact_channel', 'resource_seniority_level',
];
const PRODUCT_DISCOVERY_CATEGORIES = [
  'product_industry', 'product_company_size', 'product_company_type',
  'product_annual_revenue_range', 'product_decision_maker',
  'product_preferred_contact_channel', 'product_seniority_level',
];
// Legacy fallback — used when prefixed rows don't exist yet
const LEGACY_DISCOVERY_CATEGORIES = [
  'industry', 'company_size', 'company_type', 'decision_maker',
  'preferred_contact_channel', 'seniority_level', 'annual_revenue_range',
];

async function listDiscoveryDropdowns(req, res) {
  try {
    const { mode } = req.query; // 'resource' | 'product' | undefined (legacy)

    let targetCategories;
    let stripPrefix = null;

    if (mode === 'resource') {
      targetCategories = RESOURCE_DISCOVERY_CATEGORIES;
      stripPrefix = 'resource_';
    } else if (mode === 'product') {
      targetCategories = PRODUCT_DISCOVERY_CATEGORIES;
      stripPrefix = 'product_';
    } else {
      targetCategories = LEGACY_DISCOVERY_CATEGORIES;
    }

    const items = await prisma.dropdownConfig.findMany({
      where: {
        organizationId: req.user.organizationId,
        category: { in: targetCategories },
        isActive: true,
      },
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
      select: { id: true, category: true, value: true, displayOrder: true },
    });

    // If mode-specific rows don't exist yet, fall back to legacy shared rows
    if ((mode === 'resource' || mode === 'product') && items.length === 0) {
      const fallback = await prisma.dropdownConfig.findMany({
        where: {
          organizationId: req.user.organizationId,
          category: { in: LEGACY_DISCOVERY_CATEGORIES },
          isActive: true,
        },
        orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
        select: { id: true, category: true, value: true, displayOrder: true },
      });
      const grouped = {};
      for (const cat of LEGACY_DISCOVERY_CATEGORIES) grouped[cat] = [];
      for (const item of fallback) { if (grouped[item.category]) grouped[item.category].push(item); }
      return success(res, grouped);
    }

    // Group by logical key (strip prefix so frontend receives 'industry', 'company_size', etc.)
    const logicalCategories = stripPrefix
      ? targetCategories.map(c => c.replace(stripPrefix, ''))
      : targetCategories;

    const grouped = {};
    for (const logicalKey of logicalCategories) grouped[logicalKey] = [];
    for (const item of items) {
      const logicalKey = stripPrefix ? item.category.replace(stripPrefix, '') : item.category;
      if (grouped[logicalKey]) grouped[logicalKey].push(item);
    }

    return success(res, grouped);
  } catch (err) {
    return error(res, 'Failed to fetch discovery dropdown values', 500);
  }
}

// GET /api/dropdowns/all — org_admin only
// Returns a flat array of every DropdownConfig row for the org (including disabled).
// Every item has a real UUID in its `id` field so the settings UI can call
// PATCH /api/dropdowns/:id and DELETE /api/dropdowns/:id directly.
async function listAllCategories(req, res) {
  try {
    const items = await prisma.dropdownConfig.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
      select: {
        id: true,
        category: true,
        value: true,
        displayOrder: true,
        isActive: true,
        createdAt: true,
      },
    });
    return success(res, items);
  } catch (err) {
    return error(res, 'Failed to fetch dropdown categories', 500);
  }
}

// POST /api/dropdowns — org_admin only
async function addValue(req, res) {
  try {
    const { category, value, displayOrder } = req.body;
    if (!category || !value?.trim()) {
      return error(res, "category and value are required", 400);
    }
    if (!VALID_CATEGORIES.includes(category)) {
      return error(res, `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}`, 400);
    }

    const item = await prisma.dropdownConfig.create({
      data: {
        organizationId: req.user.organizationId,
        category,
        value: value.trim(),
        displayOrder: displayOrder || 0,
      },
    });
    return success(res, item, "Dropdown value added", 201);
  } catch (err) {
    if (err.code === "P2002") {
      return error(res, "This value already exists in this category", 409);
    }
    return error(res, "Failed to add dropdown value", 500);
  }
}

// PATCH /api/dropdowns/:id — org_admin only
async function updateValue(req, res) {
  try {
    const { value, displayOrder, isActive } = req.body;

    logger.info('updateValue', {
      id: req.params.id,
      orgId: req.user.organizationId,
      body: req.body,
      receivedIsActive: isActive,
      isActiveType: typeof isActive,
    });

    const existing = await prisma.dropdownConfig.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) {
      logger.warn('updateValue: not found', { id: req.params.id, orgId: req.user.organizationId });
      return error(res, 'Dropdown value not found', 404);
    }

    // Coerce isActive to boolean in case the frontend sends a string
    const isActiveValue = isActive != null
      ? isActive === 'false' ? false : isActive === 'true' ? true : Boolean(isActive)
      : undefined;

    const updateData = {
      ...(value != null && { value: value.trim() }),
      ...(displayOrder != null && { displayOrder }),
      ...(isActiveValue !== undefined && { isActive: isActiveValue }),
    };

    logger.info('updateValue: applying', { id: req.params.id, updateData });

    const updated = await prisma.dropdownConfig.update({
      where: { id: req.params.id },
      data: updateData,
    });
    return success(res, updated, 'Dropdown value updated');
  } catch (err) {
    logger.error('updateValue failed', { id: req.params.id, error: err.message, code: err.code });
    if (err.code === 'P2002') {
      return error(res, 'This value already exists in this category', 409);
    }
    return error(res, 'Failed to update dropdown value', 500);
  }
}

// DELETE /api/dropdowns/:id — org_admin only
async function deleteValue(req, res) {
  try {
    logger.info('deleteValue', { id: req.params.id, orgId: req.user.organizationId });

    const existing = await prisma.dropdownConfig.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) {
      logger.warn('deleteValue: not found', { id: req.params.id, orgId: req.user.organizationId });
      return error(res, 'Dropdown value not found', 404);
    }

    await prisma.dropdownConfig.delete({ where: { id: req.params.id } });

    logger.info('deleteValue: deleted', { id: req.params.id, value: existing.value, category: existing.category });
    return success(res, { id: req.params.id }, 'Dropdown value deleted');
  } catch (err) {
    logger.error('deleteValue failed', { id: req.params.id, error: err.message, code: err.code });
    return error(res, 'Failed to delete dropdown value', 500);
  }
}

// POST /api/dropdowns/seed — admin only
// Seeds (or re-seeds) all default dropdown values for the requesting org.
// Safe to call multiple times; existing values are never duplicated.
async function seedOrgDropdowns(req, res) {
  try {
    await seedDefaultDropdowns(req.user.organizationId);
    // Return how many active entries now exist
    const count = await prisma.dropdownConfig.count({
      where: { organizationId: req.user.organizationId, isActive: true },
    });
    return success(res, { seeded: true, totalActiveValues: count }, 'Default dropdown values seeded successfully');
  } catch (err) {
    return error(res, 'Failed to seed dropdown values', 500);
  }
}

module.exports = { listByCategory, listActive, listDiscoveryDropdowns, listAllCategories, addValue, updateValue, deleteValue, seedDefaultDropdowns, seedOrgDropdowns };

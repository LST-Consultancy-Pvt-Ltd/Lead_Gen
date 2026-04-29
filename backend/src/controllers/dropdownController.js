/**
 * dropdownController.js
 * Admin-configurable dropdown values for CRM fields
 */

const prisma = require("../utils/prisma");
const { success, error } = require("../utils/response");

const VALID_CATEGORIES = [
  "lead_source",
  "industry",
  "location",
  "budget_range",
  "pipeline_stage",
  "business_line",
  "loss_reason",
  // Discovery scan fields
  "company_size",
  "company_type",
  "decision_maker",
  "preferred_contact_channel",
  "seniority_level",
  "annual_revenue_range",
];

// Default values seeded for every new organisation
const DEFAULT_DROPDOWN_SEEDS = [
  // ── Industry ──────────────────────────────────────────────────────────────
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
  // ── Company size ─────────────────────────────────────────────────────────
  { category: 'company_size', values: [
    'Any Size', '1-10 (Micro)', '11-50 (Small)', '51-200 (Mid-size)',
    '201-500 (Growing)', '501-1000 (Large)', '1000-5000 (Enterprise)',
    '5000+ (Global Enterprise)',
  ]},
  // ── Company type ─────────────────────────────────────────────────────────
  { category: 'company_type', values: [
    'Any', 'Private Limited', 'Public Listed', 'Startup', 'MNC', 'SME',
    'Government / PSU', 'NGO / Non-profit', 'Partnership Firm', 'LLP',
    'Sole Proprietorship', 'Family Business',
  ]},
  // ── Decision maker ───────────────────────────────────────────────────────
  { category: 'decision_maker', values: [
    'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
    'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
    'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
  ]},
  // ── Contact channel ──────────────────────────────────────────────────────
  { category: 'preferred_contact_channel', values: [
    'Any', 'Email', 'LinkedIn', 'Phone / Call', 'WhatsApp', 'In-person / Visit',
  ]},
  // ── Seniority level ──────────────────────────────────────────────────────
  { category: 'seniority_level', values: [
    'Any', 'C-suite', 'VP / SVP Level', 'Director Level', 'Manager Level',
    'Team Lead', 'Individual Contributor', 'Board / Advisor Level',
  ]},
  // ── Annual revenue range ─────────────────────────────────────────────────
  { category: 'annual_revenue_range', values: [
    'Any', 'Under $1M', '$1M – $5M', '$5M – $10M', '$10M – $25M',
    '$25M – $50M', '$50M – $100M', '$100M – $250M', '$250M – $500M',
    '$500M – $1B', 'Above $1B',
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

// GET /api/dropdowns/discovery — all authenticated roles
// Returns all discovery-scan categories grouped in one response.
// Used by the lead discovery form so it only needs one API call.
const DISCOVERY_CATEGORIES = [
  'industry',
  'company_size',
  'company_type',
  'decision_maker',
  'preferred_contact_channel',
  'seniority_level',
  'annual_revenue_range',
];

async function listDiscoveryDropdowns(req, res) {
  try {
    const items = await prisma.dropdownConfig.findMany({
      where: {
        organizationId: req.user.organizationId,
        category: { in: DISCOVERY_CATEGORIES },
        isActive: true,
      },
      orderBy: [{ category: 'asc' }, { displayOrder: 'asc' }],
      select: { id: true, category: true, value: true, displayOrder: true },
    });

    // Group by category and preserve displayOrder sort
    const grouped = {};
    for (const cat of DISCOVERY_CATEGORIES) grouped[cat] = [];
    for (const item of items) {
      if (grouped[item.category]) grouped[item.category].push(item);
    }

    return success(res, grouped);
  } catch (err) {
    return error(res, 'Failed to fetch discovery dropdown values', 500);
  }
}

// GET /api/dropdowns/all — org_admin only, all categories grouped
async function listAllCategories(req, res) {
  try {
    const items = await prisma.dropdownConfig.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: [{ category: "asc" }, { displayOrder: "asc" }],
    });

    const grouped = items.reduce((acc, item) => {
      if (!acc[item.category]) acc[item.category] = [];
      acc[item.category].push(item);
      return acc;
    }, {});

    return success(res, grouped);
  } catch (err) {
    return error(res, "Failed to fetch dropdown categories", 500);
  }
}

// POST /api/dropdowns — all authenticated roles
async function addValue(req, res) {
  try {
    const { category, value, displayOrder } = req.body;
    if (!category || !value?.trim()) {
      return error(res, "category and value are required", 400);
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

// PATCH /api/dropdowns/:id — all authenticated roles
async function updateValue(req, res) {
  try {
    const { value, displayOrder, isActive } = req.body;

    const existing = await prisma.dropdownConfig.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) return error(res, "Dropdown value not found", 404);

    // If disabling, check if any lead record references this value
    if (isActive === false) {
      const categoryFieldMap = {
        lead_source: "source",
        industry: "industry",
        budget_range: "budgetRange",
        business_line: "businessLine",
      };
      const leadField = categoryFieldMap[existing.category];
      if (leadField) {
        const refCount = await prisma.lead.count({
          where: {
            organizationId: req.user.organizationId,
            [leadField]: existing.value,
          },
        });
        if (refCount > 0) {
          return error(
            res,
            `This value cannot be disabled because ${refCount} lead(s) reference it. Update those leads first.`,
            400,
          );
        }
      }
    }

    const updated = await prisma.dropdownConfig.update({
      where: { id: req.params.id },
      data: {
        ...(value != null && { value: value.trim() }),
        ...(displayOrder != null && { displayOrder }),
        ...(isActive != null && { isActive }),
      },
    });
    return success(res, updated, "Dropdown value updated");
  } catch (err) {
    return error(res, "Failed to update dropdown value", 500);
  }
}

// DELETE /api/dropdowns/:id — all authenticated roles
async function deleteValue(req, res) {
  try {
    const existing = await prisma.dropdownConfig.findFirst({
      where: { id: req.params.id, organizationId: req.user.organizationId },
    });
    if (!existing) return error(res, "Dropdown value not found", 404);

    // Check if any lead record references this value before deleting
    const categoryFieldMap = {
      lead_source: "source",
      industry: "industry",
      location: "location",
      budget_range: "budgetRange",
      business_line: "businessLine",
    };
    const leadField = categoryFieldMap[existing.category];
    if (leadField) {
      const refCount = await prisma.lead.count({
        where: {
          organizationId: req.user.organizationId,
          [leadField]: existing.value,
        },
      });
      if (refCount > 0) {
        return error(
          res,
          `This value cannot be deleted because ${refCount} lead(s) reference it. Update those leads first.`,
          400,
        );
      }
    }

    await prisma.dropdownConfig.delete({
      where: { id: req.params.id },
    });
    return success(res, null, "Dropdown value deleted");
  } catch (err) {
    return error(res, "Failed to delete dropdown value", 500);
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

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
  // Settings-managed dynamic field categories
  "requirement_type",
  "pipeline",
  "timeline",
  "lead_status",
  "status",
  "source",
];

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
        location: "location",
        budget_range: "budgetRange",
        pipeline_stage: "pipeline",
        business_line: "businessLine",
        pipeline: "pipeline",
        budget_range: "budgetRange",
        timeline: "timeline",
        lead_status: "status",
        status: "status",
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
      pipeline_stage: "pipeline",
      business_line: "businessLine",
      pipeline: "pipeline",
      timeline: "timeline",
      lead_status: "status",
      status: "status",
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

module.exports = { listByCategory, listAllCategories, addValue, updateValue, deleteValue };

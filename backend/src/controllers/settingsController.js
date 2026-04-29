/**
 * settingsController.js
 * Organisation-level settings (stored in Organization.settings JSON field)
 */

const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');

// GET /api/settings — all authenticated roles, returns org settings
async function getSettings(req, res) {
  try {
    const org = req.user.organization;
    const settings = (typeof org.settings === 'object' && org.settings !== null)
      ? org.settings
      : {};
    return success(res, settings);
  } catch (err) {
    return error(res, 'Failed to fetch settings', 500);
  }
}

// PATCH /api/settings — admin only, merges new values into org settings
async function updateSettings(req, res) {
  try {
    const org = req.user.organization;
    const existing = (typeof org.settings === 'object' && org.settings !== null)
      ? org.settings
      : {};

    const allowedKeys = ['followUpAlertThresholdDays', 'stuckDealThresholdDays'];
    const updates = {};
    for (const key of allowedKeys) {
      if (req.body[key] !== undefined) {
        const val = Number(req.body[key]);
        if (!Number.isFinite(val) || val < 1) {
          return error(res, `${key} must be a positive number`, 400);
        }
        updates[key] = val;
      }
    }

    const merged = { ...existing, ...updates };

    const updated = await prisma.organization.update({
      where: { id: org.id },
      data: { settings: merged },
    });

    const result = (typeof updated.settings === 'object' && updated.settings !== null)
      ? updated.settings
      : {};

    return success(res, result, 'Settings updated');
  } catch (err) {
    return error(res, 'Failed to update settings', 500);
  }
}

module.exports = { getSettings, updateSettings };

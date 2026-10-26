/**
 * Helpers for the multi-select lead filters (status / owner / follow-up), which
 * arrive as a single value or a comma-separated list.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

// "future" is the original single-select value (tomorrow onwards), kept for old links
const FOLLOW_UP_BUCKETS = ['overdue', 'today', 'tomorrow', 'week', 'later', 'future', 'none'];

function toList(value) {
  if (value === undefined || value === null || value === '') return [];
  const parts = Array.isArray(value) ? value : String(value).split(',');
  return parts.map((v) => String(v).trim()).filter(Boolean);
}

/** Owner filter: user ids, where the special value "unassigned" means no owner. */
function ownerWhere(owners) {
  const ids = owners.filter((o) => o !== 'unassigned');
  const unassigned = owners.includes('unassigned');
  if (!ids.length && !unassigned) return null;
  if (!ids.length) return { assignedToId: null };
  if (!unassigned) return { assignedToId: { in: ids } };
  return { OR: [{ assignedToId: { in: ids } }, { assignedToId: null }] };
}

/**
 * Start of "today" for the viewer. tzOffset is the browser's
 * Date.getTimezoneOffset() in minutes (IST = -330); without it the server's
 * local day is used, as before.
 */
function startOfToday(now, tzOffset) {
  if (tzOffset === undefined || tzOffset === null || tzOffset === '') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  const offsetMs = Number(tzOffset) * 60 * 1000;
  const local = new Date(now.getTime() - offsetMs);
  return new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) + offsetMs);
}

/**
 * Follow-up date filter, by day relative to the viewer's today:
 *   overdue  → before today        today → today          tomorrow → tomorrow
 *   week     → today … 6 days on   later → 7+ days on     none     → no date set
 * Several buckets match any of them. Unknown values are ignored.
 */
function followUpWhere(buckets, { tzOffset, now = new Date() } = {}) {
  const picked = buckets.filter((b) => FOLLOW_UP_BUCKETS.includes(b));
  if (!picked.length) return null;
  const today = startOfToday(now, tzOffset);
  const day = (n) => new Date(today.getTime() + n * DAY_MS);
  const ranges = {
    overdue: { lt: today },
    today: { gte: today, lt: day(1) },
    tomorrow: { gte: day(1), lt: day(2) },
    week: { gte: today, lt: day(7) },
    later: { gte: day(7) },
    future: { gte: day(1) },
  };
  const conds = picked.map((b) => ({ followUpDate: b === 'none' ? null : ranges[b] }));
  return conds.length === 1 ? conds[0] : { OR: conds };
}

module.exports = { toList, ownerWhere, followUpWhere, FOLLOW_UP_BUCKETS };

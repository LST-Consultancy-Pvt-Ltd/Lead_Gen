/**
 * Lead status helpers — the single place that decides how a status string is
 * written and how it is matched.
 *
 * A status is admin-configured free text ("Proposal Sent", category
 * `lead_status` in DropdownConfig). It is stored on the lead as a canonical
 * slug: lower case, spaces collapsed to underscores ("proposal_sent").
 *
 * Rows written before this was centralised carry the same status with spaces
 * instead ("proposal sent"), because the create/import paths only lowercased.
 * Reads therefore have to match every spelling of the same logical status, or
 * those leads become unreachable through the status filter.
 */

/** "Proposal Sent" / " proposal  sent " → "proposal_sent". Null/undefined pass through. */
function normalizeStatus(value) {
  if (value === undefined || value === null) return value;
  return String(value).trim().toLowerCase().replace(/\s+/g, '_');
}

/**
 * Every spelling of one status that may exist in the database, canonical first:
 * "Proposal Sent" → ["proposal_sent", "proposal sent"]; "new" → ["new"].
 */
function statusVariants(value) {
  const canonical = normalizeStatus(value);
  if (!canonical) return [];
  const spaced = canonical.replace(/_/g, ' ');
  return spaced === canonical ? [canonical] : [canonical, spaced];
}

/**
 * Prisma `where` fragment for a status filter (one value or several).
 * Returns null when nothing is selected, so the caller can skip it.
 *
 * Case-insensitive, and tolerant of both spellings. Always a single OR over
 * `status` alone, so the caller can AND it with the role scope and the other
 * filters without any of them being widened or overwritten.
 */
function statusWhere(values) {
  const list = Array.isArray(values) ? values : [values];
  const seen = new Set();
  for (const v of list) {
    for (const variant of statusVariants(v)) seen.add(variant);
  }
  if (!seen.size) return null;
  return { OR: [...seen].map((v) => ({ status: { equals: v, mode: 'insensitive' } })) };
}

module.exports = { normalizeStatus, statusVariants, statusWhere };

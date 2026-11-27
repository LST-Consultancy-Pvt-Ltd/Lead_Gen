/**
 * dropdownUsage.js — is an admin-configured dropdown value still referenced?
 *
 * Dropdown values are free text copied onto records (a lead's `source` is the
 * string "LinkedIn", not a foreign key). Deleting a value therefore cannot
 * cascade, and records that still carry it are left pointing at a value that no
 * longer exists in the picklist: the field renders a stale string and the
 * filters for that category stop matching it.
 *
 * So `deleteValue` asks here first, and refuses the delete while anything still
 * uses the value, naming the records so the admin can reassign them.
 */

const prisma = require('./prisma');
const { statusWhere } = require('./leadStatus');

// How many record names travel back to the UI. The count is always exact.
const SAMPLE_LIMIT = 10;

/** Case-insensitive exact match on one Lead column. */
const leadField = (field) => (value) => ({ [field]: { equals: value, mode: 'insensitive' } });

/**
 * category → which model and column holds it.
 *
 * Categories absent from this map are used only to build Lead Discovery search
 * criteria and are never written onto a record, so deleting one is always safe.
 */
const USAGE_MAP = {
  // ── Leads ────────────────────────────────────────────────────────────────
  // Status is stored as a slug ("proposal_sent") and older rows use spaces,
  // so it matches through the shared status helper rather than on raw text.
  lead_status:  { model: 'lead', label: 'lead',        where: (v) => statusWhere(v) },
  lead_source:  { model: 'lead', label: 'lead',        where: leadField('source') },
  lead_type:    { model: 'lead', label: 'lead',        where: leadField('leadType') },
  industry:     { model: 'lead', label: 'lead',        where: leadField('industry') },
  location:     { model: 'lead', label: 'lead',        where: leadField('location') },
  company_size: { model: 'lead', label: 'lead',        where: leadField('companySize') },
  pipeline_stage: { model: 'lead', label: 'lead',      where: leadField('pipeline') },
  job_title:    { model: 'lead', label: 'lead',        where: leadField('contactTitle') },

  // ── Opportunities ────────────────────────────────────────────────────────
  opportunity_business_line: {
    model: 'opportunity', label: 'opportunity',
    where: (v) => ({ businessLine: { equals: v, mode: 'insensitive' } }),
  },
  loss_reason: {
    model: 'opportunity', label: 'opportunity',
    where: (v) => ({ wonLostReason: { equals: v, mode: 'insensitive' } }),
  },
};

/** Human label for a lead row in the "still in use" list. */
function leadName(lead) {
  return lead.companyName || lead.contactName || lead.contactEmail || 'Untitled lead';
}

/**
 * Who still uses `value` of `category` inside `organizationId`.
 *
 * Returns `{ inUse: false }` for an unmapped category or when nothing matches,
 * otherwise `{ inUse: true, count, entity, records: [{ id, name }] }` where
 * `records` holds at most SAMPLE_LIMIT entries and `count` is the true total.
 */
async function findDropdownUsage(organizationId, category, value) {
  const mapping = USAGE_MAP[category];
  if (!mapping || !value) return { inUse: false };

  const match = mapping.where(value);
  if (!match) return { inUse: false };

  const where = { organizationId, ...match };

  if (mapping.model === 'lead') {
    const [count, rows] = await Promise.all([
      prisma.lead.count({ where }),
      prisma.lead.findMany({
        where,
        select: { id: true, companyName: true, contactName: true, contactEmail: true },
        orderBy: { createdAt: 'desc' },
        take: SAMPLE_LIMIT,
      }),
    ]);
    if (!count) return { inUse: false };
    return {
      inUse: true,
      count,
      entity: mapping.label,
      records: rows.map((r) => ({ id: r.id, name: leadName(r) })),
    };
  }

  const [count, rows] = await Promise.all([
    prisma.opportunity.count({ where }),
    prisma.opportunity.findMany({
      where,
      select: { id: true, title: true, opportunityName: true },
      orderBy: { createdAt: 'desc' },
      take: SAMPLE_LIMIT,
    }),
  ]);
  if (!count) return { inUse: false };
  return {
    inUse: true,
    count,
    entity: mapping.label,
    records: rows.map((r) => ({ id: r.id, name: r.opportunityName || r.title || 'Untitled opportunity' })),
  };
}

module.exports = { findDropdownUsage, USAGE_MAP, SAMPLE_LIMIT };

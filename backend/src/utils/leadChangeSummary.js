/**
 * Builds the "Lead updated" Activity Timeline entry: which fields really changed,
 * with readable labels (and old → new values for short fields).
 */

const FIELD_LABELS = {
  companyName: 'Company name',
  website: 'Website',
  linkedinUrl: 'LinkedIn URL',
  industry: 'Industry',
  companySize: 'Company size',
  location: 'Location',
  description: 'Description',
  contactName: 'Contact name',
  contactTitle: 'Contact title',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone',
  contactLinkedin: 'Contact LinkedIn',
  companyPhone: 'Company phone',
  firstName: 'First name',
  lastName: 'Last name',
  techStack: 'Tech stack',
  leadScore: 'Lead score',
  intentScore: 'Intent score',
  intentLevel: 'Intent level',
  status: 'Status',
  assignedToId: 'Assigned to',
  opportunity: 'Opportunity note',
  notes: 'Notes',
  source: 'Source',
  subSource: 'Sub-source',
  sourceUrl: 'Source URL',
  pipeline: 'Pipeline',
  followUpDate: 'Follow-up date',
  leadCost: 'Lead cost',
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  utmContent: 'UTM content',
  keyword: 'Keyword',
  accountId: 'Account',
  requirementType: 'Requirement type',
  requirementDescription: 'Requirement description',
  budgetRange: 'Budget range',
  timeline: 'Timeline',
  temperature: 'Temperature',
  disqualificationReason: 'Disqualification reason',
  lastContactedDate: 'Last contacted date',
  lastContactedAt: 'Last contacted',
  matchScore: 'Match score',
  leadType: 'Lead type',
  customFields: 'Custom fields',
};

// Logged by their own, more specific timeline entries (status change / assignment)
const OWN_ENTRY_FIELDS = new Set(['status', 'assignedToId']);
// Never part of a user-facing change summary
const IGNORED_FIELDS = new Set(['id', 'organizationId', 'createdById', 'createdAt', 'updatedAt']);
// Values that are long or not meaningful to show inline — only the label is shown
const LABEL_ONLY_FIELDS = new Set([
  'description', 'notes', 'opportunity', 'requirementDescription', 'disqualificationReason',
  'aiSummary', 'aiPitch', 'accountId', 'customFields', 'intentSignals', 'funding', 'jobPostings',
]);
const DATE_FIELDS = new Set(['followUpDate', 'lastContactedDate', 'lastContactedAt']);
const MAX_INLINE = 40;

/** Readable label for a Lead field; unknown camelCase names become "Sentence case". */
function fieldLabel(field) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = String(field).replace(/Id$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Comparable form of a value (dates by calendar day, structures as JSON, empty → null). */
function normalize(field, v) {
  if (v === undefined || v === null || v === '') return null;
  if (DATE_FIELDS.has(field) || v instanceof Date) {
    const d = new Date(v);
    return isNaN(d.getTime()) ? String(v) : d.toISOString().slice(0, 10);
  }
  if (Array.isArray(v) && v.length === 0) return null;
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function display(field, v) {
  if (v === null) return '—';
  if (DATE_FIELDS.has(field)) {
    return new Date(`${v}T00:00:00Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  }
  if (field === 'temperature' || field === 'intentLevel' || field === 'leadType') {
    return v.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }
  if (v.startsWith('[') || v.startsWith('{')) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.join(', ');
    } catch { /* fall through */ }
  }
  return v;
}

/**
 * Fields of `requestedKeys` whose value really changed between `before` and `after`,
 * excluding fields that have their own timeline entry.
 * Returns [{ field, label, from, to }] — from/to are omitted for long or opaque fields.
 */
function describeLeadChanges(before, after, requestedKeys) {
  const changes = [];
  for (const field of requestedKeys || []) {
    if (OWN_ENTRY_FIELDS.has(field) || IGNORED_FIELDS.has(field)) continue;
    if (!after || !(field in after)) continue; // not a stored lead field (or dropped by the service)
    const prev = normalize(field, before?.[field]);
    const next = normalize(field, after[field]);
    if (prev === next) continue;
    const change = { field, label: fieldLabel(field) };
    if (!LABEL_ONLY_FIELDS.has(field)) {
      const from = display(field, prev);
      const to = display(field, next);
      if (from.length <= MAX_INLINE && to.length <= MAX_INLINE) Object.assign(change, { from, to });
    }
    changes.push(change);
  }
  return changes;
}

/** "Lead updated: Follow-up date (12 Oct 2026 → 20 Oct 2026), Notes" */
function formatLeadChanges(changes) {
  return 'Lead updated: ' + changes
    .map((c) => (c.from !== undefined ? `${c.label} (${c.from} → ${c.to})` : c.label))
    .join(', ');
}

module.exports = { describeLeadChanges, formatLeadChanges, fieldLabel, FIELD_LABELS };

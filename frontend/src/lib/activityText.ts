// Older "Lead updated" timeline entries list raw database field names
// ("Lead updated: assignedToId, followUpDate"). New entries are written with
// readable labels by the backend; this turns the old ones into the same wording.

const FIELD_LABELS: Record<string, string> = {
  assignedToId: 'Assigned to',
  followUpDate: 'Follow-up date',
  companyName: 'Company name',
  contactName: 'Contact name',
  contactTitle: 'Contact title',
  contactEmail: 'Contact email',
  contactPhone: 'Contact phone',
  contactLinkedin: 'Contact LinkedIn',
  companyPhone: 'Company phone',
  linkedinUrl: 'LinkedIn URL',
  companySize: 'Company size',
  techStack: 'Tech stack',
  leadScore: 'Lead score',
  intentScore: 'Intent score',
  intentLevel: 'Intent level',
  opportunity: 'Opportunity note',
  subSource: 'Sub-source',
  sourceUrl: 'Source URL',
  leadCost: 'Lead cost',
  utmSource: 'UTM source',
  utmMedium: 'UTM medium',
  utmCampaign: 'UTM campaign',
  utmContent: 'UTM content',
  accountId: 'Account',
  requirementType: 'Requirement type',
  requirementDescription: 'Requirement description',
  budgetRange: 'Budget range',
  disqualificationReason: 'Disqualification reason',
  lastContactedDate: 'Last contacted date',
  lastContactedAt: 'Last contacted',
  matchScore: 'Match score',
  leadType: 'Lead type',
  customFields: 'Custom fields',
  firstName: 'First name',
  lastName: 'Last name',
};

function fieldLabel(field: string) {
  if (FIELD_LABELS[field]) return FIELD_LABELS[field];
  const words = field.replace(/Id$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

const LEGACY_UPDATED = /^Lead updated: ([a-z][A-Za-z0-9]*(?:, [a-z][A-Za-z0-9]*)*)$/;

/** Activity text for display: rewrites legacy raw field names, leaves everything else as is. */
export function readableActivityText(text?: string | null): string {
  if (!text) return '';
  const m = text.match(LEGACY_UPDATED);
  if (!m) return text;
  return 'Lead updated: ' + m[1].split(', ').map(fieldLabel).join(', ');
}

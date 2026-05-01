// ── User Types ─────────────────────────────────────────────────────────────
export type UserRole = 'super_admin' | 'org_admin' | 'manager' | 'sales_user';

export interface User {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  avatar?: string;
  isActive?: boolean;
  managerId?: string;
  createdAt: string;
}

// ── Lead Types ─────────────────────────────────────────────────────────────
export interface Lead {
  id: string;
  companyName: string;
  website?: string;
  industry?: string;
  location?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTitle?: string;
  source?: string;
  status: 'new' | 'contacted' | 'replied' | 'meeting_booked' | 'qualified' | 'disqualified' | 'closed_won' | 'closed_lost' | 'warm' | 'hot' | 'proposal_sent' | 'negotiation' | 'won' | 'lost' | 'on_hold' | 'unqualified';
  leadScore: number;
  intentScore: number;
  techStack?: string[];
  intentSignals?: string[] | Array<{ text: string }>;
  aiSummary?: string;
  assignedTo?: User;
  assignedToId?: string;
  createdBy?: User;
  createdById?: string;
  // Additional CRM fields
  followUpDate?: string;
  requirementType?: string[];
  requirementDescription?: string;
  budget?: string;
  budgetRange?: string;
  timeline?: string;
  temperature?: 'hot' | 'warm' | 'cold' | 'prospect' | 'lost' | 'won';
  disqualificationReason?: string;
  campaignSource?: string;
  notes?: string;
  // Pipeline & UTM fields
  pipeline?: string;
  leadCost?: number;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  subSource?: string;
  accountId?: string;
  importBatchId?: string;
  createdAt: string;
  updatedAt: string;
}

// ── Activity Types ─────────────────────────────────────────────────────────
export interface Activity {
  id: string;
  type: 'call' | 'meeting' | 'note' | 'email' | 'whatsapp';
  description: string;
  outcome?: string;
  leadId?: string;
  opportunityId?: string;
  createdBy: User;
  createdById: string;
  createdAt: string;
}

// ── Account Types ──────────────────────────────────────────────────────────
export interface Account {
  id: string;
  companyName: string;
  industry?: string;
  website?: string;
  companySize?: string;
  country?: string;
  state?: string;
  accountOwner?: User;
  accountOwnerId?: string;
  customerType: 'prospect' | 'customer' | 'partner';
  createdAt: string;
}

// ── Contact Types ──────────────────────────────────────────────────────────
export interface Contact {
  id: string;
  name: string;
  email: string;
  phone?: string;
  designation?: string;
  linkedAccount?: Account;
  linkedAccountId?: string;
  decisionMaker: boolean;
  influenceLevel: 'high' | 'medium' | 'low';
  createdAt: string;
}

// ── Opportunity Types ──────────────────────────────────────────────────────
export interface Opportunity {
  id: string;
  opportunityName: string;
  account?: Account;
  accountId?: string;
  contact?: Contact;
  contactId?: string;
  businessLine: 'netsuite' | 'salesforce' | 'dev' | 'saas' | 'training';
  stage: 'qualified' | 'demo' | 'proposal' | 'negotiation' | 'closed_won' | 'closed_lost';
  dealValue: number;
  expectedCloseDate?: string;
  probability: number;
  salesOwner?: User;
  salesOwnerId?: string;
  notes?: string;
  createdAt: string;
}

// ── Campaign Types ─────────────────────────────────────────────────────────
export interface Campaign {
  id: string;
  campaignName: string;
  channel: 'meta' | 'google' | 'email' | 'webinar';
  budget: number;
  startDate: string;
  endDate?: string;
  totalLeads: number;
  qualifiedLeads: number;
  revenueGenerated: number;
  costPerLead: number;
  roi: number;
  createdAt: string;
}

// ── Form Types ─────────────────────────────────────────────────────────────
export interface CreateLeadInput {
  companyName: string;
  website?: string;
  industry?: string;
  location?: string;
  contactName?: string;
  contactTitle?: string;
  contactEmail?: string;
  contactPhone?: string;
  source?: string;
  assignedToId?: string;
  status?: string;
  // Pipeline & UTM fields
  pipeline?: string;
  followUpDate?: string;
  requirementType?: string[];
  requirementDescription?: string;
  budgetRange?: string;
  timeline?: string;
  temperature?: 'hot' | 'warm' | 'cold' | 'prospect' | 'lost' | 'won';
  disqualificationReason?: string;
  leadCost?: number;
  subSource?: string;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
}

// ── Invitation Types ───────────────────────────────────────────────────────
export interface Invitation {
  id: string;
  email: string;
  role: 'org_admin' | 'manager' | 'sales_user';
  status: 'pending' | 'accepted' | 'expired';
  invitedById: string;
  invitedBy?: User;
  managerId?: string;
  expiresAt: string;
  createdAt: string;
}

// ── ImportBatch Types ──────────────────────────────────────────────────────
export interface ImportBatch {
  id: string;
  fileName: string;
  totalRows: number;
  successRows: number;
  failedRows: number;
  status: 'processing' | 'completed' | 'failed';
  mode: 'insert' | 'update' | 'upsert';
  errors: any[];
  assignedToId?: string;
  createdAt: string;
}

// ── Notification Types ─────────────────────────────────────────────────────
export interface Notification {
  id: string;
  userId: string;
  type: 'lead_assigned' | 'lead_updated' | 'lead_commented' | 'system';
  title: string;
  message: string;
  isRead: boolean;
  leadId?: string;
  opportunityId?: string;
  metadata?: any;
  createdAt: string;
  readAt?: string;
}

// ── Constants ──────────────────────────────────────────────────────────────
export const ROLES = {
  ORG_ADMIN: 'org_admin' as const,
  MANAGER: 'manager' as const,
  SALES_USER: 'sales_user' as const,
};

export const PIPELINE_OPTIONS = [
  { value: 'netsuite', label: 'NetSuite Services' },
  { value: 'salesforce', label: 'Salesforce Services' },
  { value: 'dev', label: 'Custom Development' },
  { value: 'saas', label: 'SaaS Products' },
  { value: 'training', label: 'Training' },
] as const;

export const LEAD_SOURCES = [
  'Meta Ads',
  'Google Ads',
  'Website Forms',
  'Referrals',
  'Cold Outreach',
  'Emails',
  'Calls',
  'Events/Webinars',
] as const;

export interface CreateActivityInput {
  type: 'call' | 'meeting' | 'note' | 'email' | 'whatsapp';
  description: string;
  outcome?: string;
  leadId?: string;
  opportunityId?: string;
  activityDate?: string;
  nextActionDate?: string;
}

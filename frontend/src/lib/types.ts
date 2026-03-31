// ── User Types ─────────────────────────────────────────────────────────────
export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'sales_manager' | 'sales_user';
  avatar?: string;
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
  status: 'new' | 'contacted' | 'replied' | 'meeting_booked' | 'qualified' | 'disqualified';
  leadScore: number;
  intentScore: number;
  techStack?: string[];
  intentSignals?: string[] | Array<{ text: string }>;
  aiSummary?: string;
  assignedTo?: User;
  assignedToId?: string;
  createdBy?: User;
  createdById?: string;
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
  contactEmail?: string;
  contactPhone?: string;
  source?: string;
  assignedToId?: string;
  status?: string;
}

export interface CreateActivityInput {
  type: 'call' | 'meeting' | 'note' | 'email' | 'whatsapp';
  description: string;
  outcome?: string;
  leadId?: string;
  opportunityId?: string;
}

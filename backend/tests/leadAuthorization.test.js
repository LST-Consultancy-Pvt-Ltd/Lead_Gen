/**
 * Lead authorization regression tests.
 *
 * Runs the real controllers/services against an in-memory Prisma fake that evaluates the
 * generated `where` clauses (AND / OR / in / notIn / contains / comparisons / equality /
 * relation filters / `some`). A scope that is dropped, widened or overwritten by a search
 * term therefore shows up as a failing test. No real PostgreSQL / HTTP server is involved.
 *
 * Run: npm test
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const ORG_A = 'orgA';
const ORG_B = 'orgB';
const NAMES = { admin: 'Admin', mgr1: 'Mgr1', mgr2: 'Mgr2', aditi: 'Aditi', sheetal: 'Sheetal', rahul: 'Rahul', adminB: 'AdminB', repB: 'RepB' };
const mkUser = (id, role, organizationId, managerId = null) => ({
  id, name: NAMES[id] || id, email: `${id}@x.com`, role, organizationId, managerId, isActive: true,
});

// ── In-memory state ──────────────────────────────────────────────────────────
let users, leads, contacts, accounts, opportunities, activities, campaigns, campaignLeads, emailLogs;
let leadWrites; // every data payload written to a lead
let sentEmails; // campaign / outreach emails

// relation resolvers used by relation filters (`lead: {...}`, `leads: { some }` …)
const RELS = {
  lead: (r) => leads.find((l) => l.id === r.leadId) || null,
  opportunity: (r) => opportunities.find((o) => o.id === r.opportunityId) || null,
  leads: (r) => leads.filter((l) => l.accountId === r.id),
};

const OPS = ['in', 'notIn', 'contains', 'gte', 'gt', 'lte', 'lt', 'not', 'equals'];
function matches(row, where) {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => {
    if (k === 'AND') return v.every((c) => matches(row, c));
    if (k === 'OR') return v.some((c) => matches(row, c));
    if (v && typeof v === 'object' && !(v instanceof Date)) {
      if (k in RELS && !Object.keys(v).some((x) => OPS.includes(x) && x !== 'not')) {
        if (k === 'leads') return RELS.leads(row).some((x) => matches(x, v.some));
        const rel = RELS[k](row);
        return !!rel && matches(rel, v);
      }
      const val = row[k];
      return Object.entries(v).every(([op, arg]) => {
        switch (op) {
          case 'in': return arg.includes(val);
          case 'notIn': return !arg.includes(val);
          case 'contains': return (val || '').toLowerCase().includes(String(arg).toLowerCase());
          case 'gte': return val != null && val >= arg;
          case 'gt': return val != null && val > arg;
          case 'lte': return val != null && val <= arg;
          case 'lt': return val != null && val < arg;
          case 'not': return (val ?? null) !== arg;
          case 'equals': return String(val).toLowerCase() === String(arg).toLowerCase();
          case 'mode': return true;
          default: throw new Error(`fake prisma: unsupported operator ${op} on ${k}`);
        }
      });
    }
    return (row[k] ?? null) === v;
  });
}
const table = (rows) => ({
  // return copies, like Prisma does (later updates must not change rows already read)
  findMany: async ({ where, take, skip } = {}) => rows().filter((r) => matches(r, where)).slice(skip || 0, (skip || 0) + (take ?? Infinity)).map((r) => ({ ...r })),
  findFirst: async ({ where } = {}) => { const r = rows().find((x) => matches(x, where)); return r ? { ...r } : null; },
  findUnique: async ({ where }) => { const r = rows().find((x) => matches(x, where)); return r ? { ...r } : null; },
  count: async ({ where } = {}) => rows().filter((r) => matches(r, where)).length,
});
const writable = (rows, onWrite) => ({
  ...table(rows),
  update: async ({ where, data }) => {
    const r = rows().find((x) => x.id === where.id);
    onWrite?.(where.id, data);
    Object.assign(r, data);
    return { ...r };
  },
  updateMany: async ({ where, data }) => {
    const hit = rows().filter((r) => matches(r, where));
    hit.forEach((r) => { onWrite?.(r.id, data); Object.assign(r, data); });
    return { count: hit.length };
  },
  delete: async ({ where }) => {
    const arr = rows();
    arr.splice(arr.findIndex((x) => x.id === where.id), 1);
  },
});

const prismaFake = {
  user: table(() => users),
  lead: {
    ...writable(() => leads, (id, data) => leadWrites.push({ id, data })),
    create: async ({ data }) => { const l = { id: `new-${leads.length}`, ...data }; leads.push(l); return { ...l }; },
  },
  contact: writable(() => contacts),
  account: writable(() => accounts),
  opportunity: {
    ...writable(() => opportunities),
    create: async ({ data }) => { const o = { id: `opp-new-${opportunities.length}`, ...data }; opportunities.push(o); return { ...o }; },
  },
  activityLog: {
    ...writable(() => activities),
    create: async ({ data }) => { const a = { id: `act-new-${activities.length}`, ...data }; activities.push(a); return { ...a }; },
  },
  campaign: {
    findFirst: async ({ where, include }) => {
      const c = campaigns.find((x) => matches(x, where));
      if (!c) return null;
      const out = { ...c };
      if (include?.leads) {
        out.leads = campaignLeads
          .filter((cl) => cl.campaignId === c.id && matches(cl, include.leads.where))
          .map((cl) => ({ ...cl, lead: leads.find((l) => l.id === cl.leadId) }));
      }
      if (include?.emails) out.emails = emailLogs.filter((e) => e.campaignId === c.id && matches(e, include.emails.where));
      return out;
    },
    update: async () => ({}),
  },
  campaignLead: { upsert: async ({ create }) => { campaignLeads.push(create); return create; } },
  service: { findMany: async () => [] },
  organization: { findUnique: async () => ({ leadQuota: 100, leadUsed: 0 }), update: async () => ({}) },
  auditLog: { create: async () => ({}) },
  notification: { createMany: async () => ({}), create: async () => ({}) },
};
const prismaPath = require.resolve(path.join(__dirname, '../src/utils/prisma'));
require.cache[prismaPath] = { id: prismaPath, filename: prismaPath, loaded: true, exports: prismaFake };

const src = (p) => path.join(__dirname, '../src', p);

// Stub outgoing email BEFORE the modules that destructure it are loaded
const emailService = require(src('services/emailService'));
emailService.sendEmail = async (args) => { sentEmails.push(args); };
emailService.sendLeadAssignmentEmail = async () => {};

const leadsService = require(src('services/leads.service'));
const activityService = require(src('services/activity.service'));
const opportunityService = require(src('services/opportunity.service'));
const { globalSearch } = require(src('controllers/searchController'));
const { reassignLead: reassignRoute, convertLead: convertRoute } = require(src('controllers/leads.controller'));
const activityController = require(src('controllers/activityController'));
const contactsController = require(src('controllers/contacts.controller'));
const accountsController = require(src('controllers/accounts.controller'));
const campaignController = require(src('controllers/campaignController'));
const leadController = require(src('controllers/leadController'));
const teamController = require(src('controllers/teamController'));
const { requireManagerOrAdmin } = require(src('middleware/rbac'));

// ── Fixtures ─────────────────────────────────────────────────────────────────
const U = (id) => users.find((u) => u.id === id);
const clone = (x) => JSON.parse(JSON.stringify(x));
const lead = (id) => leads.find((l) => l.id === id);
let XYZ_ORIGINAL;
let ACTIVITIES_ORIGINAL;

test.beforeEach(() => {
  users = [
    mkUser('admin', 'org_admin', ORG_A),
    mkUser('mgr1', 'manager', ORG_A),
    mkUser('mgr2', 'manager', ORG_A),
    mkUser('aditi', 'sales_user', ORG_A, 'mgr1'),
    mkUser('sheetal', 'sales_user', ORG_A, 'mgr1'),
    mkUser('rahul', 'sales_user', ORG_A, 'mgr2'),
    mkUser('adminB', 'org_admin', ORG_B),
    mkUser('repB', 'sales_user', ORG_B),
  ];
  const L = (id, extra) => ({ organizationId: ORG_A, contactEmail: `${id}@lead.com`, createdById: 'admin', assignedToId: null, ...extra, id });
  leads = [
    L('xyz', { companyName: 'XYZ Corp', status: 'negotiation', stage: 'proposal', notes: 'Called twice, wants discount',
      description: 'custom desc', customFields: { tier: 'gold' }, assignedToId: 'aditi', accountId: 'acc-xyz' }),
    L('mgr1-created', { companyName: 'XYZ Created By Mgr1', assignedToId: 'aditi', createdById: 'mgr1' }),
    L('mgr1-assigned', { companyName: 'XYZ Assigned To Mgr1', assignedToId: 'mgr1', accountId: 'acc-mgr1' }),
    L('mgr2-assigned', { companyName: 'XYZ Assigned To Mgr2', assignedToId: 'mgr2', accountId: 'acc-mgr2' }),
    L('mgr2-created', { companyName: 'XYZ Created By Mgr2', createdById: 'mgr2' }),
    L('rahul-lead', { companyName: 'XYZ Rahul Deal', assignedToId: 'rahul', accountId: 'acc-rahul' }),
    L('unassigned', { companyName: 'XYZ Unassigned' }),
    L('orgB-lead', { organizationId: ORG_B, companyName: 'XYZ OrgB', assignedToId: 'repB', createdById: 'adminB', accountId: 'acc-orgB' }),
  ];
  XYZ_ORIGINAL = clone(lead('xyz'));
  leadWrites = [];
  sentEmails = [];

  contacts = [
    { id: 'c-xyz', organizationId: ORG_A, leadId: 'xyz', ownerId: 'aditi', createdById: 'aditi', name: 'XYZ contact' },
    { id: 'c-mgr1', organizationId: ORG_A, leadId: 'mgr1-created', ownerId: 'mgr1', createdById: 'mgr1', name: 'Mgr1 contact' },
    { id: 'c-rahul', organizationId: ORG_A, leadId: 'rahul-lead', ownerId: 'rahul', createdById: 'rahul', name: 'Rahul contact' },
    { id: 'c-free-aditi', organizationId: ORG_A, leadId: null, ownerId: 'aditi', createdById: 'aditi', name: 'Unlinked contact aditi' },
    { id: 'c-free-mgr2', organizationId: ORG_A, leadId: null, ownerId: 'mgr2', createdById: 'mgr2', name: 'Unlinked contact mgr2' },
    { id: 'c-orgB', organizationId: ORG_B, leadId: 'orgB-lead', ownerId: 'repB', createdById: 'repB', name: 'OrgB contact' },
  ];
  accounts = [
    { id: 'acc-xyz', organizationId: ORG_A, companyName: 'Acme XYZ account' },
    { id: 'acc-mgr1', organizationId: ORG_A, companyName: 'Mgr1 account' },
    { id: 'acc-mgr2', organizationId: ORG_A, companyName: 'Mgr2 account' },
    { id: 'acc-rahul', organizationId: ORG_A, companyName: 'Rahul account' },
    { id: 'acc-orgB', organizationId: ORG_B, companyName: 'OrgB account' },
  ];
  opportunities = [
    { id: 'opp-xyz', organizationId: ORG_A, leadId: 'xyz', assignedToId: 'aditi', createdById: 'admin', title: 'Opp XYZ', stage: 'proposal' },
    { id: 'opp-mgr1', organizationId: ORG_A, leadId: 'mgr1-created', assignedToId: 'aditi', createdById: 'mgr1', title: 'Opp Mgr1', stage: 'qualified' },
    { id: 'opp-rahul', organizationId: ORG_A, leadId: 'rahul-lead', assignedToId: 'rahul', createdById: 'admin', title: 'Opp Rahul', stage: 'demo' },
    { id: 'opp-orgB', organizationId: ORG_B, leadId: 'orgB-lead', assignedToId: 'repB', createdById: 'adminB', title: 'Opp OrgB', stage: 'demo' },
  ];
  const now = new Date();
  const A = (id, extra) => ({ organizationId: ORG_A, leadId: null, opportunityId: null, activityDate: now, createdAt: now, ...extra, id });
  activities = [
    A('a1', { leadId: 'xyz', userId: 'aditi', action: 'call', description: 'Called customer' }),
    A('a2', { leadId: 'xyz', userId: 'aditi', action: 'note', description: 'Discussed pricing' }),
    A('a3', { leadId: 'mgr1-created', userId: 'mgr1', action: 'call', description: 'Mgr1 call' }),
    A('a4', { userId: 'aditi', action: 'note', description: 'Unlinked personal note' }),
    A('a5', { leadId: 'xyz', opportunityId: 'opp-xyz', userId: 'aditi', action: 'meeting', description: 'Opp meeting' }),
    A('a5b', { opportunityId: 'opp-xyz', userId: 'aditi', action: 'note', description: 'Legacy opp-only activity' }),
    A('a6', { leadId: 'rahul-lead', userId: 'rahul', action: 'call', description: 'Rahul call' }),
    A('a7', { organizationId: ORG_B, leadId: 'orgB-lead', userId: 'repB', action: 'call', description: 'OrgB call' }),
  ];
  ACTIVITIES_ORIGINAL = structuredClone(activities);

  campaigns = [{ id: 'camp1', organizationId: ORG_A, subject: 'Hi {{company}}', bodyTemplate: 'Hello {{name}}' }];
  campaignLeads = ['xyz', 'mgr1-created', 'rahul-lead', 'orgB-lead'].map((leadId) => ({ campaignId: 'camp1', leadId }));
  emailLogs = [
    { id: 'e-xyz', campaignId: 'camp1', leadId: 'xyz' },
    { id: 'e-mgr1', campaignId: 'camp1', leadId: 'mgr1-created' },
    { id: 'e-rahul', campaignId: 'camp1', leadId: 'rahul-lead' },
  ];
});

// ── Helpers ──────────────────────────────────────────────────────────────────
const call = async (fn, req) => {
  const out = { status: 200, headers: {} };
  const res = {
    status(c) { out.status = c; return this; },
    json(b) { out.body = b; return this; },
    setHeader() { return this; },
    send(b) { out.sent = b; return this; },
  };
  await fn(req, res);
  return out;
};
const sorted = (a) => [...a].sort();
const listIds = async (u, params = {}) => {
  const r = await leadsService.getLeads(U(u), { limit: 100, ...params });
  return sorted((r.leads || r.data || []).map((l) => l.id));
};
const globalSearchOf = async (u, q, entity) => {
  const { body } = await call(globalSearch, { query: { q, limit: '20' }, user: U(u) });
  return sorted(((body.data || body).results[entity] || []).map((x) => x.id));
};
const globalIds = (u, q = 'xyz') => globalSearchOf(u, q, 'leads');
const canGet = async (u, id) => (await leadsService.getLeadById(id, U(u))).success === true;
const feedIds = async (u, params = {}, withNew = false) =>
  sorted((await activityService.getActivities({ limit: 200, ...params }, U(u))).activities.map((a) => a.id).filter((id) => withNew || !isNew(id)));
const leadActivityIds = async (u, id) => {
  const r = await call(activityController.getLeadActivities, { params: { leadId: id }, user: U(u) });
  return { status: r.status, ids: sorted((r.body?.data || []).map((a) => a.id).filter((id) => !isNew(id))), all: (r.body?.data || []) };
};
const oppIds = async (u, params = {}) => sorted((await opportunityService.getAll(U(u), params)).opportunities.map((o) => o.id));
// Assignment entries created by the code under test (ids 'act-new-N' in the fake)
const isNew = (id) => id.startsWith('act-new');
const timelineFor = (leadId) => activities.filter((a) => a.action === 'lead_assigned' && a.leadId === leadId);
const NOTE_SEP = '\n\n---NOTE---\n\n';

// ═════════════════════════════════════════════════════════════════════════════
// ADMIN (1-4)
// ═════════════════════════════════════════════════════════════════════════════
const orgALeadIds = () => sorted(leads.filter((l) => l.organizationId === ORG_A).map((l) => l.id));

test('1. admin can view every lead in own organization', async () => {
  assert.deepEqual(await listIds('admin'), orgALeadIds());
  for (const l of orgALeadIds()) assert.equal(await canGet('admin', l), true, l);
});
test('2. admin can search every lead in own organization (list + global)', async () => {
  assert.deepEqual(await listIds('admin', { search: 'xyz' }), orgALeadIds());
  assert.deepEqual(await globalIds('admin'), orgALeadIds());
});
test('3. admin cannot access another organization\'s lead', async () => {
  assert.equal(await canGet('admin', 'orgB-lead'), false);
  assert.equal(await canGet('adminB', 'xyz'), false);
  assert.equal((await leadsService.updateLead('orgB-lead', { notes: 'x' }, U('admin'))).success, false);
  assert.equal((await leadsService.deleteLead('orgB-lead', U('admin'))).success, false);
  assert.equal(lead('orgB-lead').notes, undefined);
});
test('4. admin cannot search another organization\'s lead', async () => {
  assert.ok(!(await listIds('admin', { search: 'xyz' })).includes('orgB-lead'));
  assert.ok(!(await globalIds('admin')).includes('orgB-lead'));
  assert.deepEqual(await globalIds('adminB'), ['orgB-lead']);
  assert.deepEqual(await listIds('adminB', { search: 'xyz' }), ['orgB-lead']);
});

// ═════════════════════════════════════════════════════════════════════════════
// MANAGER (5-13)
// ═════════════════════════════════════════════════════════════════════════════
test('5. manager can view/search a lead created by themselves', async () => {
  assert.ok((await listIds('mgr1')).includes('mgr1-created'));
  assert.ok((await listIds('mgr1', { search: 'created by mgr1' })).includes('mgr1-created'));
  assert.ok((await globalIds('mgr1')).includes('mgr1-created'));
  assert.equal(await canGet('mgr1', 'mgr1-created'), true);
});
test('6. manager can view/search a lead assigned to themselves', async () => {
  assert.ok((await listIds('mgr1', { search: 'assigned to mgr1' })).includes('mgr1-assigned'));
  assert.ok((await globalIds('mgr1')).includes('mgr1-assigned'));
  assert.equal(await canGet('mgr1', 'mgr1-assigned'), true);
});
test('7. manager cannot view/search another manager\'s lead (created or assigned)', async () => {
  for (const id of ['mgr2-assigned', 'mgr2-created']) {
    assert.ok(!(await listIds('mgr1')).includes(id), id);
    assert.ok(!(await listIds('mgr1', { search: 'xyz' })).includes(id), id);
    assert.ok(!(await globalIds('mgr1')).includes(id), id);
    assert.equal(await canGet('mgr1', id), false, id);
  }
});
test('8. manager cannot view/search another manager\'s team lead, nor own team\'s lead they neither created nor own', async () => {
  assert.ok(!(await globalIds('mgr1', 'rahul')).includes('rahul-lead'));
  assert.equal(await canGet('mgr1', 'rahul-lead'), false);
  // Aditi is on mgr1's team, but XYZ was created by admin and is assigned to Aditi → not visible
  assert.ok(!(await globalIds('mgr1')).includes('xyz'));
  assert.equal(await canGet('mgr1', 'xyz'), false);
  assert.deepEqual(await listIds('mgr1'), sorted(['mgr1-created', 'mgr1-assigned']));
});
test('9. manager cannot access leads outside their organization', async () => {
  assert.ok(!(await listIds('mgr1', { search: 'xyz' })).includes('orgB-lead'));
  assert.ok(!(await globalIds('mgr1')).includes('orgB-lead'));
  assert.equal(await canGet('mgr1', 'orgB-lead'), false);
  assert.equal((await leadsService.reassignLead('orgB-lead', 'aditi', U('mgr1'))).success, false);
});
test('10. manager can assign a lead in scope to a member of their own team', async () => {
  const r = await leadsService.reassignLead('mgr1-created', 'sheetal', U('mgr1'));
  assert.equal(r.success, true);
  assert.equal(lead('mgr1-created').assignedToId, 'sheetal');
  const bulk = await leadsService.bulkAssignLeads(['mgr1-assigned'], 'aditi', U('mgr1'));
  assert.equal(bulk.success, true);
  assert.equal(lead('mgr1-assigned').assignedToId, 'aditi');
});
test('11. manager cannot assign to another manager', async () => {
  const r = await leadsService.reassignLead('mgr1-created', 'mgr2', U('mgr1'));
  assert.equal(r.success, false);
  assert.equal(r.statusCode, 403);
  assert.equal(lead('mgr1-created').assignedToId, 'aditi');
  assert.equal((await leadsService.bulkAssignLeads(['mgr1-created'], 'mgr2', U('mgr1'))).success, false);
  await leadsService.updateLead('mgr1-created', { assignedToId: 'mgr2' }, U('mgr1'));
  assert.equal(lead('mgr1-created').assignedToId, 'aditi');
});
test('12. manager cannot assign to another manager\'s team, nor take an out-of-scope lead', async () => {
  const toOtherTeam = await leadsService.reassignLead('mgr1-created', 'rahul', U('mgr1'));
  assert.equal(toOtherTeam.statusCode, 403);
  assert.equal((await leadsService.reassignLead('mgr2-assigned', 'aditi', U('mgr1'))).statusCode, 404);
  assert.equal((await leadsService.reassignLead('rahul-lead', 'aditi', U('mgr1'))).statusCode, 404);
  const bulk = await leadsService.bulkAssignLeads(['rahul-lead', 'mgr1-created'], 'sheetal', U('mgr1'));
  assert.deepEqual(bulk.assigned, ['mgr1-created']);
  assert.deepEqual(bulk.notFound, ['rahul-lead']);
  assert.equal(lead('rahul-lead').assignedToId, 'rahul');
  assert.equal((await call(reassignRoute, { params: { id: 'mgr1-created' }, body: { assignedToId: 'rahul' }, user: U('mgr1') })).status, 403);
});
test('13. manager cannot self-assign (reassign, bulk, update, create)', async () => {
  assert.equal((await leadsService.reassignLead('mgr1-created', 'mgr1', U('mgr1'))).statusCode, 403);
  assert.equal((await leadsService.bulkAssignLeads(['mgr1-created'], 'mgr1', U('mgr1'))).success, false);
  await leadsService.updateLead('mgr1-created', { assignedToId: 'mgr1' }, U('mgr1'));
  assert.equal(lead('mgr1-created').assignedToId, 'aditi');
  await leadsService.createLead({ companyName: 'Self Assigned Co', assignedToId: 'mgr1' }, U('mgr1'));
  assert.equal(leads.find((l) => l.companyName === 'Self Assigned Co').assignedToId, null);
});

// ═════════════════════════════════════════════════════════════════════════════
// SALES REP (14-17)
// ═════════════════════════════════════════════════════════════════════════════
test('14. sales rep can view/search currently assigned leads', async () => {
  assert.deepEqual(await listIds('aditi'), sorted(['xyz', 'mgr1-created']));
  assert.deepEqual(await listIds('aditi', { search: 'xyz' }), sorted(['xyz', 'mgr1-created']));
  assert.deepEqual(await globalIds('aditi'), sorted(['xyz', 'mgr1-created']));
  assert.equal(await canGet('aditi', 'xyz'), true);
});
test('15. sales rep cannot view/search another rep\'s lead', async () => {
  assert.deepEqual(await globalIds('sheetal'), []);
  assert.deepEqual(await listIds('sheetal', { search: 'xyz' }), []);
  assert.equal(await canGet('sheetal', 'xyz'), false);
  assert.ok(!(await globalIds('aditi')).includes('rahul-lead'));
});
test('16. sales rep cannot view/search unassigned, manager\'s or other org\'s leads', async () => {
  for (const id of ['unassigned', 'mgr1-assigned', 'mgr2-created', 'orgB-lead']) {
    assert.ok(!(await globalIds('aditi')).includes(id), id);
    assert.ok(!(await listIds('aditi', { search: 'xyz' })).includes(id), id);
    assert.equal(await canGet('aditi', id), false, id);
  }
  assert.ok(!(await listIds('aditi', { unassigned: 'true' })).includes('unassigned'));
  assert.ok(!(await listIds('aditi', { assignedTo: 'rahul' })).includes('rahul-lead'));
});
test('17. sales rep cannot reassign leads', async () => {
  let status; let nexted = false;
  requireManagerOrAdmin({ user: U('aditi') }, { status(c) { status = c; return this; }, json() { return this; } }, () => { nexted = true; });
  assert.equal(nexted, false);
  assert.equal(status, 403);
  assert.equal((await leadsService.reassignLead('xyz', 'sheetal', U('aditi'))).statusCode, 403);
  assert.equal((await leadsService.bulkAssignLeads(['xyz'], 'sheetal', U('aditi'))).success, false);
  await leadsService.updateLead('xyz', { assignedToId: 'sheetal' }, U('aditi'));
  assert.equal(lead('xyz').assignedToId, 'aditi');
});

// ═════════════════════════════════════════════════════════════════════════════
// REASSIGNMENT Aditi → Sheetal (18-33)
// ═════════════════════════════════════════════════════════════════════════════
test('18-33. Lead XYZ Aditi → Sheetal: same record, data preserved, access swaps, Sheetal continues on the same lead', async () => {
  // 18 + 19: Aditi sees XYZ and makes several changes
  assert.equal(await canGet('aditi', 'xyz'), true);
  await leadsService.updateLead('xyz', { status: 'negotiation', stage: 'proposal', notes: 'Aditi note 1', customFields: { tier: 'platinum', size: 'L' }, description: 'edited by aditi' }, U('aditi'));
  await leadsService.updateLead('xyz', { notes: 'Aditi note 1${NOTE_SEP}Aditi note 2' }, U('aditi'));
  const beforeReassign = clone(lead('xyz'));
  const leadCount = leads.length;
  const activityRowsBefore = structuredClone(activities);
  leadWrites = [];

  // 20: admin reassigns
  const r = await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  assert.equal(r.success, true);

  // 21 + 31: same ID, no new lead
  assert.equal(leads.length, leadCount);
  assert.ok(leads.filter((l) => l.companyName === 'XYZ Corp').length === 1);
  const after = lead('xyz');
  assert.equal(after.id, 'xyz');

  // 22: Aditi loses access everywhere
  assert.equal(await canGet('aditi', 'xyz'), false);
  assert.ok(!(await globalIds('aditi')).includes('xyz'));
  assert.ok(!(await listIds('aditi', { search: 'xyz' })).includes('xyz'));
  assert.ok(!(await listIds('aditi')).includes('xyz'));

  // 23: Sheetal gains access everywhere
  assert.equal(await canGet('sheetal', 'xyz'), true);
  assert.ok((await globalIds('sheetal')).includes('xyz'));
  assert.ok((await listIds('sheetal', { search: 'xyz' })).includes('xyz'));

  // 24-28: Sheetal sees exactly what Aditi left behind
  const seen = (await leadsService.getLeadById('xyz', U('sheetal'))).lead;
  assert.equal(seen.status, beforeReassign.status);            // 26
  assert.equal(seen.stage, 'proposal');                        // 27
  assert.deepEqual(seen.customFields, { tier: 'platinum', size: 'L' }); // 28
  assert.equal(seen.notes, beforeReassign.notes);              // 25 (notes untouched — no assignment text in them)
  assert.equal(seen.description, 'edited by aditi');           // 24

  // 30: ONLY assignedToId changed on the lead
  const { assignedToId: _a1, ...restAfter } = after;
  const { assignedToId: _a2, ...restBefore } = beforeReassign;
  assert.deepEqual(restAfter, restBefore);
  assert.equal(after.assignedToId, 'sheetal');
  assert.equal(leadWrites.length, 1);
  assert.deepEqual(Object.keys(leadWrites[0].data), ['assignedToId']);

  // 29: existing activities/history untouched; the only addition is the timeline entry
  assert.deepEqual(activities.slice(0, activityRowsBefore.length), activityRowsBefore);
  assert.equal(activities.length, activityRowsBefore.length + 1);
  assert.equal(activities.at(-1).description, 'Admin assigned this lead from Aditi to you.');

  // 32 + 33: Sheetal keeps working on the SAME lead
  const upd = await leadsService.updateLead('xyz', { status: 'won', notes: `${after.notes}${NOTE_SEP}${new Date().toISOString()}|Sheetal|Closed it` }, U('sheetal'));
  assert.equal(upd.success, true);
  assert.equal(leads.length, leadCount);
  assert.equal(lead('xyz').status, 'won');
  assert.ok(lead('xyz').notes.includes('Aditi note 2') && lead('xyz').notes.includes('Closed it'));
  assert.ok(!lead('xyz').notes.includes('assigned this lead'));
  assert.equal(lead('xyz').stage, 'proposal');
  assert.equal(lead('xyz').assignedToId, 'sheetal');
  // Aditi still cannot touch it
  assert.equal((await leadsService.updateLead('xyz', { status: 'lost' }, U('aditi'))).success, false);
  assert.equal(lead('xyz').status, 'won');
});
test('reassign: admin cannot reassign across orgs (lead or target); can assign any active org user incl. a manager', async () => {
  assert.equal((await leadsService.reassignLead('orgB-lead', 'aditi', U('admin'))).success, false);
  assert.equal((await leadsService.reassignLead('xyz', 'repB', U('admin'))).success, false);
  assert.equal(lead('xyz').assignedToId, 'aditi');
  assert.equal(leadWrites.length, 0);
  assert.equal((await leadsService.reassignLead('xyz', 'mgr2', U('admin'))).success, true);
  assert.equal(lead('xyz').assignedToId, 'mgr2');
  await leadsService.updateLead('xyz', { assignedToId: 'repB' }, U('admin'));
  assert.equal(lead('xyz').assignedToId, 'mgr2');
});

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITY TIMELINE ENTRIES FOR ASSIGNMENT / REASSIGNMENT
// ═════════════════════════════════════════════════════════════════════════════
const descriptions = (leadId) => timelineFor(leadId).map((a) => a.description);

test('timeline: first assignment → "<assigner> assigned this lead to you."', async () => {
  await leadsService.reassignLead('unassigned', 'aditi', U('admin'));
  assert.deepEqual(descriptions('unassigned'), ['Admin assigned this lead to you.']);
  const e = timelineFor('unassigned')[0];
  assert.equal(e.userId, 'admin');
  assert.equal(e.organizationId, ORG_A);
  assert.equal(e.metadata.assignedToId, 'aditi');
  assert.ok(e.activityDate instanceof Date);
});
test('timeline: reassignment → "<assigner> assigned this lead from <previous> to you." (admin and manager)', async () => {
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  assert.deepEqual(descriptions('xyz'), ['Admin assigned this lead from Aditi to you.']);
  await leadsService.reassignLead('mgr1-created', 'sheetal', U('mgr1'));
  assert.deepEqual(descriptions('mgr1-created'), ['Mgr1 assigned this lead from Aditi to you.']);
  assert.equal(timelineFor('mgr1-created')[0].metadata.previousOwnerName, 'Aditi');
});
test('timeline: nothing is written to Lead.notes and only assignedToId changes (every assignment path)', async () => {
  const snapshot = clone(leads);
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  await leadsService.bulkAssignLeads(['unassigned', 'mgr1-created'], 'sheetal', U('admin'));
  await leadsService.updateLead('mgr1-assigned', { assignedToId: 'aditi' }, U('mgr1'));
  await call(teamController.bulkReassignLeads, { body: { fromUserId: 'rahul', toUserId: 'aditi' }, user: U('admin') });
  for (const l of snapshot) {
    const { assignedToId: _x, ...before } = l;
    const { assignedToId: _y, ...now } = lead(l.id);
    assert.deepEqual(now, before, l.id);
  }
  assert.ok(leadWrites.every((w) => Object.keys(w.data).join() === 'assignedToId'), JSON.stringify(leadWrites));
});
test('timeline: bulk assign logs one correct entry per changed lead, none for unchanged', async () => {
  await leadsService.bulkAssignLeads(['xyz', 'unassigned', 'mgr1-created'], 'aditi', U('admin'));
  assert.deepEqual(descriptions('xyz'), []);                  // already Aditi's → unchanged
  assert.deepEqual(descriptions('mgr1-created'), []);
  assert.deepEqual(descriptions('unassigned'), ['Admin assigned this lead to you.']);
  await leadsService.bulkAssignLeads(['xyz', 'mgr1-created'], 'sheetal', U('admin'));
  assert.deepEqual(descriptions('xyz'), ['Admin assigned this lead from Aditi to you.']);
  assert.deepEqual(descriptions('mgr1-created'), ['Admin assigned this lead from Aditi to you.']);
  await leadsService.bulkAssignLeads(['mgr1-created'], 'sheetal', U('mgr1'));
  assert.equal(descriptions('mgr1-created').length, 1);       // same assignee → no new entry
});
test('timeline: manager bulk, edit-form assignment, create-for-someone and admin bulk-reassign each log exactly one entry', async () => {
  await leadsService.bulkAssignLeads(['mgr1-assigned'], 'aditi', U('mgr1'));
  assert.deepEqual(descriptions('mgr1-assigned'), ['Mgr1 assigned this lead from Mgr1 to you.']);

  await leadsService.updateLead('mgr1-created', { assignedToId: 'sheetal', notes: 'typed by manager' }, U('mgr1'));
  assert.deepEqual(descriptions('mgr1-created'), ['Mgr1 assigned this lead from Aditi to you.']);
  assert.equal(lead('mgr1-created').notes, 'typed by manager');

  await leadsService.createLead({ companyName: 'Brand New Co', assignedToId: 'sheetal' }, U('admin'));
  const created = leads.find((l) => l.companyName === 'Brand New Co');
  assert.deepEqual(descriptions(created.id), ['Admin assigned this lead to you.']);
  assert.equal(created.notes, undefined);
  await leadsService.createLead({ companyName: 'Own Co' }, U('aditi'));
  assert.deepEqual(descriptions(leads.find((l) => l.companyName === 'Own Co').id), []);

  const res = await call(teamController.bulkReassignLeads, { body: { fromUserId: 'rahul', toUserId: 'aditi' }, user: U('admin') });
  assert.equal(res.status, 200);
  assert.deepEqual(descriptions('rahul-lead'), ['Admin assigned this lead from Rahul to you.']);
});
test('timeline: the reassign HTTP handler produces exactly one entry (no duplicate from the controller)', async () => {
  const r = await call(reassignRoute, { params: { id: 'xyz' }, body: { assignedToId: 'sheetal' }, user: U('admin') });
  assert.equal(r.status, 200);
  assert.deepEqual(descriptions('xyz'), ['Admin assigned this lead from Aditi to you.']);
  assert.equal(activities.filter((a) => a.leadId === 'xyz' && /^lead_assigned$/.test(a.action)).length, 1);
});
test('timeline: chained reassignments build a continuous history', async () => {
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  await leadsService.reassignLead('xyz', 'rahul', U('admin'));
  assert.deepEqual(descriptions('xyz'), [
    'Admin assigned this lead from Aditi to you.',
    'Admin assigned this lead from Sheetal to you.',
  ]);
  assert.deepEqual((await leadActivityIds('rahul', 'xyz')).ids, ['a1', 'a2', 'a5']);
  assert.equal((await leadActivityIds('rahul', 'xyz')).all.filter((a) => a.action === 'lead_assigned').length, 2);
});
test('timeline: no entry when the assignee is unchanged or the attempt is denied', async () => {
  await leadsService.reassignLead('xyz', 'aditi', U('admin'));
  await leadsService.reassignLead('mgr1-created', 'rahul', U('mgr1'));       // other team → denied
  await leadsService.reassignLead('mgr1-created', 'mgr1', U('mgr1'));        // self → denied
  await leadsService.reassignLead('xyz', 'sheetal', U('aditi'));             // rep → denied
  await leadsService.reassignLead('orgB-lead', 'aditi', U('admin'));         // other org → denied
  assert.equal(activities.filter((a) => isNew(a.id)).length, 0);
});
test('timeline visibility: previous assignee loses lead + timeline; new assignee sees ALL old entries plus the new one', async () => {
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  // Aditi: nothing from this lead (including the new entry), by lead, feed, and by id
  assert.equal((await leadActivityIds('aditi', 'xyz')).status, 404);
  const aditiFeed = await feedIds('aditi', {}, true);
  assert.ok(!aditiFeed.some((id) => ['a1', 'a2', 'a5', 'a5b'].includes(id) || isNew(id)), aditiFeed.join());
  const newEntry = timelineFor('xyz')[0];
  assert.equal((await activityService.getActivityById(newEntry.id, U('aditi'))).success, false);
  assert.equal((await activityService.getActivityById('a1', U('aditi'))).success, false);
  // Sheetal: Aditi's earlier activities AND the assignment entry
  const sheetal = await leadActivityIds('sheetal', 'xyz');
  assert.equal(sheetal.status, 200);
  assert.deepEqual(sheetal.ids, ['a1', 'a2', 'a5']);
  assert.ok(sheetal.all.some((a) => a.description === 'Admin assigned this lead from Aditi to you.'));
  assert.deepEqual(await feedIds('sheetal', {}, true), sorted(['a1', 'a2', 'a5', 'a5b', newEntry.id]));
  assert.equal((await activityService.getActivityById(newEntry.id, U('sheetal'))).success, true);
  // Admin still sees everything; the assigner manager only if the lead is still in their scope
  assert.ok((await feedIds('admin', {}, true)).includes(newEntry.id));
  // The Lead itself is unchanged (id, notes, status, stage, custom fields)
  const seen = (await leadsService.getLeadById('xyz', U('sheetal'))).lead;
  assert.equal(seen.id, 'xyz');
  assert.equal(seen.notes, XYZ_ORIGINAL.notes);
  assert.equal(seen.status, XYZ_ORIGINAL.status);
  assert.equal(seen.stage, XYZ_ORIGINAL.stage);
  assert.deepEqual(seen.customFields, XYZ_ORIGINAL.customFields);
});

// ═════════════════════════════════════════════════════════════════════════════
// ACTIVITIES (34-38)
// ═════════════════════════════════════════════════════════════════════════════
test('34-36. activities stay stored; Aditi loses them, Sheetal gains them after reassignment', async () => {
  assert.deepEqual((await leadActivityIds('aditi', 'xyz')).ids, ['a1', 'a2', 'a5']);
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  assert.deepEqual(activities.slice(0, ACTIVITIES_ORIGINAL.length), ACTIVITIES_ORIGINAL); // 34 (originals untouched)
  const aditi = await leadActivityIds('aditi', 'xyz');                             // 35
  assert.equal(aditi.status, 404);
  assert.deepEqual(aditi.ids, []);
  assert.deepEqual((await leadActivityIds('sheetal', 'xyz')).ids, ['a1', 'a2', 'a5']); // 36
  const byId = (u, id) => call(activityController.getActivity || (async () => ({})), { params: { id }, user: U(u) });
  assert.equal((await activityService.getActivityById('a1', U('aditi'))).success, false);
  assert.equal((await activityService.getActivityById('a1', U('sheetal'))).success, true);
  void byId;
});
test('37. general activity feed follows current lead authorization', async () => {
  assert.deepEqual(await feedIds('admin'), ['a1', 'a2', 'a3', 'a4', 'a5', 'a5b', 'a6']);
  assert.deepEqual(await feedIds('aditi'), ['a1', 'a2', 'a3', 'a4', 'a5', 'a5b']); // a3: mgr1-created is assigned to her
  assert.deepEqual(await feedIds('mgr1'), ['a3']);
  assert.deepEqual(await feedIds('mgr2'), []);
  assert.deepEqual(await feedIds('sheetal'), []);
  assert.deepEqual(await feedIds('adminB'), ['a7']);
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  assert.deepEqual(await feedIds('aditi'), ['a3', 'a4']);              // XYZ activities gone; her other lead + unlinked note remain
  assert.deepEqual(await feedIds('sheetal'), ['a1', 'a2', 'a5', 'a5b']);
  assert.deepEqual(await feedIds('sheetal', { search: 'pricing' }), ['a2']);
  assert.deepEqual(await feedIds('aditi', { search: 'pricing' }), []);
  // filters / search / linkedId can never widen the scope
  assert.deepEqual(await feedIds('aditi', { linkedId: 'xyz' }), []);
  assert.deepEqual(await feedIds('aditi', { leadId: 'xyz' }), []);
  assert.deepEqual(await feedIds('aditi', { userId: 'aditi', search: 'call' }), []);
  assert.deepEqual(await feedIds('mgr1', { leadId: 'rahul-lead' }), []);
});
test('38. being the activity creator never overrides current lead authorization', async () => {
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  const own = await feedIds('aditi', { userId: 'aditi' });
  assert.deepEqual(own, ['a4']);                          // a1/a2/a5 were created by Aditi but are hidden
  assert.equal((await activityService.getActivityById('a2', U('aditi'))).success, false);
  assert.equal((await activityService.updateActivity('a2', { notes: 'tamper' }, U('aditi'))).success, false);
  assert.equal((await activityService.deleteActivity('a2', U('aditi'))).success, false);
  assert.ok(activities.some((a) => a.id === 'a2'));
  assert.equal(activities.find((a) => a.id === 'a2').notes, undefined);
  // creating a new activity on the lost lead is rejected too
  const c = await activityService.createActivity({ leadId: 'xyz', action: 'call', description: 'x', outcome: 'x', activityDate: new Date().toISOString() }, U('aditi'));
  assert.equal(c.success, false);
  // stats / coaching alerts are computed from the same scope
  assert.equal((await activityService.getActivityStats(U('aditi'))).stats.todayCount, 2);
  assert.equal((await activityService.getActivityStats(U('sheetal'))).stats.todayCount, 5); // 4 old + the assignment entry
});

// ═════════════════════════════════════════════════════════════════════════════
// OPPORTUNITIES (39-43)
// ═════════════════════════════════════════════════════════════════════════════
test('39. manager cannot access an opportunity linked to another manager\'s lead', async () => {
  assert.equal((await opportunityService.getById('opp-rahul', U('mgr1'))).statusCode, 404);
  assert.equal((await opportunityService.getById('opp-xyz', U('mgr1'))).statusCode, 404);
  assert.equal((await opportunityService.update('opp-rahul', { stage: 'closed_won' }, U('mgr1'))).statusCode, 404);
  assert.equal((await opportunityService.delete('opp-rahul', U('mgr1'))).statusCode, 404);
  assert.equal(opportunities.find((o) => o.id === 'opp-rahul').stage, 'demo');
  assert.deepEqual(await oppIds('mgr1'), ['opp-mgr1']);
  assert.deepEqual(await oppIds('mgr1', { leadId: 'rahul-lead' }), []);
});
test('40. sales rep cannot access an opportunity linked to another user\'s lead', async () => {
  assert.equal((await opportunityService.getById('opp-xyz', U('sheetal'))).statusCode, 404);
  assert.equal((await opportunityService.update('opp-xyz', { stage: 'closed_won' }, U('sheetal'))).statusCode, 404);
  assert.equal((await opportunityService.getById('opp-rahul', U('aditi'))).statusCode, 404);
  assert.deepEqual(await oppIds('sheetal'), []);
  assert.equal((await opportunityService.create({ leadId: 'xyz', title: 't' }, U('sheetal'))).statusCode, 404);
  assert.equal((await opportunityService.convertLeadToOpportunity('xyz', U('sheetal'))).statusCode, 404);
  assert.equal((await call(convertRoute, { params: { id: 'xyz' }, user: U('sheetal') })).status, 404);
});
test('41. authorized users can access opportunities linked to their authorized leads (and follow reassignment)', async () => {
  assert.deepEqual(await oppIds('admin'), ['opp-mgr1', 'opp-rahul', 'opp-xyz']);
  assert.deepEqual(await oppIds('aditi'), ['opp-mgr1', 'opp-xyz']);
  assert.equal((await opportunityService.getById('opp-xyz', U('aditi'))).success, true);
  assert.equal((await opportunityService.update('opp-xyz', { stage: 'negotiation' }, U('aditi'))).success, true);
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  assert.equal((await opportunityService.getById('opp-xyz', U('aditi'))).success, false);
  assert.equal((await opportunityService.getById('opp-xyz', U('sheetal'))).success, true);
  assert.equal(opportunities.find((o) => o.id === 'opp-xyz').stage, 'negotiation'); // data preserved
  assert.deepEqual(await globalSearchOf('sheetal', 'opp', 'opportunities'), ['opp-xyz']);
  assert.deepEqual(await globalSearchOf('mgr1', 'opp', 'opportunities'), ['opp-mgr1']);
});
test('42. cross-organization opportunity access is blocked', async () => {
  assert.equal((await opportunityService.getById('opp-orgB', U('admin'))).statusCode, 404);
  assert.equal((await opportunityService.getById('opp-xyz', U('adminB'))).statusCode, 404);
  assert.ok(!(await oppIds('admin')).includes('opp-orgB'));
  assert.deepEqual(await oppIds('adminB'), ['opp-orgB']);
  assert.equal((await opportunityService.create({ leadId: 'orgB-lead', title: 't' }, U('admin'))).statusCode, 404);
  assert.deepEqual(await globalSearchOf('admin', 'opp', 'opportunities'), ['opp-mgr1', 'opp-rahul', 'opp-xyz']);
});
test('43. unauthorized linked lead information is not leaked through opportunities', async () => {
  const denied = JSON.stringify(await opportunityService.getById('opp-xyz', U('sheetal')));
  for (const secret of ['XYZ Corp', 'xyz@lead.com', 'lead.com']) assert.ok(!denied.includes(secret), secret);
  const list = JSON.stringify((await opportunityService.getAll(U('sheetal'))).opportunities);
  assert.ok(!list.includes('xyz') && !list.includes('XYZ'));
});

// ═════════════════════════════════════════════════════════════════════════════
// CONTACTS / ACCOUNTS (44-47)
// ═════════════════════════════════════════════════════════════════════════════
test('44. manager only sees contacts/accounts related to authorized leads (global search)', async () => {
  assert.deepEqual(await globalSearchOf('mgr1', 'contact', 'contacts'), ['c-mgr1']);
  assert.deepEqual(await globalSearchOf('mgr1', 'account', 'accounts'), ['acc-mgr1']);
});
test('45. manager cannot see another manager\'s contacts/accounts', async () => {
  const contactsSeen = await globalSearchOf('mgr1', 'contact', 'contacts');
  for (const id of ['c-rahul', 'c-free-mgr2', 'c-xyz']) assert.ok(!contactsSeen.includes(id), id);
  const accountsSeen = await globalSearchOf('mgr1', 'account', 'accounts');
  for (const id of ['acc-mgr2', 'acc-rahul', 'acc-xyz']) assert.ok(!accountsSeen.includes(id), id);
  assert.deepEqual(await globalSearchOf('mgr2', 'account', 'accounts'), ['acc-mgr2']);
  assert.deepEqual(await globalSearchOf('mgr2', 'contact', 'contacts'), ['c-free-mgr2']);
});
test('46. sales rep only sees contacts/accounts related to currently assigned leads (and follows reassignment)', async () => {
  assert.deepEqual(await globalSearchOf('aditi', 'contact', 'contacts'), sorted(['c-xyz', 'c-mgr1', 'c-free-aditi']));
  assert.deepEqual(await globalSearchOf('aditi', 'account', 'accounts'), ['acc-xyz']);
  assert.deepEqual(await globalSearchOf('sheetal', 'contact', 'contacts'), []);
  await leadsService.reassignLead('xyz', 'sheetal', U('admin'));
  assert.deepEqual(await globalSearchOf('aditi', 'contact', 'contacts'), sorted(['c-mgr1', 'c-free-aditi']));
  assert.deepEqual(await globalSearchOf('aditi', 'account', 'accounts'), []);
  assert.deepEqual(await globalSearchOf('sheetal', 'contact', 'contacts'), ['c-xyz']);
  assert.deepEqual(await globalSearchOf('sheetal', 'account', 'accounts'), ['acc-xyz']);
  // direct access + list endpoints
  const get = (fn, u, id) => call(fn, { params: { id }, user: U(u), query: {} });
  assert.equal((await get(contactsController.getContactById, 'aditi', 'c-xyz')).status, 404);
  assert.equal((await get(contactsController.getContactById, 'sheetal', 'c-xyz')).status, 200);
  assert.equal((await get(accountsController.getAccountById, 'aditi', 'acc-xyz')).status, 404);
  assert.equal((await get(accountsController.getAccountById, 'sheetal', 'acc-xyz')).status, 200);
  assert.deepEqual(sorted((await call(contactsController.getContacts, { query: {}, user: U('sheetal') })).body.data.map((c) => c.id)), ['c-xyz']);
  assert.deepEqual(sorted((await call(accountsController.getAccounts, { query: {}, user: U('sheetal') })).body.data.map((c) => c.id)), ['acc-xyz']);
});
test('47. cross-organization contacts/accounts are blocked', async () => {
  assert.ok(!(await globalSearchOf('admin', 'contact', 'contacts')).includes('c-orgB'));
  assert.ok(!(await globalSearchOf('admin', 'account', 'accounts')).includes('acc-orgB'));
  assert.deepEqual(await globalSearchOf('adminB', 'contact', 'contacts'), ['c-orgB']);
  assert.deepEqual(await globalSearchOf('adminB', 'account', 'accounts'), ['acc-orgB']);
  const get = (fn, u, id) => call(fn, { params: { id }, user: U(u), query: {} });
  assert.equal((await get(contactsController.getContactById, 'admin', 'c-orgB')).status, 404);
  assert.equal((await get(accountsController.getAccountById, 'admin', 'acc-orgB')).status, 404);
  assert.equal((await call(contactsController.getContacts, { query: { leadId: 'orgB-lead' }, user: U('admin') })).status, 404);
});
test('contacts of a lead are only listed/read/changed for leads in scope', async () => {
  const list = (u, leadId) => call(contactsController.getContacts, { query: { leadId }, user: U(u) });
  assert.equal((await list('sheetal', 'xyz')).status, 404);
  assert.equal((await list('mgr1', 'rahul-lead')).status, 404);
  assert.equal((await list('aditi', 'xyz')).body.data.length, 1);
  const upd = await call(contactsController.updateContact, { params: { id: 'c-rahul' }, body: { name: 'hax' }, user: U('mgr1') });
  assert.equal(upd.status, 404);
  assert.equal(contacts.find((c) => c.id === 'c-rahul').name, 'Rahul contact');
});

// ═════════════════════════════════════════════════════════════════════════════
// CAMPAIGNS (48-50)
// ═════════════════════════════════════════════════════════════════════════════
test('48. unauthorized leads cannot be added to campaigns', async () => {
  campaignLeads = [];
  const add = (u, ids) => call(campaignController.addLeadsToCampaign, { params: { id: 'camp1' }, body: { leadIds: ids }, user: U(u) });
  await add('mgr1', ['mgr1-created', 'rahul-lead', 'orgB-lead', 'xyz']);
  assert.deepEqual(campaignLeads.map((c) => c.leadId), ['mgr1-created']);
  campaignLeads = [];
  await add('admin', ['xyz', 'orgB-lead']);
  assert.deepEqual(campaignLeads.map((c) => c.leadId), ['xyz']);
  campaignLeads = [];
  await add('sheetal', ['xyz']);
  assert.deepEqual(campaignLeads, []);
});
test('49. campaign retrieval cannot expose unauthorized leads', async () => {
  const get = async (u) => (await call(campaignController.getCampaign, { params: { id: 'camp1' }, user: U(u) })).body.data;
  assert.deepEqual(sorted((await get('admin')).leads.map((l) => l.leadId)), ['mgr1-created', 'rahul-lead', 'xyz']);
  assert.deepEqual((await get('mgr1')).leads.map((l) => l.leadId), ['mgr1-created']);
  assert.deepEqual((await get('mgr1')).emails.map((e) => e.id), ['e-mgr1']);
  assert.deepEqual(sorted((await get('aditi')).leads.map((l) => l.leadId)), ['mgr1-created', 'xyz']);
  assert.deepEqual((await get('sheetal')).leads, []);
  assert.deepEqual((await get('sheetal')).emails, []);
});
test('50. campaign launch cannot bypass lead authorization', async () => {
  const launch = (u) => call(campaignController.launchCampaign, { params: { id: 'camp1' }, user: U(u) });
  const r = await launch('mgr1');
  assert.equal(r.status, 200);
  assert.deepEqual(sentEmails.map((e) => e.leadId), ['mgr1-created']);
  sentEmails = [];
  await launch('admin');
  assert.deepEqual(sorted(sentEmails.map((e) => e.leadId)), ['mgr1-created', 'rahul-lead', 'xyz']); // never orgB-lead
  sentEmails = [];
  assert.equal((await launch('sheetal')).status, 422); // nothing of hers in the campaign
  assert.deepEqual(sentEmails, []);
});

// ═════════════════════════════════════════════════════════════════════════════
// SEARCH BYPASS / DIRECT ID / ORG ISOLATION (51-53)
// ═════════════════════════════════════════════════════════════════════════════
test('51. a search term cannot bypass admin/manager/rep authorization', async () => {
  for (const term of ['xyz', 'XYZ', 'x', 'corp', 'lead.com']) {
    assert.deepEqual(await listIds('sheetal', { search: term }), []);
    assert.ok(!(await listIds('aditi', { search: term })).some((id) => !['xyz', 'mgr1-created'].includes(id)));
    assert.ok(!(await listIds('mgr1', { search: term })).some((id) => !['mgr1-created', 'mgr1-assigned'].includes(id)));
    assert.ok(!(await listIds('admin', { search: term })).includes('orgB-lead'));
  }
  assert.deepEqual(await globalIds('mgr1', 'xyz'), sorted(['mgr1-created', 'mgr1-assigned']));
  assert.deepEqual(await listIds('mgr1', { search: 'xyz', assignedTo: 'rahul' }), []);
  assert.deepEqual(await listIds('mgr1', { search: 'xyz', unassigned: 'true' }), []);
  assert.deepEqual(await listIds('admin', { search: 'xyz', assignedTo: 'repB' }), []);
});
test('52. direct ID access (get/update/delete/export/enrich/email/outreach/activities/contacts) cannot bypass authorization', async () => {
  const matrix = {
    admin: { xyz: true, 'mgr2-assigned': true, 'orgB-lead': false },
    mgr1: { xyz: false, 'mgr1-created': true, 'mgr1-assigned': true, 'mgr2-assigned': false, 'rahul-lead': false, 'orgB-lead': false },
    aditi: { xyz: true, 'mgr1-created': true, 'mgr1-assigned': false, 'rahul-lead': false, unassigned: false },
    sheetal: { xyz: false },
    adminB: { xyz: false, 'orgB-lead': true },
  };
  for (const [u, row] of Object.entries(matrix)) {
    for (const [id, ok] of Object.entries(row)) assert.equal(await canGet(u, id), ok, `${u} → ${id}`);
  }
  assert.equal((await leadsService.updateLead('xyz', { notes: 'hijack' }, U('sheetal'))).success, false);
  assert.equal(lead('xyz').notes, XYZ_ORIGINAL.notes);
  assert.equal((await activityService.getLeadActivities('xyz', U('mgr1'))).success, false);
  assert.equal((await activityService.getLeadActivities('xyz', U('sheetal'))).success, false);

  // legacy controller endpoints: all answer 404 for out-of-scope leads
  for (const fn of ['generateEmail', 'sendOutreach', 'enrichLeadViaApollo', 'enrichLeadViaSignalHire']) {
    const r = await call(leadController[fn], { params: { id: 'xyz' }, body: { subject: 's', body: 'b' }, query: {}, user: U('sheetal') });
    assert.equal(r.status, 404, fn);
  }
  assert.deepEqual(sentEmails, []);

  // export: filters/ids cannot widen the scope
  const exported = async (u, query) => (await call(leadController.exportLeads, { query, user: U(u) })).sent || '';
  const all = 'xyz,mgr1-created,mgr1-assigned,mgr2-assigned,mgr2-created,rahul-lead,unassigned,orgB-lead';
  const csv = await exported('mgr1', { ids: all });
  assert.ok(csv.includes('XYZ Created By Mgr1') && csv.includes('XYZ Assigned To Mgr1'));
  for (const hidden of ['XYZ Corp', 'XYZ Rahul Deal', 'XYZ OrgB', 'XYZ Created By Mgr2', 'XYZ Unassigned']) assert.ok(!csv.includes(hidden), hidden);
  const csvSearch = await exported('sheetal', { search: 'xyz', assignedTo: 'aditi' });
  assert.ok(!csvSearch.includes('XYZ Corp'));
  const csvAdmin = await exported('admin', { ids: all });
  assert.ok(csvAdmin.includes('XYZ Corp') && csvAdmin.includes('XYZ Rahul Deal') && !csvAdmin.includes('XYZ OrgB'));
});
test('53. cross-organization search cannot bypass authorization (every role, every entity)', async () => {
  for (const u of ['admin', 'mgr1', 'mgr2', 'aditi', 'sheetal', 'rahul']) {
    assert.ok(!(await globalIds(u)).includes('orgB-lead'), u);
    assert.ok(!(await globalSearchOf(u, 'contact', 'contacts')).includes('c-orgB'), u);
    assert.ok(!(await globalSearchOf(u, 'account', 'accounts')).includes('acc-orgB'), u);
    assert.ok(!(await globalSearchOf(u, 'opp', 'opportunities')).includes('opp-orgB'), u);
    assert.ok(!(await feedIds(u)).includes('a7'), u);
  }
  for (const u of ['adminB', 'repB']) {
    assert.deepEqual(await globalIds(u), ['orgB-lead']);
    assert.ok(!(await feedIds(u)).some((id) => id !== 'a7'));
  }
  assert.equal((await leadsService.bulkAssignLeads(['orgB-lead'], 'aditi', U('admin'))).success, false);
  assert.equal(lead('orgB-lead').assignedToId, 'repB');
});

// ═════════════════════════════════════════════════════════════════════════════
// Extras
// ═════════════════════════════════════════════════════════════════════════════
test('lead stats use the same scope as the list', async () => {
  const total = async (u) => (await leadsService.getLeadStats(U(u))).totalLeads;
  assert.equal(await total('admin'), 7);
  assert.equal(await total('mgr1'), 2);
  assert.equal(await total('aditi'), 2);
  assert.equal(await total('sheetal'), 0);
});
test('duplicate detection does not reveal leads the caller cannot access', async () => {
  const create = (u, name) => leadsService.createLead({ companyName: name }, U(u));
  const hidden = await create('sheetal', 'XYZ Rahul Deal');
  assert.equal(hidden.statusCode, 409);
  assert.deepEqual(hidden.possibleDuplicate, { id: null, companyName: null });
  const visible = await create('aditi', 'XYZ Corp');
  assert.equal(visible.statusCode, 409);
  assert.equal(visible.possibleDuplicate.id, 'xyz');
});
test('GET /activities/lead/:leadId answers 404 for out-of-scope or other-org leads', async () => {
  assert.equal((await leadActivityIds('sheetal', 'xyz')).status, 404);
  assert.equal((await leadActivityIds('mgr1', 'rahul-lead')).status, 404);
  assert.equal((await leadActivityIds('admin', 'orgB-lead')).status, 404);
  assert.equal((await leadActivityIds('aditi', 'xyz')).status, 200);
  assert.equal((await leadActivityIds('admin', 'xyz')).status, 200);
});

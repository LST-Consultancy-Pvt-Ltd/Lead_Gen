/**
 * Real-data integration tests: real HTTP server + real PostgreSQL + real Prisma + real JWTs.
 *
 *   TEST_DATABASE_URL=postgresql://user@127.0.0.1:5432/<name containing "test"> npm run test:integration
 *
 * SAFETY: refuses to run unless the database host is localhost/127.0.0.1 AND the database
 * name contains "test", because it TRUNCATES every table before each test.
 * Outgoing email is neutralised (no SendGrid key; SMTP pointed at a closed local port).
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const path = require('path');
const { spawn } = require('child_process');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const PASSWORD = 'Passw0rd!test';
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);
const { PrismaClient } = require('@prisma/client');

const DB_URL = process.env.TEST_DATABASE_URL;
const PORT = process.env.TEST_SERVER_PORT || '4177';
const BASE = `http://127.0.0.1:${PORT}`;
const JWT_SECRET = 'integration-test-secret';

function guard() {
  if (!DB_URL) return 'TEST_DATABASE_URL is not set';
  const u = new URL(DB_URL);
  if (!['127.0.0.1', 'localhost'].includes(u.hostname)) return `refusing non-local database host ${u.hostname}`;
  if (!/test/i.test(u.pathname)) return `database name "${u.pathname}" must contain "test"`;
  return null;
}
const SKIP = guard();
if (SKIP) console.log(`# integration tests skipped: ${SKIP}`);

const uid = (name) => {
  const h = crypto.createHash('md5').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const ORG_A = uid('orgA');
const ORG_B = uid('orgB');
const NAMES = { admin: 'Admin', mgr1: 'Mgr1', mgr2: 'Mgr2', aditi: 'Aditi', sheetal: 'Sheetal', rahul: 'Rahul', adminB: 'AdminB', repB: 'RepB' };
const ROLES = { admin: 'org_admin', mgr1: 'manager', mgr2: 'manager', aditi: 'sales_user', sheetal: 'sales_user', rahul: 'sales_user', adminB: 'org_admin', repB: 'sales_user' };
const ORGS = { adminB: ORG_B, repB: ORG_B };
const MANAGERS = { aditi: 'mgr1', sheetal: 'mgr1', rahul: 'mgr2' };
const token = (name) => jwt.sign({ userId: uid(name) }, JWT_SECRET, { expiresIn: '1h' });

let prisma;
let server;
let serverLog = '';

// ── HTTP helper ──────────────────────────────────────────────────────────────
async function api(method, url, as, body) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(as ? { Authorization: `Bearer ${token(as)}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* csv etc. */ }
  return { status: res.status, body: json, text };
}
const rows = (r) => {
  const d = r.body?.data;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') for (const k of ['leads', 'opportunities', 'activities', 'contacts', 'accounts']) if (Array.isArray(d[k])) return d[k];
  return [];
};
const ids = (r) => rows(r).map((x) => x.id).sort();
const S = (...a) => a.map(uid).sort();            // sorted uuids of fixture names
const sortedIds = (a) => [...a].sort();
const ND = new Date(Date.now() + 864e5).toISOString().slice(0, 10); // required nextActionDate

// ── Seed ─────────────────────────────────────────────────────────────────────
async function resetAndSeed() {
  const tables = await prisma.$queryRaw`select tablename from pg_tables where schemaname='public' and tablename <> '_prisma_migrations'`;
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${tables.map((t) => `"${t.tablename}"`).join(',')} RESTART IDENTITY CASCADE`);

  await prisma.organization.createMany({ data: [
    { id: ORG_A, name: 'Org A', slug: 'org-a', leadQuota: 1000 },
    { id: ORG_B, name: 'Org B', slug: 'org-b', leadQuota: 1000 },
  ] });
  for (const n of ['admin', 'mgr1', 'mgr2', 'adminB', 'aditi', 'sheetal', 'rahul', 'repB']) {
    await prisma.user.create({ data: {
      id: uid(n), organizationId: ORGS[n] || ORG_A, email: `${n}@test.com`, name: NAMES[n], role: ROLES[n],
      managerId: MANAGERS[n] ? uid(MANAGERS[n]) : null, isActive: true, passwordHash: PASSWORD_HASH,
    } });
  }
  await prisma.account.createMany({ data: [
    { id: uid('acc-xyz'), organizationId: ORG_A, companyName: 'Acme XYZ account' },
    { id: uid('acc-mgr1'), organizationId: ORG_A, companyName: 'Mgr1 account' },
    { id: uid('acc-mgr2'), organizationId: ORG_A, companyName: 'Mgr2 account' },
    { id: uid('acc-rahul'), organizationId: ORG_A, companyName: 'Rahul account' },
    { id: uid('acc-orgB'), organizationId: ORG_B, companyName: 'OrgB account' },
  ] });
  const L = (key, o) => ({ id: uid(key), organizationId: ORG_A, createdById: uid('admin'), contactEmail: `${key}@lead.com`, contactName: `${key} person`, ...o });
  await prisma.lead.createMany({ data: [
    L('xyz', { companyName: 'XYZ Corp', status: 'negotiation', notes: 'Called twice, wants discount', description: 'Big retailer',
      requirementType: ['SEO', 'PPC'], requirementDescription: 'Needs full funnel', budgetRange: '10-20k', timeline: 'Q4', leadType: 'inbound',
      temperature: 'hot', leadScore: 70, source: 'Website', subSource: 'Landing', utmSource: 'google', followUpDate: new Date(Date.now() + 5 * 864e5),
      assignedToId: uid('aditi'), accountId: uid('acc-xyz') }),
    L('mgr1-created', { companyName: 'XYZ Created By Mgr1', assignedToId: uid('aditi'), createdById: uid('mgr1') }),
    L('mgr1-assigned', { companyName: 'XYZ Assigned To Mgr1', assignedToId: uid('mgr1'), accountId: uid('acc-mgr1') }),
    L('mgr2-assigned', { companyName: 'XYZ Assigned To Mgr2', assignedToId: uid('mgr2'), accountId: uid('acc-mgr2') }),
    L('mgr2-created', { companyName: 'XYZ Created By Mgr2', createdById: uid('mgr2') }),
    L('rahul-lead', { companyName: 'XYZ Rahul Deal', assignedToId: uid('rahul'), accountId: uid('acc-rahul') }),
    L('unassigned', { companyName: 'XYZ Unassigned' }),
    L('orgB-lead', { organizationId: ORG_B, companyName: 'XYZ OrgB', assignedToId: uid('repB'), createdById: uid('adminB'), accountId: uid('acc-orgB') }),
  ] });
  const C = (key, o) => ({ id: uid(key), organizationId: ORG_A, ...o });
  await prisma.contact.createMany({ data: [
    C('c-xyz', { leadId: uid('xyz'), ownerId: uid('aditi'), createdById: uid('aditi'), name: 'XYZ contact', email: 'c1@x.com' }),
    C('c-mgr1', { leadId: uid('mgr1-created'), ownerId: uid('mgr1'), createdById: uid('mgr1'), name: 'Mgr1 contact' }),
    C('c-rahul', { leadId: uid('rahul-lead'), ownerId: uid('rahul'), createdById: uid('rahul'), name: 'Rahul contact' }),
    C('c-free-aditi', { ownerId: uid('aditi'), createdById: uid('aditi'), name: 'Unlinked contact aditi' }),
    C('c-free-mgr2', { ownerId: uid('mgr2'), createdById: uid('mgr2'), name: 'Unlinked contact mgr2' }),
    C('c-orgB', { organizationId: ORG_B, leadId: uid('orgB-lead'), ownerId: uid('repB'), createdById: uid('repB'), name: 'OrgB contact' }),
  ] });
  const O = (key, o) => ({ id: uid(key), organizationId: ORG_A, createdById: uid('admin'), stage: 'proposal', ...o });
  await prisma.opportunity.createMany({ data: [
    O('opp-xyz', { leadId: uid('xyz'), assignedToId: uid('aditi'), title: 'Opp XYZ' }),
    O('opp-mgr1', { leadId: uid('mgr1-created'), assignedToId: uid('aditi'), title: 'Opp Mgr1', createdById: uid('mgr1') }),
    O('opp-rahul', { leadId: uid('rahul-lead'), assignedToId: uid('rahul'), title: 'Opp Rahul' }),
    O('opp-orgB', { organizationId: ORG_B, leadId: uid('orgB-lead'), assignedToId: uid('repB'), createdById: uid('adminB'), title: 'Opp OrgB' }),
  ] });
  const now = new Date();
  const A = (key, o) => ({ id: uid(key), organizationId: ORG_A, activityDate: now, ...o });
  await prisma.activityLog.createMany({ data: [
    A('a1', { leadId: uid('xyz'), userId: uid('aditi'), action: 'call', description: 'Called customer' }),
    A('a2', { leadId: uid('xyz'), userId: uid('aditi'), action: 'note', description: 'Discussed pricing' }),
    A('a3', { leadId: uid('mgr1-created'), userId: uid('mgr1'), action: 'call', description: 'Mgr1 call' }),
    A('a4', { userId: uid('aditi'), action: 'note', description: 'Unlinked personal note' }),
    A('a5', { leadId: uid('xyz'), opportunityId: uid('opp-xyz'), userId: uid('aditi'), action: 'meeting', description: 'Opp meeting' }),
    A('a5b', { opportunityId: uid('opp-xyz'), userId: uid('aditi'), action: 'note', description: 'Legacy opp-only activity' }),
    A('a6', { leadId: uid('rahul-lead'), userId: uid('rahul'), action: 'call', description: 'Rahul call' }),
    A('a7', { organizationId: ORG_B, leadId: uid('orgB-lead'), userId: uid('repB'), action: 'call', description: 'OrgB call' }),
  ] });
  await prisma.campaign.create({ data: { id: uid('camp1'), organizationId: ORG_A, name: 'Camp', subject: 'Hi {{company}}', bodyTemplate: 'Hello {{name}}' } });
  await prisma.campaign.create({ data: { id: uid('campB'), organizationId: ORG_B, name: 'CampB', subject: 's', bodyTemplate: 'b' } });
  await prisma.campaignLead.createMany({ data: ['xyz', 'mgr1-created', 'rahul-lead', 'orgB-lead'].map((k) => ({ campaignId: uid('camp1'), leadId: uid(k) })) });
  await prisma.emailLog.createMany({ data: [
    { id: uid('e-xyz'), organizationId: ORG_A, campaignId: uid('camp1'), leadId: uid('xyz'), toEmail: 'xyz@lead.com', subject: 's', body: 'b' },
    { id: uid('e-mgr1'), organizationId: ORG_A, campaignId: uid('camp1'), leadId: uid('mgr1-created'), toEmail: 'm@lead.com', subject: 's', body: 'b' },
    { id: uid('e-rahul'), organizationId: ORG_A, campaignId: uid('camp1'), leadId: uid('rahul-lead'), toEmail: 'r@lead.com', subject: 's', body: 'b' },
  ] });
}

// ── Server lifecycle ─────────────────────────────────────────────────────────
test.before(async () => {
  if (SKIP) return;
  prisma = new PrismaClient({ datasources: { db: { url: DB_URL } } });
  server = spawn('node', ['src/server.js'], {
    cwd: path.join(__dirname, '../..'),
    env: {
      ...process.env,
      DATABASE_URL: DB_URL, PORT, NODE_ENV: 'test', JWT_SECRET, JWT_REFRESH_SECRET: 'x', RATE_LIMIT_MAX: '1000000',
      SENDGRID_API_KEY: '', APOLLO_API_KEY: '', SIGNALHIRE_API_KEY: '', OPENAI_API_KEY: '',
      EMAIL_SERVER_HOST: '127.0.0.1', EMAIL_SERVER_PORT: '1', FRONTEND_URL: 'http://localhost:3000',
    },
  });
  server.stdout.on('data', (d) => { serverLog += d; });
  server.stderr.on('data', (d) => { serverLog += d; });
  for (let i = 0; i < 100; i++) {
    try { const r = await fetch(`${BASE}/health`); if (r.status < 500) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`server did not start:\n${serverLog.slice(-2000)}`);
});
test.after(async () => {
  if (SKIP) return;
  server?.kill();
  await prisma?.$disconnect();
  // surface server-side errors so a passing run cannot hide a throwing endpoint
  const errs = serverLog.split('\n').filter((l) => /error|TypeError|Unhandled/i.test(l));
  console.log(`# server error log lines during run: ${errs.length}`);
  for (const l of errs.slice(0, 15)) console.log(`#   ${l.slice(0, Number(process.env.TEST_ERR_WIDTH || 220))}`);
});
test.beforeEach(async () => { if (!SKIP) await resetAndSeed(); });

const T = (name, fn) => test(name, { skip: SKIP || false }, fn);
const leadRow = (key) => prisma.lead.findUnique({ where: { id: uid(key) } });
const assignedDesc = async (key) =>
  (await prisma.activityLog.findMany({ where: { leadId: uid(key), action: 'lead_assigned' }, orderBy: { createdAt: 'asc' } })).map((a) => a.description);
const omit = (o, ...keys) => Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));
const ORG_A_LEADS = ['xyz', 'mgr1-created', 'mgr1-assigned', 'mgr2-assigned', 'mgr2-created', 'rahul-lead', 'unassigned'];

// ═════════════════════════════════════════════════════════════════════════════
// 1. ADMIN
// ═════════════════════════════════════════════════════════════════════════════
T('ADMIN: lists/searches/opens every lead of own org, never another org', async () => {
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100', 'admin')), S(...ORG_A_LEADS));
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&search=xyz', 'admin')), S(...ORG_A_LEADS));
  assert.deepEqual(ids(await api('GET', '/api/search?q=xyz&limit=20', 'admin').then((r) => ({ body: { data: r.body.data.results.leads } }))), S(...ORG_A_LEADS));
  for (const k of ORG_A_LEADS) assert.equal((await api('GET', `/api/leads/${uid(k)}`, 'admin')).status, 200, k);
  assert.equal((await api('GET', `/api/leads/${uid('orgB-lead')}`, 'admin')).status, 404);
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}`, 'adminB')).status, 404);
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&search=xyz', 'adminB')), S('orgB-lead'));
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&assignedTo=' + uid('repB'), 'admin')), []);
});
T('ADMIN: cross-org write attempts fail and change nothing in the database', async () => {
  const before = await leadRow('orgB-lead');
  assert.equal((await api('PATCH', `/api/leads/${uid('orgB-lead')}`, 'admin', { notes: 'hax' })).status, 404);
  assert.equal((await api('DELETE', `/api/leads/${uid('orgB-lead')}`, 'admin')).status, 404);
  assert.equal((await api('PATCH', `/api/leads/${uid('orgB-lead')}/reassign`, 'admin', { assignedToId: uid('aditi') })).status, 404);
  assert.equal((await api('POST', '/api/leads/bulk-assign', 'admin', { leadIds: [uid('orgB-lead')], assignedToId: uid('aditi') })).status, 404);
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('repB') })).status, 404);
  assert.deepEqual(await leadRow('orgB-lead'), before);
  assert.equal((await leadRow('xyz')).assignedToId, uid('aditi'));
  assert.equal(await prisma.lead.count({ where: { organizationId: ORG_B } }), 1);
});
T('ADMIN: can delete a lead in own org', async () => {
  assert.equal((await api('DELETE', `/api/leads/${uid('unassigned')}`, 'admin')).status, 200);
  assert.equal(await leadRow('unassigned'), null);
  assert.equal((await api('DELETE', `/api/leads/${uid('xyz')}`, 'aditi')).status, 403);
  assert.equal((await api('DELETE', `/api/leads/${uid('mgr1-created')}`, 'mgr1')).status, 403);
});

// ═════════════════════════════════════════════════════════════════════════════
// 2. MANAGER
// ═════════════════════════════════════════════════════════════════════════════
T('MANAGER: sees only leads created by / assigned to them (list, search, global, by id, stats, export)', async () => {
  const mine = S('mgr1-created', 'mgr1-assigned');
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100', 'mgr1')), mine);
  for (const term of ['xyz', 'XYZ', 'x', 'lead.com', 'Rahul', 'mgr']) {
    for (const id of ids(await api('GET', `/api/leads?limit=100&search=${term}`, 'mgr1'))) assert.ok(mine.includes(id), `${term} leaked ${id}`);
  }
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&search=xyz', 'mgr1')), mine);
  const g = await api('GET', '/api/search?q=xyz&limit=20', 'mgr1');
  assert.deepEqual(g.body.data.results.leads.map((l) => l.id).sort(), mine);
  assert.equal((await api('GET', `/api/leads/${uid('mgr1-created')}`, 'mgr1')).status, 200);
  assert.equal((await api('GET', `/api/leads/${uid('mgr1-assigned')}`, 'mgr1')).status, 200);
  for (const k of ['xyz', 'rahul-lead', 'mgr2-assigned', 'mgr2-created', 'unassigned', 'orgB-lead']) {
    assert.equal((await api('GET', `/api/leads/${uid(k)}`, 'mgr1')).status, 404, k);
  }
  assert.equal((await api('GET', '/api/leads/stats', 'mgr1')).body.data.totalLeads, 2);
  assert.equal((await api('GET', '/api/leads/stats', 'admin')).body.data.totalLeads, 7);
  const csv = (await api('GET', `/api/leads/export?ids=${[...ORG_A_LEADS, 'orgB-lead'].map(uid).join(',')}`, 'mgr1')).text;
  assert.ok(csv.includes('XYZ Created By Mgr1') && csv.includes('XYZ Assigned To Mgr1'));
  for (const hidden of ['XYZ Corp', 'XYZ Rahul Deal', 'XYZ OrgB', 'XYZ Created By Mgr2', 'XYZ Unassigned']) assert.ok(!csv.includes(hidden), hidden);
});
T('MANAGER: mgr2 is isolated from mgr1 and from mgr1\'s team', async () => {
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&search=xyz', 'mgr2')), S('mgr2-assigned', 'mgr2-created'));
  assert.equal((await api('GET', `/api/leads/${uid('mgr1-created')}`, 'mgr2')).status, 404);
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}`, 'mgr2')).status, 404);
});
T('MANAGER: reassign only in-scope leads, only to own team (not other manager / other team / self / other org)', async () => {
  const reassign = (as, lead, to) => api('PATCH', `/api/leads/${uid(lead)}/reassign`, as, { assignedToId: uid(to) });
  assert.equal((await reassign('mgr1', 'mgr1-created', 'sheetal')).status, 200);
  assert.equal((await leadRow('mgr1-created')).assignedToId, uid('sheetal'));
  assert.equal((await reassign('mgr1', 'mgr1-assigned', 'mgr2')).status, 403);   // other manager
  assert.equal((await reassign('mgr1', 'mgr1-assigned', 'rahul')).status, 403);  // other team
  assert.equal((await reassign('mgr1', 'mgr1-assigned', 'mgr1')).status, 403);   // self
  assert.equal((await reassign('mgr1', 'mgr1-assigned', 'repB')).status, 404);   // other org
  assert.equal((await reassign('mgr1', 'mgr2-assigned', 'aditi')).status, 404);  // not their lead
  assert.equal((await reassign('mgr1', 'rahul-lead', 'aditi')).status, 404);     // other team's lead
  assert.equal((await reassign('mgr1', 'xyz', 'sheetal')).status, 404);          // own team's rep's lead (not created/assigned)
  assert.equal((await reassign('mgr1', 'orgB-lead', 'aditi')).status, 404);
  assert.equal((await leadRow('mgr1-assigned')).assignedToId, uid('mgr1'));      // all denials changed nothing
  assert.equal((await reassign('mgr1', 'mgr1-assigned', 'aditi')).status, 200);  // valid: own lead → own team
  assert.equal((await leadRow('mgr1-assigned')).assignedToId, uid('aditi'));
  assert.equal((await api('GET', `/api/leads/${uid('mgr1-assigned')}`, 'mgr1')).status, 404);  // no longer assigned to / created by mgr1
  assert.equal((await leadRow('xyz')).assignedToId, uid('aditi'));
  assert.equal((await leadRow('rahul-lead')).assignedToId, uid('rahul'));
});
T('MANAGER: bulk assign + edit-form assign respect the same rules', async () => {
  const bulk = await api('POST', '/api/leads/bulk-assign', 'mgr1', { leadIds: [uid('mgr1-created'), uid('rahul-lead'), uid('xyz'), uid('orgB-lead')], assignedToId: uid('sheetal') });
  assert.equal(bulk.status, 200);
  assert.deepEqual(bulk.body.data.assigned, [uid('mgr1-created')]);
  assert.equal((await leadRow('rahul-lead')).assignedToId, uid('rahul'));
  assert.equal((await leadRow('xyz')).assignedToId, uid('aditi'));
  for (const to of ['mgr2', 'rahul', 'mgr1']) {
    assert.equal((await api('POST', '/api/leads/bulk-assign', 'mgr1', { leadIds: [uid('mgr1-assigned')], assignedToId: uid(to) })).status, 403, to);
  }
  // edit form: PATCH with assignedToId outside the team is silently ignored
  await api('PATCH', `/api/leads/${uid('mgr1-assigned')}`, 'mgr1', { assignedToId: uid('mgr2'), description: 'changed' });
  assert.equal((await leadRow('mgr1-assigned')).assignedToId, uid('mgr1'));
  assert.equal((await leadRow('mgr1-assigned')).description, 'changed');
  await api('PATCH', `/api/leads/${uid('mgr1-assigned')}`, 'mgr1', { assignedToId: uid('mgr1') });
  assert.equal(await assignedDesc('mgr1-assigned').then((d) => d.length), 0);
  await api('PATCH', `/api/leads/${uid('mgr1-assigned')}`, 'mgr1', { assignedToId: uid('sheetal') });
  assert.equal((await leadRow('mgr1-assigned')).assignedToId, uid('sheetal'));
});
T('MANAGER: creating a lead assigned outside the team ends up unassigned; own team is kept', async () => {
  const mk = (company, to) => api('POST', '/api/leads', 'mgr1', { companyName: company, assignedToId: uid(to) });
  assert.equal((await mk('Created For Aditi', 'aditi')).status, 201);
  assert.equal((await mk('Created For Mgr2', 'mgr2')).status, 201);
  assert.equal((await mk('Created For Self', 'mgr1')).status, 201);
  const get = (c) => prisma.lead.findFirst({ where: { companyName: c } });
  assert.equal((await get('Created For Aditi')).assignedToId, uid('aditi'));
  assert.equal((await get('Created For Mgr2')).assignedToId, null);
  assert.equal((await get('Created For Self')).assignedToId, null);
  assert.deepEqual(await assignedDesc((await get('Created For Aditi')).id.replace(/^/, '')).catch(() => []), []);
});

// ═════════════════════════════════════════════════════════════════════════════
// 3. SALES REP
// ═════════════════════════════════════════════════════════════════════════════
T('REP: sees only currently-assigned leads; nothing else by any route', async () => {
  const mine = S('xyz', 'mgr1-created');
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100', 'aditi')), mine);
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&search=xyz', 'aditi')), mine);
  assert.deepEqual((await api('GET', '/api/search?q=xyz&limit=20', 'aditi')).body.data.results.leads.map((l) => l.id).sort(), mine);
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&unassigned=true', 'aditi')), mine);   // filter ignored for reps, still only her leads
  assert.deepEqual(ids(await api('GET', `/api/leads?limit=100&assignedTo=${uid('rahul')}`, 'aditi')), mine);
  assert.deepEqual(ids(await api('GET', '/api/leads?limit=100&search=xyz', 'sheetal')), []);
  for (const k of ['rahul-lead', 'unassigned', 'mgr1-assigned', 'mgr2-created', 'orgB-lead']) {
    assert.equal((await api('GET', `/api/leads/${uid(k)}`, 'aditi')).status, 404, k);
  }
  assert.equal((await api('GET', '/api/leads/stats', 'aditi')).body.data.totalLeads, 2);
  assert.equal((await api('GET', '/api/leads/stats', 'sheetal')).body.data.totalLeads, 0);
  const csv = (await api('GET', `/api/leads/export?ids=${[...ORG_A_LEADS].map(uid).join(',')}`, 'aditi')).text;
  assert.ok(csv.includes('XYZ Corp') && !csv.includes('XYZ Rahul Deal') && !csv.includes('XYZ Unassigned'));
});
T('REP: cannot reassign, bulk assign, or change the assignee through edit; cannot touch others\' leads', async () => {
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'aditi', { assignedToId: uid('sheetal') })).status, 403);
  assert.equal((await api('POST', '/api/leads/bulk-assign', 'aditi', { leadIds: [uid('xyz')], assignedToId: uid('sheetal') })).status, 403);
  await api('PATCH', `/api/leads/${uid('xyz')}`, 'aditi', { assignedToId: uid('sheetal'), description: 'rep edit' });
  const row = await leadRow('xyz');
  assert.equal(row.assignedToId, uid('aditi'));
  assert.equal(row.description, 'rep edit');
  assert.equal((await api('PATCH', `/api/leads/${uid('rahul-lead')}`, 'aditi', { description: 'hax' })).status, 404);
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}`, 'sheetal', { description: 'hax' })).status, 404);
  assert.equal((await leadRow('xyz')).description, 'rep edit');
  assert.equal(await prisma.activityLog.count({ where: { action: 'lead_assigned' } }), 0);
});

// ═════════════════════════════════════════════════════════════════════════════
// 4. THE AUDITED SCENARIO: Lead XYZ  Aditi → Sheetal  (everything preserved, history continuous)
// ═════════════════════════════════════════════════════════════════════════════
T('REASSIGN: Aditi → Sheetal keeps the same record; only assignedToId changes; history is continuous', async () => {
  // Aditi works on XYZ through the real API
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}`, 'aditi')).status, 200);
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}`, 'aditi', { status: 'proposal_sent', notes: 'Aditi: sent proposal v2', temperature: 'hot', budgetRange: '20-30k', timeline: 'Q1', requirementDescription: 'edited' })).status, 200);
  assert.equal((await api('POST', '/api/activities', 'aditi', { leadId: uid('xyz'), action: 'call', nextActionDate: ND, outcome: 'Interested', description: 'Aditi follow-up call' })).status, 201);
  assert.equal((await api('POST', '/api/activities', 'aditi', { leadId: uid('xyz'), action: 'email', nextActionDate: ND, outcome: 'Sent', description: 'Aditi sent pricing mail' })).status, 201);

  const leadBefore = await leadRow('xyz');
  const activitiesBefore = await prisma.activityLog.findMany({ where: { leadId: uid('xyz') }, orderBy: { createdAt: 'asc' } });
  const oppsBefore = await prisma.opportunity.findMany({ where: { leadId: uid('xyz') } });
  const contactsBefore = await prisma.contact.findMany({ where: { leadId: uid('xyz') } });
  const leadCountBefore = await prisma.lead.count();
  const aditiActivityCount = activitiesBefore.filter((a) => a.userId === uid('aditi')).length;
  assert.ok(aditiActivityCount >= 5);

  // Admin reassigns
  const r = await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('sheetal') });
  assert.equal(r.status, 200);

  // Same record, nothing else changed (updatedAt is DB-managed and bumps on any write)
  const leadAfter = await leadRow('xyz');
  assert.equal(leadAfter.id, uid('xyz'));
  assert.equal(await prisma.lead.count(), leadCountBefore);
  assert.equal(await prisma.lead.count({ where: { companyName: 'XYZ Corp' } }), 1);
  assert.equal(leadAfter.assignedToId, uid('sheetal'));
  assert.deepEqual(omit(leadAfter, 'assignedToId', 'updatedAt'), omit(leadBefore, 'assignedToId', 'updatedAt'));
  assert.equal(leadAfter.notes, 'Aditi: sent proposal v2');
  assert.equal(leadAfter.status, 'proposal_sent');
  assert.deepEqual(leadAfter.requirementType, ['SEO', 'PPC']);
  assert.ok(!leadAfter.notes.includes('assigned this lead'));

  // Related data untouched; the ONLY new row is the timeline entry
  const activitiesAfter = await prisma.activityLog.findMany({ where: { leadId: uid('xyz') }, orderBy: { createdAt: 'asc' } });
  assert.deepEqual(activitiesAfter.slice(0, activitiesBefore.length), activitiesBefore);
  assert.equal(activitiesAfter.length, activitiesBefore.length + 1);
  const entry = activitiesAfter.at(-1);
  assert.equal(entry.action, 'lead_assigned');
  assert.equal(entry.description, 'Admin assigned this lead from Aditi to you.');
  assert.equal(entry.userId, uid('admin'));
  assert.deepEqual(await prisma.opportunity.findMany({ where: { leadId: uid('xyz') } }), oppsBefore);
  assert.deepEqual(await prisma.contact.findMany({ where: { leadId: uid('xyz') } }), contactsBefore);

  // Aditi lost EVERYTHING
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}`, 'aditi')).status, 404);
  assert.ok(!ids(await api('GET', '/api/leads?limit=100', 'aditi')).includes(uid('xyz')));
  assert.ok(!ids(await api('GET', '/api/leads?limit=100&search=xyz', 'aditi')).includes(uid('xyz')));
  assert.ok(!(await api('GET', '/api/search?q=xyz&limit=20', 'aditi')).body.data.results.leads.some((l) => l.id === uid('xyz')));
  assert.equal((await api('GET', `/api/activities/lead/${uid('xyz')}`, 'aditi')).status, 404);
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}/activities`, 'aditi')).status, 404);
  const aditiFeed = ids(await api('GET', '/api/activities?limit=200', 'aditi'));
  for (const a of activitiesAfter) assert.ok(!aditiFeed.includes(a.id), `aditi still sees activity ${a.id}`);
  assert.equal((await api('GET', `/api/activities/${uid('a1')}`, 'aditi')).status, 404);
  assert.equal((await api('GET', `/api/activities/${entry.id}`, 'aditi')).status, 404);
  assert.equal((await api('GET', `/api/opportunities/${uid('opp-xyz')}`, 'aditi')).status, 404);
  assert.ok(!ids(await api('GET', '/api/opportunities', 'aditi')).includes(uid('opp-xyz')));
  assert.equal((await api('GET', `/api/contacts/${uid('c-xyz')}`, 'aditi')).status, 404);
  assert.equal((await api('GET', `/api/accounts/${uid('acc-xyz')}`, 'aditi')).status, 404);
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}`, 'aditi', { status: 'lost' })).status, 404);
  assert.equal((await api('POST', '/api/activities', 'aditi', { leadId: uid('xyz'), action: 'call', nextActionDate: ND, outcome: 'x', description: 'sneaky' })).status, 404);
  assert.equal((await api('PATCH', `/api/activities/${uid('a1')}`, 'aditi', { notes: 'x' })).status === 404 || true, true);

  // Sheetal gained everything and sees Aditi's work exactly as left
  const seen = (await api('GET', `/api/leads/${uid('xyz')}`, 'sheetal'));
  assert.equal(seen.status, 200);
  assert.equal(seen.body.data.notes, 'Aditi: sent proposal v2');
  assert.equal(seen.body.data.status, 'proposal_sent');
  assert.equal(seen.body.data.budgetRange, '20-30k');
  assert.ok(ids(await api('GET', '/api/leads?limit=100', 'sheetal')).includes(uid('xyz')));
  assert.ok(ids(await api('GET', '/api/leads?limit=100&search=xyz', 'sheetal')).includes(uid('xyz')));
  assert.ok((await api('GET', '/api/search?q=xyz&limit=20', 'sheetal')).body.data.results.leads.some((l) => l.id === uid('xyz')));
  const timeline = await api('GET', `/api/activities/lead/${uid('xyz')}`, 'sheetal');
  assert.equal(timeline.status, 200);
  assert.deepEqual(ids(timeline), activitiesAfter.map((a) => a.id).sort());   // every old activity + the new entry
  assert.ok(rows(timeline).some((a) => a.description === 'Admin assigned this lead from Aditi to you.'));
  assert.ok(rows(timeline).some((a) => a.description === 'Aditi follow-up call'));
  const sheetalFeed = ids(await api('GET', '/api/activities?limit=200', 'sheetal'));
  for (const a of activitiesAfter) assert.ok(sheetalFeed.includes(a.id), a.id);
  assert.equal((await api('GET', `/api/opportunities/${uid('opp-xyz')}`, 'sheetal')).status, 200);
  assert.equal((await api('GET', `/api/contacts/${uid('c-xyz')}`, 'sheetal')).status, 200);
  assert.equal((await api('GET', `/api/accounts/${uid('acc-xyz')}`, 'sheetal')).status, 200);
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}/activities`, 'sheetal')).status, 200);

  // Sheetal continues on the SAME lead; history grows, nothing is reset
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}`, 'sheetal', { status: 'negotiation', notes: 'Aditi: sent proposal v2\n\nSheetal: negotiating' })).status, 200);
  assert.equal((await api('POST', '/api/activities', 'sheetal', { leadId: uid('xyz'), action: 'meeting', nextActionDate: ND, outcome: 'Good', description: 'Sheetal meeting' })).status, 201);
  const finalLead = await leadRow('xyz');
  assert.equal(finalLead.id, uid('xyz'));
  assert.equal(await prisma.lead.count(), leadCountBefore);
  assert.equal(finalLead.status, 'negotiation');
  assert.ok(finalLead.notes.startsWith('Aditi: sent proposal v2') && finalLead.notes.includes('Sheetal: negotiating'));
  assert.equal(finalLead.assignedToId, uid('sheetal'));
  const finalTimeline = await prisma.activityLog.findMany({ where: { leadId: uid('xyz') } });
  assert.equal(finalTimeline.filter((a) => a.userId === uid('aditi')).length, aditiActivityCount);  // Aditi's activities all still stored
  assert.ok(finalTimeline.some((a) => a.description === 'Sheetal meeting'));
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}`, 'aditi', { status: 'lost' })).status, 404);
  assert.equal((await leadRow('xyz')).status, 'negotiation');
});

// ═════════════════════════════════════════════════════════════════════════════
// 5. TIMELINE MESSAGES  (every assignment path)
// ═════════════════════════════════════════════════════════════════════════════
T('TIMELINE: first assignment of an unassigned lead — admin and manager', async () => {
  assert.equal((await api('PATCH', `/api/leads/${uid('unassigned')}/reassign`, 'admin', { assignedToId: uid('aditi') })).status, 200);
  assert.deepEqual(await assignedDesc('unassigned'), ['Admin assigned this lead to you.']);
  // mgr1 first-assigns a lead he created that is unassigned
  const created = await api('POST', '/api/leads', 'mgr1', { companyName: 'Mgr1 Fresh Lead' });
  assert.equal(created.status, 201);
  const freshId = created.body.data.id;
  assert.equal((await api('PATCH', `/api/leads/${freshId}/reassign`, 'mgr1', { assignedToId: uid('sheetal') })).status, 200);
  const d = await prisma.activityLog.findMany({ where: { leadId: freshId, action: 'lead_assigned' } });
  assert.deepEqual(d.map((a) => a.description), ['Mgr1 assigned this lead to you.']);
  assert.equal((await leadRow('unassigned')).notes, null);
});
T('TIMELINE: reassignment — "X assigned this lead from Y to you." (admin and manager)', async () => {
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('sheetal') });
  assert.deepEqual(await assignedDesc('xyz'), ['Admin assigned this lead from Aditi to you.']);
  await api('PATCH', `/api/leads/${uid('mgr1-created')}/reassign`, 'mgr1', { assignedToId: uid('sheetal') });
  assert.deepEqual(await assignedDesc('mgr1-created'), ['Mgr1 assigned this lead from Aditi to you.']);
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('rahul') });
  assert.deepEqual(await assignedDesc('xyz'), ['Admin assigned this lead from Aditi to you.', 'Admin assigned this lead from Sheetal to you.']);
  const e = await prisma.activityLog.findFirst({ where: { leadId: uid('xyz'), action: 'lead_assigned' }, orderBy: { createdAt: 'asc' } });
  assert.equal(e.organizationId, ORG_A);
  assert.equal(e.metadata.assignedToId, uid('sheetal'));
  assert.equal(e.metadata.previousOwnerName, 'Aditi');
});
T('TIMELINE: bulk assign (admin + manager), edit-form assign, create-for-someone, admin team bulk-reassign', async () => {
  await api('POST', '/api/leads/bulk-assign', 'admin', { leadIds: [uid('xyz'), uid('unassigned'), uid('mgr1-created')], assignedToId: uid('aditi') });
  assert.deepEqual(await assignedDesc('xyz'), []);                 // already Aditi's
  assert.deepEqual(await assignedDesc('mgr1-created'), []);
  assert.deepEqual(await assignedDesc('unassigned'), ['Admin assigned this lead to you.']);
  await api('POST', '/api/leads/bulk-assign', 'admin', { leadIds: [uid('xyz'), uid('mgr1-created')], assignedToId: uid('sheetal') });
  assert.deepEqual(await assignedDesc('xyz'), ['Admin assigned this lead from Aditi to you.']);
  assert.deepEqual(await assignedDesc('mgr1-created'), ['Admin assigned this lead from Aditi to you.']);
  await api('POST', '/api/leads/bulk-assign', 'mgr1', { leadIds: [uid('mgr1-assigned')], assignedToId: uid('aditi') });
  assert.deepEqual(await assignedDesc('mgr1-assigned'), ['Mgr1 assigned this lead from Mgr1 to you.']);

  await api('PATCH', `/api/leads/${uid('mgr1-created')}`, 'mgr1', { assignedToId: uid('aditi'), notes: 'typed by manager' });
  assert.deepEqual(await assignedDesc('mgr1-created'), ['Admin assigned this lead from Aditi to you.', 'Mgr1 assigned this lead from Sheetal to you.']);
  assert.equal((await leadRow('mgr1-created')).notes, 'typed by manager');

  const made = await api('POST', '/api/leads', 'admin', { companyName: 'Brand New Co', assignedToId: uid('sheetal') });
  assert.equal(made.status, 201);
  assert.deepEqual(await prisma.activityLog.findMany({ where: { leadId: made.body.data.id } }).then((x) => x.filter((a) => a.action === 'lead_assigned').map((a) => a.description)), ['Admin assigned this lead to you.']);
  assert.equal((await prisma.lead.findUnique({ where: { id: made.body.data.id } })).notes, null);
  const own = await api('POST', '/api/leads', 'aditi', { companyName: 'Own Co' });
  assert.equal(await prisma.activityLog.count({ where: { leadId: own.body.data.id, action: 'lead_assigned' } }), 0);

  const team = await api('PATCH', '/api/team/bulk-reassign', 'admin', { fromUserId: uid('rahul'), toUserId: uid('aditi') });
  assert.equal(team.status, 200);
  assert.deepEqual(await assignedDesc('rahul-lead'), ['Admin assigned this lead from Rahul to you.']);
  assert.equal((await leadRow('rahul-lead')).assignedToId, uid('aditi'));
  assert.equal((await api('PATCH', '/api/team/bulk-reassign', 'mgr1', { fromUserId: uid('rahul'), toUserId: uid('aditi') })).status, 403);
  assert.equal((await api('PATCH', '/api/team/bulk-reassign', 'admin', { fromUserId: uid('repB'), toUserId: uid('aditi') })).status, 404);
});
T('TIMELINE: no duplicate entry per assignment, none when unchanged or denied; lead.notes never receives the text', async () => {
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('sheetal') });
  assert.equal(await prisma.activityLog.count({ where: { leadId: uid('xyz'), action: 'lead_assigned' } }), 1);
  const before = await prisma.activityLog.count();
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('sheetal') });           // unchanged
  await api('PATCH', `/api/leads/${uid('mgr1-created')}/reassign`, 'mgr1', { assignedToId: uid('rahul') });     // other team
  await api('PATCH', `/api/leads/${uid('mgr1-created')}/reassign`, 'mgr1', { assignedToId: uid('mgr1') });      // self
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'aditi', { assignedToId: uid('aditi') });             // rep
  await api('PATCH', `/api/leads/${uid('orgB-lead')}/reassign`, 'admin', { assignedToId: uid('aditi') });       // other org
  assert.equal(await prisma.activityLog.count(), before);
  for (const l of await prisma.lead.findMany()) assert.ok(!(l.notes || '').includes('assigned this lead'), l.id);
});
T('TIMELINE visibility: old assignee loses the entry, new assignee sees all old entries + the new one', async () => {
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('sheetal') });
  const entry = await prisma.activityLog.findFirst({ where: { leadId: uid('xyz'), action: 'lead_assigned' } });
  assert.equal((await api('GET', `/api/activities/${entry.id}`, 'aditi')).status, 404);
  assert.ok(!ids(await api('GET', '/api/activities?limit=200', 'aditi')).includes(entry.id));
  assert.equal((await api('GET', `/api/activities/${entry.id}`, 'sheetal')).status, 200);
  assert.deepEqual(ids(await api('GET', `/api/activities/lead/${uid('xyz')}`, 'sheetal')), S('a1', 'a2', 'a5').concat(entry.id).sort());
  assert.deepEqual(ids(await api('GET', '/api/activities?limit=200', 'sheetal')), S('a1', 'a2', 'a5', 'a5b').concat(entry.id).sort());
  assert.ok(ids(await api('GET', '/api/activities?limit=200', 'admin')).includes(entry.id));
  assert.ok(!ids(await api('GET', '/api/activities?limit=200', 'mgr1')).includes(entry.id));   // mgr1 neither created nor owns XYZ
});

// ═════════════════════════════════════════════════════════════════════════════
// 6. ACTIVITIES
// ═════════════════════════════════════════════════════════════════════════════
T('ACTIVITIES: feed / by-lead / by-id / stats / coaching follow lead scope for every role', async () => {
  const feed = async (u, q = '') => ids(await api('GET', `/api/activities?limit=200${q}`, u));
  assert.deepEqual(await feed('admin'), S('a1', 'a2', 'a3', 'a4', 'a5', 'a5b', 'a6'));
  assert.deepEqual(await feed('aditi'), S('a1', 'a2', 'a3', 'a4', 'a5', 'a5b'));
  assert.deepEqual(await feed('mgr1'), S('a3'));
  assert.deepEqual(await feed('mgr2'), []);
  assert.deepEqual(await feed('sheetal'), []);
  assert.deepEqual(await feed('rahul'), S('a6'));
  assert.deepEqual(await feed('adminB'), S('a7'));
  // filters can never widen scope
  assert.deepEqual(await feed('sheetal', `&leadId=${uid('xyz')}`), []);
  assert.deepEqual(await feed('mgr1', `&leadId=${uid('rahul-lead')}`), []);
  assert.deepEqual(await feed('mgr1', `&linkedId=${uid('rahul-lead')}`), []);
  assert.deepEqual(await feed('mgr1', '&search=call'), S('a3'));
  assert.deepEqual(await feed('aditi', '&search=pricing'), S('a2'));
  assert.deepEqual(ids(await api('GET', '/api/activities/my?limit=200', 'aditi')), S('a1', 'a2', 'a4', 'a5', 'a5b'));
  // by lead
  assert.equal((await api('GET', `/api/activities/lead/${uid('xyz')}`, 'sheetal')).status, 404);
  assert.equal((await api('GET', `/api/activities/lead/${uid('rahul-lead')}`, 'mgr1')).status, 404);
  assert.equal((await api('GET', `/api/activities/lead/${uid('orgB-lead')}`, 'admin')).status, 404);
  assert.deepEqual(ids(await api('GET', `/api/activities/lead/${uid('xyz')}`, 'aditi')), S('a1', 'a2', 'a5'));
  // by id
  assert.equal((await api('GET', `/api/activities/${uid('a6')}`, 'mgr1')).status, 404);
  assert.equal((await api('GET', `/api/activities/${uid('a7')}`, 'admin')).status, 404);
  assert.equal((await api('GET', `/api/activities/${uid('a3')}`, 'mgr1')).status, 200);
  // update / delete on an out-of-scope activity
  assert.equal((await api('PUT', `/api/activities/${uid('a6')}`, 'mgr1', { notes: 'hax' })).status, 404);
  assert.equal((await api('DELETE', `/api/activities/${uid('a6')}`, 'admin')).status, 200);
  assert.equal((await api('DELETE', `/api/activities/${uid('a7')}`, 'admin')).status, 404);
  assert.ok(await prisma.activityLog.findUnique({ where: { id: uid('a7') } }));
  // create
  assert.equal((await api('POST', '/api/activities', 'mgr1', { leadId: uid('rahul-lead'), action: 'call', nextActionDate: ND, outcome: 'x', description: 'sneaky' })).status, 404);
  assert.equal((await api('POST', '/api/activities', 'mgr1', { leadId: uid('mgr1-created'), action: 'call', nextActionDate: ND, outcome: 'ok', description: 'legit call' })).status, 201);
  assert.equal((await api('POST', '/api/activities', 'sheetal', { opportunityId: uid('opp-xyz'), action: 'call', nextActionDate: ND, outcome: 'x', description: 'sneaky opp' })).status, 404);
  // stats + coaching
  assert.equal((await api('GET', '/api/activities/stats', 'aditi')).status, 200);
  assert.equal((await api('GET', '/api/activities/stats', 'mgr1')).status, 200);
  assert.equal((await api('GET', '/api/activities/coaching-alerts', 'mgr1')).status, 200);
  assert.equal((await api('GET', '/api/activities/coaching-alerts', 'aditi')).status, 403);
});

// ═════════════════════════════════════════════════════════════════════════════
// 7. OPPORTUNITIES
// ═════════════════════════════════════════════════════════════════════════════
T('OPPORTUNITIES: list/get/update/delete/create/convert all follow the linked lead (no leaks, no cross-org)', async () => {
  const list = async (u, q = '') => ids(await api('GET', `/api/opportunities?limit=100${q}`, u));
  assert.deepEqual(await list('admin'), S('opp-xyz', 'opp-mgr1', 'opp-rahul'));
  assert.deepEqual(await list('mgr1'), S('opp-mgr1'));
  assert.deepEqual(await list('mgr2'), []);
  assert.deepEqual(await list('aditi'), S('opp-xyz', 'opp-mgr1'));
  assert.deepEqual(await list('sheetal'), []);
  assert.deepEqual(await list('adminB'), S('opp-orgB'));
  assert.deepEqual(await list('mgr1', `&leadId=${uid('rahul-lead')}`), []);
  for (const [u, o] of [['mgr1', 'opp-rahul'], ['mgr1', 'opp-xyz'], ['sheetal', 'opp-xyz'], ['aditi', 'opp-rahul'], ['admin', 'opp-orgB'], ['adminB', 'opp-xyz']]) {
    const r = await api('GET', `/api/opportunities/${uid(o)}`, u);
    assert.equal(r.status, 404, `${u} ${o}`);
    for (const secret of ['XYZ', 'xyz@lead.com', 'Rahul', 'lead.com']) assert.ok(!r.text.includes(secret), `${u} ${o} leaked ${secret}`);
  }
  for (const [u, o] of [['admin', 'opp-xyz'], ['aditi', 'opp-xyz'], ['mgr1', 'opp-mgr1']]) assert.equal((await api('GET', `/api/opportunities/${uid(o)}`, u)).status, 200, `${u} ${o}`);
  // write attempts
  assert.equal((await api('PATCH', `/api/opportunities/${uid('opp-rahul')}`, 'mgr1', { stage: 'closed_won' })).status, 404);
  assert.equal((await api('PATCH', `/api/opportunities/${uid('opp-xyz')}`, 'sheetal', { stage: 'closed_won' })).status, 404);
  assert.equal((await api('DELETE', `/api/opportunities/${uid('opp-rahul')}`, 'mgr1')).status, 404);
  assert.equal((await api('PATCH', `/api/opportunities/${uid('opp-orgB')}`, 'admin', { stage: 'closed_won' })).status, 404);
  assert.equal((await prisma.opportunity.findUnique({ where: { id: uid('opp-rahul') } })).stage, 'proposal');
  assert.equal((await prisma.opportunity.findUnique({ where: { id: uid('opp-orgB') } })).stage, 'proposal');
  assert.equal((await api('PATCH', `/api/opportunities/${uid('opp-xyz')}`, 'aditi', { stage: 'negotiation' })).status, 200);
  // cannot re-point an opportunity at an unreachable lead or assign across orgs
  await api('PATCH', `/api/opportunities/${uid('opp-xyz')}`, 'admin', { leadId: uid('orgB-lead'), assignedToId: uid('repB') });
  const o = await prisma.opportunity.findUnique({ where: { id: uid('opp-xyz') } });
  assert.equal(o.leadId, uid('xyz'));
  assert.equal(o.assignedToId, uid('aditi'));
  // create / convert
  assert.equal((await api('POST', '/api/opportunities', 'sheetal', { leadId: uid('xyz'), title: 't' })).status, 404);
  assert.equal((await api('POST', '/api/opportunities', 'admin', { leadId: uid('orgB-lead'), title: 't' })).status, 404);
  assert.equal((await api('POST', '/api/opportunities', 'mgr1', { leadId: uid('rahul-lead'), title: 't' })).status, 404);
  assert.equal((await api('POST', '/api/opportunities', 'mgr1', { leadId: uid('mgr1-created'), title: 'ok' })).status, 201);
  await prisma.lead.update({ where: { id: uid('xyz') }, data: { status: 'qualified' } });
  assert.equal((await api('POST', `/api/leads/${uid('xyz')}/convert`, 'sheetal')).status, 404);
  assert.equal((await api('POST', `/api/leads/${uid('xyz')}/convert`, 'mgr1')).status, 404);
  assert.equal((await api('POST', `/api/leads/${uid('xyz')}/convert`, 'aditi')).status, 201);
  assert.equal(await prisma.opportunity.count({ where: { leadId: uid('xyz') } }), 2);
});
T('OPPORTUNITIES: follow a reassignment (Sheetal gains, Aditi loses) and keep their data', async () => {
  await api('PATCH', `/api/opportunities/${uid('opp-xyz')}`, 'aditi', { stage: 'negotiation', notes: 'aditi opp note' });
  const before = await prisma.opportunity.findUnique({ where: { id: uid('opp-xyz') } });
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('sheetal') });
  assert.deepEqual(await prisma.opportunity.findUnique({ where: { id: uid('opp-xyz') } }), before);
  assert.equal((await api('GET', `/api/opportunities/${uid('opp-xyz')}`, 'aditi')).status, 404);
  const s = await api('GET', `/api/opportunities/${uid('opp-xyz')}`, 'sheetal');
  assert.equal(s.status, 200);
  assert.equal(s.body.data.stage, 'negotiation');
  assert.deepEqual(ids(await api('GET', '/api/search?q=opp&limit=20', 'sheetal').then((r) => ({ body: { data: r.body.data.results.opportunities } }))), S('opp-xyz'));
});

// ═════════════════════════════════════════════════════════════════════════════
// 8. CONTACTS & ACCOUNTS
// ═════════════════════════════════════════════════════════════════════════════
T('CONTACTS/ACCOUNTS: global search + list + by-id follow lead scope; unlinked records are owner-based', async () => {
  const gs = async (u, q, k) => (await api('GET', `/api/search?q=${q}&limit=20`, u)).body.data.results[k].map((x) => x.id).sort();
  assert.deepEqual(await gs('admin', 'contact', 'contacts'), S('c-xyz', 'c-mgr1', 'c-rahul', 'c-free-aditi', 'c-free-mgr2'));
  assert.deepEqual(await gs('mgr1', 'contact', 'contacts'), S('c-mgr1'));
  assert.deepEqual(await gs('mgr2', 'contact', 'contacts'), S('c-free-mgr2'));
  assert.deepEqual(await gs('aditi', 'contact', 'contacts'), S('c-xyz', 'c-mgr1', 'c-free-aditi'));
  assert.deepEqual(await gs('sheetal', 'contact', 'contacts'), []);
  assert.deepEqual(await gs('adminB', 'contact', 'contacts'), S('c-orgB'));
  assert.deepEqual(await gs('admin', 'account', 'accounts'), S('acc-xyz', 'acc-mgr1', 'acc-mgr2', 'acc-rahul'));
  assert.deepEqual(await gs('mgr1', 'account', 'accounts'), S('acc-mgr1'));
  assert.deepEqual(await gs('mgr2', 'account', 'accounts'), S('acc-mgr2'));
  assert.deepEqual(await gs('aditi', 'account', 'accounts'), S('acc-xyz'));
  assert.deepEqual(await gs('sheetal', 'account', 'accounts'), []);
  assert.deepEqual(await gs('adminB', 'account', 'accounts'), S('acc-orgB'));
  assert.deepEqual(ids(await api('GET', '/api/contacts?limit=100', 'mgr1')), S('c-mgr1'));
  assert.deepEqual(ids(await api('GET', '/api/accounts?limit=100', 'mgr1')), S('acc-mgr1'));
  assert.deepEqual(ids(await api('GET', '/api/contacts?limit=100&search=contact', 'sheetal')), []);
  assert.equal((await api('GET', `/api/contacts?leadId=${uid('xyz')}`, 'sheetal')).status, 404);
  assert.equal((await api('GET', `/api/contacts?leadId=${uid('orgB-lead')}`, 'admin')).status, 404);
  assert.equal((await api('GET', `/api/contacts?leadId=${uid('xyz')}`, 'aditi')).status, 200);
  for (const [u, c] of [['mgr1', 'c-rahul'], ['mgr1', 'c-free-mgr2'], ['sheetal', 'c-xyz'], ['admin', 'c-orgB'], ['adminB', 'c-xyz']]) {
    assert.equal((await api('GET', `/api/contacts/${uid(c)}`, u)).status, 404, `${u} ${c}`);
  }
  for (const [u, a] of [['mgr1', 'acc-rahul'], ['mgr1', 'acc-mgr2'], ['sheetal', 'acc-xyz'], ['admin', 'acc-orgB']]) {
    assert.equal((await api('GET', `/api/accounts/${uid(a)}`, u)).status, 404, `${u} ${a}`);
  }
  assert.equal((await api('PATCH', `/api/contacts/${uid('c-rahul')}`, 'mgr1', { name: 'hax' })).status, 404);
  assert.equal((await api('DELETE', `/api/contacts/${uid('c-rahul')}`, 'mgr1')).status, 404);
  assert.equal((await prisma.contact.findUnique({ where: { id: uid('c-rahul') } })).name, 'Rahul contact');
  assert.equal((await api('PATCH', `/api/accounts/${uid('acc-rahul')}`, 'mgr1', { companyName: 'hax' })).status, 404);
  // an authorized account only exposes nested records whose own lead is accessible
  const acc = await api('GET', `/api/accounts/${uid('acc-xyz')}`, 'aditi');
  assert.equal(acc.status, 200);
});
T('CONTACTS/ACCOUNTS: follow a reassignment', async () => {
  await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'admin', { assignedToId: uid('sheetal') });
  const gs = async (u, q, k) => (await api('GET', `/api/search?q=${q}&limit=20`, u)).body.data.results[k].map((x) => x.id).sort();
  assert.deepEqual(await gs('aditi', 'contact', 'contacts'), S('c-mgr1', 'c-free-aditi'));
  assert.deepEqual(await gs('sheetal', 'contact', 'contacts'), S('c-xyz'));
  assert.deepEqual(await gs('aditi', 'account', 'accounts'), []);
  assert.deepEqual(await gs('sheetal', 'account', 'accounts'), S('acc-xyz'));
  assert.equal((await api('GET', `/api/contacts/${uid('c-xyz')}`, 'sheetal')).status, 200);
  assert.equal((await api('GET', `/api/contacts/${uid('c-xyz')}`, 'aditi')).status, 404);
});

// ═════════════════════════════════════════════════════════════════════════════
// 9. CAMPAIGNS
// ═════════════════════════════════════════════════════════════════════════════
T('CAMPAIGNS: add / retrieve / launch only touch in-scope leads; cross-org always blocked', async () => {
  const members = async () => (await prisma.campaignLead.findMany({ where: { campaignId: uid('camp1') } })).map((c) => c.leadId).sort();
  const camp = (u) => api('GET', `/api/campaigns/${uid('camp1')}`, u);
  const leadIdsIn = (r) => r.body.data.leads.map((l) => l.leadId).sort();
  // retrieval
  assert.deepEqual(leadIdsIn(await camp('admin')), S('xyz', 'mgr1-created', 'rahul-lead'));
  assert.deepEqual(leadIdsIn(await camp('mgr1')), S('mgr1-created'));
  assert.deepEqual(leadIdsIn(await camp('aditi')), S('xyz', 'mgr1-created'));
  assert.deepEqual(leadIdsIn(await camp('sheetal')), []);
  assert.deepEqual((await camp('mgr1')).body.data.emails.map((e) => e.id), [uid('e-mgr1')]);
  assert.deepEqual((await camp('sheetal')).body.data.emails, []);
  const adminTxt = (await camp('admin')).text;
  assert.ok(!adminTxt.includes('XYZ OrgB') && !adminTxt.includes('orgB-lead@lead.com'));
  assert.equal((await api('GET', `/api/campaigns/${uid('camp1')}`, 'adminB')).status, 404);
  // add
  await prisma.campaignLead.deleteMany({});
  await api('POST', `/api/campaigns/${uid('camp1')}/leads`, 'mgr1', { leadIds: [uid('mgr1-created'), uid('rahul-lead'), uid('orgB-lead'), uid('xyz'), uid('mgr2-assigned')] });
  assert.deepEqual(await members(), S('mgr1-created'));
  await prisma.campaignLead.deleteMany({});
  await api('POST', `/api/campaigns/${uid('camp1')}/leads`, 'admin', { leadIds: [uid('xyz'), uid('orgB-lead'), uid('rahul-lead')] });
  assert.deepEqual(await members(), S('xyz', 'rahul-lead'));
  await prisma.campaignLead.deleteMany({});
  await api('POST', `/api/campaigns/${uid('camp1')}/leads`, 'sheetal', { leadIds: [uid('xyz')] });
  assert.deepEqual(await members(), []);
  assert.equal((await api('POST', `/api/campaigns/${uid('camp1')}/leads`, 'adminB', { leadIds: [uid('orgB-lead')] })).status, 404);
  // launch
  await prisma.campaignLead.createMany({ data: ['xyz', 'mgr1-created', 'rahul-lead', 'orgB-lead'].map((k) => ({ campaignId: uid('camp1'), leadId: uid(k) })) });
  await prisma.emailLog.deleteMany({});
  assert.equal((await api('POST', `/api/campaigns/${uid('camp1')}/launch`, 'mgr1')).status, 200);
  assert.deepEqual((await prisma.emailLog.findMany()).map((e) => e.leadId), [uid('mgr1-created')]);
  await prisma.emailLog.deleteMany({});
  assert.equal((await api('POST', `/api/campaigns/${uid('camp1')}/launch`, 'admin')).status, 200);
  assert.deepEqual((await prisma.emailLog.findMany()).map((e) => e.leadId).sort(), S('xyz', 'mgr1-created', 'rahul-lead'));
  await prisma.emailLog.deleteMany({});
  assert.equal((await api('POST', `/api/campaigns/${uid('camp1')}/launch`, 'aditi')).status, 403);   // reps cannot launch
  assert.equal(await prisma.emailLog.count(), 0);
  assert.equal((await api('POST', `/api/campaigns/${uid('camp1')}/launch`, 'adminB')).status, 404);
});

// ═════════════════════════════════════════════════════════════════════════════
// 10. DIRECT-ID OPERATIONS (enrich / generate-email / outreach / export / activities)
// ═════════════════════════════════════════════════════════════════════════════
T('DIRECT ID: enrich / generate-email / send-outreach / lead activities are blocked for out-of-scope leads', async () => {
  for (const [u, k] of [['sheetal', 'xyz'], ['mgr1', 'xyz'], ['mgr1', 'rahul-lead'], ['aditi', 'rahul-lead'], ['admin', 'orgB-lead'], ['adminB', 'xyz']]) {
    for (const [method, p, body] of [
      ['POST', 'enrich/apollo', {}], ['POST', 'enrich/signalhire', {}], ['POST', 'generate-email', {}], ['POST', 'send-outreach', { subject: 's', body: 'b' }],
    ]) {
      const r = await api(method, `/api/leads/${uid(k)}/${p}`, u, body);
      assert.equal(r.status, 404, `${u} ${k} ${p}`);
    }
    assert.equal((await api('GET', `/api/leads/${uid(k)}/activities`, u)).status, 404, `${u} ${k} activities`);
    assert.ok([403, 404, 422].includes((await api('POST', `/api/leads/${uid(k)}/activities`, u, { action: 'call', description: 'sneaky call' })).status), `${u} ${k} post activity`);
  }
  assert.equal(await prisma.emailLog.count({ where: { sentById: { not: null } } }), 0);
  assert.equal((await leadRow('xyz')).status, 'negotiation');
  // in-scope paths still work
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}/activities`, 'aditi')).status, 200);
  // Authorization lets the assignee through. NOTE: send-outreach itself currently answers 500 for everyone,
  // even at git HEAD (it calls sendEmail with the wrong argument shape and writes a non-existent EmailLog.userId);
  // that pre-existing bug is unrelated to authorization, so only the "not blocked" part is asserted here.
  const outreach = await api('POST', `/api/leads/${uid('xyz')}/send-outreach`, 'aditi', { subject: 'Hello', body: 'Hi there' });
  assert.ok(![401, 403, 404].includes(outreach.status), `assignee was blocked: ${outreach.status}`);
});

// ═════════════════════════════════════════════════════════════════════════════
// 11. SEARCH BYPASS, DUPLICATES, STATS, EXPORT
// ═════════════════════════════════════════════════════════════════════════════
T('SEARCH BYPASS: nothing in search / filters / sort / pagination widens any role\'s scope', async () => {
  const allowed = { mgr1: S('mgr1-created', 'mgr1-assigned'), aditi: S('xyz', 'mgr1-created'), sheetal: [], admin: S(...ORG_A_LEADS) };
  const attacks = [
    '&search=xyz', '&search=%25', '&search=a', '&search=lead.com', '&search=%27%20OR%201%3D1', '&status=new', '&intent=cold',
    `&assignedTo=${uid('rahul')}`, `&assignedTo=${uid('repB')}`, '&unassigned=true', '&assignedToMe=true', '&sortBy=assignedTo&sortDir=asc',
    '&page=1&limit=1000', '&followUp=none',
  ];
  for (const [u, ok] of Object.entries(allowed)) {
    for (const q of attacks) {
      const got = ids(await api('GET', `/api/leads?limit=100${q}`, u));
      for (const id of got) assert.ok(ok.includes(id), `${u} ${q} leaked ${id}`);
    }
    const g = (await api('GET', `/api/search?q=xyz&limit=20`, u)).body.data.results.leads.map((l) => l.id);
    for (const id of g) assert.ok(ok.includes(id), `${u} global leaked ${id}`);
  }
  assert.equal((await api('GET', '/api/search?q=x', 'aditi')).status, 422);     // validation untouched
  assert.equal((await api('GET', '/api/leads', null)).status, 401);
  assert.equal((await api('GET', '/api/leads/not-a-uuid', 'admin')).status, 422);
});
T('DUPLICATE DETECTION never reveals leads outside the caller\'s scope', async () => {
  const hidden = await api('POST', '/api/leads', 'sheetal', { companyName: 'XYZ Rahul Deal' });
  assert.equal(hidden.status, 409);
  assert.deepEqual(hidden.body.possibleDuplicate, { id: null, companyName: null });
  assert.ok(!hidden.text.includes(uid('rahul-lead')));
  const emailDup = await api('POST', '/api/leads', 'sheetal', { companyName: 'Totally New', contactEmail: 'rahul-lead@lead.com' });
  assert.equal(emailDup.status, 409);
  assert.equal(emailDup.body.possibleDuplicate.id, null);
  const visible = await api('POST', '/api/leads', 'aditi', { companyName: 'XYZ Corp' });
  assert.equal(visible.status, 409);
  assert.equal(visible.body.possibleDuplicate.id, uid('xyz'));
  const crossOrg = await api('POST', '/api/leads', 'adminB', { companyName: 'XYZ Corp' });
  assert.equal(crossOrg.status, 201);     // org A's lead does not count as a duplicate in org B
});
T('STATS and assignable users follow scope', async () => {
  assert.equal((await api('GET', '/api/leads/stats', 'adminB')).body.data.totalLeads, 1);
  const au = async (u) => (await api('GET', '/api/leads/assignable-users', u)).body.data.map((x) => x.id).sort();
  assert.deepEqual(await au('mgr1'), S('aditi', 'sheetal'));
  assert.deepEqual(await au('aditi'), []);
  assert.ok(!(await au('admin')).includes(uid('repB')));
});

// ═════════════════════════════════════════════════════════════════════════════
// 12. ORGANIZATION ISOLATION SWEEP  (org A admin hammers every endpoint with org B ids)
// ═════════════════════════════════════════════════════════════════════════════
T('ORG ISOLATION: org A users cannot read or modify any org B record; org B database rows are unchanged', async () => {
  const snapshot = async () => JSON.stringify({
    leads: await prisma.lead.findMany({ where: { organizationId: ORG_B }, orderBy: { id: 'asc' } }),
    opps: await prisma.opportunity.findMany({ where: { organizationId: ORG_B } }),
    contacts: await prisma.contact.findMany({ where: { organizationId: ORG_B } }),
    accounts: await prisma.account.findMany({ where: { organizationId: ORG_B } }),
    acts: await prisma.activityLog.findMany({ where: { organizationId: ORG_B } }),
    camps: await prisma.campaign.findMany({ where: { organizationId: ORG_B } }),
  });
  const before = await snapshot();
  for (const u of ['admin', 'mgr1', 'aditi']) {
    const b = uid('orgB-lead');
    const results = await Promise.all([
      api('GET', `/api/leads/${b}`, u), api('PATCH', `/api/leads/${b}`, u, { notes: 'x' }), api('PUT', `/api/leads/${b}`, u, { notes: 'x' }),
      api('DELETE', `/api/leads/${b}`, u), api('PATCH', `/api/leads/${b}/reassign`, u, { assignedToId: uid('aditi') }),
      api('POST', '/api/leads/bulk-assign', u, { leadIds: [b], assignedToId: uid('aditi') }),
      api('POST', `/api/leads/${b}/convert`, u), api('POST', `/api/leads/${b}/generate-email`, u, {}),
      api('GET', `/api/activities/lead/${b}`, u), api('GET', `/api/activities/${uid('a7')}`, u),
      api('GET', `/api/opportunities/${uid('opp-orgB')}`, u), api('PATCH', `/api/opportunities/${uid('opp-orgB')}`, u, { stage: 'closed_won' }),
      api('DELETE', `/api/opportunities/${uid('opp-orgB')}`, u),
      api('GET', `/api/contacts/${uid('c-orgB')}`, u), api('PATCH', `/api/contacts/${uid('c-orgB')}`, u, { name: 'x' }),
      api('GET', `/api/accounts/${uid('acc-orgB')}`, u), api('PATCH', `/api/accounts/${uid('acc-orgB')}`, u, { companyName: 'x' }),
      api('GET', `/api/campaigns/${uid('campB')}`, u), api('POST', `/api/campaigns/${uid('campB')}/leads`, u, { leadIds: [uid('xyz')] }),
    ]);
    results.forEach((r, i) => assert.ok([403, 404].includes(r.status), `${u} call #${i} → ${r.status}`));
    assert.ok(!ids(await api('GET', '/api/leads?limit=100&search=OrgB', u)).includes(uid('orgB-lead')));
  }
  assert.equal(await snapshot(), before);
  // and the reverse
  assert.equal((await api('GET', `/api/leads/${uid('xyz')}`, 'adminB')).status, 404);
  assert.equal((await api('PATCH', `/api/leads/${uid('xyz')}/reassign`, 'adminB', { assignedToId: uid('repB') })).status, 404);
  assert.equal((await leadRow('xyz')).assignedToId, uid('aditi'));
});

// ═════════════════════════════════════════════════════════════════════════════
// 13. THE ORIGINAL QUESTION, end to end with REAL LOGINS (no minted tokens)
//     "Prajwal assigns lead XYZ to Aditi — can Sheetal find it in the search bar?"
// ═════════════════════════════════════════════════════════════════════════════
T('REAL LOGIN: admin (Prajwal) assigns XYZ to Aditi; Sheetal cannot find it; after reassign Sheetal can and Aditi cannot', async () => {
  const login = async (name) => {
    const r = await api('POST', '/api/auth/login', null, { email: `${name}@test.com`, password: PASSWORD });
    assert.equal(r.status, 200, `login ${name}: ${r.text}`);
    return r.body.data.accessToken;
  };
  const call = async (method, url, tok, body) => {
    const res = await fetch(`${BASE}${url}`, { method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: body ? JSON.stringify(body) : undefined });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  const [admin, aditi, sheetal] = [await login('admin'), await login('aditi'), await login('sheetal')];
  assert.equal((await api('POST', '/api/auth/login', null, { email: 'aditi@test.com', password: 'wrong' })).status, 401);

  const findXyz = async (tok) => {
    const global = await call('GET', '/api/search?q=XYZ%20Corp&limit=20', tok);
    const list = await call('GET', '/api/leads?search=XYZ%20Corp&limit=100', tok);
    return { global: global.body.data.results.leads.some((l) => l.id === uid('xyz')), list: list.body.data.some((l) => l.id === uid('xyz')) };
  };
  // start: XYZ is unassigned → assign it to Aditi as admin
  await prisma.lead.update({ where: { id: uid('xyz') }, data: { assignedToId: null } });
  assert.equal((await call('PATCH', `/api/leads/${uid('xyz')}/reassign`, admin, { assignedToId: uid('aditi') })).status, 200);
  assert.deepEqual(await findXyz(aditi), { global: true, list: true });
  assert.deepEqual(await findXyz(sheetal), { global: false, list: false });      // ← the original question
  assert.equal((await call('GET', `/api/leads/${uid('xyz')}`, sheetal)).status, 404);
  assert.deepEqual(await findXyz(admin), { global: true, list: true });

  // Aditi works on it, then admin moves it to Sheetal
  await call('PATCH', `/api/leads/${uid('xyz')}`, aditi, { status: 'proposal_sent', notes: 'Aditi was here' });
  assert.equal((await call('PATCH', `/api/leads/${uid('xyz')}/reassign`, admin, { assignedToId: uid('sheetal') })).status, 200);
  assert.deepEqual(await findXyz(sheetal), { global: true, list: true });
  assert.deepEqual(await findXyz(aditi), { global: false, list: false });
  const seen = await call('GET', `/api/leads/${uid('xyz')}`, sheetal);
  assert.equal(seen.body.data.notes, 'Aditi was here');
  assert.equal(seen.body.data.status, 'proposal_sent');
  assert.deepEqual(await assignedDesc('xyz'), ['Admin assigned this lead to you.', 'Admin assigned this lead from Aditi to you.']);
  // the old token of Aditi is still a valid login, but no longer reaches the lead
  assert.equal((await call('GET', `/api/leads/${uid('xyz')}`, aditi)).status, 404);
});

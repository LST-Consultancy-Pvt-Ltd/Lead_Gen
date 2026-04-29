/**
 * prisma/seed-dropdowns.js
 *
 * One-time script: seeds default dropdown values for every organisation that
 * currently has fewer than 5 dropdown entries (i.e. was created before
 * seedDefaultDropdowns was introduced).
 *
 * Safe to run multiple times — uses skipDuplicates.
 *
 * Usage:  node prisma/seed-dropdowns.js
 */

require('dotenv').config();
const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

const DEFAULT_DROPDOWN_SEEDS = [
  // ── Industry ──────────────────────────────────────────────────────────────
  { category: 'industry', values: [
    'Any Industry', 'Information Technology (IT)', 'Software / SaaS',
    'Banking & Financial Services (BFSI)', 'Healthcare & Pharmaceuticals',
    'Manufacturing & Industrial', 'Retail & E-commerce', 'Education & EdTech',
    'Logistics & Supply Chain', 'Real Estate & Construction', 'Media & Advertising',
    'Telecommunications', 'Energy & Utilities', 'Automotive',
    'Government & Public Sector', 'NGO / Non-profit', 'Hospitality & Travel',
    'Agriculture & Food Processing', 'Legal & Compliance',
    'Consulting & Professional Services',
  ]},
  // ── Company size ─────────────────────────────────────────────────────────
  { category: 'company_size', values: [
    'Any Size', '1-10 (Micro)', '11-50 (Small)', '51-200 (Mid-size)',
    '201-500 (Growing)', '501-1000 (Large)', '1000-5000 (Enterprise)',
    '5000+ (Global Enterprise)',
  ]},
  // ── Company type ─────────────────────────────────────────────────────────
  { category: 'company_type', values: [
    'Any', 'Private Limited', 'Public Listed', 'Startup', 'MNC', 'SME',
    'Government / PSU', 'NGO / Non-profit', 'Partnership Firm', 'LLP',
    'Sole Proprietorship', 'Family Business',
  ]},
  // ── Decision maker ───────────────────────────────────────────────────────
  { category: 'decision_maker', values: [
    'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
    'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
    'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
  ]},
  // ── Contact channel ──────────────────────────────────────────────────────
  { category: 'preferred_contact_channel', values: [
    'Any', 'Email', 'LinkedIn', 'Phone / Call', 'WhatsApp', 'In-person / Visit',
  ]},
  // ── Seniority level ──────────────────────────────────────────────────────
  { category: 'seniority_level', values: [
    'Any', 'C-suite', 'VP / SVP Level', 'Director Level', 'Manager Level',
    'Team Lead', 'Individual Contributor', 'Board / Advisor Level',
  ]},
  // ── Annual revenue range ─────────────────────────────────────────────────
  { category: 'annual_revenue_range', values: [
    'Any', 'Under $1M', '$1M – $5M', '$5M – $10M', '$10M – $25M',
    '$25M – $50M', '$50M – $100M', '$100M – $250M', '$250M – $500M',
    '$500M – $1B', 'Above $1B',
  ]},
  // ── Lead source ──────────────────────────────────────────────────────────
  { category: 'lead_source', values: [
    'Website', 'LinkedIn', 'Referral', 'Cold Email', 'Cold Call',
    'Event / Conference', 'Inbound', 'Partner', 'Social Media', 'Other',
  ]},
  // ── Pipeline stage ────────────────────────────────────────────────────────
  { category: 'pipeline_stage', values: [
    'New', 'Contacted', 'Replied', 'Meeting Booked', 'Qualified',
    'Proposal Sent', 'Negotiation', 'Closed Won', 'Closed Lost',
  ]},
  // ── Loss reason ───────────────────────────────────────────────────────────
  { category: 'loss_reason', values: [
    'Price too high', 'Chose competitor', 'No budget', 'No decision made',
    'Feature mismatch', 'Timing not right', 'Contact left company', 'Other',
  ]},
];

async function seedForOrg(orgId) {
  const rows = [];
  DEFAULT_DROPDOWN_SEEDS.forEach(({ category, values }) => {
    values.forEach((value, index) => {
      rows.push({ organizationId: orgId, category, value, displayOrder: index, isActive: true });
    });
  });
  const result = await prisma.dropdownConfig.createMany({ data: rows, skipDuplicates: true });
  return result.count; // number of NEW rows inserted
}

async function main() {
  console.log('🔍 Finding organisations with missing dropdown data...\n');

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });
  let total = 0;

  for (const org of orgs) {
    const existing = await prisma.dropdownConfig.count({ where: { organizationId: org.id } });
    if (existing < 5) {
      const inserted = await seedForOrg(org.id);
      console.log(`  ✅ "${org.name}" (${org.id}) — inserted ${inserted} new rows`);
      total += inserted;
    } else {
      console.log(`  ⏭️  "${org.name}" — already has ${existing} entries, skipped`);
    }
  }

  console.log(`\n✅ Done! Inserted ${total} total new dropdown rows across ${orgs.length} orgs.`);
}

main()
  .catch(e => { console.error('❌ Error:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());

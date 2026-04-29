/**
 * seed-dropdowns.js
 * One-time backfill script for existing organisations.
 * Checks per-category: only inserts rows for categories that are missing.
 * Safe to run multiple times — uses skipDuplicates.
 *
 * Usage: node prisma/seed-dropdowns.js
 */

const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DEFAULT_DROPDOWN_SEEDS = [
  {
    category: 'lead_status',
    values: [
      'New', 'Contacted', 'Qualified', 'Warm', 'Hot',
      'Proposal Sent', 'Negotiation', 'Won', 'Lost', 'On Hold', 'Unqualified',
    ],
  },
  {
    category: 'lead_source',
    values: [
      'Manual Entry', 'Website Form', 'LinkedIn', 'Cold Email', 'Referral',
      'Lead Generation Tool', 'Advertisement', 'Event / Conference',
      'Inbound Call', 'WhatsApp', 'Partner / Channel', 'Imported / CSV Upload',
    ],
  },
  {
    category: 'job_title',
    values: [
      'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
      'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
      'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
    ],
  },
  {
    category: 'pipeline_stage',
    values: [
      'Lead', 'Qualified', 'Demo', 'Proposal', 'Negotiation', 'Closed Won', 'Closed Lost',
    ],
  },
  {
    category: 'loss_reason',
    values: [
      'Price too high', 'Chose competitor', 'No budget', 'No decision made',
      'Wrong fit', 'Timing not right', 'No response',
    ],
  },
  {
    category: 'industry',
    values: [
      'Any Industry', 'Information Technology (IT)', 'Software / SaaS',
      'Banking & Financial Services (BFSI)', 'Healthcare & Pharmaceuticals',
      'Manufacturing & Industrial', 'Retail & E-commerce', 'Education & EdTech',
      'Logistics & Supply Chain', 'Real Estate & Construction', 'Media & Advertising',
      'Telecommunications', 'Energy & Utilities', 'Automotive',
      'Government & Public Sector', 'NGO / Non-profit', 'Hospitality & Travel',
      'Agriculture & Food Processing', 'Legal & Compliance',
      'Consulting & Professional Services',
    ],
  },
  {
    category: 'company_size',
    values: [
      'Any Size', '1-10 (Micro)', '11-50 (Small)', '51-200 (Mid-size)',
      '201-500 (Growing)', '501-1000 (Large)', '1000-5000 (Enterprise)',
      '5000+ (Global Enterprise)',
    ],
  },
  {
    category: 'company_type',
    values: [
      'Any', 'Private Limited', 'Public Listed', 'Startup', 'MNC', 'SME',
      'Government / PSU', 'NGO / Non-profit', 'Partnership Firm', 'LLP',
      'Sole Proprietorship', 'Family Business',
    ],
  },
  {
    category: 'decision_maker',
    values: [
      'CEO / Founder', 'CTO / CIO', 'CFO', 'CMO', 'COO', 'MD / Director',
      'VP Sales', 'VP Operations', 'Head of HR', 'Talent Acquisition Manager',
      'Procurement Head', 'Operations Manager', 'Department Head', 'Board Member',
    ],
  },
  {
    category: 'preferred_contact_channel',
    values: [
      'Any', 'Email', 'LinkedIn', 'Phone / Call', 'WhatsApp', 'In-person / Visit',
    ],
  },
  {
    category: 'seniority_level',
    values: [
      'Any', 'C-suite', 'VP / SVP Level', 'Director Level', 'Manager Level',
      'Team Lead', 'Individual Contributor', 'Board / Advisor Level',
    ],
  },
  {
    category: 'annual_revenue_range',
    values: [
      'Any', 'Under $1M', '$1M – $5M', '$5M – $10M', '$10M – $25M',
      '$25M – $50M', '$50M – $100M', '$100M – $250M', '$250M – $500M',
      '$500M – $1B', 'Above $1B',
    ],
  },
];

async function main() {
  console.log('🔍 Seeding missing dropdown categories for all organisations...\n');

  const orgs = await prisma.organization.findMany({ select: { id: true, name: true } });

  let totalInserted = 0;

  for (const org of orgs) {
    const missingCategories = [];

    for (const seed of DEFAULT_DROPDOWN_SEEDS) {
      const count = await prisma.dropdownConfig.count({
        where: { organizationId: org.id, category: seed.category },
      });
      if (count === 0) {
        missingCategories.push(seed);
      }
    }

    if (missingCategories.length === 0) {
      console.log(`  ⏭  "${org.name}" — all categories already present, skipping`);
      continue;
    }

    const rows = [];
    for (const seed of missingCategories) {
      seed.values.forEach((value, index) => {
        rows.push({
          organizationId: org.id,
          category: seed.category,
          value,
          displayOrder: index,
          isActive: true,
        });
      });
    }

    await prisma.dropdownConfig.createMany({ data: rows, skipDuplicates: true });

    const categoryNames = missingCategories.map((s) => s.category).join(', ');
    console.log(`  ✅ "${org.name}" — inserted ${rows.length} rows for ${categoryNames}`);
    totalInserted += rows.length;
  }

  console.log(`\n✅ Done! Inserted ${totalInserted} total new rows across ${orgs.length} orgs.`);
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

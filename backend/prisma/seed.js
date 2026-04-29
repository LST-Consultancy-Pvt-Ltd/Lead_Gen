const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create demo organization
  const org = await prisma.organization.upsert({
    where: { slug: 'demo-org' },
    update: {},
    create: {
      name: 'Demo Company',
      slug: 'demo-org',
      website: 'democompany.io',
      industry: 'Technology',
    },
  });

  // Create admin user
  const passwordHash = await bcrypt.hash('password123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@demo.com' },
    update: {},
    create: {
      name: 'LST Consultancy',
      email: 'admin@demo.com',
      passwordHash,
      role: 'org_admin',
      organizationId: org.id,
    },
  });

  // Create services
  await prisma.service.deleteMany({ where: { organizationId: org.id } });
  await prisma.service.createMany({
    data: [
      { organizationId: org.id, name: 'NetSuite Consulting', keywords: ['netsuite', 'erp', 'oracle'] },
      { organizationId: org.id, name: 'ERP Integration', keywords: ['erp', 'integration', 'api'] },
      { organizationId: org.id, name: 'NetSuite Automation', keywords: ['netsuite', 'automation', 'workflow'] },
    ],
  });

  // Create demo leads
  const leads = [
    { companyName: 'FintechFlow Inc.', website: 'fintechflow.io', industry: 'FinTech SaaS', companySize: '150', location: 'San Francisco, CA', contactName: 'Sarah Chen', contactTitle: 'VP Finance', contactEmail: 'sarah@fintechflow.io', techStack: ['NetSuite','Salesforce','Stripe'], intentSignals: [{ type:'hiring', text:'Hiring NetSuite Consultant' },{ type:'funding', text:'Series B $42M raised' }], leadScore: 94, intentScore: 91, intentLevel: 'hot', opportunity: 'NetSuite-Salesforce Integration', source: 'LinkedIn' },
    { companyName: 'ShopMatrix', website: 'shopmatrix.com', industry: 'E-Commerce', companySize: '80', location: 'Austin, TX', contactName: 'Mike Torres', contactTitle: 'CTO', contactEmail: 'mike@shopmatrix.com', techStack: ['Shopify','NetSuite','HubSpot'], intentSignals: [{ type:'hiring', text:'Job: NetSuite Admin' },{ type:'tech', text:'Shopify Plus migration' }], leadScore: 88, intentScore: 85, intentLevel: 'hot', opportunity: 'ERP-Commerce Automation', source: 'Job Boards' },
    { companyName: 'MedLogix', website: 'medlogix.health', industry: 'HealthTech', companySize: '320', location: 'Boston, MA', contactName: 'Dr. Amy Park', contactTitle: 'CIO', contactEmail: 'amy@medlogix.health', techStack: ['SAP','Salesforce','Stripe'], intentSignals: [{ type:'hiring', text:'Hiring ERP Specialist' }], leadScore: 76, intentScore: 72, intentLevel: 'warm', opportunity: 'ERP Migration Consulting', source: 'Crunchbase' },
    { companyName: 'CloudNine Ops', website: 'cloudnineops.io', industry: 'Cloud SaaS', companySize: '55', location: 'Remote / NYC', contactName: 'James Liu', contactTitle: 'Head of IT', contactEmail: 'james@cloudnineops.io', techStack: ['NetSuite','Slack','Stripe'], intentSignals: [{ type:'social', text:'Reddit post: struggling with NetSuite' }], leadScore: 82, intentScore: 80, intentLevel: 'hot', opportunity: 'NetSuite Automation', source: 'Reddit' },
    { companyName: 'RetailEdge', website: 'retailedge.co', industry: 'Retail Tech', companySize: '200', location: 'Chicago, IL', contactName: 'Linda Marsh', contactTitle: 'COO', techStack: ['Shopify','SAP','HubSpot'], intentSignals: [{ type:'content', text:'Tech article: scaling ops' }], leadScore: 61, intentScore: 58, intentLevel: 'warm', opportunity: 'ERP-Retail Integration', source: 'News' },
    { companyName: 'DataVault AI', website: 'datavault.ai', industry: 'AI / Data', companySize: '40', location: 'Seattle, WA', contactName: 'Ben Nakamura', contactTitle: 'CTO', contactEmail: 'ben@datavault.ai', techStack: ['NetSuite','AWS','Stripe'], intentSignals: [{ type:'developer', text:'GitHub: NetSuite API issues' },{ type:'funding', text:'Seed round: $8M' }], leadScore: 70, intentScore: 67, intentLevel: 'warm', opportunity: 'Custom API Integration', source: 'GitHub' },
  ];

  for (const lead of leads) {
    await prisma.lead.upsert({
      where: { id: (await prisma.lead.findFirst({ where: { organizationId: org.id, companyName: lead.companyName } }))?.id ?? 'new' },
      update: {},
      create: { ...lead, organizationId: org.id },
    });
  }

  // Demo intent signals
  const signals = [
    { companyName: 'FintechFlow Inc.', signalType: 'hiring', signalText: 'Posted "NetSuite Consultant" job on LinkedIn', confidence: 91 },
    { companyName: 'ShopMatrix', signalType: 'tech', signalText: 'Announced Shopify Plus to enterprise migration', confidence: 85 },
    { companyName: 'BuildFast Corp', signalType: 'social', signalText: 'Reddit post: "Our NetSuite is a mess, need help"', confidence: 78 },
    { companyName: 'NovaPay', signalType: 'funding', signalText: 'Series B $38M announced — scaling finance team', confidence: 88 },
    { companyName: 'TechStack.io', signalType: 'content', signalText: 'Blog post: challenges with ERP integrations', confidence: 72 },
  ];

  await prisma.intentSignal.createMany({ data: signals, skipDuplicates: true });

  // Demo campaign
  await prisma.campaign.upsert({
    where: { id: 'demo-campaign-1' },
    update: {},
    create: {
      id: 'demo-campaign-1',
      organizationId: org.id,
      name: 'NetSuite Integration Outreach',
      status: 'active',
      sentCount: 142,
      openCount: 89,
      replyCount: 23,
      meetingCount: 7,
    },
  });

  // ─── Seed new discovery dropdown categories ───────────────────────────────
  const discoveryDropdowns = [
    // industry / vertical
    { category: 'industry', value: 'Any Industry',                               displayOrder: 0 },
    { category: 'industry', value: 'Information Technology (IT)',                 displayOrder: 1 },
    { category: 'industry', value: 'Software / SaaS',                            displayOrder: 2 },
    { category: 'industry', value: 'Banking & Financial Services (BFSI)',         displayOrder: 3 },
    { category: 'industry', value: 'Healthcare & Pharmaceuticals',               displayOrder: 4 },
    { category: 'industry', value: 'Manufacturing & Industrial',                 displayOrder: 5 },
    { category: 'industry', value: 'Retail & E-commerce',                        displayOrder: 6 },
    { category: 'industry', value: 'Education & EdTech',                         displayOrder: 7 },
    { category: 'industry', value: 'Logistics & Supply Chain',                   displayOrder: 8 },
    { category: 'industry', value: 'Real Estate & Construction',                 displayOrder: 9 },
    { category: 'industry', value: 'Media & Advertising',                        displayOrder: 10 },
    { category: 'industry', value: 'Telecommunications',                         displayOrder: 11 },
    { category: 'industry', value: 'Energy & Utilities',                         displayOrder: 12 },
    { category: 'industry', value: 'Automotive',                                 displayOrder: 13 },
    { category: 'industry', value: 'Government & Public Sector',                 displayOrder: 14 },
    { category: 'industry', value: 'NGO / Non-profit',                           displayOrder: 15 },
    { category: 'industry', value: 'Hospitality & Travel',                       displayOrder: 16 },
    { category: 'industry', value: 'Agriculture & Food Processing',              displayOrder: 17 },
    { category: 'industry', value: 'Legal & Compliance',                         displayOrder: 18 },
    { category: 'industry', value: 'Consulting & Professional Services',         displayOrder: 19 },

    // company_size
    { category: 'company_size', value: 'Any Size',                  displayOrder: 0 },
    { category: 'company_size', value: '1–10 (Micro)',               displayOrder: 1 },
    { category: 'company_size', value: '11–50 (Small)',              displayOrder: 2 },
    { category: 'company_size', value: '51–200 (Mid-size)',          displayOrder: 3 },
    { category: 'company_size', value: '201–500 (Growing)',          displayOrder: 4 },
    { category: 'company_size', value: '501–1000 (Large)',           displayOrder: 5 },
    { category: 'company_size', value: '1000–5000 (Enterprise)',     displayOrder: 6 },
    { category: 'company_size', value: '5000+ (Global Enterprise)',  displayOrder: 7 },

    // company_type
    { category: 'company_type', value: 'Any',                   displayOrder: 0 },
    { category: 'company_type', value: 'Private Limited',        displayOrder: 1 },
    { category: 'company_type', value: 'Public Listed',          displayOrder: 2 },
    { category: 'company_type', value: 'Startup',                displayOrder: 3 },
    { category: 'company_type', value: 'MNC',                    displayOrder: 4 },
    { category: 'company_type', value: 'SME',                    displayOrder: 5 },
    { category: 'company_type', value: 'Government / PSU',       displayOrder: 6 },
    { category: 'company_type', value: 'NGO / Non-profit',       displayOrder: 7 },
    { category: 'company_type', value: 'Partnership Firm',       displayOrder: 8 },
    { category: 'company_type', value: 'LLP',                    displayOrder: 9 },
    { category: 'company_type', value: 'Sole Proprietorship',    displayOrder: 10 },
    { category: 'company_type', value: 'Family Business',        displayOrder: 11 },

    // decision_maker (chip select — multi)
    { category: 'decision_maker', value: 'CEO / Founder',                displayOrder: 0 },
    { category: 'decision_maker', value: 'CTO / CIO',                    displayOrder: 1 },
    { category: 'decision_maker', value: 'CFO',                          displayOrder: 2 },
    { category: 'decision_maker', value: 'CMO',                          displayOrder: 3 },
    { category: 'decision_maker', value: 'COO',                          displayOrder: 4 },
    { category: 'decision_maker', value: 'MD / Director',                displayOrder: 5 },
    { category: 'decision_maker', value: 'VP Sales',                     displayOrder: 6 },
    { category: 'decision_maker', value: 'VP Operations',                displayOrder: 7 },
    { category: 'decision_maker', value: 'Head of HR',                   displayOrder: 8 },
    { category: 'decision_maker', value: 'Talent Acquisition Manager',   displayOrder: 9 },
    { category: 'decision_maker', value: 'Procurement Head',             displayOrder: 10 },
    { category: 'decision_maker', value: 'Operations Manager',           displayOrder: 11 },
    { category: 'decision_maker', value: 'Department Head',              displayOrder: 12 },
    { category: 'decision_maker', value: 'Board Member',                 displayOrder: 13 },

    // preferred_contact_channel
    { category: 'preferred_contact_channel', value: 'Any',               displayOrder: 0 },
    { category: 'preferred_contact_channel', value: 'Email',             displayOrder: 1 },
    { category: 'preferred_contact_channel', value: 'LinkedIn',          displayOrder: 2 },
    { category: 'preferred_contact_channel', value: 'Phone / Call',      displayOrder: 3 },
    { category: 'preferred_contact_channel', value: 'WhatsApp',          displayOrder: 4 },
    { category: 'preferred_contact_channel', value: 'In-person / Visit', displayOrder: 5 },

    // seniority_level
    { category: 'seniority_level', value: 'Any',                    displayOrder: 0 },
    { category: 'seniority_level', value: 'C-suite',                displayOrder: 1 },
    { category: 'seniority_level', value: 'VP / SVP Level',         displayOrder: 2 },
    { category: 'seniority_level', value: 'Director Level',         displayOrder: 3 },
    { category: 'seniority_level', value: 'Manager Level',          displayOrder: 4 },
    { category: 'seniority_level', value: 'Team Lead',              displayOrder: 5 },
    { category: 'seniority_level', value: 'Individual Contributor', displayOrder: 6 },
    { category: 'seniority_level', value: 'Board / Advisor Level',  displayOrder: 7 },

    // annual_revenue_range (single dropdown)
    { category: 'annual_revenue_range', value: 'Any',           displayOrder: 0 },
    { category: 'annual_revenue_range', value: 'Under $1M',     displayOrder: 1 },
    { category: 'annual_revenue_range', value: '$1M – $5M',     displayOrder: 2 },
    { category: 'annual_revenue_range', value: '$5M – $10M',    displayOrder: 3 },
    { category: 'annual_revenue_range', value: '$10M – $25M',   displayOrder: 4 },
    { category: 'annual_revenue_range', value: '$25M – $50M',   displayOrder: 5 },
    { category: 'annual_revenue_range', value: '$50M – $100M',  displayOrder: 6 },
    { category: 'annual_revenue_range', value: '$100M – $250M', displayOrder: 7 },
    { category: 'annual_revenue_range', value: '$250M – $500M', displayOrder: 8 },
    { category: 'annual_revenue_range', value: '$500M – $1B',   displayOrder: 9 },
    { category: 'annual_revenue_range', value: 'Above $1B',     displayOrder: 10 },
  ];

  for (const item of discoveryDropdowns) {
    await prisma.dropdownConfig.upsert({
      where: {
        organizationId_category_value: {
          organizationId: org.id,
          category: item.category,
          value: item.value,
        },
      },
      update: { displayOrder: item.displayOrder },
      create: {
        organizationId: org.id,
        category: item.category,
        value: item.value,
        displayOrder: item.displayOrder,
        isActive: true,
      },
    });
  }

  console.log('✅ Seed complete!');
  console.log(`📧 Login: admin@demo.com / password123`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

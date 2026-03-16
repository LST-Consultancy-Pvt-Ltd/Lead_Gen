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
      name: 'Alex Rodriguez',
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

  console.log('✅ Seed complete!');
  console.log(`📧 Login: admin@demo.com / password123`);
}

main().catch(console.error).finally(() => prisma.$disconnect());

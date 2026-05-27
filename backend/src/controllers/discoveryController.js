/**
 * discoveryController.js
 *
 * Generic buyer discovery flow for both services and products.
 * Both tabs now normalize into the same AI-driven discovery engine:
 *   offer details -> buyer profile -> search routing -> scoring -> save leads
 */

const prisma = require('../utils/prisma');
const { success, error } = require('../utils/response');
const { runProductDiscoveryScan, generateProductPrompt } = require('../services/productDiscoveryService');
const { runBackgroundEnrichment, runApolloEnrichmentBackground } = require('../services/leadEnrichmentPipeline');
const { analyzeLeadIntent, parseUserPrompt } = require('../services/aiService');
const logger = require('../utils/logger');
const { checkLeadQuota, incrementLeadUsage } = require('../utils/leadQuota');

function cleanValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function joinOfferSections(sections = []) {
  return sections.filter(Boolean).join('\n\n').trim();
}

function buildServiceOfferInput(payload = {}) {
  const offerName = cleanValue(payload.serviceName)
    || cleanValue(payload.positionTitle)
    || cleanValue(payload.offerName);
  const details = cleanValue(payload.offerDetails)
    || cleanValue(payload.description)
    || cleanValue(payload.valueProp);
  const buyerHints = cleanValue(payload.buyerHint)
    || cleanValue(payload.skillsRequired)
    || cleanValue(payload.keywords);
  const exclusions = cleanValue(payload.excludeList);

  return {
    type: 'service',
    productName: offerName || undefined,
    description: joinOfferSections([
      details ? `Offer details:\n${details}` : '',
      buyerHints ? `Buyer hints / use cases:\n${buyerHints}` : '',
      exclusions ? `Exclude these leads:\n${exclusions}` : '',
    ]) || undefined,
    customPrompt: cleanValue(payload.customPrompt) || undefined,
    content: joinOfferSections([
      offerName ? `Offer name: ${offerName}` : '',
      details ? `Service details:\n${details}` : '',
      buyerHints ? `Ideal buyers / signals:\n${buyerHints}` : '',
      exclusions ? `Exclusions:\n${exclusions}` : '',
    ]),
  };
}

function buildProductOfferInput(payload = {}) {
  const productName = cleanValue(payload.productName);
  const details = cleanValue(payload.valueProposition) || cleanValue(payload.productDescription);
  const buyerHints = cleanValue(payload.buyerHint);
  const docText = cleanValue(payload.productDocumentText);
  const productUrl = cleanValue(payload.productUrl);

  return {
    type: payload.productType || (productUrl ? 'url' : docText ? 'document' : 'description'),
    url: productUrl || undefined,
    description: joinOfferSections([
      details ? `Offer details:\n${details}` : '',
      buyerHints ? `Buyer hints / use cases:\n${buyerHints}` : '',
    ]) || undefined,
    docText: docText || undefined,
    customPrompt: cleanValue(payload.customPrompt) || undefined,
    productName: productName || undefined,
    content: joinOfferSections([
      productName ? `Offer name: ${productName}` : '',
      details ? `Offer details:\n${details}` : '',
      docText ? docText.slice(0, 2000) : '',
    ]) || productUrl || '',
  };
}

function buildDiscoveryFilters(payload = {}) {
  return {
    workTypes: Array.isArray(payload.workTypes) ? payload.workTypes : [],
    sources: Array.isArray(payload.sources) ? payload.sources : [],
    targetIndustry: cleanValue(payload.targetIndustry),
    targetRegion: cleanValue(payload.geography) || cleanValue(payload.targetRegion),
    companySize: cleanValue(payload.companySize),
    companyType: cleanValue(payload.companyType),
    revenueRanges: Array.isArray(payload.revenueRanges) ? payload.revenueRanges : [],
    annualRevenue: cleanValue(payload.annualRevenue) || cleanValue(payload.annualRevenueRange),
    serviceName: cleanValue(payload.serviceName),
    pricingModel: cleanValue(payload.pricingModel),
    valueProp: cleanValue(payload.valueProp),
    keywords: cleanValue(payload.keywords),
    contactChannel: cleanValue(payload.preferredContactChannel) || cleanValue(payload.contactChannel),
    preferredContactChannel: cleanValue(payload.preferredContactChannel) || cleanValue(payload.contactChannel),
    seniorityLevel: cleanValue(payload.seniorityLevel),
    decisionMakers: Array.isArray(payload.decisionMakers)
      ? payload.decisionMakers
      : Array.isArray(payload.decisionMakerRoles) ? payload.decisionMakerRoles : [],
    excludeList: cleanValue(payload.excludeList),
  };
}

function buildServiceScanSources(payload, filters, offerInput, leadCount, scoreThreshold) {
  return {
    workTypes: filters.workTypes,
    sources: filters.sources,
    scanType: 'service',
    decisionMakerRoles: filters.decisionMakers,
    companySize: filters.companySize,
    companyType: filters.companyType,
    revenueRanges: filters.revenueRanges,
    annualRevenue: filters.annualRevenue,
    serviceName: offerInput.productName || null,
    pricingModel: filters.pricingModel,
    valueProp: cleanValue(payload.offerDetails) || filters.valueProp || null,
    keywords: cleanValue(payload.buyerHint) || filters.keywords || null,
    contactChannel: filters.contactChannel,
    preferredContactChannel: filters.preferredContactChannel,
    seniorityLevel: filters.seniorityLevel,
    leadCount,
    numberOfLeads: leadCount,
    scoreThreshold,
    excludeList: filters.excludeList,
    offerName: offerInput.productName || null,
    offerDetails: cleanValue(payload.offerDetails) || cleanValue(payload.description) || null,
    buyerHint: cleanValue(payload.buyerHint) || cleanValue(payload.skillsRequired) || null,
    customPrompt: offerInput.customPrompt || null,
    positionTitle: cleanValue(payload.positionTitle),
    description: cleanValue(payload.description),
    skillsRequired: cleanValue(payload.skillsRequired),
  };
}

function buildProductScanSources(payload, filters, productInput, leadCount) {
  return {
    workTypes: filters.workTypes,
    sources: filters.sources,
    scanType: 'product',
    productType: productInput.type,
    productUrl: productInput.url || null,
    productDescriptionSnippet: (productInput.description || productInput.docText || '').slice(0, 200),
    productName: productInput.productName || null,
    valueProposition: cleanValue(payload.valueProposition) || cleanValue(payload.productDescription) || null,
    buyerHint: cleanValue(payload.buyerHint) || null,
    companySize: filters.companySize,
    companyType: filters.companyType,
    decisionMakers: filters.decisionMakers,
    preferredContactChannel: filters.preferredContactChannel,
    seniorityLevel: filters.seniorityLevel,
    numberOfLeads: leadCount,
    annualRevenue: filters.annualRevenue,
  };
}

function buildPromptResponse(result, fallbackName = '') {
  return {
    promptText: result.promptText,
    offerName: result.productName || fallbackName,
    productName: result.productName || fallbackName,
    buyerType: result.buyerType,
    summary: result.summary,
    searchStrategy: result.searchStrategy,
    isPhysicalProduct: result.isPhysicalProduct,
    suggestedEdits: Array.isArray(result.suggestedEdits) ? result.suggestedEdits : [],
    strategy: {
      buyerIndustries: Array.isArray(result.buyerIndustries) ? result.buyerIndustries : [],
      buyerPersonas:   Array.isArray(result.buyerPersonas)   ? result.buyerPersonas   : [],
      demandSignals:   Array.isArray(result.demandSignals)   ? result.demandSignals   : [],
      searchPlan:      Array.isArray(result.searchPlan)      ? result.searchPlan      : [],
      exclusions:      Array.isArray(result.exclusions)      ? result.exclusions      : [],
      expectedQuality: result.expectedQuality || '',
    },
  };
}

async function startScan(req, res) {
  try {
    const filters = buildDiscoveryFilters(req.body);
    const offerInput = buildServiceOfferInput(req.body);
    const effectiveLeadCount = Number(req.body.numberOfLeads) || Number(req.body.leadCount) || 50;
    const scoreThreshold = cleanValue(req.body.scoreThreshold);

    if (!offerInput.productName && !offerInput.description && !offerInput.content) {
      return error(res, 'Provide at least a service name or service details to start discovery.', 422);
    }

    const job = await prisma.scanJob.create({
      data: {
        organizationId: req.user.organizationId,
        status: 'running',
        services: [offerInput.productName || 'Service Discovery'],
        targetIndustry: filters.targetIndustry,
        targetRegion: filters.targetRegion,
        sources: buildServiceScanSources(req.body, filters, offerInput, effectiveLeadCount, scoreThreshold),
        startedAt: new Date(),
      },
    });

    processScan(
      job.id,
      req.user.organizationId,
      offerInput,
      filters,
      filters.decisionMakers,
      effectiveLeadCount,
      scoreThreshold,
    ).catch(err =>
      logger.error('Service scan failed', { jobId: job.id, err: err.message })
    );

    return success(res, { id: job.id, jobId: job.id, status: 'running' }, 'Scan started', 202);
  } catch (err) {
    logger.error('startScan error', { err: err.message });
    return error(res, 'Failed to start scan', 500);
  }
}

async function startProductScan(req, res) {
  try {
    const filters = buildDiscoveryFilters(req.body);
    const productInput = buildProductOfferInput(req.body);
    const effectiveLeadCount = Number(req.body.numberOfLeads) || 50;

    if (!productInput.url && !productInput.description && !productInput.docText && !productInput.productName) {
      return error(res, 'Provide at least one: product name, offer details, product URL, or product document text.', 422);
    }

    const job = await prisma.scanJob.create({
      data: {
        organizationId: req.user.organizationId,
        status: 'running',
        services: [],
        targetIndustry: filters.targetIndustry,
        targetRegion: filters.targetRegion,
        sources: buildProductScanSources(req.body, filters, productInput, effectiveLeadCount),
        startedAt: new Date(),
      },
    });

    processProductScan(
      job.id,
      req.user.organizationId,
      productInput,
      filters,
      effectiveLeadCount,
    ).catch(err =>
      logger.error('Product scan failed', { jobId: job.id, err: err.message })
    );

    return success(res, { id: job.id, jobId: job.id, status: 'running' }, 'Product scan started', 202);
  } catch (err) {
    logger.error('startProductScan error', { err: err.message });
    return error(res, 'Failed to start product scan', 500);
  }
}

async function saveDiscoveredLead(organizationId, dl, services) {
  const quota = await checkLeadQuota(organizationId);
  if (!quota.allowed) {
    logger.info('Lead quota exhausted - skipping discovered lead', {
      company: dl.companyName, orgId: organizationId, quota: quota.quota, used: quota.used,
    });
    return null;
  }

  const jobTitle = dl.jobPostings?.[0]?.title || '';
  const existing = await prisma.lead.findFirst({
    where: {
      organizationId,
      OR: [
        { companyName: { equals: dl.companyName, mode: 'insensitive' } },
        ...(dl.website ? [{ website: { equals: dl.website, mode: 'insensitive' } }] : []),
      ],
    },
  });

  if (existing && jobTitle) {
    const allCompanyLeads = await prisma.lead.findMany({
      where: {
        organizationId,
        OR: [
          { companyName: { equals: dl.companyName, mode: 'insensitive' } },
          ...(dl.website ? [{ website: { equals: dl.website, mode: 'insensitive' } }] : []),
        ],
      },
      select: { id: true, jobPostings: true },
    });
    const titleLower = jobTitle.toLowerCase();
    const hasSameJob = allCompanyLeads.some(lead =>
      Array.isArray(lead.jobPostings) && lead.jobPostings.some(
        jp => (jp.title || '').toLowerCase() === titleLower
      )
    );
    if (hasSameJob) {
      logger.debug('Lead skipped (exact same job exists)', {
        company: dl.companyName, jobTitle, source: dl.source,
      });
      return null;
    }
  } else if (existing && !jobTitle) {
    logger.debug('Lead skipped (duplicate, no job title)', { company: dl.companyName, source: dl.source });
    return null;
  }

  const analysis = await analyzeLeadIntent(dl, services);

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      companyName: dl.companyName,
      website: dl.website || null,
      industry: dl.industry || null,
      location: dl.location || null,
      companySize: dl.companySize || null,
      description: dl.description || null,
      techStack: dl.techStack || [],
      linkedinUrl: dl.companyLinkedinUrl || dl.linkedinUrl || null,
      contactName: dl.contactName || null,
      contactTitle: dl.contactTitle || null,
      contactLinkedin: dl.contactLinkedin || null,
      jobPostings: dl.jobPostings || [],
      intentSignals: [{
        type: dl.signalType || 'general',
        text: dl.signalText || '',
        confidence: dl.confidence || 50,
      }],
      leadScore: analysis.leadScore,
      intentScore: analysis.intentScore,
      intentLevel: analysis.intentLevel,
      matchScore: analysis.matchScore ?? null,
      opportunity: analysis.opportunity,
      aiSummary: analysis.aiSummary,
      aiPitch: analysis.aiPitch,
      source: dl.source,
      sourceUrl: dl.sourceUrl,
      subSource: dl.subSource || null,
      leadType: dl.leadType || null,
    },
  });

  await prisma.intentSignal.create({
    data: {
      companyName: dl.companyName,
      website: dl.website,
      signalType: dl.signalType || 'general',
      signalText: dl.signalText || '',
      confidence: dl.confidence || 50,
      sourceUrl: dl.sourceUrl,
      source: dl.source,
      processed: true,
    },
  }).catch(() => {});

  runBackgroundEnrichment(lead, prisma).catch(err =>
    logger.error('runBackgroundEnrichment failed', { leadId: lead.id, err: err.message })
  );

  await incrementLeadUsage(organizationId);

  logger.info('Lead saved to DB', {
    leadId: lead.id,
    company: dl.companyName,
    source: dl.source,
    signalType: dl.signalType || 'general',
    score: analysis.leadScore,
    intent: analysis.intentLevel,
  });

  return lead.id;
}

async function processOfferScan(jobId, orgId, offerInput, filters = {}, options = {}) {
  const {
    maxLeads = 50,
    leadType = 'product',
    decisionMakerRoles = [],
    scoreThreshold = '',
    shouldApolloEnrich = false,
  } = options;

  try {
    const savedIds = [];
    const minScore = scoreThreshold === 'hot' ? 80 : scoreThreshold === 'warm' ? 60 : 0;

    const { leads: discovered, profile } = await runProductDiscoveryScan(
      { id: jobId },
      offerInput,
      filters,
      async (progress, count) => {
        await prisma.scanJob.update({
          where: { id: jobId },
          data: { progress, leadsFound: count },
        });
      },
      maxLeads,
    );

    const keywords = [
      profile?.productSummary,
      profile?.productName,
      offerInput.productName,
    ].filter(Boolean);

    for (const dl of discovered) {
      try {
        if (savedIds.length >= maxLeads) break;

        dl.subSource = leadType;
        dl.leadType = leadType;

        const id = await saveDiscoveredLead(orgId, dl, keywords);
        if (!id) continue;

        if (minScore > 0) {
          const saved = await prisma.lead.findUnique({
            where: { id },
            select: { leadScore: true },
          }).catch(() => null);
          if (saved && (saved.leadScore || 0) < minScore) {
            await prisma.lead.delete({ where: { id } }).catch(() => {});
            continue;
          }
        }

        savedIds.push(id);

        if (shouldApolloEnrich) {
          const savedLead = await prisma.lead.findUnique({ where: { id } }).catch(() => null);
          if (savedLead) {
            // Phase 1: when user didn't pick decision-maker roles, fall back to the
            // AI-derived buyerTitles from the profile (not the hardcoded ['CEO','CTO',
            // 'Founder','Managing Director','Director'] defaults). Generic "Director"
            // matched "Recreation Director" via word-boundary, attaching irrelevant
            // contacts. Real buyer titles like "Procurement Manager" disambiguate.
            const profileBuyerTitles = profile?.apolloProfile?.buyerTitles || [];
            const effectiveRoles = (Array.isArray(decisionMakerRoles) && decisionMakerRoles.length)
              ? decisionMakerRoles
              : profileBuyerTitles;
            runApolloEnrichmentBackground(savedLead, prisma, {
              organizationId: orgId,
              roles: effectiveRoles,
              filters,
            }).catch(() => {});
          }
        }
      } catch (err) {
        logger.error('Failed to save discovered lead', { err: err.message, company: dl.companyName });
      }
    }

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status: 'completed',
        progress: 100,
        leadsFound: savedIds.length,
        completedAt: new Date(),
      },
    });

    logger.info('Offer scan completed', { jobId, leadType, leadsFound: savedIds.length });
  } catch (err) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data: { status: 'failed', error: err.message },
    }).catch(() => {});
    throw err;
  }
}

async function processScan(jobId, orgId, offerInput, filters = {}, decisionMakerRoles = [], maxLeads = 100, scoreThreshold = '') {
  return processOfferScan(jobId, orgId, offerInput, filters, {
    maxLeads,
    leadType: 'service',
    decisionMakerRoles,
    scoreThreshold,
    shouldApolloEnrich: true,
  });
}

async function processProductScan(jobId, orgId, productInput, filters = {}, maxLeads = 50) {
  return processOfferScan(jobId, orgId, productInput, filters, {
    maxLeads,
    leadType: 'product',
  });
}

async function getScanStatus(req, res) {
  try {
    const job = await prisma.scanJob.findFirst({
      where: { id: req.params.jobId, organizationId: req.user.organizationId },
    });
    if (!job) return error(res, 'Scan not found', 404);
    return success(res, job);
  } catch (err) {
    return error(res, 'Failed to get scan status', 500);
  }
}

async function getScanHistory(req, res) {
  try {
    const jobs = await prisma.scanJob.findMany({
      where: { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    return success(res, jobs);
  } catch (err) {
    return error(res, 'Failed to fetch scan history', 500);
  }
}

async function getActiveScan(req, res) {
  try {
    const job = await prisma.scanJob.findFirst({
      where: {
        organizationId: req.user.organizationId,
        status: { in: ['running', 'pending'] },
      },
      orderBy: { createdAt: 'desc' },
    });
    return success(res, job ?? null);
  } catch (err) {
    return error(res, 'Failed to fetch active scan', 500);
  }
}

async function getSignals(req, res) {
  try {
    const { limit = 50, type } = req.query;
    const where = {};
    if (type) where.signalType = type;
    const signals = await prisma.intentSignal.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: parseInt(limit, 10),
    });
    return success(res, signals);
  } catch (err) {
    return error(res, 'Failed to fetch signals', 500);
  }
}

async function getServices(req, res) {
  try {
    const services = await prisma.service.findMany({
      where: { organizationId: req.user.organizationId },
    });
    return success(res, services);
  } catch (err) {
    return error(res, 'Failed to fetch services', 500);
  }
}

async function upsertServices(req, res) {
  try {
    const { services } = req.body;
    await prisma.service.deleteMany({ where: { organizationId: req.user.organizationId } });
    const created = await prisma.service.createMany({
      data: services.map(s => ({
        organizationId: req.user.organizationId,
        name: typeof s === 'string' ? s : s.name,
        keywords: typeof s === 'string' ? [s.toLowerCase()] : (s.keywords || [s.name.toLowerCase()]),
        isActive: true,
      })),
    });
    return success(res, { count: created.count }, 'Services updated');
  } catch (err) {
    return error(res, 'Failed to update services', 500);
  }
}

async function generateServiceScanPrompt(req, res) {
  try {
    const filters = buildDiscoveryFilters(req.body);
    const offerInput = buildServiceOfferInput(req.body);

    if (!offerInput.productName && !offerInput.description && !offerInput.content) {
      return error(res, 'Provide at least a service name or service details to generate a prompt.', 422);
    }

    const result = await generateProductPrompt(offerInput, filters);
    return success(
      res,
      buildPromptResponse(result, offerInput.productName || 'Service Discovery'),
      'Prompt generated',
    );
  } catch (err) {
    logger.error('generateServiceScanPrompt error', { err: err.message });
    return error(res, 'Failed to generate prompt', 500);
  }
}

async function generateProductScanPrompt(req, res) {
  try {
    const filters = buildDiscoveryFilters(req.body);
    const productInput = buildProductOfferInput(req.body);

    if (!productInput.url && !productInput.description && !productInput.docText && !productInput.productName) {
      return error(res, 'Provide at least one: product name, offer details, product URL, or product document text.', 422);
    }

    const result = await generateProductPrompt(productInput, filters);
    return success(
      res,
      buildPromptResponse(result, productInput.productName || 'Product Discovery'),
      'Prompt generated',
    );
  } catch (err) {
    logger.error('generateProductScanPrompt error', { err: err.message });
    return error(res, 'Failed to generate prompt', 500);
  }
}

async function smartScan(req, res) {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return error(res, 'prompt is required', 422);
    }

    let parsed;
    try {
      parsed = await parseUserPrompt(prompt.trim());
    } catch (parseErr) {
      logger.error('smartScan: parseUserPrompt failed', { err: parseErr.message });
      return error(res, 'Failed to understand your prompt - please try rephrasing', 422);
    }

    const {
      service = '',
      targetIndustry = '',
      targetRegion = '',
      companySize = '',
      companyType = '',
      valueProp = '',
      keywords = '',
      seniorityLevel = '',
      leadCount = 50,
      decisionMakerRoles = [],
    } = parsed;

    if (!service) {
      return error(res, 'Could not identify a service or position from your prompt', 422);
    }

    const orgId = req.user.organizationId;
    const existing = await prisma.service.findMany({
      where: { organizationId: orgId, isActive: true },
    });
    const alreadyExists = existing.some(s => s.name.toLowerCase() === service.toLowerCase());
    if (!alreadyExists) {
      await prisma.service.create({
        data: { organizationId: orgId, name: service, isActive: true },
      });
    }

    const job = await prisma.scanJob.create({
      data: {
        organizationId: orgId,
        status: 'running',
        services: [service],
        targetIndustry,
        targetRegion,
        sources: {
          scanType: 'service',
          decisionMakerRoles,
          companySize,
          companyType,
          valueProp,
          keywords,
          seniorityLevel,
          leadCount,
          smartPrompt: prompt.trim(),
          offerName: service,
        },
        startedAt: new Date(),
      },
    });

    const offerInput = buildServiceOfferInput({
      serviceName: service,
      offerDetails: valueProp,
      buyerHint: keywords,
    });
    const filters = buildDiscoveryFilters({
      targetIndustry,
      targetRegion,
      companySize,
      companyType,
      seniorityLevel,
      decisionMakers: decisionMakerRoles,
    });

    processScan(
      job.id,
      orgId,
      offerInput,
      filters,
      Array.isArray(decisionMakerRoles) ? decisionMakerRoles : [],
      Number(leadCount) || 50,
      '',
    ).catch(err => logger.error('smartScan processScan failed', { jobId: job.id, err: err.message }));

    return success(
      res,
      { id: job.id, jobId: job.id, status: 'running', parsedParams: parsed },
      'Smart scan started',
      202,
    );
  } catch (err) {
    logger.error('smartScan error', { err: err.message });
    return error(res, 'Failed to start smart scan', 500);
  }
}

async function parsePrompt(req, res) {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return error(res, 'prompt is required', 422);
    }
    const parsed = await parseUserPrompt(prompt.trim());
    return success(res, parsed, 'Parsed successfully');
  } catch (err) {
    logger.error('parsePrompt error', { err: err.message });
    return error(res, 'Failed to parse prompt', 500);
  }
}

module.exports = {
  startScan,
  startProductScan,
  generateServiceScanPrompt,
  generateProductScanPrompt,
  parsePrompt,
  smartScan,
  getScanStatus,
  getScanHistory,
  getActiveScan,
  getSignals,
  getServices,
  upsertServices,
};

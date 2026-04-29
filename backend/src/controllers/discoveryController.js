/**
 * discoveryController.js
 *
 * Handles scan lifecycle:
 *   - startScan         → service/position mode → Google Jobs engine
 *   - startProductScan  → product mode → AI profile + Google Jobs + organic buyer intent + RFP
 *
 * After each lead is saved:
 *   runBackgroundEnrichment runs in background after save
 *   → finds company LinkedIn URL via SerpAPI
 *   → fetches basic company info via Clearbit (free) + SerpAPI Knowledge Graph
 *
 * SignalHire and Apollo are NOT called during scan.
 * They are triggered manually by user from the lead detail page.
 */

const prisma  = require('../utils/prisma');
const { success, error } = require('../utils/response');
const { runDiscoveryScan }        = require('../services/discoveryService');
const { runProductDiscoveryScan, generateProductPrompt } = require('../services/productDiscoveryService');
const { runBackgroundEnrichment, runApolloEnrichmentBackground } = require('../services/leadEnrichmentPipeline');
const { analyzeLeadIntent, parseUserPrompt } = require('../services/aiService');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// POST /discovery/scan  — service / position based
// ─────────────────────────────────────────────────────────────────────────────

async function startScan(req, res) {
  try {
    const {
      targetIndustry     = '',
      targetRegion       = '',
      geography          = '',          // alias for targetRegion (new frontend sends this)
      workTypes          = [],
      sources            = [],
      decisionMakerRoles = [],
      // New mandatory fields (Positions mode)
      positionTitle      = '',
      description        = '',
      skillsRequired     = '',
      // Extended targeting fields
      companySize        = '',
      companyType        = '',
      revenueRanges      = [],
      serviceName        = '',
      pricingModel       = '',
      valueProp          = '',
      keywords           = '',
      contactChannel     = '',
      seniorityLevel     = '',
      leadCount          = 50,          // default changed to 50 per requirement
      numberOfLeads      = 0,           // new name, takes priority over leadCount
      decisionMakers     = [],          // new multi-select chip field
      preferredContactChannel = '',
      scoreThreshold     = '',
      excludeList        = '',
    } = req.body;

    // Resolve final values
    const effectiveRegion    = geography || targetRegion;
    const effectiveLeadCount = Number(numberOfLeads) || Number(leadCount) || 50;
    const effectiveDMRoles   = decisionMakers.length ? decisionMakers : decisionMakerRoles;
    const effectiveChannel   = preferredContactChannel || contactChannel;

    // Determine which services/positions to scan
    let serviceNames;
    if (positionTitle && positionTitle.trim()) {
      // New mode: position title sent directly — no DB services needed
      serviceNames = [positionTitle.trim()];
    } else {
      // Backward compat: fetch from DB services table
      const dbServices = await prisma.service.findMany({
        where: { organizationId: req.user.organizationId, isActive: true },
      });
      if (!dbServices.length) {
        return error(res, 'No services configured. Add at least one service/position first.', 422);
      }
      serviceNames = dbServices.map(s => s.name);
    }

    const job = await prisma.scanJob.create({
      data: {
        organizationId: req.user.organizationId,
        status:    'running',
        services:  serviceNames,
        targetIndustry,
        targetRegion:  effectiveRegion,
        sources: {
          workTypes,
          sources,
          scanType:       'service',
          decisionMakerRoles: effectiveDMRoles,
          companySize,
          companyType,
          revenueRanges,
          serviceName,
          pricingModel,
          valueProp,
          keywords,
          contactChannel:        effectiveChannel,
          seniorityLevel,
          leadCount:             effectiveLeadCount,
          scoreThreshold,
          excludeList,
          // New fields stored in sources JSON
          positionTitle:         positionTitle.trim(),
          description,
          skillsRequired,
          numberOfLeads:         effectiveLeadCount,
        },
        startedAt: new Date(),
      },
    });

    // Fire and forget — scan runs fully in background
    processScan(
      job.id,
      req.user.organizationId,
      serviceNames,
      {
        workTypes, sources, targetIndustry,
        targetRegion:  effectiveRegion,
        companySize, companyType, revenueRanges, serviceName, pricingModel,
        valueProp:     valueProp || skillsRequired,   // pass skillsRequired as valueProp context
        keywords:      keywords  || description,      // pass description as keywords context
        contactChannel: effectiveChannel,
        seniorityLevel,
        excludeList,
      },
      Array.isArray(effectiveDMRoles) ? effectiveDMRoles : [],
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /discovery/scan/product  — product based
// Accepts any combination of URL + description + document
// ─────────────────────────────────────────────────────────────────────────────

async function startProductScan(req, res) {
  try {
    const {
      productType,
      productUrl,
      productDescription,
      productDocumentText,
      customPrompt,          // optional — user-edited prompt from the preview step
      targetIndustry = '',
      targetRegion   = '',
      geography      = '',   // alias for targetRegion
      workTypes      = [],
      sources        = [],
      // New fields (Products mode)
      productName          = '',
      valueProposition     = '',  // replaces/supplements productDescription label
      companySize          = '',
      companyType          = '',
      decisionMakers       = [],
      preferredContactChannel = '',
      seniorityLevel       = '',
      numberOfLeads        = 50,  // non-mandatory, default 50
      annualRevenue        = '',  // single dropdown
    } = req.body;

    const effectiveRegion = geography || targetRegion;
    // valueProposition supplements productDescription — use whichever is provided
    const effectiveDescription = valueProposition?.trim() || productDescription;

    const hasUrl  = !!(productUrl              && productUrl.trim().length > 0);
    const hasDesc = !!(effectiveDescription    && effectiveDescription.trim().length > 5);
    const hasDoc  = !!(productDocumentText     && productDocumentText.trim().length > 5);
    const hasName = !!(productName             && productName.trim().length > 0);

    if (!hasUrl && !hasDesc && !hasDoc && !hasName) {
      return error(res, 'Provide at least one: productName, productUrl, valueProposition/productDescription, or productDocumentText', 422);
    }

    // Build product input — pass ALL provided content to the AI for richest profile
    const productInput = {
      type:         productType || (hasUrl ? 'url' : hasDoc ? 'document' : 'description'),
      url:          hasUrl  ? productUrl.trim()               : undefined,
      description:  hasDesc ? effectiveDescription.trim()     : undefined,
      docText:      hasDoc  ? productDocumentText.trim()       : undefined,
      customPrompt: customPrompt?.trim()                       || undefined,
      productName:  productName.trim()                         || undefined,
      content: [
        productName.trim()                                     || '',
        hasDesc ? effectiveDescription.trim()                  : '',
        hasDoc  ? productDocumentText.trim().slice(0, 2000)    : '',
      ].filter(Boolean).join('\n\n') || productUrl || '',
    };

    const job = await prisma.scanJob.create({
      data: {
        organizationId: req.user.organizationId,
        status:    'running',
        services:  [],
        targetIndustry,
        targetRegion:  effectiveRegion,
        sources: {
          workTypes,
          sources,
          scanType:    'product',
          productType: productInput.type,
          productUrl:  productUrl || null,
          productDescriptionSnippet: (effectiveDescription || productDocumentText || '').slice(0, 200),
          // New fields stored in sources JSON
          productName:             productName.trim() || null,
          valueProposition:        valueProposition?.trim() || null,
          companySize,
          companyType,
          decisionMakers,
          preferredContactChannel,
          seniorityLevel,
          numberOfLeads:           Number(numberOfLeads) || 50,
          annualRevenue,
        },
        startedAt: new Date(),
      },
    });

    processProductScan(
      job.id,
      req.user.organizationId,
      productInput,
      {
        workTypes, sources, targetIndustry,
        targetRegion:  effectiveRegion,
        companySize, companyType, seniorityLevel,
        preferredContactChannel,
        numberOfLeads: Number(numberOfLeads) || 50,
      },
      Number(numberOfLeads) || 50,
    ).catch(err =>
      logger.error('Product scan failed', { jobId: job.id, err: err.message })
    );

    return success(res, { id: job.id, jobId: job.id, status: 'running' }, 'Product scan started', 202);
  } catch (err) {
    logger.error('startProductScan error', { err: err.message });
    return error(res, 'Failed to start product scan', 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Save a discovered lead to DB
// Deduplicates by company name + website
// Fires background company-info enrichment (no paid APIs)
// ─────────────────────────────────────────────────────────────────────────────

async function saveDiscoveredLead(organizationId, dl, services) {
  // Deduplicate: skip only if same company + same job title already exists
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
    // Check if this exact job title already exists on any lead for this company
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
    // Different job from same company — allow creation (fall through)
  } else if (existing && !jobTitle) {
    // Non-job lead (e.g. community intent) — skip if same company already exists
    logger.debug('Lead skipped (duplicate, no job title)', { company: dl.companyName, source: dl.source });
    return null;
  }

  // Score the lead (uses fallback if OpenAI unavailable — never blocks)
  const analysis = await analyzeLeadIntent(dl, services);

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      companyName:     dl.companyName,
      website:         dl.website            || null,
      industry:        dl.industry           || null,
      location:        dl.location           || null,
      companySize:     dl.companySize         || null,
      description:     dl.description        || null,
      techStack:       dl.techStack          || [],
      linkedinUrl:     dl.companyLinkedinUrl  || dl.linkedinUrl || null,
      contactName:     dl.contactName        || null,
      contactTitle:    dl.contactTitle       || null,
      contactLinkedin: dl.contactLinkedin    || null,
      jobPostings:  dl.jobPostings || [],
      intentSignals: [{
        type:       dl.signalType  || 'general',
        text:       dl.signalText  || '',
        confidence: dl.confidence  || 50,
      }],
      leadScore:   analysis.leadScore,
      intentScore: analysis.intentScore,
      intentLevel: analysis.intentLevel,
      matchScore:  analysis.matchScore ?? null,
      opportunity: analysis.opportunity,
      aiSummary:   analysis.aiSummary,
      aiPitch:     analysis.aiPitch,
      source:      dl.source,
      sourceUrl:   dl.sourceUrl,
    },
  });

  // Create intent signal record
  await prisma.intentSignal.create({
    data: {
      companyName: dl.companyName,
      website:     dl.website,
      signalType:  dl.signalType || 'general',
      signalText:  dl.signalText || '',
      confidence:  dl.confidence || 50,
      sourceUrl:   dl.sourceUrl,
      source:      dl.source,
      processed:   true,
    },
  }).catch(() => {}); // non-critical

  // Background: run full enrichment pipeline (domain, industry, LinkedIn, Clearbit, KG)
  runBackgroundEnrichment(lead, prisma).catch(err =>
    logger.error('runBackgroundEnrichment failed', { leadId: lead.id, err: err.message })
  );

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

async function processScan(jobId, orgId, services, filters = {}, decisionMakerRoles = [], maxLeads = 100, scoreThreshold = '') {
  try {
    const savedIds = [];
    const minScore = scoreThreshold === 'hot' ? 80 : scoreThreshold === 'warm' ? 60 : 0;

    const discovered = await runDiscoveryScan(
      { id: jobId },
      services,
      filters,
      async (progress, count) => {
        await prisma.scanJob.update({
          where: { id: jobId },
          data:  { progress, leadsFound: count },
        });
      },
    );

    for (const dl of discovered) {
      try {
        if (savedIds.length >= maxLeads) break;
        const id = await saveDiscoveredLead(orgId, dl, services);
        if (id) {
          // Apply score threshold filter if set
          if (minScore > 0) {
            const saved = await prisma.lead.findUnique({ where: { id }, select: { leadScore: true } }).catch(() => null);
            if (saved && (saved.leadScore || 0) < minScore) {
              await prisma.lead.delete({ where: { id } }).catch(() => {});
              continue;
            }
          }
          savedIds.push(id);
          // Auto-enrich contacts via Apollo using the decision-maker roles selected on the discovery page
          const savedLead = await prisma.lead.findUnique({ where: { id } }).catch(() => null);
          if (savedLead) {
            runApolloEnrichmentBackground(savedLead, prisma, {
              organizationId: orgId,
              roles: decisionMakerRoles,
            }).catch(() => {});
          }
        }
      } catch (err) {
        logger.error('Failed to save lead', { err: err.message, company: dl.companyName });
      }
    }

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status:      'completed',
        progress:    100,
        leadsFound:  savedIds.length,
        completedAt: new Date(),
      },
    });

    logger.info('Service scan completed', { jobId, leadsFound: savedIds.length });
  } catch (err) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data:  { status: 'failed', error: err.message },
    }).catch(() => {});
    throw err;
  }
}

async function processProductScan(jobId, orgId, productInput, filters = {}, maxLeads = 50) {
  try {
    const savedIds = [];

    const { leads: discovered, profile } = await runProductDiscoveryScan(
      { id: jobId },
      productInput,
      filters,
      async (progress, count) => {
        await prisma.scanJob.update({
          where: { id: jobId },
          data:  { progress, leadsFound: count },
        });
      },
    );

    const keywords = [profile?.productSummary || profile?.productName || productInput.productName || ''].filter(Boolean);

    for (const dl of discovered) {
      try {
        if (savedIds.length >= maxLeads) break;
        const id = await saveDiscoveredLead(orgId, dl, keywords);
        if (id) savedIds.push(id);
      } catch (err) {
        logger.error('Failed to save product lead', { err: err.message, company: dl.companyName });
      }
    }

    await prisma.scanJob.update({
      where: { id: jobId },
      data: {
        status:      'completed',
        progress:    100,
        leadsFound:  savedIds.length,
        completedAt: new Date(),
      },
    });

    logger.info('Product scan completed', { jobId, leadsFound: savedIds.length });
  } catch (err) {
    await prisma.scanJob.update({
      where: { id: jobId },
      data:  { status: 'failed', error: err.message },
    }).catch(() => {});
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REST endpoints
// ─────────────────────────────────────────────────────────────────────────────

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
      where:   { organizationId: req.user.organizationId },
      orderBy: { createdAt: 'desc' },
      take:    20,
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
      where, orderBy: { createdAt: 'desc' }, take: parseInt(limit),
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
        name:     typeof s === 'string' ? s     : s.name,
        keywords: typeof s === 'string' ? [s.toLowerCase()] : (s.keywords || [s.name.toLowerCase()]),
      })),
    });
    return success(res, { count: created.count }, 'Services updated');
  } catch (err) {
    return error(res, 'Failed to update services', 500);
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// POST /discovery/product/generate-prompt
// Step 1 of product scan flow:
//   User fills in product details → clicks "Generate Prompt"
//   Backend calls AI → returns human-readable prompt
//   Frontend shows prompt in editable textarea
//   User reviews/edits → clicks "Scan" → startProductScan runs with the prompt
// ─────────────────────────────────────────────────────────────────────────────

async function generateProductScanPrompt(req, res) {
  try {
    const {
      productUrl,
      productDescription,
      productDocumentText,
      targetIndustry = '',
      targetRegion   = '',
    } = req.body;

    const hasUrl  = !!(productUrl         && productUrl.trim().length > 0);
    const hasDesc = !!(productDescription  && productDescription.trim().length > 5);
    const hasDoc  = !!(productDocumentText && productDocumentText.trim().length > 5);

    if (!hasUrl && !hasDesc && !hasDoc) {
      return error(res, 'Provide at least one: productUrl, productDescription, or productDocumentText', 422);
    }

    const productInput = {
      url:         hasUrl  ? productUrl.trim()          : undefined,
      description: hasDesc ? productDescription.trim()  : undefined,
      docText:     hasDoc  ? productDocumentText.trim() : undefined,
      content: [
        hasDesc ? productDescription.trim() : '',
        hasDoc  ? productDocumentText.trim().slice(0, 2000) : '',
      ].filter(Boolean).join('\n\n') || productUrl || '',
    };

    const result = await generateProductPrompt(productInput, { targetIndustry, targetRegion });

    return success(res, {
      promptText:  result.promptText,
      productName: result.productName,
      buyerType:   result.buyerType,
      summary:     result.summary,
    }, 'Prompt generated');
  } catch (err) {
    logger.error('generateProductScanPrompt error', { err: err.message });
    return error(res, 'Failed to generate prompt', 500);
  }
}

module.exports = {
  startScan,
  startProductScan,
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

// ─────────────────────────────────────────────────────────────────────────────
// POST /discovery/scan/smart
// Parse a free-form prompt, upsert the service, and immediately start a scan
// ─────────────────────────────────────────────────────────────────────────────

async function smartScan(req, res) {
  try {
    const { prompt } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 5) {
      return error(res, 'prompt is required', 422);
    }

    // Step 1 — parse the prompt into structured params
    let parsed;
    try {
      parsed = await parseUserPrompt(prompt.trim());
    } catch (parseErr) {
      logger.error('smartScan: parseUserPrompt failed', { err: parseErr.message });
      return error(res, 'Failed to understand your prompt — please try rephrasing', 422);
    }

    const {
      service            = '',
      targetIndustry     = '',
      targetRegion       = '',
      companySize        = '',
      companyType        = '',
      valueProp          = '',
      keywords           = '',
      seniorityLevel     = '',
      leadCount          = 50,
      decisionMakerRoles = [],
    } = parsed;

    if (!service) {
      return error(res, 'Could not identify a service or position from your prompt', 422);
    }

    // Step 2 — upsert the service so the scan engine can find it
    const orgId = req.user.organizationId;
    const existing = await prisma.service.findMany({ where: { organizationId: orgId, isActive: true } });
    const alreadyExists = existing.some(s => s.name.toLowerCase() === service.toLowerCase());
    if (!alreadyExists) {
      await prisma.service.create({ data: { organizationId: orgId, name: service, isActive: true } });
    }
    const serviceNames = alreadyExists ? existing.map(s => s.name) : [...existing.map(s => s.name), service];

    // Step 3 — create scan job
    const job = await prisma.scanJob.create({
      data: {
        organizationId: orgId,
        status:    'running',
        services:  serviceNames,
        targetIndustry,
        targetRegion,
        sources:   {
          scanType: 'service', decisionMakerRoles,
          companySize, companyType, valueProp, keywords, seniorityLevel, leadCount,
          smartPrompt: prompt.trim(),
        },
        startedAt: new Date(),
      },
    });

    // Step 4 — fire and forget
      processScan(
      job.id,
      orgId,
      serviceNames,
      { targetIndustry, targetRegion, companySize, companyType, valueProp, keywords, seniorityLevel },
      Array.isArray(decisionMakerRoles) ? decisionMakerRoles : [],
      Number(leadCount) || 50,
      '',
    ).catch(err => logger.error('smartScan processScan failed', { jobId: job.id, err: err.message }));

    return success(res, { id: job.id, jobId: job.id, status: 'running', parsedParams: parsed }, 'Smart scan started', 202);
  } catch (err) {
    logger.error('smartScan error', { err: err.message });
    return error(res, 'Failed to start smart scan', 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /discovery/parse-prompt
// Parse free-form user description into structured scan params
// ─────────────────────────────────────────────────────────────────────────────

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
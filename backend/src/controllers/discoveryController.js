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
const { runBackgroundEnrichment } = require('../services/leadEnrichmentPipeline');
const { analyzeLeadIntent } = require('../services/aiService');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// POST /discovery/scan  — service / position based
// ─────────────────────────────────────────────────────────────────────────────

async function startScan(req, res) {
  try {
    const {
      targetIndustry = '',
      targetRegion   = '',
      workTypes      = [],
      sources        = [],
    } = req.body;

    const services = await prisma.service.findMany({
      where: { organizationId: req.user.organizationId, isActive: true },
    });

    if (!services.length) {
      return error(res, 'No services configured. Add at least one service/position first.', 422);
    }

    const job = await prisma.scanJob.create({
      data: {
        organizationId: req.user.organizationId,
        status:    'running',
        services:  services.map(s => s.name),
        targetIndustry,
        targetRegion,
        sources:   { workTypes, sources, scanType: 'service' },
        startedAt: new Date(),
      },
    });

    // Fire and forget — scan runs fully in background
    processScan(
      job.id,
      req.user.organizationId,
      services.map(s => s.name),
      { workTypes, sources, targetIndustry, targetRegion },
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
      customPrompt,        // optional — user-edited prompt from the preview step
      targetIndustry = '',
      targetRegion   = '',
      workTypes      = [],
      sources        = [],
    } = req.body;

    const hasUrl  = !!(productUrl         && productUrl.trim().length > 0);
    const hasDesc = !!(productDescription  && productDescription.trim().length > 5);
    const hasDoc  = !!(productDocumentText && productDocumentText.trim().length > 5);

    if (!hasUrl && !hasDesc && !hasDoc) {
      return error(res, 'Provide at least one: productUrl, productDescription, or productDocumentText', 422);
    }

    // Build product input — pass ALL provided content to the AI for richest profile
    const productInput = {
      type:         productType || (hasUrl ? 'url' : hasDoc ? 'document' : 'description'),
      url:          hasUrl  ? productUrl.trim()          : undefined,
      description:  hasDesc ? productDescription.trim()  : undefined,
      docText:      hasDoc  ? productDocumentText.trim() : undefined,
      customPrompt: customPrompt?.trim() || undefined,  // user-edited prompt overrides AI generation
      content: [
        hasDesc ? productDescription.trim() : '',
        hasDoc  ? productDocumentText.trim().slice(0, 2000) : '',
      ].filter(Boolean).join('\n\n') || productUrl || '',
    };

    const job = await prisma.scanJob.create({
      data: {
        organizationId: req.user.organizationId,
        status:    'running',
        services:  [],
        targetIndustry,
        targetRegion,
        sources: {
          workTypes,
          sources,
          scanType:   'product',
          productType: productInput.type,
          productUrl:  productUrl || null,
          productDescriptionSnippet: (productDescription || productDocumentText || '').slice(0, 200),
        },
        startedAt: new Date(),
      },
    });

    processProductScan(
      job.id,
      req.user.organizationId,
      productInput,
      { workTypes, sources, targetIndustry, targetRegion },
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
  // Deduplicate
  const existing = await prisma.lead.findFirst({
    where: {
      organizationId,
      OR: [
        { companyName: { equals: dl.companyName, mode: 'insensitive' } },
        ...(dl.website ? [{ website: { equals: dl.website, mode: 'insensitive' } }] : []),
      ],
    },
  });
  if (existing) return null;

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
      intentSignals: [{
        type:       dl.signalType  || 'general',
        text:       dl.signalText  || '',
        confidence: dl.confidence  || 50,
      }],
      leadScore:   analysis.leadScore,
      intentScore: analysis.intentScore,
      intentLevel: analysis.intentLevel,
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

  return lead.id;
}

async function processScan(jobId, orgId, services, filters = {}) {
  try {
    const savedIds = [];

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
        const id = await saveDiscoveredLead(orgId, dl, services);
        if (id) savedIds.push(id);
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

async function processProductScan(jobId, orgId, productInput, filters = {}) {
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

    const keywords = [profile?.productSummary || profile?.productName || ''].filter(Boolean);

    for (const dl of discovered) {
      try {
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
  getScanStatus,
  getScanHistory,
  getActiveScan,
  getSignals,
  getServices,
  upsertServices,
};
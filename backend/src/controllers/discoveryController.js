/**
 * discoveryController.js  —  REWRITTEN
 *
 * FLOW CHANGE:
 *   OLD: scan → save lead → auto-run SignalHire + Apollo (wastes API credits)
 *   NEW: scan → save lead + company info only
 *        SignalHire / Apollo are triggered MANUALLY by user on the lead detail page
 *
 * Background tasks after each lead save (lightweight, no paid enrichment APIs):
 *   Phase 1 — find company LinkedIn URL via SerpAPI
 *   Phase 2 — fetch basic company info via Clearbit (free) + SerpAPI Knowledge Graph
 */

const prisma  = require('../utils/prisma');
const { success, error } = require('../utils/response');
const { runDiscoveryScan }        = require('../services/discoveryService');
const { runProductDiscoveryScan } = require('../services/productDiscoveryService');
const { findCompanyLinkedin, findDecisionMakerLinkedin, fetchBasicCompanyInfo } =
  require('../services/linkedinEnrichmentService');
const { analyzeLeadIntent } = require('../services/aiService');
const logger = require('../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// startScan — service / position based
// ─────────────────────────────────────────────────────────────────────────────

async function startScan(req, res) {
  try {
    const { targetIndustry, targetRegion, workTypes = [], sources = [] } = req.body;

    const services = await prisma.service.findMany({
      where: { organizationId: req.user.organizationId, isActive: true },
    });
    if (!services.length)
      return error(res, 'No services configured. Add at least one service first.', 422);

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

    processScan(
      job.id,
      req.user.organizationId,
      services.map(s => s.name),
      { workTypes, sources, targetIndustry, targetRegion },
    ).catch(err => logger.error('Scan failed', { jobId: job.id, err: err.message }));

    return success(res, { id: job.id, jobId: job.id, status: 'running' }, 'Scan started', 202);
  } catch (err) {
    logger.error('startScan', { err: err.message });
    return error(res, 'Failed to start scan', 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// startProductScan — product URL / description / document
// ─────────────────────────────────────────────────────────────────────────────

async function startProductScan(req, res) {
  try {
    const {
      productType, productUrl, productDescription,
      productDocumentText, targetIndustry, targetRegion,
      workTypes = [], sources = [],
    } = req.body;

    if (!productType)
      return error(res, 'productType is required (url | description | document)', 422);

    let productInput;
    if (productType === 'url') {
      if (!productUrl) return error(res, 'productUrl is required', 422);
      productInput = { type: 'url', url: productUrl, content: productDescription || '' };
    } else if (productType === 'description') {
      if (!productDescription) return error(res, 'productDescription is required', 422);
      productInput = { type: 'description', content: productDescription };
    } else if (productType === 'document') {
      if (!productDocumentText) return error(res, 'productDocumentText is required', 422);
      productInput = { type: 'document', content: productDocumentText };
    } else {
      return error(res, `Unknown productType: ${productType}`, 422);
    }

    const job = await prisma.scanJob.create({
      data: {
        organizationId: req.user.organizationId,
        status:   'running',
        services: [],
        targetIndustry,
        targetRegion,
        sources: {
          workTypes, sources, scanType: 'product', productType,
          productUrl: productUrl || null,
          productDescriptionSnippet: (productDescription || productDocumentText || '').slice(0, 200),
        },
        startedAt: new Date(),
      },
    });

    processProductScan(job.id, req.user.organizationId, productInput, {
      workTypes, sources, targetIndustry, targetRegion,
    }).catch(err => logger.error('Product scan failed', { jobId: job.id, err: err.message }));

    return success(res, { id: job.id, jobId: job.id, status: 'running' }, 'Product scan started', 202);
  } catch (err) {
    logger.error('startProductScan', { err: err.message });
    return error(res, 'Failed to start product scan', 500);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// saveDiscoveredLead
// Saves company/lead info only — NO SignalHire/Apollo here
// Kicks off lightweight background enrichment (LinkedIn URL + basic info)
// ─────────────────────────────────────────────────────────────────────────────

async function saveDiscoveredLead(organizationId, dl, services) {
  // Skip duplicates by company name OR website
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

  const analysis = await analyzeLeadIntent(dl, services);

  const lead = await prisma.lead.create({
    data: {
      organizationId,
      companyName:     dl.companyName,
      website:         dl.website           || null,
      industry:        dl.industry          || null,
      location:        dl.location          || null,
      companySize:     dl.companySize        || null,
      description:     dl.description       || null,
      techStack:       dl.techStack         || [],
      linkedinUrl:     dl.companyLinkedinUrl || dl.linkedinUrl || null,
      contactName:     dl.contactName       || null,
      contactTitle:    dl.contactTitle      || null,
      contactLinkedin: dl.contactLinkedin   || null,
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
  }).catch(() => {});

  // Lightweight background enrichment ONLY — no SignalHire/Apollo
  enrichCompanyInfoAsync(lead).catch(err =>
    logger.error('enrichCompanyInfoAsync failed', { leadId: lead.id, err: err.message })
  );

  return lead.id;
}

// ─────────────────────────────────────────────────────────────────────────────
// enrichCompanyInfoAsync
// Runs in background after lead save. Finds LinkedIn URL + basic company info.
// Does NOT call SignalHire or Apollo — those are user-triggered from lead page.
// ─────────────────────────────────────────────────────────────────────────────

async function enrichCompanyInfoAsync(lead) {
  let cur = { ...lead };

  // ── Phase 1: Company LinkedIn URL ────────────────────────────────────────
  if (!cur.linkedinUrl) {
    try {
      const li = await findCompanyLinkedin(cur);
      if (li) {
        const patch = {};
        if (li.companyLinkedinUrl && !cur.linkedinUrl)
          patch.linkedinUrl = li.companyLinkedinUrl;
        if (li.contactLinkedin && !cur.contactLinkedin)
          patch.contactLinkedin = li.contactLinkedin;

        if (Object.keys(patch).length > 0) {
          cur = await prisma.lead.update({ where: { id: cur.id }, data: patch });
          logger.info('enrichCompanyInfo: LinkedIn saved', { leadId: cur.id });
        }
      }

      // Try targeted decision-maker profile search if still no contactLinkedin
      if (!cur.contactLinkedin) {
        const personUrl = await findDecisionMakerLinkedin(cur);
        if (personUrl) {
          cur = await prisma.lead.update({
            where: { id: cur.id },
            data:  { contactLinkedin: personUrl },
          });
          logger.info('enrichCompanyInfo: person LinkedIn saved', { leadId: cur.id });
        }
      }
    } catch (err) {
      logger.warn('enrichCompanyInfo Phase1 error', { leadId: cur.id, err: err.message });
    }
  }

  // ── Phase 2: Basic company info (Clearbit free + SerpAPI KG) ─────────────
  if (!cur.industry || !cur.location || !cur.description) {
    try {
      const info = await fetchBasicCompanyInfo(cur);
      if (info) {
        const patch = {};
        if (info.industry    && !cur.industry)    patch.industry    = info.industry;
        if (info.location    && !cur.location)    patch.location    = info.location;
        if (info.companySize && !cur.companySize) patch.companySize = info.companySize;
        if (info.description && !cur.description) patch.description = info.description;

        if (Object.keys(patch).length > 0) {
          await prisma.lead.update({ where: { id: cur.id }, data: patch });
          logger.info('enrichCompanyInfo: basic info saved', {
            leadId: cur.id, fields: Object.keys(patch),
          });
        }
      }
    } catch (err) {
      logger.warn('enrichCompanyInfo Phase2 error', { leadId: cur.id, err: err.message });
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Scan processors (background)
// ─────────────────────────────────────────────────────────────────────────────

async function processScan(jobId, orgId, services, filters = {}) {
  try {
    const savedIds  = [];
    const discovered = await runDiscoveryScan({ id: jobId }, services, filters,
      async (progress, count) =>
        prisma.scanJob.update({ where: { id: jobId }, data: { progress, leadsFound: count } }),
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
      data: { status: 'completed', progress: 100, leadsFound: savedIds.length, completedAt: new Date() },
    });
    logger.info('Scan completed', { jobId, leadsFound: savedIds.length });
  } catch (err) {
    await prisma.scanJob.update({
      where: { id: jobId }, data: { status: 'failed', error: err.message },
    }).catch(() => {});
    throw err;
  }
}

async function processProductScan(jobId, orgId, productInput, filters = {}) {
  try {
    const savedIds  = [];
    const { leads: discovered, profile } = await runProductDiscoveryScan(
      { id: jobId }, productInput, filters,
      async (progress, count) =>
        prisma.scanJob.update({ where: { id: jobId }, data: { progress, leadsFound: count } }),
    );

    const keywords = [profile?.productSummary || ''].filter(Boolean);
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
      data: { status: 'completed', progress: 100, leadsFound: savedIds.length, completedAt: new Date() },
    });
    logger.info('Product scan completed', { jobId, leadsFound: savedIds.length });
  } catch (err) {
    await prisma.scanJob.update({
      where: { id: jobId }, data: { status: 'failed', error: err.message },
    }).catch(() => {});
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// REST controllers
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
        name:     typeof s === 'string' ? s        : s.name,
        keywords: typeof s === 'string' ? [s.toLowerCase()] : (s.keywords || [s.name.toLowerCase()]),
      })),
    });
    return success(res, { count: created.count }, 'Services updated');
  } catch (err) {
    return error(res, 'Failed to update services', 500);
  }
}

module.exports = {
  startScan, startProductScan,
  getScanStatus, getScanHistory, getActiveScan,
  getSignals, getServices, upsertServices,
};

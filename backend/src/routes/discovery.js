const router = require('express').Router();
const ctrl = require('../controllers/discoveryController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

// Service-based scan
router.post('/scan', authorize('org_admin', 'manager'), ctrl.startScan);

// Generate prompt preview before product scan (Step 1)
router.post('/product/generate-prompt', authorize('org_admin', 'manager'), ctrl.generateProductScanPrompt);

// Product-based scan with finalized prompt (Step 2)
router.post('/scan/product', authorize('org_admin', 'manager'), ctrl.startProductScan);

// Active running scan — for progress restore on refresh
router.get('/scan/active', ctrl.getActiveScan);

// Poll specific scan
router.get('/scan/:jobId', ctrl.getScanStatus);

// Scan history & intent signals
router.get('/scans', ctrl.getScanHistory);
router.get('/signals', ctrl.getSignals);

// Services
router.get('/services', ctrl.getServices);
router.put('/services', authorize('org_admin', 'manager'), ctrl.upsertServices);

module.exports = router;
const router = require('express').Router();
const ctrl = require('../controllers/discoveryController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.post('/scan', authorize('org_admin', 'manager'), ctrl.startScan);
router.post('/scan/smart', authorize('org_admin', 'manager'), ctrl.smartScan);
router.post('/service/generate-prompt', authorize('org_admin', 'manager'), ctrl.generateServiceScanPrompt);
router.post('/product/generate-prompt', authorize('org_admin', 'manager'), ctrl.generateProductScanPrompt);
router.post('/scan/product', authorize('org_admin', 'manager'), ctrl.startProductScan);

router.get('/scan/active', ctrl.getActiveScan);
router.get('/scan/:jobId', ctrl.getScanStatus);
router.get('/scans', ctrl.getScanHistory);
router.get('/signals', ctrl.getSignals);

router.get('/services', ctrl.getServices);
router.put('/services', authorize('org_admin', 'manager'), ctrl.upsertServices);

module.exports = router;

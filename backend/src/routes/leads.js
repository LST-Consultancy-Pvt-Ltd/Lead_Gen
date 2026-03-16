const router = require('express').Router();
const ctrl   = require('../controllers/leadController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);

router.get('/',        ctrl.getLeads);
router.get('/export',  ctrl.exportLeads);
router.get('/:id',     ctrl.getLead);
router.post('/',       ctrl.createLead);
router.patch('/:id',   ctrl.updateLead);
router.delete('/:id',  authorize('org_admin', 'manager'), ctrl.deleteLead);

router.post('/:id/analyze',       ctrl.analyzeLead);
router.post('/:id/generate-email',ctrl.generateEmail);
router.post('/:id/send-outreach', ctrl.sendOutreach);

// Contact enrichment — two separate endpoints, called sequentially by the frontend
// Step 1: try SignalHire
router.post('/:id/enrich/signalhire', ctrl.enrichLeadViaSignalHire);
// Step 2: try Apollo (only called by frontend if SignalHire returned found: false)
router.post('/:id/enrich/apollo',     ctrl.enrichLeadViaApollo);

module.exports = router;

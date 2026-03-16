const router = require('express').Router();
const ctrl = require('../controllers/campaignController');
const { authenticate, authorize } = require('../middleware/auth');

router.use(authenticate);
router.get('/', ctrl.getCampaigns);
router.get('/:id', ctrl.getCampaign);
router.post('/', authorize('org_admin', 'manager'), ctrl.createCampaign);
router.patch('/:id', authorize('org_admin', 'manager'), ctrl.updateCampaign);
router.post('/:id/leads', ctrl.addLeadsToCampaign);
router.post('/:id/launch', authorize('org_admin', 'manager'), ctrl.launchCampaign);

module.exports = router;

const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);
router.get('/overview', ctrl.getOverview);
router.get('/leads/monthly', ctrl.getLeadsByMonth);
router.get('/leads/status', ctrl.getLeadsByStatus);
router.get('/leads/sources', ctrl.getTopSources);

module.exports = router;

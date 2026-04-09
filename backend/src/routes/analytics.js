const router = require('express').Router();
const ctrl = require('../controllers/analyticsController');
const { authenticate } = require('../middleware/auth');
const { requireManagerOrAdmin, requireAdmin } = require('../middleware/rbac');

router.use(authenticate);

// Personal analytics — accessible by all roles
router.get('/my', ctrl.getMyAnalytics);

// Org-wide analytics — manager/admin only
router.get('/overview', requireManagerOrAdmin, ctrl.getOverview);
router.get('/leads/monthly', requireManagerOrAdmin, ctrl.getLeadsByMonth);
router.get('/leads/status', requireManagerOrAdmin, ctrl.getLeadsByStatus);
router.get('/leads/sources', requireManagerOrAdmin, ctrl.getTopSources);
router.get('/team-performance', requireManagerOrAdmin, ctrl.getTeamPerformance);

// Role-scoped dashboards (legacy static endpoints — kept for backward compat)
router.get('/dashboard/sales', ctrl.getSalesDashboard);
router.get('/dashboard/manager', requireManagerOrAdmin, ctrl.getManagerDashboard);
router.get('/dashboard/ceo', requireAdmin, ctrl.getCEODashboard);

// Dynamic dashboard — returns widgets based on the caller's role automatically
router.get('/dashboard', ctrl.getDashboard);

// SSE stream — real-time push notifications when dashboard data changes
router.get('/dashboard/stream', ctrl.getDashboardStream);

module.exports = router;

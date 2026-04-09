/**
 * import.js
 * Routes for lead import — admin only
 */

const router = require('express').Router();
const multer = require('multer');
const { authenticate } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/rbac');
const ctrl = require('../controllers/importController');

// Store file in memory (never on disk) — max 10 MB
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ['.csv', '.xlsx', '.xls'];
    const ext = file.originalname.slice(file.originalname.lastIndexOf('.')).toLowerCase();
    if (allowed.includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and Excel files are allowed'));
    }
  },
});

router.use(authenticate);
router.use(requireAdmin);

// POST /api/import/leads — upload file and bulk-create leads
router.post('/leads', upload.single('file'), ctrl.importLeads);

// GET /api/import/logs — view import history
router.get('/logs', ctrl.getImportLogs);

module.exports = router;

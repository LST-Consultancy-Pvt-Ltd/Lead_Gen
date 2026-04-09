require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const config = require('./config');
const logger = require('./utils/logger');
const prisma = require('./utils/prisma');
const { errorHandler, notFound } = require('./middleware/errorHandler');
const { startScheduler } = require('./jobs/scanScheduler');

// Routes
const authRoutes = require('./routes/auth');
const leadRoutes = require('./routes/leads.routes'); // Updated to use new production-ready routes
const discoveryRoutes = require('./routes/discovery');
const campaignRoutes = require('./routes/campaigns');
const analyticsRoutes = require('./routes/analytics');
const teamRoutes = require('./routes/team');
const activitiesRoutes = require('./routes/activities');
const opportunityRoutes = require('./routes/opportunities');
const importRoutes = require('./routes/import');
const invitationRoutes = require('./routes/invitations');
const accountRoutes = require('./routes/accounts');
const contactRoutes = require('./routes/contacts');
const dropdownRoutes = require('./routes/dropdowns');
const notificationRoutes = require('./routes/notifications');
const searchRoutes = require('./routes/search');

const app = express();

// ── Security ──────────────────────────────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: config.corsOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ── Rate Limiting ─────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  max: config.rateLimit.max,
  message: { success: false, message: 'Too many requests' },
});
app.use('/api/', limiter);

// ── Parsing ───────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev', {
  stream: { write: msg => logger.info(msg.trim()) },
}));

// ── Health ────────────────────────────────────────────────────────────────
app.get('/health', async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: 'ok', timestamp: new Date().toISOString(), env: config.env });
  } catch (err) {
    res.status(503).json({ status: 'degraded', error: err.message });
  }
});

// ── API Routes ────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/discovery', discoveryRoutes);
app.use('/api/campaigns', campaignRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/team', teamRoutes);
app.use('/api/users', teamRoutes); // Alias for /api/team for frontend compatibility
app.use('/api/activities', activitiesRoutes);
app.use('/api/opportunities', opportunityRoutes);
app.use('/api/import', importRoutes);
app.use('/api/invitations', invitationRoutes);
app.use('/api/accounts', accountRoutes);
app.use('/api/contacts', contactRoutes);
app.use('/api/dropdowns', dropdownRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/search', searchRoutes);

// ── Error Handling ────────────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────
async function start() {
  try {
    await prisma.$connect();
    logger.info('Database connected');

    if (config.env === 'production') {
      startScheduler();
    }

    app.listen(config.port, '0.0.0.0', () => {
      logger.info(`LeadForge AI backend running on port ${config.port} (${config.env})`);
    });
  } catch (err) {
    logger.error('Startup failed', { err: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM received, shutting down...');
  await prisma.$disconnect();
  process.exit(0);
});

start();

module.exports = app;

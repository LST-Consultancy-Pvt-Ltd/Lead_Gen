require('dotenv').config();

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT) || 4000,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  corsOrigins: (process.env.CORS_ORIGINS || 'http://localhost:3000').split(','),
  db: { url: process.env.DATABASE_URL },
  redis: { url: process.env.REDIS_URL, password: process.env.REDIS_PASSWORD },
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-jwt-secret-change-me',
    refreshSecret: process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:4000/api/auth/google/callback',
  },
  openai: { apiKey: process.env.OPENAI_API_KEY, model: 'gpt-4.1-mini' },
  serpapi: { key: process.env.SERPAPI_KEY },
  sendgrid: {
    apiKey: process.env.SENDGRID_API_KEY,
    fromEmail: process.env.SENDGRID_FROM_EMAIL || 'noreply@leadforge.ai',
    fromName: process.env.SENDGRID_FROM_NAME || 'LeadForge AI',
  },
  gmail: { clientId: process.env.GMAIL_CLIENT_ID, clientSecret: process.env.GMAIL_CLIENT_SECRET },
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 900000,
    max: parseInt(process.env.RATE_LIMIT_MAX),
  },
  signalhire: {
    apiKey: process.env.SIGNALHIRE_API_KEY,
    // Public URL SignalHire POSTs results to (it pushes, you cannot poll).
    // In dev, expose the backend via a tunnel (e.g. ngrok) and set this to
    // https://<tunnel>/api/webhooks/signalhire
    callbackUrl: process.env.SIGNALHIRE_CALLBACK_URL,
  },
  apollo: {
    apiKey: process.env.APOLLO_API_KEY,
  },
};

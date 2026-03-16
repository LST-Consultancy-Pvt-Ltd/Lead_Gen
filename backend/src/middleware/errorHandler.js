const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
  logger.error('Unhandled error', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  if (err.code === 'P2002') {
    return res.status(409).json({ success: false, message: 'Resource already exists' });
  }
  if (err.code === 'P2025') {
    return res.status(404).json({ success: false, message: 'Resource not found' });
  }

  const statusCode = err.statusCode || 500;
  const message = statusCode === 500 ? 'Internal server error' : err.message;
  res.status(statusCode).json({ success: false, message });
};

const notFound = (req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.path} not found` });
};

module.exports = { errorHandler, notFound };

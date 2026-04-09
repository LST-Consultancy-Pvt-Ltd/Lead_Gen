const { validationResult } = require('express-validator');
const { error } = require('../utils/response');
const logger = require('../utils/logger');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const errs = errors.array();
    logger.warn('Validation failed', {
      path: req.path,
      method: req.method,
      role: req.user?.role,
      userId: req.user?.id,
      errors: errs.map((e) => ({ field: e.path, message: e.msg, value: e.value })),
    });
    return error(res, 'Validation failed', 422, errs);
  }
  next();
};

module.exports = validate;

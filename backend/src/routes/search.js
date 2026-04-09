/**
 * search.js
 * Route for global search across all entities.
 */

const express = require('express');
const router = express.Router();
const { query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { globalSearch } = require('../controllers/searchController');

const searchValidation = [
  query('q')
    .trim()
    .notEmpty()
    .withMessage('Search query is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Search query must be between 2 and 100 characters'),

  query('limit')
    .optional()
    .isInt({ min: 1, max: 20 })
    .withMessage('limit must be between 1 and 20'),
];

/**
 * GET /api/search?q=<term>&limit=5
 * Global search across leads, contacts, accounts, opportunities.
 * Access: All authenticated users (results scoped by role).
 */
router.get('/', authenticate, searchValidation, validate, globalSearch);

module.exports = router;

const express = require('express');
const router = express.Router();
const { handleSignalHire } = require('../controllers/webhooks.controller');

// PUBLIC — external providers push results here (no JWT).
router.post('/signalhire', handleSignalHire);

module.exports = router;

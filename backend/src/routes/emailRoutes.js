'use strict';

const express = require('express');
const { validateQuery } = require('../middleware/validateQuery');
const queries = require('../middleware/schemas/routeQuerySchemas');
const router = express.Router();
const { requireAdminAuth } = require('../middleware/auth');
const {
  handleWebhook,
  listSuppressions,
  addSuppression,
  removeSuppression,
} = require('../controllers/emailWebhookController');

// Public provider webhooks (bounce/complaint). Protected by EMAIL_WEBHOOK_SECRET
// (shared-secret check inside the controller), not by admin auth.
router.post('/webhooks/:provider', validateQuery(queries.emailWebhook), handleWebhook);

// Suppression-list administration (admin only).
router.use('/suppressions', requireAdminAuth);
router.get('/suppressions', validateQuery(queries.limitSkip), listSuppressions);
router.post('/suppressions', addSuppression);
router.delete('/suppressions/:email', removeSuppression);

module.exports = router;

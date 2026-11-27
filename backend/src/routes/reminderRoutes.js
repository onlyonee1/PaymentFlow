'use strict';

const express = require('express');
const { validateQuery } = require('../middleware/validateQuery');
const queries = require('../middleware/schemas/routeQuerySchemas');
const router  = express.Router();
const { requireAdminAuth } = require('../middleware/auth');
const { resolveSchool } = require('../middleware/schoolContext');
const { reminderTriggerLimiter } = require('../middleware/rateLimiter');
const { triggerReminders, previewReminders, setOptOut, unsubscribeViaToken, resubscribeReminders } = require('../controllers/reminderController');

// Public unsubscribe endpoint (no auth required)
router.get('/unsubscribe', validateQuery(queries.unsubscribe), unsubscribeViaToken);

// All other reminder routes require admin auth + school context
router.use(requireAdminAuth);
router.use(resolveSchool);

router.post('/trigger', reminderTriggerLimiter, triggerReminders);
router.get('/preview',   previewReminders);
router.post('/opt-out',  setOptOut);

module.exports = router;

'use strict';

const express = require('express');
const { validateQuery } = require('../middleware/validateQuery');
const queries = require('../middleware/schemas/routeQuerySchemas');
const router = express.Router();
const { getReceipt } = require('../controllers/receiptsController');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireSchoolAuth } = require('../middleware/auth');
const { validateTxHashParam } = require('../middleware/validate');

// Payment receipts contain full financial details (amount, asset, student).
// Restrict to finance-authorized roles (fix #887).
const requireFinanceRole = requireSchoolAuth(['owner', 'finance']);

router.use(resolveSchool);
router.get('/:txHash', requireFinanceRole, validateTxHashParam, validateQuery(queries.receipt), getReceipt);

module.exports = router;

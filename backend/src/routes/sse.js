'use strict';

const express = require('express');
const router = express.Router();
const { requireSchoolAuth } = require('../middleware/auth');
const { streamPaymentEvents } = require('../controllers/paymentAdminController');

router.get('/payments', requireSchoolAuth(), streamPaymentEvents);
router.get('/stream', requireSchoolAuth(), streamPaymentEvents);

module.exports = router;

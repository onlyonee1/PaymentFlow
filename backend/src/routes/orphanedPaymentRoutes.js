'use strict';

const router = require('express').Router();
const { requireSchoolAuth } = require('../middleware/auth');
const { resolveSchool } = require('../middleware/schoolContext');
const { listOrphanedPayments, searchReconciliationStudents, matchOrphanedPayment } = require('../controllers/orphanedPaymentController');

router.use(resolveSchool, requireSchoolAuth(['owner', 'finance']));
router.get('/', listOrphanedPayments);
router.get('/students', searchReconciliationStudents);
router.post('/:id/match', matchOrphanedPayment);

module.exports = router;

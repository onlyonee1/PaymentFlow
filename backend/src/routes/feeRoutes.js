'use strict';

const express = require('express');
const router = express.Router();
const { createFeeStructure, getAllFeeStructures, getFeeByClass, deleteFeeStructure, updateFeeStructure } = require('../controllers/feeController');
const { validateFeeStructure } = require('../middleware/validate');
const { resolveSchool } = require('../middleware/schoolContext');
const { requireAdminAuth, requireSchoolAuth } = require('../middleware/auth');
const { auditContext } = require('../middleware/auditContext');
const { contractPaused } = require('../middleware/contractPaused');

// All fee routes require school context
router.use(resolveSchool);

/**
 * @swagger
 * /api/fees:
 *   post:
 *     summary: Create a fee structure
 *     operationId: createFeeStructure
 *     tags:
 *       - Fees
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - className
 *               - amount
 *             properties:
 *               className:
 *                 type: string
 *               amount:
 *                 type: number
 *               description:
 *                 type: string
 *     responses:
 *       201:
 *         description: Fee structure created
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *   get:
 *     summary: List all fee structures for the school
 *     operationId: getAllFeeStructures
 *     tags:
 *       - Fees
 *     parameters:
 *       - in: query
 *         name: includeDeleted
 *         schema:
 *           type: boolean
 *     responses:
 *       200:
 *         description: List of fee structures
 *       401:
 *         description: Unauthorized (required when includeDeleted=true)
 */

/**
 * @swagger
 * /api/fees/{className}:
 *   get:
 *     summary: Get fee structure for a specific class
 *     operationId: getFeeByClass
 *     tags:
 *       - Fees
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: className
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Fee structure
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Fee structure not found
 *   put:
 *     summary: Update fee structure for a class
 *     operationId: updateFeeStructure
 *     tags:
 *       - Fees
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: className
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               amount:
 *                 type: number
 *               description:
 *                 type: string
 *     responses:
 *       200:
 *         description: Updated fee structure
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Fee structure not found
 *   delete:
 *     summary: Delete (soft-delete) a fee structure
 *     operationId: deleteFeeStructure
 *     tags:
 *       - Fees
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: className
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Fee structure deleted
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Fee structure not found
 */

const requireIncludeDeletedAccess = (req, res, next) => {
  if (String(req.query.includeDeleted).toLowerCase() === 'true') {
    return requireAdminAuth(req, res, next);
  }
  return next();
};

router.post('/',              requireAdminAuth, auditContext, contractPaused, validateFeeStructure, createFeeStructure);
router.get('/',               requireIncludeDeletedAccess, getAllFeeStructures);
router.get('/:className',     requireSchoolAuth(), getFeeByClass);
router.put('/:className',     requireAdminAuth, auditContext, contractPaused, validateFeeStructure, updateFeeStructure);
router.delete('/:className',  requireAdminAuth, auditContext, contractPaused, deleteFeeStructure);

module.exports = router;

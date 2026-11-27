'use strict';

const express = require('express');
const router = express.Router();
const {
  createSchool,
  getAllSchools,
  getSchool,
  updateSchool,
  rotateStellarAddress,
  rotateWebhookSecret,
  deactivateSchool,
  deactivateSchoolEndpoint,
  activateSchool,
  registerWebhook,
  getSchoolSettings,
  updateSchoolSettings,
  clearSchoolSetting,
} = require('../controllers/schoolController');
const { requireAdminAuth } = require('../middleware/auth');
const { auditContext } = require('../middleware/auditContext');

// Public read endpoints

/**
 * @swagger
 * /api/schools:
 *   get:
 *     summary: List all schools
 *     operationId: getAllSchools
 *     tags:
 *       - Schools
 *     responses:
 *       200:
 *         description: List of schools
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/School'
 *   post:
 *     summary: Create a new school
 *     operationId: createSchool
 *     tags:
 *       - Schools
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - stellarAddress
 *             properties:
 *               name:
 *                 type: string
 *               slug:
 *                 type: string
 *               stellarAddress:
 *                 type: string
 *               network:
 *                 type: string
 *                 enum: [testnet, mainnet]
 *     responses:
 *       201:
 *         description: School created
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/School'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 *       409:
 *         description: School slug already exists
 */

/**
 * @swagger
 * /api/schools/{schoolId}:
 *   get:
 *     summary: Get a school by ID
 *     operationId: getSchool
 *     tags:
 *       - Schools
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: School record
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/School'
 *       404:
 *         description: School not found
 *   patch:
 *     summary: Update a school
 *     operationId: updateSchool
 *     tags:
 *       - Schools
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
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
 *               name:
 *                 type: string
 *               webhookUrl:
 *                 type: string
 *                 format: uri
 *     responses:
 *       200:
 *         description: Updated school record
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: School not found
 *   delete:
 *     summary: Deactivate a school
 *     operationId: deactivateSchool
 *     tags:
 *       - Schools
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: School deactivated
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: School not found
 */

/**
 * @swagger
 * /api/schools/{schoolId}/settings:
 *   get:
 *     summary: Get per-school settings overrides
 *     operationId: getSchoolSettings
 *     tags:
 *       - Schools
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: School settings
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: School not found
 *   patch:
 *     summary: Update per-school settings overrides
 *     operationId: updateSchoolSettings
 *     tags:
 *       - Schools
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: schoolId
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *     responses:
 *       200:
 *         description: Settings updated
 *       401:
 *         description: Unauthorized
 */
router.get('/',                 getAllSchools);
router.get('/:schoolId',        getSchool);

// Admin-only write endpoints — require JWT auth
router.post('/',                requireAdminAuth, auditContext, createSchool);
router.patch('/:schoolId',      requireAdminAuth, auditContext, updateSchool);
router.delete('/:schoolId',     requireAdminAuth, auditContext, deactivateSchool);

// Dedicated wallet-rotation endpoint — step-up auth + mandatory reason (#1387)
router.put('/:schoolId/stellar-address', requireAdminAuth, auditContext, rotateStellarAddress);

// Dedicated webhookSecret rotation endpoint — step-up auth (#1412)
router.put('/:schoolId/webhook-secret', requireAdminAuth, auditContext, rotateWebhookSecret);

// Explicit activate / deactivate endpoints
router.patch('/:schoolId/deactivate', requireAdminAuth, auditContext, deactivateSchoolEndpoint);
router.patch('/:schoolId/activate',   requireAdminAuth, auditContext, activateSchool);

// Webhook registration — validates URL for SSRF safety before storing
router.post('/:slug/webhooks', requireAdminAuth, auditContext, registerWebhook);

// Per-school settings overrides
router.get('/:schoolId/settings',     requireAdminAuth, auditContext, getSchoolSettings);
router.patch('/:schoolId/settings',   requireAdminAuth, auditContext, updateSchoolSettings);
router.delete('/:schoolId/settings/:key', requireAdminAuth, auditContext, clearSchoolSetting);

module.exports = router;

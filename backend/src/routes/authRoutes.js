'use strict';

const express = require('express');
const { rl } = require('../middleware/rateLimiter');
const { handleLogin, handleRefresh, handleLogout, handleMe, handleListSessions, handleRevokeSession, handleRevokeUserSessions, handleRevokeOwnSessions, handleChangePassword, handleResetPassword } = require('../controllers/authController');
const {
  setupMfa, verifyAndEnableMfa, disableMfa, regenerateBackupCodes,
  setupUserMfa, verifyAndEnableUserMfa, disableUserMfa,
} = require('../controllers/mfaController');
const { requireAdminAuth, requireSchoolAuth } = require('../middleware/auth');

const router = express.Router();

// ── Login rate limiter (IP-based, per-account lockout handled in controller) ──
// Uses Redis-backed storage shared across replicas when REDIS_HOST is configured.
const loginLimiter = rl(
  15 * 60 * 1000,
  10,
  { error: 'Too many login attempts, please try again later.', code: 'RATE_LIMIT_EXCEEDED' }
);

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Authenticate and obtain a JWT
 *     operationId: login
 *     tags:
 *       - Auth
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - username
 *               - password
 *             properties:
 *               username:
 *                 type: string
 *               password:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Authentication successful
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 token:
 *                   type: string
 *                 user:
 *                   type: object
 *                   properties:
 *                     id:
 *                       type: string
 *                     role:
 *                       type: string
 *                     schoolId:
 *                       type: string
 *       400:
 *         description: Missing username or password
 *       401:
 *         description: Invalid credentials
 *       429:
 *         description: Too many login attempts
 */

/**
 * @swagger
 * /api/auth/refresh:
 *   post:
 *     summary: Refresh an access token using a refresh token cookie
 *     operationId: refreshToken
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Invalid or expired refresh token
 */

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     summary: Invalidate the current session and clear refresh token cookie
 *     operationId: logout
 *     tags:
 *       - Auth
 *     responses:
 *       200:
 *         description: Logged out successfully
 */

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     summary: Get the currently authenticated user's profile
 *     operationId: getMe
 *     tags:
 *       - Auth
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/auth/change-password:
 *   post:
 *     summary: Change the authenticated user's password (invalidates all sessions)
 *     operationId: changePassword
 *     tags:
 *       - Auth
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - currentPassword
 *               - newPassword
 *             properties:
 *               currentPassword:
 *                 type: string
 *                 format: password
 *               newPassword:
 *                 type: string
 *                 format: password
 *     responses:
 *       200:
 *         description: Password changed; all sessions invalidated
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized or wrong current password
 */

/**
 * @swagger
 * /api/auth/sessions:
 *   get:
 *     summary: List all active sessions for the authenticated admin
 *     operationId: listSessions
 *     tags:
 *       - Auth
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: List of active sessions
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/auth/sessions/{sessionId}:
 *   delete:
 *     summary: Revoke a specific session by ID
 *     operationId: revokeSession
 *     tags:
 *       - Auth
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: sessionId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Session revoked
 *       401:
 *         description: Unauthorized
 *       404:
 *         description: Session not found
 */

/**
 * @swagger
 * /api/auth/mfa/setup:
 *   post:
 *     summary: Set up TOTP MFA for the admin account
 *     operationId: setupMfa
 *     tags:
 *       - Auth
 *       - MFA
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: MFA setup initiated — returns TOTP secret and QR code URI
 *       401:
 *         description: Unauthorized
 */

/**
 * @swagger
 * /api/auth/mfa/verify:
 *   post:
 *     summary: Verify TOTP token and enable MFA
 *     operationId: verifyAndEnableMfa
 *     tags:
 *       - Auth
 *       - MFA
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *             properties:
 *               token:
 *                 type: string
 *                 description: 6-digit TOTP code
 *     responses:
 *       200:
 *         description: MFA enabled
 *       400:
 *         description: Invalid token
 *       401:
 *         description: Unauthorized
 */

// ── Core auth routes ──────────────────────────────────────────────────────────
// #614 — Refresh token rotation: POST /refresh issues a new access + refresh
// token pair, invalidates the old refresh token, and detects reuse (token theft).
// Both tokens are delivered exclusively as HttpOnly, SameSite=Strict cookies.
router.post('/login', loginLimiter, handleLogin);
router.post('/refresh', handleRefresh);
router.post('/logout', handleLogout);
router.get('/me', requireSchoolAuth(), handleMe);

// ── Password management ───────────────────────────────────────────────────────
// #1360 — Changing the password immediately invalidates all existing sessions
// so stolen refresh tokens cannot outlive a password reset.
router.post('/change-password', requireSchoolAuth(), handleChangePassword);
router.post('/users/:userId/reset-password', requireAdminAuth, handleResetPassword);

// ── Session management ────────────────────────────────────────────────────────
router.get('/sessions', requireSchoolAuth(), handleListSessions);
router.delete('/sessions', requireSchoolAuth(), handleRevokeOwnSessions);
router.delete('/sessions/:sessionId', requireSchoolAuth(), handleRevokeSession);
// Admin revocation by userId — revokes ALL active sessions for the given user.
// Requires admin auth. Used for account-takeover response and forced password
// reset scenarios where all refresh tokens must be invalidated immediately.
router.delete('/sessions/user/:userId', requireAdminAuth, handleRevokeUserSessions);

// ── School-level TOTP / MFA routes (require super-admin auth) ────────────────
// #618 — /mfa/enroll is the documented entry-point; /mfa/setup kept as alias.
router.post('/mfa/enroll',  requireAdminAuth, setupMfa);
router.post('/mfa/setup',   requireAdminAuth, setupMfa);
router.post('/mfa/verify',  requireAdminAuth, verifyAndEnableMfa);
router.post('/mfa/disable', requireAdminAuth, disableMfa);
router.post('/mfa/backup-codes/regenerate', requireAdminAuth, regenerateBackupCodes);

// ── User-level TOTP / MFA routes (any authenticated user) ────────────────────
// #618 — enroll is the canonical entry-point name from the issue spec; setup
// is kept as an alias so existing integrations are not broken.
router.post('/mfa/user/enroll',  requireSchoolAuth(), setupUserMfa);
router.post('/mfa/user/setup',   requireSchoolAuth(), setupUserMfa);
router.post('/mfa/user/verify',  requireSchoolAuth(), verifyAndEnableUserMfa);
router.post('/mfa/user/disable', requireSchoolAuth(), disableUserMfa);

module.exports = router;

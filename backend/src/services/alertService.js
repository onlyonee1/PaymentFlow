'use strict';
const logger = require('../utils/logger').child('AlertService');
const client = require('prom-client');
const adminAlertCounter = new client.Counter({name:'admin_alerts_total', help:'Total number of admin alerts triggered'});
/**
 * Dispatches admin alert through alertService.
 * @param {string} message - Value used by sendAdminAlert.
 * @param {object} details - Value used by sendAdminAlert.
 * @returns {Promise<void>} Completes without a return value.
 */
async function sendAdminAlert(message, details = {}) {
  adminAlertCounter.inc();
  logger.error(`[ALERT] ${message}`, details);
}
module.exports = { sendAdminAlert };

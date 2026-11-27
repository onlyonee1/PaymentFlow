'use strict';

/**
 * SendGrid email provider.
 *
 * The SendGrid SDK is an optional peer dependency, required lazily so it is only
 * needed when EMAIL_PROVIDER=sendgrid. Bounces/complaints are delivered via
 * SendGrid Event Webhooks and handled by the email webhook controller.
 */

const config = require('../../../config');

let _mail = null;

function getMail() {
  if (_mail) return _mail;
  let sgMail;
  try {
    sgMail = require('@sendgrid/mail');
  } catch (_) {
    throw new Error(
      'EMAIL_PROVIDER=sendgrid requires the "@sendgrid/mail" package to be installed'
    );
  }
  const apiKey = config.SENDGRID_API_KEY || process.env.SENDGRID_API_KEY;
  if (!apiKey) {
    throw new Error('EMAIL_PROVIDER=sendgrid requires SENDGRID_API_KEY to be configured');
  }
  sgMail.setApiKey(apiKey);
  _mail = sgMail;
  return _mail;
}

module.exports = {
  name: 'sendgrid',

  /**
 * Dispatches the supplied value through sendgridProvider.
 * @param {string} message - Value used by send.
 * @returns {Promise<*>} Result produced by send.
 */
  async send(message) {
    const mail = getMail();
    const [res] = await mail.send({
      to: message.to,
      from: message.from || config.SMTP_FROM,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
    return { messageId: res?.headers?.['x-message-id'] || res?.headers?.['x-message-id'.toUpperCase()] };
  },

  /**
 * Validates the supplied value in sendgridProvider.
 * @returns {Promise<*>} Result produced by verify.
 */
  async verify() {
    try {
      getMail();
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  },

  /**
 * Provides the reset operation in sendgridProvider.
 * @returns {void} Completes without a return value.
 */
  _reset() {
    _mail = null;
  },
};

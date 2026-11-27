'use strict';

const { randomBytes } = require('crypto');

const parentPaymentMemoPattern = /^PF[0-9A-F]{16}$/;

function createParentPaymentMemo() {
  return `PF${randomBytes(8).toString('hex').toUpperCase()}`;
}

module.exports = { createParentPaymentMemo, parentPaymentMemoPattern };

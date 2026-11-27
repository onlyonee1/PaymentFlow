'use strict';

const mongoose = require('mongoose');
const { resolveTtlSeconds } = require('../src/models/webhookDeliveryModel');

async function setTtl(expireAfterSeconds) {
  await mongoose.connection.db.command({
    collMod: 'webhookdeliveries',
    index: { keyPattern: { createdAt: 1 }, expireAfterSeconds },
  });
}

module.exports = {
  version: '034_webhook_delivery_seven_day_ttl',
  up: () => setTtl(resolveTtlSeconds()),
  down: () => setTtl(30 * 86400),
};

'use strict';

const operations = Object.freeze(['submitPayment', 'queryStatus', 'reconcile']);

function validatePaymentProvider(provider) {
  if (!provider?.name || !Array.isArray(provider.capabilities) ||
      !operations.every((operation) => typeof provider[operation] === 'function')) {
    throw new TypeError('Invalid payment provider implementation');
  }
  return provider;
}

module.exports = { operations, validatePaymentProvider };

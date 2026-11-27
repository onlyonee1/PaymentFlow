'use strict';

const { withStellarRetry } = require('../../utils/withStellarRetry');

class StellarWalletProvider {
  constructor(retryOptions) {
    this.name = 'stellar_wallet';
    this.capabilities = Object.freeze(['signed_transaction', 'status_query', 'reconciliation']);
    this.retryOptions = retryOptions;
  }

  submitPayment(transaction) {
    const { server } = require('../../config/stellarConfig');
    return withStellarRetry(() => server.submitTransaction(transaction), {
      ...this.retryOptions,
      label: 'submitTransaction',
    });
  }

  queryStatus(...args) {
    const { verifyTransaction } = require('../stellarService');
    return this.retryOptions ? verifyTransaction(...args, this.retryOptions) : verifyTransaction(...args);
  }

  reconcile(school) {
    return require('../stellarService').syncPaymentsForSchool(school);
  }
}

module.exports = StellarWalletProvider;

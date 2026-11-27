'use strict';

const { operations, validatePaymentProvider } = require('./PaymentProvider');
const StellarWalletProvider = require('./StellarWalletProvider');
const { registerBreaker, withBreaker } = require('../providerCircuitBreakerRegistry');
const { isTransient } = require('../../utils/withStellarRetry');
const logger = require('../../utils/logger');

const defaultProvider = 'stellar_wallet';
const implementations = new Map([[defaultProvider, StellarWalletProvider]]);
let providers = new Map();

function loadProviders(config = { [defaultProvider]: {} }) {
  const loaded = new Map();
  for (const [name, policy] of Object.entries(config)) {
    const Implementation = implementations.get(name);
    if (!Implementation) {
      logger.warn('Unknown payment provider in startup configuration', { provider: name });
      continue;
    }

    const provider = validatePaymentProvider(new Implementation(policy?.retry));
    const breakerName = `payment:${name}`;
    registerBreaker(breakerName, policy?.circuitBreaker);
    const wrapped = { name, capabilities: provider.capabilities };
    for (const operation of operations) {
      wrapped[operation] = (...args) => withBreaker(
        breakerName,
        () => provider[operation](...args),
        {
          countsAsFailure: (error) => {
            const status = error.status ?? error.response?.status;
            return isTransient(error.originalError || error) ||
              error.code === 'HORIZON_UNAVAILABLE' || status >= 500;
          },
        },
      );
    }
    loaded.set(name, Object.freeze(wrapped));
  }
  providers = loaded;
}

function getProvider(name = defaultProvider, school) {
  const provider = providers.get(name);
  if (!provider || (school?.enabledPaymentProviders && !school.enabledPaymentProviders.includes(name))) {
    throw Object.assign(new Error('Payment provider is unavailable for this school'), {
      code: 'PAYMENT_PROVIDER_DISABLED',
      status: 422,
      statusCode: 422,
    });
  }
  return provider;
}

async function initializePaymentProviders() {
  const config = process.env.PAYMENT_PROVIDERS_JSON;
  if (config) loadProviders(JSON.parse(config));
  const School = require('../../models/schoolModel');
  const schools = School.find({ enabledPaymentProviders: { $exists: true } })
    .select('schoolId enabledPaymentProviders').lean().cursor();
  for await (const school of schools) {
    for (const name of school.enabledPaymentProviders || []) {
      if (!providers.has(name)) {
        logger.warn('School configured an unavailable payment provider', { schoolId: school.schoolId, provider: name });
      }
    }
  }
}

loadProviders();

module.exports = { defaultProvider, getProvider, initializePaymentProviders, loadProviders };

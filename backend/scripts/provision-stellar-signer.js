'use strict';

const mongoose = require('mongoose');
const { initializeMasterKey } = require('../src/utils/signerKeyManager');
const { provisionSigner } = require('../src/services/stellarSignerRotation');

async function main() {
  if (!process.env.MONGO_URI || !process.env.STELLAR_BOOTSTRAP_SIGNER_SECRET) {
    throw new Error('MONGO_URI and STELLAR_BOOTSTRAP_SIGNER_SECRET are required');
  }
  await initializeMasterKey();
  await mongoose.connect(process.env.MONGO_URI);
  try {
    const result = await provisionSigner(process.env.STELLAR_BOOTSTRAP_SIGNER_SECRET);
    process.stdout.write(result.upsertedCount ? 'Managed signer provisioned\n' : 'Managed signer already provisioned\n');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch(() => {
  process.stderr.write('Unable to provision managed signer. Check database, key provider, and Stellar account configuration.\n');
  process.exitCode = 1;
});

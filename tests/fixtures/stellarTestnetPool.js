'use strict';

const { Keypair, Horizon, Networks, Operation, TransactionBuilder } = require('@stellar/stellar-sdk');
const StellarHDWallet = require('stellar-hd-wallet').default;
const settings = require('./stellar-accounts.json');

function createStellarTestnetPool(suite) {
  if ((process.env.STELLAR_NETWORK || 'testnet') !== 'testnet') {
    throw new Error('Live Stellar fixtures require Testnet');
  }
  const size = Number(process.env.TEST_STELLAR_POOL_SIZE ?? settings.defaultPoolSize);
  const baseIndex = settings.suiteIndexes[suite];
  if (!Number.isInteger(size) || size < 2 || size > 100 || baseIndex === undefined) {
    throw new Error('A known suite and TEST_STELLAR_POOL_SIZE between 2 and 100 are required');
  }
  const { TEST_STELLAR_MASTER_SECRET, TEST_STELLAR_FIXTURE_MNEMONIC } = process.env;
  if (!TEST_STELLAR_MASTER_SECRET || !TEST_STELLAR_FIXTURE_MNEMONIC) {
    throw new Error('Configure the Testnet master secret and fixture mnemonic');
  }

  const server = new Horizon.Server('https://horizon-testnet.stellar.org');
  const master = Keypair.fromSecret(TEST_STELLAR_MASTER_SECRET);
  const wallet = StellarHDWallet.fromMnemonic(TEST_STELLAR_FIXTURE_MNEMONIC);
  const accounts = Array.from({ length: size }, (_, i) =>
    Keypair.fromSecret(wallet.getSecret(baseIndex + i)));
  if (accounts.some(account => account.publicKey() === master.publicKey())) {
    throw new Error('The master must be separate from the fixture accounts');
  }

  let closed = true;
  let available = [];
  const waiters = [];
  const claimed = new Set();

  async function load(publicKey) {
    try {
      return await server.loadAccount(publicKey);
    } catch (error) {
      if ((error.response?.status ?? error.response?.statusCode) === 404) return null;
      throw error;
    }
  }

  async function submit(source, signer, operations) {
    const builder = new TransactionBuilder(source, {
      fee: String(await server.fetchBaseFee()),
      networkPassphrase: Networks.TESTNET,
    });
    operations.forEach(operation => builder.addOperation(operation));
    const tx = builder.setTimeout(30).build();
    tx.sign(signer);
    await server.submitTransaction(tx);
  }

  async function merge(keypair) {
    const account = await load(keypair.publicKey());
    if (account) {
      await submit(account, keypair, [Operation.accountMerge({ destination: master.publicKey() })]);
    }
  }

  async function cleanup() {
    if (claimed.size || waiters.length) throw new Error('Release fixtures before cleanup');
    closed = true;
    available = [];
    const outcomes = await Promise.allSettled(accounts.map(merge));
    const failures = outcomes.filter(result => result.status === 'rejected');
    if (failures.length) {
      throw new AggregateError(failures.map(result => result.reason), 'Unable to merge Testnet fixtures');
    }
  }

  return {
    async setup() {
      await cleanup();
      for (let attempt = 0; ; attempt += 1) {
        const source = await server.loadAccount(master.publicKey());
        try {
          await submit(source, master, accounts.map(account => Operation.createAccount({
            destination: account.publicKey(), startingBalance: settings.startingBalance,
          })));
          break;
        } catch (error) {
          if (attempt === 4 || error.response?.data?.extras?.result_codes?.transaction !== 'tx_bad_seq') {
            throw error;
          }
        }
      }
      available = [...accounts];
      closed = false;
    },
    async claim() {
      if (closed) throw new Error('Testnet fixture pool is closed');
      // Both removing an available key and registering a waiter are synchronous.
      const keypair = available.shift() || await new Promise(resolve => waiters.push(resolve));
      claimed.add(keypair);
      return keypair;
    },
    release(keypair) {
      if (!claimed.delete(keypair)) throw new Error('Fixture is not claimed');
      const next = waiters.shift();
      if (next) {
        claimed.add(keypair);
        next(keypair);
      } else {
        available.push(keypair);
      }
    },
    cleanup,
  };
}

module.exports = { createStellarTestnetPool };

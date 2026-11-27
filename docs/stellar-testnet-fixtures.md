# Live Stellar Testnet fixtures

Create a dedicated Testnet master account and fund it once using Stellar
Friendbot. Set `TEST_STELLAR_MASTER_SECRET` to its secret and
`TEST_STELLAR_FIXTURE_MNEMONIC` to a dedicated BIP-39 mnemonic. Keep both in
local environment variables or CI secrets. Reuse the mnemonic to reproduce the
same Testnet addresses. Serialize runs that share this mnemonic for the same
suite, or give parallel CI jobs separate mnemonics.

`TEST_STELLAR_POOL_SIZE` defaults to two accounts per suite and supports 2–100.
The integration and payment pipeline suites derive accounts from disjoint
ranges of Stellar SEP-0005 paths. Suite setup merges stale accounts into the
master before creating fresh accounts with the configured starting balance.
Each suite leases its sender and recipient for the duration of its sequential
payment scenarios. The pool hands out each key exclusively and returns funds
to the master by merging the accounts during teardown.

Run the integration suite with `npm run test:integration` from the root.
For the payment pipeline suite, run:

```sh
RUN_TESTNET_E2E_TESTS=true STELLAR_INTEGRATION_TESTS=true \
  npx jest tests/e2e/paymentPipelineTestnet.e2e.test.js --runInBand \
  --testPathIgnorePatterns=/node_modules/ --moduleNameMapper='{}'
```

Both commands use the real HTTP client and an in-memory MongoDB replica set.

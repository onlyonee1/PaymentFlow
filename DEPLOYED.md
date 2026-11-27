# Deployed Contract Versions

This file tracks the currently deployed contract Wasm version and event schema
version per network.  Update it every time a new contract version is deployed.

| Network    | Contract ID (prefix)  | Wasm Version | Event Schema Version | ABI Version | Deployed At          |
|------------|-----------------------|--------------|----------------------|-------------|----------------------|
| testnet    | CCBUSXG7VHO5…         | 1.0.0        | 1                    | 1.0.0       | 2024-01-01T00:00:00Z |

## How to update

After a successful deploy, run:

```bash
node scripts/deploy-contract.js \
  --network testnet \
  --contractId <new-contract-id> \
  --wasmHash <64-char-hex> \
  --abiVersion <semver> \
  --commit
```

Then manually update the table above and add an entry to
`docs/event-schema-changelog.md` if the event schema version changed.

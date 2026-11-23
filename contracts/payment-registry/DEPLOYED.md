# PaymentRegistry — Deployment Record

## Testnet

| Field | Value |
|---|---|
| Network | Stellar Testnet |
| Contract ID | `CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX` (pending CI deploy) |
| Wasm Hash | `0000000000000000000000000000000000000000000000000000000000000000` (pending) |
| Deployed at ledger | (pending) |
| Admin address | (pending — governance multisig) |
| Deploy date | (pending) |

> **Note:** This file is updated automatically by the CI/CD pipeline after a
> successful `soroban contract deploy`. The Wasm hash pins the exact bytecode
> on-chain and must be verified before any upgrade is accepted.

## Canonical USDC Issuers

| Network | Issuer |
|---|---|
| Testnet | `GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5` |
| Mainnet | `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN` |

The canonical issuer is loaded from the `USDC_ISSUER` environment variable at
backend startup and injected into the contract's accepted-asset whitelist via
`add_accepted_asset` during the post-deploy initialisation step.

## Accepted Assets (initial whitelist)

| Asset code | Issuer | Type |
|---|---|---|
| `XLM` | — (native) | native |
| `USDC` | canonical per network (see above) | credit_alphanum4 |

## Governance

Admin rotation is performed via `rotate_admin(new_admin)`, which requires the
current admin's signature. This enables migration to a governance multisig
without redeployment.

Asset whitelist changes require admin authorisation:
- `add_accepted_asset` — add or replace an `(asset_code, issuer)` pair
- `remove_accepted_asset` — remove an asset code from the whitelist

## Events

| Event | Topics | Data |
|---|---|---|
| EscrowCreated | `("escrow", "created")` | `(payment_id, amount)` |
| EscrowReleased | `("escrow", "released")` | `(payment_id, amount, ledger_hash)` |
| EscrowDisputed | `("escrow", "disputed")` | `(payment_id,)` |

## CI/CD Pipeline

The deploy pipeline runs on merge to `main` and:

1. Builds the Wasm: `cargo build --target wasm32-unknown-unknown --release`
2. Optimises: `soroban contract optimize --wasm target/wasm32-unknown-unknown/release/payment_registry.wasm`
3. Deploys: `soroban contract deploy --network testnet --wasm <optimised.wasm>`
4. Updates this file with the resulting contract ID and Wasm hash
5. Runs `tests/contract/` suite against the deployed Testnet contract

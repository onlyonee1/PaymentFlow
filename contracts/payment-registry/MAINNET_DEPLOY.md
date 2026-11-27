# PaymentRegistry mainnet deployment

The Release Lead owns the go/no-go decision. A checked item requires a named sign-off and a linked artifact in the release ticket. Keep the public deployment evidence in [DEPLOYED.md](DEPLOYED.md).

## Release checklist

| Owner | Evidence required before mainnet |
| --- | --- |
| Contract Engineer | Audit the release implementation after replacing the public, first-caller `initialize(admin)` with an atomic `__constructor(admin)`. The current deployment must stop at this gate. The existing initializer allows whoever calls it first to set the admin. |
| Security Engineer | Sign off on the audit and remediation of critical and high findings, constructor authorization, and key ceremony records. |
| Security Program Owner | Open the bug bounty with PaymentRegistry in scope and confirm that an on-call responder receives reports. |
| Senior Engineer A | Review the checklist and approve the release commit and Wasm hash. |
| Senior Engineer B | Independently review the checklist, governance setup and rollback evidence. |
| QA Lead | Attach passing Testnet integration results for the candidate Wasm. Demonstrate admin quorum writes, failure with insufficient signatures, duplicate transaction rejection, and successful reads. |
| Release Engineer | Execute this sequence on Testnet with separate keys. Record the deploy transaction, contract ID, Wasm hash, and timings. Rehearse cutover and demonstrate rollback within 15 minutes. |
| Governance Custodians | Verify the on-chain signer weights and thresholds and the offline custody/recovery records. |
| SRE On-call | Verify write-disable and routing controls, alert delivery, and the ability to reconcile any writes made around cutover. |
| Release Lead | Verify all approvals, deployment window, Testnet evidence, and 24-hour on-call coverage before enabling any mainnet writes. |

## Key ceremony

1. **Security Engineer and Governance Custodians** assemble three independent custodians. Each generates a Stellar-compatible signing key on an approved hardware wallet or HSM and verifies the public key on-device. Use separate Mainnet and Testnet keys. Keep recovery material offline under each custodian's separate access controls. Record public keys, device identifiers, custody ownership, and witness attestations.
2. **Release Engineer and Governance Custodians** fund the dedicated governance account for signer reserves and operational fees. Use Stellar Set Options to add the three signers with weight 1. Set the low, medium and high thresholds to 2. Verify control by signing a Testnet governance transaction with two custodians before rehearsing removal of the bootstrap master weight. For Mainnet, verify each configured public key against the device, then set master weight to 0 and confirm the accepted transaction and final account state.
3. **Security Engineer** reviews the transaction network, sequence, destination and signer weights from independently decoded XDR before each relevant signature. For contract writes, the quorum signs the same simulated transaction envelope from the governance source account. If the invocation uses separate Soroban address authorization, gather the required authorization signatures using the workflow rehearsed on Testnet.
4. **SRE On-call** confirms the online deployer is a separate fee-paying account. Record the signers, thresholds, governance address and approval reference. Store signing material only in the devices and approved offline recovery stores.

[Stellar accounts and authorization](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts)

## Deployment and cutover

The Release Engineer uses the pinned CLI and reviewed release artifact. Use Testnet first and the `mainnet` network alias only after the Release Lead approves. Check the RPC endpoint and network passphrase for the selected alias. The deployment command applies to the candidate with the reviewed atomic constructor described above.

```sh
cd contracts/payment-registry
stellar --version
stellar contract build
WASM=target/wasm32v1-none/release/payment_registry.wasm
sha256sum "$WASM"

NETWORK=testnet
# Set DEPLOYER to the funded CLI identity and ADMIN to the governance G-address.
: "${DEPLOYER:?set the funded deployer identity}"
: "${ADMIN:?set the governance account address}"

WASM_HASH=$(stellar contract upload --network "$NETWORK" --source "$DEPLOYER" --wasm "$WASM")
CONTRACT_ID=$(stellar contract deploy --network "$NETWORK" --source "$DEPLOYER" \
  --wasm-hash "$WASM_HASH" -- --admin "$ADMIN")

stellar contract invoke --network "$NETWORK" --source "$DEPLOYER" \
  --id "$CONTRACT_ID" -- get_admin
stellar contract invoke --network "$NETWORK" --source "$DEPLOYER" \
  --id "$CONTRACT_ID" -- get_total_count
```

1. **Release Engineer** compares the on-chain Wasm hash to the reviewed file digest and the upload result. Verify the deployment transaction via Stellar RPC `getTransaction` and confirm success, the contract ID, and the ledger sequence. Record the deployment transaction ID, Wasm hash, commit, governance address, network, and ledger in [DEPLOYED.md](DEPLOYED.md).
2. **QA Lead** verifies `get_admin` returns the governance address and `get_total_count` returns zero for a fresh instance. Complete the Testnet quorum write checks before repeating the procedure on Mainnet. Mainnet smoke checks use read-only calls with writes paused.
3. **Release Engineer** submits the reviewed network-keyed entry in `contracts/registry.json`. Record the contract ID, Wasm hash and deployment transaction, and verify consuming application configuration resolves the same instance. Save the previous configuration and write-disable control in the release ticket.
4. **SRE On-call** confirms alert delivery with an operational drill, then monitors RPC errors, authorization failures, failed writes, ledger lag and storage TTL. The **Release Lead** authorizes a canary write rollout after read-only verification and owns the 24-hour follow-up.

[Stellar CLI Wasm upload](https://developers.stellar.org/docs/tools/cli/cookbook/upload-wasm) · [Soroban constructor behavior](https://developers.stellar.org/docs/learn/fundamentals/contract-development/contract-interactions/cross-contract)

## First 24 hours and rollback

The **Incident Commander** starts the 15-minute clock when a critical issue is declared.

| Deadline | Owner | Action |
| --- | --- | --- |
| 0–3 min | SRE On-call | Disable registry writes in dependent applications, pause writers and deployment automation, and page the Incident Commander and Security Engineer. Keep read access only if the incident permits it. |
| 3–8 min | Release Engineer | Restore the previously rehearsed application routing and registry configuration. For a first deployment, keep the contract integration disabled and restore the previous application workflow. |
| 8–12 min | SRE On-call | Verify restored application health and confirm no writers still target the affected instance. Check that alerting and queues remain active. |
| 12–15 min | Incident Commander | Declare containment or escalate. Preserve transaction hashes, ledger sequences, queue state, and logs. Keep replay disabled until reconciliation is approved. |

Stellar transactions already finalized remain on-chain. This contract implements no on-chain pause or upgrade method. Application rollback stops application traffic. The **Security Engineer** assesses residual exposure from direct on-chain calls. The **Contract Engineer** reconciles accepted payment registrations against the payment system before proposing replay or migration. The **Release Lead** requires a new reviewed deployment before restoring registry writes.

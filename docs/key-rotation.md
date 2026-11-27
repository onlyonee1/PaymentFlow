# Signer Key Rotation Runbook

**Component:** Contract signer key — the Stellar Ed25519 keypair that authorises
contract invocations (escrow create, release, refund, dispute, resolve, pause, upgrade).  
**Severity:** Critical — a compromised signer key can drain escrow funds or
block all contract operations.  
**Closes:** [#311](https://github.com/onlyonee1/PaymentFlow/issues/311)

---

## Overview

The contract signer key is the Stellar keypair whose **public key** is
registered on the contract as an authorised signer and whose **secret key** is
held by the platform.  Unlike the `SIGNER_MASTER_KEY` (which only encrypts
stored keys at rest), the contract signer key is the actual signing credential
submitted to the Stellar network on every contract operation.

Rotation replaces the active keypair without interrupting contract availability:

1. Generate a new keypair.
2. Register the **new** public key on the contract alongside the old one
   (dual-key grace period).
3. Verify the new key can sign a test invocation successfully.
4. Remove the **old** public key from the contract.
5. Persist the new encrypted secret and record the event in the audit log.

---

## Prerequisites

- [ ] Two separate operators are available to provide approval tokens
      (see [Dual-Approval](#dual-approval-requirement)).
- [ ] You have admin API access and a valid JWT for the target environment.
- [ ] `SIGNER_MASTER_KEY` is set in the deployment secret store — the
      rotation script encrypts the new secret under this key.
- [ ] The Stellar CLI or Horizon access is available for contract
      operations in step 2 / step 4.
- [ ] The incident or change-management ticket number is ready (used as
      `reason` in the audit log).

---

## Dual-Approval Requirement

Signer key rotation is a privileged operation that **requires two operator
approvals** before the script will persist any changes.

Each operator generates a time-limited HMAC token:

```bash
# Operator 1
APPROVAL_SECRET=<shared-ops-secret> \
  node scripts/rotate-signer-key.js --generate-approval \
  --operator "alice@example.com" --reason "INC-4321 key compromise"

# Operator 2
APPROVAL_SECRET=<shared-ops-secret> \
  node scripts/rotate-signer-key.js --generate-approval \
  --operator "bob@example.com" --reason "INC-4321 key compromise"
```

Both tokens are passed to the `--apply` invocation (see
[Rotation Procedure](#rotation-procedure) step 3).  Tokens expire after
**15 minutes**.  If either token is invalid or expired the script aborts
without making any changes.

---

## Rotation Procedure

### Step 0 — Dry run (always run first)

```bash
SIGNER_MASTER_KEY=<current master key> \
  node scripts/rotate-signer-key.js
```

The script prints what it *would* do without touching the database or the
contract.  Review the output and confirm:

- The current signer key is detected correctly.
- The generated new keypair looks valid (starts with `G...` / `S...`).
- No unexpected schools or contract addresses appear in the output.

### Step 1 — Generate approval tokens

Both operators run the `--generate-approval` command shown in
[Dual-Approval](#dual-approval-requirement).  Share tokens out-of-band
(never in the same Slack channel as the `--apply` command).

### Step 2 — Register the new key on the contract

Before removing the old key, add the new public key to the contract's
authorised-signer list.  This is a Stellar transaction:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR_SECRET> \
  --network <testnet|mainnet> \
  -- add_signer \
  --new_signer <NEW_PUBLIC_KEY>
```

Wait for the transaction to be confirmed (≥ `CONFIRMATION_THRESHOLD` ledgers).

### Step 3 — Apply the rotation

```bash
SIGNER_MASTER_KEY=<current master key> \
  node scripts/rotate-signer-key.js \
  --apply \
  --approval1 "<token from operator 1>" \
  --approval2 "<token from operator 2>" \
  --reason "INC-4321 scheduled rotation"
```

The script will:

1. Validate both approval tokens.
2. Generate (or accept `--new-secret`) a new Stellar keypair.
3. Encrypt the new secret under `SIGNER_MASTER_KEY`.
4. Write `CONTRACT_SIGNER_KEY` (public) and `CONTRACT_SIGNER_SECRET_ENCRYPTED`
   (ciphertext) to the database for each affected school.
5. Emit an `contract_signer_key_rotated` audit log entry with operator
   identities, old public key (last 8 chars), new public key, and timestamp.

### Step 4 — Verify the new key

Run a low-stakes contract invocation signed with the **new** key to confirm
it is accepted by the network:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <NEW_KEYPAIR_SECRET> \
  --network <testnet|mainnet> \
  -- ping
```

Expect `SUCCESS`.  If it fails, **do not remove the old key** — diagnose
first (wrong network, insufficient signers, contract version mismatch).

### Step 5 — Remove the old key from the contract

Only after step 4 succeeds:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <ADMIN_KEYPAIR_SECRET> \
  --network <testnet|mainnet> \
  -- remove_signer \
  --old_signer <OLD_PUBLIC_KEY>
```

### Step 6 — Update the deployment secret store

Update `CONTRACT_SIGNER_KEY` and (if applicable) any secret reference in
your vault / Kubernetes secret to point to the new public key.  Remove any
`CONTRACT_SIGNER_KEY_OLD` entries.

### Step 7 — Redeploy

Perform a rolling redeploy so API and worker pods pick up the new secret.
Monitor the health check (`GET /health`) and error logs during the rollout.

---

## Recovery Procedure for a Compromised Key

> Use this path when the current signer key is believed to be leaked or
> already in the hands of an attacker.

1. **Freeze contract operations immediately.**  Set `SIGNER_KEY_FROZEN=true`
   in the deployment to block new contract invocations while the key is hot.

2. **Escalate.**  Page the on-call security lead and open a P0 incident ticket.
   Record the ticket number — it becomes the `reason` for all audit log entries.

3. **Follow steps 2–7 of the Rotation Procedure above**, skipping the dry run
   (time is critical) and using `--force` to bypass the 15-minute approval
   token window:

   ```bash
   SIGNER_MASTER_KEY=<current master key> \
     node scripts/rotate-signer-key.js \
     --apply \
     --force \
     --approval1 "<token>" \
     --approval2 "<token>" \
     --reason "P0 INC-9999 key compromise"
   ```

4. **Revoke the old key from any external systems** (CI/CD secrets,
   Kubernetes Secrets, any vault that stored it).

5. **Audit on-chain activity** for the old key in the 24 hours before
   detection.  Use Stellar Explorer or Horizon:

   ```bash
   curl "https://horizon.stellar.org/accounts/<OLD_PUBLIC_KEY>/operations?order=desc&limit=100"
   ```

   Look for unexpected `invoke_host_function` operations.  Record findings
   in the incident ticket.

6. **Unfreeze** once the new key is confirmed working and the old key is
   fully revoked:  `SIGNER_KEY_FROZEN=false` + rolling redeploy.

7. Complete a post-incident review within 48 hours.

---

## Audit Log

Every rotation (dry run excluded) writes to the immutable audit log:

```json
{
  "action": "contract_signer_key_rotated",
  "actor": {
    "operator1": "alice@example.com",
    "operator2": "bob@example.com"
  },
  "details": {
    "oldKeyPrefix": "GCOLD...",
    "newKeyPrefix": "GNEW...",
    "reason": "INC-4321 scheduled rotation",
    "environment": "production",
    "forced": false
  },
  "createdAt": "2026-10-20T23:41:02.354Z"
}
```

Entries are retained for `AUDIT_LOG_RETENTION_DAYS` (default 730 days) and
can be queried via `GET /api/audit?action=contract_signer_key_rotated`.

---

## Budget Ceilings (contract resource limits)

The signer key is used for all Soroban operations.  Keep resource consumption
within these ceilings to avoid mid-rotation failures (see
[`tests/contract-budget.test.js`](../tests/contract-budget.test.js)):

| Operation | CPU instructions | Memory (bytes) | Ledger entries |
|-----------|-----------------|----------------|----------------|
| `create`  | < 800 000        | < 2 MB         | ≤ 5            |
| `release` | < 800 000        | < 2 MB         | ≤ 3            |
| `refund`  | < 800 000        | < 2 MB         | ≤ 3            |
| `dispute` | < 600 000        | < 1 MB         | ≤ 2            |
| `resolve` | < 800 000        | < 2 MB         | ≤ 4            |
| `pause`   | < 400 000        | < 512 KB       | ≤ 2            |
| `upgrade` | < 1 000 000      | < 4 MB         | ≤ 6            |

---

## Related Documents

- [`docs/security.md`](security.md) — full threat model
- [`docs/operator-runbooks.md`](operator-runbooks.md) — general key-rotation section
- [`docs/runbooks/wallet-rotation.md`](runbooks/wallet-rotation.md) — school wallet rotation
- [`scripts/rotate-signer-key.js`](../scripts/rotate-signer-key.js) — the automation script
- [`scripts/rotate-signer-master-key.js`](../scripts/rotate-signer-master-key.js) — master key rotation

## Live Stellar account signer rotation

This ceremony replaces a Stellar account signing key. The existing master
encryption key rotation scripts rotate the key that encrypts stored seeds.

### Set up once

1. Set `STELLAR_MANAGED_SIGNER_ACCOUNT` to the stable Stellar source account
   on all backend replicas. Use a dedicated funded sequence and fee account
   for rotation and configure its secret as
   `STELLAR_ROTATION_FEE_SOURCE_SECRET`. It must differ from the managed
   account and must remain stable during an active ceremony.
2. Run `node backend/scripts/provision-stellar-signer.js` with the same
   database, network, and signer encryption configuration as the backend,
   passing the current signing seed as `STELLAR_BOOTSTRAP_SIGNER_SECRET`
   through your secret manager. The provisioner validates on-chain signer
   weight and only inserts initial state. Keep this seed out of the backend
   runtime environment.
3. Use `createTransactionManager()` for server-signed operations on this
   account. It resolves the active signer at signature time and leaves the
   source account unchanged. The account needs sufficient reserve to add
   one signer, and the current signer must independently meet all thresholds.

### Rotate

1. A superadmin calls `POST /api/admin/rotate-signer`. HTTP 202 means the
   encrypted replacement has been staged. The response lists its public key.
2. The leader adds the new signer at the previous signer's weight and waits
   for Horizon to show the new signer before activating it. Set Options runs
   from the separate fee account, preserving the payment account's sequence.
3. During the overlap, the old public key remains valid for previously
   signed envelopes. The default window is 15 minutes. Set
   `KEY_ROTATION_WINDOW_MINUTES` consistently across replicas and keep
   managed transaction lifetimes at least 30 seconds shorter than the window.
4. The leader removes the old signer after the deadline. If it was the
   account's master signer, the leader sets its weight to zero. Thresholds
   stay unchanged. The backend keeps the previous public key only until
   it observes retirement on chain.

Use Horizon to verify that the new key is authorized and the old weight is
zero. The backend resumes unfinished steps from MongoDB after restart or
leader failover. A ceremony exceeding the one-hour incident target needs
operator investigation. Check leader status, Horizon, fee balance, account
reserve, and the public signer weights. Keep the state document so the worker
can reconcile on-chain submissions.

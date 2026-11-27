# Contract Event Schema for Indexing

This specification documents the event schema and indexing requirements for PaymentFlow escrow and smart contracts.

---

## 1. Overview & Objectives

Off-chain services, reconcilers, and indexers require a predictable, versioned stream of contract events to track payments and rebuild projections without relying on raw, untyped ledger data.

Key objectives:
- **Idempotency**: Indexers must be able to process identical events multiple times without producing duplicate state mutations.
- **Correlation**: Every event links back to the originating off-chain entity (student ID, payment intent, or operation ID).
- **Projection Rebuilding**: A complete projection of student balances, escrow holdings, and dispute statuses can be rebuilt purely from replaying historical events.
- **Versioning & Compatibility**: Strict schema versioning ensuring backward and forward compatibility.

---

## 2. Event Envelope Structure

Every emitted event conforms to a standardized envelope:

```json
{
  "eventId": "<txHash>:<topic>:<index>",
  "eventVersion": "1.0.0",
  "topic": "deposit | release | refund | dispute",
  "contractId": "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5",
  "ledger": 1234567,
  "txHash": "a1b2c3d4e5f6...",
  "timestamp": "2026-09-27T12:00:00.000Z",
  "correlationId": "op_release_001",
  "payload": { ... }
}
```

---

## 3. Topic Payloads

### 3.1 `deposit`
Emitted when funds are locked into escrow for a student.
- `payer`: Stellar public key of the depositor / parent.
- `studentId`: Student identifier.
- `schoolId`: School tenant identifier.
- `asset`: `{ code, type, issuer }`.
- `amountStroops`: Exact integer stroops as a string/number.
- `amountDecimal`: Exact 7-decimal representation string.
- `memo`: Stellar memo text.

### 3.2 `release`
Emitted when escrowed funds are released to the school.
- `beneficiary`: School wallet destination.
- `studentId`: Student identifier.
- `schoolId`: School tenant identifier.
- `asset`: `{ code, type, issuer }`.
- `amountStroops`: Released amount in stroops.
- `amountDecimal`: Human-readable 7-decimal string.
- `authorizedBy`: Operator or contract administrator address.

### 3.3 `refund`
Emitted when funds are refunded back to the payer.
- `recipient`: Destination refund wallet address.
- `studentId`: Student identifier.
- `schoolId`: School tenant identifier.
- `asset`: `{ code, type, issuer }`.
- `amountStroops`: Refund amount in stroops.
- `amountDecimal`: Human-readable 7-decimal string.
- `reason`: Explanation for refund.
- `authorizedBy`: Authorizing identity.

### 3.4 `dispute`
Emitted when a dispute is opened, updated, or settled.
- `disputeId`: Unique dispute identifier.
- `studentId`: Student identifier.
- `schoolId`: School tenant identifier.
- `initiator`: Dispute filer address.
- `status`: `'opened'` | `'under_review'` | `'resolved_refund'` | `'resolved_release'` | `'dismissed'`.
- `amountStroops`: Disputed amount in stroops.
- `amountDecimal`: 7-decimal string.
- `reason`: Dispute grounds.

---

## 4. Idempotent Indexer Guidelines

Indexers maintaining projections must:
1. Maintain a persistent set or index of processed `eventId` values.
2. If `eventId` is already present in the store, acknowledge the event immediately as a no-op without mutating projection balances.
3. Validate `eventVersion` — reject unsupported major versions while tolerating additive non-breaking fields in minor/patch versions.

## Payment Registry batch fees

`POST /api/payments/batch-intent` accepts `studentId`, the payer's Stellar
public key as `payer`, and 1–10 distinct `feeIds` (the student's fee category
identifiers). Include the school context and an idempotency key. The response
contains intent IDs, their amounts, the transaction hash, and unsigned XDR.
The payer signs the XDR and submits it to the configured Soroban network.
To record the payment, call `POST /api/payments/batch-confirm` in the same
school context with the original `txHash` and its inclusion `ledger`. Retry
while it returns HTTP 202. This flow requires `PAYMENT_REGISTRY_CONTRACT_ID`,
`SOROBAN_RPC_URL`, and transactional MongoDB.

A successful registry invocation emits one contract event with topics
`["registry", "PaymentsBatchRegistered"]`. Its data map contains
`schemaVersion: 1`, `payment_ids`, `payments` (each containing
`payment_id` and `amount_stroops`), `payer`, `recipient`, and `asset`.
Amounts are i128 stroops. The backend checks every item against the original
batch intent and expected XLM asset contract before crediting the fees. It
retains the shared ledger hash as `transactionHash` on each resulting
payment record.

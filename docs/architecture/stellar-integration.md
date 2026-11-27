# Stellar/Soroban Integration Architecture

This document describes the complete integration between PaymentFlow and the Stellar blockchain, including sequence diagrams for all major flows, the Horizon polling design, Soroban contract interaction, and the payment data model.

> **Read-only integration.** The backend never holds or touches the school's Stellar private key. It only reads transactions from the public Horizon API, validates them, and records metadata in MongoDB.

---

## Table of Contents

- [1. Overview](#1-overview)
- [2. Happy Path: Payment Intent to On-Chain Confirmation](#2-happy-path-payment-intent-to-on-chain-confirmation)
  - [2.1 XLM Native Payment](#21-xlm-native-payment)
  - [2.2 USDC Asset Payment](#22-usdc-asset-payment)
- [3. Error Paths](#3-error-paths)
  - [3.1 Horizon Submission Failure and Retry](#31-horizon-submission-failure-and-retry)
  - [3.2 Polling Backoff on Horizon Errors](#32-polling-backoff-on-horizon-errors)
  - [3.3 Reorg and Stale Confirmation Handling](#33-reorg-and-stale-confirmation-handling)
  - [3.4 Distributed Lock Contention](#34-distributed-lock-contention)
- [4. Horizon Polling Design](#4-horizon-polling-design)
  - [4.1 Cursor Management](#41-cursor-management)
  - [4.2 Distributed Lock and Fencing Tokens](#42-distributed-lock-and-fencing-tokens)
  - [4.3 Back-off Policy](#43-back-off-policy)
  - [4.4 Rate Limiting and Budget](#44-rate-limiting-and-budget)
- [5. Soroban Contract Interaction](#5-soroban-contract-interaction)
  - [5.1 Contract Authorization Flow](#51-contract-authorization-flow)
  - [5.2 Contract Asset Validation Flow](#52-contract-asset-validation-flow)
  - [5.3 Contract Event Schema](#53-contract-event-schema)
  - [5.4 Replay Protection](#54-replay-protection)
- [6. Asset Support: XLM and USDC](#6-asset-support-xlm-and-usdc)
- [7. Data Model](#7-data-model)

---

## 1. Overview

PaymentFlow uses the Stellar Horizon REST API as the authoritative source of payment data. The backend polls school wallet accounts for new transactions, extracts the student ID from the transaction memo, validates the payment amount against the configured fee, then atomically records the payment in MongoDB and fires outbound webhooks and SSE events.

The Soroban contract layer (`backend/src/services/contract*.js`) provides the authorization rules, asset validation logic, and event schemas used both on-chain and off-chain to ensure consistent, auditable behaviour across both environments.

```
Parent Wallet ──► Stellar Network ──► School Wallet
                                           │
                                   Horizon Polling
                                           │
                                    Backend Services
                                    ┌──────┴──────┐
                                  MongoDB     Webhooks / SSE
```

---

## 2. Happy Path: Payment Intent to On-Chain Confirmation

### 2.1 XLM Native Payment

```mermaid
sequenceDiagram
    actor Parent
    participant FE as Frontend
    participant BE as Backend API
    participant DB as MongoDB
    participant SN as Stellar Network
    participant HZ as Horizon API
    participant PS as PollingService
    participant WH as WebhookService
    participant SC as School Webhook

    Parent->>FE: Navigate to payment page
    FE->>BE: POST /api/payments/intent\n{studentId, schoolId}
    BE->>DB: Create PaymentIntent\n(TTL: 24 h)
    DB-->>BE: intentId saved
    BE-->>FE: {walletAddress, memo: "STU001",\namount: 250 XLM, intentId}
    FE-->>Parent: Show QR code / payment instructions

    Note over Parent,SN: Parent sends XLM with memo "STU001"
    Parent->>SN: submit tx (from: parentWallet,\nto: schoolWallet, amount: 250 XLM,\nmemo: STU001)
    SN-->>Parent: tx hash (confirmed in ~5 s)

    loop Every SYNC_INTERVAL_MS (default 60 s)
        PS->>DB: Load school records + syncCursor
        PS->>HZ: GET /accounts/{schoolWallet}/transactions\n?cursor={syncCursor}&order=asc&limit=200
        HZ-->>PS: Transaction page (may include our tx)
        PS->>PS: extractValidPayment(tx, walletAddress)\ndetectAsset() → XLM native\nnormalizeAmount() → 250.0000000
        PS->>PS: validatePaymentAgainstFee(250, expectedFee)
        PS->>HZ: GET /ledgers/{txLedger+2} (confirmation check)
        HZ-->>PS: latestLedgerSequence
        PS->>PS: determineConfirmationState()\n→ state: "confirmed"
        PS->>DB: Acquire studentBalanceLock (Redis SET NX)
        PS->>DB: session.withTransaction()\n  Save Payment {txHash, state: confirmed}\n  Update Student.remainingBalance
        DB-->>PS: committed
        PS->>DB: Advance syncCursor
        PS->>WH: emit paymentSaved event
    end

    WH->>DB: Load school webhookUrl + secret
    WH->>SC: POST webhookUrl\n{event: "payment.confirmed", txHash, studentId, amount}
    SC-->>WH: 200 OK

    PS->>FE: SSE event: payment_confirmed\n{studentId, txHash, amount}
    FE-->>Parent: "Payment confirmed ✓"
```

### 2.2 USDC Asset Payment

USDC payments add an issuer validation step before acceptance. The issuer address is pinned per network in `stellarConfig.js` (Circle's canonical USDC issuer on testnet/mainnet).

```mermaid
sequenceDiagram
    actor Parent
    participant BE as Backend API
    participant HZ as Horizon API
    participant PS as PollingService
    participant CV as ContractAssetValidation
    participant DB as MongoDB
    participant WH as WebhookService

    Note over Parent,BE: School configured with ACCEPTED_ASSET=USDC

    Parent->>BE: POST /api/payments/intent {studentId}
    BE-->>Parent: {walletAddress, memo: "STU001",\namount: 25.00 USDC, assetCode: "USDC"}

    Note over Parent,HZ: Parent sends USDC with memo, adds trustline first
    Parent->>HZ: submit ChangeTrust op (asset: USDC, issuer: GA5ZS...)
    Parent->>HZ: submit payment op (USDC, 25.0, memo: STU001)

    PS->>HZ: GET transactions for schoolWallet
    HZ-->>PS: tx with asset_code=USDC, asset_issuer=GA5ZS...

    PS->>CV: isAcceptedAsset("USDC", "credit_alphanum4",\n"GA5ZS...")
    CV->>CV: Check asset.type === "credit_alphanum4"
    CV->>CV: Check asset.issuer === pinnedIssuer
    alt Issuer matches
        CV-->>PS: {accepted: true, asset: USDC}
        PS->>CV: validateContractAsset(parsed)\n+ validateContractAmount(25.0)
        CV-->>PS: {valid: true, stroops: 250000000n}
        PS->>DB: Save Payment (USDC, confirmed)
        PS->>WH: emit paymentSaved
    else Issuer mismatch (rogue USDC token)
        CV-->>PS: {accepted: false, reason: "issuer_mismatch"}
        PS-->>PS: skip tx (log warning: spoofed asset)
    end
```

---

## 3. Error Paths

### 3.1 Horizon Submission Failure and Retry

When a payment verification fails (e.g. Horizon is unreachable, tx not found), the system enqueues a retry job with exponential backoff via BullMQ (or MongoDB fallback).

```mermaid
sequenceDiagram
    participant BE as Backend API
    participant HZ as Horizon API
    participant RQ as RetryQueue (BullMQ)
    participant DB as MongoDB
    participant DLQ as Dead Letter Queue

    BE->>HZ: verifyTransaction(txHash)
    HZ-->>BE: 503 Service Unavailable / timeout

    BE->>RQ: enqueue job {txHash, attempt: 1}
    Note over RQ: delay = INITIAL_RETRY_DELAY_MS * (RETRY_BACKOFF_MULTIPLIER ^ attempt)
    Note over RQ: jitter = delay * RETRY_JITTER_RATIO

    loop Up to MAX_RETRY_ATTEMPTS (default: 10)
        RQ->>HZ: verifyTransaction(txHash)
        alt Horizon responds
            HZ-->>RQ: tx data
            RQ->>DB: recordPayment()
            RQ-->>BE: job complete
        else Still failing
            RQ->>RQ: re-enqueue with doubled delay\n(cap: MAX_RETRY_DELAY_MS = 1 h)
        end
    end

    Note over RQ,DLQ: After MAX_RETRY_ATTEMPTS exceeded
    RQ->>DLQ: move job to DLQ\n(retained for DLQ_MAX_AGE_MS = 7 days)
    DLQ-->>BE: admin can inspect / requeue via\nGET /api/payments/dlq
```

### 3.2 Polling Backoff on Horizon Errors

```mermaid
sequenceDiagram
    participant PS as PollingService
    participant HZ as Horizon API
    participant EB as BackoffState

    loop Polling cycle
        PS->>HZ: paginate transactions
        alt Horizon OK
            HZ-->>PS: transactions
            PS->>EB: _markPollSuccess()\n→ consecutiveErrors=0\n→ currentIntervalMs=SYNC_INTERVAL_MS
        else Horizon 429 / error
            HZ-->>PS: error
            PS->>EB: _markPollFailure()\n→ consecutiveErrors++\n→ currentIntervalMs = min(\n    currentIntervalMs * 2,\n    POLL_MAX_BACKOFF_MS\n  )
            Note over EB: horizonUnreachableSince set on first failure
            PS->>PS: skip remaining schools this cycle
        end
        PS->>PS: setTimeout(next cycle, currentIntervalMs)
    end
```

### 3.3 Reorg and Stale Confirmation Handling

Stellar has deterministic finality (no true reorgs), but the system uses a multi-stage confirmation state machine to guard against premature confirmation of transactions that are still close to the ledger tip.

```mermaid
sequenceDiagram
    participant PS as PollingService
    participant HZ as Horizon API
    participant SM as ConfirmationStateMachine
    participant DB as MongoDB

    PS->>HZ: GET /ledgers (latestLedgerSequence)
    HZ-->>PS: latest = 5000

    Note over SM: Payment tx is at ledger 4999
    PS->>SM: determineConfirmationState(\n  txLedger=4999, latestLedger=5000\n)
    SM->>SM: delta = 5000 - 4999 = 1
    SM->>SM: delta < CONFIRMATION_THRESHOLD (2)\n→ state = "detected"
    SM-->>PS: {state: "detected", changed: true}

    Note over PS: Next poll cycle, latest = 5003
    PS->>SM: determineConfirmationState(\n  txLedger=4999, latestLedger=5003\n)
    SM->>SM: delta = 4 >= CONFIRMATION_THRESHOLD (2)\n→ state = "confirmed"
    SM-->>PS: {state: "confirmed", changed: true}
    PS->>DB: update Payment.confirmationState = "confirmed"

    Note over PS: Background finalizeConfirmedPayments() job
    PS->>DB: find payments where state in\n[detected, pending, confirmed]
    DB-->>PS: payments
    PS->>HZ: GET /ledgers (latestLedger = 5015)
    PS->>SM: determineConfirmationState(\n  txLedger=4999, latestLedger=5015\n)
    SM->>SM: delta = 16 >= FINALIZATION_THRESHOLD (10)\n→ state = "finalized"
    PS->>DB: update Payment.confirmationState = "finalized"
```

### 3.4 Distributed Lock Contention

In a horizontally-scaled deployment, multiple replicas race to poll the same school. Only one wins; the others skip the cycle without error.

```mermaid
sequenceDiagram
    participant R1 as Replica 1
    participant R2 as Replica 2
    participant RD as Redis
    participant HZ as Horizon API
    participant DB as MongoDB

    par Replica 1 polling cycle
        R1->>RD: SET sync:lock:SCH001 token1 NX PX 60000
        RD-->>R1: OK (lock acquired, fencingToken=42)
        R1->>R1: startWatchdog() — renews lock every 30s
        R1->>HZ: paginate transactions
        HZ-->>R1: transactions
        R1->>RD: getCurrentFence(sync:lock:SCH001)
        RD-->>R1: 42 (matches — not stale)
        R1->>DB: save payments, advance cursor
        R1->>RD: DEL sync:lock:SCH001 (release)
    and Replica 2 polling cycle (concurrent)
        R2->>RD: SET sync:lock:SCH001 token2 NX PX 60000
        RD-->>R2: nil (lock already held by R1)
        R2-->>R2: skip cycle\n{lockSkipped: true}
    end

    Note over R1,DB: Unique index on Payment.txHash is the\nauthoritative dedup guard if lock ever expires mid-poll
```

---

## 4. Horizon Polling Design

### 4.1 Cursor Management

The poller stores a `paging_token` cursor per school in MongoDB (`school.syncCursor`). On each cycle it resumes ascending from that cursor, so it never replays history from genesis and never misses transactions between cycles.

```mermaid
flowchart TD
    A([Poll cycle starts]) --> B{syncCursor set?}
    B -- No --> C[Start from oldest tx\nor last 24 h window]
    B -- Yes --> D[Resume from syncCursor]
    C --> E
    D --> E[GET /accounts/wallet/transactions\n?cursor=syncCursor&order=asc&limit=batchSize]
    E --> F{Page has transactions?}
    F -- Yes --> G[Process each tx]
    G --> H[Advance cursor to tx.paging_token]
    H --> I{More pages AND\nbudget remaining?}
    I -- Yes --> E
    I -- No --> J[Persist final cursor to MongoDB]
    F -- No --> J
    J --> K([Cycle complete])
```

Cursor is advanced over **every** examined transaction — processed or skipped — so a gap in valid payments never stalls progress.

### 4.2 Distributed Lock and Fencing Tokens

```
Lock key:  sync:lock:{schoolId}
TTL:       SYNC_LOCK_TTL_MS (default: 60 s)
Watchdog:  renews every TTL/2 while poll is in progress
Fencing:   Redis INCR on acquire; stored with lock value;
           compared before writing to DB — stale worker writes rejected
```

The unique index on `Payment.txHash` remains the authoritative dedup guard even if a lock expires mid-poll and two workers briefly overlap.

### 4.3 Back-off Policy

```mermaid
stateDiagram-v2
    [*] --> Normal: startup
    Normal --> Error: Horizon failure
    Error --> BackingOff: _markPollFailure()
    BackingOff --> BackingOff: each failure doubles interval\n(cap: POLL_MAX_BACKOFF_MS)
    BackingOff --> Normal: _markPollSuccess()\nresets consecutiveErrors=0\nresets interval=SYNC_INTERVAL_MS
    Normal --> Normal: successful poll
```

`horizonUnreachableSince` is set on the first failure in a run and cleared on recovery, allowing the system to log total outage duration.

### 4.4 Rate Limiting and Budget

Two mechanisms prevent overloading Horizon:

| Mechanism | Location | Purpose |
|-----------|----------|---------|
| `HorizonPollBudget` | `horizonPollBudget.js` | Caps total Horizon pages per interval across all schools; recalculated each cycle based on `SYNC_INTERVAL_MS` and replica count |
| `stellarRateLimitedClient` | `stellarRateLimitedClient.js` | Bottleneck queue with `STELLAR_RATE_LIMIT_MIN_TIME` spacing, `STELLAR_RATE_LIMIT_MAX_CONCURRENT` concurrency, circuit breaker via `horizonFailoverClient.js` |

Queue backpressure: if the BullMQ processing queue depth exceeds `QUEUE_BACKPRESSURE_HIGH_WATER` (default: 800 jobs), `pollSchoolTransactions` skips the cycle rather than adding more load. It resumes when depth drops below `QUEUE_BACKPRESSURE_LOW_WATER` (default: 500).

---

## 5. Soroban Contract Interaction

The contract layer (`backend/src/services/contract*.js`) mirrors the on-chain Soroban contract rules in JavaScript so the backend can validate authorizations, assets, and events without an on-chain call for every payment.

### 5.1 Contract Authorization Flow

Defined in `contractAuthorizationPolicy.js`. Five roles: `OWNER`, `OPERATOR`, `PAYER`, `BENEFICIARY`, `UNAUTHORIZED`.

```mermaid
sequenceDiagram
    participant C as Caller
    participant AP as AuthPolicy
    participant ACM as AccessControlMatrix

    C->>AP: evaluateAuthorization({action, role,\nactor, isPaused, resourceOwner})

    AP->>AP: Check isPaused
    alt Contract paused
        AP->>AP: action == UNPAUSE && role == OWNER?
        alt Yes
            AP-->>C: {authorized: true}
        else No
            AP-->>C: {authorized: false,\ncode: CONTRACT_PAUSED}
        end
    end

    AP->>ACM: ROLE_PERMISSIONS[action]
    ACM-->>AP: allowedRoles[]

    AP->>AP: role in allowedRoles?
    alt Not in allowed roles
        AP-->>C: {authorized: false,\ncode: UNAUTHORIZED_ROLE}
    end

    AP->>AP: action == DISPUTE && role == PAYER?
    alt Cross-resource dispute check
        AP->>AP: actor !== resourceOwner?
        alt Different owner
            AP-->>C: {authorized: false,\ncode: RESOURCE_ACCESS_DENIED}
        end
    end

    AP-->>C: {authorized: true}
```

**Access control matrix summary:**

| Action | Allowed Roles |
|--------|--------------|
| `initialize` | OWNER |
| `deposit` | PAYER, OWNER |
| `release` | OPERATOR, OWNER |
| `refund` | OPERATOR, OWNER |
| `dispute` | PAYER (own resource), OPERATOR, OWNER |
| `resolveDispute` | OPERATOR, OWNER |
| `pause` | OPERATOR, OWNER |
| `unpause` | OWNER |
| `updateConfig` | OWNER |
| `rotateSigner` | OWNER |

### 5.2 Contract Asset Validation Flow

Defined in `contractAssetValidation.js`. Enforces strict issuer pinning for credit assets and exact stroop-precision decimal conversion.

```mermaid
sequenceDiagram
    participant PS as PollingService
    participant CAV as ContractAssetValidation
    participant SC as StellarConfig

    PS->>CAV: parseAssetIdentifier(rawAsset)
    CAV-->>PS: {code, type, issuer}

    PS->>CAV: validateContractAsset({code, type, issuer})
    CAV->>SC: isAcceptedAsset(code, type, issuer)

    alt XLM (native)
        SC->>SC: type === "native"?\nissuer === null?
        SC-->>CAV: {accepted: true}
    else USDC (credit_alphanum4)
        SC->>SC: type === "credit_alphanum4"?\nissuer === PINNED_USDC_ISSUER?
        alt Issuer matches pinned address
            SC-->>CAV: {accepted: true}
        else Issuer mismatch
            SC-->>CAV: {accepted: false, reason: "issuer_mismatch"}
            CAV-->>PS: ContractAssetValidationError\ncode: INVALID_ISSUER
        end
    end

    PS->>CAV: validateContractAmount(amount)
    CAV->>CAV: amount > 0 (MIN_AMOUNT_STROOPS = 1)
    CAV->>CAV: amount <= MAX_INT128_STROOPS
    CAV->>CAV: toStroops(amount) — exact integer conversion\n(no floating point rounding)
    CAV-->>PS: {stroops: 250000000n}

    PS->>CAV: verifyOffChainMatchesContract(\nonChainOp, offChainRecord\n)
    CAV->>CAV: assetAgrees && amountAgrees?
    CAV-->>PS: {matches: true}
```

### 5.3 Contract Event Schema

Defined in `contractEventSchema.js`. All contract events share a common header plus a topic-specific payload. Events are versioned for forward/backward compatibility.

```json
{
  "eventId": "evt_01HXYZ...",
  "eventVersion": "1.0.0",
  "topic": "deposit",
  "contractId": "CCONTRACT...",
  "ledger": 5003,
  "txHash": "abc123...",
  "timestamp": "2025-01-15T10:00:00.000Z",
  "correlationId": "pay_intent_xyz",
  "payload": {
    "payer": "GPAYER...",
    "beneficiary": "GSCHOOL...",
    "assetCode": "USDC",
    "assetIssuer": "GA5ZS...",
    "amountStroops": "250000000",
    "memo": "STU001"
  }
}
```

**Idempotency:** indexers must deduplicate on `eventId`. Replaying the same event must produce identical state — `contractInstructionReplayProtection.js` enforces this by tracking processed instruction hashes.

### 5.4 Replay Protection

`contractInstructionReplayProtection.js` tracks a hash of each processed contract instruction. Re-submitting an identical instruction within the replay window returns the original result without re-executing, preventing double-spend and double-credit scenarios.

---

## 6. Asset Support: XLM and USDC

```mermaid
flowchart TD
    A([Inbound payment op]) --> B[detectAsset(payOp)]
    B --> C{asset_type?}
    C -- native --> D[XLM path]
    C -- credit_alphanum4 --> E[USDC path]
    C -- other --> F[❌ Rejected: unsupported type]

    D --> G[isAcceptedAsset\ncode=XLM, type=native, issuer=null]
    G --> H{ACCEPTED_ASSET\n== XLM?}
    H -- Yes --> I[✅ Accept XLM]
    H -- No --> J[❌ Rejected: unsupported_code]

    E --> K[isAcceptedAsset\ncode=USDC, type=credit_alphanum4,\nissuer=asset_issuer]
    K --> L{issuer matches\npinned USDC issuer?}
    L -- Yes --> M[✅ Accept USDC]
    L -- No --> N[❌ Rejected: issuer_mismatch\n(rogue token spoofing)]

    I --> O[normalizeAmount → stroops]
    M --> O
    O --> P[validatePaymentAgainstFee]
    P --> Q([Record payment])
```

Asset configuration per school is set via `ACCEPTED_ASSET` env var (default: `XLM`). Multi-asset per school is not supported in this version — one asset code per school instance.

| Asset | Type | Issuer Required | Decimals |
|-------|------|----------------|---------|
| XLM | `native` | No | 7 |
| USDC | `credit_alphanum4` | Yes (Circle canonical) | 7 |

---

## 7. Data Model

```mermaid
erDiagram
    School {
        string schoolId PK
        string name
        string slug
        string stellarAddress
        string network
        string syncCursor
        string acceptedAsset
        string webhookUrl
        string webhookSecret
        boolean isActive
        date createdAt
    }

    Student {
        string studentId PK
        string schoolId FK
        string name
        string class
        number feeAmount
        number remainingBalance
        string contactEmail
        date deletedAt
    }

    Payment {
        string txHash PK
        string schoolId FK
        string studentId FK
        number amount
        number feeAmount
        string assetCode
        string confirmationState
        string confirmationStatus
        number txLedger
        date confirmedAt
        boolean isSuspicious
        string feeValidationStatus
        date createdAt
    }

    PaymentIntent {
        string intentId PK
        string schoolId FK
        string studentId FK
        number amount
        string assetCode
        string memo
        date expiresAt
        date createdAt
    }

    AuditLog {
        string id PK
        string schoolId FK
        string action
        string actorId
        string actorRole
        object details
        string correlationId
        date timestamp
    }

    School ||--o{ Student : "enrols"
    School ||--o{ Payment : "receives"
    School ||--o{ PaymentIntent : "issues"
    School ||--o{ AuditLog : "generates"
    Student ||--o{ Payment : "makes"
    Student ||--o{ PaymentIntent : "has"
```

**Confirmation state transitions:**

```
detected → pending → confirmed → finalized
```

- `detected`: transaction seen on-chain, delta < `CONFIRMATION_THRESHOLD`
- `pending`: legacy alias, used by older records
- `confirmed`: delta ≥ `CONFIRMATION_THRESHOLD` (default: 2 ledgers, ~10 s)
- `finalized`: delta ≥ `FINALIZATION_THRESHOLD` (default: 10 ledgers, ~50 s)

**Key indexes:**

| Collection | Index | Purpose |
|-----------|-------|---------|
| Payment | `{txHash: 1}` unique | Dedup guard across replicas |
| Payment | `{schoolId, studentId, confirmedAt}` | Payment history queries |
| PaymentIntent | `{intentId: 1}` unique + TTL | Expire abandoned intents |
| AuditLog | `{schoolId, timestamp}` | Paginated audit queries |

---

## Related Documentation

- [`docs/stellar-integration.md`](../stellar-integration.md) — Testnet setup, memo field, fee validation, retry behaviour
- [`docs/architecture.md`](../architecture.md) — System-level component diagram and backend services overview
- [`docs/payment-lifecycle.md`](../payment-lifecycle.md) — Payment status, confirmation, retry, and reconciliation lifecycle
- [`backend/src/services/transactionPollingService.js`](../../backend/src/services/transactionPollingService.js) — Polling implementation
- [`backend/src/services/stellarService.js`](../../backend/src/services/stellarService.js) — Transaction parsing, fee validation, confirmation state machine
- [`backend/src/services/contractAuthorizationPolicy.js`](../../backend/src/services/contractAuthorizationPolicy.js) — Contract authorization rules

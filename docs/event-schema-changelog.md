# Contract Event Schema Changelog

This file tracks every change to the on-chain contract event schema so backend
engineers know what to expect when upgrading to a new contract version.

Backend event parsing lives in `backend/src/soroban/eventParser.js`.  Schema
definitions are in `backend/src/soroban/eventSchemas.js`.

---

## Schema Version 2

**Released:** 2024-06-01  
**Contract Wasm version:** 2.x.x  
**ABI version:** 2.0.0

### New fields (all optional for backward compatibility)

| Field       | Type   | Description                                              |
|-------------|--------|----------------------------------------------------------|
| `tx_hash`   | string | Stellar transaction hash that caused the event emission  |
| `ledger_seq`| number | Ledger sequence number at time of emission               |

### Migration guide

Old backend versions (parsing v1 only) will receive a `parse_error: true`
wrapper for v2 events until they are updated.  The backend logs a warning at
`WARN` level for every unknown schema version — monitor those logs after a
contract upgrade.

To add v2 support:

1. Update `backend/src/soroban/eventParser.js` — the `parseV2` handler is
   already present in this release.
2. Downstream consumers of parsed events should check `event.txHash` and
   `event.ledgerSeq` (they are `null` for v1 events, so null-checks are safe).

---

## Schema Version 1

**Released:** 2024-01-01  
**Contract Wasm version:** 1.x.x  
**ABI version:** 1.0.0

### Fields

| Field           | Type   | Required | Description                       |
|-----------------|--------|----------|-----------------------------------|
| `schema_version`| number | ✅       | Always `1` for v1 events          |
| `event_type`    | string | ✅       | E.g. `payment_confirmed`          |
| `contract_id`   | string | ✅       | Soroban contract address          |
| `timestamp`     | string | ✅       | ISO 8601 emission timestamp       |
| `payload`       | object |          | Event-specific data               |

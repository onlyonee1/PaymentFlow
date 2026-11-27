'use strict';

/**
 * Contract Event Schema Definitions (#633)
 *
 * Every contract event emitted via env.events().publish must carry a
 * schema_version field so the backend parser can route it to the correct
 * version handler without silently dropping or misinterpreting fields.
 *
 * Adding a new schema version:
 *  1. Add a SCHEMA_V<n> object below.
 *  2. Register a parser in eventParser.js.
 *  3. Add an entry to docs/event-schema-changelog.md.
 */

/** All fields present in every v1 contract event. */
const SCHEMA_V1 = {
  version: 1,
  fields: ['schema_version', 'event_type', 'contract_id', 'timestamp', 'payload'],
  required: ['schema_version', 'event_type', 'contract_id'],
};

/**
 * V2 extends V1 with two new optional fields:
 *   - tx_hash   : the Stellar transaction hash that triggered the event
 *   - ledger_seq: the ledger sequence number at time of emission
 */
const SCHEMA_V2 = {
  version: 2,
  fields: [...SCHEMA_V1.fields, 'tx_hash', 'ledger_seq'],
  required: [...SCHEMA_V1.required, 'tx_hash'],
};

const SCHEMAS = {
  1: SCHEMA_V1,
  2: SCHEMA_V2,
};

const LATEST_SCHEMA_VERSION = 2;

module.exports = { SCHEMA_V1, SCHEMA_V2, SCHEMAS, LATEST_SCHEMA_VERSION };

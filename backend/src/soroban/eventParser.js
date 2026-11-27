'use strict';

/**
 * Contract Event Parser (#633)
 *
 * Routes an incoming raw contract event to the correct version-specific
 * parser based on the schema_version field.  Every event MUST carry
 * schema_version; unknown versions are logged as warnings and returned with
 * a parse_error flag rather than being silently dropped.
 *
 * Usage:
 *   const { parseEvent } = require('./eventParser');
 *   const parsed = parseEvent(rawEvent);
 */

const logger = require('../utils/logger');
const { SCHEMAS, LATEST_SCHEMA_VERSION } = require('./eventSchemas');

// ── Version-specific parsers ──────────────────────────────────────────────────

/**
 * Parse a v1 event.
 * V1 shape: { schema_version, event_type, contract_id, timestamp, payload }
 *
 * @param {object} raw
 * @returns {object} normalised event
 */
function parseV1(raw) {
  return {
    schemaVersion: 1,
    eventType:     raw.event_type   || null,
    contractId:    raw.contract_id  || null,
    timestamp:     raw.timestamp    || null,
    payload:       raw.payload      || {},
    // V2 fields absent in v1 — explicitly null for downstream consistency
    txHash:        null,
    ledgerSeq:     null,
  };
}

/**
 * Parse a v2 event.
 * V2 extends v1 with tx_hash and ledger_seq.
 *
 * @param {object} raw
 * @returns {object} normalised event
 */
function parseV2(raw) {
  const base = parseV1(raw);
  return {
    ...base,
    schemaVersion: 2,
    txHash:    raw.tx_hash    || null,
    ledgerSeq: raw.ledger_seq != null ? Number(raw.ledger_seq) : null,
  };
}

/** Map of schema_version → parser function */
const PARSERS = {
  1: parseV1,
  2: parseV2,
};

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Parse a single raw contract event.
 *
 * Returns a normalised event object.  For unknown schema versions the raw
 * event is wrapped with parse_error: true so the caller can decide how to
 * handle it (e.g. queue for manual review) rather than silently losing data.
 *
 * @param {object} raw - the raw event as received from the Stellar RPC
 * @returns {object} parsed event
 */
function parseEvent(raw) {
  if (!raw || typeof raw !== 'object') {
    logger.warn('[EventParser] received non-object event; skipping', { raw });
    return { parse_error: true, reason: 'non-object event', raw };
  }

  const version = raw.schema_version;

  if (version == null) {
    logger.warn('[EventParser] event missing schema_version — cannot determine format', { raw });
    return { parse_error: true, reason: 'missing schema_version', raw };
  }

  const parser = PARSERS[version];

  if (!parser) {
    // Unknown version: log a warning, never silently drop.
    logger.warn(
      `[EventParser] unknown schema_version ${version} (latest known: ${LATEST_SCHEMA_VERSION}) — event queued with parse_error`,
      { version, raw }
    );
    return {
      parse_error:   true,
      reason:        `unknown schema_version: ${version}`,
      schemaVersion: version,
      raw,
    };
  }

  try {
    return parser(raw);
  } catch (err) {
    logger.error('[EventParser] parser threw for event', { version, error: err.message, raw });
    return { parse_error: true, reason: err.message, schemaVersion: version, raw };
  }
}

/**
 * Parse an array of raw contract events, returning all results (including
 * errored ones so nothing is silently dropped).
 *
 * @param {Array} rawEvents
 * @returns {Array}
 */
function parseEvents(rawEvents) {
  if (!Array.isArray(rawEvents)) {
    logger.warn('[EventParser] parseEvents received non-array input');
    return [];
  }
  return rawEvents.map(parseEvent);
}

module.exports = { parseEvent, parseEvents, PARSERS };

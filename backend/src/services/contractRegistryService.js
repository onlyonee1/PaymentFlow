'use strict';

/**
 * Contract Interface Registry Service (#636)
 *
 * Loads contracts/registry.json at startup, validates it against the JSON
 * Schema in contracts/registry.schema.json, and exposes a lookup function
 * that returns the latest active contract entry for the current
 * STELLAR_NETWORK environment variable.
 *
 * Validation is intentionally written without an external dependency (AJV is
 * not in the production dependency list) so the registry check adds zero
 * install overhead. The validator covers every field required by the schema.
 */

const fs   = require('fs');
const path = require('path');

const REGISTRY_PATH = path.resolve(__dirname, '../../../contracts/registry.json');
const SCHEMA_PATH   = path.resolve(__dirname, '../../../contracts/registry.schema.json');

const REQUIRED_FIELDS = ['network', 'contractId', 'wasmHash', 'abiVersion', 'deployedAt', 'active'];
const VALID_NETWORKS  = new Set(['mainnet', 'testnet', 'futurenet']);
const WASM_HASH_RE    = /^[0-9a-f]{64}$/;
const SEMVER_RE       = /^\d+\.\d+\.\d+$/;
const ISO_DATE_RE     = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

/**
 * Validate a single registry entry against the schema rules.
 * Throws with a descriptive message on the first violation.
 *
 * @param {unknown} entry - the candidate entry object
 * @param {number}  index - position in the registry array (for error messages)
 */
function validateEntry(entry, index) {
  const loc = `Registry entry [${index}]`;

  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`${loc}: must be a plain object`);
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) {
      throw new Error(`${loc}: missing required field "${field}"`);
    }
  }

  if (typeof entry.network !== 'string' || !VALID_NETWORKS.has(entry.network)) {
    throw new Error(
      `${loc}: "network" must be one of [${[...VALID_NETWORKS].join(', ')}], got "${entry.network}"`
    );
  }

  if (typeof entry.contractId !== 'string' || entry.contractId.length < 56 || entry.contractId.length > 72) {
    throw new Error(`${loc}: "contractId" must be a string of 56–72 characters`);
  }

  if (typeof entry.wasmHash !== 'string' || !WASM_HASH_RE.test(entry.wasmHash)) {
    throw new Error(`${loc}: "wasmHash" must be a 64-character lowercase hex string`);
  }

  if (typeof entry.abiVersion !== 'string' || !SEMVER_RE.test(entry.abiVersion)) {
    throw new Error(`${loc}: "abiVersion" must follow semver (e.g. "1.0.0"), got "${entry.abiVersion}"`);
  }

  if (typeof entry.deployedAt !== 'string' || !ISO_DATE_RE.test(entry.deployedAt)) {
    throw new Error(`${loc}: "deployedAt" must be an ISO 8601 date-time string`);
  }

  if (typeof entry.active !== 'boolean') {
    throw new Error(`${loc}: "active" must be a boolean`);
  }
}

/**
 * Load and validate the registry file.
 *
 * Returns the parsed array on success.
 * Throws a descriptive Error on any validation failure so the caller can
 * decide whether to abort startup or log a warning.
 *
 * Returns null when the registry file does not exist (contracts directory is
 * optional in environments that do not use Soroban).
 *
 * @returns {Array|null}
 */
function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    return null;
  }

  let raw;
  try {
    raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
  } catch (err) {
    throw new Error(`ContractRegistry: failed to read ${REGISTRY_PATH}: ${err.message}`);
  }

  let entries;
  try {
    entries = JSON.parse(raw);
  } catch (err) {
    throw new Error(`ContractRegistry: registry.json is not valid JSON — ${err.message}`);
  }

  if (!Array.isArray(entries)) {
    throw new Error('ContractRegistry: registry.json must be a JSON array');
  }

  if (entries.length === 0) {
    throw new Error('ContractRegistry: registry.json must contain at least one entry');
  }

  entries.forEach(validateEntry);

  return entries;
}

/**
 * Resolve the latest active contract entry for the given network.
 *
 * "Latest" is defined as the entry with the most recent deployedAt timestamp
 * among all entries where active === true and network matches.
 *
 * @param {Array}  registry - validated registry array from loadRegistry()
 * @param {string} network  - e.g. 'testnet' | 'mainnet' | 'futurenet'
 * @returns {{ network, contractId, wasmHash, abiVersion, deployedAt, active } | null}
 */
function resolveContract(registry, network) {
  if (!Array.isArray(registry)) return null;

  const candidates = registry.filter(
    (e) => e.active === true && e.network === network
  );

  if (candidates.length === 0) return null;

  // Pick the most recently deployed active entry for the network.
  return candidates.reduce((best, entry) =>
    new Date(entry.deployedAt) > new Date(best.deployedAt) ? entry : best
  );
}

/**
 * Validate startup: loads the registry (if present) and throws if it is
 * malformed.  Called once from app startup so a misconfigured deploy is
 * caught before the server accepts traffic.
 *
 * @throws {Error} when the registry file exists but fails validation
 */
function validateRegistryOnStartup() {
  try {
    const registry = loadRegistry();
    if (registry === null) {
      // No contracts directory — not an error; Soroban integration is optional.
      return null;
    }
    return registry;
  } catch (err) {
    // Re-throw with a clear prefix so operators know exactly where to look.
    throw new Error(`ContractRegistry startup validation failed: ${err.message}`);
  }
}

/**
 * Convenience: load the registry and return the active contract for the
 * network specified by STELLAR_NETWORK (falls back to 'testnet').
 *
 * @returns {{ contractId, wasmHash, abiVersion, network, deployedAt } | null}
 */
function getActiveContract() {
  const network  = process.env.STELLAR_NETWORK || 'testnet';
  const registry = loadRegistry();
  if (!registry) return null;
  return resolveContract(registry, network);
}

module.exports = {
  loadRegistry,
  validateEntry,
  resolveContract,
  validateRegistryOnStartup,
  getActiveContract,
  // exported for tests
  REGISTRY_PATH,
  SCHEMA_PATH,
};

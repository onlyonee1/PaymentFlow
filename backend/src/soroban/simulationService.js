'use strict';

/**
 * Soroban Transaction Simulation Service (Issue #634).
 *
 * Before presenting the payment confirmation screen, the backend calls
 * simulateTransaction on Horizon to get the exact fee breakdown. This
 * eliminates the gap between the estimated fee shown to users and the actual
 * amount deducted from their wallet.
 *
 * Key behaviours:
 *   - Returns fee_stroops (network fee) and resource_fee (Soroban resource fee)
 *   - Results are cached for 60 seconds to avoid redundant RPC calls
 *   - Simulation failure returns a structured error (simulation_error field)
 *   - Fee-bump transactions are handled transparently
 *
 * Horizon RPC endpoint: POST /simulate_transaction (Soroban RPC)
 * Response field: result.cost.instructionCount  (used by budget monitoring)
 */

const config = require('../config');

// Cache TTL in milliseconds (60 seconds per acceptance criteria)
const SIMULATION_CACHE_TTL_MS = 60 * 1000;

// In-memory cache: Map<cacheKey, { result, expiresAt }>
const simulationCache = new Map();

/**
 * Build the Soroban RPC URL for the active network.
 *
 * Uses SOROBAN_RPC_URL env var when set; falls back to the standard
 * Stellar/Soroban public RPC endpoint for the configured network.
 *
 * @returns {string}
 */
function getSorobanRpcUrl() {
  if (process.env.SOROBAN_RPC_URL) {
    return process.env.SOROBAN_RPC_URL;
  }
  return config.IS_TESTNET
    ? 'https://soroban-testnet.stellar.org'
    : 'https://soroban.stellar.org';
}

/**
 * Build a cache key for a simulation request.
 *
 * @param {string} xdr - base64-encoded transaction XDR
 * @returns {string}
 */
function buildCacheKey(xdr) {
  return `sim:${xdr.slice(0, 64)}`;
}

/**
 * Retrieve a cached simulation result if it has not expired.
 *
 * @param {string} cacheKey
 * @returns {object|null}
 */
function getCachedResult(cacheKey) {
  const entry = simulationCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    simulationCache.delete(cacheKey);
    return null;
  }
  return entry.result;
}

/**
 * Store a simulation result in the cache.
 *
 * @param {string} cacheKey
 * @param {object} result
 */
function setCachedResult(cacheKey, result) {
  simulationCache.set(cacheKey, {
    result,
    expiresAt: Date.now() + SIMULATION_CACHE_TTL_MS,
  });
}

/**
 * Invalidate all cached simulation results.
 * Called when a payment intent is refreshed.
 */
function clearSimulationCache() {
  simulationCache.clear();
}

/**
 * Simulate a Soroban transaction via the Horizon RPC endpoint.
 *
 * Returns a structured simulation object that is included in the payment
 * intent response so the frontend can show the exact fee breakdown.
 *
 * On simulation failure (insufficient balance, invalid XDR, etc.) returns a
 * structured error rather than throwing — the caller decides whether to surface
 * it as a 422 or absorb it.
 *
 * @param {string} xdr - base64-encoded transaction envelope XDR
 * @param {object} [options]
 * @param {boolean} [options.skipCache=false] - force a fresh simulation
 * @returns {Promise<{ success: boolean, fee_stroops?: number, resource_fee?: number,
 *                     instruction_count?: number, min_resource_fee?: number,
 *                     simulation_error?: string, cached?: boolean }>}
 */
async function simulateTransaction(xdr, options = {}) {
  if (!xdr || typeof xdr !== 'string') {
    return {
      success: false,
      simulation_error: 'Invalid XDR: must be a non-empty base64 string',
    };
  }

  const cacheKey = buildCacheKey(xdr);

  if (!options.skipCache) {
    const cached = getCachedResult(cacheKey);
    if (cached) {
      return { ...cached, cached: true };
    }
  }

  const rpcUrl = getSorobanRpcUrl();

  let response;
  try {
    const fetch = globalThis.fetch || require('node-fetch');
    response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'simulateTransaction',
        params: { transaction: xdr },
      }),
    });
  } catch (networkErr) {
    return {
      success: false,
      simulation_error: `Soroban RPC unreachable: ${networkErr.message}`,
    };
  }

  let body;
  try {
    body = await response.json();
  } catch (parseErr) {
    return {
      success: false,
      simulation_error: 'Failed to parse Soroban RPC response',
    };
  }

  // Soroban RPC error (JSON-RPC error object)
  if (body.error) {
    return {
      success: false,
      simulation_error: body.error.message || JSON.stringify(body.error),
    };
  }

  const result = body.result;
  if (!result) {
    return {
      success: false,
      simulation_error: 'Empty result from Soroban RPC',
    };
  }

  // simulateTransaction returns `error` inside result on simulation failure
  if (result.error) {
    return {
      success: false,
      simulation_error: result.error,
    };
  }

  // Parse fee fields from the simulation response
  const minResourceFee = parseInt(result.minResourceFee || '0', 10);
  const instructionCount = result.cost
    ? parseInt(result.cost.instructionCount || '0', 10)
    : 0;

  // The classic Stellar base fee (100 stroops default) + Soroban resource fee
  const baseFeeStroops = 100;
  const feeStroops = baseFeeStroops + minResourceFee;

  const simulationResult = {
    success: true,
    fee_stroops: feeStroops,
    resource_fee: minResourceFee,
    instruction_count: instructionCount,
    min_resource_fee: minResourceFee,
    cached: false,
  };

  setCachedResult(cacheKey, simulationResult);
  return simulationResult;
}

/**
 * Build a minimal unsigned transaction XDR for fee estimation purposes.
 *
 * This creates a placeholder transaction that matches the structure of a real
 * payment transaction, suitable for passing to simulateTransaction without
 * consuming a sequence number on-chain.
 *
 * @param {object} params
 * @param {string} params.sourceAccount - paying account public key
 * @param {string} params.destination   - school wallet address
 * @param {string} params.amount        - amount in XLM decimal string
 * @param {string} params.memo          - payment memo (student ID)
 * @param {string} [params.assetCode]   - 'XLM' or 'USDC'
 * @param {string} [params.assetIssuer] - required when assetCode is 'USDC'
 * @returns {string|null} base64 XDR string, or null if StellarSdk is unavailable
 */
function buildSimulationXdr({ sourceAccount, destination, amount, memo, assetCode = 'XLM', assetIssuer }) {
  try {
    const StellarSdk = require('@stellar/stellar-sdk');
    const { networkPassphrase } = require('../config/stellarConfig');

    const account = new StellarSdk.Account(sourceAccount, '0');
    const asset = assetCode === 'XLM'
      ? StellarSdk.Asset.native()
      : new StellarSdk.Asset(assetCode, assetIssuer);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: StellarSdk.BASE_FEE,
      networkPassphrase,
    })
      .addOperation(StellarSdk.Operation.payment({ destination, asset, amount }))
      .addMemo(StellarSdk.Memo.text(memo))
      .setTimeout(300)
      .build();

    return tx.toEnvelope().toXDR('base64');
  } catch (_) {
    return null;
  }
}

module.exports = {
  simulateTransaction,
  buildSimulationXdr,
  clearSimulationCache,
  getSorobanRpcUrl,
  SIMULATION_CACHE_TTL_MS,
};

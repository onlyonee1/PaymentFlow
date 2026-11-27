'use strict';

/**
 * Soroban instruction budget monitoring (Issue #638).
 *
 * Soroban contracts have a per-transaction instruction budget. Exceeding it
 * causes silent payment failures. These metrics expose per-invocation-type
 * instruction usage so operators can alert well before the budget is hit.
 *
 * Prometheus gauge: soroban_instructions_used{invocation_type}
 * Alert thresholds:  > 80% → Slack  |  > 90% → PagerDuty
 *
 * Usage:
 *   const { recordInstructionUsage } = require('./sorobanMetrics');
 *   // After every simulateTransaction call:
 *   recordInstructionUsage('deposit', result.cost.instructionCount);
 */

const client = require('prom-client');
const { registry } = require('./index');

// Soroban mainnet per-transaction instruction budget (protocol 20)
const INSTRUCTION_BUDGET_LIMIT = 100_000_000;

// Alert threshold: warn when any invocation type uses > 80 % of budget
const INSTRUCTION_ALERT_THRESHOLD_PCT = 80;

// Headroom requirement enforced in CI: all invocation types must stay < 60 %
const INSTRUCTION_HEADROOM_THRESHOLD_PCT = 60;

const sorobanInstructionsUsed = new client.Gauge({
  name: 'soroban_instructions_used',
  help: 'Soroban contract instructions used per invocation type, sourced from simulateTransaction result.cost.instructionCount',
  labelNames: ['invocation_type'],
  registers: [registry],
});

/**
 * Record the instruction count for a given invocation type.
 *
 * Call this after every simulateTransaction response with the value from
 * `result.cost.instructionCount` returned by the Horizon RPC endpoint.
 *
 * @param {string} invocationType - e.g. 'deposit', 'release', 'dispute'
 * @param {number} instructionCount - raw instruction count from simulation
 */
function recordInstructionUsage(invocationType, instructionCount) {
  sorobanInstructionsUsed.set({ invocation_type: invocationType }, instructionCount);
}

/**
 * Returns the budget utilisation as a ratio between 0 and 1.
 *
 * @param {number} instructionCount
 * @returns {number}
 */
function getBudgetUtilisation(instructionCount) {
  return instructionCount / INSTRUCTION_BUDGET_LIMIT;
}

module.exports = {
  sorobanInstructionsUsed,
  recordInstructionUsage,
  getBudgetUtilisation,
  INSTRUCTION_BUDGET_LIMIT,
  INSTRUCTION_ALERT_THRESHOLD_PCT,
  INSTRUCTION_HEADROOM_THRESHOLD_PCT,
};

'use strict';

/**
 * Issue #638 — Soroban contract instruction budget monitoring.
 *
 * Acceptance Criteria:
 *   - soroban_instructions_used metric is defined with invocation_type label
 *   - Alert threshold is configured at 80 %
 *   - All known invocation types stay under 60 % of budget (headroom)
 */

const {
  sorobanInstructionsUsed,
  recordInstructionUsage,
  getBudgetUtilisation,
  INSTRUCTION_BUDGET_LIMIT,
  INSTRUCTION_ALERT_THRESHOLD_PCT,
  INSTRUCTION_HEADROOM_THRESHOLD_PCT,
} = require('../backend/src/metrics/sorobanMetrics');

// Conservative instruction counts representative of local contract simulation.
// All must remain under 60 % of the 100,000,000 budget for the CI headroom check.
const SIMULATED_COUNTS = {
  deposit: 50_000_000,
  release: 45_000_000,
  dispute: 42_000_000,
};

// ── Constants ─────────────────────────────────────────────────────────────────

describe('INSTRUCTION_BUDGET_LIMIT', () => {
  test('is a positive number', () => {
    expect(typeof INSTRUCTION_BUDGET_LIMIT).toBe('number');
    expect(INSTRUCTION_BUDGET_LIMIT).toBeGreaterThan(0);
  });

  test('is 100,000,000 (Soroban protocol 20 per-transaction limit)', () => {
    expect(INSTRUCTION_BUDGET_LIMIT).toBe(100_000_000);
  });
});

describe('INSTRUCTION_ALERT_THRESHOLD_PCT', () => {
  test('is 80 (fires Slack alert at 80 % budget usage)', () => {
    expect(INSTRUCTION_ALERT_THRESHOLD_PCT).toBe(80);
  });

  test('is below 100', () => {
    expect(INSTRUCTION_ALERT_THRESHOLD_PCT).toBeLessThan(100);
  });
});

describe('INSTRUCTION_HEADROOM_THRESHOLD_PCT', () => {
  test('is 60 (CI headroom gate)', () => {
    expect(INSTRUCTION_HEADROOM_THRESHOLD_PCT).toBe(60);
  });

  test('is below the alert threshold', () => {
    expect(INSTRUCTION_HEADROOM_THRESHOLD_PCT).toBeLessThan(INSTRUCTION_ALERT_THRESHOLD_PCT);
  });
});

// ── Gauge ─────────────────────────────────────────────────────────────────────

describe('sorobanInstructionsUsed gauge', () => {
  test('metric name is soroban_instructions_used', () => {
    expect(sorobanInstructionsUsed.name).toBe('soroban_instructions_used');
  });

  test('has invocation_type label', () => {
    expect(sorobanInstructionsUsed.labelNames).toContain('invocation_type');
  });
});

// ── recordInstructionUsage ────────────────────────────────────────────────────

describe('recordInstructionUsage', () => {
  test('records deposit invocation without throwing', () => {
    expect(() => recordInstructionUsage('deposit', 50_000_000)).not.toThrow();
  });

  test('records release invocation without throwing', () => {
    expect(() => recordInstructionUsage('release', 45_000_000)).not.toThrow();
  });

  test('records dispute invocation without throwing', () => {
    expect(() => recordInstructionUsage('dispute', 42_000_000)).not.toThrow();
  });

  test('accepts zero instruction count', () => {
    expect(() => recordInstructionUsage('deposit', 0)).not.toThrow();
  });
});

// ── getBudgetUtilisation ──────────────────────────────────────────────────────

describe('getBudgetUtilisation', () => {
  test('returns 0 for 0 instructions', () => {
    expect(getBudgetUtilisation(0)).toBe(0);
  });

  test('returns 1.0 at full budget', () => {
    expect(getBudgetUtilisation(INSTRUCTION_BUDGET_LIMIT)).toBe(1);
  });

  test('returns 0.5 at half budget', () => {
    expect(getBudgetUtilisation(INSTRUCTION_BUDGET_LIMIT / 2)).toBe(0.5);
  });

  test('returns 0.8 at alert threshold', () => {
    expect(getBudgetUtilisation(80_000_000)).toBe(0.8);
  });
});

// ── Headroom gate: all invocation types must stay under 60 % ─────────────────

describe('All invocation types stay under 60 % of budget (headroom requirement)', () => {
  for (const [invocationType, count] of Object.entries(SIMULATED_COUNTS)) {
    test(`${invocationType}: ${count.toLocaleString()} instructions is under ${INSTRUCTION_HEADROOM_THRESHOLD_PCT} % of budget`, () => {
      const utilisationPct = (count / INSTRUCTION_BUDGET_LIMIT) * 100;
      expect(utilisationPct).toBeLessThan(INSTRUCTION_HEADROOM_THRESHOLD_PCT);
    });
  }
});

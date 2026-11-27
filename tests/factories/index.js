'use strict';

/**
 * Test data factories — issue #652
 *
 * Deterministic, seed-based factories for every major domain model.
 * Same seed → same output on every machine and Node version.
 *
 * Usage:
 *   const { createStudent, createSchool, createPayment, createFeeStructure, createUser } = require('./factories');
 *
 *   // With defaults (seed = 12345):
 *   const student = createStudent();
 *
 *   // With overrides:
 *   const student = createStudent({ name: 'Alice', feePaid: true });
 *
 *   // With a custom seed for a reproducible sequence:
 *   const { createStudent } = require('./factories/createStudent')({ seed: 99 });
 */

const { createRng, DEFAULT_SEED } = require('./seed');

/** Internal counter to give each factory call a unique index without mutation */
let _callIndex = 0;

/**
 * Returns a seeded rng for a single factory call.
 * Each call gets a unique sub-seed derived from the global seed + call index
 * so that multiple consecutive calls don't repeat values.
 */
function rngForCall(seed = DEFAULT_SEED) {
  return createRng(seed + _callIndex++);
}

// ─── createSchool ─────────────────────────────────────────────────────────────

/**
 * @param {object} [overrides]
 * @param {number} [seed]
 * @returns {object} Plain object matching the School model schema
 */
function createSchool(overrides = {}, seed = DEFAULT_SEED) {
  const rng = rngForCall(seed);
  const id  = rng.alphanum(4).toUpperCase();
  return {
    schoolId:       `SCH-${id}`,
    name:           `Test School ${id}`,
    slug:           `test-school-${id.toLowerCase()}`,
    stellarAddress: 'GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5',
    network:        'testnet',
    isActive:       true,
    maxStudents:    500,
    timezone:       'UTC',
    ...overrides,
  };
}

// ─── createStudent ────────────────────────────────────────────────────────────

const CLASSES = ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6', 'Form 1', 'Form 2'];
const FIRST_NAMES = ['Alice', 'Bob', 'Carol', 'David', 'Eve', 'Frank', 'Grace', 'Henry', 'Iris', 'Jack'];
const LAST_NAMES  = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Miller', 'Davis', 'Wilson'];

/**
 * @param {object} [overrides]
 * @param {number} [seed]
 * @returns {object} Plain object matching the Student model schema
 */
function createStudent(overrides = {}, seed = DEFAULT_SEED) {
  const rng        = rngForCall(seed);
  const firstName  = rng.pick(FIRST_NAMES);
  const lastName   = rng.pick(LAST_NAMES);
  const idSuffix   = rng.alphanum(6).toUpperCase();
  const feeAmount  = rng.float(100, 500);

  return {
    schoolId:         'SCH-TEST',
    studentId:        `STU-${idSuffix}`,
    name:             `${firstName} ${lastName}`,
    class:            rng.pick(CLASSES),
    academicYear:     new Date().getFullYear().toString(),
    feeAmount,
    feePaid:          false,
    totalPaid:        0,
    remainingBalance: feeAmount,
    parentEmail:      rng.email(firstName.toLowerCase()),
    parentPhone:      `555-${rng.int(1000, 9999)}`,
    ...overrides,
  };
}

// ─── createPayment ────────────────────────────────────────────────────────────

const PAYMENT_STATUSES = ['SUCCESS', 'PENDING', 'FAILED'];

/**
 * @param {object} [overrides]
 * @param {number} [seed]
 * @returns {object} Plain object matching the Payment model schema
 */
function createPayment(overrides = {}, seed = DEFAULT_SEED) {
  const rng    = rngForCall(seed);
  const amount = rng.float(50, 500);
  const txHash = rng.hex(64);

  return {
    schoolId:    'SCH-TEST',
    studentId:   `STU-${rng.alphanum(6).toUpperCase()}`,
    txHash,
    amount,
    feeAmount:   amount,
    asset:       'XLM',
    status:      rng.pick(PAYMENT_STATUSES),
    confirmedAt: null,
    memo:        `STU-${rng.alphanum(6).toUpperCase()}`,
    ...overrides,
  };
}

// ─── createFeeStructure ───────────────────────────────────────────────────────

/**
 * @param {object} [overrides]
 * @param {number} [seed]
 * @returns {object} Plain object matching the FeeStructure model schema
 */
function createFeeStructure(overrides = {}, seed = DEFAULT_SEED) {
  const rng       = rngForCall(seed);
  const className = rng.pick(CLASSES);
  const year      = new Date().getFullYear().toString();

  return {
    schoolId:        'SCH-TEST',
    className,
    feeAmount:       rng.float(100, 500),
    description:     `Fee structure for ${className}`,
    academicYear:    year,
    isActive:        true,
    paymentDeadline: null,
    ...overrides,
  };
}

// ─── createUser ───────────────────────────────────────────────────────────────

const ROLES = ['owner', 'staff', 'read_only'];

/**
 * @param {object} [overrides]
 * @param {number} [seed]
 * @returns {object} Plain object matching the User model schema (no passwordHash — use bcrypt in integration tests)
 */
function createUser(overrides = {}, seed = DEFAULT_SEED) {
  const rng = rngForCall(seed);
  const id  = rng.alphanum(6).toLowerCase();

  return {
    email:        `admin-${id}@example.com`,
    passwordHash: `$2b$10$placeholder.hash.for.testing.${id}`,
    schoolId:     'SCH-TEST',
    roles:        [rng.pick(ROLES)],
    isActive:     true,
    mfaEnabled:   false,
    mfaSecret:    null,
    ...overrides,
  };
}

// ─── Reset call index (useful between test suites) ────────────────────────────

function resetCallIndex() {
  _callIndex = 0;
}

module.exports = {
  createSchool,
  createStudent,
  createPayment,
  createFeeStructure,
  createUser,
  resetCallIndex,
};

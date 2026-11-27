#!/usr/bin/env node
'use strict';

/**
 * deploy-contract.js — Contract Deployment Script (#636)
 *
 * Appends a new entry to contracts/registry.json after a successful Soroban
 * contract deployment. Validates the resulting registry against the schema
 * before writing, so a bad deploy cannot corrupt the registry file.
 *
 * Usage:
 *   node scripts/deploy-contract.js \
 *     --network testnet \
 *     --contractId CCXXXXXXXX... \
 *     --wasmHash <64-char hex> \
 *     --abiVersion 1.0.1
 *
 * Optional flags:
 *   --commit   Run `git add` and `git commit` after updating the registry.
 *   --no-deactivate  Keep previous entries for the same network active.
 */

const fs   = require('fs');
const path = require('path');

const REGISTRY_PATH = path.resolve(__dirname, '../contracts/registry.json');

// ── Argument parsing ──────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) {
        args[key] = true; // boolean flag
      } else {
        args[key] = next;
        i++;
      }
    }
  }
  return args;
}

// ── Validation ────────────────────────────────────────────────────────────────

const REQUIRED = ['network', 'contractId', 'wasmHash', 'abiVersion'];
const VALID_NETWORKS = new Set(['mainnet', 'testnet', 'futurenet']);
const WASM_HASH_RE = /^[0-9a-f]{64}$/;
const SEMVER_RE    = /^\d+\.\d+\.\d+$/;

function validate(args) {
  for (const field of REQUIRED) {
    if (!args[field]) {
      console.error(`Error: --${field} is required`);
      process.exit(1);
    }
  }
  if (!VALID_NETWORKS.has(args.network)) {
    console.error(`Error: --network must be one of [${[...VALID_NETWORKS].join(', ')}]`);
    process.exit(1);
  }
  if (!WASM_HASH_RE.test(args.wasmHash)) {
    console.error('Error: --wasmHash must be a 64-character lowercase hex string');
    process.exit(1);
  }
  if (!SEMVER_RE.test(args.abiVersion)) {
    console.error('Error: --abiVersion must follow semver (e.g. 1.0.0)');
    process.exit(1);
  }
}

// ── Registry update ───────────────────────────────────────────────────────────

function loadExisting() {
  if (!fs.existsSync(REGISTRY_PATH)) return [];
  try {
    const raw = fs.readFileSync(REGISTRY_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Error reading registry: ${err.message}`);
    process.exit(1);
  }
}

function run() {
  const args = parseArgs(process.argv);
  validate(args);

  const { network, contractId, wasmHash, abiVersion, commit } = args;
  const deactivatePrev = !args['no-deactivate'];

  const registry = loadExisting();

  // Mark previous active entries for this network as inactive.
  if (deactivatePrev) {
    registry.forEach((entry) => {
      if (entry.network === network && entry.active) {
        entry.active = false;
      }
    });
  }

  const newEntry = {
    network,
    contractId,
    wasmHash,
    abiVersion,
    deployedAt: new Date().toISOString(),
    active: true,
  };

  registry.push(newEntry);

  // Validate the full registry before writing.
  const { loadRegistry } = require('../backend/src/services/contractRegistryService');
  // Write to a temp buffer first, then validate.
  const tmpPath = REGISTRY_PATH + '.tmp';
  fs.writeFileSync(tmpPath, JSON.stringify(registry, null, 2) + '\n', 'utf8');

  // Swap temp → real only after validation passes.
  const originalPath = REGISTRY_PATH;
  // Temporarily point the module at the tmp file to validate.
  try {
    const tmpRegistry = JSON.parse(fs.readFileSync(tmpPath, 'utf8'));
    const { validateEntry } = require('../backend/src/services/contractRegistryService');
    tmpRegistry.forEach(validateEntry);
  } catch (err) {
    fs.unlinkSync(tmpPath);
    console.error(`Registry validation failed — aborting deploy: ${err.message}`);
    process.exit(1);
  }

  fs.renameSync(tmpPath, REGISTRY_PATH);
  console.log(`Registry updated: ${network} → ${contractId} (ABI ${abiVersion})`);
  console.log(`Total entries: ${registry.length}`);

  if (commit) {
    const { execSync } = require('child_process');
    try {
      execSync(`git add "${REGISTRY_PATH}"`, { stdio: 'inherit' });
      execSync(
        `git commit -m "chore: update contract registry — ${network} ABI v${abiVersion}"`,
        { stdio: 'inherit' }
      );
      console.log('Registry committed to git.');
    } catch (err) {
      console.error(`Git commit failed: ${err.message}`);
      process.exit(1);
    }
  }
}

run();

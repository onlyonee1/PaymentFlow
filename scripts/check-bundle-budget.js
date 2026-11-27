#!/usr/bin/env node
'use strict';

/**
 * check-bundle-budget.js
 *
 * Validates the frontend bundle size budget config (frontend/bundle-budget.json)
 * and, if a Next.js build manifest exists, checks whether any entrypoint
 * exceeds the configured gzipped size budgets.
 *
 * Usage:
 *   node scripts/check-bundle-budget.js
 *
 * In CI this runs after `cd frontend && npm run build`. The build produces
 * .next/build-manifest.json. When that file is absent (e.g. in a lint-only
 * run) the script validates the budget config and exits 0 with a warning.
 *
 * Exit codes:
 *   0 — budget config is valid; all checked entrypoints are within budget
 *   1 — budget config is malformed, or one or more entrypoints exceed budget
 */

const fs   = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT        = path.resolve(__dirname, '..');
const BUDGET_FILE = path.join(ROOT, 'frontend', 'bundle-budget.json');
const NEXT_DIR    = path.join(ROOT, 'frontend', '.next');
const BUILD_MANIFEST = path.join(NEXT_DIR, 'build-manifest.json');

// ── 1. Validate budget config ─────────────────────────────────────────────

if (!fs.existsSync(BUDGET_FILE)) {
  console.error(`[bundle-budget] ERROR: ${BUDGET_FILE} not found.`);
  process.exit(1);
}

let budget;
try {
  budget = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
} catch (err) {
  console.error(`[bundle-budget] ERROR: Failed to parse bundle-budget.json: ${err.message}`);
  process.exit(1);
}

const requiredFields = ['unit', 'main', 'chunk'];
for (const field of requiredFields) {
  if (budget[field] === undefined) {
    console.error(`[bundle-budget] ERROR: bundle-budget.json is missing required field: ${field}`);
    process.exit(1);
  }
}

if (budget.unit !== 'KB') {
  console.error(`[bundle-budget] ERROR: bundle-budget.json unit must be "KB", got "${budget.unit}"`);
  process.exit(1);
}

if (typeof budget.main !== 'number' || budget.main <= 0) {
  console.error('[bundle-budget] ERROR: bundle-budget.json "main" must be a positive number.');
  process.exit(1);
}

if (typeof budget.chunk !== 'number' || budget.chunk <= 0) {
  console.error('[bundle-budget] ERROR: bundle-budget.json "chunk" must be a positive number.');
  process.exit(1);
}

console.log(`[bundle-budget] Budget config valid: main=${budget.main} KB, chunk=${budget.chunk} KB (gzipped)`);

// ── 2. Check build output if available ───────────────────────────────────

if (!fs.existsSync(BUILD_MANIFEST)) {
  console.warn(
    '[bundle-budget] No Next.js build manifest found at frontend/.next/build-manifest.json. ' +
    'Run `cd frontend && npm run build` first to enforce size budgets. Skipping size checks.'
  );
  process.exit(0);
}

let manifest;
try {
  manifest = JSON.parse(fs.readFileSync(BUILD_MANIFEST, 'utf8'));
} catch (err) {
  console.error(`[bundle-budget] ERROR: Failed to parse build-manifest.json: ${err.message}`);
  process.exit(1);
}

/**
 * Returns the gzipped size in KB of a file, or null if the file doesn't exist.
 */
function gzippedSizeKB(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const content = fs.readFileSync(filePath);
  const compressed = zlib.gzipSync(content);
  return compressed.length / 1024;
}

const failures = [];
const pages = manifest.pages || {};

for (const [route, chunks] of Object.entries(pages)) {
  for (const chunk of chunks) {
    const absPath = path.join(NEXT_DIR, 'static', chunk);
    const sizeKB  = gzippedSizeKB(absPath);
    if (sizeKB === null) continue;

    // Main entrypoint check
    const isMain = chunk.includes('main') || chunk.includes('framework') || chunk.includes('_app');
    const limit  = isMain ? budget.main : budget.chunk;
    const label  = isMain ? 'main' : 'chunk';

    if (sizeKB > limit) {
      failures.push({ route, chunk, sizeKB: sizeKB.toFixed(1), limit, label });
    }
  }
}

if (failures.length > 0) {
  console.error(`[bundle-budget] BUDGET EXCEEDED — ${failures.length} violation(s):`);
  for (const f of failures) {
    console.error(`  [${f.label}] ${f.chunk} (route: ${f.route}): ${f.sizeKB} KB > ${f.limit} KB limit`);
  }
  process.exit(1);
}

console.log('[bundle-budget] All entrypoints are within budget. ✓');
process.exit(0);

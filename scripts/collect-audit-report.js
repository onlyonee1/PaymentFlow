#!/usr/bin/env node
'use strict';

/**
 * collect-audit-report.js
 *
 * Runs npm audit --json for each workspace (root, backend, frontend) and
 * writes a Markdown summary to audit-report.md. Called by the weekly
 * vulnerability scan workflow before posting the GitHub Issue report.
 *
 * Exit code is always 0 — this script collects and formats; the per-workspace
 * check-dependency-audit.js jobs are what gate the build.
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

const ROOT       = path.resolve(__dirname, '..');
const WORKSPACES = [
  { label: 'root',     dir: ROOT },
  { label: 'backend',  dir: path.join(ROOT, 'backend') },
  { label: 'frontend', dir: path.join(ROOT, 'frontend') },
];

const today = new Date().toISOString().slice(0, 10);
const lines = [
  `## Weekly vulnerability scan report — ${today}`,
  '',
  'Scans all three package manifests for **high** and **critical** CVEs.',
  'Exceptions are defined in `security-exceptions.json` with an expiry date.',
  'Expired exceptions fail CI just like new unexcepted advisories.',
  '',
];

let grandTotalHigh = 0;
let grandTotalCritical = 0;

for (const ws of WORKSPACES) {
  if (!fs.existsSync(ws.dir)) continue;

  let report;
  try {
    const stdout = execSync('npm audit --json', {
      cwd: ws.dir,
      encoding: 'utf8',
      maxBuffer: 20 * 1024 * 1024,
    });
    report = JSON.parse(stdout);
  } catch (err) {
    try {
      report = JSON.parse(err.stdout || '{}');
    } catch {
      lines.push(`### ${ws.label}`, '', '_Failed to parse audit output._', '');
      continue;
    }
  }

  const vulns     = report.vulnerabilities || {};
  const meta      = report.metadata || {};
  const severities = meta.vulnerabilities || {};
  const high     = severities.high     || 0;
  const critical = severities.critical || 0;
  const moderate = severities.moderate || 0;
  const low      = severities.low      || 0;

  grandTotalHigh     += high;
  grandTotalCritical += critical;

  const status = (high + critical) > 0 ? '🔴 Action required' : '✅ Clean';

  lines.push(
    `### ${ws.label} — ${status}`,
    '',
    `| Severity | Count |`,
    `|---|---|`,
    `| Critical | ${critical} |`,
    `| High | ${high} |`,
    `| Moderate | ${moderate} |`,
    `| Low | ${low} |`,
    '',
  );

  // List high/critical advisories
  const flagged = Object.values(vulns).filter(
    (v) => ['high', 'critical'].includes(v.severity)
  );
  if (flagged.length > 0) {
    lines.push('**High/critical advisories:**', '');
    for (const v of flagged) {
      const ids = (v.via || [])
        .filter((e) => typeof e === 'object' && e.url)
        .map((e) => `[${e.url.split('/').pop()}](${e.url})`);
      if (ids.length > 0) {
        lines.push(`- **${v.name}** (${v.severity}): ${ids.join(', ')}`);
      }
    }
    lines.push('');
  }
}

lines.push(
  '---',
  '',
  `**Grand total — High: ${grandTotalHigh} | Critical: ${grandTotalCritical}**`,
  '',
  'To silence a known advisory, add a time-bound entry to `security-exceptions.json`.',
  'See `docs/dependency-triage.md` for the full exception process.',
);

const reportPath = path.join(ROOT, 'audit-report.md');
fs.writeFileSync(reportPath, lines.join('\n'), 'utf8');
console.log(`[collect-audit-report] Report written to ${reportPath}`);

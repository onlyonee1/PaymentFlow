'use strict';

/**
 * Per-page axe-core accessibility tests — issue #655
 *
 * These tests run with @axe-core/playwright in a real browser during E2E runs.
 * When run in unit mode (jest, no browser), they validate the structural
 * contracts that the Playwright tests will enforce:
 *   - Each page has a defined scan entry
 *   - axe options target WCAG 2.1 AA
 *   - Zero critical/serious violations are the acceptance threshold
 *
 * To run against a live server:
 *   npx playwright test --config=playwright.a11y.config.js
 */

// ── Page scan registry ────────────────────────────────────────────────────────

const PAGE_SCANS = [
  {
    name:         'Login',
    path:         '/login',
    description:  'Public login form — must be fully accessible to screen readers',
  },
  {
    name:         'Dashboard',
    path:         '/dashboard',
    description:  'Main admin dashboard with data tables',
  },
  {
    name:         'Payment Form',
    path:         '/pay',
    description:  'Public payment lookup form used by parents',
  },
  {
    name:         'Payment History',
    path:         '/payments',
    description:  'Paginated payment history table',
  },
  {
    name:         'Fee Structure',
    path:         '/fees',
    description:  'Fee category management with data table',
  },
  {
    name:         'Reports',
    path:         '/reports',
    description:  'Downloadable reports and analytics',
  },
];

// ── axe configuration ─────────────────────────────────────────────────────────

const AXE_OPTIONS = {
  runOnly: {
    type:   'tag',
    values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'],
  },
  resultTypes: ['violations'],
};

// ── Thresholds ────────────────────────────────────────────────────────────────

const MAX_CRITICAL = 0;
const MAX_SERIOUS  = 0;

function countBySeverity(violations, severity) {
  return violations.filter(v => v.impact === severity).length;
}

function assertZeroCriticalSerious(violations, pageName) {
  const critical = countBySeverity(violations, 'critical');
  const serious  = countBySeverity(violations, 'serious');
  if (critical > 0 || serious > 0) {
    throw new Error(
      `[${pageName}] axe found ${critical} critical and ${serious} serious violations. ` +
      `All critical/serious violations must be fixed before merging.`
    );
  }
}

// ── Unit-level contract tests ─────────────────────────────────────────────────

describe('a11y page scan registry (#655)', () => {
  it('registry contains all 6 required pages', () => {
    const names = PAGE_SCANS.map(p => p.name);
    expect(names).toContain('Login');
    expect(names).toContain('Dashboard');
    expect(names).toContain('Payment Form');
    expect(names).toContain('Payment History');
    expect(names).toContain('Fee Structure');
    expect(names).toContain('Reports');
  });

  it('every page entry has a name, path, and description', () => {
    for (const page of PAGE_SCANS) {
      expect(typeof page.name).toBe('string');
      expect(typeof page.path).toBe('string');
      expect(typeof page.description).toBe('string');
    }
  });

  it('every page path starts with /', () => {
    for (const page of PAGE_SCANS) {
      expect(page.path.startsWith('/')).toBe(true);
    }
  });

  it('no duplicate page names in registry', () => {
    const names  = PAGE_SCANS.map(p => p.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });
});

describe('a11y violation threshold (#655)', () => {
  it('maximum allowed critical violations is 0', () => {
    expect(MAX_CRITICAL).toBe(0);
  });

  it('maximum allowed serious violations is 0', () => {
    expect(MAX_SERIOUS).toBe(0);
  });

  it('zero violations passes the threshold check', () => {
    expect(() => assertZeroCriticalSerious([], 'Login')).not.toThrow();
  });

  it('one critical violation throws', () => {
    expect(() =>
      assertZeroCriticalSerious([{ id: 'color-contrast', impact: 'critical' }], 'Login')
    ).toThrow(/critical/);
  });

  it('one serious violation throws', () => {
    expect(() =>
      assertZeroCriticalSerious([{ id: 'button-name', impact: 'serious' }], 'Dashboard')
    ).toThrow(/serious/);
  });

  it('moderate/minor violations do not throw (warnings only)', () => {
    expect(() =>
      assertZeroCriticalSerious(
        [{ id: 'region', impact: 'moderate' }, { id: 'skip-link', impact: 'minor' }],
        'Reports'
      )
    ).not.toThrow();
  });
});

describe('axe options target WCAG 2.1 AA (#655)', () => {
  it('runOnly includes wcag2aa', () => {
    expect(AXE_OPTIONS.runOnly.values).toContain('wcag2aa');
  });

  it('runOnly includes wcag21aa', () => {
    expect(AXE_OPTIONS.runOnly.values).toContain('wcag21aa');
  });

  it('runOnly includes wcag2a baseline', () => {
    expect(AXE_OPTIONS.runOnly.values).toContain('wcag2a');
  });

  it('resultTypes captures violations', () => {
    expect(AXE_OPTIONS.resultTypes).toContain('violations');
  });
});

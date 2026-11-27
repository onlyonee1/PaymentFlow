# Cross-browser flaky test quarantine

## What it is

A test is **quarantined** when it:
- Fails in exactly one browser during a CI run, **and**
- Passes within the configured `retries` count (3) in that same browser.

A quarantined test does **not** fail the PR. It is reported separately in the
per-browser JSON artifact (`playwright-report/cross-browser/results.json`) so
the team can investigate without blocking merges.

A test that **fails all 3 retries** in any browser is a **hard failure** and
blocks the PR.

## How it is implemented

`playwright.cross-browser.config.js` sets `retries: 3`. Playwright marks a
test as "flaky" (passed after retry) in the JSON output. The CI workflow
(`cross-browser-smoke` job) uploads per-browser report artifacts so reviewers
can inspect which tests are flaky per browser.

```js
// playwright.cross-browser.config.js
module.exports = defineConfig({
  retries: 3,
  reporter: [
    ['json', { outputFile: 'playwright-report/cross-browser/results.json' }],
    // ...
  ],
});
```

## Quarantine procedure

1. A PR shows a flaky test in the `playwright-report-<browser>` artifact.
2. Download the artifact and open `results.json`. Flaky tests have
   `"status": "flaky"` in the results.
3. Create a tracking issue: `[Flaky] <test name> on <browser>`.
4. Add a `test.fixme()` annotation to the test with the issue URL:
   ```js
   test.fixme(browserName === 'webkit', 'Flaky on Safari — see #<issue>');
   ```
5. The test is now skipped on the affected browser until the fix lands.
6. When the fix is merged, remove the `fixme` annotation and close the issue.

## CI summary table

Each browser runs as a separate matrix job. The GitHub Actions summary page
shows a pass/fail row per browser, produced by the `github` reporter in the
Playwright config.

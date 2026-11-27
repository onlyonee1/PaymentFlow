/**
 * CI check: Verifies that every translation key present in the default English
 * locale (en.js) also exists in the other target locale files (e.g. fr.js, es.js).
 * Fails with a non-zero exit code if any keys are missing.
 */
const path = require('path');

function flatten(obj, prefix, out) {
  prefix = prefix || '';
  out = out || {};
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    const p = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, p, out);
    else out[p] = v;
  }
  return out;
}

async function run() {
  const enModule = await import('../frontend/src/i18n/locales/en.js');
  const enKeys = Object.keys(flatten(enModule.default));

  const targetLocales = ['fr', 'es'];
  let hasMissing = false;

  for (const locale of targetLocales) {
    const locModule = await import(`../frontend/src/i18n/locales/${locale}.js`);
    const locKeys = new Set(Object.keys(flatten(locModule.default)));

    const missing = enKeys.filter(k => !locKeys.has(k));
    if (missing.length > 0) {
      hasMissing = true;
      console.error(`[i18n-lint] Locale "${locale}" is missing ${missing.length} keys:`);
      console.error(missing.slice(0, 10).map(k => `  - ${k}`).join('\n'));
      if (missing.length > 10) console.error(`  ...and ${missing.length - 10} more`);
    } else {
      console.log(`✓ Locale "${locale}" has full translation parity with en (${locKeys.size}/${enKeys.length} keys)`);
    }
  }

  if (hasMissing) {
    console.error('[i18n-lint] Failed: missing translation keys detected.');
    process.exit(1);
  } else {
    console.log('[i18n-lint] All target locale files passed key parity check.');
  }
}

run().catch((err) => {
  console.error('[i18n-lint] Unexpected error:', err);
  process.exit(1);
});

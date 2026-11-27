import i18n from "../i18n";

/**
 * Resolves the currently active locale for Intl formatting.
 *
 * @param {string} [locale]
 * @returns {string|undefined}
 */
function resolveLocale(locale) {
  if (locale) return locale;
  if (typeof i18n !== "undefined" && i18n && i18n.resolvedLanguage) {
    return i18n.resolvedLanguage;
  }
  if (typeof window !== "undefined" && window.localStorage) {
    try {
      const stored = window.localStorage.getItem("locale");
      if (stored) return stored;
    } catch {}
  }
  return undefined;
}

/**
 * Formats a numeric amount as a localized currency string.
 *
 * @param {number} amount
 * @param {string|null|undefined} localCurrency - ISO 4217 currency code (e.g. "USD")
 * @param {string} [locale] - Optional locale override
 * @returns {string}
 */
export function formatCurrency(amount, localCurrency, locale) {
  if (!localCurrency) return `${amount}`;
  const effectiveLocale = resolveLocale(locale);
  try {
    return new Intl.NumberFormat(effectiveLocale, {
      style: "currency",
      currency: localCurrency,
    }).format(amount);
  } catch {
    return `${amount} ${localCurrency}`;
  }
}

/**
 * Formats a cryptocurrency or token amount (e.g. XLM or USDC) with locale-aware
 * grouping and decimal delimiters.
 *
 * @param {number|string} amount
 * @param {string} [assetCode="XLM"]
 * @param {string} [locale]
 * @returns {string}
 */
export function formatCryptoAmount(amount, assetCode = "XLM", locale) {
  const effectiveLocale = resolveLocale(locale);
  const num = Number(amount) || 0;
  try {
    const formatted = new Intl.NumberFormat(effectiveLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 7,
    }).format(num);
    return `${formatted} ${assetCode}`;
  } catch {
    return `${num} ${assetCode}`;
  }
}

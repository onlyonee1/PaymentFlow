# Multi-Currency Support (Issue #623)

## Overview

PaymentFlow supports fee collection in local fiat currencies (USD, NGN, GHS, etc.)
while Stellar transactions are denominated in XLM or USDC. This document describes
the live exchange-rate integration.

## Architecture

### Rate Provider
- **Primary**: CoinGecko `/api/v3/simple/price` for XLM and USDC prices.
- **Fallback**: Stale cache served when the feed is unavailable, so payment
  collection never hard-blocks on a price-feed outage.

### Caching
- Rates are cached in Redis (shared across replicas) with a **60-second TTL**.
- When Redis is unavailable, an in-process LRU map (bounded by
  `CURRENCY_LRU_MAX_SIZE`, default 100) provides per-replica caching.
- The cache is keyed by fiat currency code so USD, NGN, GHS, etc. are stored
  and invalidated independently.

### Decimal Precision
- All internal amounts use **stroops** (1 XLM = 10,000,000 stroops).
- Fiat conversion uses `decimal.js` to avoid IEEE 754 drift.
- Each currency applies its own decimal-place rule (e.g. JPY → 0 dp, KWD → 3 dp,
  USD/EUR/NGN → 2 dp). Rules are exported in `CURRENCY_DECIMALS`.

### Payment Intent Rate Lock
- On payment intent creation the current rate is captured via `captureFiatSnapshot`.
- The locked rate and its expiry (15 minutes, matching the intent TTL) are stored
  on the intent document.
- Payments submitted after the rate has expired are rejected with a prompt to
  refresh.

## API

### `GET /api/payments/rates`
Returns the current XLM and USDC rates for the school's local currency.

```json
{
  "available": true,
  "currency": "USD",
  "rates": { "XLM": 0.24, "USDC": 1.00 },
  "lastFetchedAt": "2026-01-15T12:00:00.000Z",
  "stale": false
}
```

## Service API

```js
const svc = require('./services/currencyConversionService');

// Convert crypto amount to fiat
const result = await svc.convertToLocalCurrency(10, 'XLM', 'USD');
// { available: true, localAmount: 2.40, rate: 0.24, currency: 'USD', rateTimestamp: ... }

// Enrich a payment object with fiat equivalent
const enriched = await svc.enrichPaymentWithConversion(payment, 'USD');

// Check CoinGecko response shape (for canary / contract tests)
const check = svc.checkCoinGeckoResponseShape(responseBody, 'usd');
// { ok: true } or { ok: false, reason: '...' }
```

## Configuration

| Variable | Default | Description |
|---|---|---|
| `ALLOWED_FIAT_CURRENCIES` | Built-in list | Comma-separated allowlist override |
| `CURRENCY_LRU_MAX_SIZE` | `100` | In-process LRU cap |
| `DEFAULT_FIAT_CURRENCY` | `USD` | Currency used when school has no preference set |
| `PAYMENT_INTENT_TTL_MS` | `900000` (15 min) | Intent + rate-lock lifetime |

## Tests

| File | Coverage |
|---|---|
| `tests/currencyConversion.test.js` | Service unit tests including LRU, allowlist, Decimal precision |
| `tests/currencyService.test.js` | Frontend cache wrapper (`cached` flag correctness) |
| `tests/coinGeckoContract.test.js` | API shape contract + canary |
| `tests/multi-asset-support.test.js` | XLM / USDC asset detection and conversion |
| `tests/decimalPrecisionAPI.test.js` | Decimal utility: stroops, rounding, Joi integration |

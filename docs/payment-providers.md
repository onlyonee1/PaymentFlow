# Payment providers

PaymentFlow loads the Stellar wallet adapter by default. At startup, set
`PAYMENT_PROVIDERS_JSON` to select the compiled-in adapters and configure their
circuit breakers and submission and status-query retries. For example:

```json
{
  "stellar_wallet": {
    "circuitBreaker": { "failureThreshold": 5, "resetTimeoutMs": 30000, "successThreshold": 2 },
    "retry": { "maxAttempts": 3, "baseDelay": 1000 }
  }
}
```

Send an `enabledPaymentProviders` array to the admin school update endpoint
(`PATCH /api/schools/:schoolId`) to restrict that school to specific adapters. An omitted field inherits the configured
providers and an empty array disables provider operations for the school.
Startup logs warnings for school provider names that cannot be resolved.

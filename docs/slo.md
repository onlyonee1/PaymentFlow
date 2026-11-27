# Service Level Objectives

| Indicator | Target | Window |
| --- | --- | --- |
| API availability | At least 99.9% non-5xx responses | Rolling 30 days |
| API server error rate | Below 0.1% | Rolling five minutes |
| Payment intent creation, `POST /api/payments/intent` | P95 below 500 ms | Rolling five minutes |
| Payment list, `GET /api/payments` | P95 below 300 ms | Rolling five minutes |

A 99.9% target allows 43.2 minutes of equivalent full outage per 30 days, or about 8.76 hours per 365 days. The request-based budget is exhausted when 0.1% of requests fail during the 30-day window. A complete outage with no HTTP responses needs external availability probes.

Prometheus pages when both the five-minute and one-hour windows exceed 14.4× burn. It warns when both the 30-minute and six-hour windows exceed 6× burn. The five-minute error-rate warning tracks the immediate target independently. The provisioned Grafana SLO dashboard shows the rolling budget remaining, burn rates, and endpoint latency. [Google SRE Workbook](https://sre.google/workbook/alerting-on-slos/)

The [staging baseline record](performance/baseline-2026-11-23.md) is awaiting measurements and team-lead approval. See [SLO definitions](slo-definitions.md) for the operational objectives and runbooks.

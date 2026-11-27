# Payment metrics retention

Hourly payment metrics are eligible for MongoDB TTL expiry at 90 days. The
leader runs the archival job at 02:00 UTC and marks eligible hours for expiry
only after their daily rollup exists. The unique school and UTC day key makes
archival safe to rerun. Daily rollups retain three years by default. Monthly
rollups continue to provide all-time totals.

Export the backend's metrics token as `METRICS_BEARER_TOKEN` in the shell
running the monitoring Compose stack. The Payments dashboard uses the provisioned
Payment Rollups data source to read daily counts independently of Prometheus
sample retention. Override `PAYMENT_METRICS_ORIGIN` if the backend is on a
different host. The chart covers stored daily history from the existing metrics
collection. Previously expired days cannot be recovered from rollups.

To measure storage after deploying, capture the document counts and logical
data sizes of the hourly and daily collections at deployment and again after
seven days. Compare equivalent write volumes and report whether any hourly
buckets crossed the TTL boundary during the measurement.

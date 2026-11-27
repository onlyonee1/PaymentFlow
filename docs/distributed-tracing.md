# Distributed tracing

The backend starts OpenTelemetry before loading Express, MongoDB or Redis.
The frontend API client sends W3C trace context to the backend origin.
Payment verification carries the same context into the MongoDB retry queue
and BullMQ, including re-enqueue after restart. Each attempt has its own span.
See the [W3C Trace Context specification](https://www.w3.org/TR/trace-context/)
and [OpenTelemetry Node.js setup guide](https://opentelemetry.io/docs/languages/js/getting-started/nodejs/).

## Local development

Start the monitoring stack with
`docker compose -f docker-compose.monitoring.yml up -d` and start the
backend using its normal entry point. The default OTLP/HTTP endpoint is
`http://localhost:4318`. A backend running in a container must set
`OTEL_EXPORTER_OTLP_ENDPOINT` to an address reachable from that container.

Open Jaeger at http://localhost:16686 or choose Tempo in Grafana Explore.
To find a recorded payment, search with
`{ span.paymentId = "PAYMENT_ID" }` or
`{ span.schoolId = "SCHOOL_ID" }` in TraceQL.
The payment ID becomes available when the backend identifies or creates
the payment record.

## Production

Set `OTEL_EXPORTER_OTLP_ENDPOINT` to the collector base URL or
`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` to the complete traces URL.
Set `OTEL_EXPORTER_OTLP_HEADERS` for collector authentication when required.
The batch exporter uses HTTP with protobuf by default.

The default trace sampling rate is 100% in development and 5% in production.
Set `OTEL_TRACES_SAMPLER_ARG` to a fraction between 0 and 1 to override
the rate. By default the backend applies the chosen ratio at public HTTP
ingress and workers follow the producer's decision. Setting
`OTEL_TRACES_SAMPLER` opts into the SDK's named sampling policy instead.
Production without a collector endpoint starts without tracing export.
Set `OTEL_SDK_DISABLED=true` to disable instrumentation.

To verify overhead, compare request P99 on the same workload and dataset
with the SDK disabled and with the production sampling configuration and
collector enabled. The overhead target is a difference below 1 ms.

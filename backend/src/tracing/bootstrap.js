'use strict';

let sdk;

if (process.env.NODE_ENV !== 'test' && process.env.OTEL_SDK_DISABLED !== 'true') {
  // Set defaults before loading the SDK and before loading instrumented modules.
  const production = process.env.NODE_ENV === 'production';
  process.env.OTEL_SERVICE_NAME ||= 'paymentflow-backend';
  process.env.OTEL_TRACES_EXPORTER ||= production && !(
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT || process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
  ) ? 'none' : 'otlp';
  process.env.OTEL_EXPORTER_OTLP_PROTOCOL ||= 'http/protobuf';
  process.env.OTEL_METRICS_EXPORTER ||= 'none';
  process.env.OTEL_LOGS_EXPORTER ||= 'none';
  process.env.OTEL_PROPAGATORS ||= 'tracecontext';
  process.env.OTEL_NODE_ENABLED_INSTRUMENTATIONS ||= 'http,express,mongodb,ioredis';

  const { NodeSDK } = require('@opentelemetry/sdk-node');
  const { ParentBasedSampler, TraceIdRatioBasedSampler } = require('@opentelemetry/sdk-node').tracing;
  const { SpanKind, trace } = require('@opentelemetry/api');
  const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');

  if (process.env.OTEL_TRACES_EXPORTER !== 'none') {
    const configuredRatio = Number(process.env.OTEL_TRACES_SAMPLER_ARG || NaN);
    const ratio = configuredRatio >= 0 && configuredRatio <= 1 ? configuredRatio : production ? 0.05 : 1;
    const root = new TraceIdRatioBasedSampler(ratio);
    const parentBased = new ParentBasedSampler({ root });
    // Public HTTP callers can supply correlation context but do not choose
    // the service's sample rate. Workers honor the producer's sampled flag.
    const sampler = process.env.OTEL_TRACES_SAMPLER ? undefined : {
      shouldSample(parent, id, name, kind, attributes, links) {
        const policy = kind === SpanKind.SERVER && trace.getSpanContext(parent)?.isRemote
          ? root : parentBased;
        return policy.shouldSample(parent, id, name, kind, attributes, links);
      },
      toString: () => `PaymentFlow HTTP sampling (${ratio})`,
    };

    sdk = new NodeSDK({ sampler, instrumentations: getNodeAutoInstrumentations() });
    sdk.start();
  }
}

async function shutdownTracing() {
  await sdk?.shutdown();
}

module.exports = { shutdownTracing };

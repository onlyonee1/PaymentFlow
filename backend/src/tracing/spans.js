'use strict';

const { context, propagation, ROOT_CONTEXT, SpanKind, SpanStatusCode, trace } = require('@opentelemetry/api');

const tracer = trace.getTracer('paymentflow');

function setTraceAttributes(attributes) {
  const span = trace.getActiveSpan();
  if (!span?.isRecording()) return;
  for (const [key, value] of Object.entries(attributes)) {
    if (value != null) span.setAttribute(key, String(value));
  }
}

function captureTraceContext() {
  const carrier = {};
  propagation.inject(context.active(), carrier);
  return carrier.traceparent ? carrier : undefined;
}

function withSpan(name, work, options = {}, parent = context.active()) {
  return tracer.startActiveSpan(name, options, parent, async (span) => {
    try {
      return await work();
    } catch (error) {
      span.setStatus({ code: SpanStatusCode.ERROR });
      if (typeof error?.code === 'string') span.setAttribute('error.type', error.code);
      throw error;
    } finally {
      span.end();
    }
  });
}

function runTracedJob(name, data, work) {
  const parent = propagation.extract(ROOT_CONTEXT, data.traceContext || {});
  const attributes = data.schoolId ? { schoolId: data.schoolId } : {};
  if (data.paymentId) attributes.paymentId = String(data.paymentId);
  return withSpan(name, work, { kind: SpanKind.CONSUMER, attributes }, parent);
}

module.exports = { captureTraceContext, runTracedJob, setTraceAttributes, withSpan };

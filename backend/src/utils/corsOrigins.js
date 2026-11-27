'use strict';

function parseAllowedOrigins() {
  const raw = process.env.ALLOWED_ORIGIN ?? 'http://localhost:3000';

  // Wildcard is never safe when credentials:true is used
  if (raw.split(',').some((origin) => origin.trim() === '*')) {
    throw new Error(
      'ALLOWED_ORIGIN wildcard (*) is not permitted when credentials:true is enabled. ' +
      'Specify explicit origins instead.'
    );
  }

  const origins = raw.split(',').map((o) => o.trim()).filter(Boolean);

  if (origins.length === 0) {
    throw new Error(
      'ALLOWED_ORIGIN must contain at least one valid origin URL. ' +
      'Example: ALLOWED_ORIGIN=https://app.school.com'
    );
  }

  for (const origin of origins) {
    try {
      const url = new URL(origin);
      if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
        throw new Error('Expected a canonical HTTP(S) origin');
      }
    } catch {
      throw new Error(`ALLOWED_ORIGIN contains invalid URL: "${origin}"`);
    }
  }

  return origins.length === 1 ? origins[0] : origins;
}

function createOriginPolicy() {
  const environment = process.env.CORS_ENV || process.env.NODE_ENV || 'development';
  const configured = [].concat(parseAllowedOrigins());
  let origins;
  let previewPattern;
  switch (environment) {
    case 'production':
      if (configured.length !== 1 || !configured[0].startsWith('https://')) {
        throw new Error('Production ALLOWED_ORIGIN must be one HTTPS frontend origin');
      }
      origins = configured;
      break;
    case 'staging':
      if (configured.some((origin) => !origin.startsWith('https://'))) {
        throw new Error('Staging ALLOWED_ORIGIN must contain HTTPS frontend origins');
      }
      origins = configured;
      if (process.env.CORS_ALLOWED_ORIGIN_PATTERN) {
        previewPattern = new RegExp(
          `^(?:${process.env.CORS_ALLOWED_ORIGIN_PATTERN})$`
        );
      }
      break;
    case 'development':
    case 'test':
      origins = ['http://localhost:3000'];
      break;
    default:
      throw new Error(`Unknown CORS environment: ${environment}`);
  }

  return (origin, callback) => {
    let allowed = origins.includes(origin);
    if (!allowed && previewPattern && typeof origin === 'string') {
      try {
        const url = new URL(origin);
        allowed = url.protocol === 'https:' && url.origin === origin && previewPattern.test(origin);
      } catch {
        allowed = false;
      }
    }
    callback(null, allowed);
  };
}

module.exports = { parseAllowedOrigins, createOriginPolicy };

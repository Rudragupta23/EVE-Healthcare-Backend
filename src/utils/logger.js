'use strict';

const pino = require('pino');
const config = require('../config');

// Structured JSON logs. Sensitive fields are redacted so they never reach log storage.
const logger = pino({
  level: config.logLevel,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-webhook-signature"]',
      '*.password',
      '*.password_hash',
      '*.token',
    ],
    censor: '[REDACTED]',
  },
});

module.exports = logger;

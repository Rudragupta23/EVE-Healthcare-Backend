'use strict';

const crypto = require('crypto');

// Webhook signatures: "sha256=" + HMAC-SHA256(raw request body, shared secret) in hex.
const sign = (rawBody, secret) => `sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`;

function isValidSignature(rawBody, header, secret) {
  if (!rawBody || typeof header !== 'string') return false;
  const expected = Buffer.from(sign(rawBody, secret));
  const received = Buffer.from(header.trim());
  // Constant-time compare so the signature cannot be guessed byte by byte from response timings.
  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

// JSON with sorted keys, so the same event re-sent with a different key order still hashes the same.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

module.exports = { sign, isValidSignature, stableStringify, sha256 };

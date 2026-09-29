'use strict';

/**
 * Sends a correctly signed webhook to the running API, acting as the payment provider.
 *
 *   npm run webhook -- <provider_ref> <SUCCESS|FAILED> <amount_paise> [event_id]
 *
 * Run it twice with the same event_id to see idempotency: the second reply says "duplicate": true.
 */
require('dotenv').config({ quiet: true });
const crypto = require('crypto');
const { sign } = require('../src/utils/signature');

async function main() {
  const [providerRef, status, amount, eventId] = process.argv.slice(2);
  if (!providerRef || !['SUCCESS', 'FAILED'].includes((status || '').toUpperCase()) || !amount) {
    console.log('Usage: npm run webhook -- <provider_ref> <SUCCESS|FAILED> <amount_paise> [event_id]');
    process.exit(1);
  }

  const body = JSON.stringify({
    event_id: eventId || `evt_${crypto.randomBytes(8).toString('hex')}`,
    type: status.toUpperCase() === 'SUCCESS' ? 'payment.succeeded' : 'payment.failed',
    data: { provider_ref: providerRef, amount_paise: Number(amount), ...(status.toUpperCase() === 'FAILED' ? { failure_reason: 'Insufficient funds (simulated)' } : {}) },
  });

  const url = process.env.WEBHOOK_TARGET_URL || `http://localhost:${process.env.PORT || 3000}/payments/webhook/`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Webhook-Signature': sign(body, process.env.WEBHOOK_SECRET) },
    body,
  });
  console.log(`POST ${url}\n> ${body}\n< ${res.status} ${await res.text()}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});

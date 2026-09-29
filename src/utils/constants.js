'use strict';

const CURRENCY = 'INR'; // money is stored as integer paise (₹450.00 -> 45000)

const ROLES = Object.freeze({ USER: 'USER', ADMIN: 'ADMIN' });

const BOOKING_STATUS = Object.freeze({
  PENDING: 'PENDING',
  CONFIRMED: 'CONFIRMED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
});

const PAYMENT_STATUS = Object.freeze({
  PENDING: 'PENDING', // waiting for the provider's webhook
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
});

const WEBHOOK_EVENT_STATUS = Object.freeze({
  PROCESSING: 'PROCESSING',
  PROCESSED: 'PROCESSED',
  FAILED: 'FAILED', // processing crashed; the provider's retry will pick it up again
});

module.exports = { CURRENCY, ROLES, BOOKING_STATUS, PAYMENT_STATUS, WEBHOOK_EVENT_STATUS };

'use strict';

const Joi = require('joi');
const { PAYMENT_STATUS } = require('../../utils/constants');

const uuid = Joi.string().guid();

const createPayment = {
  body: Joi.object({
    booking_id: uuid.required(),
    // Only for the simulation: pick what the fake gateway should do. Defaults to SUCCESS.
    simulate_outcome: Joi.string().valid(...Object.values(PAYMENT_STATUS)).default(PAYMENT_STATUS.SUCCESS),
  }),
};

// Optional header. Same key + same request = the original response is returned, nothing new is created.
const idempotencyKey = Joi.string().trim().min(8).max(128).pattern(/^[A-Za-z0-9_\-:.]+$/);

const paymentIdParam = { params: Joi.object({ id: uuid.required() }) };

const EVENT_TYPES = Object.freeze({
  'payment.succeeded': PAYMENT_STATUS.SUCCESS,
  'payment.failed': PAYMENT_STATUS.FAILED,
});

// Unknown extra fields are allowed: real providers add fields over time and that must not break us.
const webhookEvent = Joi.object({
  event_id: Joi.string().trim().min(1).max(128).required(),
  type: Joi.string().valid(...Object.keys(EVENT_TYPES)).required(),
  data: Joi.object({
    provider_ref: Joi.string().trim().max(64).required(),
    amount_paise: Joi.number().integer().min(1).required(),
    failure_reason: Joi.string().max(255),
  })
    .unknown(true)
    .required(),
}).unknown(true);

module.exports = { createPayment, idempotencyKey, paymentIdParam, webhookEvent, EVENT_TYPES };

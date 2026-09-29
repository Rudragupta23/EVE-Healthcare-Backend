'use strict';

const { Router } = require('express');
const validate = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { badRequest, unauthorized } = require('../../utils/errors');
const { isValidSignature } = require('../../utils/signature');
const serialize = require('../../utils/serializers');
const config = require('../../config');
const schemas = require('./payments.schemas');
const service = require('./payments.service');
const webhook = require('./webhook.service');

const router = Router();

// ---------- webhook (called by the payment provider, not by users: no JWT, signature instead) ----------
function verifySignature(req, res, next) {
  if (!isValidSignature(req.rawBody, req.get('x-webhook-signature'), config.webhookSecret)) {
    return next(unauthorized('Invalid webhook signature'));
  }
  return next();
}

router.post('/webhook', verifySignature, validate({ body: schemas.webhookEvent }), async (req, res) => {
  const result = await webhook.handleEvent(req.valid.body);
  req.log.info({ eventId: req.valid.body.event_id, ...result }, 'Webhook handled');
  res.json({ received: true, event_id: req.valid.body.event_id, ...result });
});

// ---------- user-facing payment endpoints ----------
router.post('/', authenticate, validate(schemas.createPayment), async (req, res) => {
  const rawKey = req.get('idempotency-key');
  let idempotencyKey;
  if (rawKey !== undefined) {
    const { value, error } = schemas.idempotencyKey.validate(rawKey);
    if (error) throw badRequest('Invalid Idempotency-Key header', [{ in: 'headers', field: 'Idempotency-Key', message: error.message }]);
    idempotencyKey = value;
  }

  const { payment, booking, replayed } = await service.createPayment(req.user, req.valid.body, idempotencyKey);
  if (replayed) res.set('Idempotent-Replayed', 'true');
  res.status(replayed ? 200 : 201).json({ payment: serialize.payment(payment), booking_status: booking.status });
});

router.get('/:id', authenticate, validate(schemas.paymentIdParam), async (req, res) => {
  res.json(serialize.payment(await service.getPayment(req.user, req.valid.params.id)));
});

module.exports = router;

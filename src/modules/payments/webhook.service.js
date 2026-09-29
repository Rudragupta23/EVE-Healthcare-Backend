'use strict';

const { sequelize, Booking, Payment, WebhookEvent } = require('../../models');
const { notFound, conflict } = require('../../utils/errors');
const { WEBHOOK_EVENT_STATUS } = require('../../utils/constants');
const { stableStringify, sha256 } = require('../../utils/signature');
const logger = require('../../utils/logger');
const payments = require('./payments.service');
const { EVENT_TYPES } = require('./payments.schemas');

/**
 * POST /payments/webhook/  (signature already verified, body already validated)
 *
 * How idempotency works:
 *  1. Each event is stored once, keyed by the provider's event_id (UNIQUE in the database).
 *  2. The event row is locked while it is processed, so the same event arriving twice at the
 *     same moment is processed by one request; the other waits and then sees "already processed".
 *  3. Recording the event and changing the payment/booking happen in ONE transaction:
 *     either both are saved or neither is. There is no "processed but not applied" state.
 *  4. If processing crashes, everything rolls back, the event is marked FAILED with the error,
 *     and we return 500. The provider retries, and the retry processes it again from scratch.
 */
async function handleEvent(event) {
  const payloadHash = sha256(stableStringify(event));
  const reportedStatus = EVENT_TYPES[event.type];
  const { provider_ref: providerRef, amount_paise: amountPaise, failure_reason: failureReason } = event.data;

  // Unknown payment reference: reject without storing anything (nothing of ours to update).
  const known = await Payment.findOne({ where: { providerRef }, attributes: ['id', 'bookingId'] });
  if (!known) throw notFound('Payment for this provider_ref');

  try {
    return await sequelize.transaction(async (transaction) => {
      // Insert the event if it is new. If it already exists this does nothing (ON CONFLICT DO NOTHING).
      await WebhookEvent.bulkCreate(
        [{ eventId: event.event_id, eventType: event.type, providerRef, payloadHash, payload: event }],
        { ignoreDuplicates: true, transaction }
      );
      const record = await WebhookEvent.findOne({
        where: { eventId: event.event_id },
        lock: transaction.LOCK.UPDATE,
        transaction,
      });

      if (record.payloadHash !== payloadHash) {
        throw conflict('EVENT_ID_REUSED', 'This event_id was already received with a different payload');
      }
      if (record.status === WEBHOOK_EVENT_STATUS.PROCESSED) {
        return { duplicate: true, outcome: record.outcome, attempts: record.attempts };
      }

      // Lock booking, then payment: the same order as POST /payments/, so they can never deadlock.
      const booking = await Booking.findByPk(known.bookingId, { lock: transaction.LOCK.UPDATE, transaction });
      const payment = await Payment.findByPk(known.id, { lock: transaction.LOCK.UPDATE, transaction });

      let outcome;
      if (amountPaise !== payment.amountPaise) {
        // Never trust a mismatched amount. Acknowledge the event (so the provider stops retrying)
        // but change nothing, and log loudly so a person can look into it.
        logger.error({ eventId: event.event_id, expected: payment.amountPaise, reported: amountPaise }, 'Webhook amount mismatch');
        outcome = payments.OUTCOME.AMOUNT_MISMATCH;
      } else {
        outcome = await payments.applyProviderResult({ booking, payment, status: reportedStatus, failureReason, transaction });
      }

      await record.update(
        {
          status: WEBHOOK_EVENT_STATUS.PROCESSED,
          outcome,
          attempts: record.attempts + 1,
          lastError: null,
          processedAt: new Date(),
        },
        { transaction }
      );
      return { duplicate: false, outcome, attempts: record.attempts };
    });
  } catch (err) {
    if (err.status && err.status < 500) throw err; // a deliberate 4xx, not a crash

    // The transaction rolled back, so no partial change was saved. Record the failure outside it,
    // so the event is visible for debugging and the provider's retry can process it again.
    await recordFailure(event, { providerRef, payloadHash, error: err }).catch((recordErr) =>
      logger.error({ err: recordErr }, 'Could not record webhook failure')
    );
    throw err;
  }
}

async function recordFailure(event, { providerRef, payloadHash, error }) {
  await sequelize.query(
    `INSERT INTO webhook_events (event_id, event_type, provider_ref, payload_hash, payload, status, attempts, last_error)
     VALUES (:eventId, :eventType, :providerRef, :payloadHash, CAST(:payload AS jsonb), 'FAILED', 1, :lastError)
     ON CONFLICT (event_id) DO UPDATE
       SET status = 'FAILED', attempts = webhook_events.attempts + 1, last_error = EXCLUDED.last_error, updated_at = now()
       WHERE webhook_events.status <> 'PROCESSED'`,
    {
      replacements: {
        eventId: event.event_id,
        eventType: event.type,
        providerRef,
        payloadHash,
        payload: JSON.stringify(event),
        lastError: String(error.message || error).slice(0, 1000),
      },
    }
  );
}

module.exports = { handleEvent };

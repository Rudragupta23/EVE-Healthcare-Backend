'use strict';

const { sequelize, Booking, Payment } = require('../../models');
const { notFound, conflict, unprocessable } = require('../../utils/errors');
const { BOOKING_STATUS, PAYMENT_STATUS, ROLES } = require('../../utils/constants');
const { canTransition } = require('../bookings/bookingStateMachine');
const logger = require('../../utils/logger');
const provider = require('./mockProvider');

/**
 * What happened when a payment result was applied. Stored on webhook events for auditing.
 */
const OUTCOME = Object.freeze({
  APPLIED: 'APPLIED', // payment moved from PENDING to its final status and the booking followed
  NO_CHANGE: 'NO_CHANGE', // payment already had this exact status (e.g. a repeated notification)
  STATUS_CONFLICT: 'STATUS_CONFLICT', // payment is already final with a DIFFERENT status: never overwritten
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH', // provider reported a different amount: not applied, needs a human
});

const BOOKING_STATUS_FOR = {
  [PAYMENT_STATUS.SUCCESS]: BOOKING_STATUS.CONFIRMED,
  [PAYMENT_STATUS.FAILED]: BOOKING_STATUS.FAILED,
};

/**
 * The ONE place where a payment result changes the database. Used by both the synchronous
 * mock charge and the webhook, so the two paths can never disagree.
 *
 * Caller must hold row locks on the booking and then the payment (always in that order,
 * everywhere, so two requests can never deadlock each other).
 */
async function applyProviderResult({ booking, payment, status, failureReason, transaction }) {
  if (payment.status === status) return OUTCOME.NO_CHANGE;

  if (payment.status !== PAYMENT_STATUS.PENDING) {
    // e.g. a late "failed" event for a payment that already succeeded. A final status is final.
    logger.warn({ paymentId: payment.id, current: payment.status, reported: status }, 'Conflicting payment status ignored');
    return OUTCOME.STATUS_CONFLICT;
  }

  await payment.update(
    { status, failureReason: status === PAYMENT_STATUS.FAILED ? failureReason || 'Payment failed' : null },
    { transaction }
  );

  const target = BOOKING_STATUS_FOR[status];
  if (canTransition(booking.status, target)) {
    await booking.update({ status: target }, { transaction });
  } else {
    // Should not happen (a booking with a pending payment cannot be cancelled), but if it ever does
    // we keep the payment record correct and leave the booking alone rather than corrupt it.
    logger.error({ bookingId: booking.id, from: booking.status, to: target }, 'Booking could not follow payment result');
  }
  return OUTCOME.APPLIED;
}

/**
 * POST /payments/
 * Returns { payment, booking, replayed } — replayed=true when an Idempotency-Key matched an earlier request.
 */
async function createPayment(user, { booking_id: bookingId, simulate_outcome: simulateOutcome }, idempotencyKey) {
  return sequelize.transaction(async (transaction) => {
    // 1. Lock the booking. Any other payment or cancel request for it now waits for us.
    const booking = await Booking.findOne({
      where: { id: bookingId, userId: user.id },
      lock: transaction.LOCK.UPDATE,
      transaction,
    });
    if (!booking) throw notFound('Booking');

    // 2. Idempotency-Key replay. Checked AFTER taking the lock so two identical requests sent at the
    //    same moment are handled one after the other, and the second one sees the first one's result.
    if (idempotencyKey) {
      const previous = await Payment.findOne({ where: { userId: user.id, idempotencyKey }, transaction });
      if (previous) {
        if (previous.bookingId !== bookingId) {
          throw unprocessable('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used for a different booking');
        }
        return { payment: previous, booking, replayed: true };
      }
    }

    // 3. One payment per booking (also enforced by a UNIQUE constraint on payments.booking_id).
    const existing = await Payment.findOne({ where: { bookingId }, transaction });
    if (existing) {
      throw conflict('PAYMENT_ALREADY_EXISTS', 'This booking already has a payment', {
        payment_id: existing.id,
        payment_status: existing.status,
      });
    }

    if (booking.status !== BOOKING_STATUS.PENDING) {
      throw conflict('BOOKING_NOT_PAYABLE', `A ${booking.status} booking cannot be paid for`, {
        booking_status: booking.status,
      });
    }
    if (booking.appointmentAt <= new Date()) {
      throw unprocessable('APPOINTMENT_IN_PAST', 'The appointment time has already passed');
    }

    // 4. Record the attempt first, then "charge". Amount comes from the booking, never from the client.
    const payment = await Payment.create(
      {
        bookingId,
        userId: user.id,
        amountPaise: booking.amountPaise,
        currency: booking.currency,
        status: PAYMENT_STATUS.PENDING,
        providerRef: provider.newProviderRef(),
        idempotencyKey: idempotencyKey || null,
      },
      { transaction }
    );

    // The mock answers instantly, so it runs inside the transaction. With a real gateway the network
    // call would happen outside it, and the result would be applied the same way the webhook does.
    const result = provider.charge({ amountPaise: payment.amountPaise, simulateOutcome });
    if (result.status !== PAYMENT_STATUS.PENDING) {
      await applyProviderResult({ booking, payment, status: result.status, failureReason: result.failureReason, transaction });
    }

    return { payment, booking, replayed: false };
  });
}

async function getPayment(user, id) {
  const where = user.role === ROLES.ADMIN ? { id } : { id, userId: user.id };
  const payment = await Payment.findOne({ where });
  if (!payment) throw notFound('Payment');
  return payment;
}

module.exports = { createPayment, getPayment, applyProviderResult, OUTCOME };

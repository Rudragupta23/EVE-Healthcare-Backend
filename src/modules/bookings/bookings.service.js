'use strict';

const { UniqueConstraintError } = require('sequelize');
const { sequelize, Booking, Centre, Test, CentreTest, Payment } = require('../../models');
const { notFound, conflict, unprocessable } = require('../../utils/errors');
const { toOffset } = require('../../utils/pagination');
const { BOOKING_STATUS, PAYMENT_STATUS, ROLES, CURRENCY } = require('../../utils/constants');
const { canTransition } = require('./bookingStateMachine');

const withDetails = [
  { model: Centre, as: 'centre', attributes: ['id', 'name', 'city'] },
  { model: Test, as: 'test', attributes: ['id', 'name'] },
  { model: Payment, as: 'payment' },
];

// Admins can see every booking; everyone else only sees their own.
const visibleTo = (user) => (user.role === ROLES.ADMIN ? {} : { userId: user.id });

async function createBooking(user, { centre_id: centreId, test_id: testId, appointment_at: appointmentAt }) {
  const centre = await Centre.findByPk(centreId, { attributes: ['id'] });
  if (!centre) throw notFound('Diagnostic centre');

  const offer = await CentreTest.findOne({ where: { centreId, testId } });
  if (!offer || !offer.isAvailable) {
    throw unprocessable('TEST_NOT_OFFERED', 'This centre does not currently offer the selected test');
  }

  try {
    const booking = await Booking.create({
      userId: user.id,
      centreId,
      testId,
      appointmentAt,
      amountPaise: offer.pricePaise, // price always comes from the database, never from the client
      currency: CURRENCY,
      status: BOOKING_STATUS.PENDING,
    });
    return getBooking(user, booking.id);
  } catch (err) {
    // Backed by the partial unique index "bookings_no_duplicate_active".
    if (err instanceof UniqueConstraintError) {
      throw conflict('DUPLICATE_BOOKING', 'You already have an active booking for this test, centre and time');
    }
    throw err;
  }
}

async function listBookings(user, { page, limit, status }) {
  return Booking.findAndCountAll({
    where: { ...visibleTo(user), ...(status ? { status } : {}) },
    include: withDetails,
    order: [['createdAt', 'DESC']],
    distinct: true,
    ...toOffset({ page, limit }),
  });
}

async function getBooking(user, id) {
  const booking = await Booking.findOne({ where: { id, ...visibleTo(user) }, include: withDetails });
  // Someone else's booking gets the same 404 as a missing one, so ids cannot be probed.
  if (!booking) throw notFound('Booking');
  return booking;
}

async function cancelBooking(user, id) {
  await sequelize.transaction(async (transaction) => {
    // Row lock: a payment for this booking cannot be created or confirmed while we decide.
    const booking = await Booking.findOne({ where: { id, userId: user.id }, lock: transaction.LOCK.UPDATE, transaction });
    if (!booking) throw notFound('Booking');

    if (booking.status === BOOKING_STATUS.CANCELLED) return; // already cancelled: repeat calls are harmless

    const payment = await Payment.findOne({ where: { bookingId: id }, transaction });
    if (payment?.status === PAYMENT_STATUS.PENDING) {
      throw conflict('PAYMENT_IN_PROGRESS', 'A payment for this booking is still being processed; try again once it completes');
    }
    if (!canTransition(booking.status, BOOKING_STATUS.CANCELLED)) {
      throw conflict('INVALID_STATE_TRANSITION', `A ${booking.status} booking cannot be cancelled`, {
        current_status: booking.status,
      });
    }

    await booking.update({ status: BOOKING_STATUS.CANCELLED, cancelledAt: new Date() }, { transaction });
  });

  return getBooking(user, id);
}

module.exports = { createBooking, listBookings, getBooking, cancelBooking };

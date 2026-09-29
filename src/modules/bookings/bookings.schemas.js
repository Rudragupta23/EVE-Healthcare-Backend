'use strict';

const Joi = require('joi');
const { paginationQuery } = require('../../utils/pagination');
const { BOOKING_STATUS } = require('../../utils/constants');

const uuid = Joi.string().guid();
const MAX_DAYS_AHEAD = 90;

// Appointment time must be a full ISO 8601 date-time WITH a timezone (e.g. "Z" or "+05:30"),
// so "10:00" can never be misread as 10:00 in the server's timezone.
const appointmentAt = Joi.string()
  .pattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,3})?)?(Z|[+-]\d{2}:\d{2})$/, 'ISO 8601 date-time with timezone')
  .custom((value, helpers) => {
    const when = new Date(value);
    if (Number.isNaN(when.getTime())) return helpers.error('any.invalid');
    const now = Date.now();
    if (when.getTime() <= now) return helpers.message('appointment_at must be in the future');
    if (when.getTime() > now + MAX_DAYS_AHEAD * 24 * 60 * 60 * 1000) {
      return helpers.message(`appointment_at must be within the next ${MAX_DAYS_AHEAD} days`);
    }
    return when; // hand the service a real Date
  });

const createBooking = {
  body: Joi.object({
    centre_id: uuid.required(),
    test_id: uuid.required(),
    appointment_at: appointmentAt.required(),
  }),
};

const listBookings = {
  query: Joi.object({ ...paginationQuery, status: Joi.string().valid(...Object.values(BOOKING_STATUS)) }),
};

const bookingIdParam = { params: Joi.object({ id: uuid.required() }) };

module.exports = { createBooking, listBookings, bookingIdParam, MAX_DAYS_AHEAD };

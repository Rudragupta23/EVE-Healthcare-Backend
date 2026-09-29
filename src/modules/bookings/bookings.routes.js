'use strict';

const { Router } = require('express');
const validate = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { paginated } = require('../../utils/pagination');
const serialize = require('../../utils/serializers');
const schemas = require('./bookings.schemas');
const service = require('./bookings.service');

const router = Router();
router.use(authenticate); // every booking route needs a logged-in user

router.post('/', validate(schemas.createBooking), async (req, res) => {
  const booking = await service.createBooking(req.user, req.valid.body);
  res.status(201).location(`/bookings/${booking.id}`).json(serialize.booking(booking));
});

router.get('/', validate(schemas.listBookings), async (req, res) => {
  const { rows, count } = await service.listBookings(req.user, req.valid.query);
  res.json(paginated(rows.map(serialize.booking), count, req.valid.query));
});

router.get('/:id', validate(schemas.bookingIdParam), async (req, res) => {
  res.json(serialize.booking(await service.getBooking(req.user, req.valid.params.id)));
});

router.post('/:id/cancel', validate(schemas.bookingIdParam), async (req, res) => {
  res.json(serialize.booking(await service.cancelBooking(req.user, req.valid.params.id)));
});

module.exports = router;

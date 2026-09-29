'use strict';

const { api, resetDb, signupUser, createAdmin, createCatalog, createBooking, inDays, sequelize } = require('../helpers');
const { CentreTest, Booking } = require('../../src/models');

let catalog;
let alice;
let bob;

beforeEach(async () => {
  await resetDb();
  catalog = await createCatalog({ pricePaise: 45000 });
  alice = await signupUser({ name: 'Alice' });
  bob = await signupUser({ name: 'Bob' });
});
afterAll(() => sequelize.close());

const bookingBody = (overrides = {}) => ({
  centre_id: catalog.centre.id,
  test_id: catalog.test.id,
  appointment_at: inDays(3),
  ...overrides,
});

describe('POST /bookings', () => {
  test('creates a PENDING booking priced from the database', async () => {
    const res = await api().post('/bookings').set(alice.auth).send(bookingBody());
    expect(res.status).toBe(201);
    expect(res.headers.location).toBe(`/bookings/${res.body.id}`);
    expect(res.body).toMatchObject({
      status: 'PENDING',
      amount_paise: 45000,
      currency: 'INR',
      user_id: alice.user.id,
      centre: { id: catalog.centre.id, name: 'EVE Test Centre' },
      test: { id: catalog.test.id, name: 'Complete Blood Count' },
      payment: null,
    });
  });

  test('the client cannot set the price or the status', async () => {
    const res = await api().post('/bookings').set(alice.auth).send(bookingBody({ amount_paise: 1, status: 'CONFIRMED' }));
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['amount_paise', 'status']);
  });

  test('requires login', async () => {
    expect((await api().post('/bookings').send(bookingBody())).status).toBe(401);
  });

  test.each([
    ['in the past', () => inDays(-1)],
    ['more than 90 days ahead', () => inDays(120)],
    ['without a timezone', () => '2030-01-01T10:00:00'],
    ['not a date', () => 'tomorrow'],
    ['an impossible date', () => '2026-13-45T10:00:00Z'],
  ])('rejects an appointment time %s', async (_, when) => {
    const res = await api().post('/bookings').set(alice.auth).send(bookingBody({ appointment_at: when() }));
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('appointment_at');
  });

  test('unknown centre is 404, test not offered or switched off is 422', async () => {
    const missing = await api().post('/bookings').set(alice.auth).send(bookingBody({ centre_id: '7a1b8f0e-8d7c-4b1a-9d53-0b8f4f6f0c11' }));
    expect(missing.status).toBe(404);

    const notOffered = await api().post('/bookings').set(alice.auth).send(bookingBody({ test_id: '7a1b8f0e-8d7c-4b1a-9d53-0b8f4f6f0c11' }));
    expect(notOffered.status).toBe(422);
    expect(notOffered.body.error.code).toBe('TEST_NOT_OFFERED');

    await CentreTest.update({ isAvailable: false }, { where: {} });
    const off = await api().post('/bookings').set(alice.auth).send(bookingBody());
    expect(off.body.error.code).toBe('TEST_NOT_OFFERED');
  });

  test('the same user cannot hold two live bookings for the same slot, even when sent at the same time', async () => {
    const body = bookingBody({ appointment_at: inDays(5) });
    const results = await Promise.all(Array.from({ length: 5 }, () => api().post('/bookings').set(alice.auth).send(body)));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.body.error.code === 'DUPLICATE_BOOKING')).toBe(true);
    expect(await Booking.count()).toBe(1);

    // Another user can still book that slot.
    expect((await api().post('/bookings').set(bob.auth).send(body)).status).toBe(201);
  });

  test('a cancelled booking frees the slot for a new booking', async () => {
    const when = inDays(4);
    const first = await createBooking(alice.auth, catalog, when);
    await api().post(`/bookings/${first.id}/cancel`).set(alice.auth);
    expect((await api().post('/bookings').set(alice.auth).send(bookingBody({ appointment_at: when }))).status).toBe(201);
  });
});

describe('reading bookings', () => {
  test('users only see their own bookings; admins see everyone\'s', async () => {
    const a = await createBooking(alice.auth, catalog, inDays(1));
    await createBooking(alice.auth, catalog, inDays(2));
    const b = await createBooking(bob.auth, catalog, inDays(3));

    const mine = await api().get('/bookings').set(alice.auth);
    expect(mine.body.pagination.total).toBe(2);
    expect(mine.body.data.every((x) => x.user_id === alice.user.id)).toBe(true);

    // Someone else's booking looks exactly like a missing one.
    expect((await api().get(`/bookings/${b.id}`).set(alice.auth)).status).toBe(404);
    expect((await api().get(`/bookings/${a.id}`).set(alice.auth)).status).toBe(200);

    const admin = await createAdmin();
    expect((await api().get('/bookings').set(admin.auth)).body.pagination.total).toBe(3);
  });

  test('filters by status and paginates', async () => {
    const a = await createBooking(alice.auth, catalog, inDays(1));
    await createBooking(alice.auth, catalog, inDays(2));
    await api().post(`/bookings/${a.id}/cancel`).set(alice.auth);

    const cancelled = await api().get('/bookings?status=CANCELLED').set(alice.auth);
    expect(cancelled.body.data.map((x) => x.id)).toEqual([a.id]);

    const page2 = await api().get('/bookings?limit=1&page=2').set(alice.auth);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination.total_pages).toBe(2);

    expect((await api().get('/bookings?status=DONE').set(alice.auth)).status).toBe(400);
  });
});

describe('POST /bookings/:id/cancel', () => {
  test('cancels a PENDING booking, and repeating it is harmless', async () => {
    const b = await createBooking(alice.auth, catalog);
    const first = await api().post(`/bookings/${b.id}/cancel`).set(alice.auth);
    expect(first.status).toBe(200);
    expect(first.body.status).toBe('CANCELLED');
    expect(first.body.cancelled_at).toEqual(expect.any(String));

    const again = await api().post(`/bookings/${b.id}/cancel`).set(alice.auth);
    expect(again.status).toBe(200);
    expect(again.body.cancelled_at).toBe(first.body.cancelled_at);
  });

  test('another user cannot cancel it', async () => {
    const b = await createBooking(alice.auth, catalog);
    expect((await api().post(`/bookings/${b.id}/cancel`).set(bob.auth)).status).toBe(404);
    expect((await api().get(`/bookings/${b.id}`).set(alice.auth)).body.status).toBe('PENDING');
  });

  test('a CONFIRMED booking cannot be cancelled', async () => {
    const b = await createBooking(alice.auth, catalog);
    await api().post('/payments/').set(alice.auth).send({ booking_id: b.id });
    const res = await api().post(`/bookings/${b.id}/cancel`).set(alice.auth);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INVALID_STATE_TRANSITION', details: { current_status: 'CONFIRMED' } });
  });
});

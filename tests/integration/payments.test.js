'use strict';

const { api, resetDb, signupUser, createCatalog, createBooking, sequelize } = require('../helpers');
const { Payment, Booking } = require('../../src/models');

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

const pay = (auth, body, key) => {
  const req = api().post('/payments/').set(auth);
  if (key) req.set('Idempotency-Key', key);
  return req.send(body);
};

describe('POST /payments/ outcomes', () => {
  test('SUCCESS confirms the booking and charges the booking amount', async () => {
    const b = await createBooking(alice.auth, catalog);
    const res = await pay(alice.auth, { booking_id: b.id, simulate_outcome: 'SUCCESS' });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ status: 'SUCCESS', amount_paise: 45000, booking_id: b.id, failure_reason: null });
    expect(res.body.booking_status).toBe('CONFIRMED');

    const booking = await api().get(`/bookings/${b.id}`).set(alice.auth);
    expect(booking.body.status).toBe('CONFIRMED');
    expect(booking.body.payment.id).toBe(res.body.payment.id);
  });

  test('SUCCESS is the default outcome', async () => {
    const b = await createBooking(alice.auth, catalog);
    expect((await pay(alice.auth, { booking_id: b.id })).body.payment.status).toBe('SUCCESS');
  });

  test('FAILED fails the booking and records a reason', async () => {
    const b = await createBooking(alice.auth, catalog);
    const res = await pay(alice.auth, { booking_id: b.id, simulate_outcome: 'FAILED' });
    expect(res.status).toBe(201);
    expect(res.body.payment).toMatchObject({ status: 'FAILED', failure_reason: expect.any(String) });
    expect(res.body.booking_status).toBe('FAILED');
  });

  test('PENDING leaves both waiting for the webhook', async () => {
    const b = await createBooking(alice.auth, catalog);
    const res = await pay(alice.auth, { booking_id: b.id, simulate_outcome: 'PENDING' });
    expect(res.body.payment.status).toBe('PENDING');
    expect(res.body.booking_status).toBe('PENDING');
  });
});

describe('POST /payments/ edge cases', () => {
  test('a booking can only be paid once', async () => {
    const b = await createBooking(alice.auth, catalog);
    await pay(alice.auth, { booking_id: b.id });
    const res = await pay(alice.auth, { booking_id: b.id });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'PAYMENT_ALREADY_EXISTS', details: { payment_status: 'SUCCESS' } });
  });

  test('ten payment requests at the same moment create exactly one payment', async () => {
    const b = await createBooking(alice.auth, catalog);
    const results = await Promise.all(Array.from({ length: 10 }, () => pay(alice.auth, { booking_id: b.id })));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(9);
    expect(await Payment.count()).toBe(1);
  });

  test('a cancelled booking cannot be paid', async () => {
    const b = await createBooking(alice.auth, catalog);
    await api().post(`/bookings/${b.id}/cancel`).set(alice.auth);
    const res = await pay(alice.auth, { booking_id: b.id });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
  });

  test('an appointment that has already passed cannot be paid', async () => {
    const b = await createBooking(alice.auth, catalog);
    await Booking.update({ appointmentAt: new Date(Date.now() - 60_000) }, { where: { id: b.id } });
    const res = await pay(alice.auth, { booking_id: b.id });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('APPOINTMENT_IN_PAST');
  });

  test('you cannot pay for, or read the payment of, someone else\'s booking', async () => {
    const b = await createBooking(alice.auth, catalog);
    expect((await pay(bob.auth, { booking_id: b.id })).status).toBe(404);

    const mine = await pay(alice.auth, { booking_id: b.id });
    expect((await api().get(`/payments/${mine.body.payment.id}`).set(bob.auth)).status).toBe(404);
    expect((await api().get(`/payments/${mine.body.payment.id}`).set(alice.auth)).status).toBe(200);
  });

  test('unknown booking, bad id, bad outcome and client-sent amount are rejected', async () => {
    expect((await pay(alice.auth, { booking_id: '7a1b8f0e-8d7c-4b1a-9d53-0b8f4f6f0c11' })).status).toBe(404);
    expect((await pay(alice.auth, { booking_id: 'abc' })).status).toBe(400);
    const b = await createBooking(alice.auth, catalog);
    expect((await pay(alice.auth, { booking_id: b.id, simulate_outcome: 'MAYBE' })).status).toBe(400);
    expect((await pay(alice.auth, { booking_id: b.id, amount_paise: 1 })).status).toBe(400);
    expect((await api().post('/payments/').send({ booking_id: b.id })).status).toBe(401);
  });

  test('a PENDING payment blocks cancelling the booking', async () => {
    const b = await createBooking(alice.auth, catalog);
    await pay(alice.auth, { booking_id: b.id, simulate_outcome: 'PENDING' });
    const res = await api().post(`/bookings/${b.id}/cancel`).set(alice.auth);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('PAYMENT_IN_PROGRESS');
  });
});

describe('Idempotency-Key', () => {
  test('retrying with the same key returns the original payment instead of an error', async () => {
    const b = await createBooking(alice.auth, catalog);
    const first = await pay(alice.auth, { booking_id: b.id }, 'checkout-123456');
    const retry = await pay(alice.auth, { booking_id: b.id }, 'checkout-123456');
    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.body.payment.id).toBe(first.body.payment.id);
    expect(await Payment.count()).toBe(1);
  });

  test('the same key sent many times at once still creates one payment and replays it', async () => {
    const b = await createBooking(alice.auth, catalog);
    const results = await Promise.all(Array.from({ length: 5 }, () => pay(alice.auth, { booking_id: b.id }, 'burst-key-0001')));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 200)).toHaveLength(4);
    expect(new Set(results.map((r) => r.body.payment.id)).size).toBe(1);
  });

  test('reusing a key for a different booking is refused', async () => {
    const b1 = await createBooking(alice.auth, catalog);
    const b2 = await createBooking(alice.auth, catalog, new Date(Date.now() + 5 * 86400000).toISOString());
    await pay(alice.auth, { booking_id: b1.id }, 'reused-key-0001');
    const res = await pay(alice.auth, { booking_id: b2.id }, 'reused-key-0001');
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  test('keys are per user, and malformed keys are rejected', async () => {
    const a = await createBooking(alice.auth, catalog);
    const b = await createBooking(bob.auth, catalog);
    expect((await pay(alice.auth, { booking_id: a.id }, 'shared-key-0001')).status).toBe(201);
    expect((await pay(bob.auth, { booking_id: b.id }, 'shared-key-0001')).status).toBe(201);
    const c = await createBooking(alice.auth, catalog, new Date(Date.now() + 6 * 86400000).toISOString());
    expect((await pay(alice.auth, { booking_id: c.id }, 'bad key!')).status).toBe(400);
  });
});

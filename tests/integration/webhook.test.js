'use strict';

const { api, resetDb, signupUser, createCatalog, createBooking, sendWebhook, sequelize } = require('../helpers');
const { WebhookEvent, Payment } = require('../../src/models');
const paymentsService = require('../../src/modules/payments/payments.service');

let alice;
let catalog;
let booking;
let payment;

beforeEach(async () => {
  await resetDb();
  catalog = await createCatalog({ pricePaise: 45000 });
  alice = await signupUser();
  booking = await createBooking(alice.auth, catalog);
  const res = await api().post('/payments/').set(alice.auth).send({ booking_id: booking.id, simulate_outcome: 'PENDING' });
  payment = res.body.payment;
});
afterEach(() => jest.restoreAllMocks());
afterAll(() => sequelize.close());

const event = (overrides = {}, data = {}) => ({
  event_id: 'evt_001',
  type: 'payment.succeeded',
  data: { provider_ref: payment.provider_ref, amount_paise: 45000, ...data },
  ...overrides,
});
const bookingStatus = async () => (await api().get(`/bookings/${booking.id}`).set(alice.auth)).body.status;

describe('webhook security and validation', () => {
  test('missing or wrong signature is rejected and changes nothing', async () => {
    expect((await sendWebhook(event(), { signature: '' })).status).toBe(401);
    expect((await sendWebhook(event(), { signature: 'sha256=deadbeef' })).status).toBe(401);
    expect(await WebhookEvent.count()).toBe(0);
    expect(await bookingStatus()).toBe('PENDING');
  });

  test('a signed but invalid payload is a 400', async () => {
    const res = await sendWebhook({ event_id: 'evt_x', type: 'payment.refunded', data: {} });
    expect(res.status).toBe(400);
  });

  test('an unknown provider_ref is a 404 and is not stored', async () => {
    const res = await sendWebhook(event({}, { provider_ref: 'pay_mock_unknown' }));
    expect(res.status).toBe(404);
    expect(await WebhookEvent.count()).toBe(0);
  });
});

describe('applying events', () => {
  test('payment.succeeded confirms a pending payment', async () => {
    const res = await sendWebhook(event());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ received: true, duplicate: false, outcome: 'APPLIED', attempts: 1 });
    expect(await bookingStatus()).toBe('CONFIRMED');
  });

  test('payment.failed fails a pending payment and stores the reason', async () => {
    await sendWebhook(event({ type: 'payment.failed' }, { failure_reason: 'Insufficient funds' }));
    expect(await bookingStatus()).toBe('FAILED');
    expect((await Payment.findByPk(payment.id)).failureReason).toBe('Insufficient funds');
  });
});

describe('idempotency', () => {
  test('the same event delivered again is acknowledged but not applied twice', async () => {
    await sendWebhook(event());
    const again = await sendWebhook(event());
    expect(again.status).toBe(200);
    expect(again.body).toMatchObject({ duplicate: true, outcome: 'APPLIED' });
    expect(await WebhookEvent.count()).toBe(1);
    expect(await Payment.count()).toBe(1);
  });

  test('the same event with its keys in a different order is still a duplicate', async () => {
    await sendWebhook(event());
    const reordered = { data: { amount_paise: 45000, provider_ref: payment.provider_ref }, type: 'payment.succeeded', event_id: 'evt_001' };
    expect((await sendWebhook(reordered)).body.duplicate).toBe(true);
  });

  test('ten copies of one event arriving at the same moment are applied exactly once', async () => {
    const results = await Promise.all(Array.from({ length: 10 }, () => sendWebhook(event())));
    expect(results.every((r) => r.status === 200)).toBe(true);
    expect(results.filter((r) => r.body.duplicate === false)).toHaveLength(1);
    expect(results.filter((r) => r.body.duplicate === true)).toHaveLength(9);
    expect(await WebhookEvent.count()).toBe(1);
    expect(await bookingStatus()).toBe('CONFIRMED');
  });

  test('an event id re-used with a different body is refused', async () => {
    await sendWebhook(event());
    const res = await sendWebhook(event({ type: 'payment.failed' }));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_ID_REUSED');
    expect(await bookingStatus()).toBe('CONFIRMED');
  });

  test('a new event repeating the current status changes nothing', async () => {
    await sendWebhook(event());
    const res = await sendWebhook(event({ event_id: 'evt_002' }));
    expect(res.body).toMatchObject({ duplicate: false, outcome: 'NO_CHANGE' });
  });

  test('a late "failed" event never overwrites a successful payment', async () => {
    await sendWebhook(event());
    const res = await sendWebhook(event({ event_id: 'evt_002', type: 'payment.failed' }));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('STATUS_CONFLICT');
    expect(await bookingStatus()).toBe('CONFIRMED');
    expect((await Payment.findByPk(payment.id)).status).toBe('SUCCESS');
  });

  test('the webhook agrees with a payment that already succeeded synchronously', async () => {
    const other = await createBooking(alice.auth, catalog, new Date(Date.now() + 7 * 86400000).toISOString());
    const sync = await api().post('/payments/').set(alice.auth).send({ booking_id: other.id });
    const res = await sendWebhook(event({ event_id: 'evt_sync' }, { provider_ref: sync.body.payment.provider_ref }));
    expect(res.body.outcome).toBe('NO_CHANGE');
  });

  test('an event with the wrong amount is acknowledged but not applied', async () => {
    const res = await sendWebhook(event({}, { amount_paise: 1 }));
    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('AMOUNT_MISMATCH');
    expect(await bookingStatus()).toBe('PENDING');
    expect((await Payment.findByPk(payment.id)).status).toBe('PENDING');
  });
});

describe('retry after a processing failure', () => {
  test('a crash rolls everything back, is recorded, and the provider retry succeeds', async () => {
    jest.spyOn(paymentsService, 'applyProviderResult').mockRejectedValueOnce(new Error('database hiccup'));

    const first = await sendWebhook(event());
    expect(first.status).toBe(500);
    expect(await bookingStatus()).toBe('PENDING'); // nothing half-applied
    const failed = await WebhookEvent.findOne({ where: { eventId: 'evt_001' } });
    expect(failed).toMatchObject({ status: 'FAILED', attempts: 1, lastError: 'database hiccup' });

    const retry = await sendWebhook(event());
    expect(retry.status).toBe(200);
    expect(retry.body).toMatchObject({ duplicate: false, outcome: 'APPLIED', attempts: 2 });
    expect(await bookingStatus()).toBe('CONFIRMED');
    expect(await WebhookEvent.findOne({ where: { eventId: 'evt_001' } })).toMatchObject({ status: 'PROCESSED', lastError: null });
  });
});

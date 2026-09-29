'use strict';

const request = require('supertest');
const bcrypt = require('bcryptjs');
const { createApp } = require('../src/app');
const { sequelize, User, Centre, Test, CentreTest } = require('../src/models');
const { sign } = require('../src/utils/signature');

const app = createApp();
const api = () => request(app);

async function resetDb() {
  await sequelize.query(
    'TRUNCATE webhook_events, payments, bookings, centre_tests, diagnostic_tests, diagnostic_centres, users RESTART IDENTITY CASCADE'
  );
}

let counter = 0;
async function signupUser(overrides = {}) {
  counter += 1;
  const body = { name: 'Test User', email: `user${counter}_${Date.now()}@example.com`, password: 'Passw0rd!', ...overrides };
  const res = await api().post('/auth/signup').send(body);
  if (res.status !== 201) throw new Error(`signup failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { user: res.body.user, token: res.body.access_token, auth: { Authorization: `Bearer ${res.body.access_token}` } };
}

async function createAdmin() {
  await User.create({ name: 'Admin', email: 'admin@test.local', passwordHash: await bcrypt.hash('Admin12345', 4), role: 'ADMIN' });
  const res = await api().post('/auth/login').send({ email: 'admin@test.local', password: 'Admin12345' });
  return { auth: { Authorization: `Bearer ${res.body.access_token}` } };
}

async function createCatalog({ pricePaise = 45000, isAvailable = true } = {}) {
  const centre = await Centre.create({ name: 'EVE Test Centre', address: '1 Test Road', city: 'Bhopal' });
  const test = await Test.create({ name: 'Complete Blood Count', description: 'CBC' });
  await CentreTest.create({ centreId: centre.id, testId: test.id, pricePaise, isAvailable });
  return { centre, test };
}

const inDays = (days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

async function createBooking(auth, { centre, test }, appointmentAt = inDays(2)) {
  const res = await api().post('/bookings').set(auth).send({ centre_id: centre.id, test_id: test.id, appointment_at: appointmentAt });
  if (res.status !== 201) throw new Error(`booking failed: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body;
}

function sendWebhook(event, { signature } = {}) {
  const body = JSON.stringify(event);
  return api()
    .post('/payments/webhook/')
    .set('Content-Type', 'application/json')
    .set('X-Webhook-Signature', signature ?? sign(body, process.env.WEBHOOK_SECRET))
    .send(body);
}

module.exports = { api, app, resetDb, signupUser, createAdmin, createCatalog, createBooking, sendWebhook, inDays, sequelize };

'use strict';

const jwt = require('jsonwebtoken');
const { api, resetDb, signupUser, sequelize } = require('../helpers');

beforeEach(resetDb);
afterAll(() => sequelize.close());

describe('POST /auth/signup', () => {
  test('creates a USER and returns a token, never the password hash', async () => {
    const res = await api().post('/auth/signup').send({ name: 'Asha', email: 'Asha@Example.com', password: 'Secret123' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ name: 'Asha', email: 'asha@example.com', role: 'USER' });
    expect(res.body.access_token).toEqual(expect.any(String));
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
  });

  test('the same email in a different case is rejected', async () => {
    await api().post('/auth/signup').send({ name: 'Asha', email: 'asha@example.com', password: 'Secret123' });
    const res = await api().post('/auth/signup').send({ name: 'Asha 2', email: 'ASHA@example.com', password: 'Secret123' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });

  test('weak password and bad email return field-level errors', async () => {
    const res = await api().post('/auth/signup').send({ name: 'A', email: 'not-an-email', password: 'short' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(new Set(res.body.error.details.map((d) => d.field))).toEqual(new Set(['email', 'name', 'password']));
  });

  test('a user cannot make themselves an admin', async () => {
    const res = await api().post('/auth/signup').send({ name: 'Eve', email: 'eve@example.com', password: 'Secret123', role: 'ADMIN' });
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('role');
  });

  test('malformed JSON gets a clean 400', async () => {
    const res = await api().post('/auth/signup').set('Content-Type', 'application/json').send('{"name": ');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });
});

describe('POST /auth/login', () => {
  beforeEach(() => api().post('/auth/signup').send({ name: 'Asha', email: 'asha@example.com', password: 'Secret123' }));

  test('correct details return a working token', async () => {
    const res = await api().post('/auth/login').send({ email: 'ASHA@example.com', password: 'Secret123' });
    expect(res.status).toBe(200);
    const me = await api().get('/auth/me').set('Authorization', `Bearer ${res.body.access_token}`);
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('asha@example.com');
  });

  test('wrong password and unknown email give the same answer', async () => {
    const wrong = await api().post('/auth/login').send({ email: 'asha@example.com', password: 'Wrong1234' });
    const unknown = await api().post('/auth/login').send({ email: 'nobody@example.com', password: 'Wrong1234' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);
  });
});

describe('JWT protection', () => {
  test('no token, garbage token, wrong secret and expired token are all 401', async () => {
    const { user } = await signupUser();
    const wrongSecret = jwt.sign({ sub: user.id }, 'some-other-secret-that-is-long-enough-000');
    const expired = jwt.sign({ sub: user.id }, process.env.JWT_SECRET, { expiresIn: -10 });

    for (const header of [undefined, 'Bearer garbage', `Bearer ${wrongSecret}`, `Bearer ${expired}`, 'Basic abc']) {
      const req = api().get('/auth/me');
      if (header) req.set('Authorization', header);
      const res = await req;
      expect(res.status).toBe(401);
    }
  });

  test('a token for a deleted user stops working', async () => {
    const { user, auth } = await signupUser();
    await sequelize.query('DELETE FROM users WHERE id = :id', { replacements: { id: user.id } });
    const res = await api().get('/auth/me').set(auth);
    expect(res.status).toBe(401);
  });
});

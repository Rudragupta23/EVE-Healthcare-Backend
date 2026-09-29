'use strict';

const { api, resetDb, signupUser, createAdmin, sequelize } = require('../helpers');
const { Centre, Test, CentreTest } = require('../../src/models');

beforeEach(resetDb);
afterAll(() => sequelize.close());

async function seedTwoCities() {
  const [bpl, ind] = await Centre.bulkCreate([
    { name: 'Bhopal Centre', address: '1 Road', city: 'Bhopal' },
    { name: 'Indore Centre', address: '2 Road', city: 'Indore' },
  ]);
  const [cbc, xray] = await Test.bulkCreate([{ name: 'CBC' }, { name: 'Chest X-Ray' }]);
  await CentreTest.bulkCreate([
    { centreId: bpl.id, testId: cbc.id, pricePaise: 35000 },
    { centreId: bpl.id, testId: xray.id, pricePaise: 50000, isAvailable: false },
    { centreId: ind.id, testId: xray.id, pricePaise: 45000 },
  ]);
  return { bpl, ind, cbc, xray };
}

describe('GET /centres (public)', () => {
  test('lists centres with available tests and prices, paginated', async () => {
    await seedTwoCities();
    const res = await api().get('/centres?limit=1&page=1');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ page: 1, limit: 1, total: 2, total_pages: 2 });
    const [first] = res.body.data;
    expect(first.name).toBe('Bhopal Centre');
    // the unavailable X-Ray is hidden
    expect(first.tests).toEqual([expect.objectContaining({ name: 'CBC', price_paise: 35000, is_available: true })]);
  });

  test('filters by city (any case) and by test', async () => {
    const { xray } = await seedTwoCities();
    const byCity = await api().get('/centres?city=INDORE');
    expect(byCity.body.data.map((c) => c.name)).toEqual(['Indore Centre']);

    // Bhopal has X-Ray switched off, so only Indore offers it right now.
    const byTest = await api().get(`/centres?test_id=${xray.id}`);
    expect(byTest.body.data.map((c) => c.name)).toEqual(['Indore Centre']);
  });

  test('bad query values are rejected', async () => {
    const res = await api().get('/centres?limit=500&page=0&test_id=abc');
    expect(res.status).toBe(400);
    expect(res.body.error.details.map((d) => d.field).sort()).toEqual(['limit', 'page', 'test_id']);
  });

  test('GET /centres/:id returns 404 for an unknown id and 400 for a malformed one', async () => {
    expect((await api().get('/centres/7a1b8f0e-8d7c-4b1a-9d53-0b8f4f6f0c11')).status).toBe(404);
    expect((await api().get('/centres/not-a-uuid')).status).toBe(400);
  });
});

describe('admin-only catalogue management', () => {
  test('a normal user cannot create centres or tests', async () => {
    const { auth } = await signupUser();
    expect((await api().post('/centres').set(auth).send({ name: 'X Lab', address: '12 Street', city: 'Pune' })).status).toBe(403);
    expect((await api().post('/tests').set(auth).send({ name: 'Vitamin D' })).status).toBe(403);
  });

  test('an admin can create a centre and a test, then set and change a price (PUT is idempotent)', async () => {
    const { auth } = await createAdmin();
    const centre = await api().post('/centres').set(auth).send({ name: 'Pune Lab', address: '12 FC Road', city: 'Pune' });
    const test = await api().post('/tests').set(auth).send({ name: 'Vitamin D', description: '25-OH Vitamin D' });
    expect(centre.status).toBe(201);
    expect(test.status).toBe(201);

    const url = `/centres/${centre.body.id}/tests/${test.body.id}`;
    expect((await api().put(url).set(auth).send({ price_paise: 90000 })).body.price_paise).toBe(90000);
    expect((await api().put(url).set(auth).send({ price_paise: 90000 })).status).toBe(200);
    expect((await api().put(url).set(auth).send({ price_paise: 85000 })).body.price_paise).toBe(85000);
    expect(await CentreTest.count()).toBe(1);

    const listed = await api().get(`/centres/${centre.body.id}`);
    expect(listed.body.tests).toEqual([expect.objectContaining({ name: 'Vitamin D', price_paise: 85000 })]);
  });

  test('duplicates and invalid prices are rejected', async () => {
    const { auth } = await createAdmin();
    await api().post('/tests').set(auth).send({ name: 'Vitamin D' });
    expect((await api().post('/tests').set(auth).send({ name: 'vitamin d' })).status).toBe(409);

    const c = await api().post('/centres').set(auth).send({ name: 'Pune Lab', address: '12 FC Road', city: 'Pune' });
    expect((await api().post('/centres').set(auth).send({ name: 'Pune Lab', address: 'Other', city: 'Pune' })).status).toBe(409);

    const t = (await api().get('/tests')).body.data[0];
    const res = await api().put(`/centres/${c.body.id}/tests/${t.id}`).set(auth).send({ price_paise: -5 });
    expect(res.status).toBe(400);
  });
});

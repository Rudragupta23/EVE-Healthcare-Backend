'use strict';

/**
 * Sample data: one admin, three centres, five tests and their prices.
 * Safe to run more than once (existing rows are left alone).
 * Usage: npm run seed
 */
const bcrypt = require('bcryptjs');
const config = require('../config');
const { sequelize, User, Centre, Test, CentreTest } = require('../models');
const { ROLES } = require('../utils/constants');

const CENTRES = [
  { name: 'EVE Diagnostics Arera Colony', address: 'E-5, Arera Colony', city: 'Bhopal' },
  { name: 'EVE Diagnostics MP Nagar', address: 'Zone II, MP Nagar', city: 'Bhopal' },
  { name: 'EVE Diagnostics Vijay Nagar', address: 'Scheme 54, Vijay Nagar', city: 'Indore' },
];

const TESTS = [
  { name: 'Complete Blood Count (CBC)', description: 'Measures red cells, white cells and platelets.' },
  { name: 'Lipid Profile', description: 'Cholesterol and triglycerides. 10-12 hours fasting needed.' },
  { name: 'HbA1c', description: 'Average blood sugar over the last 3 months.' },
  { name: 'Thyroid Profile (T3, T4, TSH)', description: 'Checks how well the thyroid gland is working.' },
  { name: 'Chest X-Ray', description: 'Single view chest radiograph.' },
];

// price in rupees per [centre index][test index]; null = not offered at that centre
const PRICES_INR = [
  [350, 600, 450, 700, 500],
  [300, 550, 400, null, 450],
  [320, 580, 420, 650, null],
];

async function seed() {
  const [admin] = await User.findOrCreate({
    where: { email: config.admin.email },
    defaults: { name: 'Admin', passwordHash: await bcrypt.hash(config.admin.password, 12), role: ROLES.ADMIN },
  });

  const centres = [];
  for (const c of CENTRES) centres.push((await Centre.findOrCreate({ where: { name: c.name, city: c.city }, defaults: c }))[0]);

  const tests = [];
  for (const t of TESTS) tests.push((await Test.findOrCreate({ where: { name: t.name }, defaults: t }))[0]);

  for (const [ci, row] of PRICES_INR.entries()) {
    for (const [ti, inr] of row.entries()) {
      if (inr === null) continue;
      await CentreTest.findOrCreate({
        where: { centreId: centres[ci].id, testId: tests[ti].id },
        defaults: { pricePaise: inr * 100, isAvailable: true },
      });
    }
  }

  console.log(`Seed complete. Admin login: ${admin.email} / (ADMIN_PASSWORD from .env)`);
}

seed()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => sequelize.close());

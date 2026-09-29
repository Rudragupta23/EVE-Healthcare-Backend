'use strict';

// Runs before any app code is loaded, so config/index.js sees test settings.
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), quiet: true });

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/eve_healthcare_test';
process.env.JWT_SECRET = 'test-jwt-secret-that-is-at-least-32-characters-long';
process.env.WEBHOOK_SECRET = 'test-webhook-secret';

if (!/test/i.test(process.env.DATABASE_URL)) {
  // Safety net: the tests delete every row, so refuse to run against a database without "test" in its name.
  throw new Error(`Refusing to run tests against "${process.env.DATABASE_URL}". Use a database with "test" in its name.`);
}

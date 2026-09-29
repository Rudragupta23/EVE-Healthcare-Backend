'use strict';

const path = require('path');
const Joi = require('joi');

// Load .env from the project root (tests set their own values first, so they win).
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const schema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),

  DATABASE_URL: Joi.string().uri({ scheme: ['postgres', 'postgresql'] }).required(),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),

  WEBHOOK_SECRET: Joi.string().min(16).required(),

  ADMIN_EMAIL: Joi.string().email({ tlds: { allow: false } }).default('admin@eve.local'),
  ADMIN_PASSWORD: Joi.string().min(8).default('Admin@12345'),

  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent').default('info'),
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().positive().default(60_000),
  RATE_LIMIT_MAX: Joi.number().integer().positive().default(100),
  AUTH_RATE_LIMIT_MAX: Joi.number().integer().positive().default(10),
}).unknown(true);

const { value: env, error } = schema.validate(process.env, { abortEarly: false });

if (error) {
  const problems = error.details.map((d) => `  - ${d.message}`).join('\n');
  // Fail fast: a half-configured server is worse than one that refuses to start.
  throw new Error(`Invalid environment configuration:\n${problems}\nSee .env.example.`);
}

module.exports = Object.freeze({
  env: env.NODE_ENV,
  isTest: env.NODE_ENV === 'test',
  port: env.PORT,
  databaseUrl: env.DATABASE_URL,
  jwt: { secret: env.JWT_SECRET, expiresIn: env.JWT_EXPIRES_IN },
  webhookSecret: env.WEBHOOK_SECRET,
  admin: { email: env.ADMIN_EMAIL.toLowerCase(), password: env.ADMIN_PASSWORD },
  logLevel: env.NODE_ENV === 'test' ? 'silent' : env.LOG_LEVEL,
  rateLimit: {
    windowMs: env.RATE_LIMIT_WINDOW_MS,
    max: env.RATE_LIMIT_MAX,
    authMax: env.AUTH_RATE_LIMIT_MAX,
  },
});

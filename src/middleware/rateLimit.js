'use strict';

const { rateLimit } = require('express-rate-limit');
const config = require('../config');

const handler = (req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, please try again later' } });

// In-memory store: fine for one instance. With several instances this would move to Redis.
const common = { windowMs: config.rateLimit.windowMs, standardHeaders: 'draft-7', legacyHeaders: false, handler };

const apiLimiter = rateLimit({ ...common, limit: config.rateLimit.max, skip: () => config.isTest });

// Much stricter on signup/login to slow down password guessing.
const authLimiter = rateLimit({ ...common, limit: config.rateLimit.authMax, skip: () => config.isTest });

module.exports = { apiLimiter, authLimiter };

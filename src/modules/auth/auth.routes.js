'use strict';

const { Router } = require('express');
const validate = require('../../middleware/validate');
const { authenticate } = require('../../middleware/auth');
const { authLimiter } = require('../../middleware/rateLimit');
const serialize = require('../../utils/serializers');
const config = require('../../config');
const schemas = require('./auth.schemas');
const service = require('./auth.service');

const router = Router();

const authResponse = ({ user, token }) => ({
  user: serialize.user(user),
  access_token: token,
  token_type: 'Bearer',
  expires_in: config.jwt.expiresIn,
});

router.post('/signup', authLimiter, validate(schemas.signup), async (req, res) => {
  res.status(201).json(authResponse(await service.signup(req.valid.body)));
});

router.post('/login', authLimiter, validate(schemas.login), async (req, res) => {
  res.json(authResponse(await service.login(req.valid.body)));
});

router.get('/me', authenticate, (req, res) => {
  res.json({ user: serialize.user(req.user) });
});

module.exports = router;

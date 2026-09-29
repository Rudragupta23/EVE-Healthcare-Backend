'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');
const { User } = require('../models');
const { unauthorized, forbidden } = require('../utils/errors');

/**
 * Requires "Authorization: Bearer <token>".
 * The user is re-loaded from the database so a deleted account's token stops working
 * and the role always reflects the current database value, not what the token claims.
 */
async function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) return next(unauthorized('Missing or malformed Authorization header'));

  let payload;
  try {
    payload = jwt.verify(token, config.jwt.secret, { algorithms: ['HS256'] });
  } catch (err) {
    return next(unauthorized(err.name === 'TokenExpiredError' ? 'Token has expired' : 'Invalid token'));
  }

  const user = await User.findByPk(payload.sub);
  if (!user) return next(unauthorized('User no longer exists'));

  req.user = user;
  return next();
}

const requireRole = (...roles) => (req, res, next) =>
  roles.includes(req.user?.role) ? next() : next(forbidden());

module.exports = { authenticate, requireRole };

'use strict';

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { UniqueConstraintError, fn, col, where } = require('sequelize');
const config = require('../../config');
const { User } = require('../../models');
const { conflict, unauthorized } = require('../../utils/errors');
const { ROLES } = require('../../utils/constants');

const BCRYPT_ROUNDS = config.isTest ? 4 : 12; // fast in tests, strong everywhere else

// A real hash of a random string, used so login takes the same time whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('timing-attack-guard', BCRYPT_ROUNDS);

const issueToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, {
    algorithm: 'HS256',
    expiresIn: config.jwt.expiresIn,
  });

async function signup({ name, email, password }) {
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  try {
    // Role is never taken from the request: everyone who signs up is a normal USER.
    const user = await User.create({ name, email, passwordHash, role: ROLES.USER });
    return { user, token: issueToken(user) };
  } catch (err) {
    if (err instanceof UniqueConstraintError) throw conflict('EMAIL_TAKEN', 'An account with this email already exists');
    throw err;
  }
}

async function login({ email, password }) {
  // lower(email) matches the case-insensitive unique index.
  const user = await User.scope('withPassword').findOne({ where: where(fn('lower', col('email')), email) });
  const ok = await bcrypt.compare(password, user ? user.passwordHash : DUMMY_HASH);
  // Same message for "no such email" and "wrong password" so accounts cannot be discovered.
  if (!user || !ok) throw unauthorized('Invalid email or password');
  return { user, token: issueToken(user) };
}

module.exports = { signup, login, BCRYPT_ROUNDS };

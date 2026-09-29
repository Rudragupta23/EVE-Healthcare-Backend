'use strict';

const Joi = require('joi');

const email = Joi.string().trim().lowercase().email({ tlds: { allow: false } }).max(255).required();

const signup = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email,
    // At least 8 characters with a letter and a number.
    password: Joi.string()
      .min(8)
      .max(72) // bcrypt only uses the first 72 bytes
      .pattern(/[A-Za-z]/, 'letter')
      .pattern(/\d/, 'number')
      .required()
      .messages({ 'string.pattern.name': 'password must contain at least one {#name}' }),
  }),
};

const login = {
  body: Joi.object({ email, password: Joi.string().max(72).required() }),
};

module.exports = { signup, login };

'use strict';

const { BOOKING_STATUS: S } = require('../../utils/constants');

/**
 * Every allowed booking status change lives here, in one place.
 *
 *   PENDING ──payment success──▶ CONFIRMED
 *      │  └──payment failed───▶ FAILED      (terminal: the patient books again)
 *      └────user cancels──────▶ CANCELLED   (terminal)
 *
 * CONFIRMED is final in this service: cancelling it would need a refund flow,
 * which is out of scope (see README "Assumptions").
 */
const TRANSITIONS = Object.freeze({
  [S.PENDING]: [S.CONFIRMED, S.FAILED, S.CANCELLED],
  [S.CONFIRMED]: [],
  [S.FAILED]: [],
  [S.CANCELLED]: [],
});

const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

module.exports = { TRANSITIONS, canTransition };

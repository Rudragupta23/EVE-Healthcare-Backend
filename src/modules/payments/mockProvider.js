'use strict';

const crypto = require('crypto');
const { PAYMENT_STATUS } = require('../../utils/constants');

/**
 * Stand-in for a real payment gateway. No money moves.
 *
 * The caller chooses the result with `simulate_outcome` so every path can be tested on demand:
 *   SUCCESS  -> charged immediately
 *   FAILED   -> declined immediately
 *   PENDING  -> the provider "decides later" and reports the result through POST /payments/webhook/
 */
function newProviderRef() {
  return `pay_mock_${crypto.randomBytes(12).toString('hex')}`;
}

function charge({ simulateOutcome }) {
  switch (simulateOutcome) {
    case PAYMENT_STATUS.FAILED:
      return { status: PAYMENT_STATUS.FAILED, failureReason: 'Card declined (simulated)' };
    case PAYMENT_STATUS.PENDING:
      return { status: PAYMENT_STATUS.PENDING };
    default:
      return { status: PAYMENT_STATUS.SUCCESS };
  }
}

module.exports = { newProviderRef, charge };

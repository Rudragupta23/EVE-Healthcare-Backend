'use strict';

const { canTransition, TRANSITIONS } = require('../../src/modules/bookings/bookingStateMachine');

describe('booking state machine', () => {
  test.each([
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'FAILED'],
    ['PENDING', 'CANCELLED'],
  ])('allows %s -> %s', (from, to) => expect(canTransition(from, to)).toBe(true));

  test.each([
    ['CONFIRMED', 'PENDING'],
    ['CONFIRMED', 'FAILED'],
    ['CONFIRMED', 'CANCELLED'],
    ['FAILED', 'CONFIRMED'],
    ['CANCELLED', 'CONFIRMED'],
    ['CANCELLED', 'PENDING'],
    ['PENDING', 'PENDING'],
  ])('blocks %s -> %s', (from, to) => expect(canTransition(from, to)).toBe(false));

  test('unknown status is never allowed to move', () => {
    expect(canTransition('SOMETHING', 'CONFIRMED')).toBe(false);
  });

  test('every status is listed', () => {
    expect(Object.keys(TRANSITIONS).sort()).toEqual(['CANCELLED', 'CONFIRMED', 'FAILED', 'PENDING']);
  });
});

'use strict';

const provider = require('../../src/modules/payments/mockProvider');

describe('mock payment provider', () => {
  test('returns the requested outcome', () => {
    expect(provider.charge({ simulateOutcome: 'SUCCESS' })).toEqual({ status: 'SUCCESS' });
    expect(provider.charge({ simulateOutcome: 'PENDING' })).toEqual({ status: 'PENDING' });
    expect(provider.charge({ simulateOutcome: 'FAILED' })).toMatchObject({ status: 'FAILED', failureReason: expect.any(String) });
  });

  test('provider references are unique and prefixed', () => {
    const refs = new Set(Array.from({ length: 100 }, () => provider.newProviderRef()));
    expect(refs.size).toBe(100);
    for (const ref of refs) expect(ref).toMatch(/^pay_mock_[0-9a-f]{24}$/);
  });
});

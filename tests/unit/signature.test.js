'use strict';

const { sign, isValidSignature, stableStringify, sha256 } = require('../../src/utils/signature');

describe('webhook signatures', () => {
  const secret = 'unit-test-secret';
  const body = Buffer.from('{"event_id":"evt_1"}');

  test('a correct signature is accepted', () => {
    expect(isValidSignature(body, sign(body, secret), secret)).toBe(true);
  });

  test('a signature made with another secret is rejected', () => {
    expect(isValidSignature(body, sign(body, 'other-secret'), secret)).toBe(false);
  });

  test('a changed body is rejected', () => {
    expect(isValidSignature(Buffer.from('{"event_id":"evt_2"}'), sign(body, secret), secret)).toBe(false);
  });

  test('missing header or body is rejected without throwing', () => {
    expect(isValidSignature(body, undefined, secret)).toBe(false);
    expect(isValidSignature(undefined, 'sha256=abc', secret)).toBe(false);
    expect(isValidSignature(body, 'sha256=short', secret)).toBe(false);
  });
});

describe('stableStringify', () => {
  test('same data in a different key order gives the same string and hash', () => {
    const a = { b: 1, a: { d: [1, { y: 2, x: 1 }], c: 'x' } };
    const b = { a: { c: 'x', d: [1, { x: 1, y: 2 }] }, b: 1 };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(sha256(stableStringify(a))).toBe(sha256(stableStringify(b)));
  });

  test('different data gives a different string', () => {
    expect(stableStringify({ a: 1 })).not.toBe(stableStringify({ a: 2 }));
  });
});

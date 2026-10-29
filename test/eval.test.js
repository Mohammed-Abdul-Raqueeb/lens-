import { test } from 'node:test';
import assert from 'node:assert/strict';

import { EvalError } from '../src/errors.js';
import { query } from '../src/index.js';
import { fails, output, outputs } from './helpers.js';

test('identity yields its input unchanged', () => {
  output('.', { a: 1 }, { a: 1 });
  output('.', null, null);
  output('.', [1, 2], [1, 2]);
});

test('a field of a missing key is null, not an error', () => {
  // Without this, every query against a document with optional fields would
  // need a guard.
  output('.missing', {}, null);
  output('.a.b.c', {}, null);
});

test('a field of null is null', () => {
  output('.a', null, null);
});

test('a field of a scalar is an error naming the type', () => {
  fails('.a', 42, /cannot read the field \.a of number/);
  fails('.a', 'text', /cannot read the field \.a of string/);
});

test('an optional field of a scalar yields nothing', () => {
  outputs('.a?', 42, []);
  outputs('[.[] | .a?]', [{ a: 1 }, 2, { a: 3 }], [[1, 3]]);
});

test('indexing an array accepts negatives and out-of-range', () => {
  output('.[0]', [1, 2, 3], 1);
  output('.[-1]', [1, 2, 3], 3);
  output('.[-3]', [1, 2, 3], 1);
  // Out of range is null rather than an error, which keeps `.[5] // "x"`
  // working as a default.
  output('.[9]', [1, 2, 3], null);
  output('.[-9]', [1, 2, 3], null);
});


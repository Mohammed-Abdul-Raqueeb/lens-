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

test('slices clamp rather than erroring', () => {
  output('.[1:3]', [1, 2, 3, 4], [2, 3]);
  output('.[:2]', [1, 2, 3], [1, 2]);
  output('.[2:]', [1, 2, 3], [3]);
  output('.[-2:]', [1, 2, 3], [2, 3]);
  output('.[5:9]', [1, 2, 3], []);
  // A reversed slice is empty, not an error, and not reversed.
  output('.[3:1]', [1, 2, 3, 4], []);
});

test('a string slices by character', () => {
  output('.[1:3]', 'abcdef', 'bc');
});

test('iterate yields elements, or an object\'s values', () => {
  outputs('.[]', [1, 2, 3], [1, 2, 3]);
  outputs('.[]', { a: 1, b: 2 }, [1, 2]);
});

test('iterating a scalar is an error, and optional iteration is not', () => {
  fails('.[]', 42, /cannot iterate over number/);
  outputs('.[]?', 42, []);
});

test('a pipe feeds each output into the next stage', () => {
  outputs('.[] | . * 2', [1, 2, 3], [2, 4, 6]);
  // Each of two outputs on the left runs the right, so the counts multiply.
  outputs('(1, 2) | (. , .)', null, [1, 1, 2, 2]);
});

test('a comma concatenates output streams in order', () => {
  outputs('1, 2, 3', null, [1, 2, 3]);
  outputs('.a, .b', { a: 1, b: 2 }, [1, 2]);
});

test('collecting into an array gathers every output', () => {
  output('[.[] | . * 2]', [1, 2], [2, 4]);
  output('[]', null, []);
  output('[empty]', null, []);
});

test('object construction expands as a cross product', () => {
  // `{a: (1,2)}` is two objects, not one object with two values.
  outputs('{a: (1, 2)}', null, [{ a: 1 }, { a: 2 }]);
  outputs('{a: (1, 2), b: 3}', null, [{ a: 1, b: 3 }, { a: 2, b: 3 }]);
});

test('an object key must be a string', () => {
  fails('{(1): 2}', null, /object key must be a string/);
});

test('recursion yields the value and everything inside it', () => {
  output('[..]', { a: [1] }, [{ a: [1] }, [1], 1]);
  output('[.. | numbers]', { a: { b: [1, 2] } }, [1, 2]);
});

test('arithmetic is overloaded by type', () => {
  output('1 + 2', null, 3);
  output('"a" + "b"', null, 'ab');
  output('[1] + [2]', null, [1, 2]);
  output('{a: 1} + {b: 2}', null, { a: 1, b: 2 });
});

test('null is the identity for addition on both sides', () => {
  // What makes `reduce .[] as $x (null; . + $x)` work without knowing the
  // element type in advance.
  output('null + 1', null, 1);
  output('1 + null', null, 1);
  output('null + [1]', null, [1]);
  output('reduce .[] as $x (null; . + $x)', [[1], [2]], [1, 2]);
});

test('adding mismatched types names both of them', () => {
  fails('1 + "a"', null, /cannot add number and string/);
  fails('[1] + {}', null, /cannot add array and object/);
});

test('subtraction works on numbers and removes array elements', () => {
  output('5 - 2', null, 3);
  output('[1, 2, 3] - [2]', null, [1, 3]);
  // Every occurrence goes, not just the first.
  output('[1, 2, 2, 3] - [2]', null, [1, 3]);
});

test('multiplication repeats strings and deep-merges objects', () => {
  output('2 * 3', null, 6);
  output('"ab" * 2', null, 'abab');
  // A repeat below one is null rather than an empty string, which lets a
  // separator be dropped entirely.
  output('"ab" * 0', null, null);
  output('{a: {b: 1}} * {a: {c: 2}}', null, { a: { b: 1, c: 2 } });
});

test('plus merges shallowly where star merges deeply', () => {
  // Both exist because both are wanted: one replaces a subtree, the other
  // merges into it.
  output('{a: {b: 1}} + {a: {c: 2}}', null, { a: { c: 2 } });
  output('{a: {b: 1}} * {a: {c: 2}}', null, { a: { b: 1, c: 2 } });
});


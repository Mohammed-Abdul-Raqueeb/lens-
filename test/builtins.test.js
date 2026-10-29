import { test } from 'node:test';
import assert from 'node:assert/strict';

import { builtinNames } from '../src/index.js';
import { fails, output, outputs } from './helpers.js';

test('length is defined for every type that has one', () => {
  output('length', [1, 2, 3], 3);
  output('length', { a: 1 }, 1);
  output('length', 'abc', 3);
  // null is 0, which lets `.items | length` work on a missing field.
  output('length', null, 0);
  // A number's length is its absolute value, which is the only total choice.
  output('length', -5, 5);
  fails('length', true, /boolean has no length/);
});

test('length counts code points, not UTF-16 units', () => {
  output('length', '\u{1f600}', 1);
});

test('utf8bytelength measures bytes', () => {
  output('utf8bytelength', 'abc', 3);
  output('utf8bytelength', 'é', 2);
});

test('keys sorts and keys_unsorted does not', () => {
  output('keys', { b: 1, a: 2 }, ['a', 'b']);
  output('keys_unsorted', { b: 1, a: 2 }, ['b', 'a']);
  // An array's keys are its indices.
  output('keys', ['x', 'y'], [0, 1]);
  fails('keys', 42, /keys needs an array or an object/);
});

test('has and in are the same question asked both ways', () => {
  output('has("a")', { a: 1 }, true);
  output('has("b")', { a: 1 }, false);
  output('has(1)', [1, 2], true);
  output('has(5)', [1, 2], false);
  output('"a" | in({a: 1})', null, true);
  fails('has(1)', { a: 1 }, /needs a string/);
});

test('type names every value', () => {
  output('type', null, 'null');
  output('type', true, 'boolean');
  output('type', 1, 'number');
  output('type', 'a', 'string');
  output('type', [], 'array');
  output('type', {}, 'object');
});


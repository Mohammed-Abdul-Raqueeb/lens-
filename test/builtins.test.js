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

test('empty yields nothing and error raises', () => {
  outputs('empty', 1, []);
  outputs('1, empty, 2', null, [1, 2]);
  fails('error("boom")', null, /boom/);
  fails('"piped" | error', null, /piped/);
});

test('select keeps and drops', () => {
  output('[.[] | select(. > 1)]', [1, 2, 3], [2, 3]);
  output('[.[] | select(.a)]', [{ a: true }, { a: false }], [{ a: true }]);
});

test('map applies to each element and flattens multi-output filters', () => {
  output('map(. + 1)', [1, 2], [2, 3]);
  output('map(., .)', [1], [1, 1]);
  // map over an object maps its values into an array.
  output('map(. + 1)', { a: 1, b: 2 }, [2, 3]);
  fails('map(.)', 42, /map needs an array or an object/);
});

test('map_values keeps the container shape and drops empties', () => {
  // The two differences from map, and both are why it exists.
  output('map_values(. + 1)', { a: 1 }, { a: 2 });
  output('map_values(select(. > 1))', { a: 1, b: 2 }, { b: 2 });
  output('map_values(select(. > 1))', [1, 2], [2]);
});

test('recurse with a filter walks a chain', () => {
  output('[recurse(if . < 8 then . * 2 else empty end)]', 1, [1, 2, 4, 8]);
});

test('recurse with a condition stops where it fails', () => {
  output('[recurse(. + 1; . < 4)]', 1, [1, 2, 3]);
});

test('range counts up, down and refuses a zero step', () => {
  output('[range(3)]', null, [0, 1, 2]);
  output('[range(1; 4)]', null, [1, 2, 3]);
  output('[range(0; 10; 3)]', null, [0, 3, 6, 9]);
  output('[range(3; 0; -1)]', null, [3, 2, 1]);
  output('[range(0)]', null, []);
  // An infinite generator would hang with no output and no explanation.
  fails('[range(0; 5; 0)]', null, /never finish/);
});


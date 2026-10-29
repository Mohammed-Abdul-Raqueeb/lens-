import { test } from 'node:test';
import assert from 'node:assert/strict';

import { query } from '../src/index.js';
import { fails, output, outputs } from './helpers.js';

test('tostring leaves strings alone and tojson does not', () => {
  // The whole difference between the two, and the reason both exist.
  output('tostring', 'a', 'a');
  output('tojson', 'a', '"a"');
  output('tostring', [1, 2], '[1,2]');
  output('tostring', null, 'null');
});

test('tonumber accepts numbers and numeric strings', () => {
  output('tonumber', 1, 1);
  output('tonumber', '1.5', 1.5);
  output('tonumber', ' 42 ', 42);
  output('tonumber', '-3', -3);
  output('tonumber', '1e3', 1000);
});

test('tonumber refuses the empty string rather than answering zero', () => {
  // Number('') is 0, which is a silent wrong answer in exactly the case a
  // CSV import produces.
  fails('tonumber', '', /empty string/);
  fails('tonumber', 'abc', /cannot read a number/);
  fails('tonumber', [], /needs a string or a number/);
});

test('fromjson parses, and says why when it cannot', () => {
  output('fromjson', '{"a":1}', { a: 1 });
  output('tojson | fromjson', { a: [1] }, { a: [1] });
  fails('fromjson', '{bad', /could not parse/);
  fails('fromjson', 42, /fromjson needs a string/);
});

test('case conversion is ASCII-only on purpose', () => {
  output('ascii_downcase', 'AbC', 'abc');
  output('ascii_upcase', 'AbC', 'ABC');
  // Non-ASCII is left alone, because toLowerCase is locale-sensitive and a
  // query whose result depends on the machine's locale is not reproducible.
  output('ascii_downcase', 'É', 'É');
});

test('explode and implode round-trip, by code point', () => {
  output('explode', 'abc', [97, 98, 99]);
  output('implode', [97, 98, 99], 'abc');
  output('explode | implode', 'a\u{1f600}b', 'a\u{1f600}b');
  fails('implode', ['a'], /needs code points/);
  fails('implode', [-1], /needs code points/);
});

test('split needs a non-empty separator', () => {
  output('split(",")', 'a,b,c', ['a', 'b', 'c']);
  output('split(",")', 'a', ['a']);
  // JavaScript would split into characters; explode is what was meant.
  fails('split("")', 'abc', /non-empty separator/);
});

test('join renders scalars and refuses containers', () => {
  output('join("-")', ['a', 'b'], 'a-b');
  output('join(",")', [1, 2], '1,2');
  // null becomes empty, which is what makes a sparse row joinable.
  output('join(",")', ['a', null, 'b'], 'a,,b');
  output('join(",")', [], '');
  fails('join(",")', [[1]], /cannot render array/);
});

test('ltrimstr and rtrimstr pass non-strings through unchanged', () => {
  // So `.[] | ltrimstr("v")` is safe over a mixed array.
  output('ltrimstr("a")', 'abc', 'bc');
  output('ltrimstr("x")', 'abc', 'abc');
  output('ltrimstr("a")', 42, 42);
  output('rtrimstr("c")', 'abc', 'ab');
  output('trimstr("a")', 'aba', 'b');
});

test('the trim family removes whitespace', () => {
  output('trim', '  a  ', 'a');
  output('ltrim', '  a  ', 'a  ');
  output('rtrim', '  a  ', '  a');
  fails('trim', 42, /trim needs a string/);
});

test('startswith and endswith require strings on both sides', () => {
  output('startswith("ab")', 'abc', true);
  output('endswith("bc")', 'abc', true);
  output('startswith("x")', 'abc', false);
  fails('startswith(1)', 'abc', /startswith needs a string/);
});

test('contains is substring, subset and submap in one', () => {
  output('contains("bc")', 'abcd', true);
  output('contains({a: 1})', { a: 1, b: 2 }, true);
  output('contains({a: 2})', { a: 1 }, false);
  output('contains([1])', [1, 2], true);
  // Array containment is recursive per element, which is how this is true.
  output('contains(["b"])', ['abc'], true);
  fails('contains(1)', 'abc', /needs a string/);
});

test('inside is contains with the operands swapped', () => {
  output('inside("abcd")', 'bc', true);
  output('inside([1, 2])', [1], true);
});

test('test reports a match without returning it', () => {
  output('test("^a")', 'abc', true);
  output('test("^b")', 'abc', false);
  output('test("A"; "i")', 'abc', true);
  fails('test(1)', 'abc', /string pattern/);
  fails('test("a")', 42, /test needs a string/);
});


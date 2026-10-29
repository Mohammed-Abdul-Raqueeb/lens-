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


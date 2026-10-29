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

test('an uncompilable pattern is reported, not thrown raw', () => {
  fails('test("(")', 'abc', /could not compile/);
});

test('an unknown regex flag is named', () => {
  fails('test("a"; "Z")', 'abc', /does not understand the flag/);
});

test('match returns offsets, lengths and captures', () => {
  const [found] = query('match("b")', 'abc');
  assert.equal(found.offset, 1);
  assert.equal(found.length, 1);
  assert.equal(found.string, 'b');
});

test('a global match finds every occurrence', () => {
  output('[match("a"; "g") | .offset]', 'aba', [0, 2]);
});

test('a global match of an empty pattern terminates', () => {
  // Without the explicit advance on a zero-length match this loops for ever.
  const results = query('[match("x*"; "g") | .offset]', 'ab');
  assert.ok(Array.isArray(results[0]));
});

test('capture returns named groups as an object', () => {
  output('capture("(?<y>[0-9]{4})")', 'in 2026', { y: '2026' });
  output('[capture("(?<a>x)"; "g")]', 'xx', [{ a: 'x' }, { a: 'x' }]);
});

test('scan yields whole matches, or the groups when there are groups', () => {
  // Both behaviours are wanted, which is why it switches.
  output('[scan("[0-9]+")]', 'a1b22', ['1', '22']);
  output('[scan("([a-z])([0-9])")]', 'a1b2', [['a', '1'], ['b', '2']]);
});

test('splits and the two-argument split use a regex', () => {
  output('[splits(",")]', 'a,b', ['a', 'b']);
  output('split("[,;]"; null)', 'a,b;c', ['a', 'b', 'c']);
});

test('sub replaces the first match and gsub replaces all', () => {
  output('sub("l"; "L")', 'hello', 'heLlo');
  output('gsub("l"; "L")', 'hello', 'heLLo');
  output('sub("x"; "y")', 'abc', 'abc');
});

test('a substitution replacement can read the named captures', () => {
  // The reason the replacement is a filter rather than a string.
  output('gsub("(?<d>[0-9])"; "[\\(.d)]")', 'a1b2', 'a[1]b[2]');
  output('sub("(?<x>a)"; .x + "!")', 'abc', 'a!bc');
});

test('a substitution with flags uses them', () => {
  output('gsub("A"; "x"; "i")', 'aAa', 'xxx');
});

test('a non-string replacement is refused', () => {
  fails('sub("a"; 1)', 'abc', /needs a string replacement/);
});

test('ascii turns a code point into a character', () => {
  output('ascii', 65, 'A');
  fails('ascii', 'A', /ascii needs a number/);
});

test('the text and json formats differ on strings', () => {
  output('@text', 'a', 'a');
  output('@json', 'a', '"a"');
  output('@text', [1], '[1]');
});

test('csv quotes strings and doubles inner quotes', () => {
  output('@csv', [1, 'a,b', null], '1,"a,b",');
  output('@csv', ['say "hi"'], '"say ""hi"""');
  fails('@csv', 'notanarray', /@csv needs an array/);
});

test('tsv escapes tabs and newlines rather than quoting', () => {
  // TSV has no quoting, so a raw tab would silently become a new column.
  output('@tsv', ['a\tb'], 'a\\tb');
  output('@tsv', ['a\nb'], 'a\\nb');
  output('@tsv', [1, null, 'x'], '1\t\tx');
});

test('html escapes the five characters that matter', () => {
  output('@html', '<a href="x">&\'</a>', '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('uri escapes the characters encodeURIComponent leaves alone', () => {
  output('@uri', 'a b', 'a%20b');
  output('@uri', 'a&b=c', 'a%26b%3Dc');
  // encodeURIComponent leaves these, and they are reserved in a query string.
  output('@uri', "!'()*", '%21%27%28%29%2A');
});

test('sh quotes for a shell, escaping inner quotes', () => {
  output('@sh', 'a b', "'a b'");
  output('@sh', "it's", "'it'\\''s'");
  output('@sh', ['a', 'b c'], "'a' 'b c'");
});

test('base64 round-trips, including non-ASCII', () => {
  output('@base64', 'hi', 'aGk=');
  output('@base64 | @base64d', 'hello é', 'hello é');
  fails('@base64d', 42, /@base64d needs a string/);
});

test('a format applied to an interpolated string formats only the parts', () => {
  // The point of the form: the literal ?q= must not be escaped.
  output('@uri "?q=\\(.term)"', { term: 'a b' }, '?q=a%20b');
  output('@base64 "v=\\(.x)"', { x: 'hi' }, 'v=aGk=');
});

test('an unknown format lists the real ones', () => {
  fails('@nope', null, /not a known format/);
  fails('@nope', null, /base64/);
});

test('string interpolation stringifies without quoting strings', () => {
  output('"a\\(.x)b"', { x: 'Y' }, 'aYb');
  output('"n=\\(.n)"', { n: 1 }, 'n=1');
  output('"v=\\(.v)"', { v: [1, 2] }, 'v=[1,2]');
  output('"v=\\(.v)"', { v: null }, 'v=null');
});

test('interpolation expands a multi-output expression', () => {
  outputs('"v=\\(1, 2)"', null, ['v=1', 'v=2']);
});

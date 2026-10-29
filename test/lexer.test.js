import { test } from 'node:test';
import assert from 'node:assert/strict';

import { throwsWith } from './helpers.js';

import { LexError } from '../src/errors.js';
import { TokenKind, tokenize } from '../src/lexer.js';

/** The tokens of a source, as `kind:value` pairs, with the EOF dropped. */
function kinds(source) {
  return tokenize(source)
    .filter((token) => token.kind !== TokenKind.EOF)
    .map((token) => `${token.kind}:${token.value}`);
}

test('an empty query is just EOF', () => {
  const tokens = tokenize('');
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].kind, TokenKind.EOF);
});

test('whitespace separates but does not appear', () => {
  assert.deepEqual(kinds('. | .'), ['op:.', 'op:|', 'op:.']);
  assert.deepEqual(kinds('.\t|\n.'), ['op:.', 'op:|', 'op:.']);
});

test('a comment runs to the end of the line', () => {
  assert.deepEqual(kinds('. # everything here is ignored\n| .'), ['op:.', 'op:|', 'op:.']);
});

test('a field is one token, not a dot and a name', () => {
  // The lexer decides this, because `.foo` and `. foo` mean different things
  // and the parser would have to re-join them otherwise.
  assert.deepEqual(kinds('.foo'), ['field:foo']);
  assert.deepEqual(kinds('.foo.bar'), ['field:foo', 'field:bar']);
});

test('a bare dot is an operator', () => {
  assert.deepEqual(kinds('.'), ['op:.']);
  assert.deepEqual(kinds('.[0]'), ['op:.', 'op:[', 'number:0', 'op:]']);
});

test('numbers lex as numbers, including fractions and exponents', () => {
  assert.deepEqual(kinds('1'), ['number:1']);
  assert.deepEqual(kinds('1.5'), ['number:1.5']);
  assert.deepEqual(kinds('1e3'), ['number:1000']);
  assert.deepEqual(kinds('1E-2'), ['number:0.01']);
});

test('a trailing e is not part of the number', () => {
  // `1e` is the number 1 and the identifier e, so the parser reports the
  // real problem rather than the lexer inventing a malformed number.
  assert.deepEqual(kinds('1e'), ['number:1', 'ident:e']);
});

test('a number is not joined to a following dot', () => {
  assert.deepEqual(kinds('1.foo'), ['number:1', 'field:foo']);
});

test('longest operators win', () => {
  // The reason OPERATORS is ordered. `//` must not lex as two divisions.
  assert.deepEqual(kinds('a // b'), ['ident:a', 'op://', 'ident:b']);
  assert.deepEqual(kinds('a //= b'), ['ident:a', 'op://=', 'ident:b']);
  assert.deepEqual(kinds('a |= b'), ['ident:a', 'op:|=', 'ident:b']);
  assert.deepEqual(kinds('a == b'), ['ident:a', 'op:==', 'ident:b']);
  assert.deepEqual(kinds('a <= b'), ['ident:a', 'op:<=', 'ident:b']);
  assert.deepEqual(kinds('..'), ['op:..']);
});

test('keywords are distinguished from identifiers', () => {
  assert.deepEqual(kinds('if'), ['keyword:if']);
  assert.deepEqual(kinds('map'), ['ident:map']);
  // `and` is syntax, so a function could not be called `and`.
  assert.deepEqual(kinds('and'), ['keyword:and']);
});

test('variables and formats carry their names without the sigil', () => {
  assert.deepEqual(kinds('$x'), ['variable:x']);
  assert.deepEqual(kinds('@base64'), ['format:base64']);
});


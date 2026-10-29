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


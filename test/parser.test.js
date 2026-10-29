import { test } from 'node:test';
import assert from 'node:assert/strict';

import { sameShape, throwsWith } from './helpers.js';

import { Node } from '../src/ast.js';
import { ParseError } from '../src/errors.js';
import { parse } from '../src/parser.js';

test('identity parses to an Identity node', () => {
  assert.equal(parse('.').type, Node.IDENTITY);
});

test('an empty query is rejected rather than treated as identity', () => {
  // `lens ''` is almost certainly a mistake in a shell script, and silently
  // echoing the input would hide it.
  const error = throwsWith(() => parse(''), ParseError);
  assert.match(error.message, /empty/);
});

test('field access chains into pipes', () => {
  const ast = parse('.a.b');
  assert.equal(ast.type, Node.PIPE);
  assert.equal(ast.left.type, Node.FIELD);
  assert.equal(ast.right.type, Node.FIELD);
});

test('pipes are left-associative', () => {
  // `a | b | c` is `(a | b) | c`. Either association gives the same results
  // for a pipe, but the tree shape is asserted so a change is visible.
  const ast = parse('.a | .b | .c');
  assert.equal(ast.type, Node.PIPE);
  assert.equal(ast.left.type, Node.PIPE);
});


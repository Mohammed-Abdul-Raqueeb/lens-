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

test('comma binds tighter than pipe', () => {
  const ast = parse('.a, .b | .c');
  assert.equal(ast.type, Node.PIPE);
  assert.equal(ast.left.type, Node.COMMA);
});

test('arithmetic follows the usual precedence', () => {
  const ast = parse('1 + 2 * 3');
  assert.equal(ast.type, Node.BINARY);
  assert.equal(ast.op, '+');
  assert.equal(ast.right.op, '*');
});

test('parentheses override precedence', () => {
  const ast = parse('(1 + 2) * 3');
  assert.equal(ast.op, '*');
  assert.equal(ast.left.op, '+');
});

test('unary minus binds tighter than arithmetic', () => {
  const ast = parse('-1 + 2');
  assert.equal(ast.op, '+');
  assert.equal(ast.left.type, Node.NEGATE);
});

test('and binds tighter than or', () => {
  const ast = parse('a or b and c');
  assert.equal(ast.type, Node.OR);
  assert.equal(ast.right.type, Node.AND);
});

test('comparison binds tighter than and', () => {
  const ast = parse('.a > 1 and .b < 2');
  assert.equal(ast.type, Node.AND);
  assert.equal(ast.left.type, Node.BINARY);
});

test('comparisons do not chain', () => {
  // `a < b < c` means something different to everyone who reads it, so it is
  // refused rather than given an association.
  const error = throwsWith(() => parse('1 < 2 < 3'), ParseError);
  assert.match(error.message, /cannot be chained/);
  assert.match(error.message, /parenthesise/);
});


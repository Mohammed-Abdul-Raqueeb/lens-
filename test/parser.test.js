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

test('assignment does not chain', () => {
  const error = throwsWith(() => parse('.a = .b = 1'), ParseError);
  assert.match(error.message, /does not chain/);
});

test('alternative binds looser than assignment', () => {
  const ast = parse('.a // .b');
  assert.equal(ast.type, Node.ALTERNATIVE);
});

test('literals parse, including the three bare words', () => {
  assert.equal(parse('1').value, 1);
  assert.equal(parse('"s"').value, 's');
  assert.equal(parse('true').value, true);
  assert.equal(parse('false').value, false);
  assert.equal(parse('null').value, null);
});

test('an array literal holds its body, and an empty one holds null', () => {
  assert.equal(parse('[.a]').type, Node.ARRAY);
  assert.equal(parse('[]').body, null);
});

test('object entries parse, including shorthand and computed keys', () => {
  const plain = parse('{a: 1}');
  assert.equal(plain.type, Node.OBJECT);
  assert.equal(plain.entries.length, 1);

  // `{a}` means `{a: .a}`.
  const shorthand = parse('{a}');
  assert.equal(shorthand.entries[0].value.type, Node.FIELD);
  assert.equal(shorthand.entries[0].value.name, 'a');

  // `{$x}` means `{x: $x}`.
  const variable = parse('{$x}');
  assert.equal(variable.entries[0].value.type, Node.VARIABLE);

  const computed = parse('{(.k): 1}');
  assert.equal(computed.entries[0].key.type, Node.FIELD);
});

test('a keyword is allowed as an object key', () => {
  // Refusing this would make a lot of real JSON unqueryable.
  const ast = parse('{if: 1, and: 2, end: 3}');
  assert.equal(ast.entries.length, 3);
  assert.equal(ast.entries[0].key.value, 'if');
});

test('a trailing comma in an object is accepted', () => {
  // Object literals get edited line by line; a parse error on a line nobody
  // touched is a poor trade for strictness.
  const ast = parse('{a: 1, b: 2,}');
  assert.equal(ast.entries.length, 2);
});

test('an object value stops at the comma', () => {
  const ast = parse('{a: 1, b: 2}');
  assert.equal(ast.entries[0].value.value, 1);
  assert.equal(ast.entries[1].value.value, 2);
});

test('a computed key with no value is an error naming the fix', () => {
  const error = throwsWith(() => parse('{(.k)}'), ParseError);
  assert.match(error.message, /needs a ':'/);
});

test('suffixes read left to right', () => {
  const ast = parse('.a[0]');
  assert.equal(ast.type, Node.PIPE);
  assert.equal(ast.right.type, Node.INDEX);
});

test('an optional dot before a bracket is allowed', () => {
  // Both `.a[0]` and `.a.[0]` appear in the wild. Compared by shape rather
  // than by JSON, because the extra dot shifts every offset in the tree.
  sameShape(parse('.a.[0]'), parse('.a[0]'));
});

test('iterate, index and slice are distinguished by their contents', () => {
  assert.equal(parse('.[]').type, Node.ITERATE);
  assert.equal(parse('.[0]').type, Node.INDEX);
  assert.equal(parse('.[1:2]').type, Node.SLICE);
});

test('a slice may omit either bound', () => {
  const from = parse('.[2:]');
  assert.equal(from.type, Node.SLICE);
  assert.equal(from.to, null);

  const to = parse('.[:2]');
  assert.equal(to.type, Node.SLICE);
  assert.equal(to.from, null);
});

test('a question mark wraps what precedes it', () => {
  const ast = parse('.a?');
  assert.equal(ast.type, Node.OPTIONAL);
});

test('a quoted field name parses as a field', () => {
  const ast = parse('."a-b"');
  assert.equal(ast.type, Node.FIELD);
  assert.equal(ast.name, 'a-b');
});


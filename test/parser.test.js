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

test('an interpolated field name is refused, pointing at the alternative', () => {
  const error = throwsWith(() => parse('."\\(.x)"'), ParseError);
  assert.match(error.message, /\.\[expr\]/);
});

test('calls parse with and without arguments', () => {
  assert.equal(parse('length').type, Node.CALL);
  assert.equal(parse('length').args.length, 0);
  assert.equal(parse('map(.a)').args.length, 1);
  assert.equal(parse('sub("a"; "b")').args.length, 2);
});

test('if parses, with and without else', () => {
  const withElse = parse('if .a then 1 else 2 end');
  assert.equal(withElse.type, Node.IF);
  assert.ok(withElse.else);

  const without = parse('if .a then 1 end');
  assert.equal(without.else, null);
});

test('elif desugars into a nested if', () => {
  // One case in the evaluator instead of two.
  const ast = parse('if .a then 1 elif .b then 2 else 3 end');
  assert.equal(ast.type, Node.IF);
  assert.equal(ast.else.type, Node.IF);
  assert.equal(ast.else.else.value, 3);
});

test('an if missing its end is reported', () => {
  throwsWith(() => parse('if .a then 1'), ParseError);
});

test('a dangling then is reported with a hint', () => {
  const error = throwsWith(() => parse('then 1 end'), ParseError);
  assert.match(error.message, /belongs to an if/);
});

test('try binds tighter than a pipe', () => {
  // `try .a | .b` is `(try .a) | .b`: the catch covers the attempt, not
  // everything downstream.
  const ast = parse('try .a | .b');
  assert.equal(ast.type, Node.PIPE);
  assert.equal(ast.left.type, Node.TRY);
});

test('try parses with and without a catch', () => {
  assert.equal(parse('try .a').handler, null);
  assert.ok(parse('try .a catch .').handler);
});

test('reduce and foreach parse their three and four parts', () => {
  const reduce = parse('reduce .[] as $x (0; . + $x)');
  assert.equal(reduce.type, Node.REDUCE);
  assert.equal(reduce.pattern.name, 'x');

  const foreach = parse('foreach .[] as $x (0; . + $x; .)');
  assert.equal(foreach.type, Node.FOREACH);
  assert.ok(foreach.extract);

  const noExtract = parse('foreach .[] as $x (0; . + $x)');
  assert.equal(noExtract.extract, null);
});

test('as binds over the rest of the pipeline', () => {
  const ast = parse('.a as $x | $x + 1');
  assert.equal(ast.type, Node.BIND);
  assert.equal(ast.pattern.name, 'x');
});

test('a destructuring pattern is refused by name', () => {
  const error = throwsWith(() => parse('. as [$a] | $a'), ParseError);
  assert.match(error.message, /destructuring/);
});

test('def parses, and scopes over what follows the semicolon', () => {
  const ast = parse('def double: . * 2; double');
  assert.equal(ast.type, Node.FUNCDEF);
  assert.equal(ast.name, 'double');
  assert.equal(ast.rest.type, Node.CALL);
});

test('def parameters are distinguished by their sigil', () => {
  const filter = parse('def f(g): g; f(.)');
  assert.equal(filter.params[0].isValue, false);

  const byValue = parse('def f($x): $x; f(1)');
  assert.equal(byValue.params[0].isValue, true);
});

test('a def with no body after it is still valid', () => {
  const ast = parse('def f: 1;');
  assert.equal(ast.rest.type, Node.IDENTITY);
});

test('formats parse alone and applied to a string', () => {
  assert.equal(parse('@base64').body, null);
  assert.ok(parse('@base64 "x\\(.a)"').body);
});

test('two fields separated by a space are one path', () => {
  // `.a .b` means `.a.b`, which is what jq does. Worth pinning rather than
  // leaving to chance: the postfix loop is what makes it true, and a change
  // there would silently alter the meaning of real queries.
  sameShape(parse('.a .b'), parse('.a.b'));
});

test('a second complete expression after a query is reported', () => {
  // A field is a suffix, so it attaches. A literal is not, so it cannot.
  const error = throwsWith(() => parse('.a 1'), ParseError);
  assert.match(error.message, /after the end of the query/);
});

test('an unclosed bracket is reported with what was expected', () => {
  const error = throwsWith(() => parse('[1'), ParseError);
  assert.match(error.message, /expected '\]'/);
});

test('errors carry an offset into the query', () => {
  const error = throwsWith(() => parse('.a | | .b'), ParseError);
  assert.equal(typeof error.offset, 'number');
  assert.ok(error.offset > 0);
});

test('a formatted error draws a caret under the problem', () => {
  const error = throwsWith(() => parse('.a | | .b'), ParseError);
  const lines = error.format().split('\n');
  assert.equal(lines.length, 3);
  assert.match(lines[1], /\.a \| \| \.b/);
  assert.match(lines[2], /^\s+\^$/);
});

test('a query nested past the limit is reported rather than overflowing', () => {
  // The parser is recursive and the query is user input.
  const deep = '('.repeat(500) + '.' + ')'.repeat(500);
  const error = throwsWith(() => parse(deep), ParseError);
  assert.match(error.message, /nests too deeply/);
});

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

test('the arithmetic builtins check their input type', () => {
  output('floor', 1.7, 1);
  output('ceil', 1.2, 2);
  output('round', 1.5, 2);
  output('fabs', -3, 3);
  output('abs', -3, 3);
  output('sqrt', 9, 3);
  output('pow(2; 10)', null, 1024);
  output('log2', 8, 3);
  fails('floor', 'x', /floor needs a number/);
});

test('sqrt of a negative is an error rather than NaN', () => {
  // NaN has no JSON form, so it would fail at output time instead.
  fails('sqrt', -1, /sqrt/);
});

test('the number predicates classify without throwing', () => {
  output('isnan', 1, false);
  output('isinfinite', 1, false);
  output('isnormal', 1, true);
  output('isnormal', 0, false);
  output('isnan', 'text', false);
});

test('isvalid reports whether a filter would fail', () => {
  output('isvalid(.a)', { a: 1 }, true);
  output('isvalid(.a)', 42, false);
});

test('sort uses the total order', () => {
  output('sort', [3, 1, 2], [1, 2, 3]);
  output('sort', ['b', 'a'], ['a', 'b']);
  // Mixed types sort by type rank rather than erroring, which is what makes
  // sorting a real document possible.
  output('sort', [1, null, 'a', true], [null, true, 1, 'a']);
  fails('sort', 42, /sort needs an array/);
});

test('sort_by is stable, which is what makes multi-level sorting work', () => {
  const input = [
    { k: 1, id: 'a' },
    { k: 0, id: 'b' },
    { k: 1, id: 'c' },
    { k: 0, id: 'd' },
  ];
  output('[sort_by(.k)[] | .id]', input, ['b', 'd', 'a', 'c']);
});

test('sort_by on several keys orders by all of them', () => {
  const input = [{ a: 1, b: 2 }, { a: 1, b: 1 }, { a: 0, b: 9 }];
  output('[sort_by(.a, .b)[] | .b]', input, [9, 1, 2]);
});

test('group_by groups every occurrence of a key', () => {
  output(
    'group_by(.t) | map(map(.id))',
    [{ t: 'a', id: 1 }, { t: 'b', id: 2 }, { t: 'a', id: 3 }],
    [[1, 3], [2]],
  );
});

test('unique sorts and deduplicates', () => {
  output('unique', [3, 1, 2, 1, 3], [1, 2, 3]);
  output('unique', [], []);
});

test('unique_by keeps the first of each group', () => {
  const input = [{ k: 1, id: 'a' }, { k: 1, id: 'b' }, { k: 2, id: 'c' }];
  output('[unique_by(.k)[] | .id]', input, ['a', 'c']);
});

test('reverse handles arrays, strings and null', () => {
  output('reverse', [1, 2, 3], [3, 2, 1]);
  output('reverse', 'abc', 'cba');
  output('reverse', null, []);
});

test('min and max of an empty array are null', () => {
  // So a report query over an empty list does not fail.
  output('min', [], null);
  output('max', [], null);
  output('min', [3, 1, 2], 1);
  output('max', [3, 1, 2], 3);
});

test('min_by and max_by keep the earlier element on a tie', () => {
  output('min_by(.k) | .id', [{ k: 1, id: 'a' }, { k: 1, id: 'b' }], 'a');
  output('max_by(.k) | .id', [{ k: 1, id: 'a' }, { k: 1, id: 'b' }], 'a');
  output('min_by(.k) | .id', [{ k: 2, id: 'a' }, { k: 1, id: 'b' }], 'b');
});

test('add folds with the overloaded plus', () => {
  output('add', [1, 2, 3], 6);
  output('add', ['a', 'b'], 'ab');
  output('add', [[1], [2]], [1, 2]);
  output('add', [{ a: 1 }, { b: 2 }], { a: 1, b: 2 });
  output('add', [], null);
  output('add', { a: 1, b: 2 }, 3);
});

test('any of nothing is false and all of nothing is true', () => {
  // The second surprises people and is the only answer that keeps
  // all(f) and all(g) == all(f and g) true over empty input.
  output('any', [], false);
  output('all', [], true);
  output('any', [false, true], true);
  output('all', [true, false], false);
});

test('any and all with a filter short-circuit', () => {
  output('any(. > 2)', [1, 2, 3], true);
  output('all(. > 0)', [1, 2, 3], true);
  // The predicate would error on the string, and is never reached.
  output('any(. == 1)', [1, 'x'], true);
});

test('flatten goes all the way down or to a depth', () => {
  output('flatten', [1, [2, [3, [4]]]], [1, 2, 3, 4]);
  output('flatten(1)', [1, [2, [3]]], [1, 2, [3]]);
  output('flatten(0)', [1, [2]], [1, [2]]);
  fails('flatten(-1)', [], /depth of 0 or more/);
});

test('first and last work on arrays and on filters', () => {
  output('first', [1, 2], 1);
  output('last', [1, 2], 2);
  output('first', [], null);
  output('first(.[])', [1, 2], 1);
  output('last(.[])', [1, 2], 2);
  outputs('first(empty)', null, []);
});

test('first stops the generator rather than draining it', () => {
  // The reason it beats `[f] | .[0]`: this would be a million values
  // otherwise.
  output('first(range(1000000))', null, 0);
});

test('nth indexes an array or a filter', () => {
  output('nth(1)', [10, 20, 30], 20);
  output('nth(9)', [1], null);
  output('nth(2; .[])', [10, 20, 30], 30);
  fails('nth(-1)', [1], /index of 0 or more/);
});

test('limit takes at most n and stops early', () => {
  output('[limit(2; .[])]', [1, 2, 3], [1, 2]);
  output('[limit(0; .[])]', [1, 2], []);
  output('[limit(2; range(1000000))]', null, [0, 1]);
});

test('until and while iterate, and are bounded', () => {
  output('until(. > 4; . + 1)', 1, 5);
  output('[while(. < 4; . + 1)]', 1, [1, 2, 3]);
  // An unbounded loop would hang with no output; the bound makes it an error.
  fails('until(false; .)', 1, /million times/);
});

test('repeat needs a limit to terminate', () => {
  output('[limit(3; repeat(. * 2))]', 1, [1, 2, 4]);
});

test('indices finds every occurrence, including overlapping ones', () => {
  output('indices(2)', [1, 2, 3, 2], [1, 3]);
  output('indices("b")', 'abcb', [1, 3]);
  output('indices([1, 2])', [0, 1, 2, 1, 2], [1, 3]);
  // "aa" occurs at 0 and 1 in "aaa": overlapping matches both count.
  output('indices("aa")', 'aaa', [0, 1]);
  output('indices("x")', null, null);
});

test('index and rindex give the first and last', () => {
  output('index("b")', 'abcb', 1);
  output('rindex("b")', 'abcb', 3);
  output('index("z")', 'abc', null);
});

test('combinations takes one from each array', () => {
  output('[combinations]', [[1, 2], [3, 4]], [[1, 3], [1, 4], [2, 3], [2, 4]]);
  output('[combinations]', [], [[]]);
});

test('transpose pads short rows so the result is rectangular', () => {
  output('transpose', [[1, 2], [3]], [[1, 3], [2, null]]);
  output('transpose', [], []);
});

test('to_entries and from_entries round-trip an object', () => {
  output('to_entries', { a: 1 }, [{ key: 'a', value: 1 }]);
  output('to_entries | from_entries', { a: 1, b: 2 }, { a: 1, b: 2 });
  // Insertion order survives, so round-tripping does not reorder fields.
  output('to_entries | map(.key)', { b: 1, a: 2 }, ['b', 'a']);
});

test('from_entries accepts the shapes entry lists arrive in', () => {
  output('from_entries', [{ key: 'a', value: 1 }], { a: 1 });
  output('from_entries', [{ k: 'a', v: 1 }], { a: 1 });
  output('from_entries', [{ name: 'a', value: 1 }], { a: 1 });
  output('from_entries', [['a', 1]], { a: 1 });
  // A bare scalar becomes a key with a null value, which makes a set.
  output('from_entries', ['a', 'b'], { a: null, b: null });
});

test('with_entries transforms keys and values together', () => {
  output('with_entries(.value += 1)', { a: 1 }, { a: 2 });
  output('with_entries(.key |= ascii_upcase)', { a: 1 }, { A: 1 });
});

test('paths lists every path, and leaf_paths only the scalars', () => {
  output('[paths]', { a: { b: 1 } }, [['a'], ['a', 'b']]);
  output('[leaf_paths]', { a: { b: 1 } }, [['a', 'b']]);
  output('[paths(type == "number")]', { a: 1, b: 'x' }, [['a']]);
});


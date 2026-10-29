/**
 * Builtins over arrays: sorting, grouping, folding and slicing.
 *
 * The `_by` family is the reason several of these take a filter rather than a
 * value. `sort_by(.age)` has to evaluate `.age` per element, so it cannot be
 * a `valued` builtin -- the argument is a function, not a thing.
 */

import { typeName } from '../errors.js';
import { evaluate } from '../eval.js';
import { compare, equals, sorted, truthy } from '../values.js';
import {
  fail, require as requireType, simple, streaming, valued, valuedStreaming,
} from './define.js';

/** Evaluates a filter against an element, taking its first output. */
function keyOf(argNode, element, env, context, builtinName) {
  for (const value of evaluate(argNode, element, env)) {
    return value;
  }
  // A key filter yielding nothing would make the element's position in the
  // ordering undefined, so it is an error rather than a silent null.
  return fail(
    context,
    `${builtinName} needs a key for every element, but the key filter`
      + ' produced nothing for one',
    element,
  );
}

const sort = simple((input, context) => {
  requireType(input, 'array', 'sort', context);
  return sorted(input);
});

/**
 * `sort_by(f)` — stable, and that is a promise rather than an accident.
 *
 * Sorting by one field and then another is how multi-level ordering is
 * expressed, and it only works if each sort preserves the previous order for
 * equal keys. The index tiebreak below is what guarantees it, since
 * `Array.prototype.sort` is only specified as stable for the comparison
 * function it is given.
 */
const sortBy = function* sortBy(node, input, env) {
  const context = { node, env };
  requireType(input, 'array', 'sort_by', context);

  const decorated = input.map((element, index) => ({
    element,
    index,
    // Collected into an array so `sort_by(.a, .b)` orders by both, which is
    // jq's behaviour and falls out of the total order over arrays.
    key: [...evaluate(node.args[0], element, env)],
  }));

  decorated.sort((left, right) => {
    const byKey = compare(left.key, right.key);
    return byKey !== 0 ? byKey : left.index - right.index;
  });

  yield decorated.map((entry) => entry.element);
};

/**
 * `group_by(f)` — groups adjacent equal keys after sorting by them.
 *
 * Sorting first is what makes the groups complete; grouping a stream without
 * sorting would split a key that appears in two places into two groups.
 */
const groupBy = function* groupBy(node, input, env) {
  const context = { node, env };
  requireType(input, 'array', 'group_by', context);

  const decorated = input.map((element, index) => ({
    element,
    index,
    key: keyOf(node.args[0], element, env, context, 'group_by'),
  }));

  decorated.sort((left, right) => {
    const byKey = compare(left.key, right.key);
    return byKey !== 0 ? byKey : left.index - right.index;
  });

  const groups = [];
  let currentKey;
  let current = null;

  for (const entry of decorated) {
    if (current === null || !equals(currentKey, entry.key)) {
      current = [];
      groups.push(current);
      currentKey = entry.key;
    }
    current.push(entry.element);
  }

  yield groups;
};

const unique = simple((input, context) => {
  requireType(input, 'array', 'unique', context);

  const out = [];
  for (const element of sorted(input)) {
    if (out.length === 0 || !equals(out[out.length - 1], element)) out.push(element);
  }
  return out;
});

/** `unique_by(f)` — the first element of each group, in key order. */
const uniqueBy = function* uniqueBy(node, input, env) {
  const context = { node, env };
  requireType(input, 'array', 'unique_by', context);

  const decorated = input.map((element, index) => ({
    element,
    index,
    key: keyOf(node.args[0], element, env, context, 'unique_by'),
  }));

  decorated.sort((left, right) => {
    const byKey = compare(left.key, right.key);
    return byKey !== 0 ? byKey : left.index - right.index;
  });

  const out = [];
  let lastKey;
  let started = false;
  for (const entry of decorated) {
    if (!started || !equals(lastKey, entry.key)) {
      out.push(entry.element);
      lastKey = entry.key;
      started = true;
    }
  }
  yield out;
};

const reverse = simple((input, context) => {
  if (input === null) return [];
  if (typeof input === 'string') return [...input].reverse().join('');
  requireType(input, 'array', 'reverse', context);
  return [...input].reverse();
});

/**
 * `min` and `max` on an empty array are null, not an error.
 *
 * That makes `[.items[] | .price] | min` safe against an empty list, which is
 * the case a report query hits first.
 */
const min = simple((input, context) => {
  requireType(input, 'array', 'min', context);
  if (input.length === 0) return null;
  return input.reduce((best, element) => (compare(element, best) < 0 ? element : best));
});

const max = simple((input, context) => {
  requireType(input, 'array', 'max', context);
  if (input.length === 0) return null;
  return input.reduce((best, element) => (compare(element, best) > 0 ? element : best));
});

const extremeBy = (builtinName, wanted) => function* body(node, input, env) {
  const context = { node, env };
  requireType(input, 'array', builtinName, context);
  if (input.length === 0) {
    yield null;
    return;
  }

  let bestElement = input[0];
  let bestKey = keyOf(node.args[0], input[0], env, context, builtinName);

  for (let i = 1; i < input.length; i++) {
    const key = keyOf(node.args[0], input[i], env, context, builtinName);
    // Strictly better, so ties keep the earlier element -- which makes the
    // result stable and matches what `sort_by | first` would give.
    if (Math.sign(compare(key, bestKey)) === wanted) {
      bestElement = input[i];
      bestKey = key;
    }
  }

  yield bestElement;
};

const add = simple((input, context) => {
  if (input === null) return null;

  let values;
  if (Array.isArray(input)) {
    values = input;
  } else if (typeof input === 'object') {
    values = Object.keys(input).map((key) => input[key]);
  } else {
    return fail(context, `add needs an array or an object, not ${typeName(input)}`, input);
  }

  if (values.length === 0) return null;

  // Reduced with the language's own `+`, so adding an array of arrays
  // concatenates and adding an array of objects merges -- the overloading is
  // the feature, not an accident of implementation.
  return values.reduce((total, element) => addPair(total, element, context));
});

function addPair(left, right, context) {
  if (left === null) return right;
  if (right === null) return left;
  if (typeof left === 'number' && typeof right === 'number') return left + right;
  if (typeof left === 'string' && typeof right === 'string') return left + right;
  if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];
  if (isPlainObject(left) && isPlainObject(right)) return { ...left, ...right };
  return fail(context, `add cannot combine ${typeName(left)} and ${typeName(right)}`, left);
}

/**
 * `any` and `all` on an empty array follow logic rather than intuition.
 *
 * `any` of nothing is false and `all` of nothing is true. The second
 * surprises people, and it is the only answer that keeps
 * `all(f) and all(g) == all(f and g)` true when either side is empty.
 */
const any0 = simple((input, context) => {
  requireType(input, 'array', 'any', context);
  return input.some(truthy);
});

const all0 = simple((input, context) => {
  requireType(input, 'array', 'all', context);
  return input.every(truthy);
});

const any1 = function* any1(node, input, env) {
  const context = { node, env };
  requireType(input, 'array', 'any', context);
  for (const element of input) {
    for (const test of evaluate(node.args[0], element, env)) {
      // Short-circuits: a predicate that errors on a later element is never
      // reached once one has matched.
      if (truthy(test)) {
        yield true;
        return;
      }
    }
  }
  yield false;
};

const all1 = function* all1(node, input, env) {
  const context = { node, env };
  requireType(input, 'array', 'all', context);
  for (const element of input) {
    for (const test of evaluate(node.args[0], element, env)) {
      if (!truthy(test)) {
        yield false;
        return;
      }
    }
  }
  yield true;
};

/** `flatten` — all the way down. */
const flatten0 = simple((input, context) => {
  requireType(input, 'array', 'flatten', context);
  return flattenTo(input, Infinity);
});

/** `flatten(depth)` — only that many levels. */
const flatten1 = valued(1, (input, [depth], context) => {
  requireType(input, 'array', 'flatten', context);
  requireType(depth, 'number', 'flatten', context);
  if (depth < 0) return fail(context, `flatten needs a depth of 0 or more, got ${depth}`, depth);
  return flattenTo(input, depth);
});

function flattenTo(values, depth) {
  const out = [];
  for (const element of values) {
    if (Array.isArray(element) && depth > 0) {
      out.push(...flattenTo(element, depth - 1));
    } else {
      out.push(element);
    }
  }
  return out;
}

/**
 * `first(f)` — the first output of `f`, and only that.
 *
 * The `return` after the first yield is what makes this worth having over
 * `[f] | .[0]`: it stops the generator, so `first(range(1e9))` touches one
 * value rather than a billion.
 */
const first1 = function* first1(node, input, env) {
  for (const value of evaluate(node.args[0], input, env)) {
    yield value;
    return;
  }
};

const first0 = simple((input, context) => {
  requireType(input, 'array', 'first', context);
  return input.length === 0 ? null : input[0];
});

const last1 = function* last1(node, input, env) {
  let found;
  let any = false;
  for (const value of evaluate(node.args[0], input, env)) {
    found = value;
    any = true;
  }
  if (any) yield found;
};

const last0 = simple((input, context) => {
  requireType(input, 'array', 'last', context);
  return input.length === 0 ? null : input[input.length - 1];
});

const nth1 = valued(1, (input, [at], context) => {
  requireType(input, 'array', 'nth', context);
  requireType(at, 'number', 'nth', context);
  if (at < 0) return fail(context, `nth needs an index of 0 or more, got ${at}`, at);
  return at < input.length ? input[at] : null;
});

const nth2 = function* nth2(node, input, env) {
  const context = { node, env };
  for (const at of evaluate(node.args[0], input, env)) {
    requireType(at, 'number', 'nth', context);
    if (at < 0) fail(context, `nth needs an index of 0 or more, got ${at}`, at);

    let seen = 0;
    for (const value of evaluate(node.args[1], input, env)) {
      if (seen === at) {
        yield value;
        break;
      }
      seen++;
    }
  }
};

/** `limit(n; f)` — at most `n` outputs of `f`, stopping early. */
const limit = function* limit(node, input, env) {
  const context = { node, env };
  for (const count of evaluate(node.args[0], input, env)) {
    requireType(count, 'number', 'limit', context);
    if (count <= 0) continue;

    let emitted = 0;
    for (const value of evaluate(node.args[1], input, env)) {
      yield value;
      emitted++;
      if (emitted >= count) break;
    }
  }
};

/** `until(cond; update)` — applies `update` until `cond` holds. */
const until = function* until(node, input, env) {
  const context = { node, env };
  let current = input;

  // Bounded, because `until` with a condition that never holds is an infinite
  // loop with no output -- indistinguishable from a hang.
  for (let step = 0; step < 1_000_000; step++) {
    let done = false;
    for (const test of evaluate(node.args[0], current, env)) {
      done = truthy(test);
      break;
    }
    if (done) {
      yield current;
      return;
    }

    let next;
    let produced = false;
    for (const candidate of evaluate(node.args[1], current, env)) {
      next = candidate;
      produced = true;
      break;
    }
    if (!produced) return;
    current = next;
  }

  fail(context, 'until ran a million times without its condition becoming true');
};

/** `while(cond; update)` — the values for which `cond` holds. */
const whileLoop = function* whileLoop(node, input, env) {
  const context = { node, env };
  let current = input;

  for (let step = 0; step < 1_000_000; step++) {
    let keep = false;
    for (const test of evaluate(node.args[0], current, env)) {
      keep = truthy(test);
      break;
    }
    if (!keep) return;
    yield current;

    let next;
    let produced = false;
    for (const candidate of evaluate(node.args[1], current, env)) {
      next = candidate;
      produced = true;
      break;
    }
    if (!produced) return;
    current = next;
  }

  fail(context, 'while ran a million times without its condition becoming false');
};

/** `repeat(f)` — `f` applied over and over. Needs a `limit` or an error to stop. */
const repeat = function* repeat(node, input, env) {
  let current = input;
  for (let step = 0; step < 1_000_000; step++) {
    yield current;
    let next;
    let produced = false;
    for (const candidate of evaluate(node.args[0], current, env)) {
      next = candidate;
      produced = true;
      break;
    }
    if (!produced) return;
    current = next;
  }
  fail({ node, env }, 'repeat ran a million times; use limit to bound it');
};

/** `indices(x)` — where `x` occurs, by element, substring or subsequence. */
const indices = valued(1, (input, [needle], context) => {
  if (input === null) return null;

  if (typeof input === 'string') {
    if (typeof needle !== 'string') {
      return fail(context, `indices on a string needs a string, not ${typeName(needle)}`, needle);
    }
    return stringIndices(input, needle);
  }

  if (!Array.isArray(input)) {
    return fail(context, `indices needs a string or an array, not ${typeName(input)}`, input);
  }

  if (Array.isArray(needle)) {
    if (needle.length === 0) return null;
    const out = [];
    for (let i = 0; i + needle.length <= input.length; i++) {
      if (needle.every((element, j) => equals(input[i + j], element))) out.push(i);
    }
    return out;
  }

  const out = [];
  input.forEach((element, i) => {
    if (equals(element, needle)) out.push(i);
  });
  return out;
});

function stringIndices(haystack, needle) {
  if (needle.length === 0) return null;
  const out = [];
  let at = haystack.indexOf(needle);
  while (at !== -1) {
    out.push(at);
    // Advances by one rather than by the needle's length, so overlapping
    // occurrences are all reported -- "aa" in "aaa" is at 0 and 1.
    at = haystack.indexOf(needle, at + 1);
  }
  return out;
}

const index1 = valued(1, (input, [needle], context) => {
  const found = indicesOf(input, needle, context);
  return found === null || found.length === 0 ? null : found[0];
});

const rindex1 = valued(1, (input, [needle], context) => {
  const found = indicesOf(input, needle, context);
  return found === null || found.length === 0 ? null : found[found.length - 1];
});

function indicesOf(input, needle, context) {
  if (input === null) return null;
  if (typeof input === 'string') {
    if (typeof needle !== 'string') {
      return fail(context, `index on a string needs a string, not ${typeName(needle)}`, needle);
    }
    return stringIndices(input, needle);
  }
  if (!Array.isArray(input)) {
    return fail(context, `index needs a string or an array, not ${typeName(input)}`, input);
  }
  if (Array.isArray(needle)) {
    if (needle.length === 0) return null;
    const out = [];
    for (let i = 0; i + needle.length <= input.length; i++) {
      if (needle.every((element, j) => equals(input[i + j], element))) out.push(i);
    }
    return out;
  }
  const out = [];
  input.forEach((element, i) => {
    if (equals(element, needle)) out.push(i);
  });
  return out;
}

/** `combinations` — one element from each of several arrays, every way. */
const combinations0 = streaming(function* body(input, context) {
  requireType(input, 'array', 'combinations', context);
  yield* cartesian(input, 0, [], context);
});

function* cartesian(arrays, at, prefix, context) {
  if (at === arrays.length) {
    yield [...prefix];
    return;
  }
  const current = arrays[at];
  if (!Array.isArray(current)) {
    fail(context, `combinations needs an array of arrays, found ${typeName(current)}`, current);
  }
  for (const element of current) {
    prefix.push(element);
    yield* cartesian(arrays, at + 1, prefix, context);
    prefix.pop();
  }
}

/** `transpose` — rows to columns, padding short rows with null. */
const transpose = simple((input, context) => {
  requireType(input, 'array', 'transpose', context);

  const width = input.reduce((widest, row) => {
    if (!Array.isArray(row)) {
      return fail(context, `transpose needs an array of arrays, found ${typeName(row)}`, row);
    }
    return Math.max(widest, row.length);
  }, 0);

  const out = [];
  for (let column = 0; column < width; column++) {
    // Padded rather than ragged, so every output row has the same length and
    // `transpose | transpose` round-trips a rectangular input.
    out.push(input.map((row) => (column < row.length ? row[column] : null)));
  }
  return out;
});

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The builtins this module provides, keyed by `name/arity`. */
export const arrayBuiltins = {
  'sort/0': sort,
  'sort_by/1': sortBy,
  'group_by/1': groupBy,
  'unique/0': unique,
  'unique_by/1': uniqueBy,
  'reverse/0': reverse,
  'min/0': min,
  'max/0': max,
  'min_by/1': extremeBy('min_by', -1),
  'max_by/1': extremeBy('max_by', 1),
  'add/0': add,
  'any/0': any0,
  'any/1': any1,
  'all/0': all0,
  'all/1': all1,
  'flatten/0': flatten0,
  'flatten/1': flatten1,
  'first/0': first0,
  'first/1': first1,
  'last/0': last0,
  'last/1': last1,
  'nth/1': nth1,
  'nth/2': nth2,
  'limit/2': limit,
  'until/2': until,
  'while/2': whileLoop,
  'repeat/1': repeat,
  'indices/1': indices,
  'index/1': index1,
  'rindex/1': rindex1,
  'combinations/0': combinations0,
  'transpose/0': transpose,
};

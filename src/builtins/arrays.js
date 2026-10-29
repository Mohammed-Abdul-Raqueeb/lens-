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


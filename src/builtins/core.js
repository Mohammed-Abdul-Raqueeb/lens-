/**
 * Builtins that are about a value's shape rather than its contents.
 *
 * `length`, `keys`, `has`, `type`, `select`, `map`, arithmetic and the
 * control-flow helpers.
 */

import { typeName } from '../errors.js';
import { evaluate } from '../eval.js';
import { truthy } from '../values.js';
import {
  fail, require as requireType, simple, streaming, valued, valuedStreaming,
} from './define.js';

/**
 * `length` is overloaded, and deliberately so.
 *
 * One question -- "how big is this?" -- has a sensible answer for every type,
 * and making the caller pick a per-type builtin would mean `if type ==
 * "array" then ... end` in front of half the queries that use it.
 *
 * null is 0 rather than an error, which is what lets `.items | length` work
 * against a document where `items` is sometimes missing.
 */
const length = simple((input, context) => {
  switch (typeName(input)) {
    case 'null': return 0;
    case 'boolean':
      return fail(context, 'a boolean has no length');
    // The absolute value, so `-5 | length` is 5. That is jq's choice and the
    // only one that makes `length` total over numbers.
    case 'number': return Math.abs(input);
    case 'string': return [...input].length;
    case 'array': return input.length;
    default: return Object.keys(input).length;
  }
});

/**
 * `utf8bytelength` — the length in bytes rather than characters.
 *
 * Separate from `length` because the two differ for any non-ASCII text, and
 * which one is wanted depends on whether the caller is measuring for a human
 * or for a protocol.
 */
const utf8bytelength = simple((input, context) => {
  requireType(input, 'string', 'utf8bytelength', context);
  return Buffer.byteLength(input, 'utf8');
});

const keys = simple((input, context) => {
  if (Array.isArray(input)) return input.map((_, i) => i);
  if (input !== null && typeof input === 'object') return Object.keys(input).sort();
  return fail(context, `keys needs an array or an object, but was given ${typeName(input)}`, input);
});

/**
 * `keys_unsorted` — the keys in insertion order.
 *
 * Worth having alongside `keys` because sorting is the common want but
 * round-tripping a document is not: `to_entries | from_entries` should not
 * silently reorder an object's fields.
 */
const keysUnsorted = simple((input, context) => {
  if (Array.isArray(input)) return input.map((_, i) => i);
  if (input !== null && typeof input === 'object') return Object.keys(input);
  return fail(
    context,
    `keys_unsorted needs an array or an object, but was given ${typeName(input)}`,
    input,
  );
});

const has = valued(1, (input, [key], context) => {
  if (Array.isArray(input)) {
    if (typeof key !== 'number') {
      return fail(context, `has on an array needs a number, not ${typeName(key)}`, key);
    }
    return key >= 0 && key < input.length;
  }
  if (input !== null && typeof input === 'object') {
    if (typeof key !== 'string') {
      return fail(context, `has on an object needs a string, not ${typeName(key)}`, key);
    }
    return Object.prototype.hasOwnProperty.call(input, key);
  }
  return fail(context, `has needs an array or an object, not ${typeName(input)}`, input);
});

/** `in` — `has` with the operands swapped, for `.[] | in($set)`. */
const inside = valued(1, (input, [container], context) => {
  if (Array.isArray(container)) {
    if (typeof input !== 'number') {
      return fail(context, `in on an array needs a number, not ${typeName(input)}`, input);
    }
    return input >= 0 && input < container.length;
  }
  if (container !== null && typeof container === 'object') {
    if (typeof input !== 'string') {
      return fail(context, `in on an object needs a string, not ${typeName(input)}`, input);
    }
    return Object.prototype.hasOwnProperty.call(container, input);
  }
  return fail(context, `in needs an array or an object, not ${typeName(container)}`, container);
});

const typeOf = simple((input) => typeName(input));

/** `empty` — yields nothing. The identity of `,` and the way to drop a value. */
const empty = streaming(function* body() {
  // Intentionally yields nothing.
});

/**
 * `error` — raises its input as an error.
 *
 * Takes the input rather than a string so `error` can be piped to:
 * `.message | error`. The one-argument form is sugar for `error(m)`.
 */
const error0 = streaming((input, context) => {
  fail(context, typeof input === 'string' ? input : JSON.stringify(input) ?? 'null', input);
  return [];
});

const error1 = valuedStreaming(1, (input, [message], context) => {
  fail(context, typeof message === 'string' ? message : JSON.stringify(message) ?? 'null', message);
  return [];
});

/** `select(f)` — keeps the input when `f` is truthy, drops it otherwise. */
const select = function* select(node, input, env) {
  for (const kept of evaluate(node.args[0], input, env)) {
    if (truthy(kept)) yield input;
  }
};

/** `map(f)` — `f` applied to each element, collected into an array. */
const map = function* map(node, input, env) {
  if (Array.isArray(input)) {
    const out = [];
    for (const element of input) {
      out.push(...evaluate(node.args[0], element, env));
    }
    yield out;
    return;
  }
  if (input !== null && typeof input === 'object') {
    // map over an object maps its values and yields an array, which is what
    // `[.[] | f]` means and what jq does.
    const out = [];
    for (const key of Object.keys(input)) {
      out.push(...evaluate(node.args[0], input[key], env));
    }
    yield out;
    return;
  }
  fail({ node, env }, `map needs an array or an object, not ${typeName(input)}`, input);
};

/**
 * `map_values(f)` — `f` applied to each value, keeping the container's shape.
 *
 * Distinct from `map` in two ways that both matter: an object stays an object,
 * and a value for which `f` yields nothing is removed rather than dropped
 * silently from a flattened array.
 */
const mapValues = function* mapValues(node, input, env) {
  if (Array.isArray(input)) {
    const out = [];
    for (const element of input) {
      for (const replacement of evaluate(node.args[0], element, env)) {
        out.push(replacement);
        break;
      }
    }
    yield out;
    return;
  }
  if (input !== null && typeof input === 'object') {
    const out = {};
    for (const key of Object.keys(input)) {
      for (const replacement of evaluate(node.args[0], input[key], env)) {
        out[key] = replacement;
        break;
      }
    }
    yield out;
    return;
  }
  fail({ node, env }, `map_values needs an array or an object, not ${typeName(input)}`, input);
};

/** `recurse(f)` — the input, then `f` applied repeatedly until it yields nothing. */
const recurse1 = function* recurse1(node, input, env) {
  yield input;
  for (const child of evaluate(node.args[0], input, env)) {
    yield* recurse1(node, child, env);
  }
};

/** `recurse(f; cond)` — as above, stopping where `cond` is false. */
const recurse2 = function* recurse2(node, input, env) {
  yield input;
  for (const child of evaluate(node.args[0], input, env)) {
    let keep = false;
    for (const test of evaluate(node.args[1], child, env)) {
      if (truthy(test)) keep = true;
      break;
    }
    if (keep) yield* recurse2(node, child, env);
  }
};

/** `range(n)` — 0 up to but not including n. */
const range1 = valuedStreaming(1, function* body(input, [to], context) {
  requireType(to, 'number', 'range', context);
  for (let i = 0; i < to; i++) yield i;
});

/** `range(from; to)` */
const range2 = valuedStreaming(2, function* body(input, [from, to], context) {
  requireType(from, 'number', 'range', context);
  requireType(to, 'number', 'range', context);
  for (let i = from; i < to; i++) yield i;
});

/** `range(from; to; step)` — counts down when the step is negative. */
const range3 = valuedStreaming(3, function* body(input, [from, to, step], context) {
  requireType(step, 'number', 'range', context);
  if (step === 0) {
    // An infinite generator is worse than an error here: the process would
    // hang with no output and no indication why.
    fail(context, 'range with a step of 0 would never finish');
  }
  if (step > 0) {
    for (let i = from; i < to; i += step) yield i;
  } else {
    for (let i = from; i > to; i += step) yield i;
  }
});

const numeric = (name, fn) => simple((input, context) => {
  requireType(input, 'number', name, context);
  return fn(input);
});

const floor = numeric('floor', Math.floor);
const ceil = numeric('ceil', Math.ceil);
const round = numeric('round', Math.round);
const fabs = numeric('fabs', Math.abs);
const sqrt = numeric('sqrt', (value) => {
  // NaN has no JSON form, so a negative input is an error here rather than a
  // value that fails at output time.
  if (value < 0) throw new RangeError('sqrt of a negative number');
  return Math.sqrt(value);
});
const log = numeric('log', Math.log);
const log2 = numeric('log2', Math.log2);
const log10 = numeric('log10', Math.log10);
const exp = numeric('exp', Math.exp);
const exp2 = numeric('exp2', (value) => 2 ** value);
const exp10 = numeric('exp10', (value) => 10 ** value);

const pow = valued(2, (input, [base, exponent], context) => {
  requireType(base, 'number', 'pow', context);
  requireType(exponent, 'number', 'pow', context);
  return base ** exponent;
});

const abs = simple((input, context) => {
  requireType(input, 'number', 'abs', context);
  return Math.abs(input);
});

const isnan = simple((input) => typeof input === 'number' && Number.isNaN(input));
const isinfinite = simple((input) => typeof input === 'number' && !Number.isFinite(input)
  && !Number.isNaN(input));
const isnormal = simple((input) => typeof input === 'number' && Number.isFinite(input)
  && input !== 0);
const isvalid = function* isvalid(node, input, env) {
  try {
    // Consumed fully: a generator that throws on its third value is not
    // valid, and stopping at the first would say it was.
    for (const _ of evaluate(node.args[0], input, env)) {
      void _;
    }
    yield true;
  } catch {
    yield false;
  }
};

const notBuiltin = simple((input) => !truthy(input));

/** `env` — the process environment, as an object. */
const env0 = simple(() => ({ ...process.env }));

/**
 * Holds the builtin table for the `builtins` function to read.
 *
 * A mutable box rather than a direct import, because the table lives in
 * eval.js and eval.js is what registers these -- reading it at module load
 * would be a cycle. {@link setBuiltinTable} fills it once registration is
 * done.
 */
const BUILTIN_TABLE = { value: new Map() };

/**
 * Hands the builtin table to the `builtins` function.
 *
 * @param {Map<string, Function>} table the registered builtins
 */
export function setBuiltinTable(table) {
  BUILTIN_TABLE.value = table;
}

/** `builtins` — the names of every builtin, for discovery from the CLI. */
const builtinsList = simple(() => [...BUILTIN_TABLE.value.keys()].sort());

/** The builtins this module provides, keyed by `name/arity`. */
export const coreBuiltins = {
  'length/0': length,
  'utf8bytelength/0': utf8bytelength,
  'keys/0': keys,
  'keys_unsorted/0': keysUnsorted,
  'has/1': has,
  'in/1': inside,
  'type/0': typeOf,
  'empty/0': empty,
  'error/0': error0,
  'error/1': error1,
  'select/1': select,
  'map/1': map,
  'map_values/1': mapValues,
  'recurse/1': recurse1,
  'recurse/2': recurse2,
  'range/1': range1,
  'range/2': range2,
  'range/3': range3,
  'floor/0': floor,
  'ceil/0': ceil,
  'round/0': round,
  'fabs/0': fabs,
  'abs/0': abs,
  'sqrt/0': sqrt,
  'pow/2': pow,
  'log/0': log,
  'log2/0': log2,
  'log10/0': log10,
  'exp/0': exp,
  'exp2/0': exp2,
  'exp10/0': exp10,
  'isnan/0': isnan,
  'isinfinite/0': isinfinite,
  'isnormal/0': isnormal,
  'isvalid/1': isvalid,
  'not/0': notBuiltin,
  'env/0': env0,
  'builtins/0': builtinsList,
};

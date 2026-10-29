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


/**
 * Equality, ordering and truthiness.
 *
 * JSON has no ordering of its own, so the language defines one. Every
 * comparison, `sort`, `group_by`, `unique`, `min` and `max` depends on it, and
 * it has to be total: a sort that throws on mixed types is no use against real
 * documents, which are full of nulls where a number was expected.
 */

import { typeName } from './errors.js';

/**
 * The rank of each type in the total order.
 *
 * null first so that missing values sort to the front, which is what makes
 * `sort_by(.optional)` useful rather than an error. The rest follows jq, and
 * matching jq matters more than any argument about the right order -- queries
 * get copied between the two.
 */
const TYPE_RANK = {
  null: 0,
  false: 1,
  true: 2,
  number: 3,
  string: 4,
  array: 5,
  object: 6,
};

/** The rank of a value, splitting booleans so false sorts before true. */
function rank(value) {
  const name = typeName(value);
  if (name === 'boolean') return value ? TYPE_RANK.true : TYPE_RANK.false;
  return TYPE_RANK[name];
}

/**
 * Deep equality.
 *
 * @param {unknown} left any value
 * @param {unknown} right any value
 * @returns {boolean} true when the two are the same value
 */
export function equals(left, right) {
  return compare(left, right) === 0;
}

/**
 * The total order over JSON values.
 *
 * @param {unknown} left any value
 * @param {unknown} right any value
 * @returns {number} negative, zero or positive
 */
export function compare(left, right) {
  const leftRank = rank(left);
  const rightRank = rank(right);
  if (leftRank !== rightRank) return leftRank < rightRank ? -1 : 1;

  switch (leftRank) {
    case TYPE_RANK.null:
    case TYPE_RANK.false:
    case TYPE_RANK.true:
      return 0;

    case TYPE_RANK.number:
      // NaN cannot arrive from parsed JSON but can from `0/0` guarded by a
      // `try`, and leaving it to the `<` below would make the comparison
      // non-transitive and corrupt any sort it touched.
      if (Number.isNaN(left)) return Number.isNaN(right) ? 0 : -1;
      if (Number.isNaN(right)) return 1;
      if (left === right) return 0;
      return left < right ? -1 : 1;

    case TYPE_RANK.string:
      // Compared by code unit, which is what JSON's own ordering implies and
      // what localeCompare would quietly break -- a sort whose result depends
      // on the machine's locale is not reproducible.
      if (left === right) return 0;
      return left < right ? -1 : 1;

    case TYPE_RANK.array: {
      const shared = Math.min(left.length, right.length);
      for (let i = 0; i < shared; i++) {
        const element = compare(left[i], right[i]);
        if (element !== 0) return element;
      }
      return left.length - right.length;
    }

    case TYPE_RANK.object: {
      // Objects compare by their sorted key lists first, then by the values
      // of those keys. Comparing values first would make the order depend on
      // insertion order, which JSON does not define.
      const leftKeys = Object.keys(left).sort();
      const rightKeys = Object.keys(right).sort();

      const byKeys = compare(leftKeys, rightKeys);
      if (byKeys !== 0) return byKeys;

      for (const key of leftKeys) {
        const value = compare(left[key], right[key]);
        if (value !== 0) return value;
      }
      return 0;
    }

    default:
      return 0;
  }
}

/**
 * Whether a value counts as true in a condition.
 *
 * Only `false` and `null` are false. Zero, the empty string and the empty
 * array are all true, which surprises people arriving from JavaScript and is
 * the right choice here: `if .count then` should fire for a count of zero,
 * because the question is whether the field is there.
 *
 * @param {unknown} value any value
 * @returns {boolean} its truthiness
 */
export function truthy(value) {
  return value !== false && value !== null && value !== undefined;
}

/**
 * Sorts a copy of an array by the total order.
 *
 * @param {unknown[]} values the array to sort
 * @returns {unknown[]} a new, sorted array
 */
export function sorted(values) {
  return [...values].sort(compare);
}

/**
 * A stable deep copy, used wherever a builtin must not mutate its input.
 *
 * `structuredClone` would do this and is slower for the shapes involved here,
 * and `JSON.parse(JSON.stringify(x))` silently turns `undefined` into a
 * dropped key. This handles only the types the language has.
 *
 * @param {unknown} value any value
 * @returns {unknown} a copy sharing no mutable structure with the original
 */
export function clone(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clone);

  const out = {};
  for (const key of Object.keys(value)) out[key] = clone(value[key]);
  return out;
}

/**
 * Whether two values are the same type.
 *
 * @param {unknown} left any value
 * @param {unknown} right any value
 * @returns {boolean} true when both have the same type name
 */
export function sameType(left, right) {
  return typeName(left) === typeName(right);
}

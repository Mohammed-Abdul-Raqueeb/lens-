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


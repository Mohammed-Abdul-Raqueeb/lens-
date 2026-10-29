/**
 * Shared test helpers.
 *
 * Mostly one thing: `assert.throws` checks that something threw and returns
 * nothing, so asserting on the message means catching by hand. Nearly every
 * error in this project carries a message written for a person, and a test
 * that only checks the type would let those messages rot.
 */

import assert from 'node:assert/strict';

import { query } from '../src/index.js';

/**
 * Asserts that `fn` throws an instance of `type`, and returns the error.
 *
 * @param {Function} fn the body to run
 * @param {Function} type the constructor expected
 * @returns {Error} the thrown error, for further assertions
 */
export function throwsWith(fn, type) {
  let thrown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown !== undefined, `expected ${type.name} but nothing was thrown`);
  assert.ok(
    thrown instanceof type,
    `expected ${type.name} but got ${thrown.constructor.name}: ${thrown.message}`,
  );
  return thrown;
}

/**
 * Runs a query and asserts its full output.
 *
 * @param {string} source the query
 * @param {unknown} input the document
 * @param {unknown[]} expected every output, in order
 */
export function outputs(source, input, expected) {
  assert.deepEqual(query(source, input), expected, `${source} against ${JSON.stringify(input)}`);
}

/**
 * Runs a query and asserts it produces exactly one given output.
 *
 * @param {string} source the query
 * @param {unknown} input the document
 * @param {unknown} expected the single output
 */
export function output(source, input, expected) {
  outputs(source, input, [expected]);
}

/**
 * Runs a query and asserts it fails with a message matching `pattern`.
 *
 * @param {string} source the query
 * @param {unknown} input the document
 * @param {RegExp} [pattern] what the message must match
 * @returns {Error} the thrown error
 */
export function fails(source, input, pattern) {
  const error = throwsWith(() => query(source, input), Error);
  if (pattern) {
    assert.match(error.message, pattern, `${source} should fail with ${pattern}`);
  }
  return error;
}

/**
 * Compares two trees ignoring their `offset` fields.
 *
 * Offsets are part of a node and are checked directly where they matter, but
 * they make two trees from different source text incomparable even when the
 * structure is identical.
 *
 * @param {object} actual the tree produced
 * @param {object} expected the tree wanted
 */
export function sameShape(actual, expected) {
  assert.deepEqual(stripOffsets(actual), stripOffsets(expected));
}

function stripOffsets(node) {
  if (Array.isArray(node)) return node.map(stripOffsets);
  if (node === null || typeof node !== 'object') return node;

  const out = {};
  for (const key of Object.keys(node)) {
    if (key === 'offset') continue;
    out[key] = stripOffsets(node[key]);
  }
  return out;
}

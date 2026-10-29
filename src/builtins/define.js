/**
 * Helpers for declaring builtins.
 *
 * A builtin is a generator taking `(node, input, env)`, which is the general
 * shape and verbose for the many that are just a function of their input.
 * These wrappers cover the three common cases so each builtin's own file says
 * what it computes and nothing about plumbing.
 */

import { evaluate, failure } from '../eval.js';
import { typeName } from '../errors.js';

/**
 * A builtin that maps its input to exactly one output.
 *
 * @param {(input: unknown, context: {node: object, env: object}) => unknown} fn the body
 * @returns {Function} a builtin
 */
export function simple(fn) {
  return function* builtin(node, input, env) {
    yield fn(input, { node, env });
  };
}

/**
 * A builtin that yields any number of outputs for its input.
 *
 * @param {(input: unknown, context: {node: object, env: object}) => Iterable<unknown>} fn the body
 * @returns {Function} a builtin
 */
export function streaming(fn) {
  return function* builtin(node, input, env) {
    yield* fn(input, { node, env });
  };
}

/**
 * A builtin whose arguments are values rather than filters.
 *
 * Each argument is evaluated against the builtin's own input, and the body is
 * called once per combination. That cross product is the language's rule for
 * multi-output arguments -- `ltrimstr("a","b")` really does run twice -- and
 * doing it here means no individual builtin has to think about it.
 *
 * @param {number} arity how many arguments
 * @param {(input: unknown, args: unknown[], context: object) => unknown} fn the body
 * @returns {Function} a builtin
 */
export function valued(arity, fn) {
  return function* builtin(node, input, env) {
    const combinations = crossProduct(node.args, input, env, arity);
    for (const args of combinations) {
      yield fn(input, args, { node, env });
    }
  };
}

/**
 * A builtin with value arguments that yields any number of outputs.
 *
 * @param {number} arity how many arguments
 * @param {(input: unknown, args: unknown[], context: object) => Iterable<unknown>} fn the body
 * @returns {Function} a builtin
 */
export function valuedStreaming(arity, fn) {
  return function* builtin(node, input, env) {
    for (const args of crossProduct(node.args, input, env, arity)) {
      yield* fn(input, args, { node, env });
    }
  };
}


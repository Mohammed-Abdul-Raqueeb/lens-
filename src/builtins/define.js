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

/** Every combination of the arguments' outputs, in argument order. */
function crossProduct(argNodes, input, env, arity) {
  if (arity === 0) return [[]];

  let combinations = [[]];
  for (let i = 0; i < arity; i++) {
    const values = [...evaluate(argNodes[i], input, env)];
    const next = [];
    for (const partial of combinations) {
      for (const value of values) next.push([...partial, value]);
    }
    combinations = next;
  }
  return combinations;
}

/**
 * Checks an input's type, raising the language's own error when it is wrong.
 *
 * @param {unknown} value the value to check
 * @param {string|string[]} expected the type name or names allowed
 * @param {string} builtinName the builtin, for the message
 * @param {object} context the node and env, for the position
 * @returns {unknown} the value, when it is acceptable
 */
export function require(value, expected, builtinName, context) {
  const allowed = Array.isArray(expected) ? expected : [expected];
  const actual = typeName(value);

  if (!allowed.includes(actual)) {
    throw failure(
      context.node,
      context.env,
      `${builtinName} needs ${joinWithOr(allowed)}, but was given ${actual}`,
      value,
    );
  }
  return value;
}

/**
 * Raises the language's own error from inside a builtin.
 *
 * @param {object} context the node and env
 * @param {string} message what went wrong
 * @param {unknown} [value] the offending value
 * @returns {never} always throws
 */
export function fail(context, message, value) {
  throw failure(context.node, context.env, message, value);
}

function joinWithOr(names) {
  const withArticle = names.map(article);
  if (withArticle.length === 1) return withArticle[0];
  return `${withArticle.slice(0, -1).join(', ')} or ${withArticle[withArticle.length - 1]}`;
}

/**
 * Prefixes a type name with the right indefinite article.
 *
 * Only `array` and `object` of the six type names begin with a vowel, so this
 * is a lookup rather than a rule. It matters because these messages are read
 * by people, and "sort needs a array" reads as a bug in the tool.
 */
function article(name) {
  return /^[aeiou]/.test(name) ? `an ${name}` : `a ${name}`;
}

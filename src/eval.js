/**
 * Runs a parsed program.
 *
 * Every expression is a generator: it takes one input and yields zero or more
 * outputs. That is the whole execution model, and it is why `.users[]` and
 * `empty` and `1,2,3` need no special handling anywhere -- they are just
 * expressions that yield a different number of times.
 *
 * Generators rather than arrays because the alternative does not stream.
 * `first(.[])` over a million-element array should touch one element, and with
 * arrays it would build a million-element intermediate first. The cost is that
 * every operator has to be written as a nested loop over its operands, which
 * reads less neatly than a map would.
 */

import { Node } from './ast.js';
import { EvalError, describe, typeName } from './errors.js';
import { getPath, requirePath, setPath, allPaths, deletePaths } from './paths.js';
import { compare, equals, truthy } from './values.js';

/** The lexical environment: variables, functions, and the query source. */
export class Env {
  /**
   * @param {object} [options]
   * @param {Map<string, unknown>} [options.vars] variables in scope
   * @param {Map<string, object>} [options.funcs] functions in scope
   * @param {string} [options.source] the query text, for error messages
   */
  constructor({ vars = new Map(), funcs = new Map(), source = '' } = {}) {
    this.vars = vars;
    this.funcs = funcs;
    this.source = source;
  }

  /**
   * A child environment with one more variable.
   *
   * Copied rather than chained because lookups are far more common than
   * bindings here, and a chain would make every variable reference walk a
   * list whose length is the nesting depth.
   *
   * @param {string} name the variable name, without the $
   * @param {unknown} value its value
   * @returns {Env} a new environment
   */
  withVar(name, value) {
    const vars = new Map(this.vars);
    vars.set(name, value);
    return new Env({ vars, funcs: this.funcs, source: this.source });
  }

  /**
   * A child environment with one more function.
   *
   * @param {string} name the function name
   * @param {object} def the definition: params, body and its own environment
   * @returns {Env} a new environment
   */
  withFunc(name, def) {
    const funcs = new Map(this.funcs);
    funcs.set(`${name}/${def.params.length}`, def);
    return new Env({ vars: this.vars, funcs, source: this.source });
  }

  /**
   * Looks up a function by name and arity.
   *
   * @param {string} name the function name
   * @param {number} arity how many arguments were given
   * @returns {object|undefined} the definition, if one is in scope
   */
  lookupFunc(name, arity) {
    return this.funcs.get(`${name}/${arity}`);
  }
}

/**
 * Evaluates a program against one input.
 *
 * @param {object} node the root AST node
 * @param {unknown} input the document
 * @param {Env} env the environment
 * @yields {unknown} each output
 */
export function* evaluate(node, input, env) {
  switch (node.type) {
    case Node.IDENTITY:
      yield input;
      return;

    case Node.RECURSE:
      yield* recurseInto(input);
      return;

    case Node.LITERAL:
      yield node.value;
      return;

    case Node.FIELD:
      yield* evalField(node, input, env);
      return;

    case Node.INDEX:
      yield* evalIndex(node, input, env);
      return;

    case Node.SLICE:
      yield* evalSlice(node, input, env);
      return;

    case Node.ITERATE:
      yield* evalIterate(node, input, env);
      return;

    case Node.PIPE:
      // The nested loop is the whole of the pipe: each output of the left
      // becomes an input to the right, and the outputs concatenate.
      for (const value of evaluate(node.left, input, env)) {
        yield* evaluate(node.right, value, env);
      }
      return;

    case Node.COMMA:
      yield* evaluate(node.left, input, env);
      yield* evaluate(node.right, input, env);
      return;

    case Node.ARRAY: {
      if (node.body === null) {
        yield [];
        return;
      }
      yield [...evaluate(node.body, input, env)];
      return;
    }

    case Node.OBJECT:
      yield* evalObject(node, input, env);
      return;

    case Node.NEGATE:
      for (const value of evaluate(node.body, input, env)) {
        if (typeof value !== 'number') {
          throw failure(node, env, `cannot negate ${typeName(value)}`, value);
        }
        yield -value;
      }
      return;

    case Node.BINARY:
      yield* evalBinary(node, input, env);
      return;

    case Node.AND:
      // Short-circuits per left-hand output: a false on the left means the
      // right is never evaluated for that output, which matters when the
      // right would error.
      for (const left of evaluate(node.left, input, env)) {
        if (!truthy(left)) {
          yield false;
          continue;
        }
        for (const right of evaluate(node.right, input, env)) {
          yield truthy(right);
        }
      }
      return;

    case Node.OR:
      for (const left of evaluate(node.left, input, env)) {
        if (truthy(left)) {
          yield true;
          continue;
        }
        for (const right of evaluate(node.right, input, env)) {
          yield truthy(right);
        }
      }
      return;

    case Node.NOT:
      yield !truthy(input);
      return;

    case Node.ALTERNATIVE:
      yield* evalAlternative(node, input, env);
      return;

    case Node.OPTIONAL:
      yield* evalOptional(node, input, env);
      return;

    case Node.IF:
      for (const cond of evaluate(node.cond, input, env)) {
        if (truthy(cond)) {
          yield* evaluate(node.then, input, env);
        } else if (node.else) {
          yield* evaluate(node.else, input, env);
        } else {
          // An `if` with no `else` passes the input through unchanged, so
          // `if .x then .y end` is a conditional transform rather than a
          // filter that drops everything failing the test.
          yield input;
        }
      }
      return;

    case Node.TRY:
      yield* evalTry(node, input, env);
      return;

    case Node.REDUCE:
      yield* evalReduce(node, input, env);
      return;

    case Node.FOREACH:
      yield* evalForeach(node, input, env);
      return;

    case Node.BIND:
      for (const value of evaluate(node.source, input, env)) {
        yield* evaluate(node.body, input, env.withVar(node.pattern.name, value));
      }
      return;

    case Node.VARIABLE: {
      if (!env.vars.has(node.name)) {
        throw failure(node, env, `$${node.name} is not defined`);
      }
      yield env.vars.get(node.name);
      return;
    }

    case Node.FUNCDEF: {
      // The definition's own environment includes itself, so a function can
      // recurse. Built by mutating after construction because the
      // environment and the definition each need the other.
      const def = { params: node.params, body: node.body, env: null };
      const scoped = env.withFunc(node.name, def);
      def.env = scoped;
      yield* evaluate(node.rest, input, scoped);
      return;
    }

    case Node.CALL:
      yield* evalCall(node, input, env);
      return;

    case Node.FORMAT:
      yield* evalFormat(node, input, env);
      return;

    case Node.INTERPOLATE:
      yield* evalInterpolate(node, input, env);
      return;

    case Node.ASSIGN:
      yield* evalAssign(node, input, env);
      return;

    case Node.UPDATE:
      yield* evalUpdate(node, input, env);
      return;

    default:
      throw failure(node, env, `cannot evaluate a ${node.type} node`);
  }
}

/** `..` — the value, then everything inside it, depth first. */
function* recurseInto(value) {
  yield value;
  if (Array.isArray(value)) {
    for (const element of value) yield* recurseInto(element);
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const key of Object.keys(value)) yield* recurseInto(value[key]);
  }
}

function* evalField(node, input, env) {
  if (input === null || input === undefined) {
    // A field of null is null, not an error. Without that, every query
    // against a document with an optional object would need a guard.
    yield null;
    return;
  }
  if (Array.isArray(input) || typeof input !== 'object') {
    if (node.optional) return;
    throw failure(
      node,
      env,
      `cannot read the field .${node.name} of ${typeName(input)}: ${describe(input)}`,
      input,
    );
  }
  yield Object.prototype.hasOwnProperty.call(input, node.name) ? input[node.name] : null;
}

function* evalIndex(node, input, env) {
  for (const key of evaluate(node.index, input, env)) {
    if (input === null || input === undefined) {
      yield null;
      continue;
    }

    if (typeof key === 'string') {
      if (Array.isArray(input) || typeof input !== 'object') {
        if (node.optional) continue;
        throw failure(node, env, `cannot index ${typeName(input)} with a string`, input);
      }
      yield Object.prototype.hasOwnProperty.call(input, key) ? input[key] : null;
      continue;
    }

    if (typeof key === 'number') {
      if (!Array.isArray(input)) {
        if (node.optional) continue;
        throw failure(node, env, `cannot index ${typeName(input)} with a number`, input);
      }
      // Negative indices count from the end, which is the single most useful
      // thing `.[-1]` does and why it is not an error.
      const at = key < 0 ? input.length + key : key;
      yield at >= 0 && at < input.length ? input[at] : null;
      continue;
    }

    if (Array.isArray(key)) {
      // `.[["a"]]` on an array yields the indices where the subsequence
      // occurs, matching jq's `indices`.
      if (!Array.isArray(input)) {
        if (node.optional) continue;
        throw failure(node, env, `cannot search ${typeName(input)} for a subsequence`, input);
      }
      yield subsequenceIndices(input, key);
      continue;
    }

    if (node.optional) continue;
    throw failure(node, env, `cannot index with ${typeName(key)}`, key);
  }
}

function* evalSlice(node, input, env) {
  const froms = node.from ? [...evaluate(node.from, input, env)] : [null];
  const tos = node.to ? [...evaluate(node.to, input, env)] : [null];

  for (const from of froms) {
    for (const to of tos) {
      if (input === null || input === undefined) {
        yield null;
        continue;
      }
      if (!Array.isArray(input) && typeof input !== 'string') {
        if (node.optional) continue;
        throw failure(node, env, `cannot slice ${typeName(input)}`, input);
      }
      for (const bound of [from, to]) {
        if (bound !== null && typeof bound !== 'number') {
          if (node.optional) continue;
          throw failure(
            node,
            env,
            `a slice bound must be a number, found ${typeName(bound)}`,
            bound,
          );
        }
      }

      const length = input.length;
      const start = clampIndex(from === null ? 0 : Math.floor(from), length);
      const end = clampIndex(to === null ? length : Math.ceil(to), length);
      yield input.slice(start, Math.max(start, end));
    }
  }
}


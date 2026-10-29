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

function clampIndex(index, length) {
  const at = index < 0 ? length + index : index;
  return Math.max(0, Math.min(at, length));
}

function* evalIterate(node, input, env) {
  if (Array.isArray(input)) {
    yield* input;
    return;
  }
  if (input !== null && typeof input === 'object') {
    for (const key of Object.keys(input)) yield input[key];
    return;
  }
  if (node.optional) return;
  throw failure(node, env, `cannot iterate over ${typeName(input)}: ${describe(input)}`, input);
}

function* evalObject(node, input, env) {
  // Entries are expanded as a cross product: `{a: (1,2)}` yields two objects,
  // not one object with two values. Building that iteratively rather than
  // recursively keeps the common single-output case allocation-free.
  let objects = [{}];

  for (const entry of node.entries) {
    const next = [];
    for (const partial of objects) {
      for (const key of evaluate(entry.key, input, env)) {
        if (typeof key !== 'string') {
          throw failure(
            node,
            env,
            `an object key must be a string, found ${typeName(key)}: ${describe(key)}`,
            key,
          );
        }
        for (const value of evaluate(entry.value, input, env)) {
          next.push({ ...partial, [key]: value });
        }
      }
    }
    objects = next;
  }

  yield* objects;
}

function* evalBinary(node, input, env) {
  for (const left of evaluate(node.left, input, env)) {
    for (const right of evaluate(node.right, input, env)) {
      yield applyBinary(node, left, right, env);
    }
  }
}

function applyBinary(node, left, right, env) {
  switch (node.op) {
    case '==': return equals(left, right);
    case '!=': return !equals(left, right);
    case '<': return compare(left, right) < 0;
    case '<=': return compare(left, right) <= 0;
    case '>': return compare(left, right) > 0;
    case '>=': return compare(left, right) >= 0;
    case '+': return add(node, left, right, env);
    case '-': return subtract(node, left, right, env);
    case '*': return multiply(node, left, right, env);
    case '/': return divide(node, left, right, env);
    case '%': return modulo(node, left, right, env);
    default:
      throw failure(node, env, `unknown operator '${node.op}'`);
  }
}

/**
 * `+` is overloaded by type, which is most of what makes the language terse.
 *
 * null is the identity on both sides, so `reduce .[] as $x (null; . + $x)`
 * works without seeding the accumulator with the right empty value.
 */
function add(node, left, right, env) {
  if (left === null) return right;
  if (right === null) return left;

  if (typeof left === 'number' && typeof right === 'number') return left + right;
  if (typeof left === 'string' && typeof right === 'string') return left + right;
  if (Array.isArray(left) && Array.isArray(right)) return [...left, ...right];

  if (isPlainObject(left) && isPlainObject(right)) {
    // Right wins on a conflict, shallowly. A deep merge is `*`, and having
    // both is the point: one replaces a subtree, the other merges into it.
    return { ...left, ...right };
  }

  throw failure(
    node,
    env,
    `cannot add ${typeName(left)} and ${typeName(right)}`
      + ` (${describe(left)} + ${describe(right)})`,
    left,
  );
}

function subtract(node, left, right, env) {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  if (Array.isArray(left) && Array.isArray(right)) {
    return left.filter((element) => !right.some((unwanted) => equals(element, unwanted)));
  }
  throw failure(
    node,
    env,
    `cannot subtract ${typeName(right)} from ${typeName(left)}`,
    left,
  );
}

function multiply(node, left, right, env) {
  if (typeof left === 'number' && typeof right === 'number') return left * right;

  if (typeof left === 'string' && typeof right === 'number') {
    // A repeat count below one yields null rather than an empty string, which
    // is jq's behaviour and lets `.sep * .n` drop the separator entirely.
    return right < 1 ? null : left.repeat(Math.floor(right));
  }
  if (typeof left === 'number' && typeof right === 'string') {
    return left < 1 ? null : right.repeat(Math.floor(left));
  }

  if (isPlainObject(left) && isPlainObject(right)) return deepMerge(left, right);

  throw failure(
    node,
    env,
    `cannot multiply ${typeName(left)} and ${typeName(right)}`,
    left,
  );
}

function deepMerge(left, right) {
  const out = { ...left };
  for (const key of Object.keys(right)) {
    const a = out[key];
    const b = right[key];
    out[key] = isPlainObject(a) && isPlainObject(b) ? deepMerge(a, b) : b;
  }
  return out;
}

function divide(node, left, right, env) {
  if (typeof left === 'number' && typeof right === 'number') {
    if (right === 0) {
      // An error rather than Infinity, because Infinity has no JSON
      // representation and would fail at output time instead -- a long way
      // from the division that caused it.
      throw failure(node, env, `cannot divide ${describe(left)} by zero`, left);
    }
    return left / right;
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return left.split(right);
  }
  throw failure(node, env, `cannot divide ${typeName(left)} by ${typeName(right)}`, left);
}

function modulo(node, left, right, env) {
  if (typeof left !== 'number' || typeof right !== 'number') {
    throw failure(node, env, `cannot take ${typeName(left)} modulo ${typeName(right)}`, left);
  }
  const divisor = Math.trunc(right);
  if (divisor === 0) {
    throw failure(node, env, `cannot take ${describe(left)} modulo zero`, left);
  }
  // Truncated towards zero on both sides, so the result has the sign of the
  // left operand. That matches C and jq; JavaScript's % already does this,
  // but the truncation of the operands does not happen on its own.
  return Math.trunc(left) % divisor;
}

function* evalAlternative(node, input, env) {
  let produced = false;

  try {
    for (const value of evaluate(node.left, input, env)) {
      if (truthy(value)) {
        produced = true;
        yield value;
      }
    }
  } catch (error) {
    if (!(error instanceof EvalError)) throw error;
    // An error on the left is the same as producing nothing, which is what
    // makes `.a.b // "default"` work when `.a` is a string rather than an
    // object.
  }

  if (!produced) {
    yield* evaluate(node.right, input, env);
  }
}

function* evalOptional(node, input, env) {
  // Written as an explicit pull loop rather than a for..of inside a try, so
  // that values already produced are still yielded when a later one throws.
  // `(.[] | .a)?` over a mixed array should emit the ones that worked.
  const iterator = evaluate(node.body, input, env)[Symbol.iterator]();
  while (true) {
    let step;
    try {
      step = iterator.next();
    } catch (error) {
      if (error instanceof EvalError) return;
      throw error;
    }
    if (step.done) return;
    yield step.value;
  }
}

function* evalTry(node, input, env) {
  const iterator = evaluate(node.body, input, env)[Symbol.iterator]();
  while (true) {
    let step;
    try {
      step = iterator.next();
    } catch (error) {
      if (!(error instanceof EvalError)) throw error;
      if (node.handler) {
        // The handler receives the error's message as its input, which is how
        // `try .a catch "failed: \(.)"` reads.
        yield* evaluate(node.handler, error.message, env);
      }
      return;
    }
    if (step.done) return;
    yield step.value;
  }
}

function* evalReduce(node, input, env) {
  for (const seed of evaluate(node.init, input, env)) {
    let accumulator = seed;

    for (const item of evaluate(node.source, input, env)) {
      const scoped = env.withVar(node.pattern.name, item);
      // The last output of the update wins. An update yielding nothing
      // collapses the accumulator to null, which is jq's behaviour and a
      // common source of surprise -- `reduce .[] as $x (0; empty)` is null,
      // not 0.
      let next = null;
      for (const candidate of evaluate(node.update, accumulator, scoped)) {
        next = candidate;
      }
      accumulator = next;
    }

    yield accumulator;
  }
}

function* evalForeach(node, input, env) {
  for (const seed of evaluate(node.init, input, env)) {
    let accumulator = seed;

    for (const item of evaluate(node.source, input, env)) {
      const scoped = env.withVar(node.pattern.name, item);
      for (const candidate of evaluate(node.update, accumulator, scoped)) {
        accumulator = candidate;
        if (node.extract) {
          yield* evaluate(node.extract, accumulator, scoped);
        } else {
          yield accumulator;
        }
      }
    }
  }
}


/**
 * The public API.
 *
 * Three functions cover every use: compile a query once and run it many
 * times, or run it once and get the results. The distinction matters because
 * parsing is the expensive part for a short query over many documents --
 * a log pipeline compiles once and runs per line.
 */

import { Env, collectPaths, evaluate, registerBuiltins, registerFormats } from './eval.js';
import { parse } from './parser.js';
import { coreBuiltins, setBuiltinTable } from './builtins/core.js';
import { arrayBuiltins } from './builtins/arrays.js';
import { stringBuiltins, formats } from './builtins/strings.js';
import { objectBuiltins, setPathCollector } from './builtins/objects.js';
import { BUILTINS } from './eval.js';

// Registration happens once, at module load, in dependency order. The two
// setters below close the cycles that would otherwise exist: eval.js owns the
// builtin table and `collectPaths`, and two builtin modules need to read them.
registerBuiltins({
  ...coreBuiltins,
  ...arrayBuiltins,
  ...stringBuiltins,
  ...objectBuiltins,
});
registerFormats(formats);
setBuiltinTable(BUILTINS);
setPathCollector(collectPaths);

export { LensError, LexError, ParseError, EvalError, typeName } from './errors.js';
export { compare, equals, truthy } from './values.js';
export { parse } from './parser.js';
export { tokenize } from './lexer.js';

/** A parsed query, ready to run against any number of documents. */
export class Query {
  /**
   * @param {string} source the query text
   * @param {object} [options]
   * @param {Record<string, unknown>} [options.vars] variables to predefine
   */
  constructor(source, { vars = {} } = {}) {
    this.source = source;
    this.ast = parse(source);
    this.env = new Env({
      vars: new Map(Object.entries(vars)),
      source,
    });
  }

  /**
   * Runs the query, yielding each output.
   *
   * A generator rather than an array, so a query that produces a million
   * outputs can be streamed to a file without holding them all.
   *
   * @param {unknown} input the document
   * @yields {unknown} each output
   */
  * run(input) {
    yield* evaluate(this.ast, input, this.env);
  }

  /**
   * Runs the query and collects every output.
   *
   * @param {unknown} input the document
   * @returns {unknown[]} the outputs
   */
  all(input) {
    return [...this.run(input)];
  }

  /**
   * Runs the query and returns its first output, or undefined.
   *
   * Stops the generator after the first, so `first` over a huge input costs
   * what reaching the first output costs.
   *
   * @param {unknown} input the document
   * @returns {unknown} the first output, or undefined when there is none
   */
  first(input) {
    for (const value of this.run(input)) return value;
    return undefined;
  }

  /**
   * A copy of this query with extra variables bound.
   *
   * @param {Record<string, unknown>} vars the variables to add
   * @returns {Query} a new query sharing this one's parsed tree
   */
  withVars(vars) {
    const copy = Object.create(Query.prototype);
    copy.source = this.source;
    copy.ast = this.ast;
    copy.env = Object.entries(vars).reduce(
      (env, [name, value]) => env.withVar(name, value),
      this.env,
    );
    return copy;
  }
}

/**
 * Compiles a query.
 *
 * @param {string} source the query text
 * @param {object} [options] see {@link Query}
 * @returns {Query} the compiled query
 */
export function compile(source, options) {
  return new Query(source, options);
}

/**
 * Compiles and runs a query, returning every output.
 *
 * @param {string} source the query text
 * @param {unknown} input the document
 * @param {object} [options] see {@link Query}
 * @returns {unknown[]} the outputs
 */
export function query(source, input, options) {
  return new Query(source, options).all(input);
}

/**
 * Compiles and runs a query, returning its first output.
 *
 * @param {string} source the query text
 * @param {unknown} input the document
 * @param {object} [options] see {@link Query}
 * @returns {unknown} the first output, or undefined
 */
export function queryFirst(source, input, options) {
  return new Query(source, options).first(input);
}

/**
 * The names and arities of every builtin.
 *
 * @returns {string[]} entries like `map/1`, sorted
 */
export function builtinNames() {
  return [...BUILTINS.keys()].sort();
}

export { format, formatStream } from './format.js';
export const VERSION = '0.1.0';

/**
 * Error types, each carrying enough to point at what went wrong.
 *
 * A query language is used from a shell prompt, where the whole program is one
 * line and the only feedback is what gets printed. "syntax error" sends the
 * user back to count brackets; an offset and a caret does not.
 */

/** Base for every error this library raises deliberately. */
export class LensError extends Error {
  /**
   * @param {string} message what went wrong
   * @param {object} [options]
   * @param {number} [options.offset] character offset into the source
   * @param {string} [options.source] the query text, for rendering a caret
   */
  constructor(message, { offset = -1, source = '' } = {}) {
    super(message);
    this.name = 'LensError';
    this.offset = offset;
    this.source = source;
  }

  /**
   * The message with the offending character marked, when an offset is known.
   *
   * Two lines rather than one: the query, then a caret beneath. Embedding the
   * position in prose ("at character 23") makes the reader count, which is
   * exactly the work the caret saves.
   *
   * @returns {string} the rendered message
   */
  format() {
    if (this.offset < 0 || !this.source) {
      return `${this.name}: ${this.message}`;
    }

    // Clamped so an offset past the end -- which "unexpected end of input"
    // naturally produces -- still renders rather than throwing in the
    // error formatter, which would hide the real failure.
    const at = Math.min(this.offset, this.source.length);
    return [
      `${this.name}: ${this.message}`,
      `  ${this.source}`,
      `  ${' '.repeat(at)}^`,
    ].join('\n');
  }
}

/** The query could not be tokenised. */
export class LexError extends LensError {
  constructor(message, options) {
    super(message, options);
    this.name = 'LexError';
  }
}

/** The tokens did not form a valid program. */
export class ParseError extends LensError {
  constructor(message, options) {
    super(message, options);
    this.name = 'ParseError';
  }
}

/**
 * The program was valid but could not run against this input.
 *
 * Kept distinct from ParseError because the two mean different things to the
 * user: a parse error is a mistake in the query, a runtime error is usually a
 * mismatch between the query and the shape of the data. The first is fixed by
 * editing, the second often by looking at the input.
 */
export class EvalError extends LensError {
  /**
   * @param {string} message what went wrong
   * @param {object} [options]
   * @param {number} [options.offset] offset of the expression that failed
   * @param {string} [options.source] the query text
   * @param {unknown} [options.value] the value that caused it
   */
  constructor(message, options = {}) {
    super(message, options);
    this.name = 'EvalError';
    this.value = options.value;
  }
}

/**
 * Describes a value's type the way the language's error messages do.
 *
 * `typeof` is no use here: it calls null an object and arrays objects, and
 * both distinctions matter in every message that uses this.
 *
 * @param {unknown} value any value
 * @returns {string} one of null, boolean, number, string, array, object
 */
export function typeName(value) {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  const kind = typeof value;
  if (kind === 'boolean' || kind === 'number' || kind === 'string') return kind;
  return 'object';
}

/**
 * Renders a value compactly for an error message.
 *
 * Truncated, because the value in a type error is often the whole document and
 * a hundred kilobytes of JSON in a one-line error is worse than no value at
 * all.
 *
 * @param {unknown} value any value
 * @param {number} [limit] how many characters to keep
 * @returns {string} the rendered value
 */
export function describe(value, limit = 40) {
  let text;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    // A circular structure cannot reach here from parsed JSON, but a builtin
    // could in principle construct one, and an error formatter that throws
    // replaces a useful message with a useless one.
    text = String(value);
  }
  return text.length <= limit ? text : `${text.slice(0, limit)}...`;
}

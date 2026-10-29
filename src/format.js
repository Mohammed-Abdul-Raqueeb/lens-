/**
 * Rendering values back to text.
 *
 * `JSON.stringify` would do most of this, and does not do two things that
 * matter at a terminal: it has no colour, and its indentation puts a bare `[`
 * on a line of its own for an array of scalars, which wastes most of the
 * screen on a document that is mostly short arrays.
 */

/** ANSI colours, by the type they render. */
const COLOURS = {
  null: '\u001b[1;30m',
  boolean: '\u001b[0;39m',
  number: '\u001b[0;39m',
  string: '\u001b[0;32m',
  key: '\u001b[34;1m',
  punctuation: '\u001b[1;39m',
  reset: '\u001b[0m',
};

/**
 * Renders a value as JSON text.
 *
 * @param {unknown} value the value to render
 * @param {object} [options]
 * @param {boolean} [options.pretty] indent and break lines
 * @param {number} [options.indent] spaces per level when pretty
 * @param {boolean} [options.colour] wrap tokens in ANSI colours
 * @param {boolean} [options.sortKeys] emit object keys in sorted order
 * @param {boolean} [options.tab] indent with tabs instead of spaces
 * @returns {string} the rendered text
 */
export function format(value, options = {}) {
  const settings = {
    pretty: options.pretty ?? false,
    indent: options.indent ?? 2,
    colour: options.colour ?? false,
    sortKeys: options.sortKeys ?? false,
    tab: options.tab ?? false,
  };

  if (!settings.pretty) {
    return renderCompact(value, settings);
  }
  return renderPretty(value, settings, 0);
}

/**
 * Renders a sequence of values, one per line.
 *
 * @param {Iterable<unknown>} values the values
 * @param {object} [options] see {@link format}
 * @yields {string} each rendered line
 */
export function* formatStream(values, options = {}) {
  for (const value of values) {
    yield format(value, options);
  }
}

function paint(text, colour, settings) {
  if (!settings.colour) return text;
  return `${colour}${text}${COLOURS.reset}`;
}


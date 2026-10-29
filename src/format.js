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

function renderCompact(value, settings) {
  if (value === null || value === undefined) {
    return paint('null', COLOURS.null, settings);
  }

  switch (typeof value) {
    case 'boolean':
      return paint(String(value), COLOURS.boolean, settings);
    case 'number':
      return paint(renderNumber(value), COLOURS.number, settings);
    case 'string':
      return paint(JSON.stringify(value), COLOURS.string, settings);
    default:
      break;
  }

  if (Array.isArray(value)) {
    const open = paint('[', COLOURS.punctuation, settings);
    const close = paint(']', COLOURS.punctuation, settings);
    const comma = paint(',', COLOURS.punctuation, settings);
    return open + value.map((element) => renderCompact(element, settings)).join(comma) + close;
  }

  const keys = settings.sortKeys ? Object.keys(value).sort() : Object.keys(value);
  const open = paint('{', COLOURS.punctuation, settings);
  const close = paint('}', COLOURS.punctuation, settings);
  const comma = paint(',', COLOURS.punctuation, settings);
  const colon = paint(':', COLOURS.punctuation, settings);

  const parts = keys.map((key) => {
    const renderedKey = paint(JSON.stringify(key), COLOURS.key, settings);
    return renderedKey + colon + renderCompact(value[key], settings);
  });
  return open + parts.join(comma) + close;
}

function renderPretty(value, settings, depth) {
  if (value === null || value === undefined || typeof value !== 'object') {
    return renderCompact(value, settings);
  }

  const unit = settings.tab ? '\t' : ' '.repeat(settings.indent);
  const pad = unit.repeat(depth + 1);
  const closePad = unit.repeat(depth);

  if (Array.isArray(value)) {
    if (value.length === 0) return paint('[]', COLOURS.punctuation, settings);

    // An array of scalars stays on one line. This is the departure from
    // JSON.stringify's layout, and it is most of why this function exists:
    // a document of short coordinate pairs is unreadable at one element per
    // line, and fits on a screen at one array per line.
    if (value.every(isScalar) && !exceedsWidth(value, settings)) {
      const comma = paint(', ', COLOURS.punctuation, settings);
      return paint('[', COLOURS.punctuation, settings)
        + value.map((element) => renderCompact(element, settings)).join(comma)
        + paint(']', COLOURS.punctuation, settings);
    }

    const open = paint('[', COLOURS.punctuation, settings);
    const close = paint(']', COLOURS.punctuation, settings);
    const comma = paint(',', COLOURS.punctuation, settings);
    const lines = value.map((element) => pad + renderPretty(element, settings, depth + 1));
    return `${open}\n${lines.join(`${comma}\n`)}\n${closePad}${close}`;
  }

  const keys = settings.sortKeys ? Object.keys(value).sort() : Object.keys(value);
  if (keys.length === 0) return paint('{}', COLOURS.punctuation, settings);

  const open = paint('{', COLOURS.punctuation, settings);
  const close = paint('}', COLOURS.punctuation, settings);
  const comma = paint(',', COLOURS.punctuation, settings);
  const colon = paint(': ', COLOURS.punctuation, settings);

  const lines = keys.map((key) => {
    const renderedKey = paint(JSON.stringify(key), COLOURS.key, settings);
    return pad + renderedKey + colon + renderPretty(value[key], settings, depth + 1);
  });
  return `${open}\n${lines.join(`${comma}\n`)}\n${closePad}${close}`;
}

function isScalar(value) {
  return value === null || typeof value !== 'object';
}

/** Whether a scalar array is too wide to keep on one line. */
function exceedsWidth(values, settings) {
  let width = 2;
  for (const element of values) {
    width += renderCompact(element, { ...settings, colour: false }).length + 2;
    // Measured against a fixed 72 rather than the terminal's width, so the
    // same input renders the same way in a pipe as on a screen. Output that
    // changes shape depending on where it is going cannot be diffed.
    if (width > 72) return true;
  }
  return false;
}

/**
 * Renders a number the way JSON does, without JavaScript's quirks.
 *
 * `JSON.stringify(1e21)` gives `1e+21`, which is valid JSON, and
 * `String(-0)` gives `0`, which loses the sign. Neither matters often; both
 * matter when a query's output is compared against a fixture.
 */
function renderNumber(value) {
  if (Number.isNaN(value) || !Number.isFinite(value)) {
    // Neither has a JSON form. null is what JSON.stringify emits, and
    // matching it keeps the output parseable.
    return 'null';
  }
  if (Number.isInteger(value) && Object.is(value, -0)) return '-0';
  return JSON.stringify(value);
}

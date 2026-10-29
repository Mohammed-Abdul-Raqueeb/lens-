/**
 * Builtins over strings, and the `@name` formats.
 *
 * The regex family (`test`, `match`, `capture`, `sub`, `gsub`, `splits`) is
 * built on JavaScript's own RegExp rather than a bundled engine. That is the
 * one place this project leans on the host for something substantial, and the
 * alternative -- writing a regex engine -- would be a larger project than the
 * query language around it.
 */

import { typeName } from '../errors.js';
import { evaluate } from '../eval.js';
import { equals } from '../values.js';
import {
  fail, require as requireType, simple, streaming, valued, valuedStreaming,
} from './define.js';

const tostring = simple((input) => {
  // A string passes through unchanged rather than gaining quotes, which is
  // the difference between `tostring` and `tojson` and the reason both exist.
  if (typeof input === 'string') return input;
  return JSON.stringify(input) ?? 'null';
});

const tonumber = simple((input, context) => {
  if (typeof input === 'number') return input;
  if (typeof input !== 'string') {
    return fail(context, `tonumber needs a string or a number, not ${typeName(input)}`, input);
  }

  const trimmed = input.trim();
  // Rejected explicitly rather than left to Number(), which answers 0 for the
  // empty string -- a silent wrong answer in exactly the case a CSV import
  // produces.
  if (trimmed === '') {
    return fail(context, 'tonumber cannot read a number from an empty string', input);
  }

  const value = Number(trimmed);
  if (!Number.isFinite(value)) {
    return fail(context, `tonumber cannot read a number from ${JSON.stringify(input)}`, input);
  }
  return value;
});

const tojson = simple((input) => JSON.stringify(input) ?? 'null');

const fromjson = simple((input, context) => {
  requireType(input, 'string', 'fromjson', context);
  try {
    return JSON.parse(input);
  } catch (error) {
    return fail(context, `fromjson could not parse the string: ${error.message}`, input);
  }
});

const asciiDowncase = simple((input, context) => {
  requireType(input, 'string', 'ascii_downcase', context);
  // ASCII only, as the name says. toLowerCase() is locale-sensitive for a few
  // characters -- Turkish dotless i being the classic -- and a query whose
  // result depends on the machine's locale is not reproducible.
  return input.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
});

const asciiUpcase = simple((input, context) => {
  requireType(input, 'string', 'ascii_upcase', context);
  return input.replace(/[a-z]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 32));
});

const explode = simple((input, context) => {
  requireType(input, 'string', 'explode', context);
  // Code points rather than UTF-16 units, so an emoji is one number and
  // `explode | implode` round-trips it.
  return [...input].map((char) => char.codePointAt(0));
});

const implode = simple((input, context) => {
  requireType(input, 'array', 'implode', context);
  return input.map((code) => {
    if (typeof code !== 'number' || !Number.isInteger(code) || code < 0 || code > 0x10ffff) {
      return fail(context, `implode needs code points, found ${JSON.stringify(code)}`, code);
    }
    return String.fromCodePoint(code);
  }).join('');
});

const split1 = valued(1, (input, [separator], context) => {
  requireType(input, 'string', 'split', context);
  requireType(separator, 'string', 'split', context);
  // An empty separator would split into characters in JavaScript and is an
  // error in jq; the error is better, since `explode` is what was meant.
  if (separator === '') {
    return fail(
      context,
      'split needs a non-empty separator; use explode for characters',
      separator,
    );
  }
  return input.split(separator);
});

const join = valued(1, (input, [separator], context) => {
  requireType(input, 'array', 'join', context);
  requireType(separator, 'string', 'join', context);

  return input.map((element) => {
    // null becomes the empty string and numbers and booleans stringify, but
    // an array or object is an error: joining them would produce something
    // that looks like data and is not.
    if (element === null) return '';
    if (typeof element === 'string') return element;
    if (typeof element === 'number' || typeof element === 'boolean') return String(element);
    return fail(context, `join cannot render ${typeName(element)} as part of a string`, element);
  }).join(separator);
});

const ltrimstr = valued(1, (input, [prefix]) => {
  // Returns the input unchanged rather than erroring when the types are
  // wrong, which is what makes `.[] | ltrimstr("v")` safe over a mixed array.
  if (typeof input !== 'string' || typeof prefix !== 'string') return input;
  return input.startsWith(prefix) ? input.slice(prefix.length) : input;
});

const rtrimstr = valued(1, (input, [suffix]) => {
  if (typeof input !== 'string' || typeof suffix !== 'string') return input;
  return input.endsWith(suffix) && suffix !== ''
    ? input.slice(0, input.length - suffix.length)
    : input;
});


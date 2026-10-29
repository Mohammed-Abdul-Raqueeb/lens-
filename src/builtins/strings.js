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


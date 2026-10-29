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

const trimstr = valued(1, (input, [affix]) => {
  if (typeof input !== 'string' || typeof affix !== 'string' || affix === '') return input;
  let out = input;
  if (out.startsWith(affix)) out = out.slice(affix.length);
  if (out.endsWith(affix)) out = out.slice(0, out.length - affix.length);
  return out;
});

const ltrim = simple((input, context) => {
  requireType(input, 'string', 'ltrim', context);
  return input.replace(/^\s+/, '');
});

const rtrim = simple((input, context) => {
  requireType(input, 'string', 'rtrim', context);
  return input.replace(/\s+$/, '');
});

const trim = simple((input, context) => {
  requireType(input, 'string', 'trim', context);
  return input.trim();
});

const startswith = valued(1, (input, [prefix], context) => {
  requireType(input, 'string', 'startswith', context);
  requireType(prefix, 'string', 'startswith', context);
  return input.startsWith(prefix);
});

const endswith = valued(1, (input, [suffix], context) => {
  requireType(input, 'string', 'endswith', context);
  requireType(suffix, 'string', 'endswith', context);
  return input.endsWith(suffix);
});

/**
 * `contains(x)` — substring for strings, subset for arrays and objects.
 *
 * The overloading looks like three builtins in one, and it is one question:
 * "is this inside that?". Keeping it together is what lets a query filter a
 * heterogeneous document without branching on type first.
 */
const contains = valued(1, (input, [needle], context) => containsValue(input, needle, context));

/**
 * The body of `contains` and `inside`.
 *
 * `nested` distinguishes the top-level call from a recursive one, and the
 * distinction is load-bearing. `1 | contains(1)` is an error -- containment
 * is not a question you ask of a number -- but `{a: 1} | contains({a: 1})`
 * has to recurse into those numbers and compare them, so the same scalar
 * case means different things depending on how it was reached.
 */
function containsValue(haystack, needle, context, nested = false) {
  if (typeof haystack === 'string') {
    if (typeof needle !== 'string') {
      return fail(context, `contains on a string needs a string, not ${typeName(needle)}`, needle);
    }
    return haystack.includes(needle);
  }

  if (Array.isArray(haystack)) {
    if (!Array.isArray(needle)) {
      return fail(context, `contains on an array needs an array, not ${typeName(needle)}`, needle);
    }
    // Each wanted element must be contained in *some* element, recursively,
    // which is how `["ab"] | contains(["a"])` is true. Surprising, and jq's
    // definition.
    return needle.every((wanted) => haystack.some((element) => {
      try {
        return containsValue(element, wanted, context, true);
      } catch {
        return false;
      }
    }));
  }

  if (haystack !== null && typeof haystack === 'object') {
    if (needle === null || typeof needle !== 'object' || Array.isArray(needle)) {
      return fail(
        context,
        `contains on an object needs an object, not ${typeName(needle)}`,
        needle,
      );
    }
    return Object.keys(needle).every((key) => (
      Object.prototype.hasOwnProperty.call(haystack, key)
        && containsValue(haystack[key], needle[key], context, true)
    ));
  }

  if (nested) return equals(haystack, needle);

  return fail(
    context,
    `contains needs a string, array or object, not ${typeName(haystack)}`,
    haystack,
  );
}

const inside = valued(1, (input, [container], context) => containsValue(container, input, context));

/**
 * Builds a RegExp from the language's pattern and flags.
 *
 * jq's flag letters are mostly JavaScript's, with `x` (extended) and `s`
 * (single line) needing translation and `g` handled by the caller rather than
 * baked in -- a sticky regex reused across inputs would carry `lastIndex`
 * between them and skip matches.
 */
function buildRegex(pattern, flags, context, builtinName) {
  if (typeof pattern !== 'string') {
    fail(context, `${builtinName} needs a string pattern, not ${typeName(pattern)}`, pattern);
  }

  let source = pattern;
  let jsFlags = 'u';
  let global = false;

  if (flags !== null && flags !== undefined) {
    if (typeof flags !== 'string') {
      fail(context, `${builtinName} needs string flags, not ${typeName(flags)}`, flags);
    }
    for (const flag of flags) {
      switch (flag) {
        case 'g': global = true; break;
        case 'i': jsFlags += 'i'; break;
        case 'm': jsFlags += 's'; break;
        case 's': jsFlags += 's'; break;
        case 'n': break;
        case 'p': jsFlags += 'sm'; break;
        case 'l': break;
        case 'x':
          // Extended mode: whitespace and comments in the pattern are
          // ignored. Stripped here because JavaScript has no such flag.
          source = source.replace(/\\#/g, '\u0000')
            .replace(/#.*$/gm, '')
            .replace(/\s+/g, '')
            .replace(/\u0000/g, '\\#');
          break;
        default:
          fail(context, `${builtinName} does not understand the flag '${flag}'`, flags);
      }
    }
  }

  try {
    return { regex: new RegExp(source, [...new Set(jsFlags)].join('')), global };
  } catch (error) {
    fail(context, `${builtinName} could not compile the pattern: ${error.message}`, pattern);
    return null;
  }
}

/** Converts one RegExp match into the language's match object. */
function matchObject(match, input) {
  const captures = [];
  const groupNames = match.groups ? Object.keys(match.groups) : [];

  for (let i = 1; i < match.length; i++) {
    const text = match[i];
    captures.push({
      offset: text === undefined ? -1 : input.indexOf(text, match.index),
      length: text === undefined ? 0 : [...text].length,
      string: text === undefined ? null : text,
      name: groupNames.find((name) => match.groups[name] === text) ?? null,
    });
  }

  return {
    offset: match.index,
    length: [...match[0]].length,
    string: match[0],
    captures,
  };
}

function* matchesOf(input, pattern, flags, context, builtinName) {
  requireType(input, 'string', builtinName, context);
  const { regex, global } = buildRegex(pattern, flags, context, builtinName);

  if (!global) {
    const match = regex.exec(input);
    if (match) yield matchObject(match, input);
    return;
  }

  // A fresh global regex per call, and an explicit advance on a zero-length
  // match: without it, a pattern that can match the empty string loops for
  // ever on the same index.
  const globalRegex = new RegExp(regex.source, `${regex.flags}g`);
  let match = globalRegex.exec(input);
  while (match !== null) {
    yield matchObject(match, input);
    if (match[0] === '') globalRegex.lastIndex++;
    match = globalRegex.exec(input);
  }
}

const test1 = valued(1, (input, [pattern], context) => {
  requireType(input, 'string', 'test', context);
  const { regex } = buildRegex(pattern, null, context, 'test');
  return regex.test(input);
});

const test2 = valued(2, (input, [pattern, flags], context) => {
  requireType(input, 'string', 'test', context);
  const { regex } = buildRegex(pattern, flags, context, 'test');
  return regex.test(input);
});

const match1 = valuedStreaming(1, function* body(input, [pattern], context) {
  yield* matchesOf(input, pattern, null, context, 'match');
});

const match2 = valuedStreaming(2, function* body(input, [pattern, flags], context) {
  yield* matchesOf(input, pattern, flags, context, 'match');
});

/** `capture` — the named groups of a match, as an object. */
const capture1 = valuedStreaming(1, function* body(input, [pattern], context) {
  yield* capturesOf(input, pattern, null, context);
});

const capture2 = valuedStreaming(2, function* body(input, [pattern, flags], context) {
  yield* capturesOf(input, pattern, flags, context);
});

function* capturesOf(input, pattern, flags, context) {
  for (const found of matchesOf(input, pattern, flags, context, 'capture')) {
    const out = {};
    for (const capture of found.captures) {
      if (capture.name !== null) out[capture.name] = capture.string;
    }
    yield out;
  }
}

const scan1 = valuedStreaming(1, function* body(input, [pattern], context) {
  yield* scanOf(input, pattern, 'g', context);
});

const scan2 = valuedStreaming(2, function* body(input, [pattern, flags], context) {
  yield* scanOf(input, pattern, `${flags}g`, context);
});

function* scanOf(input, pattern, flags, context) {
  for (const found of matchesOf(input, pattern, flags, context, 'scan')) {
    // The whole match when there are no groups, the groups when there are,
    // which is what makes `scan("\\d+")` and `scan("(\\w)=(\\w)")` both
    // useful without a wrapper.
    yield found.captures.length === 0
      ? found.string
      : found.captures.map((capture) => capture.string);
  }
}

const splits1 = valuedStreaming(1, function* body(input, [pattern], context) {
  yield* splitsOf(input, pattern, null, context);
});

const splits2 = valuedStreaming(2, function* body(input, [pattern, flags], context) {
  yield* splitsOf(input, pattern, flags, context);
});

function* splitsOf(input, pattern, flags, context) {
  requireType(input, 'string', 'splits', context);
  const { regex } = buildRegex(pattern, flags, context, 'splits');
  yield* input.split(new RegExp(regex.source, `${regex.flags.replace('g', '')}g`));
}

const splitRegex = valued(2, (input, [pattern, flags], context) => {
  requireType(input, 'string', 'split', context);
  const { regex } = buildRegex(pattern, flags, context, 'split');
  return input.split(new RegExp(regex.source, `${regex.flags.replace('g', '')}g`));
});

/** `sub(re; str)` — replaces the first match. */
const sub2 = function* sub2(node, input, env) {
  yield* substitute(node, input, env, false, null);
};

const sub3 = function* sub3(node, input, env) {
  yield* substitute(node, input, env, false, node.args[2]);
};

/** `gsub(re; str)` — replaces every match. */
const gsub2 = function* gsub2(node, input, env) {
  yield* substitute(node, input, env, true, null);
};

const gsub3 = function* gsub3(node, input, env) {
  yield* substitute(node, input, env, true, node.args[2]);
};

/**
 * The shared body of sub and gsub.
 *
 * The replacement is a filter, not a string, and it runs with the match's
 * named captures as its input. That is what makes
 * `gsub("(?<n>\\d+)"; "[\(.n)]")` work, and it is why this cannot be a
 * `valued` builtin.
 */
function* substitute(node, input, env, global, flagsNode) {
  const context = { node, env };
  requireType(input, 'string', global ? 'gsub' : 'sub', context);

  for (const pattern of evaluate(node.args[0], input, env)) {
    const flagValues = flagsNode ? [...evaluate(flagsNode, input, env)] : [null];

    for (const flags of flagValues) {
      const effective = global ? `${flags ?? ''}g` : flags;
      const found = [...matchesOf(input, pattern, effective, context, global ? 'gsub' : 'sub')];

      if (found.length === 0) {
        yield input;
        continue;
      }

      // Built by walking the matches rather than with String.replace, because
      // the replacement is a generator and may yield more than one value --
      // in which case the whole substitution has several results.
      let results = [''];
      let cursor = 0;

      for (const match of found) {
        const captures = {};
        for (const capture of match.captures) {
          if (capture.name !== null) captures[capture.name] = capture.string;
        }

        const replacements = [...evaluate(node.args[1], captures, env)];
        const prefix = input.slice(cursor, match.offset);

        const next = [];
        for (const partial of results) {
          for (const replacement of replacements) {
            if (typeof replacement !== 'string') {
              fail(
                context,
                `${global ? 'gsub' : 'sub'} needs a string replacement, not `
                  + typeName(replacement),
                replacement,
              );
            }
            next.push(partial + prefix + replacement);
          }
        }
        results = next;
        cursor = match.offset + match.string.length;
      }

      const tail = input.slice(cursor);
      yield* results.map((partial) => partial + tail);
    }
  }
}

const ascii = simple((input, context) => {
  requireType(input, 'number', 'ascii', context);
  return String.fromCharCode(input);
});

/** `tostream` — a document as a stream of path/value events. */
const tostream = streaming(function* body(input) {
  yield* streamEvents(input, []);
});

function* streamEvents(value, path) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      yield [path, []];
      return;
    }
    for (let i = 0; i < value.length; i++) {
      yield* streamEvents(value[i], [...path, i]);
    }
    // The closing event carries the path of the last element, which is how a
    // consumer knows a container ended rather than guessing from depth.
    yield [[...path, value.length - 1]];
    return;
  }

  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value);
    if (keys.length === 0) {
      yield [path, {}];
      return;
    }
    for (const key of keys) {
      yield* streamEvents(value[key], [...path, key]);
    }
    yield [[...path, keys[keys.length - 1]]];
    return;
  }

  yield [path, value];
}

/** The `@name` formats. */
export const formats = {
  text: (value) => (typeof value === 'string' ? value : JSON.stringify(value) ?? 'null'),
  json: (value) => JSON.stringify(value) ?? 'null',

  csv: (value) => {
    if (!Array.isArray(value)) throw new TypeError('@csv needs an array');
    return value.map((cell) => {
      if (cell === null) return '';
      if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
      if (typeof cell === 'string') return `"${cell.replace(/"/g, '""')}"`;
      throw new TypeError(`@csv cannot render ${typeName(cell)}`);
    }).join(',');
  },

  tsv: (value) => {
    if (!Array.isArray(value)) throw new TypeError('@tsv needs an array');
    return value.map((cell) => {
      if (cell === null) return '';
      if (typeof cell === 'number' || typeof cell === 'boolean') return String(cell);
      if (typeof cell === 'string') {
        // Tabs and newlines are escaped rather than quoted, because TSV has no
        // quoting -- a raw tab in a cell would silently become a new column.
        return cell
          .replace(/\\/g, '\\\\')
          .replace(/\t/g, '\\t')
          .replace(/\n/g, '\\n')
          .replace(/\r/g, '\\r');
      }
      throw new TypeError(`@tsv cannot render ${typeName(cell)}`);
    }).join('\t');
  },

  html: (value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/'/g, '&#39;')
      .replace(/"/g, '&quot;');
  },

  uri: (value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
    // encodeURIComponent leaves !'()* alone, which are reserved in a query
    // string, so they are escaped by hand.
    return encodeURIComponent(text).replace(
      /[!'()*]/g,
      (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
    );
  },

  sh: (value) => {
    const quote = (text) => `'${String(text).replace(/'/g, "'\\''")}'`;
    if (Array.isArray(value)) return value.map(quote).join(' ');
    if (typeof value === 'string') return quote(value);
    return JSON.stringify(value) ?? 'null';
  },

  base64: (value) => {
    const text = typeof value === 'string' ? value : JSON.stringify(value) ?? 'null';
    return Buffer.from(text, 'utf8').toString('base64');
  },

  base64d: (value) => {
    if (typeof value !== 'string') throw new TypeError('@base64d needs a string');
    return Buffer.from(value, 'base64').toString('utf8');
  },
};

/** The builtins this module provides, keyed by `name/arity`. */
export const stringBuiltins = {
  'tostring/0': tostring,
  'tonumber/0': tonumber,
  'tojson/0': tojson,
  'fromjson/0': fromjson,
  'ascii_downcase/0': asciiDowncase,
  'ascii_upcase/0': asciiUpcase,
  'ascii/0': ascii,
  'explode/0': explode,
  'implode/0': implode,
  'split/1': split1,
  'split/2': splitRegex,
  'join/1': join,
  'ltrimstr/1': ltrimstr,
  'rtrimstr/1': rtrimstr,
  'trimstr/1': trimstr,
  'ltrim/0': ltrim,
  'rtrim/0': rtrim,
  'trim/0': trim,
  'startswith/1': startswith,
  'endswith/1': endswith,
  'contains/1': contains,
  'inside/1': inside,
  'test/1': test1,
  'test/2': test2,
  'match/1': match1,
  'match/2': match2,
  'capture/1': capture1,
  'capture/2': capture2,
  'scan/1': scan1,
  'scan/2': scan2,
  'splits/1': splits1,
  'splits/2': splits2,
  'sub/2': sub2,
  'sub/3': sub3,
  'gsub/2': gsub2,
  'gsub/3': gsub3,
  'tostream/0': tostream,
};

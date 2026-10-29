/**
 * Builtins over objects and paths.
 *
 * `to_entries` and its family are the language's answer to "iterate over an
 * object knowing the keys", which `.[]` cannot do -- it yields values and
 * loses the key.
 */

import { typeName } from '../errors.js';
import { evaluate } from '../eval.js';
import { allPaths, deletePaths, getPath, requirePath, setPath } from '../paths.js';
import { clone, truthy } from '../values.js';
import {
  fail, require as requireType, simple, streaming, valued, valuedStreaming,
} from './define.js';

const toEntries = simple((input, context) => {
  requireType(input, ['object', 'array'], 'to_entries', context);

  if (Array.isArray(input)) {
    return input.map((value, key) => ({ key, value }));
  }
  // Insertion order, not sorted: `to_entries | from_entries` must not
  // reorder a document's fields.
  return Object.keys(input).map((key) => ({ key, value: input[key] }));
});

/**
 * `from_entries` — the inverse, and deliberately forgiving about its input.
 *
 * Accepts `key`/`value`, `k`/`v`, `name`/`name`, and a bare two-element
 * array, because entry lists arrive from several places and refusing the
 * shapes jq accepts would break queries copied across.
 */
const fromEntries = simple((input, context) => {
  requireType(input, 'array', 'from_entries', context);

  const out = {};
  for (const entry of input) {
    let key;
    let value;

    if (Array.isArray(entry)) {
      [key, value] = entry;
    } else if (entry !== null && typeof entry === 'object') {
      key = firstDefined(entry, ['key', 'k', 'name', 'Name', 'Key', 'K']);
      value = firstDefined(entry, ['value', 'v', 'Value', 'V']);
    } else {
      // A bare scalar becomes a key with a null value, which is what makes
      // `["a","b"] | from_entries` a set.
      key = entry;
      value = null;
    }

    if (key === null || key === undefined) {
      out.null = value === undefined ? null : value;
      continue;
    }
    if (typeof key === 'number' || typeof key === 'boolean') {
      out[String(key)] = value === undefined ? null : value;
      continue;
    }
    if (typeof key !== 'string') {
      return fail(
        context,
        `from_entries needs string keys, found ${typeName(key)}`,
        key,
      );
    }
    out[key] = value === undefined ? null : value;
  }
  return out;
});

function firstDefined(entry, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(entry, name)) return entry[name];
  }
  return undefined;
}

/** `with_entries(f)` — to_entries, map, from_entries. */
const withEntries = function* withEntries(node, input, env) {
  const context = { node, env };
  requireType(input, ['object', 'array'], 'with_entries', context);

  const entries = Array.isArray(input)
    ? input.map((value, key) => ({ key, value }))
    : Object.keys(input).map((key) => ({ key, value: input[key] }));

  const out = {};
  for (const entry of entries) {
    for (const transformed of evaluate(node.args[0], entry, env)) {
      if (transformed === null || typeof transformed !== 'object' || Array.isArray(transformed)) {
        fail(
          context,
          'with_entries needs its filter to produce an object with a key and a value, not '
            + typeName(transformed),
          transformed,
        );
      }
      const key = firstDefined(transformed, ['key', 'k', 'name']);
      const value = firstDefined(transformed, ['value', 'v']);
      out[typeof key === 'string' ? key : String(key)] = value === undefined ? null : value;
    }
  }
  yield out;
};

/** `paths` — every path into the input, excluding the empty one. */
const paths0 = streaming(function* body(input) {
  yield* allPaths(input);
});

/** `paths(f)` — the paths whose value satisfies `f`. */
const paths1 = function* paths1(node, input, env) {
  for (const path of allPaths(input)) {
    const value = getPath(input, path);
    for (const test of evaluate(node.args[0], value, env)) {
      if (truthy(test)) yield path;
      break;
    }
  }
};

/** `leaf_paths` — the paths to scalars only. */
const leafPaths = streaming(function* body(input) {
  yield* allPaths(input, true);
});

const getpath = valued(1, (input, [path], context) => {
  requirePath(path);
  try {
    return getPath(input, path);
  } catch (error) {
    return fail(context, error.message, input);
  }
});

const setpath = valued(2, (input, [path, value], context) => {
  requirePath(path);
  try {
    return setPath(input, path, value);
  } catch (error) {
    return fail(context, error.message, input);
  }
});

const delpaths = valued(1, (input, [pathList], context) => {
  if (!Array.isArray(pathList)) {
    return fail(context, `delpaths needs an array of paths, not ${typeName(pathList)}`, pathList);
  }
  for (const path of pathList) requirePath(path);
  try {
    return deletePaths(input, pathList);
  } catch (error) {
    return fail(context, error.message, input);
  }
});

/**
 * `del(pathexpr)` — removes what a path expression addresses.
 *
 * Every path is collected before any is deleted, which is a correctness
 * requirement rather than a tidiness one: deleting `.[0]` shifts every later
 * index, so removing them one at a time removes the wrong elements.
 * `deletePaths` applies them in descending order to make each independent.
 */
const del = function* del(node, input, env) {
  const context = { node, env };
  const found = COLLECT.collectPaths(node.args[0], input, env);
  try {
    yield deletePaths(input, found);
  } catch (error) {
    fail(context, error.message, input);
  }
};

/** `path(pathexpr)` — the paths an expression addresses, as arrays. */
const path1 = function* path1(node, input, env) {
  for (const found of COLLECT.collectPaths(node.args[0], input, env)) {
    yield found;
  }
};

/**
 * Holds `collectPaths` for `path` and `del`.
 *
 * Same reason as the builtin table in core.js: eval.js imports this module,
 * so this module cannot import eval.js at the top level without a cycle.
 */
const COLLECT = { collectPaths: null };


/**
 * Reading and writing values at a path.
 *
 * A path is an array of keys: `["users", 0, "name"]` addresses
 * `.users[0].name`. Everything that modifies a document goes through here, so
 * the one decision that matters is made in one place: writes never mutate
 * their input. `setpath` returns a new document sharing every untouched
 * subtree with the old one.
 *
 * Copying only along the path is what makes that affordable. Deep-copying the
 * document per write would turn `reduce` over a thousand updates into a
 * thousand full copies.
 */

import { EvalError, describe, typeName } from './errors.js';

/**
 * Reads the value at a path, or null when it is absent.
 *
 * Absent is null rather than an error, because `getpath` is how a query asks
 * "is this there?" and an error would make the common case need a `try`.
 *
 * @param {unknown} value the document
 * @param {Array<string|number>} path the keys to follow
 * @returns {unknown} the value found, or null
 */
export function getPath(value, path) {
  let current = value;

  for (const key of path) {
    if (current === null || current === undefined) return null;

    if (typeof key === 'number') {
      if (!Array.isArray(current)) {
        throw new EvalError(
          `cannot index ${typeName(current)} with a number`,
          { value: current },
        );
      }
      const at = key < 0 ? current.length + key : key;
      current = at >= 0 && at < current.length ? current[at] : null;
      continue;
    }

    if (Array.isArray(current)) {
      throw new EvalError(
        `cannot index array with the string ${JSON.stringify(key)}`,
        { value: current },
      );
    }
    if (typeof current !== 'object') {
      throw new EvalError(
        `cannot index ${typeName(current)} with ${JSON.stringify(key)}`,
        { value: current },
      );
    }
    current = Object.prototype.hasOwnProperty.call(current, key) ? current[key] : null;
  }

  return current === undefined ? null : current;
}

/**
 * Returns a copy of the document with `newValue` at `path`.
 *
 * Missing containers along the way are created: setting `.a.b` on `null`
 * yields `{"a":{"b":...}}`. That is what makes `reduce` building an object
 * from nothing work without a prelude.
 *
 * @param {unknown} value the document
 * @param {Array<string|number>} path the keys to follow
 * @param {unknown} newValue what to put there
 * @returns {unknown} a new document
 */
export function setPath(value, path, newValue) {
  if (path.length === 0) return newValue;

  const [key, ...rest] = path;

  if (typeof key === 'number') {
    const base = value === null || value === undefined ? [] : value;
    if (!Array.isArray(base)) {
      throw new EvalError(
        `cannot index ${typeName(base)} with a number`,
        { value: base },
      );
    }

    const at = key < 0 ? base.length + key : key;
    if (at < 0) {
      throw new EvalError(
        `index ${key} is before the start of an array of ${base.length}`,
        { value: base },
      );
    }

    const out = [...base];
    // Holes are filled with null rather than left undefined, because
    // `undefined` has no JSON form and would be dropped on output, turning a
    // sparse write into a shorter array than asked for.
    while (out.length < at) out.push(null);
    out[at] = setPath(at < base.length ? base[at] : null, rest, newValue);
    return out;
  }

  const base = value === null || value === undefined ? {} : value;
  if (Array.isArray(base) || typeof base !== 'object') {
    throw new EvalError(
      `cannot set the key ${JSON.stringify(key)} on ${typeName(base)}`,
      { value: base },
    );
  }

  const out = { ...base };
  out[key] = setPath(
    Object.prototype.hasOwnProperty.call(base, key) ? base[key] : null,
    rest,
    newValue,
  );
  return out;
}

/**
 * Returns a copy of the document with the value at `path` removed.
 *
 * @param {unknown} value the document
 * @param {Array<string|number>} path the keys to follow
 * @returns {unknown} a new document
 */
export function deletePath(value, path) {
  if (path.length === 0) return null;

  const [key, ...rest] = path;
  if (value === null || value === undefined) return value;

  if (rest.length > 0) {
    const child = getPath(value, [key]);
    if (child === null) return value;
    return setPath(value, [key], deletePath(child, rest));
  }

  if (typeof key === 'number') {
    if (!Array.isArray(value)) {
      throw new EvalError(
        `cannot delete a numeric index from ${typeName(value)}`,
        { value },
      );
    }
    const at = key < 0 ? value.length + key : key;
    if (at < 0 || at >= value.length) return value;
    return [...value.slice(0, at), ...value.slice(at + 1)];
  }

  if (Array.isArray(value) || typeof value !== 'object') {
    throw new EvalError(
      `cannot delete the key ${JSON.stringify(key)} from ${typeName(value)}`,
      { value },
    );
  }

  const out = { ...value };
  delete out[key];
  return out;
}


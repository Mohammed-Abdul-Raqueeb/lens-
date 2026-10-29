import { test } from 'node:test';
import assert from 'node:assert/strict';

import { parseArgs, parseJsonStream, run } from '../src/cli.js';
import { format } from '../src/format.js';
import { throwsWith } from './helpers.js';

/** Collects what a stream was written. */
function sink() {
  const chunks = [];
  return {
    chunks,
    write(text) { chunks.push(text); return true; },
    get text() { return chunks.join(''); },
  };
}

/**
 * Runs the CLI in-process against captured streams.
 *
 * Nothing spawns a subprocess, which is what keeps the suite fast and lets a
 * test assert on stdout, stderr and the exit code together -- three separate
 * promises, any of which can be broken on its own.
 */
async function cli(argv, { stdin = '', files = {}, isTty = false } = {}) {
  const out = sink();
  const err = sink();
  const code = await run(argv, {
    out,
    err,
    readStdin: async () => stdin,
    readFile: (path) => {
      if (!(path in files)) throw new Error(`no such file: ${path}`);
      return files[path];
    },
    isTty,
  });
  return { code, out: out.text, err: err.text };
}

// ---- argument parsing ----------------------------------------------------

test('the first bare argument is the query and the rest are files', () => {
  const options = parseArgs(['.a', 'one.json', 'two.json']);
  assert.equal(options.query, '.a');
  assert.deepEqual(options.files, ['one.json', 'two.json']);
});

test('short and long flags agree', () => {
  assert.equal(parseArgs(['-r', '.']).rawOutput, true);
  assert.equal(parseArgs(['--raw-output', '.']).rawOutput, true);
  assert.equal(parseArgs(['-n', '.']).nullInput, true);
  assert.equal(parseArgs(['-s', '.']).slurp, true);
  assert.equal(parseArgs(['-S', '.']).sortKeys, true);
});

test('join-output implies raw-output', () => {
  const options = parseArgs(['-j', '.']);
  assert.equal(options.rawOutput, true);
  assert.equal(options.joinOutput, true);
});


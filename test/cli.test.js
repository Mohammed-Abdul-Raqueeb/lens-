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

test('compact and pretty override each other explicitly', () => {
  assert.equal(parseArgs(['-c', '.']).pretty, false);
  assert.equal(parseArgs(['-p', '.']).pretty, true);
  // Unset means "decide from whether output is a terminal".
  assert.equal(parseArgs(['.']).pretty, null);
});

test('--arg binds a string and --argjson binds a value', () => {
  assert.deepEqual(parseArgs(['--arg', 'k', '1', '.']).vars, { k: '1' });
  assert.deepEqual(parseArgs(['--argjson', 'k', '1', '.']).vars, { k: 1 });
  assert.deepEqual(parseArgs(['--argjson', 'k', '[1]', '.']).vars, { k: [1] });
});

test('--argjson with bad JSON is reported, quoting it', () => {
  const error = throwsWith(() => parseArgs(['--argjson', 'k', '{bad', '.']), Error);
  assert.match(error.message, /not valid JSON/);
  assert.match(error.message, /\{bad/);
});

test('an option missing its value is reported by name', () => {
  const error = throwsWith(() => parseArgs(['--arg']), Error);
  assert.match(error.message, /--arg needs a value/);
});

test('--name=value is accepted as well as --name value', () => {
  assert.equal(parseArgs(['--indent=4', '.']).indent, 4);
  assert.deepEqual(parseArgs(['--arg=k', 'v', '.']).vars, { k: 'v' });
});

test('--indent is bounded', () => {
  assert.equal(parseArgs(['--indent', '0', '.']).indent, 0);
  throwsWith(() => parseArgs(['--indent', '9', '.']), Error);
  throwsWith(() => parseArgs(['--indent', 'x', '.']), Error);
});

test('--args collects what follows as positional arguments', () => {
  const options = parseArgs(['.', '--args', 'a', 'b']);
  assert.deepEqual(options.positional, ['a', 'b']);
  // Everything after --args is positional, even if it looks like a flag.
  assert.deepEqual(parseArgs(['.', '--args', '-r']).positional, ['-r']);
});

test('an unknown flag is refused rather than ignored', () => {
  // A silently ignored --jsno leads a user to conclude the tool is broken.
  const error = throwsWith(() => parseArgs(['--jsno', '.']), Error);
  assert.match(error.message, /unknown option "--jsno"/);
});


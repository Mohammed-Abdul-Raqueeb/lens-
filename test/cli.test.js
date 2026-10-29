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

test('a lone dash is a filename, not a flag', () => {
  assert.equal(parseArgs(['-']).query, '-');
});

// ---- the JSON input stream -----------------------------------------------

test('a stream of whitespace-separated values parses', () => {
  assert.deepEqual(parseJsonStream('1 2 3'), [1, 2, 3]);
  assert.deepEqual(parseJsonStream('{"a":1}\n{"a":2}'), [{ a: 1 }, { a: 2 }]);
  assert.deepEqual(parseJsonStream('[1] [2]'), [[1], [2]]);
});

test('an empty input is no values, not an error', () => {
  assert.deepEqual(parseJsonStream(''), []);
  assert.deepEqual(parseJsonStream('  \n '), []);
});

test('a brace inside a string does not end the value', () => {
  assert.deepEqual(parseJsonStream('{"a":"}"}'), [{ a: '}' }]);
  assert.deepEqual(parseJsonStream('{"a":"\\""}'), [{ a: '"' }]);
});

test('commas between top-level values are tolerated', () => {
  // A file of records is often a JSON array with its brackets stripped.
  assert.deepEqual(parseJsonStream('{"a":1},{"a":2}'), [{ a: 1 }, { a: 2 }]);
});

test('an unterminated value is reported with its offset', () => {
  const error = throwsWith(() => parseJsonStream('{"a":1'), Error);
  assert.match(error.message, /unterminated JSON value/);
});

test('malformed JSON is reported with a preview', () => {
  const error = throwsWith(() => parseJsonStream('{nope}'), Error);
  assert.match(error.message, /could not parse JSON/);
});

// ---- running -------------------------------------------------------------

test('a query runs against piped input', async () => {
  const result = await cli(['.a'], { stdin: '{"a":1}' });
  assert.equal(result.code, 0);
  assert.equal(result.out, '1\n');
});

test('each output gets its own line', async () => {
  const result = await cli(['.[]'], { stdin: '[1,2,3]' });
  assert.equal(result.out, '1\n2\n3\n');
});

test('-n ignores the input entirely', async () => {
  const result = await cli(['-n', '[range(3)]'], { stdin: 'not even json' });
  assert.equal(result.code, 0);
  assert.equal(result.out, '[0,1,2]\n');
});

test('-s reads every input into one array', async () => {
  const result = await cli(['-s', 'add'], { stdin: '1 2 3' });
  assert.equal(result.out, '6\n');
});

test('-r prints strings without quotes', async () => {
  const quoted = await cli(['.a'], { stdin: '{"a":"x"}' });
  assert.equal(quoted.out, '"x"\n');

  const raw = await cli(['-r', '.a'], { stdin: '{"a":"x"}' });
  assert.equal(raw.out, 'x\n');
});

test('-r leaves non-strings as JSON', async () => {
  const result = await cli(['-r', '.a'], { stdin: '{"a":[1]}' });
  assert.equal(result.out, '[1]\n');
});

test('-j drops the trailing newline', async () => {
  const result = await cli(['-j', '.a'], { stdin: '{"a":"x"}' });
  assert.equal(result.out, 'x');
});

test('a file is read when given', async () => {
  const result = await cli(['.a', 'in.json'], { files: { 'in.json': '{"a":7}' } });
  assert.equal(result.out, '7\n');
});

test('several files are concatenated', async () => {
  const result = await cli(['.a', 'one.json', 'two.json'], {
    files: { 'one.json': '{"a":1}', 'two.json': '{"a":2}' },
  });
  assert.equal(result.out, '1\n2\n');
});

test('a missing file is reported without a stack trace', async () => {
  const result = await cli(['.', 'nope.json']);
  assert.equal(result.code, 2);
  assert.match(result.err, /no such file/);
});

test('--arg is visible as a variable', async () => {
  const result = await cli(['--arg', 'who', 'world', '-r', '"hi \\($who)"'], { stdin: 'null' });
  assert.equal(result.out, 'hi world\n');
});

test('$ENV and $ARGS are available', async () => {
  const env = await cli(['-n', '$ENV | type']);
  assert.equal(env.out, '"object"\n');

  const args = await cli(['-n', '$ARGS.positional', '--args', 'a', 'b']);
  assert.equal(args.out, '["a","b"]\n');
});

test('output is compact when piped and pretty at a terminal', async () => {
  const piped = await cli(['.'], { stdin: '{"a":1}', isTty: false });
  assert.equal(piped.out, '{"a":1}\n');

  const terminal = await cli(['.'], { stdin: '{"a":1}', isTty: true });
  assert.match(terminal.out, /\n/);
  assert.match(terminal.out, /"a"/);
});

test('-S sorts object keys', async () => {
  const result = await cli(['-S', '.'], { stdin: '{"b":1,"a":2}' });
  assert.equal(result.out, '{"a":2,"b":1}\n');
});


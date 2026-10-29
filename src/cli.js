/**
 * The `lens` command.
 *
 * Written as a function taking argv and the streams, returning an exit code,
 * so every flag can be tested in-process. Nothing here calls `process.exit`;
 * `bin/lens.js` does that with what this returns.
 */

import { LensError } from './errors.js';
import { Query, VERSION, builtinNames } from './index.js';
import { format } from './format.js';

const USAGE = `lens ${VERSION} - a JSON query language with no dependencies

Usage: lens [options] <query> [file...]

Options:
  -c, --compact        one line per output (the default when piped)
  -p, --pretty         indent the output (the default at a terminal)
  -r, --raw-output     print strings without quotes
  -j, --join-output    like -r, with no trailing newline
  -n, --null-input     ignore the input and run against null
  -s, --slurp          read every input into one array first
  -e, --exit-status    exit 1 when the last output is false or null
  -S, --sort-keys      emit object keys in sorted order
  -t, --tab            indent with tabs
      --indent <n>     spaces per level (default 2)
      --arg <k> <v>    bind $k to the string v
      --argjson <k> <v>  bind $k to the JSON value v
      --args           remaining arguments become $ARGS.positional
  -C, --color-output   colourise even when piped
  -M, --monochrome     never colourise
      --seq            prefix each output with RS, per RFC 7464
  -h, --help           print this text
  -V, --version        print the version
      --builtins       list every builtin

Examples:
  echo '{"a":[1,2,3]}' | lens '.a | add'
  lens -n '[range(5)] | map(. * .)'
  lens -r '.users[] | "\\(.name) <\\(.email)>"' users.json
  lens --arg env prod '.deploys[] | select(.env == $env)' deploys.json
`;

/**
 * Runs the command line.
 *
 * @param {string[]} argv the arguments, without node and the script
 * @param {object} io
 * @param {{write: Function}} io.out where output goes
 * @param {{write: Function}} io.err where errors go
 * @param {() => Promise<string>} io.readStdin reads standard input
 * @param {(path: string) => string} io.readFile reads a named file
 * @param {boolean} [io.isTty] whether output is a terminal
 * @returns {Promise<number>} the exit code
 */
export async function run(argv, io) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    io.err.write(`lens: ${error.message}\n`);
    return 2;
  }

  if (options.help) {
    io.out.write(USAGE);
    return 0;
  }
  if (options.version) {
    io.out.write(`lens ${VERSION}\n`);
    return 0;
  }
  if (options.listBuiltins) {
    io.out.write(`${builtinNames().join('\n')}\n`);
    return 0;
  }
  if (options.query === null) {
    io.err.write('lens: a query is required\n');
    io.err.write('Run "lens --help" for usage.\n');
    return 2;
  }

  // A terminal gets pretty, colourised output; a pipe gets compact and plain,
  // because the thing on the other end is almost always another program.
  const isTty = io.isTty ?? false;
  const pretty = options.pretty ?? isTty;
  const colour = options.colour ?? isTty;

  let query;
  try {
    query = new Query(options.query, { vars: buildVars(options) });
  } catch (error) {
    if (error instanceof LensError) {
      io.err.write(`${error.format()}\n`);
      return 3;
    }
    throw error;
  }

  let documents;
  try {
    documents = await readInputs(options, io);
  } catch (error) {
    io.err.write(`lens: ${error.message}\n`);
    return 2;
  }

  const renderOptions = {
    pretty,
    colour,
    indent: options.indent,
    sortKeys: options.sortKeys,
    tab: options.tab,
  };

  let lastOutput;
  let produced = false;

  for (const document of documents) {
    try {
      for (const value of query.run(document)) {
        lastOutput = value;
        produced = true;
        writeValue(value, renderOptions, options, io);
      }
    } catch (error) {
      if (error instanceof LensError) {
        io.err.write(`${error.format()}\n`);
        return 5;
      }
      throw error;
    }
  }

  if (options.exitStatus) {
    // `-e` reports the last output as a shell truth value. No output at all
    // is 4 rather than 1, because "the filter matched nothing" and "the
    // filter matched false" are different answers and a script may care.
    if (!produced) return 4;
    return lastOutput === false || lastOutput === null ? 1 : 0;
  }

  return 0;
}

function writeValue(value, renderOptions, options, io) {
  // RFC 7464: a record separator before each value, so a reader can resync
  // mid-stream. Harmless to a reader that ignores it, which is why it is
  // opt-in rather than default.
  if (options.seq) io.out.write('\u001e');

  if (options.rawOutput && typeof value === 'string') {
    io.out.write(options.joinOutput ? value : `${value}\n`);
    return;
  }

  const text = format(value, renderOptions);
  io.out.write(options.joinOutput ? text : `${text}\n`);
}


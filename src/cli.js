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

function buildVars(options) {
  const vars = { ...options.vars };
  const named = { ...options.vars };

  // $ENV and $__loc__ are jq's, and ARGS is how a script reaches its own
  // arguments without the shell quoting them into the query.
  vars.ENV = { ...process.env };
  vars.ARGS = { positional: options.positional, named };
  return vars;
}

async function readInputs(options, io) {
  if (options.nullInput) return [null];

  let text;
  if (options.files.length > 0) {
    text = options.files.map((path) => io.readFile(path)).join('\n');
  } else {
    text = await io.readStdin();
  }

  const values = parseJsonStream(text);
  return options.slurp ? [values] : values;
}

/**
 * Parses a stream of whitespace-separated JSON values.
 *
 * `JSON.parse` handles one value per string, and the common input here is a
 * file of newline-delimited records. Scanning for value boundaries by
 * tracking depth is enough: the only ambiguity JSON has at the top level is
 * inside strings, which is why the scanner tracks those too.
 *
 * @param {string} text the input
 * @returns {unknown[]} the values, in order
 */
export function parseJsonStream(text) {
  const values = [];
  let at = 0;

  while (at < text.length) {
    while (at < text.length && /\s/.test(text[at])) at++;
    if (at >= text.length) break;

    const start = at;
    const first = text[at];

    if (first === '{' || first === '[') {
      let depth = 0;
      let inString = false;
      while (at < text.length) {
        const char = text[at];
        if (inString) {
          if (char === '\\') at++;
          else if (char === '"') inString = false;
        } else if (char === '"') {
          inString = true;
        } else if (char === '{' || char === '[') {
          depth++;
        } else if (char === '}' || char === ']') {
          depth--;
          if (depth === 0) {
            at++;
            break;
          }
        }
        at++;
      }
      if (depth !== 0) {
        throw new Error(`unterminated JSON value starting at offset ${start}`);
      }
    } else if (first === '"') {
      at++;
      while (at < text.length) {
        if (text[at] === '\\') at++;
        else if (text[at] === '"') {
          at++;
          break;
        }
        at++;
      }
    } else {
      // A bare number, true, false or null runs to the next whitespace or
      // structural character.
      while (at < text.length && !/[\s,\]}]/.test(text[at])) at++;
    }

    const slice = text.slice(start, at).trim();
    if (slice === '') continue;

    try {
      values.push(JSON.parse(slice));
    } catch (error) {
      const preview = slice.length > 40 ? `${slice.slice(0, 40)}...` : slice;
      throw new Error(`could not parse JSON at offset ${start}: ${preview}`);
    }

    // A comma between top-level values is tolerated, since a file of records
    // is often a JSON array with its brackets stripped.
    while (at < text.length && /[\s,]/.test(text[at])) at++;
  }

  return values;
}

/**
 * Parses the command line.
 *
 * @param {string[]} argv the arguments
 * @returns {object} the parsed options
 * @throws {Error} on an unknown flag or a missing value
 */
export function parseArgs(argv) {
  const options = {
    query: null,
    files: [],
    vars: {},
    positional: [],
    pretty: null,
    colour: null,
    compact: false,
    rawOutput: false,
    joinOutput: false,
    nullInput: false,
    slurp: false,
    exitStatus: false,
    sortKeys: false,
    tab: false,
    indent: 2,
    seq: false,
    help: false,
    version: false,
    listBuiltins: false,
  };

  let collectingPositional = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (collectingPositional) {
      options.positional.push(arg);
      continue;
    }

    const needsValue = (name) => {
      if (i + 1 >= argv.length) throw new Error(`${name} needs a value`);
      i++;
      return argv[i];
    };

    switch (arg) {
      case '-h': case '--help': options.help = true; break;
      case '-V': case '--version': options.version = true; break;
      case '--builtins': options.listBuiltins = true; break;
      case '-c': case '--compact': case '--compact-output':
        options.compact = true;
        options.pretty = false;
        break;
      case '-p': case '--pretty': case '--pretty-output': options.pretty = true; break;
      case '-r': case '--raw-output': options.rawOutput = true; break;
      case '-j': case '--join-output':
        options.rawOutput = true;
        options.joinOutput = true;
        break;
      case '-n': case '--null-input': options.nullInput = true; break;
      case '-s': case '--slurp': options.slurp = true; break;
      case '-e': case '--exit-status': options.exitStatus = true; break;
      case '-S': case '--sort-keys': options.sortKeys = true; break;
      case '-t': case '--tab': options.tab = true; break;
      case '-C': case '--color-output': case '--colour-output': options.colour = true; break;
      case '-M': case '--monochrome-output': case '--monochrome': options.colour = false; break;
      case '--seq': options.seq = true; break;

      case '--indent': {
        const value = Number(needsValue('--indent'));
        if (!Number.isInteger(value) || value < 0 || value > 8) {
          throw new Error('--indent needs a whole number from 0 to 8');
        }
        options.indent = value;
        break;
      }

      case '--arg': {
        const name = needsValue('--arg');
        const value = needsValue('--arg');
        options.vars[name] = value;
        break;
      }

      case '--argjson': {
        const name = needsValue('--argjson');
        const raw = needsValue('--argjson');
        try {
          options.vars[name] = JSON.parse(raw);
        } catch (error) {
          throw new Error(`--argjson ${name} is not valid JSON: ${raw}`);
        }
        break;
      }

      case '--args':
        collectingPositional = true;
        break;

      default: {
        if (arg.startsWith('--') && arg.includes('=')) {
          // `--indent=4` is the other spelling people reach for, so it is
          // rewritten rather than refused.
          const split = arg.indexOf('=');
          argv.splice(i, 1, arg.slice(0, split), arg.slice(split + 1));
          i--;
          break;
        }
        if (arg.startsWith('-') && arg !== '-' && arg.length > 1) {
          throw new Error(`unknown option "${arg}"`);
        }
        if (options.query === null) {
          options.query = arg;
        } else {
          options.files.push(arg);
        }
      }
    }
  }

  return options;
}

export { USAGE };

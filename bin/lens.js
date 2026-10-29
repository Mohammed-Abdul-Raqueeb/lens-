#!/usr/bin/env node
/**
 * The executable wrapper.
 *
 * Everything interesting is in src/cli.js, which returns an exit code rather
 * than calling process.exit. This file is the only place that knows about the
 * real process, which is what lets the whole command line be tested
 * in-process.
 */

import { readFileSync } from 'node:fs';
import { run } from '../src/cli.js';

/** Reads standard input to the end. */
function readStdin() {
  return new Promise((resolve, reject) => {
    if (process.stdin.isTTY) {
      // No piped input and no file: resolving empty lets the CLI report "a
      // query is required" or run with -n, rather than hanging on a terminal
      // waiting for input the user does not know it wants.
      resolve('');
      return;
    }

    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    process.stdin.on('error', reject);
  });
}

const code = await run(process.argv.slice(2), {
  out: process.stdout,
  err: process.stderr,
  readStdin,
  readFile: (path) => readFileSync(path, 'utf8'),
  isTty: Boolean(process.stdout.isTTY),
});

// stdout may still hold buffered data when the process exits, and exiting
// before it drains truncates the last line of a large output. Writing an
// empty chunk and waiting for the callback flushes it.
process.stdout.write('', () => process.exit(code));

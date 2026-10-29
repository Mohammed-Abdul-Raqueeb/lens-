#!/usr/bin/env node
/**
 * A small linter for this repository's own conventions.
 *
 * Not a replacement for ESLint, and not trying to be. It checks the handful
 * of rules that matter here and that a general linter either does not know
 * about or would need configuring to enforce:
 *
 *   - every exported function and class carries a doc comment
 *   - nothing in src/ writes to the console
 *   - no line is unreasonably long
 *   - no file imports from outside the standard library
 *
 * The last is the one that justifies the file existing at all. The project's
 * only hard promise is that it has no dependencies, and a promise with
 * nothing checking it is a promise that will be broken by accident.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// fileURLToPath rather than url.pathname: pathname percent-encodes, so a
// directory with a space in its name comes back as "project%20folder" and
// every readdir fails with ENOENT on a path that looks almost right.
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const MAX_LINE = 100;

/** Modules the project is allowed to import. */
const ALLOWED_IMPORTS = [/^node:/, /^\./];

/** Every .js file under a directory, recursively. */
function* jsFiles(directory) {
  for (const entry of readdirSync(directory)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) {
      yield* jsFiles(path);
      continue;
    }
    if (entry.endsWith('.js') || entry.endsWith('.mjs')) yield path;
  }
}

const problems = [];

/** Records a problem against a file and line. */
function report(path, line, message) {
  problems.push(`${relative(ROOT, path).replace(/\\/g, '/')}:${line}: ${message}`);
}

for (const path of jsFiles(ROOT)) {
  const text = readFileSync(path, 'utf8');
  const lines = text.split('\n');
  const inSrc = /[/\\]src[/\\]/.test(path);
  // The linter names the patterns it searches for, so it matches itself on
  // every one of them. Excluding it is less silly than obfuscating the
  // patterns to hide them from their own search.
  const isLinter = path.endsWith('lint.js');

  lines.forEach((line, index) => {
    const number = index + 1;

    if ([...line].length > MAX_LINE) {
      report(path, number, `line is ${[...line].length} characters, over ${MAX_LINE}`);
    }

    if (/\s+$/.test(line)) {
      report(path, number, 'trailing whitespace');
    }

    if (line.includes('\t')) {
      report(path, number, 'tab character; this project indents with spaces');
    }

    const importMatch = line.match(/^\s*(?:import|export)[^'"]*from\s+['"]([^'"]+)['"]/);
    if (importMatch) {
      const target = importMatch[1];
      if (!ALLOWED_IMPORTS.some((pattern) => pattern.test(target))) {
        report(
          path,
          number,
          `imports "${target}", which is neither the standard library nor relative`,
        );
      }
    }

    // console.log in a library writes to the caller's stdout, which for a
    // CLI tool means corrupting its output stream. The CLI has its own
    // injected streams for exactly this reason.
    if (inSrc && /\bconsole\.(log|info|warn|error|debug)\b/.test(line)) {
      report(path, number, 'console output from src/; write to an injected stream instead');
    }

    if (!isLinter && /\bdebugger\b/.test(line)) {
      report(path, number, 'leftover debugger statement');
    }

    if (/\.only\(/.test(line) && path.includes('test')) {
      // A `.only` left in a test file silently disables every other test in
      // it, which looks like a passing suite.
      report(path, number, 'test.only would skip the rest of the file');
    }
  });

  // An exported function or class with no preceding comment block.
  lines.forEach((line, index) => {
    const exportMatch = line.match(/^export\s+(?:async\s+)?(?:function\*?|class)\s+(\w+)/);
    if (!exportMatch) return;

    const previous = (lines[index - 1] ?? '').trim();
    // A one-line /** ... */ counts as well as the closing line of a block,
    // which the first version of this check missed -- it flagged five
    // documented classes and taught me to distrust it.
    const documented = previous.endsWith('*/') || previous.startsWith('//');
    if (!documented) {
      report(path, index + 1, `exported ${exportMatch[1]} has no doc comment`);
    }
  });

  if (!text.endsWith('\n')) {
    report(path, lines.length, 'file does not end with a newline');
  }
}

if (problems.length > 0) {
  process.stderr.write(`${problems.join('\n')}\n`);
  process.stderr.write(`\n${problems.length} problem(s)\n`);
  process.exit(1);
}

process.stdout.write('lint: clean\n');

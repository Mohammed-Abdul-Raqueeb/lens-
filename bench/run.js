#!/usr/bin/env node
/**
 * Benchmarks, measured with `performance.now` rather than a framework.
 *
 * A dependency here would be the only one in the repository, and what a
 * benchmark needs to be useful is a number you can reproduce rather than a
 * statistical model of it. Each case warms up, then runs enough iterations to
 * take a measurable time, and reports the median with the best and worst
 * sample so an outlier is visible instead of averaged away.
 *
 *   npm run bench
 */

import { compile, query } from '../src/index.js';

const SAMPLES = 9;

/** Builds a synthetic document of `count` records. */
function corpus(count) {
  const regions = ['eu', 'us', 'ap'];
  const tiers = ['free', 'pro', 'enterprise'];

  return {
    users: Array.from({ length: count }, (_, i) => ({
      id: i,
      name: `user${i}`,
      email: `user${i}@example.com`,
      region: regions[i % regions.length],
      tier: tiers[i % tiers.length],
      active: i % 7 !== 0,
      logins: i % 97,
      tags: [`t${i % 11}`, `t${i % 13}`],
      profile: { age: 20 + (i % 50), city: `city${i % 23}` },
    })),
  };
}

/**
 * Times `body`, reporting the median of several samples.
 *
 * @param {string} label what is being measured
 * @param {number} iterations how many times to run the body per sample
 * @param {Function} body the work
 */
function measure(label, iterations, body) {
  // One warm-up sample, discarded. The first run of anything in V8 is
  // dominated by the optimiser not having seen the code yet, and including
  // it makes every number look worse than it is in a real process.
  for (let i = 0; i < iterations; i++) body();

  const samples = [];
  for (let sample = 0; sample < SAMPLES; sample++) {
    const started = performance.now();
    for (let i = 0; i < iterations; i++) body();
    samples.push((performance.now() - started) / iterations);
  }

  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const best = samples[0];
  const worst = samples[samples.length - 1];

  const perSecond = median > 0 ? Math.round(1000 / median) : Infinity;
  process.stdout.write(
    `  ${label.padEnd(46)}${render(median).padStart(10)}`
      + `   [${render(best)} … ${render(worst)}]`
      + `  ${String(perSecond).padStart(10)}/s\n`,
  );
}

function render(ms) {
  if (ms < 0.001) return `${(ms * 1_000_000).toFixed(0)}ns`;
  if (ms < 1) return `${(ms * 1000).toFixed(1)}µs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function section(title) {
  process.stdout.write(`\n${title}\n${'─'.repeat(92)}\n`);
}

const small = corpus(100);
const large = corpus(10_000);

process.stdout.write('lens benchmarks\n');
process.stdout.write('Each line: median of 9 samples, with the best and worst in brackets.\n');

section('Parsing');
measure('parse .a', 20_000, () => compile('.a'));
measure('parse a realistic filter', 5_000, () => compile(
  '.users[] | select(.active and .profile.age > 30) | {name, city: .profile.city}',
));
measure('parse a long pipeline', 2_000, () => compile(
  '.users | map(select(.tier == "pro")) | group_by(.region) '
    + '| map({region: .[0].region, n: length}) | sort_by(-.n)',
));

section('Compiled execution (100 records)');
{
  const identity = compile('.');
  const field = compile('.users[0].name');
  const filter = compile('[.users[] | select(.active) | .name]');
  const grouped = compile('.users | group_by(.region) | map(length)');

  measure('identity', 50_000, () => identity.all(small));
  measure('one field, two levels deep', 20_000, () => field.all(small));
  measure('filter and project 100 records', 2_000, () => filter.all(small));
  measure('group 100 records by a key', 2_000, () => grouped.all(small));
}

section('Compiled execution (10,000 records)');
{
  const filter = compile('[.users[] | select(.active) | .name]');
  const grouped = compile('.users | group_by(.region) | map(length)');
  const sorted = compile('.users | sort_by(.profile.age) | .[0].id');
  const reduced = compile('reduce .users[] as $u (0; . + $u.logins)');
  const firstOnly = compile('first(.users[] | select(.logins > 90))');

  measure('filter and project 10,000 records', 20, () => filter.all(large));
  measure('group 10,000 records by a key', 20, () => grouped.all(large));
  measure('sort 10,000 records by a nested key', 20, () => sorted.all(large));
  measure('reduce over 10,000 records', 50, () => reduced.all(large));
  // The one that shows the generator model paying off: this stops at the
  // first match rather than walking all ten thousand.
  measure('first match in 10,000 records', 2_000, () => firstOnly.all(large));
}

section('Parse versus run');
{
  // The number that decides whether a caller should compile once, and it
  // came out against the assumption this case was written to confirm.
  // Parsing a realistic filter is about 4µs and running it over a hundred
  // records is about 70µs, so compiling once saves a few percent here --
  // not the large factor the API's existence implies.
  //
  // Compiling still wins where it matters: a one-field query over a stream of
  // tiny documents, where the run is nanoseconds and the parse is not. Worth
  // measuring for your own shape rather than assuming either way.
  const source = '.users[] | select(.active) | .name';
  const prepared = compile(source);

  measure('compile and run (uncompiled path)', 500, () => query(source, small));
  measure('run a compiled query', 2_000, () => prepared.all(small));
}

section('Output');
{
  const { format } = await import('../src/format.js');
  measure('format 10,000 records compactly', 20, () => format(large));
  measure('format 10,000 records prettily', 20, () => format(large, { pretty: true }));
}

process.stdout.write('\n');

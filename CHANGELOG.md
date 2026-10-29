# Changelog

Notable changes to Lens. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-30

First release. Everything is new, so this entry records the decisions worth
knowing rather than a list of additions.

### Added

- **The language**: paths, pipes, streams, overloaded arithmetic, a total
  comparison order, `if`/`elif`/`else`, `try`/`catch`, `reduce`, `foreach`,
  `as` bindings, `def` with both value and filter parameters, string
  interpolation, and assignment through path expressions.
- **Around 90 builtins** across `core`, `arrays`, `strings` and `objects`,
  including the regex family (`test`, `match`, `capture`, `scan`, `sub`,
  `gsub`) and nine `@format` encodings.
- **A command line** (`lens`) with the flags a shell user expects: `-r`,
  `-c`/`-p`, `-n`, `-s`, `-e`, `-S`, `--arg`, `--argjson`, `--args`, `--seq`,
  `--builtins`.
- **A library API**: `query`, `compile` and a `Query` whose `run` is a
  generator, so a huge result can be streamed rather than collected.
- **277 tests** on `node:test`, a hand-written linter, and benchmarks.
- **CI** across Node 20, 22 and 24 on Linux plus one version each on Windows
  and macOS, with gates asserting the dependency count is zero and driving the
  real binary end to end.

### Decisions worth recording

- **No dependencies, at run time or build time.** A query library gets
  embedded in other people's tools, and every dependency it carries becomes a
  version conflict in their build. `RegExp` from the host is the one
  substantial thing leaned on; writing a regex engine would have been a larger
  project than this one.
- **Every expression is a generator.** Not a micro-optimisation: `first` over
  10,000 records is 68µs where filtering all of them is 6.7ms, a 98×
  difference, because the generator stops. The cost is that every operator is
  a nested loop rather than a `map`.
- **Writes never mutate.** `setpath` copies only along the path, so a
  `reduce` over a thousand updates does not make a thousand copies of the
  document, and a query cannot corrupt its own input.
- **The comparison order is total.** A comparison that threw on mixed types
  would be defensible and useless — real documents are full of nulls where a
  number was expected, and `sort_by(.price)` has to survive them.
- **Only `false` and `null` are falsy.** `if .count then` fires for a count
  of zero, because the question being asked is whether the field is there.
- **The CLI returns an exit code rather than calling `process.exit`.** That is
  what lets all 40-odd CLI tests run in-process and assert on stdout, stderr
  and the exit code together.
- **Six distinct exit codes**, because a script may care whether a query would
  not parse (3), failed against the data (5), or matched nothing (4).

### Fixed before release

Three bugs found while building, each recorded for how it was found:

- **`contains` threw instead of answering.** `{a: 1} | contains({a: 2})`
  raised "contains needs a string, array or object, not number" rather than
  returning `false`. Containment recurses into an object's values, and the
  scalar case at the bottom of that recursion means equality — but the same
  code path is reached by `1 | contains(1)`, which really is an error. The two
  are now distinguished by whether the call is nested. Found by a test written
  to confirm the overloading worked.
- **Error messages read "a array".** Only two of the six type names begin with
  a vowel, so the article is a lookup rather than a rule. Small, and these
  messages are the whole interface when a query fails. Found by a test
  asserting on the message rather than just the type.
- **The linter flagged five documented classes.** Its doc-comment check only
  accepted the closing line of a block comment, so a one-line `/** … */` did
  not count. Found by running the linter on its own repository, which also
  turned up that it matched itself on every pattern it searches for.

### Corrected before release

One claim in the benchmark file was written to confirm an assumption and
measured the opposite. Compiling a query once rather than per document saves
about 4% for a realistic filter over a hundred records — parsing is 4µs and
running is 70µs — not the large factor the API's existence implies. The
comment now says so, and says where compiling does still win.

### Known limitations

No destructuring patterns, no modules, no `input`/`inputs`, no date functions.
Assignment re-walks its target expression per path, which is quadratic for
`.[] |= f` over a very large array. See the README and `docs/architecture.md`.

[0.1.0]: https://github.com/Mohammed-Abdul-Raqueeb/lens/releases/tag/v0.1.0

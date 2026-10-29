# Lens

A JSON query language for the command line and for Node, with **no
dependencies at all** — none at run time, none at build time, no lock file.

```bash
$ echo '{"users":[{"name":"ada","active":true},{"name":"bob","active":false}]}' \
    | lens -r '.users[] | select(.active) | .name'
ada
```

If you know `jq`, you know most of this. Queries copied across mostly work;
[what differs](docs/language.md#differences-from-jq) is a short list.

## Install

```bash
npm install @raqueeb/lens     # as a library
npx @raqueeb/lens '.a'        # as a command
```

Requires Node 20 or newer. There is nothing to compile and nothing to fetch.

## Use it from a shell

```bash
lens '.users | length' data.json          # a file
curl -s api/users | lens '.[].name'       # a pipe
lens -n '[range(5)] | map(. * .)'         # no input at all
lens -r '.users[] | "\(.name) <\(.email)>"' data.json
lens --arg env prod '.deploys[] | select(.env == $env)' deploys.json
lens --builtins                           # every function, one per line
```

| Flag | |
| --- | --- |
| `-r` | print strings without quotes |
| `-c` / `-p` | compact / pretty (default: pretty at a terminal, compact in a pipe) |
| `-n` | ignore the input, run against `null` |
| `-s` | slurp every input into one array |
| `-e` | exit non-zero when the last output is `false` or `null` |
| `-S` | sort object keys |
| `--arg k v` | bind `$k` to the string `v` |
| `--argjson k v` | bind `$k` to the JSON value `v` |

## Use it from Node

```js
import { query, compile } from '@raqueeb/lens';

query('.users[] | .name', document);          // => ['ada', 'bob']

// Compile once, run per document -- a log pipeline wants this.
const names = compile('.user.name');
for (const line of lines) names.first(JSON.parse(line));
```

`compile` returns a `Query` with `run` (a generator), `all`, `first` and
`withVars`. `run` streams, which matters: `first` over a huge document stops
at the first match rather than building the whole result.

## The language in one screen

```
.                 the input              |       pipe
.foo .foo.bar     fields                 ,       concatenate streams
."odd-name"       an awkward field        //      default on empty/false/null
.[0]  .[-1]       elements                ?       suppress errors
.[2:5]            a slice                 + - * / %    overloaded arithmetic
.[]               every element           == < >  total-order comparison
..                everything, deeply      and or not   short-circuiting

[ … ]   collect a stream into an array
{ a: .b, (.k): .v, $x, c }   build an object
if … then … elif … else … end
try … catch …
.a as $x | …          reduce .[] as $x (0; . + $x)
def f: …;  def f($a): …;  def f(filter): …
"text \(.interpolated)"       @base64  @csv  @uri  @sh
```

Full reference: [docs/language.md](docs/language.md) ·
[docs/builtins.md](docs/builtins.md)

## Things worth knowing up front

**Everything is a stream.** A filter yields zero or more values, not one.
`{a: (1,2)}` is two objects, not one object with two values — an object cannot
hold a stream.

**A missing field is `null`; a field of a number is an error.** The first
keeps optional data queryable without guards. The second is almost always a
real mismatch between the query and the data. `?` turns the second into
nothing.

**Only `false` and `null` are falsy.** Zero, `""` and `[]` are all true, so
`if .count then` fires for a count of zero — which is the question being
asked.

**Comparison is total.** `null < false < true < numbers < strings < arrays <
objects`, so `sort_by(.maybe_missing)` works on a real document instead of
failing halfway.

**Nothing is mutated.** `.a = 1` returns a new document sharing every
untouched subtree with the old one.

## Why no dependencies

A query library gets embedded in other people's tools, and every dependency it
carries becomes a version conflict in their build. The cost is paid here
instead.

The honest accounting: it cost less than it usually does, because Node has a
test runner built in. What it did cost is a 120-line hand-written linter, and
the linter exists mostly to check the no-dependency promise itself — a promise
with nothing enforcing it is one that gets broken by accident. The regex
engine is `RegExp` from the host, which is the one place this leans on
something substantial; writing one would have been a larger project than this.

If you do not need zero dependencies, `jq` is faster and far more battle-worn,
and `node-jq` wraps it.

## Build and test

```bash
npm test          # 277 tests, node:test, no runner to install
npm run lint      # the house rules, including the dependency check
npm run bench     # timings, median of 9 samples
```

CI runs the suite on Node 20, 22 and 24 on Linux plus one version each on
Windows and macOS, asserts that `package.json` declares nothing and that every
import is `node:` or relative, and drives the real binary end to end.

## What is in here

| | |
| --- | --- |
| Source | 16 files, ~5,700 lines |
| Tests | 7 files, 277 cases |
| Dependencies | 0 |

```
src/
  lexer.js      text to tokens
  parser.js     tokens to a tree, one function per precedence level
  ast.js        node constructors
  eval.js       the evaluator -- every expression is a generator
  values.js     equality, the total order, truthiness
  paths.js      reading and writing at a path, without mutating
  format.js     rendering, with colour and a layout JSON.stringify will not do
  cli.js        flags and input handling; returns an exit code
  builtins/     core, arrays, strings, objects -- around 90 functions
```

## Limitations

- **No destructuring.** `. as [$a, $b]` is refused by name rather than
  misparsed.
- **No modules, no `input`/`inputs`, no date functions.** The first two need
  an input stream the evaluator deliberately does not have; the third is
  omitted rather than half-done, because time zones make a half-done version
  actively wrong.
- **Assignment re-walks its target per path.** Fine for a handful, quadratic
  for `.[] |= f` over a very large array.
- **Deep recursion is bounded at 200 levels** in the parser, and the loop
  builtins stop after a million steps. Both are reported rather than hanging.

## Licence

MIT. See [LICENSE](LICENSE).

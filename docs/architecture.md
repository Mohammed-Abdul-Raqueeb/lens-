# Architecture

What Lens is shaped like, and what each choice cost.

## The pipeline

```
  query text
      │
      ▼
  ┌─────────┐  tokens   ┌──────────┐   AST    ┌───────────┐
  │  lexer  │ ────────▶ │  parser  │ ───────▶ │ evaluator │ ──▶ stream of values
  └─────────┘           └──────────┘          └───────────┘
   lexer.js              parser.js              eval.js
                            │                      │
                         ast.js                 values.js   total order
                                                paths.js    read and write
                                              builtins/*    ~90 functions
```

Three stages rather than one, and each fails for a different reason the user
needs told apart:

- **Lexer** — an unterminated string, a stray `&`. Reported with an offset.
- **Parser** — unbalanced brackets, a chained comparison. Purely syntactic,
  so it needs no input document.
- **Evaluator** — a field of a number, adding a string to an array. These
  depend on the data, and usually mean the query and the document disagree
  about shape.

Separating them is also what lets the parser be tested without any input at
all, which is why there are 70-odd parser tests that construct no documents.

## Every expression is a generator

This is the decision everything else follows from. `evaluate(node, input, env)`
is a JavaScript generator yielding zero or more values.

```js
case Node.PIPE:
  for (const value of evaluate(node.left, input, env)) {
    yield* evaluate(node.right, value, env);
  }
  return;
```

That nested loop *is* the pipe. `empty`, `.[]` and `1,2,3` need no special
handling anywhere, because they are ordinary expressions that happen to yield
a different number of times.

**What it buys.** Streaming, which is not a micro-optimisation here:

```
first match in 10,000 records     68.6µs
filter all 10,000 records         6.70ms
```

A 98× difference, because `first` stops the generator rather than building an
intermediate. Returning arrays instead would make `first(.[])` over a million
elements cost a million elements.

**What it costs.** Every operator is a nested loop over its operands, which
reads less neatly than a `map` would. `evalObject` building a cross product
iteratively is the clearest example — it would be four lines with arrays and
is fifteen as written.

## Writes never mutate

`setpath` returns a new document sharing every untouched subtree with the old
one. Only the nodes along the path are copied.

The alternative — deep-copying per write — would turn `reduce` over a
thousand updates into a thousand full copies of the document. The alternative
to *that* — mutating in place — would mean a query could corrupt its own
input, and `.a = 1` would change the document that `.b` later reads.

## The total order is total on purpose

`compare` orders any two JSON values: `null < false < true < numbers <
strings < arrays < objects`.

A comparison that threw on mixed types would be defensible and useless.
Real documents are full of nulls where a number was expected, and
`sort_by(.price)` has to work on them — it sorts the missing ones to the
front rather than failing halfway through.

Two details that are easy to get wrong:

- **NaN is handled explicitly.** It cannot arrive from parsed JSON but can
  from `0/0` under a `try`, and leaving it to `<` would make the comparison
  non-transitive and silently corrupt any sort it touched.
- **Strings compare by code unit, not by locale.** `localeCompare` would make
  a sort's result depend on the machine it ran on, which is not reproducible.

## Builtins are a flat table

`BUILTINS` maps `name/arity` to a generator. `map/1` and `map/2` are separate
entries, which is how the "not defined with 1 argument, but is with 2" error
is possible.

Most builtins are a function of their input, so `builtins/define.js` wraps
the three common shapes — `simple`, `valued`, `streaming` — and each builtin's
own file says what it computes rather than how it is plumbed in. `valued` also
handles the cross product over multi-output arguments once, so no individual
builtin has to think about it.

### Two cycles, closed by setters

`eval.js` owns the builtin table and `collectPaths`. Two builtin modules need
to read them — `builtins` lists the table, `path` and `del` call
`collectPaths` — and importing `eval.js` at the top of a builtin module would
be a cycle.

`index.js` registers everything and then hands those two values over through
`setBuiltinTable` and `setPathCollector`. Mutable boxes rather than imports,
which is not elegant but is honest about the ordering, and it is confined to
the one module whose job is wiring.

## The CLI returns an exit code

`run(argv, io)` takes its streams and returns a number. `bin/lens.js` is the
only file that knows about the real process.

That is what lets every flag be tested in-process — 40-odd CLI tests with no
subprocess — and it means a test can assert on stdout, stderr and the exit
code together. Those are three separate promises and any of them can be
broken alone.

Exit codes are distinguished because a script may care which failure it got:

| Code | Meaning |
| --- | --- |
| 0 | success |
| 1 | `-e` and the last output was `false` or `null` |
| 2 | misuse: a bad flag, a missing file, unparseable input |
| 3 | the query would not parse |
| 4 | `-e` and there was no output at all |
| 5 | the query failed at runtime |

## Output formatting is hand-written

`JSON.stringify` does most of this. It does not do two things that matter at a
terminal: colour, and keeping a scalar array on one line.

```
{                          {
  "point": [               "point": [1, 2]
    1,                   }
    2
  ]
}
JSON.stringify            format(..., {pretty: true})
```

A document of short coordinate pairs is unreadable at one element per line and
fits on a screen at one array per line.

The width threshold is a fixed 72 characters rather than the terminal's width.
Output that changes shape depending on where it is going cannot be diffed.

## Why no dependencies

A query library gets embedded in other people's tools, and every dependency it
carries becomes a version conflict in their build.

It is not free, and the cost is concentrated in two places:

- **No JUnit equivalent is needed** — Node has `node:test` built in, so the
  test suite costs nothing. This was luck rather than planning.
- **The linter is hand-written.** `tools/lint.js` is 120 lines doing a small
  fraction of what ESLint does. It exists mainly to check the no-dependency
  promise itself, since a promise with nothing enforcing it gets broken by
  accident.

The regex engine is the exception that proves the rule: `RegExp` comes from
the host. Writing one would have been a larger project than this one.

## What is deliberately missing

- **Destructuring patterns.** `. as [$a, $b]` is refused by name. Supporting
  it means a pattern language inside the binding form, and half of that is
  worse than none.
- **Modules.** `import` and `include` lex and go nowhere.
- **`input` and `inputs`.** The evaluator has no notion of an input stream;
  the CLI owns input. Adding them would put the file system behind a filter.
- **Date functions.** `now`, `strftime` and friends. Omitted rather than
  half-done, because time zones make the half-done version actively wrong.
- **A path optimiser.** `collectPaths` walks the target expression for every
  assignment, re-evaluating index expressions each time. Fine for a handful
  of paths and quadratic for `.[] |= f` over a large array.

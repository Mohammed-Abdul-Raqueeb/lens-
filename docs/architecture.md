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


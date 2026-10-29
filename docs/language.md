# The language

Lens is a filter language. A program takes one JSON value and produces a
stream of zero or more values. That is the whole model, and almost everything
else follows from it.

## Everything is a stream

```bash
$ lens -n '1, 2, 3'          # three outputs
1
2
3
$ lens -n 'empty'            # no outputs
$ lens -n '[1, 2, 3] | .[]'  # three outputs again
1
2
3
```

A filter producing nothing is not an error, and a filter producing several
values is not a list. The distinction matters at every operator:

| Expression | Outputs | Why |
| --- | --- | --- |
| `[.[]]` | 1 (an array) | `[...]` collects a stream |
| `.[]` | one per element | iteration *is* the stream |
| `(1,2) + 10` | 2 | the operator runs per combination |
| `{a: (1,2)}` | 2 objects | so does object construction |

That last one surprises people. `{a: (1,2)}` is `{"a":1}` and `{"a":2}`, not
one object with two values — because an object cannot hold a stream.

## Paths

```
.                 the input
.foo              a field
.foo.bar          nested
."odd-name"       a field whose name is not an identifier
.["computed"]     the same, with an expression
.[0]  .[-1]       an array element, counting from either end
.[2:5]  .[:3]     a slice
.[]               every element, or every value of an object
..                the input and everything inside it, depth first
```

Three choices here are deliberate and worth knowing:

**A missing field is `null`, not an error.** `.a.b.c` on `{}` is `null`.
Without this, every query against a document with optional fields would need
a guard, and the common case would be the awkward one.

**A field of a non-object *is* an error.** `.a` on `42` fails, because it
almost always means the query and the data disagree about shape. Add `?` to
get nothing instead: `.a?`.

**An out-of-range index is `null`.** `.[9]` on a three-element array is
`null`, which is what makes `.[9] // "default"` work.

## Operators

```
|       pipe: feed each output of the left into the right
,       concatenate two output streams
//      alternative: the left, unless it yields nothing, false or null
+ - * / %    arithmetic, overloaded by type
== != < <= > >=   comparison, over a total order
and or not   logic, short-circuiting
?       suppress errors from what precedes it
=  |=  += -= *= /= %= //=   assignment and update
```

### Arithmetic is overloaded, and that is the point

| Expression | Result |
| --- | --- |
| `1 + 2` | `3` |
| `"a" + "b"` | `"ab"` |
| `[1] + [2]` | `[1,2]` |
| `{a:1} + {b:2}` | `{"a":1,"b":2}` (shallow, right wins) |
| `{a:{b:1}} * {a:{c:2}}` | `{"a":{"b":1,"c":2}}` (deep merge) |
| `"ab" * 2` | `"abab"` |
| `"a,b" / ","` | `["a","b"]` |
| `[1,2,3] - [2]` | `[1,3]` |

`null` is the identity for `+` on both sides, which is why
`reduce .[] as $x (null; . + $x)` works without knowing the element type
first.

`+` merges objects shallowly and `*` merges them deeply. Both exist because
both are wanted: one replaces a subtree, the other merges into it.

### Division by zero is an error

Not `Infinity`. Infinity has no JSON representation, so it would fail at
output time instead — a long way from the division that caused it.

### Comparison is total

```
null < false < true < numbers < strings < arrays < objects
```

Any two values can be compared, which is what makes `sort` work on a real
document. `sort_by(.optional)` sorts the missing ones to the front rather
than failing.

### Only `false` and `null` are falsy

Zero, the empty string and the empty array are all **true**. This surprises
people arriving from JavaScript and is the right choice here: `if .count then`
should fire for a count of zero, because the question being asked is whether
the field is there.

## Conditionals

```
if .a then "yes" else "no" end
if .a then "yes" elif .b then "maybe" else "no" end
if .a then "yes" end            # no else: passes the input through
```

An `if` with no `else` yields its input unchanged, so it is a conditional
*transform* rather than a filter that drops everything failing the test.

## Errors

```
try .a catch "failed"       # the handler gets the error message
try .a                      # swallow it, yielding nothing
.a?                         # the same, as a suffix
.a // "default"             # also catches errors on the left
```

`?` keeps the outputs produced before the failure:
`[.[] | .a?]` over `[{"a":1}, "bad", {"a":2}]` is `[1,2]`.

## Variables and functions

```
.a as $x | $x + 1                       # bind
reduce .[] as $x (0; . + $x)            # fold
foreach .[] as $x (0; . + $x)           # fold, emitting each step
def double: . * 2; map(double)          # define
def add($n): . + $n; add(3)             # a value parameter
def apply(f): f; apply(.a + 1)          # a filter parameter
```

The two parameter kinds differ in when they are evaluated. `$n` is evaluated
once, in the caller. `f` is a closure re-evaluated at each use, which is what
makes `map(.x)` work.

`$ENV` holds the process environment and `$ARGS` holds the command line's
`--arg` values and positional arguments.

## Assignment

```
.a = 1          set
.a |= . + 1     update with a filter
.a += 1         shorthand for the arithmetic operators
.a //= "d"      set only if currently false or null
del(.a)         remove
.a |= empty     also remove
```

The left side must be a *path expression* — something built from `.field`,
`.[i]`, `.[]`, `..`, pipes, commas, `select`, `first` and `getpath`. Anything
else is refused at runtime, because `(1 + 1) = 3` has no meaning and the error
should say so rather than failing somewhere inside the assignment.

Assignment never mutates the input. Only the path is copied, so updating one
field of a large document does not copy the whole thing.

## Strings

```
"plain"
"interpolated: \(.a + 1)"
@base64                    apply a format to the input
@uri "?q=\(.term)"         apply it to the interpolated parts only
```

The second form is the useful one: `@uri "?q=\(.term)"` escapes the term but
not the `?` or the `=`.

Formats: `@text`, `@json`, `@csv`, `@tsv`, `@html`, `@uri`, `@sh`, `@base64`,
`@base64d`.

A string interpolates as itself rather than as JSON, so `"hi \(.name)"` does
not put quotes around the name.

## Regular expressions

`test`, `match`, `capture`, `scan`, `splits`, `sub` and `gsub` take a pattern
and optional flags. Flags: `g` global, `i` case-insensitive, `x` extended
(whitespace and `#` comments ignored), `s`/`m` dot matches newline, `n`
ignore empty matches.

```bash
$ lens -rn '"a1b22" | [scan("[0-9]+")]'
["1","22"]
$ lens -rn '"a1b2" | gsub("(?<d>[0-9])"; "[\(.d)]")'
a[1]b[2]
```

A substitution's replacement is a *filter*, not a string, and it runs with the
named captures as its input. That is why the second example can refer to
`.d`.

The engine is JavaScript's own `RegExp`. It is the one place this project
leans on the host for something substantial — writing a regex engine would be
a larger project than the query language around it.

## Limits

| Limit | Value | Why |
| --- | --- | --- |
| Nesting depth | 200 | The parser recurses and the query is user input |
| `until`/`while`/`repeat` steps | 1,000,000 | An unbounded loop is indistinguishable from a hang |
| `range` step | non-zero | A zero step would never advance |

## Differences from jq

Queries copied from jq mostly work. These do not:

- **No destructuring.** `. as [$a, $b]` and `. as {$x}` are refused by name
  rather than silently misparsed.
- **No modules.** `import` and `include` lex but do not run.
- **No `$__loc__`, `input`, `inputs`, `debug`, `input_line_number`.** All need
  a notion of the input stream that the library deliberately does not have —
  the CLI owns input, not the evaluator.
- **No date functions.** `now`, `strftime`, `mktime` and the rest are absent.
- **No `limit` with a negative count**, and `nth` refuses a negative index
  rather than counting from the end.
- **`def f($a)` takes exactly one value.** jq binds each output of the
  argument in turn; here more than one is an error, which is reported rather
  than silently using the first.

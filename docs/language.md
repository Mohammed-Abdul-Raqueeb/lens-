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


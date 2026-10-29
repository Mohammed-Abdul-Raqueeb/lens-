# Builtins

Every function, grouped by what it is for. `name/n` means the form taking
`n` arguments; several names have more than one.

Run `lens --builtins` for the authoritative list from the binary itself.

## Shape and type

| Function | What it does |
| --- | --- |
| `length` | Elements, keys, characters, or a number's absolute value. `null` is 0 |
| `utf8bytelength` | A string's length in bytes rather than characters |
| `keys` | An object's keys, **sorted**, or an array's indices |
| `keys_unsorted` | The same, in insertion order |
| `values` | Drops `null`, keeps everything else |
| `has(k)` | Whether a key or index is present |
| `in(c)` | `has` with the operands swapped, for `.[] \| in($set)` |
| `type` | `"null"`, `"boolean"`, `"number"`, `"string"`, `"array"`, `"object"` |
| `arrays`, `objects`, `iterables`, `booleans`, `numbers`, `strings`, `nulls`, `scalars` | Keep only values of that kind |

`length` is overloaded because one question — "how big is this?" — has a
sensible answer for every type. Per-type builtins would mean
`if type == "array" then … end` in front of half the queries that use it.

## Control

| Function | What it does |
| --- | --- |
| `empty` | Yields nothing. The identity of `,` |
| `error`, `error(m)` | Raises its input, or `m`, as an error |
| `not` | Inverts truthiness |
| `select(f)` | Keeps the input when `f` is truthy |
| `isvalid(f)` | Whether `f` would run without failing |
| `recurse(f)` | The input, then `f` applied over and over |
| `recurse(f; cond)` | The same, stopping where `cond` is false |
| `until(cond; f)` | Applies `f` until `cond` holds |
| `while(cond; f)` | The values for which `cond` holds |
| `repeat(f)` | `f` forever. Needs a `limit` or an error to stop |
| `range(n)`, `range(a;b)`, `range(a;b;step)` | Counts, up or down |

The three loops stop after a million steps and report it. An unbounded loop
produces no output and never returns, which is indistinguishable from a hang.

## Mapping

| Function | What it does |
| --- | --- |
| `map(f)` | `f` over each element, collected into an array |
| `map_values(f)` | `f` over each value, keeping the container's shape |
| `walk(f)` | `f` over every value, children first |
| `with_entries(f)` | `to_entries`, `map(f)`, `from_entries` |

`map` and `map_values` differ in two ways that both matter: an object stays an
object, and a value for which `f` yields nothing is **removed** rather than
dropped from a flattened array.

`walk` transforms children before their container, so a filter that counts its
children sees the transformed subtree rather than the original.

## Arrays

| Function | What it does |
| --- | --- |
| `sort`, `sort_by(f)` | Ascending by the total order. **Stable** |
| `group_by(f)` | Groups equal keys, after sorting by them |
| `unique`, `unique_by(f)` | Deduplicates; `_by` keeps the first of each group |
| `reverse` | Arrays and strings; `null` becomes `[]` |
| `min`, `max`, `min_by(f)`, `max_by(f)` | `null` for an empty array |
| `add` | Folds with the overloaded `+` |
| `any`, `all`, `any(f)`, `all(f)` | Short-circuiting |
| `flatten`, `flatten(depth)` | All the way, or that many levels |
| `first`, `last`, `first(f)`, `last(f)` | |
| `nth(i)`, `nth(i; f)` | |
| `limit(n; f)` | At most `n` outputs, stopping early |
| `indices(x)`, `index(x)`, `rindex(x)` | Element, substring or subsequence |
| `combinations` | One element from each of several arrays |
| `transpose` | Rows to columns, padding short rows with `null` |

**`sort_by` is stable, and that is a promise.** Sorting by one field and then
another is how multi-level ordering is expressed, and it only works if each
sort preserves the previous order for equal keys.

**`any` of nothing is `false` and `all` of nothing is `true`.** The second
surprises people. It is the only answer that keeps
`all(f) and all(g) == all(f and g)` true when the input is empty.

**`min` and `max` of an empty array are `null`**, not an error, so a report
query over an empty list does not fail.

**`first(f)` stops the generator.** `first(range(1000000))` touches one value.
`[range(1000000)] | .[0]` touches a million.

## Objects and paths

| Function | What it does |
| --- | --- |
| `to_entries` | `[{key, value}, …]`, in insertion order |
| `from_entries` | The inverse. Accepts `key`/`k`/`name` and `value`/`v` |
| `paths`, `paths(f)`, `leaf_paths` | Every path, or only matching ones |
| `getpath(p)` | The value at a path, or `null` |
| `setpath(p; v)` | A copy with `v` at `p`, creating containers as needed |
| `delpaths(ps)` | A copy with those paths removed |
| `del(pathexpr)` | The same, from a path expression |
| `path(pathexpr)` | The paths an expression addresses |
| `tostream`, `fromstream(f)` | A document as path/value events, and back |
| `clone` | A deep copy |

`from_entries` is deliberately forgiving: entry lists arrive from several
places, and refusing the shapes jq accepts would break queries copied across.
A bare scalar becomes a key with a `null` value, which makes
`["a","b"] | from_entries` a set.

**`delpaths` sorts and applies in descending order.** That is a correctness
requirement, not tidiness: deleting `[0]` then `[1]` one at a time removes the
first and *third* elements, because the first delete shifts the array.

## Strings

| Function | What it does |
| --- | --- |
| `tostring` | A string stays itself; everything else becomes JSON |
| `tojson`, `fromjson` | Always JSON, including quotes on strings |
| `tonumber` | From a number or a numeric string |
| `ascii_downcase`, `ascii_upcase` | **ASCII only**, on purpose |
| `ascii` | A code point to a character |
| `explode`, `implode` | To and from code points |
| `split(sep)`, `split(re; flags)` | Literal, or by regex |
| `join(sep)` | Scalars only; containers are an error |
| `ltrimstr`, `rtrimstr`, `trimstr` | Pass non-strings through unchanged |
| `ltrim`, `rtrim`, `trim` | Whitespace; a non-string is an error |
| `startswith`, `endswith` | |
| `contains(x)`, `inside(c)` | Substring, subset or submap |

**Case conversion is ASCII-only** because `toLowerCase` is locale-sensitive —
Turkish dotless `i` is the usual example — and a query whose result depends on
the machine's locale is not reproducible.

**`tonumber` refuses the empty string.** `Number("")` is `0`, which is a
silent wrong answer in exactly the case a CSV import produces.

**`ltrimstr` passes non-strings through** rather than erroring, which makes
`.[] | ltrimstr("v")` safe over a mixed array. `trim` does error, because
there is no sensible non-string reading of it.

## Regular expressions

| Function | What it does |
| --- | --- |
| `test(re)`, `test(re; flags)` | Whether it matches |
| `match(re)`, `match(re; flags)` | Offsets, lengths and captures |
| `capture(re)` | Named groups as an object |
| `scan(re)` | Whole matches, or the groups when there are groups |
| `splits(re)` | Split, as a stream |
| `sub(re; f)`, `gsub(re; f)` | Replace the first, or all |

Flags: `g` global, `i` case-insensitive, `x` extended, `s`/`m` dot matches
newline, `n` ignore empty matches, `p` both.

**A substitution's replacement is a filter**, running with the named captures
as its input:

```bash
$ lens -rn '"a1b2" | gsub("(?<d>[0-9])"; "[\(.d)]")'
a[1]b[2]
```

## Numbers

`floor`, `ceil`, `round`, `fabs`, `abs`, `sqrt`, `pow(a;b)`, `log`, `log2`,
`log10`, `exp`, `exp2`, `exp10`, `isnan`, `isinfinite`, `isnormal`.

`sqrt` of a negative number is an error rather than `NaN`, because `NaN` has
no JSON form and would fail at output time instead — a long way from the call
that produced it.

## Formats

`@text`, `@json`, `@csv`, `@tsv`, `@html`, `@uri`, `@sh`, `@base64`,
`@base64d`.

Applied to an interpolated string, a format applies to the **interpolated
parts only**:

```bash
$ lens -rn '{"term":"a b"} | @uri "?q=\(.term)"'
?q=a%20b
```

The `?` and `=` are left alone, which is the entire point of the form.

`@tsv` escapes tabs and newlines rather than quoting, because TSV has no
quoting — a raw tab in a cell would silently become a new column.

## Environment

`env` is the process environment as an object; `$ENV` is the same thing as a
variable. `builtins` lists every registered function.

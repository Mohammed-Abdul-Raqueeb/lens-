/**
 * The shapes a parsed program can take.
 *
 * Plain objects with a `type` tag rather than a class hierarchy. The
 * evaluator is one switch over that tag, and classes would spread it across
 * twenty files for no gain -- the nodes have no behaviour, only structure.
 *
 * Every node carries `offset`, the position of the token that began it, so a
 * runtime error can point into the query the same way a parse error does.
 */

/** Node type tags. */
export const Node = {
  IDENTITY: 'Identity',
  RECURSE: 'Recurse',
  FIELD: 'Field',
  INDEX: 'Index',
  SLICE: 'Slice',
  ITERATE: 'Iterate',
  PIPE: 'Pipe',
  COMMA: 'Comma',
  LITERAL: 'Literal',
  ARRAY: 'Array',
  OBJECT: 'Object',
  NEGATE: 'Negate',
  BINARY: 'Binary',
  AND: 'And',
  OR: 'Or',
  NOT: 'Not',
  ALTERNATIVE: 'Alternative',
  OPTIONAL: 'Optional',
  CALL: 'Call',
  IF: 'If',
  TRY: 'Try',
  REDUCE: 'Reduce',
  FOREACH: 'Foreach',
  BIND: 'Bind',
  VARIABLE: 'Variable',
  FUNCDEF: 'FuncDef',
  FORMAT: 'Format',
  INTERPOLATE: 'Interpolate',
  ASSIGN: 'Assign',
  UPDATE: 'Update',
};

/** `.` — yields its input unchanged. */
export const identity = (offset = -1) => ({ type: Node.IDENTITY, offset });

/** `..` — yields the input and every value within it. */
export const recurse = (offset = -1) => ({ type: Node.RECURSE, offset });

/** `.name` — a field of an object. */
export const field = (name, optional = false, offset = -1) =>
  ({ type: Node.FIELD, name, optional, offset });

/** `.[expr]` — an index of an array, or a key of an object. */
export const index = (indexExpr, optional = false, offset = -1) =>
  ({ type: Node.INDEX, index: indexExpr, optional, offset });

/** `.[a:b]` — a slice of an array or string. Either bound may be null. */
export const slice = (from, to, optional = false, offset = -1) =>
  ({ type: Node.SLICE, from, to, optional, offset });

/** `.[]` — every element of an array, or every value of an object. */
export const iterate = (optional = false, offset = -1) =>
  ({ type: Node.ITERATE, optional, offset });

/** `a | b` — feeds each output of `a` into `b`. */
export const pipe = (left, right, offset = -1) =>
  ({ type: Node.PIPE, left, right, offset });

/** `a, b` — yields everything `a` yields, then everything `b` yields. */
export const comma = (left, right, offset = -1) =>
  ({ type: Node.COMMA, left, right, offset });

/** A constant: a number, string, boolean or null. */
export const literal = (value, offset = -1) =>
  ({ type: Node.LITERAL, value, offset });

/** `[expr]` — collects everything `expr` yields into an array. */
export const array = (body, offset = -1) =>
  ({ type: Node.ARRAY, body, offset });

/**
 * `{a: b, ...}` — builds an object.
 *
 * Entries are `{key, value}` where both are expressions, because a key can be
 * computed: `{(.name): .value}` is legal and common.
 */
export const object = (entries, offset = -1) =>
  ({ type: Node.OBJECT, entries, offset });

/** `-expr` */
export const negate = (body, offset = -1) =>
  ({ type: Node.NEGATE, body, offset });

/** `a + b`, `a == b`, and the rest of the two-sided operators. */
export const binary = (op, left, right, offset = -1) =>
  ({ type: Node.BINARY, op, left, right, offset });

/** `a and b` — short-circuits, which is why it is not a Binary. */
export const and = (left, right, offset = -1) =>
  ({ type: Node.AND, left, right, offset });

/** `a or b` — short-circuits. */
export const or = (left, right, offset = -1) =>
  ({ type: Node.OR, left, right, offset });

/** `not` — a builtin in jq, a node here so it can be a prefix keyword. */
export const not = (offset = -1) => ({ type: Node.NOT, offset });

/** `a // b` — `a` unless it yields nothing or only false/null. */
export const alternative = (left, right, offset = -1) =>
  ({ type: Node.ALTERNATIVE, left, right, offset });

/** `expr?` — suppresses errors from `expr`, yielding nothing instead. */
export const optional = (body, offset = -1) =>
  ({ type: Node.OPTIONAL, body, offset });

/** `name` or `name(args)` — a builtin or user-defined function. */
export const call = (name, args = [], offset = -1) =>
  ({ type: Node.CALL, name, args, offset });

/** `if c then a elif c2 then b else c end` */
export const ifThen = (cond, then, elseBody, offset = -1) =>
  ({ type: Node.IF, cond, then, else: elseBody, offset });

/** `try a catch b` */
export const tryCatch = (body, handler, offset = -1) =>
  ({ type: Node.TRY, body, handler, offset });

/** `reduce source as $x (init; update)` */
export const reduce = (source, pattern, init, update, offset = -1) =>
  ({ type: Node.REDUCE, source, pattern, init, update, offset });

/** `foreach source as $x (init; update; extract)` */
export const foreach = (source, pattern, init, update, extract, offset = -1) =>
  ({ type: Node.FOREACH, source, pattern, init, update, extract, offset });

/** `source as $x | body` */
export const bind = (source, pattern, body, offset = -1) =>
  ({ type: Node.BIND, source, pattern, body, offset });

/** `$name` */
export const variable = (name, offset = -1) =>
  ({ type: Node.VARIABLE, name, offset });

/** `def name(params): body; rest` */
export const funcDef = (name, params, body, rest, offset = -1) =>
  ({ type: Node.FUNCDEF, name, params, body, rest, offset });

/** `@base64`, and `@text "..."` when applied to a string. */
export const format = (name, body = null, offset = -1) =>
  ({ type: Node.FORMAT, name, body, offset });

/** `"a\(expr)b"` — parts are strings and expressions, in order. */
export const interpolate = (parts, offset = -1) =>
  ({ type: Node.INTERPOLATE, parts, offset });

/** `path = value` */
export const assign = (target, value, offset = -1) =>
  ({ type: Node.ASSIGN, target, value, offset });

/** `path |= f`, `path += f`, and the other update operators. */
export const update = (op, target, value, offset = -1) =>
  ({ type: Node.UPDATE, op, target, value, offset });

/**
 * Walks a tree, calling `visit` on every node.
 *
 * Used by the optimiser and by `tools/lint.js`. Written iteratively with an
 * explicit stack rather than recursively: a query is user input, and a deeply
 * nested one would otherwise blow the stack inside a tool whose job is to
 * report problems with it.
 *
 * @param {object} node the root
 * @param {(node: object) => void} visit called for each node, parents first
 */
export function walk(node, visit) {
  const stack = [node];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== 'object') continue;
    visit(current);

    for (const key of Object.keys(current)) {
      if (key === 'type' || key === 'offset') continue;
      const child = current[key];
      if (Array.isArray(child)) {
        for (const element of child) stack.push(element);
      } else if (child && typeof child === 'object') {
        stack.push(child);
      }
    }
  }
}

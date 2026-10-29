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


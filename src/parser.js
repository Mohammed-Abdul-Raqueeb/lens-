/**
 * Turns tokens into a tree.
 *
 * Recursive descent with one function per precedence level, loosest first.
 * The alternative -- a precedence-climbing loop with a table -- is shorter but
 * handles the language's non-associative levels badly: `a == b == c` and
 * `a = b = c` are both errors rather than either association, and a table
 * wants to pick one.
 */

import * as A from './ast.js';
import { ParseError } from './errors.js';
import { TokenKind, tokenize } from './lexer.js';

/**
 * Operators that may not chain.
 *
 * `a < b < c` reads as a range to anyone coming from mathematics and means
 * `(a < b) < c` in most languages, which is almost never what was meant. jq
 * refuses it, and so does this.
 */
const NON_ASSOCIATIVE = new Set(['==', '!=', '<', '<=', '>', '>=']);

/** The assignment and update operators. */
const UPDATE_OPS = new Set(['=', '|=', '+=', '-=', '*=', '/=', '%=', '//=']);

/**
 * Parses a query.
 *
 * @param {string} source the query text
 * @returns {object} the root AST node
 * @throws {ParseError} when the tokens do not form a valid program
 */
export function parse(source) {
  const parser = new Parser(source);
  const program = parser.parseProgram();
  return program;
}

class Parser {
  /** @param {string} source the query text */
  constructor(source) {
    this.source = source;
    this.tokens = tokenize(source);
    this.at = 0;
    // Bounded because the parser is recursive and the query is user input; a
    // thousand open brackets would otherwise be a RangeError from the engine
    // rather than a message naming the problem.
    this.depth = 0;
  }

  get current() {
    return this.tokens[this.at];
  }

  peek(ahead = 0) {
    return this.tokens[Math.min(this.at + ahead, this.tokens.length - 1)];
  }

  advance() {
    return this.tokens[this.at++];
  }

  fail(message, token = this.current) {
    throw new ParseError(message, { offset: token.offset, source: this.source });
  }

  expectOp(text) {
    if (!this.current.isOp(text)) {
      this.fail(`expected '${text}' but found ${this.current.describe()}`);
    }
    return this.advance();
  }

  expectKeyword(text) {
    if (!this.current.isKeyword(text)) {
      this.fail(`expected '${text}' but found ${this.current.describe()}`);
    }
    return this.advance();
  }

  parseProgram() {
    if (this.current.kind === TokenKind.EOF) {
      this.fail('the query is empty');
    }
    const body = this.parsePipe();
    if (this.current.kind !== TokenKind.EOF) {
      this.fail(`unexpected ${this.current.describe()} after the end of the query`);
    }
    return body;
  }

  /** The loosest level: `a | b`, and `def` which scopes over everything after it. */
  parsePipe() {
    this.enter();
    try {
      // `def` is handled here rather than as a statement because its body
      // extends to the end of the enclosing pipeline: in `def f: 1; f + f`,
      // the `rest` is `f + f`.
      if (this.current.isKeyword('def')) {
        return this.parseFuncDef();
      }

      let left = this.parseComma();

      // `X as $y | body` binds for the rest of the pipeline, so it is parsed
      // here where the `|` is in reach.
      if (this.current.isKeyword('as')) {
        const offset = this.current.offset;
        this.advance();
        const pattern = this.parsePattern();
        this.expectOp('|');
        const body = this.parsePipe();
        return A.bind(left, pattern, body, offset);
      }

      while (this.current.isOp('|')) {
        const offset = this.advance().offset;
        if (this.current.isKeyword('def')) {
          left = A.pipe(left, this.parseFuncDef(), offset);
          continue;
        }
        const right = this.parseComma();
        if (this.current.isKeyword('as')) {
          const asOffset = this.current.offset;
          this.advance();
          const pattern = this.parsePattern();
          this.expectOp('|');
          const body = this.parsePipe();
          left = A.pipe(left, A.bind(right, pattern, body, asOffset), offset);
          continue;
        }
        left = A.pipe(left, right, offset);
      }
      return left;
    } finally {
      this.leave();
    }
  }

  parseFuncDef() {
    const offset = this.expectKeyword('def').offset;
    if (this.current.kind !== TokenKind.IDENT) {
      this.fail(`expected a function name but found ${this.current.describe()}`);
    }
    const name = this.advance().value;

    const params = [];
    if (this.current.isOp('(')) {
      this.advance();
      while (true) {
        if (this.current.kind === TokenKind.IDENT) {
          params.push({ name: this.advance().value, isValue: false });
        } else if (this.current.kind === TokenKind.VARIABLE) {
          // `def f($x): ...` takes its argument by value rather than as a
          // filter, which matters when the argument has side effects or is
          // expensive -- a filter parameter is re-evaluated at each use.
          params.push({ name: this.advance().value, isValue: true });
        } else {
          this.fail(`expected a parameter name but found ${this.current.describe()}`);
        }
        if (this.current.isOp(';')) {
          this.advance();
          continue;
        }
        break;
      }
      this.expectOp(')');
    }

    this.expectOp(':');
    const body = this.parsePipe();
    this.expectOp(';');

    // Everything after the `;` is in scope of the definition.
    const rest = this.current.kind === TokenKind.EOF
      ? A.identity(offset)
      : this.parsePipe();

    return A.funcDef(name, params, body, rest, offset);
  }

  parsePattern() {
    if (this.current.kind === TokenKind.VARIABLE) {
      const token = this.advance();
      return { type: 'variable', name: token.value, offset: token.offset };
    }
    // Destructuring patterns (`. as [$a, $b]`) are not supported, and saying
    // so by name beats "unexpected token".
    this.fail(
      `expected a variable like $name after 'as' but found ${this.current.describe()}`
        + '; destructuring patterns are not supported',
    );
    return null;
  }

  parseComma() {
    let left = this.parseAlternative();
    while (this.current.isOp(',')) {
      const offset = this.advance().offset;
      left = A.comma(left, this.parseAlternative(), offset);
    }
    return left;
  }

  parseAlternative() {
    let left = this.parseAssignment();
    while (this.current.isOp('//')) {
      const offset = this.advance().offset;
      left = A.alternative(left, this.parseAssignment(), offset);
    }
    return left;
  }

  parseAssignment() {
    const left = this.parseOr();
    const token = this.current;
    if (token.kind === TokenKind.OP && UPDATE_OPS.has(token.value)) {
      this.advance();
      const right = this.parseOr();
      if (this.current.kind === TokenKind.OP && UPDATE_OPS.has(this.current.value)) {
        this.fail('assignment does not chain; parenthesise one side');
      }
      return token.value === '='
        ? A.assign(left, right, token.offset)
        : A.update(token.value, left, right, token.offset);
    }
    return left;
  }

  parseOr() {
    let left = this.parseAnd();
    while (this.current.isKeyword('or')) {
      const offset = this.advance().offset;
      left = A.or(left, this.parseAnd(), offset);
    }
    return left;
  }

  parseAnd() {
    let left = this.parseComparison();
    while (this.current.isKeyword('and')) {
      const offset = this.advance().offset;
      left = A.and(left, this.parseComparison(), offset);
    }
    return left;
  }

  parseComparison() {
    const left = this.parseAdditive();
    const token = this.current;
    if (token.kind === TokenKind.OP && NON_ASSOCIATIVE.has(token.value)) {
      this.advance();
      const right = this.parseAdditive();
      if (this.current.kind === TokenKind.OP && NON_ASSOCIATIVE.has(this.current.value)) {
        this.fail(
          `'${this.current.value}' cannot be chained after '${token.value}';`
            + ' parenthesise one comparison',
        );
      }
      return A.binary(token.value, left, right, token.offset);
    }
    return left;
  }

  parseAdditive() {
    let left = this.parseMultiplicative();
    while (this.current.isOp('+') || this.current.isOp('-')) {
      const token = this.advance();
      left = A.binary(token.value, left, this.parseMultiplicative(), token.offset);
    }
    return left;
  }

  parseMultiplicative() {
    let left = this.parseUnary();
    while (this.current.isOp('*') || this.current.isOp('/') || this.current.isOp('%')) {
      const token = this.advance();
      left = A.binary(token.value, left, this.parseUnary(), token.offset);
    }
    return left;
  }

  parseUnary() {
    if (this.current.isOp('-')) {
      const offset = this.advance().offset;
      return A.negate(this.parseUnary(), offset);
    }
    return this.parsePostfix();
  }

  /**
   * Suffixes: `.foo`, `[0]`, `[]`, `[a:b]`, `?`.
   *
   * Looped rather than recursed so `.a[0].b[]?` reads left to right, which is
   * also the order it is evaluated in.
   */
  parsePostfix() {
    let node = this.parsePrimary();

    while (true) {
      const token = this.current;

      if (token.kind === TokenKind.FIELD) {
        this.advance();
        node = A.pipe(node, A.field(token.value, false, token.offset), token.offset);
        continue;
      }

      // `.[...]` after an expression: the dot is optional, so both `.a[0]`
      // and `.a.[0]` work.
      if (token.isOp('.') && this.peek(1).isOp('[')) {
        this.advance();
        continue;
      }

      if (token.isOp('[')) {
        this.advance();
        node = A.pipe(node, this.parseBracketSuffix(token.offset), token.offset);
        continue;
      }

      if (token.isOp('?')) {
        this.advance();
        node = A.optional(node, token.offset);
        continue;
      }

      // A string immediately after a field, as in `.["a"]`, is handled by the
      // bracket branch; a bare string here would be two expressions with no
      // operator between them.
      break;
    }

    return node;
  }

  /** The inside of a `[...]` suffix: empty, an index, or a slice. */
  parseBracketSuffix(offset) {
    if (this.current.isOp(']')) {
      this.advance();
      return A.iterate(false, offset);
    }

    // `[:n]` -- a slice with no lower bound.
    if (this.current.isOp(':')) {
      this.advance();
      const to = this.parsePipe();
      this.expectOp(']');
      return A.slice(null, to, false, offset);
    }

    const first = this.parsePipe();

    if (this.current.isOp(':')) {
      this.advance();
      if (this.current.isOp(']')) {
        this.advance();
        return A.slice(first, null, false, offset);
      }
      const to = this.parsePipe();
      this.expectOp(']');
      return A.slice(first, to, false, offset);
    }

    this.expectOp(']');
    return A.index(first, false, offset);
  }

  parsePrimary() {
    const token = this.current;

    switch (token.kind) {
      case TokenKind.NUMBER:
        this.advance();
        return A.literal(token.value, token.offset);

      case TokenKind.STRING:
        this.advance();
        return this.stringNode(token);

      case TokenKind.VARIABLE:
        this.advance();
        return A.variable(token.value, token.offset);

      case TokenKind.FIELD:
        this.advance();
        return A.field(token.value, false, token.offset);

      case TokenKind.FORMAT: {
        this.advance();
        // `@base64 "..."` applies the format to an interpolated string;
        // `@base64` alone applies it to the input.
        if (this.current.kind === TokenKind.STRING) {
          const stringToken = this.advance();
          return A.format(token.value, this.stringNode(stringToken), token.offset);
        }
        return A.format(token.value, null, token.offset);
      }

      case TokenKind.IDENT:
        return this.parseCall();

      case TokenKind.KEYWORD:
        return this.parseKeyword();

      case TokenKind.OP:
        return this.parseOperatorPrimary();

      default:
        this.fail(`unexpected ${token.describe()}`);
        return null;
    }
  }

  stringNode(token) {
    if (typeof token.value === 'string') {
      return A.literal(token.value, token.offset);
    }
    // An interpolated string: each expression part is parsed here, with its
    // own parser, because the lexer deliberately left it as text.
    const parts = token.value.interpolate.map((part) => {
      if (typeof part === 'string') return A.literal(part, token.offset);
      return parse(part.expr);
    });
    return A.interpolate(parts, token.offset);
  }

  parseCall() {
    const token = this.advance();
    const name = token.value;

    // `true`, `false` and `null` lex as identifiers because they are not
    // syntax anywhere else, and are turned into literals here.
    if (name === 'true') return A.literal(true, token.offset);
    if (name === 'false') return A.literal(false, token.offset);
    if (name === 'null') return A.literal(null, token.offset);

    if (!this.current.isOp('(')) {
      return A.call(name, [], token.offset);
    }

    this.advance();
    const args = [];
    if (!this.current.isOp(')')) {
      while (true) {
        args.push(this.parsePipe());
        if (this.current.isOp(';')) {
          this.advance();
          continue;
        }
        break;
      }
    }
    this.expectOp(')');
    return A.call(name, args, token.offset);
  }

  parseKeyword() {
    const token = this.current;

    switch (token.value) {
      case 'if': return this.parseIf();
      case 'try': return this.parseTry();
      case 'reduce': return this.parseReduce();
      case 'foreach': return this.parseForeach();
      case 'def': return this.parseFuncDef();
      case 'not':
        this.advance();
        return A.not(token.offset);
      default:
        this.fail(
          `'${token.value}' cannot start an expression`
            + (token.value === 'end' || token.value === 'then' || token.value === 'else'
              ? '; it belongs to an if, which may be missing its opening'
              : ''),
        );
        return null;
    }
  }

  parseIf() {
    const offset = this.expectKeyword('if').offset;
    const cond = this.parsePipe();
    this.expectKeyword('then');
    const then = this.parsePipe();

    let elseBody = null;
    if (this.current.isKeyword('elif')) {
      // An elif is sugar for a nested if, and desugaring it here means the
      // evaluator has one case instead of two.
      const elifOffset = this.current.offset;
      this.advance();
      elseBody = this.parseIfTail(elifOffset);
      return A.ifThen(cond, then, elseBody, offset);
    }

    if (this.current.isKeyword('else')) {
      this.advance();
      elseBody = this.parsePipe();
    }
    this.expectKeyword('end');
    return A.ifThen(cond, then, elseBody, offset);
  }

  /** The body of an `elif`, which ends at the same `end` as its parent `if`. */
  parseIfTail(offset) {
    const cond = this.parsePipe();
    this.expectKeyword('then');
    const then = this.parsePipe();

    if (this.current.isKeyword('elif')) {
      const elifOffset = this.current.offset;
      this.advance();
      return A.ifThen(cond, then, this.parseIfTail(elifOffset), offset);
    }
    if (this.current.isKeyword('else')) {
      this.advance();
      const elseBody = this.parsePipe();
      this.expectKeyword('end');
      return A.ifThen(cond, then, elseBody, offset);
    }
    this.expectKeyword('end');
    return A.ifThen(cond, then, null, offset);
  }

  parseTry() {
    const offset = this.expectKeyword('try').offset;
    // Bound tighter than a pipe so `try .a | .b` is `(try .a) | .b`, which is
    // what jq does and what reads correctly: the catch covers the attempt,
    // not everything downstream of it.
    const body = this.parsePostfix();
    let handler = null;
    if (this.current.isKeyword('catch')) {
      this.advance();
      handler = this.parsePostfix();
    }
    return A.tryCatch(body, handler, offset);
  }

  parseReduce() {
    const offset = this.expectKeyword('reduce').offset;
    const source = this.parsePostfix();
    this.expectKeyword('as');
    const pattern = this.parsePattern();
    this.expectOp('(');
    const init = this.parsePipe();
    this.expectOp(';');
    const updateBody = this.parsePipe();
    this.expectOp(')');
    return A.reduce(source, pattern, init, updateBody, offset);
  }

  parseForeach() {
    const offset = this.expectKeyword('foreach').offset;
    const source = this.parsePostfix();
    this.expectKeyword('as');
    const pattern = this.parsePattern();
    this.expectOp('(');
    const init = this.parsePipe();
    this.expectOp(';');
    const updateBody = this.parsePipe();
    let extract = null;
    if (this.current.isOp(';')) {
      this.advance();
      extract = this.parsePipe();
    }
    this.expectOp(')');
    return A.foreach(source, pattern, init, updateBody, extract, offset);
  }

  parseOperatorPrimary() {
    const token = this.current;

    switch (token.value) {
      case '.': {
        this.advance();
        // `.` followed by a string is `."a"`, the quoted form of field access,
        // which is how a field with a space or a dash is reached.
        if (this.current.kind === TokenKind.STRING) {
          const stringToken = this.advance();
          if (typeof stringToken.value !== 'string') {
            this.fail('a field name cannot be interpolated; use .[expr]', stringToken);
          }
          return A.field(stringToken.value, false, token.offset);
        }
        if (this.current.isOp('[')) {
          const bracket = this.advance();
          return this.parseBracketSuffix(bracket.offset);
        }
        return A.identity(token.offset);
      }

      case '..':
        this.advance();
        return A.recurse(token.offset);

      case '(': {
        this.advance();
        const body = this.parsePipe();
        this.expectOp(')');
        return body;
      }

      case '[': {
        this.advance();
        if (this.current.isOp(']')) {
          this.advance();
          return A.array(null, token.offset);
        }
        const body = this.parsePipe();
        this.expectOp(']');
        return A.array(body, token.offset);
      }

      case '{':
        return this.parseObject();

      default:
        this.fail(`'${token.value}' cannot start an expression`);
        return null;
    }
  }

  parseObject() {
    const offset = this.expectOp('{').offset;
    const entries = [];

    if (this.current.isOp('}')) {
      this.advance();
      return A.object(entries, offset);
    }

    while (true) {
      entries.push(this.parseObjectEntry());
      if (this.current.isOp(',')) {
        this.advance();
        // A trailing comma before `}` is accepted, because object literals
        // get edited line by line and the alternative is a parse error on a
        // line nobody touched.
        if (this.current.isOp('}')) break;
        continue;
      }
      break;
    }

    this.expectOp('}');
    return A.object(entries, offset);
  }

  parseObjectEntry() {
    const token = this.current;

    // `{$x}` is shorthand for `{x: $x}`.
    if (token.kind === TokenKind.VARIABLE) {
      this.advance();
      return {
        key: A.literal(token.value, token.offset),
        value: A.variable(token.value, token.offset),
        offset: token.offset,
      };
    }

    let key;
    let shorthandName = null;

    if (token.kind === TokenKind.IDENT || token.kind === TokenKind.KEYWORD) {
      // A keyword is allowed as a key: `{if: 1}` is an object, not a
      // conditional, and refusing it would make a lot of real JSON
      // unqueryable.
      this.advance();
      key = A.literal(token.value, token.offset);
      shorthandName = token.value;
    } else if (token.kind === TokenKind.STRING) {
      this.advance();
      key = this.stringNode(token);
      if (typeof token.value === 'string') shorthandName = token.value;
    } else if (token.isOp('(')) {
      this.advance();
      key = this.parsePipe();
      this.expectOp(')');
    } else if (token.kind === TokenKind.FORMAT) {
      this.advance();
      key = A.format(token.value, null, token.offset);
    } else {
      this.fail(`expected an object key but found ${token.describe()}`);
    }

    if (this.current.isOp(':')) {
      this.advance();
      // Bound tighter than a comma so `{a: 1, b: 2}` has two entries rather
      // than one whose value is `1, b: 2`.
      const value = this.parseObjectValue();
      return { key, value, offset: token.offset };
    }

    // `{a}` is shorthand for `{a: .a}`.
    if (shorthandName === null) {
      this.fail("a computed object key needs a ':' and a value", this.current);
    }
    return {
      key,
      value: A.field(shorthandName, false, token.offset),
      offset: token.offset,
    };
  }

  parseObjectValue() {
    // Everything except comma and pipe binds inside an object value.
    return this.parseAlternative();
  }

  enter() {
    this.depth++;
    if (this.depth > 200) {
      this.fail('the query nests too deeply');
    }
  }

  leave() {
    this.depth--;
  }
}

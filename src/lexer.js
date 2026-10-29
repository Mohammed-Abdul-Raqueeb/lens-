/**
 * Turns query text into tokens.
 *
 * Hand-written rather than generated, for the usual reason in a project with
 * no dependencies, and one specific one: the language has several two- and
 * three-character operators (`//`, `==`, `|=`, `//=`, `?//`) whose longest
 * match has to win, and expressing that in a table is more work than writing
 * the loop.
 */

import { LexError } from './errors.js';

/** Token kinds. */
export const TokenKind = {
  NUMBER: 'number',
  STRING: 'string',
  IDENT: 'ident',
  FIELD: 'field',
  VARIABLE: 'variable',
  FORMAT: 'format',
  KEYWORD: 'keyword',
  OP: 'op',
  EOF: 'eof',
};

/**
 * Words that are syntax rather than function names.
 *
 * Kept as a set because the lexer has to decide between IDENT and KEYWORD
 * before the parser sees either, and a function named `if` would make the
 * grammar ambiguous.
 */
export const KEYWORDS = new Set([
  'and',
  'as',
  'catch',
  'def',
  'elif',
  'else',
  'end',
  'foreach',
  'if',
  'import',
  'include',
  'label',
  'not',
  'or',
  'reduce',
  'then',
  'try',
]);

/**
 * Operators, longest first.
 *
 * The order is load-bearing: `//` must be tried before `/`, and `//=` before
 * `//`, or `a // b` lexes as two divisions and the error that follows points
 * nowhere near the real problem.
 */
const OPERATORS = [
  '?//',
  '//=',
  '|=',
  '+=',
  '-=',
  '*=',
  '/=',
  '%=',
  '==',
  '!=',
  '<=',
  '>=',
  '//',
  '..',
  '|',
  ',',
  '.',
  '[',
  ']',
  '{',
  '}',
  '(',
  ')',
  ':',
  ';',
  '?',
  '=',
  '<',
  '>',
  '+',
  '-',
  '*',
  '/',
  '%',
];

/** One token. */
export class Token {
  /**
   * @param {string} kind one of {@link TokenKind}
   * @param {string|number} value the token's text or numeric value
   * @param {number} offset where it starts in the source
   */
  constructor(kind, value, offset) {
    this.kind = kind;
    this.value = value;
    this.offset = offset;
  }

  /**
   * Whether this is a given operator.
   *
   * @param {string} text the operator text
   * @returns {boolean} true when it matches
   */
  isOp(text) {
    return this.kind === TokenKind.OP && this.value === text;
  }

  /**
   * Whether this is a given keyword.
   *
   * @param {string} text the keyword
   * @returns {boolean} true when it matches
   */
  isKeyword(text) {
    return this.kind === TokenKind.KEYWORD && this.value === text;
  }

  /**
   * A description for an error message.
   *
   * @returns {string} the token as a user would recognise it
   */
  describe() {
    if (this.kind === TokenKind.EOF) return 'end of input';
    if (this.kind === TokenKind.STRING) return `string ${JSON.stringify(this.value)}`;
    return `'${this.value}'`;
  }
}

/**
 * Tokenises a query.
 *
 * @param {string} source the query text
 * @returns {Token[]} the tokens, ending with an EOF token
 * @throws {LexError} when a character cannot begin a token
 */
export function tokenize(source) {
  if (typeof source !== 'string') {
    throw new LexError('a query must be a string', { offset: 0, source: '' });
  }

  const tokens = [];
  let at = 0;

  const fail = (message, offset = at) => {
    throw new LexError(message, { offset, source });
  };

  while (at < source.length) {
    const char = source[at];

    // Whitespace.
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      at++;
      continue;
    }

    // Comments run to the end of the line. Useful in a query held in a file,
    // which is the only place they can appear -- a shell would eat them.
    if (char === '#') {
      while (at < source.length && source[at] !== '\n') at++;
      continue;
    }

    // A field access: `.foo`. Distinguished from the `.` operator by what
    // follows it, which is why this is checked before the operator table.
    if (char === '.' && isIdentStart(source[at + 1])) {
      const start = at;
      at++;
      const from = at;
      while (at < source.length && isIdentPart(source[at])) at++;
      tokens.push(new Token(TokenKind.FIELD, source.slice(from, at), start));
      continue;
    }

    // A variable: `$name`.
    if (char === '$') {
      const start = at;
      at++;
      const from = at;
      while (at < source.length && isIdentPart(source[at])) at++;
      if (at === from) fail('a $ must be followed by a variable name', start);
      tokens.push(new Token(TokenKind.VARIABLE, source.slice(from, at), start));
      continue;
    }

    // A format string: `@base64`, `@text "..."`.
    if (char === '@') {
      const start = at;
      at++;
      const from = at;
      while (at < source.length && isIdentPart(source[at])) at++;
      if (at === from) fail('an @ must be followed by a format name', start);
      tokens.push(new Token(TokenKind.FORMAT, source.slice(from, at), start));
      continue;
    }

    if (char === '"') {
      const start = at;
      const { value, next } = readString(source, at, fail);
      at = next;
      tokens.push(new Token(TokenKind.STRING, value, start));
      continue;
    }

    if (isDigit(char)) {
      const start = at;
      const { value, next } = readNumber(source, at, fail);
      at = next;
      tokens.push(new Token(TokenKind.NUMBER, value, start));
      continue;
    }

    if (isIdentStart(char)) {
      const start = at;
      while (at < source.length && isIdentPart(source[at])) at++;
      const word = source.slice(start, at);
      const kind = KEYWORDS.has(word) ? TokenKind.KEYWORD : TokenKind.IDENT;
      tokens.push(new Token(kind, word, start));
      continue;
    }

    const operator = OPERATORS.find((candidate) => source.startsWith(candidate, at));
    if (operator) {
      tokens.push(new Token(TokenKind.OP, operator, at));
      at += operator.length;
      continue;
    }

    fail(`unexpected character '${char}'`);
  }

  tokens.push(new Token(TokenKind.EOF, '', source.length));
  return tokens;
}

/**
 * Reads a double-quoted string, resolving escapes.
 *
 * String interpolation (`"\(expr)"`) is tokenised as a plain string here and
 * left for the parser: the expression inside needs the full grammar, and a
 * lexer that recursed into the parser would be the wrong shape entirely.
 * Interpolation is recorded as a marker the parser picks up.
 *
 * @param {string} source the query text
 * @param {number} start offset of the opening quote
 * @param {(message: string, offset?: number) => never} fail raises a LexError
 * @returns {{value: string|object, next: number}} the value and the offset after it
 */
function readString(source, start, fail) {
  let at = start + 1;
  let out = '';
  /** @type {Array<string|{expr: string}>} */
  const parts = [];
  let interpolated = false;

  while (true) {
    if (at >= source.length) fail('a string was never closed', start);
    const char = source[at];

    if (char === '"') {
      at++;
      break;
    }

    if (char !== '\\') {
      if (char === '\n') fail('a string cannot span lines; use \\n', at);
      out += char;
      at++;
      continue;
    }

    at++;
    if (at >= source.length) fail('a string ended inside an escape', at);
    const escape = source[at];

    // `\(` opens an interpolation, which is the one escape that is not a
    // character substitution.
    if (escape === '(') {
      interpolated = true;
      if (out) parts.push(out);
      out = '';

      at++;
      const from = at;
      let depth = 1;
      // Tracked rather than counted blindly: a `)` inside a nested string
      // must not close the interpolation.
      let inString = false;
      while (at < source.length && depth > 0) {
        const inner = source[at];
        if (inString) {
          if (inner === '\\') at++;
          else if (inner === '"') inString = false;
        } else if (inner === '"') {
          inString = true;
        } else if (inner === '(') {
          depth++;
        } else if (inner === ')') {
          depth--;
          if (depth === 0) break;
        }
        at++;
      }
      if (depth !== 0) fail('an interpolation was never closed', from - 2);
      parts.push({ expr: source.slice(from, at) });
      at++;
      continue;
    }

    switch (escape) {
      case '"': out += '"'; at++; break;
      case '\\': out += '\\'; at++; break;
      case '/': out += '/'; at++; break;
      case 'n': out += '\n'; at++; break;
      case 'r': out += '\r'; at++; break;
      case 't': out += '\t'; at++; break;
      case 'b': out += '\b'; at++; break;
      case 'f': out += '\f'; at++; break;
      case 'u': {
        const hex = source.slice(at + 1, at + 5);
        if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
          fail('a \\u escape needs four hex digits', at - 1);
        }
        out += String.fromCharCode(parseInt(hex, 16));
        at += 5;
        break;
      }
      default:
        fail(`'\\${escape}' is not a valid escape`, at - 1);
    }
  }

  if (!interpolated) {
    return { value: out, next: at };
  }

  if (out) parts.push(out);
  return { value: { interpolate: parts }, next: at };
}

/**
 * Reads a JSON-style number.
 *
 * @param {string} source the query text
 * @param {number} start offset of the first digit
 * @param {(message: string, offset?: number) => never} fail raises a LexError
 * @returns {{value: number, next: number}} the value and the offset after it
 */
function readNumber(source, start, fail) {
  let at = start;
  while (at < source.length && isDigit(source[at])) at++;

  if (source[at] === '.' && isDigit(source[at + 1])) {
    at++;
    while (at < source.length && isDigit(source[at])) at++;
  }

  if (source[at] === 'e' || source[at] === 'E') {
    let lookahead = at + 1;
    if (source[lookahead] === '+' || source[lookahead] === '-') lookahead++;
    // Only consumed when digits actually follow, so `1e` lexes as the number
    // 1 and the identifier e, and the parser reports the real problem.
    if (isDigit(source[lookahead])) {
      at = lookahead;
      while (at < source.length && isDigit(source[at])) at++;
    }
  }

  const text = source.slice(start, at);
  const value = Number(text);
  if (!Number.isFinite(value)) fail(`'${text}' is not a finite number`, start);
  return { value, next: at };
}

function isDigit(char) {
  return char >= '0' && char <= '9';
}

function isIdentStart(char) {
  return char !== undefined && (/[A-Za-z_]/.test(char));
}

function isIdentPart(char) {
  return char !== undefined && (/[A-Za-z0-9_]/.test(char));
}

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


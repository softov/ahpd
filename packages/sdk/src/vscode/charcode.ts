/**
 * The character codes VS Code's scorer and filters compare against, under VS
 * Code's names.
 *
 * Vendored from VS Code's `CharCode`, the members the vendored modules here
 * reach. A frozen object where VS Code has a `const enum`: Node runs this
 * package's sources with their types stripped, and an enum is not a type it
 * can strip.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/charCode.ts
 */
export const CharCode = Object.freeze({
  Space: 32,
  ExclamationMark: 33,
  DoubleQuote: 34,
  Hash: 35,
  DollarSign: 36,
  Ampersand: 38,
  SingleQuote: 39,
  OpenParen: 40,
  CloseParen: 41,
  Asterisk: 42,
  Plus: 43,
  Comma: 44,
  Dash: 45,
  Period: 46,
  Slash: 47,
  Digit0: 48,
  Digit9: 57,
  Colon: 58,
  Semicolon: 59,
  Equals: 61,
  QuestionMark: 63,
  AtSign: 64,
  A: 65,
  Z: 90,
  OpenSquareBracket: 91,
  Backslash: 92,
  CloseSquareBracket: 93,
  Underline: 95,
  a: 97,
  z: 122,
  OpenCurlyBrace: 123,
  CloseCurlyBrace: 125,
  Tilde: 126,
});

/**
 * The prefix filter and the upper-case test VS Code's scorer uses.
 *
 * Vendored from VS Code's `filters.ts`, as VS Code has them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/filters.ts#L12-L64
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/filters.ts#L130-L132
 */

import { CharCode } from './charcode.js';
import * as strings from './strings.js';

export interface IFilter {
  // Returns null if word doesn't match.
  (word: string, wordToMatchAgainst: string): IMatch[] | null;
}

export interface IMatch {
  start: number;
  end: number;
}

// Prefix

export const matchesPrefix: IFilter = _matchesPrefix.bind(undefined, true);

function _matchesPrefix(ignoreCase: boolean, word: string, wordToMatchAgainst: string): IMatch[] | null {
  if (!wordToMatchAgainst || wordToMatchAgainst.length < word.length) {
    return null;
  }

  let matches: boolean;
  if (ignoreCase) {
    matches = strings.startsWithIgnoreCase(wordToMatchAgainst, word);
  } else {
    matches = wordToMatchAgainst.indexOf(word) === 0;
  }

  if (!matches) {
    return null;
  }

  return word.length > 0 ? [{ start: 0, end: word.length }] : [];
}

export function isUpper(code: number): boolean {
  return CharCode.A <= code && code <= CharCode.Z;
}

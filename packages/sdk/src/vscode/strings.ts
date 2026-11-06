/**
 * The string comparisons VS Code's scorer and filters use.
 *
 * Vendored from VS Code's `strings.ts`, the functions the vendored modules
 * here reach, as VS Code has them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/strings.ts#L351-L458
 */

import { CharCode } from './charcode.js';

export function compare(a: string, b: string): number {
  if (a < b) {
    return -1;
  } else if (a > b) {
    return 1;
  } else {
    return 0;
  }
}

export function compareSubstringIgnoreCase(a: string, b: string, aStart: number = 0, aEnd: number = a.length, bStart: number = 0, bEnd: number = b.length): number {

  for (; aStart < aEnd && bStart < bEnd; aStart++, bStart++) {

    let codeA = a.charCodeAt(aStart);
    let codeB = b.charCodeAt(bStart);

    if (codeA === codeB) {
      // equal
      continue;
    }

    if (codeA >= 128 || codeB >= 128) {
      // not ASCII letters: fallback to lower-casing strings
      return compare(
        a.substring(aStart, aEnd).toLowerCase(),
        b.substring(bStart, bEnd).toLowerCase()
      );
    }

    // mapper lower-case ascii letter onto upper-case varinats
    // [97-122] (lower ascii) => [65-90] (upper ascii)
    if (isLowerAsciiLetter(codeA)) {
      codeA -= 32;
    }
    if (isLowerAsciiLetter(codeB)) {
      codeB -= 32;
    }

    // compare both code points
    const diff = codeA - codeB;
    if (diff === 0) {
      continue;
    }

    return diff;
  }

  const aLen = aEnd - aStart;
  const bLen = bEnd - bStart;

  if (aLen < bLen) {
    return -1;
  } else if (aLen > bLen) {
    return 1;
  }

  return 0;
}

export function isLowerAsciiLetter(code: number): boolean {
  return code >= CharCode.a && code <= CharCode.z;
}

export function equalsIgnoreCase(a: string, b: string): boolean {
  return a.length === b.length && compareSubstringIgnoreCase(a, b) === 0;
}

export function startsWithIgnoreCase(str: string, candidate: string): boolean {
  const len = candidate.length;
  return len <= str.length && compareSubstringIgnoreCase(str, candidate, 0, len) === 0;
}

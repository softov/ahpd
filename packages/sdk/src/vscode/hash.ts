/**
 * The hashing VS Code's scorer keys its cache by.
 *
 * Vendored from VS Code's `hash.ts`, the functions the scorer reaches, as VS
 * Code has them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/hash.ts#L22-L107
 */

export function doHash(obj: unknown, hashVal: number): number {
  switch (typeof obj) {
    case 'object':
      if (obj === null) {
        return numberHash(349, hashVal);
      } else if (Array.isArray(obj)) {
        return arrayHash(obj, hashVal);
      }
      return objectHash(obj, hashVal);
    case 'string':
      return stringHash(obj, hashVal);
    case 'boolean':
      return booleanHash(obj, hashVal);
    case 'number':
      return numberHash(obj, hashVal);
    case 'undefined':
      return numberHash(937, hashVal);
    default:
      return numberHash(617, hashVal);
  }
}

export function numberHash(val: number, initialHashVal: number): number {
  return (((initialHashVal << 5) - initialHashVal) + val) | 0;  // hashVal * 31 + ch, keep as int32
}

function booleanHash(b: boolean, initialHashVal: number): number {
  return numberHash(b ? 433 : 863, initialHashVal);
}

export function stringHash(s: string, hashVal: number): number {
  hashVal = numberHash(149417, hashVal);
  for (let i = 0, length = s.length; i < length; i++) {
    hashVal = numberHash(s.charCodeAt(i), hashVal);
  }
  return hashVal;
}

/** Precomputes the affine transform of {@link stringHash} for a fixed string and int32 accumulators. */
export class ConstantStringHash {

  private readonly multiplier: number;
  private readonly addend: number;

  constructor(value: string) {
    let multiplier = 31; // accounts for the seed step of `stringHash`
    for (let i = 0; i < value.length; i++) {
      multiplier = Math.imul(multiplier, 31);
    }

    this.multiplier = multiplier;
    this.addend = stringHash(value, 0);
  }

  /** Equivalent to `stringHash(value, hashVal)` for int32 `hashVal`. */
  apply(hashVal: number): number {
    return (Math.imul(hashVal, this.multiplier) + this.addend) | 0;
  }
}

/** Seed mixed in by {@link arrayHash} before hashing the array elements. */
export const ARRAY_HASH_SEED = 104579;

/** Seed mixed in by {@link objectHash} before hashing the object entries. */
export const OBJECT_HASH_SEED = 181387;

function arrayHash(arr: unknown[], initialHashVal: number): number {
  initialHashVal = numberHash(ARRAY_HASH_SEED, initialHashVal);
  return arr.reduce<number>((hashVal, item) => doHash(item, hashVal), initialHashVal);
}

function objectHash(obj: object, initialHashVal: number): number {
  initialHashVal = numberHash(OBJECT_HASH_SEED, initialHashVal);
  return Object.keys(obj).sort().reduce((hashVal, key) => {
    hashVal = stringHash(key, hashVal);
    return doHash((obj as Record<string, unknown>)[key], hashVal);
  }, initialHashVal);
}

/**
 * The comparison VS Code's scorer falls back to.
 *
 * Vendored from VS Code's `comparers.ts`: `compareFileNames` with the collator
 * it reads, `compareAnything` and `compareByPrefix`, as VS Code has them. The
 * collator is made at its first use, as VS Code's `Lazy` makes it, in the
 * default locale VS Code's `safeIntl.Collator` is asked for.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/comparers.ts#L14-L51
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/base/common/comparers.ts#L306-L356
 */

// A collator with numeric sorting enabled, and no sensitivity to case, accents or diacritics.
let intlFileNameCollatorBaseNumeric: { collator: Intl.Collator; collatorIsNumeric: boolean } | undefined;

const fileNameCollatorBaseNumeric = (): { collator: Intl.Collator; collatorIsNumeric: boolean } => {
  if (intlFileNameCollatorBaseNumeric === undefined) {
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    intlFileNameCollatorBaseNumeric = {
      collator,
      collatorIsNumeric: collator.resolvedOptions().numeric === true,
    };
  }
  return intlFileNameCollatorBaseNumeric;
};

/** Compares filenames without distinguishing the name from the extension. Disambiguates by unicode comparison. */
export function compareFileNames(one: string | null, other: string | null): number {
  const a = one || '';
  const b = other || '';
  const result = fileNameCollatorBaseNumeric().collator.compare(a, b);

  // Using the numeric option will make compare(`foo1`, `foo01`) === 0. Disambiguate.
  if (fileNameCollatorBaseNumeric().collatorIsNumeric && result === 0 && a !== b) {
    return a < b ? -1 : 1;
  }

  return result;
}

export function compareAnything(one: string, other: string, lookFor: string): number {
  const elementAName = one.toLowerCase();
  const elementBName = other.toLowerCase();

  // Sort prefix matches over non prefix matches
  const prefixCompare = compareByPrefix(one, other, lookFor);
  if (prefixCompare) {
    return prefixCompare;
  }

  // Sort suffix matches over non suffix matches
  const elementASuffixMatch = elementAName.endsWith(lookFor);
  const elementBSuffixMatch = elementBName.endsWith(lookFor);
  if (elementASuffixMatch !== elementBSuffixMatch) {
    return elementASuffixMatch ? -1 : 1;
  }

  // Understand file names
  const r = compareFileNames(elementAName, elementBName);
  if (r !== 0) {
    return r;
  }

  // Compare by name
  return elementAName.localeCompare(elementBName);
}

export function compareByPrefix(one: string, other: string, lookFor: string): number {
  const elementAName = one.toLowerCase();
  const elementBName = other.toLowerCase();

  // Sort prefix matches over non prefix matches
  const elementAPrefixMatch = elementAName.startsWith(lookFor);
  const elementBPrefixMatch = elementBName.startsWith(lookFor);
  if (elementAPrefixMatch !== elementBPrefixMatch) {
    return elementAPrefixMatch ? -1 : 1;
  }

  // Same prefix: Sort shorter matches to the top to have those on top that match more precisely
  else if (elementAPrefixMatch && elementBPrefixMatch) {
    if (elementAName.length < elementBName.length) {
      return -1;
    }

    if (elementAName.length > elementBName.length) {
      return 1;
    }
  }

  return 0;
}

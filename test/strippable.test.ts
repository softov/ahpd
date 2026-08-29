import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

/*
 * What running the source unbuilt costs.
 *
 * `npm run dev:node` runs the TypeScript through Node, which *strips* types
 * rather than transforming them - so it cannot run the parts of TypeScript
 * that emit code of their own: enums, namespaces, and constructor parameter
 * properties. One of each compiles perfectly and breaks the dev loop for
 * everybody, and the message it breaks with names a line rather than the
 * habit, so it is worth a test rather than a note in a README.
 *
 * A build has none of these limits. This is only about the loop.
 */

const sources = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
  const path = join(dir, entry);
  if (statSync(path).isDirectory()) return sources(path);
  return path.endsWith('.ts') || path.endsWith('.tsx') ? [path] : [];
});

/** What Node refuses, and what each one is called when it does. */
const emits: { what: string; found: RegExp }[] = [
  { what: 'a constructor parameter property', found: /constructor\s*\([^)]*\b(?:readonly|public|private|protected)\b/ },
  { what: 'an enum', found: /^\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+\w/m },
  { what: 'a namespace', found: /^\s*(?:export\s+)?namespace\s+\w/m },
];

it('has no TypeScript that emits code, so a stripping runtime can run it', () => {
  const offenders = [...sources('src'), ...sources('examples')].flatMap((path) => {
    const text = readFileSync(path, 'utf8');
    return emits
      .filter((kind) => kind.found.test(text))
      .map((kind) => `${path}: ${kind.what}`);
  });
  expect(offenders).toEqual([]);
});

it('recognises each of them, so an empty result means what it says', () => {
  // A test that passes because its patterns match nothing would pass for ever.
  const samples = [
    'class A { constructor(readonly x: number) {} }',
    'export const enum Colour { Red }',
    'namespace Thing { export const x = 1; }',
  ];
  for (const [index, sample] of samples.entries()) {
    expect(emits[index]?.found.test(sample)).toBe(true);
  }
});

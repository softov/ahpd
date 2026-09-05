import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitChanges } from '../src/changes.js';
import { fileResources } from '../src/resources.js';

/*
 * The *words* inside a payload, which nothing else here checks.
 *
 * A conformance audit that counted every action on every channel and every
 * field on every state still missed this: `ChangesetState.status` was declared
 * `computing | complete | error` in this repository's own port type, and the
 * protocol's `ChangesetStatus` is `computing | ready | error`. The field was
 * present, its type was a string, and its value was a word no conformant
 * client recognises - so every changeset this host ever served described one
 * that never finished computing.
 *
 * The port types now take their vocabularies from the package as `${Enum}`, so
 * a wrong word is a compile error. What is left for a test is the half a type
 * cannot state: that the values this host *actually writes* - through code
 * paths where a value was cast, or came from the SDK, or was built by
 * mutation - are members of the vocabulary they claim.
 */

/**
 * The protocol's enums, read out of the declarations the package ships.
 *
 * Read rather than imported, and that is not a preference. Every one of them
 * is `declare const enum` in the `.d.ts` while the `.js` beside it emits an
 * ordinary runtime object, so under `verbatimModuleSyntax` a value import of
 * any of them is a compile error - the vocabulary exists at run time and
 * cannot be named from typed code. Reading the declaration is what is left,
 * and it has the property that matters: nothing here is a copy, so the test
 * moves when the package does.
 */
const vocabularies = ((): Map<string, string[]> => {
  const root = 'node_modules/@microsoft/agent-host-protocol/dist/types';
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
  const found = new Map<string, string[]>();
  for (const path of walk(root).filter((one) => one.endsWith('.d.ts'))) {
    const text = readFileSync(path, 'utf8');
    // To the closing brace in the first column, not the first brace: every
    // member is preceded by a doc comment and those are full of `{@link ...}`.
    for (const [, name, body] of text.matchAll(/declare (?:const )?enum (\w+) \{([\s\S]*?)\n\}/g)) {
      if (name === undefined || body === undefined) continue;
      found.set(name, [...body.matchAll(/=\s*"([^"]*)"/g)].map(([, value]) => value ?? ''));
    }
  }
  return found;
})();

/** The vocabulary a field claims, or a failure saying the enum has gone. */
const words = (name: string): string[] => {
  const held = vocabularies.get(name);
  expect(held, `${name} is no longer an enum the package declares`).toBeDefined();
  expect(held?.length, `${name} declares no values`).toBeGreaterThan(0);
  return held ?? [];
};

describe('the words this host writes', () => {
  it('finds the vocabularies it narrows against', () => {
    // The reading above is the whole basis of this file, so it is asserted
    // rather than assumed: a package layout change would otherwise turn every
    // check below into one that passes against an empty list.
    for (const name of [
      'AutomationOperation', 'ChangesetOperationScope', 'ChangesetOperationTargetKind',
      'ChangesetStatus', 'ContentEncoding', 'ResourceChangeType', 'ResourceType',
      'ResourceWriteMode', 'SessionOriginKind',
    ]) {
      expect(words(name).length, name).toBeGreaterThan(0);
    }
  });

  it('reports a changeset status the protocol declares', async () => {
    const source = gitChanges();
    // This repository itself: a real one, in whatever state it happens to be.
    await source.refresh?.('/github/ahpd');
    const state = await source.state('/github/ahpd', 'ahp-session:/x', 'uncommitted');
    // `undefined` is a real answer for a directory with nothing to report and
    // is not what is under test here; a *word* is.
    if (state === undefined) return;
    expect(words('ChangesetStatus')).toContain(state.status);
  });

  it('names its changeset scopes in the protocol\'s words', () => {
    const source = gitChanges();
    for (const scope of source.scopes('/github/ahpd', 'ahp-session:/x')) {
      // `changeKind` is deliberately not checked: the protocol declares it a
      // bare `string`, so there is no vocabulary to be wrong about.
      expect(typeof scope.changeKind).toBe('string');
    }
    for (const operation of source.operations?.('/github/ahpd', 'ahp-session:/x', 'uncommitted') ?? []) {
      for (const scope of operation.scopes) {
        expect(words('ChangesetOperationScope')).toContain(scope);
      }
    }
  });

  it('reports a resource kind and an encoding the protocol declares', async () => {
    const store = fileResources();
    const entries = await store.list('file:///github/ahpd/src', ['/github/ahpd']);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(words('ResourceType')).toContain(entry.type);
    }
    const read = await store.read('file:///github/ahpd/package.json', ['/github/ahpd']);
    expect(words('ContentEncoding')).toContain(read.encoding);
    const binary = await store.read('file:///github/ahpd/node_modules/.package-lock.json', ['/github/ahpd'])
      .catch(() => undefined);
    if (binary) expect(words('ContentEncoding')).toContain(binary.encoding);
  });
});

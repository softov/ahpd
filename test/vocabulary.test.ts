import * as protocol from '@microsoft/agent-host-protocol';
import { describe, expect, it } from 'vitest';
import { gitChanges } from '../packages/server/src/changes.js';
import { fileResources } from '../packages/server/src/resources.js';
import { fileURLToPath } from 'node:url';

/**
 * This checkout, as an absolute path.
 *
 * The tests below read real files out of this repository, so the path has to
 * be found rather than written down: a literal one passes on the machine it
 * was written on and fails on every other, CI included.
 */
const REPO = fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');

/*
 * The *words* inside a payload, which nothing else here checks.
 *
 * A conformance audit that counted every action on every channel and every
 * field on every state still missed this: `ChangesetState.status` was declared
 * `computing | complete | error` in this repository's own port type, and the
 * protocol's `ChangesetStatus` is `computing | ready | error`. The field was
 * present, its type was a string, and only its *value* was wrong - so every
 * changeset this host ever served described one that never finished computing.
 *
 * The port types now take their vocabularies from the package as `${Enum}`, so
 * a wrong word is a compile error. What is left for a test is the half a type
 * cannot state: that the values this host *actually writes* - through paths
 * where something was cast, or came from the SDK, or was built by mutation -
 * are members of the vocabulary they claim.
 */

/**
 * The protocol's enums, read from the package as plain objects.
 *
 * A namespace import with the declared type cast away, because every one of
 * these is `declare const enum` in the `.d.ts` while the `.js` beside it
 * emits an ordinary runtime object. A *named* value import of one is
 * `TS2748` under `verbatimModuleSyntax`; the namespace is not, and the cast
 * is what stops the member access being read as a const-enum access. The
 * values are the package's own either way - nothing here is a copy.
 */
const vocabularies = protocol as unknown as Record<string, Record<string, string> | undefined>;

/** The vocabulary a field claims, or a failure saying the enum has gone. */
const words = (name: string): string[] => {
  const held = vocabularies[name];
  expect(held, `${name} is no longer an enum the package exports`).toBeDefined();
  const values = Object.values(held ?? {});
  // A string enum, with members. If one ever became a bare `string`, the
  // `${Enum}` narrowings would widen to `${string}` and go on compiling while
  // checking nothing at all - so the shape is asserted, not assumed.
  expect(values.length, `${name} declares no values`).toBeGreaterThan(0);
  expect(values.every((one) => typeof one === 'string'), `${name} is not a string enum`).toBe(true);
  return values;
};

describe('the words this host writes', () => {
  it('finds every vocabulary it narrows a port type against', () => {
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
    await source.refresh?.(REPO);
    const state = await source.state(REPO, 'ahp-session:/x', 'uncommitted');
    // `undefined` is a real answer for a directory with nothing to report and
    // is not what is under test here; a *word* is.
    if (state === undefined) return;
    expect(words('ChangesetStatus')).toContain(state.status);
  });

  it('names its changeset scopes in the protocol\'s words', () => {
    const source = gitChanges();
    for (const scope of source.scopes(REPO, 'ahp-session:/x')) {
      // `changeKind` is deliberately not checked: the protocol declares it a
      // bare `string`, so there is no vocabulary to be wrong about.
      expect(typeof scope.changeKind).toBe('string');
    }
    for (const operation of source.operations?.(REPO, 'ahp-session:/x', 'uncommitted') ?? []) {
      for (const scope of operation.scopes) {
        expect(words('ChangesetOperationScope')).toContain(scope);
      }
    }
  });

  it('reports a resource kind and an encoding the protocol declares', async () => {
    const store = fileResources();
    const entries = await store.list(`file://${REPO}/packages/server/src`, [REPO]);
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(words('ResourceType')).toContain(entry.type);
    }
    const read = await store.read(`file://${REPO}/package.json`, [REPO]);
    expect(words('ContentEncoding')).toContain(read.encoding);
  });
});

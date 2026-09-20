import { describe, expect, it } from 'vitest';
import { artifactTools, artifactsIn, isGitHubLink, parseArtifacts } from '../packages/sdk/src/artifacttools.js';
import type { Bag } from '../packages/sdk/src/types/common.js';
import type { ToolCall } from '../packages/sdk/src/types/host.js';

/*
 * The artifact tools, in the shapes VS Code's host answers them.
 *
 * The checks and the words are the reference host's
 * (`sessionArtifactCollection.ts`, `artifactServerTools.ts`), because a model
 * that got a refusal there fixes the call from its text, and the same text
 * here means the same fix.
 */

/** A `ToolCall` that holds artifacts and nothing else. */
const holding = (start: Bag[] = []) => {
  let held = start;
  const at = { artifacts: () => [...held], setArtifacts: (list: Bag[]) => { held = list; } } as unknown as ToolCall;
  return { at, held: () => held };
};
const tool = (name: string) => {
  const found = artifactTools().find((one) => one.definition.name === name);
  if (!found) throw new Error(`no ${name}`);
  return found;
};

describe('what an entry must carry', () => {
  it('takes the reference host\'s six kinds, each with the field that opens it', () => {
    expect(parseArtifacts({ items: [{ type: 'pullRequest', label: 'PR', isArtifact: true, link: 'https://github.com/softov/ahpd/pull/1' }] }, 'add_artifact_or_reference'))
      .toEqual([{ type: 'pullRequest', label: 'PR', isArtifact: true, link: 'https://github.com/softov/ahpd/pull/1', isGitHub: true }]);
    expect(parseArtifacts({ type: 'file', label: 'Plan', isArtifact: true, uri: 'file:///tmp/plan.md' }, 'add_artifact_or_reference'))
      .toEqual([{ type: 'file', label: 'Plan', isArtifact: true, uri: 'file:///tmp/plan.md' }]);
    expect(parseArtifacts({ type: 'commit', label: 'Fix', isArtifact: false, link: 'https://example.com/c/1', commitHash: 'abc' }, 'add_artifact_or_reference'))
      .toEqual([{ type: 'commit', label: 'Fix', isArtifact: false, link: 'https://example.com/c/1', commitHash: 'abc' }]);
  });

  it('refuses in the reference host\'s words', () => {
    const add = (raw: unknown) => () => parseArtifacts(raw, 'add_artifact_or_reference');
    expect(add({ type: 'poem', label: 'x', isArtifact: true })).toThrow('type must be one of pullRequest, issue, commit, website, file, resource.');
    expect(add({ type: 'website', label: 'x' })).toThrow('isArtifact must be a boolean');
    expect(add({ type: 'website', label: 'x', isArtifact: true, link: 'file:///etc/passwd' })).toThrow("link must be an http(s) URL, but was 'file:'.");
    expect(add({ type: 'website', label: 'x', isArtifact: true, link: 'not a url' })).toThrow('link must be an absolute http(s) URL.');
    expect(add({ type: 'file', label: 'x', isArtifact: true, uri: 'C:\\repo\\plan.md' })).toThrow('uri must be an absolute URI including its scheme');
    expect(add({ items: [] })).toThrow('items must be a non-empty array.');
    expect(add({ items: [{ type: 'file', isArtifact: true, uri: 'file:///x' }] })).toThrow('items[0].label must be a non-empty string.');
  });

  it('knows a GitHub link when it sees one', () => {
    expect(isGitHubLink('https://github.com/softov/ahpd/pull/1')).toBe(true);
    expect(isGitHubLink('https://github.brbyte.com/x/y/pull/1')).toBe(true);
    expect(isGitHubLink('https://git.brbyte.com/x/y/-/merge_requests/1')).toBe(false);
  });

  it('reads what a store holds, leaving out what it cannot draw', () => {
    expect(artifactsIn([
      { id: 'a', type: 'website', label: 'Docs', link: 'https://example.com' },
      { id: 'b', type: 'poem', label: 'x' },
      { id: 'c', type: 'file', label: 'x', isArtifact: 'yes' },
    ])).toEqual([{ id: 'a', type: 'website', label: 'Docs', isArtifact: true, link: 'https://example.com' }]);
  });
});

describe('the three tools', () => {
  it('adds, says what it added, and says so once for the same thing twice', async () => {
    const { at, held } = holding();
    const said = await tool('add_artifact_or_reference').run({ items: [
      { type: 'pullRequest', label: 'The fix', isArtifact: true, link: 'https://github.com/softov/ahpd/pull/1' },
      { type: 'website', label: 'Docs', isArtifact: false, link: 'https://example.com/docs' },
    ] }, at);
    expect(said).toMatch(/^Added artifact: [0-9a-f-]+\nAdded reference: [0-9a-f-]+$/);
    expect(held()).toHaveLength(2);
    expect(held()[0]).toMatchObject({ type: 'pullRequest', isGitHub: true });
    const again = await tool('add_artifact_or_reference').run({ type: 'website', label: 'Documentation', isArtifact: false, link: 'https://example.com/docs' }, at);
    expect(again).toMatch(/^Already recorded: [0-9a-f-]+$/);
    expect(held()).toHaveLength(2);
    await expect(async () => tool('add_artifact_or_reference').run({ type: 'resource', label: 'x', isArtifact: true, uri: 'agent-host-session://claude/abc' }, at))
      .rejects.toThrow('sessions and chats created with session-management tools must not be recorded');
  });

  it('promotes a reference in place, keeping its id, and never downgrades an artifact', async () => {
    const { at, held } = holding();
    const added = await tool('add_artifact_or_reference').run({
      items: [{ type: 'website', label: 'Docs', isArtifact: false, link: 'https://example.com/docs' }],
    }, at);
    const id = /^Added reference: ([0-9a-f-]+)$/.exec(added)?.[1];
    expect(id).toBeDefined();
    const promoted = await tool('add_artifact_or_reference').run({
      items: [{ type: 'website', label: 'The docs', isArtifact: true, link: 'https://example.com/docs' }],
    }, at);
    expect(promoted).toBe(`Promoted artifact: ${id}`);
    expect(held()).toHaveLength(1);
    expect(held()[0]).toMatchObject({ id, label: 'The docs', isArtifact: true });
    // An artifact arriving as a reference is a duplicate, not a downgrade.
    const down = await tool('add_artifact_or_reference').run({
      items: [{ type: 'website', label: 'Docs once more', isArtifact: false, link: 'https://example.com/docs' }],
    }, at);
    expect(down).toBe(`Already recorded: ${id}`);
    expect(held()).toHaveLength(1);
    expect(held()[0]).toMatchObject({ id, label: 'The docs', isArtifact: true });
  });

  it('lists with ids, and removes by one', async () => {
    const { at, held } = holding([{ id: 'one', type: 'file', label: 'Plan', isArtifact: true, uri: 'file:///tmp/plan.md' }]);
    expect(await tool('list_artifacts_and_references').run({}, at)).toBe('one (file, artifact) Plan \u2014 file:///tmp/plan.md');
    expect(await tool('remove_artifact_or_reference').run({ id: 'nobody' }, at)).toBe('No artifact or reference with id nobody.');
    expect(await tool('remove_artifact_or_reference').run({ id: 'one' }, at)).toBe('Removed artifact: one');
    expect(held()).toEqual([]);
    expect(await tool('list_artifacts_and_references').run({}, at)).toBe('No artifacts or references recorded for this session.');
    await expect(async () => tool('remove_artifact_or_reference').run({}, at)).rejects.toThrow('id must be a non-empty string.');
  });

  it('keeps the add tool eager and lets remove and list be discovered', () => {
    const marked = Object.fromEntries(artifactTools().map((one) => [one.definition.name, one.deferLoading]));
    expect(marked).toEqual({
      add_artifact_or_reference: false,
      remove_artifact_or_reference: true,
      list_artifacts_and_references: true,
    });
  });

  it('carries a compact wording a client can select, which names the tool and differs from the long one', () => {
    const add = tool('add_artifact_or_reference');
    expect(add.compact?.instruction).toBeDefined();
    expect(add.compact?.definition?.description).toBeDefined();
    expect(add.compact?.instruction).not.toBe(add.instruction);
    expect(add.compact?.definition?.description).not.toBe(add.definition.description);
    // Both name the tool, so a model told only the short wording still knows
    // what to call.
    expect(add.compact?.instruction).toContain('add_artifact_or_reference');
    expect(add.compact?.definition?.description).toContain('add_artifact_or_reference');
    // And only the add tool carries one.
    const others = artifactTools().filter((one) => one.definition.name !== 'add_artifact_or_reference');
    expect(others.every((one) => one.compact === undefined)).toBe(true);
  });
});

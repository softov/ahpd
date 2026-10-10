import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { customizationsOf } from '../src/session.js';
import type { Bag } from '../../sdk/src/types/common.js';

/*
 * What a session lists as loaded, and where each entry says it came from.
 *
 * The SDK names a plugin's children `<plugin>:<name>`, and `reloadPlugins()`
 * is the only place a plugin's real root is reported. The projection is a pure
 * function of what the control protocol answered, so it is driven directly
 * here; `test/toolauth.test.ts` drives the same function through a session.
 */

const PLUGIN = { name: 'acme', path: '/plugins/acme', version: '1.0.0' };
const children = (one: Bag | undefined): Bag[] => (one?.children ?? []) as Bag[];
const byType = (list: Bag[], type: string): Bag | undefined => list.find((one) => one.type === type);

/**
 * A home with an `agents` folder in it, as one agent of the two below has.
 *
 * The check is the real one - a `file:` uri that names a file nobody has is
 * the same broken link as a `claude-internal:` one is not - so the folder is
 * written where the listing will look for it rather than stubbed out.
 */
function withHome(names: string[]): { home: string; restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), 'ahpd-home-'));
  mkdirSync(join(home, '.claude', 'agents'), { recursive: true });
  for (const name of names) writeFileSync(join(home, '.claude', 'agents', `${name}.md`), `---\nname: ${name}\n---\n`);
  const was = process.env.HOME;
  process.env.HOME = home;
  return { home, restore: () => { if (was === undefined) delete process.env.HOME; else process.env.HOME = was; rmSync(home, { recursive: true, force: true }); } };
}

/** Every agent leaf a listing reported, wherever it put it. */
const listed = (out: Bag[]): Bag[] =>
  out.filter((one) => one.type === 'directory' || one.type === 'plugin')
    .flatMap((one) => children(one))
    .filter((one) => one.type === 'agent');

const agentNames = (out: Bag[]): string[] => listed(out).map((one) => String(one.name));

const agentNamed = (out: Bag[], name: string): Bag | undefined => listed(out).find((one) => one.name === name);

describe('where a customization came from', () => {
  it('projects a reported plugin as its own container with the real path, name and version', () => {
    const out = customizationsOf({}, [], [], undefined, [PLUGIN]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ type: 'plugin', id: 'plugin:acme', uri: '/plugins/acme', name: 'acme', version: '1.0.0' });
  });

  it('leaves a reported plugin version off when the manifest declared none', () => {
    const out = customizationsOf({}, [], [], undefined, [{ name: 'acme', path: '/plugins/acme' }]);
    expect(out[0]).toMatchObject({ type: 'plugin', uri: '/plugins/acme', name: 'acme' });
    expect(out[0]).not.toHaveProperty('version');
  });

  it('answers exactly the three directory containers when the SDK reported no plugins', () => {
    const out = customizationsOf({
      commands: [{ name: 'review', description: 'Review the diff' }],
      agents: [{ name: 'helper', description: 'Helps' }],
    }, [], [{ name: 'writing', description: 'How to write' }]);
    expect(out.map((one) => one.type)).toEqual(['directory', 'directory', 'directory']);
    expect(out.map((one) => one.name)).toEqual(['skills', 'commands', 'agents']);
    expect(byType(out, 'plugin')).toBeUndefined();
  });

  it('moves an attributed skill under its plugin and out of the skills directory', () => {
    const out = customizationsOf({}, [], [
      { name: 'acme:acme-skill', description: '(acme) A plugin skill' },
      { name: 'user-skill', description: 'A user skill from disk' },
    ], undefined, [PLUGIN]);
    const plugin = byType(out, 'plugin');
    expect(children(plugin).map((one) => one.name)).toEqual(['acme-skill']);
    expect(children(plugin)[0]).toMatchObject({ type: 'skill', uri: '/plugins/acme/skills/acme-skill', description: '(acme) A plugin skill' });
    const directory = byType(out, 'directory');
    expect(children(directory).map((one) => one.name)).toEqual(['user-skill']);
    expect(children(directory).map((one) => one.name)).not.toContain('acme-skill');
  });

  it('moves an attributed agent and prompt under its plugin, and keeps the directories empty', () => {
    const out = customizationsOf({
      commands: [{ name: 'acme:acme-command', description: '(acme) A plugin command' }],
      agents: [{ name: 'acme:acme-agent', description: 'A plugin agent' }],
    }, [], [], undefined, [PLUGIN]);
    const plugin = byType(out, 'plugin');
    expect(children(plugin)).toEqual([
      { type: 'prompt', id: 'command:acme:acme-command', name: 'acme-command', uri: '/plugins/acme/commands/acme-command.md', enabled: true, description: '(acme) A plugin command' },
      // No file under the plugin this names, so it is the CLI's own agent and
      // carries the internal uri rather than a path to nothing.
      { type: 'agent', id: 'agent:acme:acme-agent', name: 'acme-agent', uri: 'claude-internal:/agent/acme-agent', enabled: true, description: 'A plugin agent' },
    ]);
    // Everything was attributed, so no per-kind directory is reported at all.
    expect(out.filter((one) => one.type === 'directory')).toEqual([]);
  });

  it('never invents a container for a namespace the SDK did not report', () => {
    const out = customizationsOf({}, [], [
      { name: 'ghost:ghost-skill', description: 'No such plugin was loaded' },
    ], undefined, [PLUGIN]);
    // The reported plugin is still a container, with nothing attributed to it.
    expect(byType(out, 'plugin')).toMatchObject({ name: 'acme' });
    expect(children(byType(out, 'plugin'))).toEqual([]);
    expect(children(byType(out, 'directory')).map((one) => one.name)).toEqual(['ghost:ghost-skill']);
  });
});

/*
 * A server the CLI is still connecting to.
 *
 * The Claude backend never reports `blocking`, which is the protocol's
 * optional field for a startup a client would have to wait on: nothing here
 * holds a message back on one, so a client is told the server is starting and
 * nothing else. `blocking: false` would be a claim about a wait that does not
 * exist, and a `session/mcpServerBackgroundRequested` would then have
 * something to clear that was never raised.
 */
it('reports a server the CLI is still connecting to as starting, with no blocking flag', () => {
  const out = customizationsOf({}, [{ name: 'desk', status: 'pending' }]);
  const server = out.find((one) => one.type === 'mcpServer');
  expect(server?.state).toEqual({ kind: 'starting' });
  expect(server?.state).not.toHaveProperty('blocking');
});

describe('where an agent lives', () => {
  it('gives an agent the CLI ships, and which has no file of its own, an internal uri', () => {
    const { restore } = withHome([]);
    try {
      const out = customizationsOf({ agents: [{ name: 'Explore', description: 'Reads the code' }] }, []);
      // A `file:` uri here would name a file nobody has, and a client that
      // reads what it names gets nothing back.
      expect(agentNamed(out, 'Explore')).toMatchObject({
        type: 'agent', id: 'agent:Explore', name: 'Explore', uri: 'claude-internal:/agent/Explore', description: 'Reads the code',
      });
    } finally { restore(); }
  });

  it('keeps the file uri for an agent a person wrote in their own agents folder', () => {
    const { home, restore } = withHome(['Plan']);
    try {
      const out = customizationsOf({ agents: [{ name: 'Plan' }] }, []);
      expect(agentNamed(out, 'Plan')).toMatchObject({
        type: 'agent', uri: `file://${home}/.claude/agents/Plan.md`,
      });
    } finally { restore(); }
  });

  it('does not list general-purpose, which is what the CLI runs when nothing is picked', () => {
    const { restore } = withHome([]);
    try {
      const out = customizationsOf({ agents: [{ name: 'general-purpose' }, { name: 'Explore' }] }, []);
      // Offering it as a choice would offer the absence of a choice, and a
      // person who picked it would be told nothing changed.
      expect(agentNames(out)).toEqual(['Explore']);
    } finally { restore(); }
  });

  it('gives a plugin agent the file under the plugin when there is one, and an internal uri when there is not', () => {
    const { restore } = withHome([]);
    const root = mkdtempSync(join(tmpdir(), 'ahpd-plugin-'));
    mkdirSync(join(root, 'agents'), { recursive: true });
    writeFileSync(join(root, 'agents', 'scribe.md'), '---\nname: scribe\n---\n');
    try {
      const out = customizationsOf(
        { agents: [{ name: 'acme:scribe' }, { name: 'acme:ghost' }] }, [], [], undefined,
        [{ name: 'acme', path: root }],
      );
      expect(agentNamed(out, 'scribe')).toMatchObject({ uri: `${root}/agents/scribe.md` });
      expect(agentNamed(out, 'ghost')).toMatchObject({ uri: 'claude-internal:/agent/ghost' });
    } finally { restore(); rmSync(root, { recursive: true, force: true }); }
  });
});

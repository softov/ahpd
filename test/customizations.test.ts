import { describe, expect, it } from 'vitest';
import { customizationsOf } from '../packages/agent-claude/src/session.js';
import type { Bag } from '../packages/sdk/src/types/common.js';

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
      { type: 'agent', id: 'agent:acme:acme-agent', name: 'acme-agent', uri: '/plugins/acme/agents/acme-agent.md', enabled: true, description: 'A plugin agent' },
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

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { expandHome, resolveNeeds } from '../packages/sdk/src/machine.js';
import { pluginHost } from '../packages/sdk/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { MachineNeed } from '../packages/sdk/src/types/machine.js';
import type { PluginContext } from '../packages/sdk/src/types/plugin.js';

/*
 * An agent's needs, filled from what a host knows.
 *
 * The order - the profile's value, then the plugin option's, then the agent's
 * own default - is the whole of what this file is: a need is one path on this
 * host, and a profile that points it elsewhere is the only way to run the same
 * agent against another configuration. A value that cannot work is refused
 * here, by name, rather than becoming an empty directory a session exits 127
 * in.
 */

const temp = (): string => mkdtempSync(join(tmpdir(), 'ahpd-needs-'));

const context = (): PluginContext => ({
  path: temp(), paths: [temp()], version: sdkVersion(), log: () => {}, say: () => {},
});

it('accepts a need of each kind, and a mount without a target is not one', () => {
  const dir = temp();
  const file = join(dir, 'file');
  writeFileSync(file, 'x');
  const accepted: Record<string, MachineNeed> = {
    configDirectory: { directory: dir, target: '/ahpd/claude' },
    configJson: { file, target: '/ahpd/claude/.claude.json', readOnly: true },
    token: { name: 'TOKEN', default: 'secret' },
    copied: { source: file, target: '/usr/local/bin/thing' },
  };
  // A mount is a place in the machine as well as one on the host, and a need
  // with no target names no place to put it.
  // @ts-expect-error a directory mount needs a target
  const nowhere: MachineNeed = { directory: dir };
  void nowhere;
  expect(resolveNeeds(accepted, {}, dir)).toHaveLength(4);
});

it('fills a need from the profile, then the option, then the agent default', () => {
  const home = temp();
  const own = join(home, '.claude');
  const fromOption = join(home, 'option-claude');
  const fromProfile = join(home, 'profile-claude');
  for (const one of [own, fromOption, fromProfile]) mkdirSync(one);

  const needs: Record<string, MachineNeed> = {
    // `~` is the agent's own default, which resolution expands.
    claudeConfigDirectory: { directory: '~/.claude', target: '/ahpd/claude', required: true },
  };

  expect(resolveNeeds(needs, {}, home)[0]?.source).toBe(own);
  expect(resolveNeeds(needs, { option: { claudeConfigDirectory: fromOption } }, home)[0]?.source).toBe(fromOption);
  expect(resolveNeeds(needs, {
    profile: { claudeConfigDirectory: fromProfile },
    option: { claudeConfigDirectory: fromOption },
  }, home)[0]?.source).toBe(fromProfile);
});

it('expands a leading ~ and leaves everything else alone', () => {
  expect(expandHome('~', '/home/me')).toBe('/home/me');
  expect(expandHome('~/.claude', '/home/me')).toBe('/home/me/.claude');
  expect(expandHome('/srv/claude', '/home/me')).toBe('/srv/claude');
  // Not a home: `~user` needs a passwd lookup, and a `~` inside a path is a
  // legal file name.
  expect(expandHome('~other/x', '/home/me')).toBe('~other/x');
  expect(expandHome('/srv/~x', '/home/me')).toBe('/srv/~x');
});

it('refuses a required need with no value at all', () => {
  expect(() => resolveNeeds({ token: { name: 'TOKEN', required: true } }))
    .toThrow(/machine need token is required/);
  // Optional and empty is a real answer: the image may already carry it.
  expect(resolveNeeds({ token: { name: 'TOKEN' } })).toEqual([]);
  // And a profile or an option fills it, so required is not a dead end.
  expect(resolveNeeds({ token: { name: 'TOKEN', required: true } }, { option: { token: 'from-option' } }))
    .toEqual([{ name: 'token', kind: 'env', target: 'TOKEN', source: 'from-option' }]);
});

it('refuses a path that is not there, naming the need, the path and the source', () => {
  const dir = temp();
  const gone = join(dir, 'not-there');
  const failure = (): unknown => resolveNeeds({ claudeConfigDirectory: { directory: gone, target: '/ahpd/claude' } }, {}, dir);
  expect(failure).toThrow(/machine need claudeConfigDirectory points at/);
  expect(failure).toThrow(gone);
  // The source is named, so a person knows whether the profile, the option or
  // the agent asked for it.
  expect(failure).toThrow(/from the agent's default/);
  expect(() => resolveNeeds({ x: { file: gone, target: '/y' } }, { profile: { x: gone } }, dir))
    .toThrow(/from the profile/);
  expect(() => resolveNeeds({ x: { source: gone, target: '/y' } }, { option: { x: gone } }, dir))
    .toThrow(/from the option/);
});

it('answers an agent\u2019s needs when called, never at load', () => {
  const known: Agent[] = [];
  const { host } = pluginHost('probe', context(), {
    agents: () => known,
  });
  const machine = (): Record<string, MachineNeed> => ({
    claudeConfigDirectory: { directory: homedir(), target: '/ahpd/claude', required: true },
  });
  const agent = {
    provider: 'claude', displayName: 'Claude', schema: () => ({}), defaults: () => ({}),
    create: () => { throw new Error('not started here'); }, machine,
  } as unknown as Agent;

  // Nothing is read while the plugin applies, which is the point: the plugin
  // that registers the agent may load after this one.
  expect(host.machineNeeds('claude')).toBeUndefined();
  known.push(agent);
  expect(host.machineNeeds('claude')).toEqual(machine());
  // An unknown provider is not an agent that needs nothing.
  expect(host.machineNeeds('cofold')).toBeUndefined();
  // An agent that declares nothing answers an empty record, so a profile may
  // name one and the machine is still made.
  known.push({ provider: 'plain', displayName: 'Plain', schema: () => ({}), defaults: () => ({}), create: () => { throw new Error('no'); } } as unknown as Agent);
  expect(host.machineNeeds('plain')).toEqual({});
});

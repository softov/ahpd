import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { expandHome, resolveNeeds } from '../src/machine.js';
import { pluginHost } from '../src/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { Agent } from '../src/types/agent.js';
import type { MachineNeed } from '../src/types/machine.js';
import type { PluginContext } from '../src/types/plugin.js';

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
  path: temp(), paths: [temp()], version: sdkVersion(), hostName: 'test', configDir: '/tmp/needs', log: () => {}, say: () => {},
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

it('refuses a relative value for a mount, and never reads it against the cwd', () => {
  const needs: Record<string, MachineNeed> = {
    claudeConfigDirectory: { directory: '~/.claude', target: '/ahpd/claude', required: true },
  };
  // `existsSync('rel/dir')` answers against whatever directory the daemon runs
  // in, and the value then goes out as `-v rel/dir:/ahpd/claude`, which Docker
  // reads as a named volume - a machine nobody wrote.
  const failure = (): unknown => resolveNeeds(needs, { profile: { claudeConfigDirectory: 'rel/dir' } });
  expect(failure).toThrow(/machine need claudeConfigDirectory is rel\/dir \(from the profile\)/);
  expect(failure).toThrow(/a path a machine is made with is absolute/);
  // The same for a copy-in, which is a path read off this host.
  expect(() => resolveNeeds({ cli: { source: 'rel/cli', target: '/usr/local/bin/cli' } }))
    .toThrow(/machine need cli is rel\/cli \(from the agent's default\)/);
});

it('does not check an environment need, which is not a path', () => {
  // A value that is not a path is the ordinary case here, and it is printed
  // into the machine's environment rather than mounted.
  expect(resolveNeeds({ token: { name: 'TOKEN', default: 'rel' } }))
    .toEqual([{ name: 'token', kind: 'env', target: 'TOKEN', source: 'rel' }]);
  // And the refusal for one with no value names the need and where a value
  // could come from, and nothing else: an env need's value may be a
  // credential, so there is none to print.
  const said = (): string => {
    try {
      resolveNeeds({ token: { name: 'TOKEN', required: true } });
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error('the need was resolved');
  };
  expect(said()).toMatch(/^machine need token is required, and neither the profile, the plugin option nor the agent's default names one$/);
});

it('takes a value over an environment need whose default names a secret, and refuses one left unread', () => {
  // The machine maker reads such a default and hands it over as a value; a
  // profile's or an option's value wins over it as over any default.
  const needs: Record<string, MachineNeed> = { token: { name: 'TOKEN', default: { $secret: 'host:token' } } };
  expect(resolveNeeds(needs, { option: { token: 'read' } }))
    .toEqual([{ name: 'token', kind: 'env', target: 'TOKEN', source: 'read' }]);
  // Nothing read it, so there is no value to give, and the refusal names the
  // need and the secret rather than handing the machine an object.
  expect(() => resolveNeeds(needs)).toThrow(/^machine need token names host:token, and nothing read it for this machine$/);
});

it('resolves a part to its place under /opt/ahpd, and a profile value names another part', () => {
  const needs: Record<string, MachineNeed> = { codex: { part: 'codex', required: true } };
  // A part has no host path, so nothing is expanded and nothing is looked for.
  expect(resolveNeeds(needs)).toEqual([{ name: 'codex', kind: 'part', source: 'codex', target: '/opt/ahpd/codex' }]);
  // The target follows the part named, so a profile pinning another build gets
  // it where that build is.
  expect(resolveNeeds(needs, { profile: { codex: 'codex-next' }, option: { codex: 'codex-old' } }))
    .toEqual([{ name: 'codex', kind: 'part', source: 'codex-next', target: '/opt/ahpd/codex-next' }]);
  expect(resolveNeeds(needs, { option: { codex: 'codex-old' } })[0]?.target).toBe('/opt/ahpd/codex-old');
  // A part id is a name, never a path: it is where the part lands inside.
  expect(() => resolveNeeds(needs, { profile: { codex: '../etc' } }))
    .toThrow(/^machine need codex names the part \.\.\/etc \(from the profile\), and a part is named by its id in the versions file$/);
});

it('resolves a part need\'s fallback mount with it, and drops one whose host path is not there', () => {
  const dir = temp();
  const binary = join(dir, 'claude');
  writeFileSync(binary, '');
  const needs = (file: string): Record<string, MachineNeed> => ({
    claudePart: { part: 'claude', fallback: { file, target: '/usr/local/bin/claude', readOnly: true, required: true } },
  });
  expect(resolveNeeds(needs(binary))).toEqual([{
    name: 'claudePart',
    kind: 'part',
    source: 'claude',
    target: '/opt/ahpd/claude',
    fallback: { name: 'claudePart.fallback', kind: 'file', source: binary, target: '/usr/local/bin/claude', readOnly: true },
  }]);
  // A fallback is used only when the part fails, so a missing one refuses nothing.
  expect(resolveNeeds(needs(join(dir, 'gone')))).toEqual([{ name: 'claudePart', kind: 'part', source: 'claude', target: '/opt/ahpd/claude' }]);
});

it('keeps the needs of the mode a machine is made in, and a need without `when` in both', () => {
  const dir = temp();
  const needs: Record<string, MachineNeed> = {
    state: { state: '/ahpd/claude', seed: [{ source: join(dir, 'settings.json') }] },
    home: { directory: dir, target: '/ahpd/claude', when: 'host' },
    shared: { name: 'SHARED', default: 'x', when: 'volume' },
    both: { name: 'BOTH', default: 'y' },
  };
  const names = (mode: 'host' | 'volume'): string[] => resolveNeeds(needs, {}, dir, mode).map((one) => one.name);
  expect(names('volume')).toEqual(['state', 'shared', 'both']);
  expect(names('host')).toEqual(['home', 'both']);
  // Volume is the mode a caller that names none gets.
  expect(resolveNeeds(needs, {}, dir).map((one) => one.name)).toEqual(['state', 'shared', 'both']);
});

it('resolves a state need with its seeds, a seed target defaulting to the source’s name', () => {
  const home = temp();
  writeFileSync(join(home, '.claude.json'), '{}');
  mkdirSync(join(home, 'skills'));
  const needs: Record<string, MachineNeed> = {
    claudeState: {
      state: '/ahpd/claude',
      seed: [
        { source: '~/.claude.json', keep: ['mcpServers'] },
        { source: '~/skills', target: 'skills' },
        { source: '~/settings.json', target: 'conf/settings.json', drop: ['security.auth'] },
      ],
      description: 'The state.',
    },
  };
  expect(resolveNeeds(needs, {}, home)).toEqual([{
    name: 'claudeState',
    kind: 'state',
    source: '/ahpd/claude',
    target: '/ahpd/claude',
    seed: [
      { source: join(home, '.claude.json'), target: '.claude.json', keep: ['mcpServers'] },
      { source: join(home, 'skills'), target: 'skills' },
      { source: join(home, 'settings.json'), target: 'conf/settings.json', drop: ['security.auth'] },
    ],
    description: 'The state.',
  }]);
  // A profile's value names another directory inside the machine.
  expect(resolveNeeds(needs, { profile: { claudeState: '/state/claude' } }, home)[0]?.target).toBe('/state/claude');
});

it('refuses a state need whose directory or seed cannot work', () => {
  const home = temp();
  mkdirSync(join(home, 'skills'));
  const one = (need: MachineNeed): (() => unknown) => () => resolveNeeds({ s: need }, {}, home);
  expect(one({ state: 'relative' })).toThrow(/^machine need s is relative \(from the agent's default\), and a state directory is an absolute path inside the machine$/);
  expect(one({ state: '/s', seed: [{ source: 'here.json' }] })).toThrow(/^machine need s seeds here\.json, and a seed is an absolute host path$/);
  expect(one({ state: '/s', seed: [{ source: '~/x.json', target: '../x.json' }] })).toThrow(/^machine need s seeds .* at \.\.\/x\.json, and a seed lands inside the state directory$/);
  expect(one({ state: '/s', seed: [{ source: '~/x.json', target: '/x.json' }] })).toThrow(/and a seed lands inside the state directory$/);
  expect(one({ state: '/s', seed: [{ source: '~/skills', keep: ['a'] }] })).toThrow(/^machine need s seeds .*skills, a directory, and keep and drop are only for a JSON file$/);
  // A key that walks into an object's prototype is never a key of the file.
  for (const key of ['__proto__', 'constructor', 'prototype']) {
    expect(one({ state: '/s', seed: [{ source: '~/x.json', drop: [`${key}.toString`] }] }))
      .toThrow(new RegExp(`^machine need s seeds .*x\\.json with ${key}, and keep and drop name a file's own keys$`));
    expect(one({ state: '/s', seed: [{ source: '~/x.json', keep: [key] }] })).toThrow(/name a file's own keys$/);
  }
  expect(one({ state: '/s', seed: [{ source: '~/x.json', drop: ['a.prototype'] }] })).toThrow(/with prototype,/);
  // An absent source is the seed's own business when the machine is made.
  expect(one({ state: '/s', seed: [{ source: '~/gone.json', drop: ['a.b'] }] })()).toHaveLength(1);
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

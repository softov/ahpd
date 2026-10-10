import { describe, expect, it } from 'vitest';
import { fromEnvRef, readSecret, readSecrets, scopeOf, secretRef } from '../src/vault.js';
import { pluginHost } from '../src/plugins.js';
import { sdkVersion } from '../src/version.js';
import type { PluginContext } from '../src/types/plugin.js';
import type { Vault } from '../src/types/vault.js';

/*
 * The scope rule, on its own.
 *
 * A store answers a name it holds and knows nothing of who is asking, so what
 * is left to check is the grammar of a name and the work that decides whether
 * it may be read - decision `a-secret-is-named-in-a-host-team-or-user-scope`.
 */

const held = (...secrets: string[]): Vault => {
  const map = new Map(secrets.map((one, at) => [one, `value-${at}`]));
  return {
    get: async (name) => map.get(name),
    set: async (name, value) => { map.set(name, value); },
    delete: async (name) => map.delete(name),
    list: async () => [...map.keys()].sort(),
  };
};

const NUL = String.fromCharCode(0);
const DELETE = String.fromCharCode(127);

describe('scopeOf', () => {
  it('reads the three forms', () => {
    expect(scopeOf('host:github-token')).toEqual({ scope: 'host' });
    expect(scopeOf('team:backend/openai-key')).toEqual({ scope: 'team', team: 'backend' });
    expect(scopeOf('user:softov/repo-token')).toEqual({ scope: 'user', user: 'softov' });
  });

  it('refuses a name holding a space or a control character in any part', () => {
    // Both are invisible where the name is read: `host:x` and a newline after it
    // look like the same two words in a log, and beside it.
    const refused = [
      'host: ', 'host:two words', 'team:back end/key', 'user:softov/to ken',
      'host:x\n', 'team:backend/key\n', `host:x${NUL}`, `host:x${DELETE}`,
    ];
    for (const name of refused) {
      expect(() => scopeOf(name)).toThrow(/host:<name>, team:<team>\/<name> or user:<id>\/<name>/);
    }
  });

  it('names the three forms for anything else, an empty part included', () => {
    for (const bad of ['github-token', 'host:', 'team:/openai-key', 'team:backend/', 'team:backend', 'user:/key', 'project:a/b', ':x']) {
      expect(() => scopeOf(bad)).toThrow(/host:<name>, team:<team>\/<name> or user:<id>\/<name>/);
    }
  });
});

describe('secretRef', () => {
  it('answers the name of a reference', () => {
    expect(secretRef({ $secret: 'host:x' })).toBe('host:x');
  });

  it('answers nothing for anything that is not one reference', () => {
    for (const not of ['host:x', 3, null, undefined, ['host:x'], {}, { $secret: 'host:x', extra: 1 }, { $secret: 3 }]) {
      expect(secretRef(not)).toBeUndefined();
    }
  });
});

describe('readSecret', () => {
  it('reads a host secret for any work', async () => {
    const vault = held('host:x', 'team:backend/key', 'user:softov/token');
    await expect(readSecret(vault, 'host:x')).resolves.toBe('value-0');
    await expect(readSecret(vault, 'host:x', { owner: 'root:host' })).resolves.toBe('value-0');
  });

  it('reads a team secret for its own team and refuses it for another', async () => {
    const vault = held('team:backend/key');
    await expect(readSecret(vault, 'team:backend/key', { team: 'backend' })).resolves.toBe('value-0');
    await expect(readSecret(vault, 'team:backend/key', { team: 'other' })).rejects.toThrow(
      'team:backend/key is not a secret this work may read',
    );
    // Nothing charged to a team at all is still not that team.
    await expect(readSecret(vault, 'team:backend/key')).rejects.toThrow('is not a secret this work may read');
  });

  it('reads a user secret for that person and refuses it for the host', async () => {
    const vault = held('user:softov/token');
    await expect(readSecret(vault, 'user:softov/token', { owner: 'user:softov' })).resolves.toBe('value-0');
    await expect(readSecret(vault, 'user:softov/token', { owner: 'root:host' })).rejects.toThrow(
      'user:softov/token is not a secret this work may read',
    );
    await expect(readSecret(vault, 'user:softov/token', { owner: 'user:bruno' })).rejects.toThrow(
      'is not a secret this work may read',
    );
  });

  it('says which name the vault does not hold, and asks for the name before it is read', async () => {
    await expect(readSecret(held('host:x'), 'host:absent')).rejects.toThrow('the vault holds no host:absent');
    // A name nobody may read is refused without the vault ever being asked.
    let asked = 0;
    const watched: Vault = { ...held('host:x'), get: async () => { asked += 1; return 'value'; } };
    await expect(readSecret(watched, 'user:softov/token', { owner: 'root:host' })).rejects.toThrow('is not a secret this work may read');
    expect(asked).toBe(0);
  });

  it('refuses a name it would not write either', async () => {
    await expect(readSecret(held('host:x'), 'host:x\n')).rejects.toThrow(/host:<name>/);
  });
});

const context = (): PluginContext => ({
  path: '/tmp/vault', paths: ['/tmp/vault'], version: sdkVersion(), hostName: 'test', configDir: '/tmp/vault', log: () => {}, say: () => {},
});

describe('PluginHost.secret', () => {
  it('reads the live port, under the scope of the work it was asked for', async () => {
    let store: Vault | undefined = held('host:x');
    const { host } = pluginHost('probe', context(), { vault: () => store });

    await expect(host.secret('host:x')).resolves.toBe('value-0');
    await expect(host.secret('user:softov/token', { owner: 'user:softov' })).rejects.toThrow('the vault holds no');

    // Nothing is read while the plugin applies, which is the point: the plugin
    // that registers a vault may load after this one.
    store = held('host:x', 'user:softov/token');
    await expect(host.secret('user:softov/token', { owner: 'user:softov' })).resolves.toBe('value-1');
    await expect(host.secret('user:softov/token', { owner: 'user:bruno' })).rejects.toThrow('is not a secret this work may read');
  });

  it('says a host with no vault cannot read a name at all', async () => {
    const { host } = pluginHost('probe', context());
    await expect(host.secret('host:x')).rejects.toThrow('host:x cannot be read: this host has no vault');
  });
});

/*
 * The two readers a plugin's preset map is read through.
 *
 * `fromEnvRef` is `secretRef`'s sibling and takes its rule: the one key is the
 * whole of it. `readSecrets` is one preset's `env`, read through the host, so
 * the loader is not the one asking for a credential - decision
 * `a-secret-is-named-in-a-host-team-or-user-scope`.
 */

describe('fromEnvRef', () => {
  it('answers the variable of a reference', () => {
    expect(fromEnvRef({ fromEnv: 'X' })).toBe('X');
  });

  it('answers nothing for anything that is not one reference', () => {
    // The empty name is not one either: there is no variable called nothing.
    for (const not of ['X', 3, null, undefined, ['X'], {}, { fromEnv: '' }, { fromEnv: 'X', other: 1 }, { fromEnv: 3 }]) {
      expect(fromEnvRef(not)).toBeUndefined();
    }
  });
});

describe('readSecrets', () => {
  const hostWith = (vault?: Vault) => pluginHost('probe', context(), vault === undefined ? {} : { vault: () => vault }).host;

  it('reads a reference and passes anything else through whole', async () => {
    const host = hostWith(held('host:x'));
    await expect(readSecrets(host, { KEY: { $secret: 'host:x' } }, 'options.presets.work.env'))
      .resolves.toEqual({ KEY: 'value-0' });
    // A value that is not a reference is the caller's to check, not this one's.
    await expect(readSecrets(host, { A: 'plain', B: null, C: 1 }, 'options.presets.work.env'))
      .resolves.toEqual({ A: 'plain', B: null, C: 1 });
    await expect(readSecrets(host, undefined, 'options.presets.work.env')).resolves.toEqual({});
  });

  it('says which preset and which variable named a secret it could not read', async () => {
    await expect(readSecrets(hostWith(held('host:x')), { KEY: { $secret: 'host:absent' } }, 'options.presets.work.env'))
      .rejects.toThrow('options.presets.work.env.KEY names host:absent: the vault holds no host:absent');
    await expect(readSecrets(hostWith(), { KEY: { $secret: 'host:x' } }, 'options.presets.work.env'))
      .rejects.toThrow('options.presets.work.env.KEY names host:x: host:x cannot be read: this host has no vault');
  });
});
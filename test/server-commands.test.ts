/*
 * The declarations themselves, checked before anything runs them.
 *
 * `pnpm test` runs this without a terminal, a daemon or a temporary
 * configuration directory: what it asks is whether the registry the program is
 * built from is complete - every command valid, every flag a run takes
 * declared, and every command saying which grant it needs. Building the
 * registry validates each declaration, so an invalid one fails here.
 */

import { describe, expect, it } from 'vitest';
import { cliRegistry } from '../packages/server/src/commands/registry.js';

const registry = cliRegistry();

/** Every flag the pinning cases pin, which `ahpd start` has to declare. */
const DAEMON_FLAGS = [
  '--port', '--host', '--stdio', '--path', '--connection-token',
  '--connection-token-file', '--without-connection-token', '--config-file',
  '--users', '--resource', '--issuer', '--trust-token', '--advanced-tools',
  '--automations', '--sessions', '--wire', '--plugin', '--no-plugins',
  '--no-update-check',
];

describe('the command registry', () => {
  it('validates every command and every need', () => {
    expect(() => registry.verify()).not.toThrow();
  });

  it('gives start every daemon flag, spelled as it always was', () => {
    const start = registry.find('daemon.start');
    expect(start).toBeDefined();
    const options = start?.options ?? [];
    const names = new Set(options.map((option) => option.name));
    expect(DAEMON_FLAGS.filter((name) => !names.has(name))).toEqual([]);
    // The two repeatable ones collect rather than overwrite.
    const repeatable = new Set(options.filter((option) => option.repeatable === true).map((option) => option.name));
    expect([...repeatable].sort()).toEqual(['--path', '--plugin']);
  });

  it('says which grant each command needs', () => {
    const scopes = (id: string): readonly string[] => registry.find(id)?.scopes ?? [];
    expect(scopes('daemon.status')).toEqual([]);
    expect(scopes('plugin.list')).toEqual([]);
    expect(scopes('daemon.config')).toEqual(['config:write']);
    expect(scopes('plugin.install')).toEqual(['config:write']);
    expect(scopes('plugin.remove')).toEqual(['config:write']);
    for (const id of ['user.list', 'user.add', 'user.rm', 'user.token']) {
      expect(scopes(id)).toEqual(['admin']);
    }
  });
});

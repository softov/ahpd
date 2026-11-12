/*
 * A key a plugin mints names one person, and only while the plugin is loaded.
 *
 * The key is never written anywhere: the fixture leaves it on `globalThis`, in
 * this process's memory, and every check here says what it does rather than
 * what it is. What is under test is the daemon's own wiring - the plugin set
 * minting and holding the key, the directory answering the person, and the door
 * admitting a connection that presents it with that person's grants.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { doorOf, fileUsers } from '@ahpd/sdk';
import { pluginSet } from '../src/plugins.js';
import { identifyWith } from '../src/commands/run.js';
import type { PluginSet, StagedPlugin } from '../src/plugins.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';
import type { Users } from '../../sdk/src/types/users.js';

const FIXTURES = join(import.meta.dirname, 'fixtures');
/** The id the fixture's module exports, which is what the set holds it under. */
const PLUGIN = 'person-key';
/** The deployment's own token, so the door is one with a host key as well as a directory. */
const DEPLOYMENT = 'the-deployment-token';

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'ahpd-person-key-')); });
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
  delete (globalThis as typeof globalThis & { __personKey?: unknown }).__personKey;
});

/** What the fixture minted, read off this process's memory and nowhere else. */
const minted = (): { person: string; key: string } | undefined =>
  (globalThis as typeof globalThis & { __personKey?: { person: string; key: string } }).__personKey;

/** A directory with one person who may write the configuration, and one with no role. */
const directory = (
  users: { id: string; roles: string[]; requireIssuer?: boolean }[] = [
    { id: 'ada', roles: ['keeper'] },
    { id: 'bo', roles: [] },
  ],
): ReturnType<typeof fileUsers> => {
  const file = join(home, 'users.json');
  writeFileSync(file, JSON.stringify({ roles: { keeper: ['config:write'] }, users }));
  return fileUsers({ path: file });
};

/** A set loaded over that directory, with nothing else on the host. */
const setOf = (users: Users): PluginSet => pluginSet({
  base: { path: home, agents: [], users } as HostOptions,
  configDir: FIXTURES,
  cwd: import.meta.dirname,
  log: () => {},
});

/** Plan and load the fixture, asking it to mint a key for `person`. */
const load = async (set: PluginSet, person: string): Promise<StagedPlugin> => {
  const spec: PluginSpec = { source: './fixtures/plugin-person-key', options: { person } };
  const { entries, problems } = await set.plan([spec]);
  expect(problems).toEqual([]);
  return await set.load(entries[0]!);
};

describe('a key a plugin mints', () => {
  it('admits its person, with the grants their record gives them', async () => {
    const users = directory();
    const set = setOf(users);
    const staged = await load(set, 'ada');
    expect(staged.problems).toEqual([]);
    expect(staged.loaded?.name).toBe(PLUGIN);

    const held = minted();
    expect(held?.person).toBe('ada');
    expect(held?.key).toBeTypeOf('string');
    // The set is the only thing that knows the key, and it names the person.
    expect(set.personOf(held!.key)).toBe('ada');

    const door = doorOf({ token: DEPLOYMENT, root: true, identify: identifyWith(users, () => set) });
    const arrival = await door(`ws://host.example.com/?tkn=${encodeURIComponent(held!.key)}`, null);
    expect(arrival.admitted).toBe(true);
    if (!arrival.admitted) throw new Error('the key was not admitted');
    expect(arrival.principal?.id).toBe('ada');
    expect(arrival.principal?.can('config:write')).toBe(true);
    // The other person's role gives nothing, and the key names only this one.
    expect(arrival.principal?.can('session:write')).toBe(false);

    await set.unload(PLUGIN);
  });

  it('answers no key for a person whose record requires the issuer', async () => {
    // A local token does not sign this person in, so a minted key would be
    // exactly the sign-in their record refuses.
    const set = setOf(directory([{ id: 'ada', roles: ['keeper'], requireIssuer: true }]));
    const staged = await load(set, 'ada');

    // Asking is not a mistake: the plugin loads, and is told there is no key.
    expect(staged.problems).toEqual([]);
    expect(staged.loaded?.name).toBe(PLUGIN);
    expect(minted()).toBeUndefined();
  });

  it('refuses a person the users directory does not have, naming the id', async () => {
    const set = setOf(directory());
    const staged = await load(set, 'nobody');
    expect(staged.loaded).toBeUndefined();
    const said = staged.problems.join('\n');
    expect(said).toContain('nobody');
    expect(said).toContain('no such person');
    expect(minted()).toBeUndefined();
  });

  it('is refused once its plugin has unloaded', async () => {
    const users = directory();
    const set = setOf(users);
    const staged = await load(set, 'ada');
    expect(staged.problems).toEqual([]);
    const held = minted();
    expect(held).toBeDefined();

    expect(await set.unload(PLUGIN)).toEqual([]);
    expect(set.personOf(held!.key)).toBeUndefined();

    const door = doorOf({ token: DEPLOYMENT, root: true, identify: identifyWith(users, () => set) });
    expect(await door(`ws://host.example.com/?tkn=${encodeURIComponent(held!.key)}`, null)).toEqual({ admitted: false });
  });
});

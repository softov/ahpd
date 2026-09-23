import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, GATE, ROOT } from '../packages/sdk/src/host.js';
import { fileResources, uriOf } from '../packages/sdk/src/resources.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { ResourceProvider } from '../packages/sdk/src/types/resources.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';
import type { Grant, Users } from '../packages/sdk/src/types/users.js';

/*
 * The one gate.
 *
 * Every command a client sends passes it once, and a host with no user
 * directory refuses nothing - which is the case most of these assert, because
 * it is the one every existing install is in.
 */

const REPO = join(import.meta.dirname, '..');
const RECORD = { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: ['https://example.test'], required: false };

let root: string;
let file: string;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ahpd-gate-'));
  file = join(root, 'a.txt');
  writeFileSync(file, 'on disk');
});
afterEach(() => { rmSync(root, { recursive: true, force: true }); });

const peer = (): Peer => ({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} });

/** A directory whose tokens are decided by hand, so a role is one array. */
const directory = (tokens: Record<string, Grant[]>): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const held = tokens[token];
    return held === undefined ? undefined : { id: token, roles: ['r'], can: (one: Grant) => held.includes(one) };
  },
  list: async () => [],
  add: async () => {},
  remove: async () => false,
  mint: async () => '',
});

const host = (extra: Partial<HostOptions> = {}) => createHost({
  path: root,
  agents: [{ ...echo({ path: root, pace: 0 }), provider: 'base', displayName: 'Base' }],
  resources: fileResources(),
  ...extra,
});

const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>) => client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
});

const signIn = (client: ReturnType<ReturnType<typeof createHost>['accept']>, token: string) => client.handle({
  method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token },
});

/** The refusal, or the result, whichever the host answered with. */
const call = async (client: ReturnType<ReturnType<typeof createHost>['accept']>, method: string, params: Record<string, unknown>) =>
  client.handle({ method, params }).then(
    (result) => ({ result }),
    (error: { code: number; message: string; data?: unknown }) => error,
  );

it('classifies every handler the host serves', () => {
  /*
   * Read out of the source, because the literal is rebuilt per connection and
   * there is no other list. A handler added and classified nowhere is a method
   * nobody decided about, and this fails on the next run rather than serving it
   * to anybody - which is the property `needsWrite` did not have.
   */
  const source = readFileSync(join(REPO, 'packages/sdk/src/host.ts'), 'utf8');
  const served = [...source.matchAll(/^ {8}([a-zA-Z][A-Za-z0-9]*): (?:async )?\(params\)/gm)].map((one) => one[1] as string);
  expect(served.length).toBeGreaterThan(25);

  const classified = new Set([...Object.keys(GATE.NEEDS), ...GATE.UNGATED]);
  expect(served.filter((one) => !classified.has(one))).toEqual([]);
  // And the check would notice one: a method in neither list is exactly what
  // the line above looks for.
  expect(['listSessions', 'a_handler_nobody_classified'].filter((one) => !classified.has(one)))
    .toEqual(['a_handler_nobody_classified']);
});

it('refuses nothing at all with no user directory', async () => {
  const client = host().accept(peer());
  await hello(client);
  // The handful that the gate would otherwise decide, driven with no principal.
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ result: { items: [] } });
  expect(await call(client, 'resourceRead', { channel: ROOT, uri: uriOf(file) })).toMatchObject({ result: { data: 'on disk' } });
  // Past the gate and refused for the reason it always was: this host has no
  // automation store, which is `-32601` and not a permission.
  expect(await call(client, 'runAutomation', { channel: 'ahp-automations://', automation: 'x' })).toMatchObject({ code: -32601 });
});

it('asks a connection to sign in before it may do anything, and serves the way in', async () => {
  const client = host({ users: directory({ m: ['read'] }) }).accept(peer());
  await hello(client);

  const refused = await call(client, 'listSessions', { channel: ROOT });
  expect(refused).toMatchObject({ code: -32007 });
  expect((refused as { data: { resources: { resource: string }[] } }).data.resources)
    .toEqual([expect.objectContaining({ resource: RECORD.resource })]);

  // The handshake, the liveness check, the discovery a client reads to find
  // where to sign in, and the sign-in itself are all served.
  expect(await call(client, 'ping', {})).toHaveProperty('result');
  expect(await call(client, 'subscribe', { channel: ROOT })).toHaveProperty('result');
  await expect(signIn(client, 'nobody')).rejects.toMatchObject({ code: -32007 });
  // A session channel is not the discovery, so it is not free.
  expect(await call(client, 'subscribe', { channel: 'ahp-session:/x' })).toMatchObject({ code: -32007 });
});

it('serves a member what it has, and refuses what it has not with nothing to negotiate', async () => {
  const client = host({ users: directory({ m: ['read', 'write', 'session', 'terminal'] }) }).accept(peer());
  await hello(client);
  await signIn(client, 'm');

  expect(await call(client, 'resourceWrite', {
    channel: ROOT, uri: uriOf(join(root, 'written.txt')), data: 'x', encoding: 'utf-8',
  })).toEqual({ result: {} });

  const refused = await call(client, 'runAutomation', { channel: ROOT, automation: 'x' });
  expect(refused).toMatchObject({ code: -32009 });
  // No `request`: a role is not a negotiation, and its absence is what tells a
  // client to stop rather than retry.
  expect((refused as { data?: unknown }).data).toEqual({});
});

it('serves a read-only role reads and refuses its writes', async () => {
  const client = host({ users: directory({ v: ['read'] }) }).accept(peer());
  await hello(client);
  await signIn(client, 'v');

  expect(await call(client, 'resourceRead', { channel: ROOT, uri: uriOf(file) })).toMatchObject({ result: { data: 'on disk' } });
  expect(await call(client, 'resourceWrite', {
    channel: ROOT, uri: uriOf(join(root, 'no.txt')), data: 'x', encoding: 'utf-8',
  })).toMatchObject({ code: -32009 });
  expect(await call(client, 'createTerminal', { channel: 'ahp-terminal:/t', cwd: root })).toMatchObject({ code: -32009 });
});

it('scopes a capability to the URI scheme, so plain write is not a plugin\'s scheme', async () => {
  const provider: ResourceProvider = { read: async () => ({ data: 'machine', encoding: 'utf-8' }) };

  const plain = host({ users: directory({ p: ['read', 'write'] }), resourceProviders: { computer: provider } }).accept(peer());
  await hello(plain);
  await signIn(plain, 'p');
  expect(await call(plain, 'resourceRead', { channel: ROOT, uri: uriOf(file) })).toMatchObject({ result: { data: 'on disk' } });
  const refused = await call(plain, 'resourceRead', { channel: ROOT, uri: 'computer://box/status' });
  expect(refused).toMatchObject({ code: -32009 });
  expect((refused as { message: string }).message).toContain('read:computer');

  // Named, and it is then served there and not on the file it never named.
  const named = host({ users: directory({ q: ['read:computer'] }), resourceProviders: { computer: provider } }).accept(peer());
  await hello(named);
  await signIn(named, 'q');
  expect(await call(named, 'resourceRead', { channel: ROOT, uri: 'computer://box/status' }))
    .toEqual({ result: { data: 'machine', encoding: 'utf-8' } });
  expect(await call(named, 'resourceRead', { channel: ROOT, uri: uriOf(file) })).toMatchObject({ code: -32009 });
});

it('takes the capability away the moment the credential is given back', async () => {
  const client = host({ users: directory({ m: ['session'] }) }).accept(peer());
  await hello(client);
  await signIn(client, 'm');
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ result: { items: [] } });

  await signIn(client, '');
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ code: -32007 });
});

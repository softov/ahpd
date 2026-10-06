import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost, GATE, ROOT } from '../src/host.js';
import { uriOf } from '../src/resources.js';
import { fileUsers } from '../src/users.js';
import { memoryAutomations } from '../src/automations.js';
import { fileUsage, usageProvider } from '../src/usage.js';
import { echo } from '../../../examples/echo/agent.js';
import {
  RECORD, call, can, directory, file, hello, host, peer, root, signIn, watching,
} from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { ResourceProvider } from '../src/types/resources.js';
import type { Grant, Users } from '../src/types/users.js';

/**
 * A directory whose people also carry what their work may be charged to.
 *
 * `directory` answers only what somebody may do, and `poolsFor` is asked the
 * other question - which pools a person may see - so the principals here carry
 * memberships as well as grants.
 */
const people = (tokens: Record<string, Grant[]>, memberships: Record<string, string[]>): Users => {
  const base = directory(tokens);
  const verify = base.verify;
  return {
    ...base,
    verify: async (token) => {
      const held = await verify(token);
      return held === undefined ? undefined : { ...held, memberships: memberships[token] ?? [] };
    },
  };
};

/**
 * A signed-in client holding exactly these grants, whose refusals are kept.
 *
 * `withRole` answers out of a directory, which is written in groups; this is
 * for the roles that hold one operation of their own.
 */
const holding = async (made: ReturnType<typeof host>, id: string, granted: Grant[]) => {
  const seen = watching();
  const client = made.accept(seen, { id, roles: ['r'], can: can(granted) });
  await hello(client, id);
  const refused = () => seen.seen
    .filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => `${String(one.params.channel)}: ${String(one.params.rejectionReason)}`);
  const send = async (channel: string, action: Bag) => {
    client.handle({ method: 'dispatchAction', params: { channel, action } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { client, seen, refused, send };
};

it('asks one operation where the table gives one, and both where it gives both', async () => {
  const made = host({
    users: directory({}),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    automations: memoryAutomations(),
  });

  /*
   * A role of one act and one read: it may say something in a chat and it may
   * not close the session the chat is in, which is the whole point of an
   * operation over a verb - under `session:write` both came together.
   */
  const opener = await holding(made, 'o', ['session:read', 'session:create', 'chat:create']);
  expect(await call(opener.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(opener.client, 'createChat', { channel: 'ahp-session:/one', chat: 'ahp-chat:/one' })).toHaveProperty('result');

  const talker = await holding(made, 't', ['session:read', 'chat:send']);
  await talker.send('ahp-session:/one', { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } });
  expect(talker.refused()).toEqual([]);
  expect((await call(talker.client, 'disposeSession', { channel: 'ahp-session:/one' })) as { message: string })
    .toMatchObject({ code: -32009, message: 't may not session:dispose here' });
  // Forking is its own operation, so a role that may only start a chat may not
  // fork one - and `session:write` is not a way round it either.
  expect((await call(opener.client, 'createChat', {
    channel: 'ahp-session:/one', chat: 'ahp-chat:/fork', source: { kind: 'fork', chat: 'ahp-chat:/one' },
  })) as { message: string }).toMatchObject({ code: -32009, message: 'o may not chat:fork here' });

  // The automations are the same shape: editing one is not running it.
  const editor = await holding(made, 'e', ['automation:read', 'automation:update']);
  expect((await call(editor.client, 'runAutomation', { channel: 'ahp-automations://', automation: 'x' })) as { message: string })
    .toMatchObject({ code: -32009, message: 'e may not automation:run here' });
});

it('reads one record of a scheme without listing the scheme', async () => {
  const provider: ResourceProvider = {
    read: async () => ({ data: '{"id":"ana"}', encoding: 'utf-8' }),
    list: async () => [{ name: 'ana', type: 'file' }],
  };
  const made = host({ users: directory({}), resourceProviders: { user: provider } });

  const one = await holding(made, 'u', ['user:get']);
  expect(await call(one.client, 'resourceRead', { channel: ROOT, uri: 'user://ana' })).toHaveProperty('result');
  expect((await call(one.client, 'resourceList', { channel: ROOT, uri: 'user://' })) as { message: string })
    .toMatchObject({ code: -32009, message: 'u may not user:list here' });

  // The read group is both of them, which is what a role written before the
  // split meant and still means.
  const both = await holding(made, 'r', ['user:read']);
  expect(await call(both.client, 'resourceRead', { channel: ROOT, uri: 'user://ana' })).toHaveProperty('result');
  expect(await call(both.client, 'resourceList', { channel: ROOT, uri: 'user://' })).toHaveProperty('result');
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

/** A turn of the loop, so a `shutdown` that answered first has stopped by now. */
const tick = (): Promise<void> => new Promise((done) => { setTimeout(done, 20); });

it('does not let a connection that is nobody stop the daemon', async () => {
  /*
   * `shutdown` was served and classified nowhere, so any connection that had
   * completed a handshake could stop the daemon - and in the daemon it is
   * `SIGTERM`, so it takes every session on the machine with it. It has a
   * grant now: decision `shutdown-needs-config-change`.
   */
  let stopped = 0;
  const made = host({
    users: directory({ m: ['file:read'] }),
    diagnostics: { shutdown: () => { stopped += 1; } },
  });
  const client = made.accept(peer());
  await hello(client);

  // Refused before it is asked for a grant, because it is first nobody: the
  // sign-in is what a connection that has not introduced itself is owed.
  expect(await call(client, 'shutdown', {})).toMatchObject({ code: -32007 });
  await tick();
  expect(stopped).toBe(0);

  // And a name the host serves no handler for keeps the answer it always had:
  // the refusal above is a gate's, not a missing method's.
  expect(await call(client, 'nothingAtAll', {})).toMatchObject({ code: -32601 });
});

it('refuses a served method nobody classified, rather than serving it to anybody', async () => {
  /*
   * The branch the whole fix turns on. `capabilityFor` read the absent row as
   * "needs no grant", so an entry nobody wrote was the widest answer there is
   * rather than the narrowest - which is how `shutdown` reached a connection
   * that had not signed in.
   *
   * Every method this host serves is classified now, so the only way to stand
   * in the state the fix guards against is to take a row away, which is what a
   * handler added later and classified nowhere would be. It is put back in a
   * `finally`, because the table is the module's and the tests after this one
   * read it.
   */
  let stopped = 0;
  const made = host({
    users: directory({ m: ['file:read'] }),
    diagnostics: { shutdown: () => { stopped += 1; } },
  });
  const client = made.accept(peer());
  await hello(client, 'm'); await signIn(client, 'm');

  const row = GATE.NEEDS['shutdown'];
  delete GATE.NEEDS['shutdown'];
  try {
    expect(await call(client, 'shutdown', {})).toMatchObject({
      code: -32009,
      message: 'This host has classified shutdown nowhere, so it serves it to nobody',
    });
  }
  finally {
    if (row !== undefined) GATE.NEEDS['shutdown'] = row;
  }
  await tick();
  expect(stopped).toBe(0);
});

it('gates shutdown on config:change and the managed-settings read on diagnostics:network', async () => {
  /*
   * Both were served and classified nowhere, so every connection that had
   * completed a handshake reached them: `shutdown` is `SIGTERM` to the daemon,
   * and the managed settings are the window's own troubleshooting pane -
   * decision `shutdown-needs-config-change`.
   */
  let stopped = 0;
  const made = host({
    users: directory({ m: ['file:read'], g: ['session:read'] }),
    diagnostics: { shutdown: () => { stopped += 1; } },
  });

  // A member may not stop the daemon, and is told which grant it lacks rather
  // than that nobody classified the method.
  const member = made.accept(peer());
  await hello(member, 'm'); await signIn(member, 'm');
  expect(await call(member, 'shutdown', {}))
    .toMatchObject({ code: -32009, message: 'm may not config:change here' });
  await tick();
  expect(stopped).toBe(0);

  // A person holding it may, which is what the grant is for.
  const keeper = await holding(made, 'c', ['config:change']);
  expect(await call(keeper.client, 'shutdown', {})).toEqual({ result: {} });
  await tick();
  expect(stopped).toBe(1);

  // And the door's own connection always may, as it may everything.
  const door = made.accept(peer(), undefined, true);
  await hello(door);
  expect(await call(door, 'shutdown', {})).toEqual({ result: {} });
  await tick();
  expect(stopped).toBe(2);

  // The managed-settings read is asked beside `getNetworkDiagnosticsInfo`, for
  // the same pane, so it needs what that one needs.
  const guest = made.accept(peer());
  await hello(guest, 'g'); await signIn(guest, 'g');
  expect(await call(guest, 'getManagedSettingsDiagnostics', {}))
    .toMatchObject({ code: -32009, message: 'g may not diagnostics:network here' });

  const troubleshooter = await holding(made, 'd', ['diagnostics:network']);
  expect(await call(troubleshooter.client, 'getManagedSettingsDiagnostics', {})).toEqual({ result: [] });
});

it('asks a connection to sign in before it may do anything, and serves the way in', async () => {
  const client = host({ users: directory({ m: ['file:read'] }) }).accept(peer());
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
  const client = host({ users: directory({ m: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }) }).accept(peer());
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

it('serves a connection that arrived as somebody, with no authenticate', async () => {
  // A socket admitted on a personal connection token: the principal is on the
  // connection before the first frame, so the first command is served as them
  // and no `authenticate` is needed - decision
  // `a-connection-token-may-carry-a-person`.
  const made = host({ users: directory({ m: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }) });
  const granted: Grant[] = ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'];
  const client = made.accept(peer(), { id: 'm', roles: ['r'], can: can(granted) });
  await hello(client);
  expect(await call(client, 'listSessions', {})).toMatchObject({ result: {} });

  // And a connection admitted by the deployment's own token, which names
  // nobody, is refused exactly as it was until it signs in.
  const anonymous = made.accept(peer());
  await hello(anonymous);
  expect(await call(anonymous, 'listSessions', {})).toMatchObject({ code: -32007 });
});

/*
 * Who a connection is.
 *
 * The host has known this since the socket arrived or the person signed in,
 * and said nothing, so a client could not read their own `user://<id>` without
 * already knowing it. It is said in the `_meta` the protocol declares `_meta`
 * on: the handshake, and the root snapshot, which is built for one connection
 * at a time. The sign-in result is not one of them - `AuthenticateResult` is
 * declared empty - so a client that signs in after connecting learns who it
 * became by taking the root snapshot again.
 */

it('says who a connection arrived as, on the handshake and in the root snapshot', async () => {
  const MEMBER: Grant[] = ['file:read', 'file:write', 'session:read', 'session:write'];
  const made = host({ users: directory({ m: MEMBER }) });

  // A personal connection token: somebody before the first frame, so the
  // handshake is already the answer.
  const person = made.accept(peer(), { id: 'ana', roles: ['r'], can: can(MEMBER) });
  const shook = await hello(person, 'ana') as Bag;
  expect(shook._meta?.['ahpd.principal']).toBe('user:ana');
  // And the same statement in the snapshot, so a client that subscribes later
  // reads what a client that connected earlier was told.
  expect(await rootMeta(person)).toEqual({ 'ahpd.principal': 'user:ana' });

  // The deployment's own token is the host itself, which is a typed reference
  // like any other and not the absence of one.
  const door = made.accept(peer(), undefined, true);
  expect((await hello(door, 'door') as Bag)._meta?.['ahpd.principal']).toBe('root:host');
  expect(await rootMeta(door)).toEqual({ 'ahpd.principal': 'root:host' });
});

it('names no principal on a host with no people for one to be', async () => {
  // Every existing install is in this case, and the key is absent rather than
  // empty: there is nothing here to name, and saying "" would be a value.
  const client = host().accept(peer());
  expect((await hello(client) as Bag)._meta).not.toHaveProperty('ahpd.principal');
  expect(await rootMeta(client)).not.toHaveProperty('ahpd.principal');
});

it('says who it became to a client that signed in after connecting', async () => {
  const client = host({ users: directory({ m: ['file:read'] }) }).accept(peer());
  expect((await hello(client) as Bag)._meta).not.toHaveProperty('ahpd.principal');
  expect(await rootMeta(client)).not.toHaveProperty('ahpd.principal');

  // The sign-in says nothing itself: the protocol declares that result empty,
  // and a key there would be a field no client can read.
  expect(await signIn(client, 'm')).toEqual({});

  // The next root snapshot is where the update arrives.
  expect(await rootMeta(client)).toEqual({ 'ahpd.principal': 'user:m' });
});

it('gives two connections each their own principal and never the other', async () => {
  const made = host({ users: directory({ ana: [], bob: [] }) });
  const one = made.accept(peer());
  await hello(one, 'ana'); await signIn(one, 'ana');
  const other = made.accept(peer());
  await hello(other, 'bob'); await signIn(other, 'bob');

  expect(await rootMeta(one)).toEqual({ 'ahpd.principal': 'user:ana' });
  expect(await rootMeta(other)).toEqual({ 'ahpd.principal': 'user:bob' });

  // One person signing out does not rewrite the other's, in either direction:
  // the snapshot is built per connection, so there is no shared copy to be
  // left stale or overwritten.
  await signIn(other, '');
  expect(await rootMeta(one)).toEqual({ 'ahpd.principal': 'user:ana' });
  expect(await rootMeta(other)).not.toHaveProperty('ahpd.principal');
});

it('takes nobody else\'s principal out of a replayed root action', async () => {
  /*
   * The other way one connection's name could reach another is the replay
   * buffer, which is one per host. It holds actions rather than snapshots, and
   * a root action carries no `_meta`, so a client that comes back is answered
   * with ana's change and nothing of ana.
   */
  const ADMIN: Grant[] = ['file:read', 'config:write'];
  const made = host({ users: directory({ ana: ADMIN, bob: ADMIN }) });
  const one = made.accept(peer());
  await hello(one, 'ana'); await signIn(one, 'ana');
  await one.handle({
    method: 'dispatchAction',
    params: { channel: ROOT, action: { type: 'root/configChanged', config: { artifactToolsCompactPrompts: true } } },
  });

  const other = made.accept(peer());
  await hello(other, 'bob'); await signIn(other, 'bob');
  const answered = await other.handle({
    method: 'reconnect',
    params: { clientId: 'bob', subscriptions: [ROOT], lastSeenServerSeq: 0 },
  }) as Bag;
  const back = (answered.result ?? answered) as Bag;

  expect(JSON.stringify(back)).not.toContain('user:ana');
  expect(await rootMeta(other)).toEqual({ 'ahpd.principal': 'user:bob' });
});

it('serves a read-only role reads and refuses its writes', async () => {
  const client = host({ users: directory({ v: ['file:read'] }) }).accept(peer());
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

  const plain = host({ users: directory({ p: ['file:read', 'file:write'] }), resourceProviders: { computer: provider } }).accept(peer());
  await hello(plain);
  await signIn(plain, 'p');
  expect(await call(plain, 'resourceRead', { channel: ROOT, uri: uriOf(file) })).toMatchObject({ result: { data: 'on disk' } });
  const refused = await call(plain, 'resourceRead', { channel: ROOT, uri: 'computer://box/status' });
  expect(refused).toMatchObject({ code: -32009 });
  expect((refused as { message: string }).message).toContain('computer:get');

  // Named, and it is then served there and not on the file it never named.
  const named = host({ users: directory({ q: ['computer:read'] }), resourceProviders: { computer: provider } }).accept(peer());
  await hello(named);
  await signIn(named, 'q');
  expect(await call(named, 'resourceRead', { channel: ROOT, uri: 'computer://box/status' }))
    .toEqual({ result: { data: 'machine', encoding: 'utf-8' } });
  expect(await call(named, 'resourceRead', { channel: ROOT, uri: uriOf(file) })).toMatchObject({ code: -32009 });

  // The write half is scoped the same way: making a machine is `computer:put`
  // and a person who may only save files cannot make one.
  const writer: ResourceProvider = {
    read: async () => ({ data: 'machine', encoding: 'utf-8' }),
    write: async () => {},
  };
  const files = host({ users: directory({ w: ['file:read', 'file:write'] }), resourceProviders: { computer: writer } }).accept(peer());
  await hello(files);
  await signIn(files, 'w');
  const refusedWrite = await call(files, 'resourceWrite', {
    channel: ROOT, uri: 'computer://box', data: '{}', encoding: 'utf-8',
  });
  expect(refusedWrite).toMatchObject({ code: -32009 });
  expect((refusedWrite as { message: string }).message).toContain('computer:put');

  const allowed = host({ users: directory({ x: ['computer:write'] }), resourceProviders: { computer: writer } }).accept(peer());
  await hello(allowed);
  await signIn(allowed, 'x');
  expect(await call(allowed, 'resourceWrite', {
    channel: ROOT, uri: 'computer://box', data: '{}', encoding: 'utf-8',
  })).toMatchObject({ result: {} });
});

it('lets a person read their own usage pools, and refuses them another person\'s', async () => {
  /*
   * Every `usage:` URI is `usage:read` at the gate, which would refuse the very
   * person the scheme serves their own pools to. The provider's own `authorize`
   * is what opens those - decision `a-scheme-provider-may-authorize-a-read-itself`.
   */
  const usage = fileUsage({ folder: join(root, 'usage') });
  for (const [who, pool] of [['ana', 'user:ana'], ['bob', 'user:bob']] as const) {
    await usage.record({
      at: '2026-10-02T10:00:00.000Z',
      kind: 'model',
      source: 'proxy',
      owner: `user:${who}`,
      model: { name: 'anthropic/opus-5' },
      pools: [pool, 'team:backend'],
      cost: { amount: 0.25, currency: 'usd', from: 'harness' },
    });
  }
  const made = host({
    users: people(
      { ana: [], bob: [], keeper: ['usage:read'] },
      { ana: ['backend'], bob: ['frontend'] },
    ),
    usage,
    resourceProviders: { usage: usageProvider({ usage, timezone: 'UTC' }) },
  });

  // A guest with no `usage:read` at all: their own pool, their team's pool, and
  // the listing that says which pools those are.
  const ana = made.accept(peer());
  await hello(ana, 'ana'); await signIn(ana, 'ana');
  expect(await call(ana, 'resourceList', { channel: ROOT, uri: 'usage://' }))
    .toMatchObject({ result: { entries: [{ name: 'team:backend' }, { name: 'user:ana' }] } });
  expect(await call(ana, 'resourceRead', { channel: ROOT, uri: 'usage://user%3Aana' }))
    .toMatchObject({ result: { data: expect.stringContaining('"pool": "user:ana"') } });
  expect(await call(ana, 'resourceRead', { channel: ROOT, uri: 'usage://team%3Abackend/month' }))
    .toMatchObject({ result: { data: expect.stringContaining('"calls": 2') } });
  // Somebody else's is refused by the gate, with the host's own sentence.
  expect(await call(ana, 'resourceRead', { channel: ROOT, uri: 'usage://user%3Abob' }))
    .toMatchObject({ code: -32009, message: 'ana may not usage:get here' });

  // A role naming `usage:read` reads every pool the store holds.
  const keeper = made.accept(peer());
  await hello(keeper, 'keeper'); await signIn(keeper, 'keeper');
  expect(await call(keeper, 'resourceList', { channel: ROOT, uri: 'usage://' }))
    .toMatchObject({ result: { entries: [{ name: 'team:backend' }, { name: 'user:ana' }, { name: 'user:bob' }] } });
  expect(await call(keeper, 'resourceRead', { channel: ROOT, uri: 'usage://user%3Abob' }))
    .toMatchObject({ result: { data: expect.stringContaining('"pool": "user:bob"') } });
});

it('lets a socket on the deployment token do everything, and nothing demotes it', async () => {
  /*
   * The deployment's token is the host's own key, so it is the host: no
   * `authenticate`, every capability including a scheme no role names, and
   * signing in or out on that connection does not change it - decision
   * `the-door-token-is-the-host`.
   */
  const provider: ResourceProvider = { read: async () => ({ data: 'machine', encoding: 'utf-8' }) };
  const made = host({ users: directory({ m: ['file:read'] }), resourceProviders: { computer: provider } });
  const client = made.accept(peer(), undefined, true);
  await hello(client);

  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ result: { items: [] } });
  // `computer:read` is a subject no role here names, and it is served anyway.
  expect(await call(client, 'resourceRead', { channel: ROOT, uri: 'computer://box/status' }))
    .toEqual({ result: { data: 'machine', encoding: 'utf-8' } });

  // Signing in as somebody with `read` only, and then signing out, leaves the
  // connection exactly as able as it was.
  await signIn(client, 'm');
  expect(await call(client, 'resourceRead', { channel: ROOT, uri: 'computer://box/status' }))
    .toEqual({ result: { data: 'machine', encoding: 'utf-8' } });
  await signIn(client, '');
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ result: { items: [] } });
});

it('reads the roles again on every command, so removal and a role change land at once', async () => {
  /*
   * The directory re-reads its file on every question, and the principal it
   * handed out resolves through that file as well, so `ahpd user rm` is refused
   * on the next command rather than the next connection - decision
   * `a-role-is-read-on-every-command`.
   */
  const usersPath = join(root, 'users.json');
  // A role of this deployment's own, so the change below is from a role that
  // lists sessions to one that only reads files.
  writeFileSync(usersPath, JSON.stringify({ roles: { files: ['file:read'] }, users: [] }));
  const people = fileUsers({ path: usersPath });
  await people.add('ana', ['member']);
  const secret = await people.mint('ana');

  const made = host({ users: people });
  const client = made.accept(peer());
  await hello(client);
  await signIn(client, secret);
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ result: { items: [] } });

  // A role change is in force on the next command, with no reconnection.
  await people.add('ana', ['files']);
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ code: -32009 });

  // And removal is "sign in again" rather than "your role does not cover that".
  await people.remove('ana');
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ code: -32007 });
});

it('takes the capability away the moment the credential is given back', async () => {
  const client = host({ users: directory({ m: ['session:read'] }) }).accept(peer());
  await hello(client);
  await signIn(client, 'm');
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ result: { items: [] } });

  await signIn(client, '');
  expect(await call(client, 'listSessions', { channel: ROOT })).toMatchObject({ code: -32007 });
});

/**
 * What the root snapshot tells this connection about itself. Absent bag where it says nothing.
 *
 * `ahpd.grants` is left out: it is the same map to everybody and says what a
 * role could hold, so it is not part of what one connection is told about
 * itself. `users-host.test.ts` asserts that key's own shape.
 */
const rootMeta = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<Bag> => {
  const snap = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as Bag;
  const { 'ahpd.grants': _grants, ...rest } = (snap.snapshot?.state?._meta ?? {}) as Bag;
  return rest;
};
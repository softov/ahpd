import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createHost, GATE, ROOT } from '../src/host.js';
import { fileResources, uriOf } from '../src/resources.js';
import { fileUsers } from '../src/users.js';
import { memorySessions } from '../src/sessions.js';
import { memoryAutomations } from '../src/automations.js';
import { shellTerminals } from '../src/terminals.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostOptions } from '../src/types/host.js';
import type { ChangesetSource } from '../src/types/changes.js';
import type { ResourceProvider } from '../src/types/resources.js';
import type { Peer } from '../src/types/rpc.js';
import type { Grant, Users } from '../src/types/users.js';

/*
 * The one gate.
 *
 * Every command a client sends passes it once, and a host with no user
 * directory refuses nothing - which is the case most of these assert, because
 * it is the one every existing install is in.
 */

const REPO = join(import.meta.dirname, '../../..');
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

/** A peer that keeps what it was told, for the half that answers with a notification. */
const watching = (): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

type Bag = Record<string, any>;

/** Everything a terminal has said on its channel so far. */
const said = (p: ReturnType<typeof watching>, uri: string): string => p.seen
  .filter((one) => one.method === 'action' && one.params.channel === uri && one.params.action?.type === 'terminal/data')
  .map((one) => String(one.params.action.data)).join('');

/** Wait until the terminal has said it, so a negative can be asserted against a positive. */
const until = async (p: ReturnType<typeof watching>, uri: string, text: string): Promise<string> => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    if (said(p, uri).includes(text)) return said(p, uri);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return said(p, uri);
};

/** A directory whose tokens are decided by hand, so a role is one array. */
const directory = (tokens: Record<string, Grant[]>): Users => ({
  resource: RECORD,
  verify: async (token) => {
    const held = tokens[token];
    return held === undefined ? undefined : { id: token, roles: ['r'], can: (one: Grant) => held.includes(one) };
  },
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
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

const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>, clientId = 'probe') => client.handle({
  method: 'initialize',
  params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
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
  /*
   * And the quoted ones, which are the reference client's extension methods.
   *
   * They were served and classified nowhere: the pattern above reads a bare
   * identifier, and every `vscode/*` handler is a string key, so nine methods
   * nobody decided about passed this test. The pattern for them takes any
   * parameter list, because a method that ignores its params is still a
   * method - and only quoted keys, because inside a handler's own body there
   * are object literals whose members look exactly like this and are not
   * methods of this host.
   */
  const quoted = [...source.matchAll(/^ {8}'([^']+)': (?:async )?\([^)]*\)\s*=>/gm)].map((one) => one[1] as string);
  expect(quoted.length).toBeGreaterThan(5);
  served.push(...quoted);
  expect(served.length).toBeGreaterThan(30);

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
  const client = made.accept(peer(), { id: 'm', roles: ['r'], can: (one: Grant) => granted.includes(one) });
  await hello(client);
  expect(await call(client, 'listSessions', {})).toMatchObject({ result: {} });

  // And a connection admitted by the deployment's own token, which names
  // nobody, is refused exactly as it was until it signs in.
  const anonymous = made.accept(peer());
  await hello(anonymous);
  expect(await call(anonymous, 'listSessions', {})).toMatchObject({ code: -32007 });
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
  expect((refused as { message: string }).message).toContain('computer:read');

  // Named, and it is then served there and not on the file it never named.
  const named = host({ users: directory({ q: ['computer:read'] }), resourceProviders: { computer: provider } }).accept(peer());
  await hello(named);
  await signIn(named, 'q');
  expect(await call(named, 'resourceRead', { channel: ROOT, uri: 'computer://box/status' }))
    .toEqual({ result: { data: 'machine', encoding: 'utf-8' } });
  expect(await call(named, 'resourceRead', { channel: ROOT, uri: uriOf(file) })).toMatchObject({ code: -32009 });

  // The write half is scoped the same way: making a machine is `computer:write`
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
  expect((refusedWrite as { message: string }).message).toContain('computer:write');

  const allowed = host({ users: directory({ x: ['computer:write'] }), resourceProviders: { computer: writer } }).accept(peer());
  await hello(allowed);
  await signIn(allowed, 'x');
  expect(await call(allowed, 'resourceWrite', {
    channel: ROOT, uri: 'computer://box', data: '{}', encoding: 'utf-8',
  })).toMatchObject({ result: {} });
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

/*
 * The other half of the gate.
 *
 * A dispatch is a notification, so it returns before the boundary every command
 * passes and has to be refused one layer in. It is the half that matters most:
 * root state hands every open terminal's URI to anybody who completes a
 * handshake, and `terminal/input` writes to a shell - so an ungated dispatch is
 * arbitrary command execution by somebody who never signed in.
 */

it('refuses a dispatch from a connection that never signed in, and root state still names the terminal', async () => {
  const owner = watching();
  const made = host({ users: directory({ m: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }), terminals: shellTerminals() });
  const client = made.accept(owner);
  await hello(client);
  await signIn(client, 'm');

  const uri = 'ahp-terminal:/gate';
  expect(await call(client, 'createTerminal', {
    channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: `file://${root}`,
  })).toHaveProperty('result');
  await call(client, 'subscribe', { channel: uri });

  // Somebody who never signed in, who is handed the URI by the handshake.
  const quiet = watching();
  const stranger = made.accept(quiet);
  const shook = await stranger.handle({
    method: 'initialize',
    params: { clientId: 'stranger', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  }) as Bag;
  expect(JSON.stringify(shook.snapshots)).toContain(uri);

  stranger.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'terminal/input', data: 'echo STRANGER-RAN-THIS\n' } } });

  // The owner's own command is the clock: once it has been echoed, anything the
  // stranger sent would have been too. A negative asserted against a positive
  // rather than against a sleep.
  client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'terminal/input', data: 'echo OWNER-RAN-THIS\n' } } });
  const after = await until(owner, uri, 'OWNER-RAN-THIS');
  expect(after).toContain('OWNER-RAN-THIS');
  expect(after).not.toContain('STRANGER-RAN-THIS');

  // And the stranger was told why, in the only way a notification can be.
  const rejected = quiet.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string');
  expect(rejected.length).toBeGreaterThan(0);
  expect(String(rejected[0]?.params.rejectionReason)).toContain('Sign in');
});

it('refuses a dispatch into a channel the role does not cover', async () => {
  const seen = watching();
  const made = host({ users: directory({ r: ['file:read', 'session:read'] }), terminals: shellTerminals() });
  const client = made.accept(seen);
  await hello(client);
  await signIn(client, 'r');

  // No `terminal`, so the channel is refused even though the person signed in.
  client.handle({ method: 'dispatchAction', params: { channel: 'ahp-terminal:/nope', action: { type: 'terminal/input', data: 'echo no\n' } } });
  const rejected = seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string');
  expect(rejected.length).toBeGreaterThan(0);
  expect(String(rejected[0]?.params.rejectionReason)).toContain('may not terminal');
});

it('classifies a dispatch by its channel', async () => {
  const made = host({
    users: directory({ t: ['terminal:read', 'terminal:write'], n: [] }),
    terminals: shellTerminals(),
  });
  const owner = await withRole(made, 't');
  expect(await call(owner.client, 'createTerminal', { channel: 'agenthost-terminal:/x', cwd: root })).toHaveProperty('result');
  const nobody = await withRole(made, 'n');
  /** What the host asks of somebody with no grants to dispatch this on that channel. */
  const needs = async (channel: string, action: Bag = { type: 'session/isReadChanged', isRead: true }): Promise<string | undefined> => {
    const before = nobody.refused().length;
    await nobody.send(channel, action);
    return /may not (\S+) here/.exec(nobody.refused()[before] ?? '')?.[1];
  };
  // A terminal is read off what the host holds, whatever its scheme.
  expect(await needs('ahp-terminal:/x', { type: 'terminal/input', data: '' })).toBe('terminal:write');
  expect(await needs('agenthost-terminal:/x', { type: 'terminal/input', data: '' })).toBe('terminal:write');
  // A session's channel, under any scheme a session can have.
  for (const channel of ['ahp-session:/x', 'ahp-chat:/x', 'claude:/x', 'claude:/x/annotations', 'claude:/x/changeset/main']) {
    expect(await needs(channel)).toBe('session:write');
  }
  expect(await needs('ahp-automations://', { type: 'automation/removed', id: 'x' })).toBe('automation:write');
  expect(await needs(ROOT, { type: 'root/configChanged', config: { artifactToolsCompactPrompts: true } })).toBe('config:write');
  expect(await needs(ROOT, { type: 'root/configChanged', replace: true, config: { defaultShell: '/bin/sh' } })).toBe('config:write');
  // The root is read with its action: a person's own keys need only a sign-in.
  expect(await needs(ROOT, { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } })).toBeUndefined();
  // A file, a watch and any other `ahp-` channel are the host's own names, and a file's grant
  // for an action no family claims; an action of a family is refused on them for what they are.
  for (const channel of ['file:///x', 'ahp-resource-watch:/x', 'ahp-sessionx:/x']) {
    expect(await needs(channel, { type: 'vendor/probe' })).toBe('file:read');
  }
  expect(GATE.dispatchNeeds(ROOT, 'other', { type: 'root/configChanged', config: { defaultShell: '/bin/sh', somethingNew: 1 } })).toBe('config:write');
});

it('dispatches freely with no user directory', async () => {
  const seen = watching();
  const client = host({ terminals: shellTerminals() }).accept(seen);
  await hello(client);
  const uri = 'ahp-terminal:/open';
  await call(client, 'createTerminal', { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: `file://${root}` });
  await call(client, 'subscribe', { channel: uri });
  client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'terminal/input', data: 'echo STILL-OPEN\n' } } });
  expect(await until(seen, uri, 'STILL-OPEN')).toContain('STILL-OPEN');
});

/*
 * The root record is two kinds of key.
 *
 * `defaultShell` is the person's - the host's own note by `rootConfig` says so,
 * and names VS Code pushing it on connect - so it lives on the connection and
 * reaches only the terminals that connection opens. Everything else describes
 * the host and is still one setting for everybody.
 *
 * That is also what retires the rule that setting it needed `terminal`: a
 * preference nobody else reads cannot aim anybody else's shell, and the paths
 * with no connection in hand (a `!command`, and the factory a backend opens a
 * terminal with) take the daemon's own shell and no person's at all.
 */

const configChanged = (client: ReturnType<ReturnType<typeof createHost>['accept']>, config: Record<string, unknown>) =>
  client.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', config } } });

/** What this connection reads back out of root state. */
const values = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<Record<string, unknown>> => {
  const snap = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as Bag;
  return (snap.snapshot?.state?.config?.values ?? {}) as Record<string, unknown>;
};

/** Every terminal root state names for this connection. */
const terminalsOf = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<Bag[]> => {
  const snap = await client.handle({ method: 'subscribe', params: { channel: ROOT } }) as Bag;
  return (snap.snapshot?.state?.terminals ?? []) as Bag[];
};

it('keeps defaultShell to the connection that pushed it, and shares the rest', async () => {
  const made = host({ users: directory({ a: ['config:write', 'file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'], b: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }) });
  const mine = watching();
  const first = made.accept(mine);
  const other = watching();
  const second = made.accept(other);
  await hello(first, 'first'); await signIn(first, 'a');
  await hello(second, 'second'); await signIn(second, 'b');

  await configChanged(first, { defaultShell: '/bin/sh', artifactToolsCompactPrompts: true });

  // Its own, and the host's half with it.
  expect(await values(first)).toMatchObject({ defaultShell: '/bin/sh', artifactToolsCompactPrompts: true });
  // The host's half reached the other connection; the person's did not.
  const theirs = await values(second);
  expect(theirs).toMatchObject({ artifactToolsCompactPrompts: true });
  expect(theirs).not.toHaveProperty('defaultShell');

  // One echo each, on one serverSeq: whole to the sender, without the shell to
  // everybody else.
  const echoes = (seen: ReturnType<typeof watching>) =>
    seen.seen.filter((one) => one.method === 'action' && one.params.action?.type === 'root/configChanged');
  const [sent] = echoes(mine);
  const [told] = echoes(other);
  expect(echoes(mine)).toHaveLength(1);
  expect(echoes(other)).toHaveLength(1);
  expect(sent?.params.serverSeq).toBe(told?.params.serverSeq);
  expect(sent?.params.action?.config).toEqual({ defaultShell: '/bin/sh', artifactToolsCompactPrompts: true });
  expect(told?.params.action?.config).toEqual({ artifactToolsCompactPrompts: true });

  // A client that comes back and is replayed the action reads it the same way.
  const back = made.accept(peer());
  const answer = await back.handle({
    method: 'reconnect',
    params: { clientId: 'second', subscriptions: [ROOT], lastSeenServerSeq: Number(told?.params.serverSeq) - 1 },
  }) as Bag;
  const again = (answer.result ?? answer) as { type: string; actions: { serverSeq: number; action: Bag }[] };
  expect(again.type).toBe('replay');
  const replayed = again.actions.find((one) => one.serverSeq === told?.params.serverSeq);
  expect(replayed?.action.config).toEqual({ artifactToolsCompactPrompts: true });
});

it('keeps the other connection\'s own shell in a config that replaces the rest', async () => {
  const made = host({ terminals: shellTerminals() });
  const first = made.accept(peer());
  const other = watching();
  const second = made.accept(other);
  await hello(first, 'first'); await hello(second, 'second');
  await configChanged(second, { defaultShell: '/bin/bash' });

  await first.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', replace: true, config: { defaultShell: '/bin/sh' } } } });

  const told = other.seen.filter((one) => one.method === 'action' && one.params.action?.replace === true);
  expect(told).toHaveLength(1);
  expect(told[0]?.params.action?.config).toEqual({ defaultShell: '/bin/bash' });
  expect(await values(second)).toMatchObject({ defaultShell: '/bin/bash' });
});

it('lets anybody signed in set their own shell, and only config:write change the host', async () => {
  const MEMBER: Grant[] = ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'];
  const made = host({ users: directory({ m: MEMBER, g: ['session:read'], a: ['config:write'] }) });
  const refusals = (seen: ReturnType<typeof watching>) =>
    seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
      .map((one) => String(one.params.rejectionReason));

  const memberSeen = watching();
  const member = made.accept(memberSeen);
  await hello(member, 'member'); await signIn(member, 'm');
  await configChanged(member, { defaultShell: '/bin/sh' });
  expect(refusals(memberSeen)).toEqual([]);
  await configChanged(member, { artifactToolsCompactPrompts: true });
  expect(refusals(memberSeen)).toEqual(['m may not config:write here']);
  expect(await values(member)).not.toHaveProperty('artifactToolsCompactPrompts');

  // A guest may not open a shell, but the preference is still theirs to hold.
  const guestSeen = watching();
  const guest = made.accept(guestSeen);
  await hello(guest, 'guest'); await signIn(guest, 'g');
  await configChanged(guest, { defaultShell: '/bin/sh' });
  expect(refusals(guestSeen)).toEqual([]);

  const adminSeen = watching();
  const admin = made.accept(adminSeen);
  await hello(admin, 'admin'); await signIn(admin, 'a');
  await configChanged(admin, { artifactToolsCompactPrompts: true });
  expect(refusals(adminSeen)).toEqual([]);
  expect(await values(member)).toMatchObject({ artifactToolsCompactPrompts: true });

  // Nobody signed in sets nothing, their own shell included.
  const strangerSeen = watching();
  const stranger = made.accept(strangerSeen);
  await hello(stranger, 'stranger');
  await configChanged(stranger, { defaultShell: '/bin/sh' });
  expect(refusals(strangerSeen)).toEqual(['Sign in to use this host: ahp-root://']);
});

it('opens a client terminal with that connection\'s own shell', async () => {
  const made = host({ users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }), terminals: shellTerminals() });
  const client = made.accept(peer());
  await hello(client); await signIn(client, 'a');
  await configChanged(client, { defaultShell: '/bin/sh' });

  const uri = 'ahp-terminal:/mine';
  expect(await call(client, 'createTerminal', {
    channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: `file://${root}`,
  })).toHaveProperty('result');
  // The title is the shell's own name when nobody named the terminal, which is
  // how the chosen binary is visible from outside.
  const shown = (await terminalsOf(client)).find((one) => one.resource === uri);
  expect(shown?.title).toBe('sh');
});

it('lets a role that may not open a terminal set a shell that reaches nothing', async () => {
  const made = host({ users: directory({ w: ['file:read', 'file:write', 'session:read', 'session:write'] }), terminals: shellTerminals() });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client); await signIn(client, 'w');

  // Allowed now, because it is theirs: the rule that refused this is retired.
  await configChanged(client, { defaultShell: '/tmp/not-a-shell' });
  expect(seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')).toEqual([]);
  expect(await values(client)).toMatchObject({ defaultShell: '/tmp/not-a-shell' });

  // And it reaches nothing: they may not open a terminal at all, and no other
  // connection and no session-side path reads it.
  expect(await call(client, 'createTerminal', { channel: 'ahp-terminal:/no', cwd: root })).toMatchObject({ code: -32009 });
});

it('keeps a shell to its connection with no user directory either', async () => {
  const made = host({ terminals: shellTerminals() });
  const first = made.accept(peer());
  const second = made.accept(peer());
  await hello(first); await hello(second);
  await configChanged(first, { defaultShell: '/bin/sh' });
  expect(await values(first)).toMatchObject({ defaultShell: '/bin/sh' });
  expect(await values(second)).not.toHaveProperty('defaultShell');
});

it('reads a session held under its provider\'s scheme as a session, and a file as a file', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], m: ['session:read'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = made.accept(peer());
  await hello(admin, 'admin'); await signIn(admin, 'a');
  expect(await call(admin, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const session = 'claude:/one';
  const opened = await call(admin, 'subscribe', { channel: session }) as { result: { snapshot: { state: { defaultChat?: string; chats?: { resource: string }[] } } } };
  const chat = opened.result.snapshot.state.defaultChat ?? opened.result.snapshot.state.chats?.[0]?.resource;
  expect(chat).toBeDefined();

  // A member who may read sessions and not files reads it, and its chat.
  const member = made.accept(peer());
  await hello(member, 'member'); await signIn(member, 'm');
  expect(await call(member, 'subscribe', { channel: session })).toHaveProperty('result');
  expect(await call(member, 'subscribe', { channel: chat })).toHaveProperty('result');
  expect(await call(member, 'subscribe', { channel: uriOf(file) })).toMatchObject({ code: -32009 });

  // A guest who may read files and not sessions reads neither of them.
  const guest = made.accept(peer());
  await hello(guest, 'guest'); await signIn(guest, 'g');
  expect(await call(guest, 'subscribe', { channel: session })).toMatchObject({ code: -32009 });
  expect(await call(guest, 'subscribe', { channel: chat })).toMatchObject({ code: -32009 });

  // A chat the client named itself, whose scheme says nothing about whose it is.
  expect(await call(admin, 'createChat', { channel: session, chat: 'peer:/two' })).toHaveProperty('result');
  expect(await call(member, 'subscribe', { channel: 'peer:/two' })).toHaveProperty('result');
  expect(await call(guest, 'subscribe', { channel: 'peer:/two' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:read') });
});

/** A signed-in client whose refusals are kept, for the dispatch half of the gate. */
const withRole = async (made: ReturnType<typeof host>, token: string) => {
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, token); await signIn(client, token);
  const refused = () => seen.seen
    .filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => `${String(one.params.channel)}: ${String(one.params.rejectionReason)}`);
  const send = async (channel: string, action: Bag) => {
    client.handle({ method: 'dispatchAction', params: { channel, action } });
    await new Promise((resolve) => setTimeout(resolve, 20));
  };
  return { client, seen, refused, send };
};

it('needs session:write to dispatch into a session held under its provider\'s scheme, under either name', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], w: ['session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  await call(admin.client, 'subscribe', { channel: 'claude:/one' });

  // A member who may drive sessions and not read files drives it, by either name.
  const member = await withRole(made, 'w');
  await member.send('claude:/one', { type: 'session/titleChanged', title: 'Held' });
  await member.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Given' });
  expect(member.refused()).toEqual([]);
  expect(admin.seen.seen.filter((one) => one.method === 'action' && one.params.action?.type === 'session/titleChanged')
    .map((one) => one.params.action.title)).toEqual(['Held', 'Given']);

  // A guest who may read files is refused all three, the annotations included.
  const guest = await withRole(made, 'g');
  await guest.send('claude:/one', { type: 'session/titleChanged', title: 'Mine' });
  await guest.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Mine' });
  await guest.send('claude:/one/annotations', { type: 'annotations/set', annotations: [] });
  expect(guest.refused()).toEqual([
    'claude:/one: g may not session:write here',
    'claude:/one: g may not session:write here',
    'claude:/one/annotations: g may not session:write here',
  ]);
});

it('reads and drives a changeset of a session held under its provider\'s scheme as the session\'s', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], r: ['session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const changeset = 'claude:/one/changeset/session';

  // Whatever the snapshot then says, it is not the gate saying it.
  const member = await withRole(made, 'r');
  expect(await call(member.client, 'subscribe', { channel: changeset })).not.toMatchObject({ code: -32009 });
  await member.send(changeset, { type: 'changeset/filesReviewChanged', files: ['a.txt'], reviewed: true });
  expect(member.refused().filter((one) => one.includes('may not'))).toEqual([]);

  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: changeset })).toMatchObject({ code: -32009, message: expect.stringContaining('session:read') });
  await guest.send(changeset, { type: 'changeset/filesReviewChanged', files: ['a.txt'], reviewed: true });
  expect(guest.refused()).toEqual([`${changeset}: g may not session:write here`]);
});

it('needs session:write as well as file:write to run an operation on a session\'s changeset, under either name', async () => {
  const invoked: string[] = [];
  const changes: ChangesetSource = {
    scopes: () => [{ id: 'uncommitted', label: 'Uncommitted Changes', changeKind: 'uncommitted' }],
    state: async () => ({ status: 'ready', files: [] }),
    summary: () => ({ files: 0 }),
    operations: () => [{ id: 'commit', label: 'Commit', scopes: ['changeset'], writes: true }],
    invoke: async (request) => { invoked.push(request.session); return { message: 'did commit' }; },
  };
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], f: ['file:write'], b: ['file:write', 'session:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    changes,
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');

  const writer = await withRole(made, 'f');
  for (const channel of ['claude:/one/changeset/uncommitted', 'ahp-session:/one/changeset/uncommitted']) {
    expect(await call(writer.client, 'invokeChangesetOperation', { channel, operationId: 'commit' }))
      .toMatchObject({ code: -32009, message: expect.stringContaining('session:write') });
  }
  expect(invoked).toEqual([]);

  const both = await withRole(made, 'b');
  for (const channel of ['claude:/one/changeset/uncommitted', 'ahp-session:/one/changeset/uncommitted']) {
    expect(await call(both.client, 'invokeChangesetOperation', { channel, operationId: 'commit' }))
      .toMatchObject({ result: { message: 'did commit' } });
  }
  expect(invoked).toHaveLength(2);
});

/** A row a `claude` backend keeps on disk. */
const onDisk = (id: string) => {
  const stamp = new Date(0).toISOString();
  return { id, title: 'On disk', createdAt: stamp, modifiedAt: stamp, workingDirectories: [`file://${root}`] };
};

/**
 * A `claude` backend whose catalogue lists `rows`, one row `disk` to begin
 * with, each with no turns, and counts how often it is asked.
 */
const listingOne = () => {
  const counted = { lists: 0 };
  const rows = [onDisk('disk')];
  const agent = {
    ...echo({ path: root, pace: 0 }),
    provider: 'claude',
    displayName: 'Claude',
    list: async () => {
      counted.lists += 1;
      return [...rows];
    },
    transcript: async () => [],
  };
  return { agent, counted, rows };
};

it('asks a session\'s grants for a row a backend keeps on disk, under its name or any other', async () => {
  const { agent } = listingOne();
  const made = host({ users: directory({ r: ['session:read', 'session:write'], g: ['file:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');
  expect(await call(member.client, 'subscribe', { channel: 'claude:/disk' })).toMatchObject({ result: { snapshot: { resource: 'claude:/disk' } } });
  expect(await call(member.client, 'subscribe', { channel: 'ahp-session:/disk' })).toMatchObject({ result: { snapshot: { resource: 'ahp-session:/disk' } } });
  // Marking a row read is what a client does from the catalogue, and writes
  // the session's flags: a session:write, whatever the row was called. The
  // refusal is said on the session it resolved to.
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: 'claude:/disk' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:read') });
  await guest.send('claude:/disk', { type: 'session/isReadChanged', isRead: true });
  await guest.send('elsewhere:/disk', { type: 'session/isReadChanged', isRead: true });
  await guest.send('never-listed:/other', { type: 'session/isReadChanged', isRead: true });
  expect(guest.refused()).toEqual([
    'claude:/disk: g may not session:write here',
    'claude:/disk: g may not session:write here',
    'never-listed:/other: g may not session:write here',
  ]);
});

it('finds a session a backend wrote to disk after the last listing', async () => {
  const { agent, rows } = listingOne();
  const made = host({ users: directory({ r: ['session:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');
  await call(member.client, 'listSessions', { channel: ROOT });
  rows.push(onDisk('late'));
  expect(await call(member.client, 'subscribe', { channel: 'claude:/late' })).toMatchObject({ result: { snapshot: { resource: 'claude:/late' } } });
});

it('reads a channel it cannot place as a session\'s, and a file as a file', async () => {
  const made = host({ users: directory({ r: ['session:read'], w: ['session:write'], g: ['file:read'] }) });
  const reader = await withRole(made, 'r');
  const writer = await withRole(made, 'w');
  const guest = await withRole(made, 'g');

  // Nothing here is called `x:/1`: the gate asks for a session's grants, and
  // what is behind it says there is no such session.
  expect(await call(reader.client, 'subscribe', { channel: 'x:/1' })).not.toMatchObject({ code: -32009 });
  expect(await call(guest.client, 'subscribe', { channel: 'x:/1' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:read') });
  await writer.send('x:/1', { type: 'session/isReadChanged', isRead: true });
  expect(writer.refused().filter((one) => one.includes('may not'))).toEqual([]);
  await guest.send('x:/1', { type: 'session/isReadChanged', isRead: true });
  expect(guest.refused()).toEqual(['x:/1: g may not session:write here']);

  // A file is a file, to read and to dispatch into; a session's action on it
  // is refused for what the file is, before any grant is asked.
  expect(await call(reader.client, 'subscribe', { channel: uriOf(file) })).toMatchObject({ code: -32009, message: expect.stringContaining('file:read') });
  await writer.send(uriOf(file), { type: 'vendor/probe' });
  await writer.send(uriOf(file), { type: 'session/isReadChanged', isRead: true });
  expect(writer.refused()).toEqual([`${uriOf(file)}: w may not file:read here`, `${uriOf(file)}: ${uriOf(file)} is not a session here`]);
});

it('still asks a session\'s grants for a session that was disposed', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/gone', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'disposeSession', { channel: 'claude:/gone' })).toHaveProperty('result');
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: 'claude:/gone' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:read') });
  await guest.send('claude:/gone', { type: 'session/isReadChanged', isRead: true });
  expect(guest.refused()).toEqual(['claude:/gone: g may not session:write here']);
});

it('reads the catalogue once for a run of subscribes to sessions nobody has', async () => {
  const { agent, counted } = listingOne();
  const made = host({ users: directory({ r: ['session:read'] }), agents: [agent] });
  const member = await withRole(made, 'r');
  await new Promise((resolve) => setTimeout(resolve, 20));
  const before = counted.lists;
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    // Long enough after the host's own first listing that it is not fresh.
    vi.setSystemTime(Date.now() + 60_000);
    for (let i = 0; i < 5; i++) {
      expect(await call(member.client, 'subscribe', { channel: `claude:/nobody-${i}` })).toMatchObject({ code: -32001 });
    }
  }
  finally { vi.useRealTimers(); }
  expect(counted.lists - before).toBe(1);
});

it('keeps config for a channel that names no session out of the store', async () => {
  const { agent } = listingOne();
  const store = memorySessions();
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write'] }), agents: [agent], sessions: store });
  const admin = await withRole(made, 'a');
  await admin.send('zzz:/nothing', { type: 'session/configChanged', config: { voice: 'shouty' } });
  await admin.send('zzz:/disk', { type: 'session/configChanged', config: { voice: 'shouty', isolation: 'worktree' } });
  expect(admin.refused()).toEqual(['zzz:/nothing: zzz:/nothing is not a session here']);
  expect(store.config('nothing')).toBeUndefined();
  // The row that is a session keeps the backend's key and not this host's own.
  expect(store.config('disk')).toEqual({ voice: 'shouty' });
});

/** A peer that answers a relayed `createResourceWatch` with the channel it is given. */
const publishing = (channel: string): Peer & { seen: { method: string; params: Bag }[] } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {}, answered: () => {}, close: () => {},
    request: async () => ({ channel }),
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

it('reads a session spelt as a file or as a watch as what it is spelt as', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write'], g: ['file:read', 'virtual:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  await call(admin.client, 'subscribe', { channel: 'claude:/one' });
  await call(admin.client, 'subscribe', { channel: 'ahp-chat:/one' });

  // A file:read guest who names the session as a file reads nothing of it and drives nothing in it.
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: 'file:///one' })).not.toHaveProperty('result');
  await guest.send('file:///one', { type: 'session/titleChanged', title: 'Taken' });
  await guest.send('file:///one', { type: 'chat/turnStarted', turnId: 't1', message: { text: 'run this' } });
  await guest.send('file:///one/annotations', { type: 'annotations/set', annotations: [] });

  // Nor by a relayed watch named after the session: the name is the session's.
  const owner = made.accept(publishing('x:/one'));
  await hello(owner, 'plugin'); await signIn(owner, 'g');
  expect(await call(guest.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://plugin/src' })).toMatchObject({ code: -32003 });
  expect(await call(guest.client, 'subscribe', { channel: 'x:/one' })).toMatchObject({ code: -32009, message: expect.stringContaining('session:read') });
  await guest.send('x:/one', { type: 'session/titleChanged', title: 'Taken' });

  const acted = admin.seen.seen.filter((one) => one.method === 'action'
    && ['session/titleChanged', 'chat/turnStarted'].includes(String(one.params.action?.type)));
  expect(acted).toEqual([]);
  expect(guest.refused()).toEqual([
    'file:///one: file:///one is not a session here',
    'file:///one: file:///one is not a session here',
    'file:///one/annotations: file:///one/annotations is not a session here',
    'claude:/one: g may not session:write here',
  ]);

  // The session and a watch under a name of its own both still work.
  await admin.send('ahp-session:/one', { type: 'session/titleChanged', title: 'Mine' });
  expect(admin.refused()).toEqual([]);
  expect(admin.seen.seen.some((one) => one.method === 'action' && one.params.action?.type === 'session/titleChanged')).toBe(true);
  const own = made.accept(publishing('x:/w'));
  await hello(own, 'second'); await signIn(own, 'g');
  expect(await call(guest.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://second/src' })).toMatchObject({ result: { channel: 'x:/w' } });
  expect(await call(guest.client, 'subscribe', { channel: 'x:/w' })).toMatchObject({ result: { snapshot: { resource: 'x:/w' } } });
});

it('keeps a session a backend keeps on disk out of reach of its spelling as a file', async () => {
  const { agent } = listingOne();
  const store = memorySessions();
  const made = host({ users: directory({ g: ['file:read'] }), agents: [agent], sessions: store });
  const guest = await withRole(made, 'g');
  await call(guest.client, 'listSessions', { channel: ROOT });
  expect(await call(guest.client, 'subscribe', { channel: 'file:///disk' })).not.toHaveProperty('result');
  await guest.send('file:///disk', { type: 'session/isReadChanged', isRead: true });
  await guest.send('file:///disk', { type: 'session/configChanged', config: { voice: 'shouty' } });
  expect(store.flags('disk')).toBe(0);
  expect(store.config('disk')).toBeUndefined();
  expect(guest.refused()).toEqual(['file:///disk: file:///disk is not a session here', 'file:///disk: file:///disk is not a session here']);
});

it('needs terminal grants for a terminal this host holds, whatever its scheme', async () => {
  const made = host({
    users: directory({ t: ['terminal:read', 'terminal:write'], g: ['file:read'] }),
    terminals: shellTerminals(),
  });
  const owner = await withRole(made, 't');
  const uri = 'agenthost-terminal:/probe';
  expect(await call(owner.client, 'createTerminal', { channel: uri, cwd: root })).toHaveProperty('result');
  expect(await call(owner.client, 'subscribe', { channel: uri })).toHaveProperty('result');

  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'subscribe', { channel: uri })).toMatchObject({ code: -32009, message: expect.stringContaining('terminal:read') });
  await guest.send(uri, { type: 'terminal/input', data: 'echo GUEST-$((6*7))\n' });
  expect(guest.refused()).toEqual([`${uri}: g may not terminal:write here`]);

  // The shell is live, so a negative is asserted against a positive.
  await owner.send(uri, { type: 'terminal/input', data: 'echo OWNER-$((1+1))\n' });
  expect(await until(owner.seen, uri, 'OWNER-2')).not.toContain('GUEST-42');
});

it('keeps terminals and sessions from being named after each other', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  // A terminal named after a live session, in its held name or another.
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/one', cwd: root })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createTerminal', { channel: 'ahp-session:/one', cwd: root })).toMatchObject({ code: -32003 });
  // A name in a provider's scheme is a session's even with no session under it.
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/two', cwd: root })).toMatchObject({ code: -32003 });
  // And a session named after a terminal.
  expect(await call(admin.client, 'createTerminal', { channel: 'vscode:/two', cwd: root })).toHaveProperty('result');
  expect(await call(admin.client, 'createSession', { channel: 'vscode:/two', provider: 'claude' })).toMatchObject({ code: -32003 });
});


it('answers no channel a connection may not read in its handshake', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'createTerminal', { channel: 'ahp-terminal:/t', cwd: root })).toHaveProperty('result');

  const seen = watching();
  const stranger = made.accept(seen);
  const hand = await stranger.handle({
    method: 'initialize',
    params: { clientId: 'stranger', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT, 'claude:/one', 'ahp-session:/one', 'ahp-terminal:/t'] },
  }) as { snapshots: { resource: string }[] };
  expect(hand.snapshots.map((one) => one.resource)).toEqual([ROOT]);
  await admin.send('claude:/one', { type: 'session/titleChanged', title: 'Private' });
  await admin.send('ahp-terminal:/t', { type: 'terminal/input', data: 'echo SECRET\n' });
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(seen.seen.filter((one) => one.method === 'action' && one.params.channel !== ROOT)).toEqual([]);
});

it('resumes a client id for a person signed in only when it is theirs, and only what they may read', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const guest = await withRole(made, 'g');
  const resume = { clientId: 'a', subscriptions: [ROOT, 'claude:/one'], lastSeenServerSeq: 0 };

  // Nobody signed in resumes nothing it may not read; somebody else signed in is told the id is not theirs.
  expect(await call(made.accept(peer()), 'reconnect', resume)).toMatchObject({ result: { missing: ['claude:/one'] } });
  const other = made.accept(peer());
  await hello(other, 'elsewhere'); await signIn(other, 'g');
  expect(await call(other, 'reconnect', resume)).toMatchObject({ code: -32008 });

  // The person who held it resumes it.
  const same = made.accept(peer());
  await hello(same, 'again'); await signIn(same, 'a');
  expect(await call(same, 'reconnect', resume)).toMatchObject({ result: { missing: [] } });

  // And a person resuming their own id gets back only what they may read.
  const back = made.accept(peer());
  await hello(back, 'later'); await signIn(back, 'g');
  expect(await call(back, 'reconnect', { ...resume, clientId: 'g' })).toMatchObject({ result: { missing: ['claude:/one'] } });
  expect(guest.refused()).toEqual([]);
});

it('keeps every name to one kind of thing', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'virtual:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const relay = async (clientId: string, channel: string) => {
    const owner = made.accept(publishing(channel));
    await hello(owner, clientId); await signIn(owner, 'a');
    return await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: `virtual://${clientId}/src` });
  };
  // A relayed watch named after a session, and a session named after a relayed watch.
  expect(await relay('first', 'claude:/one')).toMatchObject({ code: -32003 });
  expect(await relay('second', 'claude:/later')).toMatchObject({ code: -32003 });
  expect(await relay('third', 'x:/later')).toMatchObject({ result: { channel: 'x:/later' } });
  expect(await call(admin.client, 'createSession', { channel: 'x:/later', provider: 'claude' })).toMatchObject({ code: -32003 });
  // A chat named in a space this host keeps for something else.
  for (const chat of ['file:///c', 'ahp-root://c', 'ahp-session:/c', 'ahp-terminal:/c', 'claude:/c', 'x:/later']) {
    expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat })).toMatchObject({ code: -32003 });
  }
  expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat: 'peer:/two' })).toHaveProperty('result');
  // A terminal named after a chat, or a channel of a session.
  for (const channel of ['peer:/two', 'claude:/one/annotations', 'claude:/one/changeset/x', 'file:///t', 'ahp-chat:/t']) {
    expect(await call(admin.client, 'createTerminal', { channel, cwd: root })).toMatchObject({ code: -32003 });
  }
  // A session named after a terminal, in the name it was asked for.
  expect(await call(admin.client, 'createTerminal', { channel: 'vscode:/three', cwd: root })).toHaveProperty('result');
  expect(await call(admin.client, 'createSession', { channel: 'vscode:/three', provider: 'claude' })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createSession', { channel: 'file:///four', provider: 'claude' })).toMatchObject({ code: -32003 });
});

it('relays only a change of files from the client that keeps a watch', async () => {
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write', 'virtual:read'] }) });
  const admin = await withRole(made, 'a');
  const seen = publishing('x:/w');
  const owner = made.accept(seen);
  await hello(owner, 'plugin'); await signIn(owner, 'a');
  expect(await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://plugin/src' })).toMatchObject({ result: { channel: 'x:/w' } });
  await call(admin.client, 'subscribe', { channel: 'x:/w' });
  owner.handle({ method: 'dispatchAction', params: { channel: 'x:/w', action: { type: 'resourceWatch/changed', changes: { items: [] } } } });
  owner.handle({ method: 'dispatchAction', params: { channel: 'x:/w', action: { type: 'session/titleChanged', title: 'Injected' } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  const relayed = admin.seen.seen.filter((one) => one.method === 'action' && one.params.channel === 'x:/w' && one.params.rejectionReason === undefined);
  expect(relayed.map((one) => one.params.action.type)).toEqual(['resourceWatch/changed']);
  expect(seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => one.params.rejectionReason)).toEqual(['x:/w is not a session here']);
});

it('keeps a session\'s marks out of a file named after it', async () => {
  const { agent } = listingOne();
  const made = host({ users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }), agents: [agent] });
  const admin = await withRole(made, 'a');
  await admin.send('claude:/disk/annotations', {
    type: 'annotations/set',
    annotation: { id: 'a1', origin: { session: 'claude:/disk' }, resource: 'file:///x', resolved: false, entries: [{ id: 'e1', text: 'private' }] },
  });
  expect(admin.refused()).toEqual([]);
  expect(JSON.stringify(await call(admin.client, 'subscribe', { channel: 'claude:/disk/annotations' }))).toContain('private');
  const guest = await withRole(made, 'g');
  expect(JSON.stringify(await call(guest.client, 'subscribe', { channel: 'file:///disk/annotations' }))).not.toContain('private');
});

it('asks a session\'s grants for completions in a session', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  const asked = { channel: 'claude:/one', kind: 'userMessage', text: '/', offset: 1 };
  expect(await call(admin.client, 'completions', asked)).toHaveProperty('result');
  const guest = await withRole(made, 'g');
  expect(await call(guest.client, 'completions', asked)).toMatchObject({ code: -32009, message: expect.stringContaining('session:read') });
  expect(await call(guest.client, 'completions', { ...asked, channel: ROOT })).toHaveProperty('result');
});

/** A peer that answers every request with its own name, and keeps what it was asked. */
const answering = (name: string): Peer & { asked: string[]; seen: { method: string; params: Bag }[] } => {
  const asked: string[] = [];
  const seen: { method: string; params: Bag }[] = [];
  return {
    asked, seen,
    send: () => {}, answered: () => {}, close: () => {},
    request: async (method: string) => { asked.push(method); return { data: name, encoding: 'utf-8' }; },
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

it('resumes another person\'s client id with nothing it may not read, and no claim on it until they sign in', async () => {
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'virtual:read'], g: ['file:read'] }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  await admin.send('claude:/one', { type: 'session/titleChanged', title: 'Private' });
  // The person's own publisher, which goes away.
  const first = made.accept(answering('first'));
  await hello(first, 'pub'); await signIn(first, 'a');
  first.close();

  const stranger = answering('stranger');
  const back = made.accept(stranger);
  const resumed = await call(back, 'reconnect', { clientId: 'pub', subscriptions: [ROOT, 'claude:/one'], lastSeenServerSeq: 0 }) as { result: { type: string; missing: string[]; actions: Bag[] } };
  expect(resumed.result).toMatchObject({ type: 'replay', missing: ['claude:/one'] });
  expect(resumed.result.actions.filter((one) => one.channel !== ROOT)).toEqual([]);
  // Nothing published under the id reaches it, and nobody else may sign in on it.
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).not.toMatchObject({ result: { data: 'stranger' } });
  expect(stranger.asked).toEqual([]);
  expect(await call(back, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'g' })).toMatchObject({ code: -32003 });

  // The person who holds it signs in, and it is theirs again.
  await signIn(back, 'a');
  expect(await call(back, 'subscribe', { channel: 'claude:/one' })).toHaveProperty('result');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).toMatchObject({ result: { data: 'stranger' } });
});

it('gives a connection no claim on a client id another person holds', async () => {
  const made = host({ users: directory({ a: ['file:read', 'virtual:read'], g: ['file:read'] }) });
  const admin = await withRole(made, 'a');
  const first = made.accept(answering('first'));
  await hello(first, 'pub'); await signIn(first, 'a');
  first.close();

  const other = answering('other');
  const again = made.accept(other);
  await hello(again, 'pub');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).not.toMatchObject({ result: { data: 'other' } });
  expect(other.asked).toEqual([]);
  expect(await call(again, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'g' })).toMatchObject({ code: -32003, message: expect.stringContaining('pub') });

  const theirs = answering('theirs');
  const own = made.accept(theirs);
  await hello(own, 'pub'); await signIn(own, 'a');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/x' })).toMatchObject({ result: { data: 'theirs' } });
});

it('keeps every family of action to its own kind of channel', async () => {
  const store = memoryAutomations();
  const made = host({
    users: directory({
      a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'automation:read', 'automation:write', 'config:write'],
      g: ['file:read'],
    }),
    agents: [{ ...echo({ path: root, pace: 0 }), provider: 'claude', displayName: 'Claude' }],
    automations: store,
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  const definition = { title: 'nightly', enabled: true, message: { text: 'review' }, session: { provider: 'claude', workingDirectories: [`file://${root}`] }, triggers: [] };
  await admin.send('ahp-automations://', { type: 'automation/createRequested', resource: 'ahp-automation:/n', definition });
  expect(admin.refused()).toEqual([]);
  expect(store.get('ahp-automation:/n')).toBeDefined();

  // A file:read guest reaches no automation through a channel of another kind.
  const guest = await withRole(made, 'g');
  await guest.send('file:///x', { type: 'automation/createRequested', resource: 'ahp-automation:/pwn', definition });
  await guest.send('ahp-automations://', { type: 'automation/createRequested', resource: 'ahp-automation:/pwn2', definition });
  await guest.send('file:///x', { type: 'automation/updateRequested', resource: 'ahp-automation:/n', changes: { message: { text: 'exfiltrate' } } });
  await guest.send('ahp-otlp://logs', { type: 'automation/removed', resource: 'ahp-automation:/n' });
  expect(store.get('ahp-automation:/pwn')).toBeUndefined();
  expect(store.get('ahp-automation:/pwn2')).toBeUndefined();
  expect(JSON.stringify(store.get('ahp-automation:/n'))).toContain('review');
  expect(guest.refused()).toEqual([
    'file:///x: file:///x is not an automation channel here',
    'ahp-automations://: g may not automation:write here',
    'file:///x: file:///x is not an automation channel here',
    'ahp-otlp://logs: ahp-otlp://logs is not an automation channel here',
  ]);

  // Nor does anybody, with every grant, on a channel of another kind.
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'createTerminal', { channel: 'ahp-terminal:/t', cwd: root })).toHaveProperty('result');
  const before = admin.refused().length;
  await admin.send('ahp-terminal:/t', { type: 'session/titleChanged', title: 'x' });
  await admin.send('claude:/one', { type: 'terminal/input', data: 'echo no\n' });
  await admin.send('claude:/one', { type: 'automation/removed', resource: 'ahp-automation:/n' });
  await admin.send('claude:/one', { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } });
  await admin.send('file:///x', { type: 'automationRun/cancelRequested', resource: 'ahp-automation-run:/r' });
  await admin.send('ahp-automations://', { type: 'annotations/set', annotations: [] });
  await admin.send('ahp-automations://', { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } });
  expect(admin.refused().slice(before)).toEqual([
    'ahp-terminal:/t: ahp-terminal:/t is not a session here',
    'claude:/one: claude:/one is not a terminal here',
    'claude:/one: claude:/one is not an automation channel here',
    'claude:/one: claude:/one is not the root here',
    'file:///x: file:///x is not an automation channel here',
    'ahp-automations://: ahp-automations:// is not a session here',
    'ahp-automations://: ahp-automations:// is not a session here',
  ]);
  expect(JSON.stringify(store.get('ahp-automation:/n'))).toContain('review');
});

it('keeps a name in a provider\'s scheme for a session, before anything has listed it', async () => {
  const { agent } = listingOne();
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'virtual:read'] }),
    agents: [agent],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  expect(await call(admin.client, 'createTerminal', { channel: 'claude:/disk', cwd: root })).toMatchObject({ code: -32003 });
  const owner = made.accept(publishing('claude:/disk'));
  await hello(owner, 'evil');
  expect(await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://evil/src' })).toMatchObject({ code: -32003 });
  // The session is still reachable once it is listed.
  await call(admin.client, 'listSessions', { channel: ROOT });
  expect(await call(admin.client, 'subscribe', { channel: 'claude:/disk' })).toMatchObject({ result: { snapshot: { resource: 'claude:/disk' } } });
  await admin.send('ahp-session:/disk', { type: 'session/isReadChanged', isRead: true });
  expect(admin.refused()).toEqual([]);
  // A chat in a provider's scheme is refused too; any other scheme is a chat's to take.
  expect(await call(admin.client, 'createSession', { channel: 'ahp-session:/one', provider: 'claude' })).toHaveProperty('result');
  expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat: 'claude:/side' })).toMatchObject({ code: -32003 });
  expect(await call(admin.client, 'createChat', { channel: 'claude:/one', chat: 'peer:/side' })).toHaveProperty('result');
});

it('keeps a watch or a terminal named like a session\'s marks what it is once the session is listed', async () => {
  const { agent } = listingOne();
  const made = host({
    users: directory({ a: ['file:read', 'session:read', 'session:write', 'terminal:read', 'terminal:write', 'virtual:read'] }),
    agents: [agent],
    terminals: shellTerminals(),
  });
  const admin = await withRole(made, 'a');
  const watch = 'x:/disk/annotations';
  const terminal = 'y:/disk/annotations';
  const seen = publishing(watch);
  const owner = made.accept(seen);
  await hello(owner, 'plugin'); await signIn(owner, 'a');
  expect(await call(admin.client, 'createResourceWatch', { channel: ROOT, uri: 'virtual://plugin/src' })).toMatchObject({ result: { channel: watch } });
  expect(await call(admin.client, 'createTerminal', { channel: terminal, cwd: root })).toHaveProperty('result');
  await admin.send('claude:/disk/annotations', {
    type: 'annotations/set',
    annotation: { id: 'a1', origin: { session: 'claude:/disk' }, resource: 'file:///x', resolved: false, entries: [{ id: 'e1', text: 'private' }] },
  });
  await call(admin.client, 'listSessions', { channel: ROOT });

  // The watch is still the watch: its snapshot, and its owner's change reaches its subscriber.
  const opened = await call(admin.client, 'subscribe', { channel: watch });
  expect(opened).toMatchObject({ result: { snapshot: { resource: watch } } });
  expect(JSON.stringify(opened)).not.toContain('private');
  owner.handle({ method: 'dispatchAction', params: { channel: watch, action: { type: 'resourceWatch/changed', changes: { items: [] } } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')).toEqual([]);
  expect(admin.seen.seen.some((one) => one.method === 'action' && one.params.channel === watch && one.params.action?.type === 'resourceWatch/changed')).toBe(true);

  // And the terminal is still the terminal.
  const shell = await call(admin.client, 'subscribe', { channel: terminal });
  expect(shell).toMatchObject({ result: { snapshot: { resource: terminal } } });
  expect(JSON.stringify(shell)).not.toContain('private');
  await admin.send(terminal, { type: 'terminal/input', data: 'echo MARKS-$((2+3))\n' });
  expect(admin.refused()).toEqual([]);
  expect(await until(admin.seen, terminal, 'MARKS-5')).toContain('MARKS-5');
});

it('binds a client id to the person who reconnects under it first', async () => {
  const made = host({ users: directory({ g: ['file:read'], h: ['file:read', 'virtual:read'] }) });
  const x = made.accept(answering('x-unsigned'));
  await hello(x, 'x');
  x.close();
  const g = made.accept(answering('g-conn'));
  await hello(g, 'g'); await signIn(g, 'g');
  expect(await call(g, 'reconnect', { clientId: 'x', subscriptions: [ROOT], lastSeenServerSeq: 0 })).toHaveProperty('result');
  const h = made.accept(answering('h-conn'));
  await hello(h, 'x');
  expect(await call(h, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'h' })).toMatchObject({ code: -32003 });
  const reader = await withRole(made, 'h');
  expect(await call(reader.client, 'resourceRead', { channel: ROOT, uri: 'virtual://x/f' })).toMatchObject({ result: { data: 'g-conn' } });
});

it('routes nothing to a person removed while connected, and binds no id to a connection without one', async () => {
  let standing = true;
  const users = directory({ a: ['file:read', 'virtual:read'], p: ['file:read'], q: ['file:read'] });
  const verify = users.verify;
  users.verify = async (token) => {
    const held = await verify(token);
    return held === undefined || token !== 'p' ? held : { ...held, standing: () => standing };
  };
  const made = host({ users });
  const admin = await withRole(made, 'a');
  const publisher = made.accept(answering('p-conn'));
  await hello(publisher, 'pub'); await signIn(publisher, 'p');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/f' })).toMatchObject({ result: { data: 'p-conn' } });
  standing = false;
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://pub/f' })).not.toMatchObject({ result: { data: 'p-conn' } });

  // Two people who name no client id are not one id, and neither is routed to.
  const one = made.accept(answering('one'));
  await one.handle({ method: 'initialize', params: { protocolVersions: ['0.9.0'] } });
  expect(await call(one, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'p' })).toHaveProperty('result');
  const two = made.accept(answering('two'));
  await two.handle({ method: 'initialize', params: { protocolVersions: ['0.9.0'] } });
  expect(await call(two, 'authenticate', { channel: ROOT, resource: RECORD.resource, token: 'q' })).toHaveProperty('result');
  expect(await call(admin.client, 'resourceRead', { channel: ROOT, uri: 'virtual://anonymous/f' })).not.toMatchObject({ result: { data: expect.anything() } });
});

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createHost, GATE, ROOT } from '../packages/sdk/src/host.js';
import { fileResources, uriOf } from '../packages/sdk/src/resources.js';
import { shellTerminals } from '../packages/sdk/src/terminals.js';
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

it('serves a connection that arrived as somebody, with no authenticate', async () => {
  // A socket admitted on a personal connection token: the principal is on the
  // connection before the first frame, so the first command is served as them
  // and no `authenticate` is needed - decision
  // `a-connection-token-may-carry-a-person`.
  const made = host({ users: directory({ m: ['read', 'write', 'session', 'terminal'] }) });
  const granted: Grant[] = ['read', 'write', 'session', 'terminal'];
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
  const made = host({ users: directory({ m: ['read', 'write', 'session', 'terminal'] }), terminals: shellTerminals() });
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
  const made = host({ users: directory({ r: ['read', 'session'] }), terminals: shellTerminals() });
  const client = made.accept(seen);
  await hello(client);
  await signIn(client, 'r');

  // No `terminal`, so the channel is refused even though the person signed in.
  client.handle({ method: 'dispatchAction', params: { channel: 'ahp-terminal:/nope', action: { type: 'terminal/input', data: 'echo no\n' } } });
  const rejected = seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string');
  expect(rejected.length).toBeGreaterThan(0);
  expect(String(rejected[0]?.params.rejectionReason)).toContain('may not terminal');
});

it('classifies a dispatch by its channel', () => {
  expect(GATE.dispatchNeeds('ahp-terminal:/x')).toBe('terminal');
  expect(GATE.dispatchNeeds('ahp-session:/x')).toBe('session');
  expect(GATE.dispatchNeeds('ahp-chat:/x')).toBe('session');
  expect(GATE.dispatchNeeds('ahp-session:/x/marks')).toBe('session');
  expect(GATE.dispatchNeeds('ahp-automations://')).toBe('automation');
  expect(GATE.dispatchNeeds(ROOT)).toBe('write');
  // A channel a later plan adds: the conservative answer, not nothing.
  expect(GATE.dispatchNeeds('ahp-resource-watch:/x')).toBe('read');
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
  const made = host({ users: directory({ a: ['read', 'write', 'session', 'terminal'], b: ['read', 'write', 'session', 'terminal'] }) });
  const first = made.accept(peer());
  const other = watching();
  const second = made.accept(other);
  await hello(first); await signIn(first, 'a');
  await hello(second); await signIn(second, 'b');

  await configChanged(first, { defaultShell: '/bin/sh', artifactToolsCompactPrompts: true });

  // Its own, and the host's half with it.
  expect(await values(first)).toMatchObject({ defaultShell: '/bin/sh', artifactToolsCompactPrompts: true });
  // The host's half reached the other connection; the person's did not.
  const theirs = await values(second);
  expect(theirs).toMatchObject({ artifactToolsCompactPrompts: true });
  expect(theirs).not.toHaveProperty('defaultShell');
  /*
   * The live echo does carry it, and deliberately: `serverSeq` and the replay
   * buffer are one per host, so the action is said back whole the way every
   * other one is. The snapshot is what corrects it, which is why the assertion
   * above is the one that matters - and why nothing reads a shell out of the
   * shared record any more.
   */
  const told = other.seen.filter((one) => one.method === 'action' && one.params.action?.type === 'root/configChanged');
  expect(told.length).toBe(1);
});

it('opens a client terminal with that connection\'s own shell', async () => {
  const made = host({ users: directory({ a: ['read', 'write', 'session', 'terminal'] }), terminals: shellTerminals() });
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
  const made = host({ users: directory({ w: ['read', 'write', 'session'] }), terminals: shellTerminals() });
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

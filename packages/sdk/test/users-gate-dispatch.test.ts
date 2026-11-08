import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { expect, it } from 'vitest';
import { DEFAULT_TERMINAL_AUTO_APPROVE_RULES } from '../src/access/commandautoapprover.js';
import { createHost, GATE, ROOT } from '../src/host.js';
import { shellTerminals } from '../src/machines/terminals.js';
import { fileUsers } from '../src/access/users.js';
import {
  call, directory, hello, host, peer, root, signIn, until, watching, withRole,
} from './users-gate-helpers.js';
import type { Bag } from './users-gate-helpers.js';
import type { Grant, Users } from '../src/types/users.js';

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

it('classifies a dispatch by its action, with the channel beside it', async () => {
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
  // The act is the action's, so the same channel asks for one thing of a
  // terminal and another of a session, whatever scheme either is spelt as.
  expect(await needs('ahp-terminal:/x', { type: 'terminal/input', data: '' })).toBe('terminal:input');
  expect(await needs('agenthost-terminal:/x', { type: 'terminal/input', data: '' })).toBe('terminal:input');
  expect(await needs('ahp-terminal:/x', { type: 'terminal/titleChanged', title: 'T' })).toBe('terminal:rename');
  // A session's channel, under any scheme a session can have: marking one is
  // the same act whichever of the five it arrives on.
  for (const channel of ['ahp-session:/x', 'ahp-chat:/x', 'claude:/x', 'claude:/x/annotations', 'claude:/x/changeset/main']) {
    expect(await needs(channel)).toBe('session:mark');
  }
  expect(await needs('ahp-automations://', { type: 'automation/removed', id: 'x' })).toBe('automation:remove');
  expect(await needs('ahp-automations://', { type: 'automation/createRequested', automation: 'x' })).toBe('automation:create');
  expect(await needs(ROOT, { type: 'root/configChanged', config: { telemetryLevel: 'off' } })).toBe('config:change');
  expect(await needs(ROOT, { type: 'root/configChanged', replace: true, config: { defaultShell: '/bin/sh' } })).toBe('config:change');
  // The root is read with its action. A window's keys are one value for the
  // whole host, so each changes the host for everybody.
  expect(await needs(ROOT, { type: 'root/configChanged', config: { defaultShell: '/bin/sh' } })).toBe('config:change');
  // The trust key alone asks for the push, which the write group covers.
  expect(await needs(ROOT, { type: 'root/configChanged', config: { workspaceTrust: { enabled: true, trustedUris: [] } } })).toBe('trust:push');
  // The terminal rules, plain or an expression, and VS Code's own table.
  const rules = (terminalAutoApproveRules: Record<string, unknown>) =>
    needs(ROOT, { type: 'root/configChanged', config: { terminalAutoApproveRules } });
  expect(await rules({ 'make test': true })).toBe('config:change');
  expect(await rules({ '/(a+)+$/': true })).toBe('config:change');
  expect(await rules({ ...DEFAULT_TERMINAL_AUTO_APPROVE_RULES, 'my-tool': true })).toBe('config:change');
  // And a push that names no key changes nothing.
  expect(await needs(ROOT, { type: 'root/configChanged', config: {} })).toBeUndefined();
  // A file, a watch and any other `ahp-` channel are the host's own names, and
  // watching one is the grant an action no family claims is held to.
  for (const channel of ['file:///x', 'ahp-resource-watch:/x', 'ahp-sessionx:/x']) {
    expect(await needs(channel, { type: 'vendor/probe' })).toBe('file:watch');
  }
  expect(GATE.dispatchNeeds(ROOT, 'other', { type: 'root/configChanged', config: { defaultShell: '/bin/sh', somethingNew: 1 } })).toBe('config:change');
});

it('asks a role for the session write before it lets one background an MCP startup', async () => {
  const made = host({ users: directory({ r: ['session:read'], w: ['session:read', 'session:write'] }) });

  /*
   * `session:configure`, which the write group covers and the read one does
   * not. Refused at the gate, before the session is looked for - so the
   * refusal is the grant's and not "no such session", which is what a reader
   * would otherwise be told and could do nothing about.
   */
  const reader = await withRole(made, 'r');
  await reader.send('ahp-session:/x', { type: 'session/mcpServerBackgroundRequested', id: 'mcp:desk' });
  expect(reader.refused()).toEqual(['ahp-session:/x: r may not session:configure here']);

  // The same action from a role that may configure the session is taken and
  // refused to nobody, even though this backend has no such seam: a backend
  // with nothing to do about it is not a client that asked for the wrong
  // thing.
  const writer = await withRole(made, 'w');
  expect(await call(writer.client, 'createSession', { channel: 'ahp-session:/x', provider: 'base' })).toHaveProperty('result');
  await writer.send('ahp-session:/x', { type: 'session/mcpServerBackgroundRequested', id: 'mcp:desk' });
  expect(writer.refused()).toEqual([]);
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
 * The root record holds one value per key for the whole host.
 *
 * `defaultShell` among them: the shell every client's terminal opens, which
 * the last push sets, as the reference host's terminal manager reads it. Saying
 * it changes the host for everybody, so it needs `config:change`. The paths with
 * no connection in hand (a `!command`, and the factory a backend opens a
 * terminal with) take the daemon's own shell.
 * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/agentHostTerminalManager.ts#L949-L960
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

it('keeps defaultShell for the whole host, with the rest', async () => {
  const made = host({ users: directory({ a: ['config:write', 'file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'], b: ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'] }) });
  const mine = watching();
  const first = made.accept(mine);
  const other = watching();
  const second = made.accept(other);
  await hello(first, 'first'); await signIn(first, 'a');
  await hello(second, 'second'); await signIn(second, 'b');

  await configChanged(first, { defaultShell: '/bin/sh', telemetryLevel: 'off' });

  // One value each, which every connection reads.
  expect(await values(first)).toMatchObject({ defaultShell: '/bin/sh', telemetryLevel: 'off' });
  expect(await values(second)).toMatchObject({ defaultShell: '/bin/sh', telemetryLevel: 'off' });

  // One echo each, on one serverSeq, the same to the sender and to everybody else.
  const echoes = (seen: ReturnType<typeof watching>) =>
    seen.seen.filter((one) => one.method === 'action' && one.params.action?.type === 'root/configChanged');
  const [sent] = echoes(mine);
  const [told] = echoes(other);
  expect(echoes(mine)).toHaveLength(1);
  expect(echoes(other)).toHaveLength(1);
  expect(sent?.params.serverSeq).toBe(told?.params.serverSeq);
  expect(sent?.params.action?.config).toEqual({ defaultShell: '/bin/sh', telemetryLevel: 'off' });
  expect(told?.params.action?.config).toEqual({ defaultShell: '/bin/sh', telemetryLevel: 'off' });

  // A client that comes back and is replayed the action reads it the same way.
  const back = made.accept(peer());
  const answer = await back.handle({
    method: 'reconnect',
    params: { clientId: 'second', subscriptions: [ROOT], lastSeenServerSeq: Number(told?.params.serverSeq) - 1 },
  }) as Bag;
  const again = (answer.result ?? answer) as { type: string; actions: { serverSeq: number; action: Bag }[] };
  expect(again.type).toBe('replay');
  const replayed = again.actions.find((one) => one.serverSeq === told?.params.serverSeq);
  expect(replayed?.action.config).toEqual({ defaultShell: '/bin/sh', telemetryLevel: 'off' });
});

it('replaces every connection\'s shell with a config that replaces the rest', async () => {
  const made = host({ terminals: shellTerminals() });
  const first = made.accept(peer());
  const other = watching();
  const second = made.accept(other);
  await hello(first, 'first'); await hello(second, 'second');
  await configChanged(second, { defaultShell: '/bin/bash' });

  await first.handle({ method: 'dispatchAction', params: { channel: ROOT, action: { type: 'root/configChanged', replace: true, config: { defaultShell: '/bin/sh' } } } });

  const told = other.seen.filter((one) => one.method === 'action' && one.params.action?.replace === true);
  expect(told).toHaveLength(1);
  expect(told[0]?.params.action?.config).toEqual({ defaultShell: '/bin/sh' });
  expect(await values(second)).toMatchObject({ defaultShell: '/bin/sh' });
});

it('lets only config:write set the shell, as it changes the rest of the host', async () => {
  const MEMBER: Grant[] = ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'];
  const made = host({ users: directory({ m: MEMBER, g: ['session:read'], a: ['config:write'] }) });
  const refusals = (seen: ReturnType<typeof watching>) =>
    seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
      .map((one) => String(one.params.rejectionReason));

  const memberSeen = watching();
  const member = made.accept(memberSeen);
  await hello(member, 'member'); await signIn(member, 'm');
  await configChanged(member, { defaultShell: '/bin/sh' });
  await configChanged(member, { telemetryLevel: 'off' });
  expect(refusals(memberSeen)).toEqual(['m may not config:change here', 'm may not config:change here']);
  expect(await values(member)).not.toHaveProperty('defaultShell');
  expect(await values(member)).not.toHaveProperty('telemetryLevel');

  const adminSeen = watching();
  const admin = made.accept(adminSeen);
  await hello(admin, 'admin'); await signIn(admin, 'a');
  await configChanged(admin, { defaultShell: '/bin/sh', telemetryLevel: 'off' });
  expect(refusals(adminSeen)).toEqual([]);
  expect(await values(member)).toMatchObject({ defaultShell: '/bin/sh', telemetryLevel: 'off' });

  // Nobody signed in sets nothing.
  const strangerSeen = watching();
  const stranger = made.accept(strangerSeen);
  await hello(stranger, 'stranger');
  await configChanged(stranger, { defaultShell: '/bin/sh' });
  expect(refusals(strangerSeen)).toEqual(['Sign in to use this host: ahp-root:// needs config:change']);
});

/*
 * Pushing trust needs a grant.
 *
 * `workspaceTrust` is one value for the whole host, beside `defaultShell`, and
 * it decides what sessions load from a folder, project settings and hooks
 * included. The trust key alone needs `trust:push`, and the `trust:write` group
 * covers it.
 */

/** The refusals a connection was told, which is how a notification is refused. */
const refusalsOf = (seen: ReturnType<typeof watching>): string[] =>
  seen.seen.filter((one) => one.method === 'action' && typeof one.params.rejectionReason === 'string')
    .map((one) => String(one.params.rejectionReason));

/** A directory of its own with one person in it, minted, so a built-in role is the real one. */
const signedUp = async (...roles: string[]): Promise<{ users: Users; secret: string }> => {
  const users = fileUsers({ path: join(root, 'users.json') });
  await users.add('ana', roles);
  return { users, secret: await users.mint('ana') };
};

it('refuses a workspaceTrust push from a role holding no trust grant', async () => {
  const made = host({ users: directory({ m: ['file:read', 'session:read', 'terminal:read'] }) });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, 'm'); await signIn(client, 'm');

  await configChanged(client, { workspaceTrust: { enabled: true, trustedUris: [`file://${root}`] } });
  expect(refusalsOf(seen)).toEqual(['m may not trust:push here']);
  // And nothing was kept: a refused push is a refusal, not a stored value.
  expect(await values(client)).not.toHaveProperty('workspaceTrust');
});

it('accepts a workspaceTrust push from a role holding only trust:push', async () => {
  // A role of this install's own, so the operation the gate asks for is the
  // whole of what the connection holds.
  const users = fileUsers({ path: join(root, 'users.json') });
  await users.addRole('pushers', ['trust:push']);
  await users.add('ana', ['pushers']);
  const secret = await users.mint('ana');
  const made = host({ users });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, 'ana'); await signIn(client, secret);

  const trust = { enabled: true, trustedUris: [`file://${root}`] };
  await configChanged(client, { workspaceTrust: trust });
  expect(refusalsOf(seen)).toEqual([]);
  expect(await values(client)).toMatchObject({ workspaceTrust: trust });
});

it('refuses a workspaceTrust push from a role holding only trust:get', async () => {
  const made = host({ users: directory({ m: ['trust:get'] }) });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, 'm'); await signIn(client, 'm');

  // The subject is right and the act is not: what the gate asks for is the
  // push, and a grant that names another act of `trust` is not it.
  await configChanged(client, { workspaceTrust: { enabled: true, trustedUris: [`file://${root}`] } });
  expect(refusalsOf(seen)).toEqual(['m may not trust:push here']);
});

it('accepts a workspaceTrust push from a member', async () => {
  const { users, secret } = await signedUp('member');
  const made = host({ users });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, 'ana'); await signIn(client, secret);

  const trust = { enabled: true, trustedUris: [`file://${root}`] };
  await configChanged(client, { workspaceTrust: trust });
  expect(refusalsOf(seen)).toEqual([]);
  // The host's, which every connection reads.
  expect(await values(client)).toMatchObject({ workspaceTrust: trust });
});

it('keeps the trust the host had when a push is refused', async () => {
  const usersPath = join(root, 'users.json');
  // A role of this install's own, so the grant can be taken away mid-connection.
  writeFileSync(usersPath, JSON.stringify({ roles: { files: ['file:read'] }, users: [] }));
  const users = fileUsers({ path: usersPath });
  await users.add('ana', ['member']);
  const secret = await users.mint('ana');
  const made = host({ users });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, 'ana'); await signIn(client, secret);

  const pushed = { enabled: true, trustedUris: [`file://${root}`] };
  await configChanged(client, { workspaceTrust: pushed });
  expect(refusalsOf(seen)).toEqual([]);

  // A role is read again on every dispatch, so the grant going away is in force
  // on the next push - which is refused, and leaves what the host had.
  await users.add('ana', ['files']);
  await configChanged(client, { workspaceTrust: { enabled: false, trustedUris: [] } });
  expect(refusalsOf(seen)).toEqual(['ana may not trust:push here']);
  expect(await values(client)).toMatchObject({ workspaceTrust: pushed });
});

/*
 * Pushing a terminal rule needs `config:change`.
 *
 * `terminalAutoApproveRules` is one value for the whole host, and every rule in
 * it runs against every command of every session there - a `/.../` key that
 * does not finish stalls the daemon for every person.
 */
it('refuses a pushed regular expression from a member, and the root connection takes it', async () => {
  const made = host({ users: directory({ m: ['file:read', 'session:read'] }) });
  const memberSeen = watching();
  const member = made.accept(memberSeen);
  await hello(member, 'm'); await signIn(member, 'm');

  const pushed = { terminalAutoApproveRules: { '/(a+)+$/': true } };
  await configChanged(member, pushed);
  expect(refusalsOf(memberSeen)).toEqual(['m may not config:change here']);
  // A refused push is a refusal, not a stored value.
  expect(await values(member)).not.toHaveProperty('terminalAutoApproveRules');

  // The door's own connection holds every grant, so it may push the rule.
  const rootSeen = watching();
  const door = made.accept(rootSeen, undefined, true);
  await hello(door);
  await configChanged(door, pushed);
  expect(refusalsOf(rootSeen)).toEqual([]);
  expect(await values(door)).toMatchObject(pushed);
});

it('refuses defaultShell alone from a role with no config grant', async () => {
  const made = host({ users: directory({ g: ['session:read'] }) });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client, 'g'); await signIn(client, 'g');

  await configChanged(client, { defaultShell: '/bin/sh' });
  expect(refusalsOf(seen)).toEqual(['g may not config:change here']);
  expect(await values(client)).not.toHaveProperty('defaultShell');
});

it('accepts every push on a host with no people directory', async () => {
  const made = host();
  const seen = watching();
  const client = made.accept(seen);
  await hello(client);

  await configChanged(client, { workspaceTrust: { enabled: true, trustedUris: [`file://${root}`] } });
  await configChanged(client, { telemetryLevel: 'off' });
  expect(refusalsOf(seen)).toEqual([]);
});

it('opens every client\'s terminal with the host\'s shell', async () => {
  const OPENS: Grant[] = ['file:read', 'file:write', 'session:read', 'session:write', 'terminal:read', 'terminal:write'];
  const made = host({ users: directory({ a: ['config:write', ...OPENS], b: OPENS }), terminals: shellTerminals() });
  const client = made.accept(peer());
  await hello(client, 'a'); await signIn(client, 'a');
  const other = made.accept(peer());
  await hello(other, 'b'); await signIn(other, 'b');
  // A shell this machine has, as one it does not have opens the host's own.
  const shell = process.platform === 'win32' ? process.env.ComSpec ?? 'C:\\Windows\\System32\\cmd.exe' : '/bin/sh';
  await configChanged(client, { defaultShell: shell });

  // The title is the shell's own name when nobody named the terminal, which is
  // how the chosen binary is visible from outside: the one value opens the
  // terminal of the connection that pushed it and of the one that did not.
  for (const [one, uri] of [[client, 'ahp-terminal:/mine'], [other, 'ahp-terminal:/theirs']] as const) {
    expect(await call(one, 'createTerminal', {
      channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: `file://${root}`,
    })).toHaveProperty('result');
    const shown = (await terminalsOf(one)).find((row) => row.resource === uri);
    expect(shown?.title).toBe(basename(shell));
  }
});

it('refuses a shell from a role with no config grant, and that role opens no terminal', async () => {
  const made = host({ users: directory({ w: ['file:read', 'file:write', 'session:read', 'session:write'] }), terminals: shellTerminals() });
  const seen = watching();
  const client = made.accept(seen);
  await hello(client); await signIn(client, 'w');

  await configChanged(client, { defaultShell: '/tmp/not-a-shell' });
  expect(refusalsOf(seen)).toEqual(['w may not config:change here']);
  expect(await values(client)).not.toHaveProperty('defaultShell');
  expect(await call(client, 'createTerminal', { channel: 'ahp-terminal:/no', cwd: root })).toMatchObject({ code: -32009 });
});

it('keeps one shell for every connection with no user directory either', async () => {
  const made = host({ terminals: shellTerminals() });
  const first = made.accept(peer());
  const second = made.accept(peer());
  await hello(first); await hello(second);
  await configChanged(first, { defaultShell: '/bin/sh' });
  expect(await values(first)).toMatchObject({ defaultShell: '/bin/sh' });
  expect(await values(second)).toMatchObject({ defaultShell: '/bin/sh' });
});
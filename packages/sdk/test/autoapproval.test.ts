import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { uriOf } from '../src/resources/fileuri.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { echo } from '../../../examples/echo/agent.js';
import { questionOf, questioning } from './support/questions.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import type { SessionStore } from '../src/types/sessions.js';
import type { Users } from '../src/types/users.js';

/*
 * A session's commands, answered by the host's rules.
 *
 * The host decides a backend's question with its approval chain, reading the
 * host's one value of each rule, which the last push from any window set, as
 * the reference host reads it: a command the rules approve is answered with
 * nobody asked, and any other is put to a window. This file is the answer in
 * each of the cases that can decide it: one window, two windows pushing, and
 * a window that turned the check off.
 * https://github.com/microsoft/vscode/blob/a12547442f722dfe0a6ec105f986cfe65b8d6f22/src/vs/platform/agentHost/node/sessionPermissions.ts#L361
 */

const DIR = mkdtempSync(join(tmpdir(), 'ahpd-autoapproval-'));
const RESOURCE = 'ahpd://users';

/** A directory that knows one admin and one member, by the token each presents. */
const directory = (): Users => ({
  resource: { resource: RESOURCE, resource_name: 'ahpd users', authorization_servers: [RESOURCE], required: false },
  verify: async (token) => {
    if (token === 'admin') return { id: 'ana', roles: ['admin'], can: () => true };
    if (token === 'admin-two') return { id: 'bo', roles: ['admin'], can: () => true };
    if (token === 'member') return { id: 'bo', roles: ['member'], can: (grant: string) => grant === 'session:read' };
    return undefined;
  },
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'admin',
});

const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** Let the dispatch, its echo and the write behind it come to. */
const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise((done) => { setTimeout(done, 0); });
};

/** VS Code's options for a question a managed rule asks, in its words. */
const ONCE = [
  { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
  { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
];

/**
 * A host with a people directory, and one connection per token: on `store`
 * and with the backend `listed` where a case gives them, and with the
 * operator's `eligibleForAutoApproval` where a case sets it. `listed` has the
 * backend know the one session a daemon before this one made, so a turn opens
 * it again.
 */
function serving(
  terminalAutoApproveDefaults: 'vscode' | 'none' = 'vscode',
  { store, listed = false, eligibleForAutoApproval }: { store?: SessionStore; listed?: boolean; eligibleForAutoApproval?: Record<string, boolean> } = {},
) {
  const backend = questioning(DIR, listed ? {
    list: async () => [{
      id: 'bo-one',
      title: 'Bo one',
      createdAt: '2026-10-06T00:00:00.000Z',
      modifiedAt: '2026-10-06T09:00:00.000Z',
      workingDirectories: [uriOf(DIR)],
    }],
    transcript: async () => [],
  } : {});
  const host = createHost({
    path: DIR, agents: [backend.agent], users: directory(), terminalAutoApproveDefaults,
    ...(store === undefined ? {} : { sessions: store }),
    ...(eligibleForAutoApproval === undefined ? {} : { eligibleForAutoApproval }),
  });
  /** What each connection heard. */
  const heard = new Map<Client, { method: string; params: unknown }[]>();
  const join = async (token: string, clientId: string): Promise<Client> => {
    const p = peer();
    const client = host.accept(p);
    heard.set(client, p.notes);
    await client.handle({
      method: 'initialize',
      params: { clientId, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
    });
    await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RESOURCE, token } });
    return client;
  };
  const signedIn = (token: string, clientId: string): Promise<Client> => join(token, clientId);
  /** What a window pushes, which is the whole of that window's rules. */
  const pushing = async (client: Client, config: Record<string, unknown>): Promise<void> => {
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config } },
    });
    await settle();
  };
  /** The default chat the host minted for a session, read off the session's state. */
  const chatOf = async (client: Client, uri: string): Promise<string> =>
    ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  /** A session one window asked for, watched by it with its chat. */
  const opening = async (client: Client, name: string): Promise<void> => {
    const uri = `ahp-session:/${name}`;
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(DIR)] },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await client.handle({ method: 'subscribe', params: { channel: await chatOf(client, uri) } });
    await settle();
  };
  let turns = 0;
  /**
   * What the host did with a question its backend put in a turn the window
   * sends on a session: `approved` where it answered the backend itself, and
   * the options of the question it said otherwise.
   */
  const decided = async (client: Client, session: string, tool: string, asked: Bag): Promise<'approved' | unknown> => {
    turns += 1;
    const turnId = `q${turns}`;
    const chat = await chatOf(client, `ahp-session:/${session}`);
    backend.ask(tool, asked);
    await client.handle({ method: 'subscribe', params: { channel: chat } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
    });
    await settle();
    const question = questionOf(heard.get(client) ?? [], turnId);
    return question === undefined && backend.answerOf(turnId) === true ? 'approved' : question?.options;
  };
  /** A command line, run by `tool`, in bash. */
  const command = (client: Client, session: string, line: string, tool = 'bash'): Promise<'approved' | unknown> =>
    decided(client, session, tool, { permissionKind: 'shell', shellCommand: line, shellLanguage: 'bash' });
  /** A call that is not a command line, of the tool named. */
  const call = (client: Client, session: string, name: string): Promise<'approved' | unknown> =>
    decided(client, session, name, { permissionKind: 'custom-tool' });
  return { signedIn, pushing, opening, command, call };
}

it('answers a command from the rules a window pushed', async () => {
  const { signedIn, pushing, opening, command } = serving();
  const ana = await signedIn('admin', 'ana');
  // A rule of its own, to show the pushed table is the one that answers: `ls`
  // is in the default table and `make test` is in neither.
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true } });
  await opening(ana, 'ana-one');

  expect(await command(ana, 'ana-one', 'make test')).toBe('approved');
  // The table pushed is the whole table: a command the default approves asks.
  expect(await command(ana, 'ana-one', 'ls -la')).not.toBe('approved');
  expect(await command(ana, 'ana-one', 'rm -rf /')).not.toBe('approved');
});

it('reads the last push of any window when two windows push rules', async () => {
  const { signedIn, pushing, opening, command } = serving();
  const ana = await signedIn('admin', 'ana');
  const bo = await signedIn('admin-two', 'bo');
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true } });
  await opening(ana, 'ana-one');
  expect(await command(ana, 'ana-one', 'make test')).toBe('approved');

  // Bo's push is the host's table now, Ana's session's among them: one value,
  // which the last push set.
  await pushing(bo, { terminalAutoApproveRules: { 'make build': true } });
  expect(await command(ana, 'ana-one', 'make build')).toBe('approved');
  expect(await command(ana, 'ana-one', 'make test')).not.toBe('approved');

  // An empty table pushed is a table with nothing in it, not a window that
  // never spoke: the answers above fall back to none, and the default table
  // does not come back.
  await pushing(ana, { terminalAutoApproveRules: {} });
  expect(await command(ana, 'ana-one', 'make build')).not.toBe('approved');
  expect(await command(ana, 'ana-one', 'ls -la')).not.toBe('approved');
});

/*
 * The rules answer a session's lines whoever sent the turn that started it, as
 * VS Code's host reads its one value of each for every question.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L380
 */
it('answers a command by the host\'s rules in a session somebody other than its owner started again', async () => {
  const store = memorySessions();
  const first = serving('vscode', { store });
  const bo = await first.signedIn('admin-two', 'bo');
  await first.opening(bo, 'bo-one');
  // The chat the host minted for the session, which its record keeps for the
  // next daemon too.
  const chat = ((await bo.handle({ method: 'subscribe', params: { channel: 'ahp-session:/bo-one' } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;
  // One turn, so the session is one the next daemon reads back.
  await bo.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't0', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello' } } },
  });
  await settle();

  // The daemon again on the same store, where Ana's turn starts Bo's session.
  const second = serving('vscode', { store, listed: true });
  const ana = await second.signedIn('admin', 'ana');
  await second.pushing(ana, { terminalAutoApproveRules: { 'make test': true } });
  await ana.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'go' } } },
  });
  await settle();

  expect(await second.command(ana, 'bo-one', 'make test')).toBe('approved');
});

it('approves VS Code\'s table when the window pushed no rules', async () => {
  const { signedIn, opening, command } = serving();
  const ana = await signedIn('admin', 'ana');
  await opening(ana, 'ana-one');

  // No window has pushed a table, so the daemon's `vscode` default answers.
  expect(await command(ana, 'ana-one', 'ls -la')).toBe('approved');
  expect(await command(ana, 'ana-one', 'make test')).not.toBe('approved');
});

it('approves nothing under none when the window pushed no rules', async () => {
  const { signedIn, pushing, opening, command } = serving('none');
  const ana = await signedIn('admin', 'ana');
  await opening(ana, 'ana-one');

  // A command the default table approves is still a command nothing approved.
  expect(await command(ana, 'ana-one', 'ls -la')).not.toBe('approved');
  expect(await command(ana, 'ana-one', 'echo hi')).not.toBe('approved');

  // And a table the window pushes answers as it always did: the setting is
  // only what applies when the window said nothing.
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true } });
  expect(await command(ana, 'ana-one', 'make test')).toBe('approved');
});

it('asks every command when the window turned the check off', async () => {
  const { signedIn, pushing, opening, command } = serving();
  const ana = await signedIn('admin', 'ana');
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true }, terminalAutoApproveEnabled: false });
  await opening(ana, 'ana-one');

  expect(await command(ana, 'ana-one', 'make test')).not.toBe('approved');

  // Turned back on, the rules it pushed while off are still its rules.
  await pushing(ana, { terminalAutoApproveEnabled: true });
  expect(await command(ana, 'ana-one', 'make test')).toBe('approved');
});

/*
 * The operator's rule is the daemon's `eligibleForAutoApproval`, as VS Code's
 * host takes the setting from its policy value alone: a question about a tool
 * it names is a managed one, Allow Once and Skip.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L22-L42
 */
it('asks for a tool the rule names, in every session', async () => {
  const { signedIn, opening, call } = serving('vscode', { eligibleForAutoApproval: { 'tracker/create': false, 'mail/send': true } });
  const ana = await signedIn('admin', 'ana');
  const bo = await signedIn('admin-two', 'bo');
  await opening(ana, 'ana-one');

  expect(await call(ana, 'ana-one', 'tracker/create')).toEqual(ONCE);
  // `true` is eligible, which is the same as saying nothing about it.
  expect(await call(ana, 'ana-one', 'mail/send')).not.toEqual(ONCE);
  expect(await call(ana, 'ana-one', 'tracker/close')).not.toEqual(ONCE);

  // The rule is the host's: a session another window starts is asked too.
  await opening(bo, 'bo-one');
  expect(await call(bo, 'bo-one', 'tracker/create')).toEqual(ONCE);
});

it('matches a whole server with `/*`, and an exact key wins', async () => {
  const { signedIn, opening, call } = serving('vscode', { eligibleForAutoApproval: { 'tracker/*': false, 'tracker/read': true } });
  const ana = await signedIn('admin', 'ana');
  await opening(ana, 'ana-one');

  expect(await call(ana, 'ana-one', 'tracker/create')).toEqual(ONCE);
  expect(await call(ana, 'ana-one', 'tracker/close')).toEqual(ONCE);
  // The exact key is read before the server's wildcard, as VS Code reads it.
  expect(await call(ana, 'ana-one', 'tracker/read')).not.toEqual(ONCE);
  expect(await call(ana, 'ana-one', 'mail/send')).not.toEqual(ONCE);
});

it('asks for a shell the rule names, before a terminal rule answers', async () => {
  const { signedIn, pushing, opening, command } = serving('vscode', { eligibleForAutoApproval: { Bash: false } });
  const ana = await signedIn('admin', 'ana');
  await pushing(ana, { terminalAutoApproveRules: { 'ls -la': true } });
  await opening(ana, 'ana-one');

  // The terminal rule approves the line, and the tool it runs under is one
  // that asks every time.
  expect(await command(ana, 'ana-one', 'ls -la', 'Bash')).toEqual(ONCE);
  // A line under a tool the rule does not name is answered by the terminal
  // rules.
  expect(await command(ana, 'ana-one', 'ls -la', 'pwsh')).toBe('approved');
  // And the rule is the managed layer's, apart from the terminal check:
  // turning that check off leaves the named tool asking, Allow Once and Skip.
  await pushing(ana, { terminalAutoApproveEnabled: false });
  expect(await command(ana, 'ana-one', 'ls -la', 'pwsh')).not.toBe('approved');
  expect(await command(ana, 'ana-one', 'ls -la', 'Bash')).toEqual(ONCE);
});

/*
 * The sensitive edit locations are the host's: VS Code sends them before each
 * turn whatever the backend declares, its host declares them on every session
 * and takes them, and a write into one asks.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L2273-L2286
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/sessionPermissions.ts#L774-L815
 */
it('takes the sensitive edit locations, and asks for a write into one', async () => {
  const { signedIn, pushing, opening, command } = serving();
  const ana = await signedIn('admin', 'ana');
  await pushing(ana, { editAutoApprovePatterns: { '**/*': true } });
  await opening(ana, 'ana-sensitive');
  const channel = 'ahp-session:/ana-sensitive';
  expect(await command(ana, 'ana-sensitive', 'echo hi > .github/hooks/a.json')).toBe('approved');

  const locations = [{ path: '.github/hooks', isDirectory: true }];
  await ana.handle({
    method: 'dispatchAction',
    params: { channel, action: { type: 'session/configChanged', config: { sensitiveEditLocations: locations } } },
  });
  await settle();

  // Declared, taken and said back: the echo backend declares no such key.
  const { snapshot } = await ana.handle({ method: 'subscribe', params: { channel } }) as {
    snapshot: { state: { config: { schema: { properties: Record<string, { sessionMutable?: boolean }> }; values: Record<string, unknown> } } };
  };
  expect(snapshot.state.config.schema.properties['sensitiveEditLocations']?.sessionMutable).toBe(true);
  expect(snapshot.state.config.values['sensitiveEditLocations']).toEqual(locations);
  expect(await command(ana, 'ana-sensitive', 'echo hi > .github/hooks/a.json')).not.toBe('approved');
  expect(await command(ana, 'ana-sensitive', 'echo hi > out.txt')).toBe('approved');
});

/*
 * The locations reach the backend as VS Code's host hands its agents every key
 * but its own: at its start, and as they move, whatever the backend answers,
 * since this host takes the key.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L520-L528
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentService.ts#L1831-L1836
 */
it('hands the sensitive edit locations to the backend at its start and as they move', async () => {
  const base = echo({ path: DIR, pace: 0 });
  /** The settings each start was handed, and every key the backend was handed after. */
  const started: Record<string, unknown>[] = [];
  const handed: [string, unknown][] = [];
  const agent: Agent = {
    ...base,
    provider: 'echo',
    create: (given: Start) => {
      started.push(given.settings);
      return {
        ...base.create(given),
        setConfig: (key: string, value: unknown) => {
          handed.push([key, value]);
          return `${key} is not a config key this backend takes`;
        },
      };
    },
  };
  const host = createHost({ path: DIR, agents: [agent] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['0.9.0'] } });
  const channel = 'ahp-session:/handed';
  const first = [{ path: '.github/hooks', isDirectory: true }];
  await client.handle({ method: 'createSession', params: { channel, provider: 'echo', config: { sensitiveEditLocations: first } } });
  await client.handle({ method: 'subscribe', params: { channel } });
  await settle();
  expect(started.at(-1)?.['sensitiveEditLocations']).toEqual(first);

  const next = [{ path: '.vscode', isDirectory: true }];
  await client.handle({
    method: 'dispatchAction',
    params: { channel, clientSeq: 1, action: { type: 'session/configChanged', config: { sensitiveEditLocations: next } } },
  });
  await settle();
  expect(handed).toEqual([['sensitiveEditLocations', next]]);
  // Taken by this host, whatever the backend answered.
  const answered = p.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { action: { type: string }; origin?: { clientSeq: number }; rejectionReason?: string })
    .find((one) => one.origin?.clientSeq === 1);
  expect(answered?.action.type).toBe('session/configChanged');
  expect(answered?.rejectionReason).toBeUndefined();
});

/*
 * The locations are read whole, as VS Code's host reads a key: a value with an
 * entry that does not fit the property's shape is skipped for the root's
 * config, which declares no such key here, so no location asks.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentConfigurationService.ts#L544-L566
 */
it('reads no locations from a value one entry of which does not fit', async () => {
  const { signedIn, pushing, opening, command } = serving();
  const ana = await signedIn('admin', 'ana');
  await pushing(ana, { editAutoApprovePatterns: { '**/*': true } });
  await opening(ana, 'ana-malformed');
  const channel = 'ahp-session:/ana-malformed';
  const locations = [{ path: '.github/hooks', isDirectory: true }, { path: '.vscode' }];
  await ana.handle({
    method: 'dispatchAction',
    params: { channel, action: { type: 'session/configChanged', config: { sensitiveEditLocations: locations } } },
  });
  await settle();
  expect(await command(ana, 'ana-malformed', 'echo hi > .github/hooks/a.json')).toBe('approved');
});

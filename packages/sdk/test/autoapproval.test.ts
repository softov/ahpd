import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { uriOf } from '../src/resources/fileuri.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { Users } from '../src/types/users.js';

/*
 * A session's commands, answered by the host's rules.
 *
 * `Start.getAutoApproval` is the host's answer to "does this run without
 * asking?", and it is read from the host's one value of each rule, which the
 * last push from any window set, as the reference host reads it. This file is
 * the answer in each of the cases that can decide it: one window, two windows
 * pushing, and a window that turned the check off.
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

/** The example backend, keeping the last start it was asked to make. */
function backend() {
  const base = echo({ path: DIR, pace: 0 });
  let start: Start | undefined;
  const agent: Agent = {
    ...base,
    provider: 'echo',
    displayName: 'Echo backend',
    create: (given: Start) => {
      start = given;
      return base.create(given);
    },
  };
  return { agent, start: (): Start | undefined => start };
}

/** What the last start's check says about a command line, run by one tool. */
const approval = (start: Start | undefined, line: string, tool?: string): string | undefined =>
  start?.getAutoApproval?.('shell', line, 'bash', tool);

/** What the last start's check says about a call that is not a command line. */
const toolApproval = (start: Start | undefined, name: string): string | undefined =>
  start?.getAutoApproval?.('tool', name);

/** A host with a people directory, and one connection per token. */
function serving(terminalAutoApproveDefaults: 'vscode' | 'none' = 'vscode') {
  const { agent, start } = backend();
  const host = createHost({ path: DIR, agents: [agent], users: directory(), terminalAutoApproveDefaults });
  const join = async (token: string, clientId: string): Promise<Client> => {
    const client = host.accept(peer());
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
  /** A session one window asked for, watched by it. */
  const opening = async (client: Client, name: string): Promise<void> => {
    const uri = `ahp-session:/${name}`;
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'echo', workingDirectories: [uriOf(DIR)] },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    await settle();
  };
  return { signedIn, pushing, opening, start };
}

it('answers a command from the rules a window pushed', async () => {
  const { signedIn, pushing, opening, start } = serving();
  const ana = await signedIn('admin', 'ana');
  // A rule of its own, to show the pushed table is the one that answers: `ls`
  // is in the default table and `make test` is in neither.
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true } });
  await opening(ana, 'ana-one');

  expect(approval(start(), 'make test')).toBe('not-needed');
  // The table pushed is the whole table: a command the default approves asks.
  expect(approval(start(), 'ls -la')).toBeUndefined();
  expect(approval(start(), 'rm -rf /')).toBeUndefined();
});

it('reads the last push of any window when two windows push rules', async () => {
  const { signedIn, pushing, opening, start } = serving();
  const ana = await signedIn('admin', 'ana');
  const bo = await signedIn('admin-two', 'bo');
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true } });
  await opening(ana, 'ana-one');
  expect(approval(start(), 'make test')).toBe('not-needed');

  // Bo's push is the host's table now, Ana's session's among them: one value,
  // which the last push set.
  await pushing(bo, { terminalAutoApproveRules: { 'make build': true } });
  expect(approval(start(), 'make build')).toBe('not-needed');
  expect(approval(start(), 'make test')).toBeUndefined();

  // An empty table pushed is a table with nothing in it, not a window that
  // never spoke: the answers above fall back to none, and the default table
  // does not come back.
  await pushing(ana, { terminalAutoApproveRules: {} });
  expect(approval(start(), 'make build')).toBeUndefined();
  expect(approval(start(), 'ls -la')).toBeUndefined();
});

it('approves VS Code\'s table when the window pushed no rules', async () => {
  const { signedIn, opening, start } = serving();
  const ana = await signedIn('admin', 'ana');
  await opening(ana, 'ana-one');

  // No window has pushed a table, so the daemon's `vscode` default answers.
  expect(approval(start(), 'ls -la')).toBe('not-needed');
  expect(approval(start(), 'make test')).toBeUndefined();
});

it('approves nothing under none when the window pushed no rules', async () => {
  const { signedIn, pushing, opening, start } = serving('none');
  const ana = await signedIn('admin', 'ana');
  await opening(ana, 'ana-one');

  // A command the default table approves is still a command nothing approved.
  expect(approval(start(), 'ls -la')).toBeUndefined();
  expect(approval(start(), 'echo hi')).toBeUndefined();

  // And a table the window pushes answers as it always did: the setting is
  // only what applies when the window said nothing.
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true } });
  expect(approval(start(), 'make test')).toBe('not-needed');
});

it('asks every command when the window turned the check off', async () => {
  const { signedIn, pushing, opening, start } = serving();
  const ana = await signedIn('admin', 'ana');
  await pushing(ana, { terminalAutoApproveRules: { 'make test': true }, terminalAutoApproveEnabled: false });
  await opening(ana, 'ana-one');

  expect(approval(start(), 'make test')).toBeUndefined();

  // Turned back on, the rules it pushed while off are still its rules.
  await pushing(ana, { terminalAutoApproveEnabled: true });
  expect(approval(start(), 'make test')).toBe('not-needed');
});

it('asks for a tool the rule names, in every session', async () => {
  const { signedIn, pushing, opening, start } = serving();
  const ana = await signedIn('admin', 'ana');
  const bo = await signedIn('admin-two', 'bo');
  await pushing(ana, { eligibleForAutoApproval: { 'tracker/create': false, 'mail/send': true } });
  await opening(ana, 'ana-one');

  expect(toolApproval(start(), 'tracker/create')).toBe('ask');
  // `true` is eligible, which is the same as saying nothing about it.
  expect(toolApproval(start(), 'mail/send')).toBeUndefined();
  expect(toolApproval(start(), 'tracker/close')).toBeUndefined();

  // The rule is the host's, not the window's: a session another window starts
  // is asked too, unlike the terminal rules above.
  await opening(bo, 'bo-one');
  expect(toolApproval(start(), 'tracker/create')).toBe('ask');
});

it('matches a whole server with `/*`, and an exact key wins', async () => {
  const { signedIn, pushing, opening, start } = serving();
  const ana = await signedIn('admin', 'ana');
  await pushing(ana, { eligibleForAutoApproval: { 'tracker/*': false, 'tracker/read': true } });
  await opening(ana, 'ana-one');

  expect(toolApproval(start(), 'tracker/create')).toBe('ask');
  expect(toolApproval(start(), 'tracker/close')).toBe('ask');
  // The exact key is read before the server's wildcard, as VS Code reads it.
  expect(toolApproval(start(), 'tracker/read')).toBeUndefined();
  expect(toolApproval(start(), 'mail/send')).toBeUndefined();
});

it('asks for a shell the rule names, before a terminal rule answers', async () => {
  const { signedIn, pushing, opening, start } = serving();
  const ana = await signedIn('admin', 'ana');
  await pushing(ana, {
    terminalAutoApproveRules: { 'ls -la': true },
    eligibleForAutoApproval: { Bash: false },
  });
  await opening(ana, 'ana-one');

  // The terminal rule approves the line, and the tool it runs under is one
  // that asks every time.
  expect(approval(start(), 'ls -la', 'Bash')).toBe('ask');
  // A line under a tool the rule does not name is answered by the terminal
  // rules, as before.
  expect(approval(start(), 'ls -la', 'pwsh')).toBe('not-needed');
  // Without a tool to name - a backend that does not pass one - the rule has
  // nothing to match and the terminal rules answer.
  expect(approval(start(), 'ls -la')).toBe('not-needed');
  // And the rule is not the terminal check: turning that check off leaves the
  // named tool asking.
  await pushing(ana, { terminalAutoApproveEnabled: false });
  expect(approval(start(), 'ls -la', 'pwsh')).toBeUndefined();
  expect(approval(start(), 'ls -la', 'Bash')).toBe('ask');
});

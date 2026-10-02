/*
 * What a turn is charged for.
 *
 * The meter is driven through a real host and a backend that says exactly what
 * it was told to, because what is under test is the wiring rather than a
 * function: which actions a turn is remembered across, what the record says
 * about the person who sent it, and what happens when the store cannot keep
 * it. The store is in memory, so every assertion reads what the host wrote.
 */

import { expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import { memorySessions } from '../src/sessions.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { Peer } from '../src/types/rpc.js';
import type { Principal, Users } from '../src/types/users.js';
import type { ModelUse, Usage } from '../src/types/usage.js';

const DIR = '/tmp/ahpd-meter';
const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

const PROJECTS = [{ id: 'ahpd' }, { id: 'controllr' }];

/** What one person belongs to. */
const ana: Principal = {
  id: 'ana',
  roles: [],
  can: () => true,
  memberships: ['backend:*'],
  primary: 'backend:ahpd',
  projects: PROJECTS,
  teams: [{ id: 'backend' }],
};

/** Somebody who belongs to a team but to no project in it, so a turn is still chargeable. */
const dan: Principal = {
  id: 'dan',
  roles: [],
  can: () => true,
  memberships: ['backend:controllr'],
  projects: PROJECTS,
  teams: [{ id: 'backend' }],
};

/** Somebody with no memberships, which is a refusal rather than a default. */
const bob: Principal = { id: 'bob', roles: [], can: () => true, teams: [{ id: 'backend' }] };

/** Somebody whose only membership is the team itself, so their work names no project. */
const eve: Principal = {
  id: 'eve',
  roles: [],
  can: () => true,
  memberships: ['backend'],
  primary: 'backend',
  teams: [{ id: 'backend' }],
};

const directory = (): Users => ({
  resource: RECORD,
  verify: async (token) => (
    token === 'ana' ? ana : token === 'dan' ? dan : token === 'bob' ? bob : token === 'eve' ? eve : undefined
  ),
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [{ id: 'backend' }],
  projects: async () => PROJECTS,
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => 'nonsense',
});

/** A peer that keeps every action it was sent, in the order they arrived. */
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

/** Every action of one type a connection was sent, in the order they arrived. */
const sent = (wire: { notes: { method: string; params: unknown }[] }, type: string): Bag[] => wire.notes
  .filter((one) => one.method === 'action')
  .map((one) => one.params as { action: Bag })
  .filter((one) => one.action.type === type)
  .map((one) => one.action);

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** One turn as the fake backend runs it. */
interface Script {
  /** Each `chat/usage`, in the order the harness sends them. */
  reports?: Bag[];
  /** How the turn ends of its own accord. `held` waits for the client's stop. */
  end?: 'complete' | 'error' | 'held';
  /** A worker this turn delegates to, whose usage is already in the turn's own sum. */
  worker?: boolean;
  /** The turn never says it began, so its reports name an id the host never saw start. */
  unstated?: boolean;
}

/**
 * The example backend, told what each turn should say.
 *
 * Every action goes out through `start.emit`, which is the host's one path
 * for what a backend reports, and every turn's actions are sent in the order a
 * harness sends them: the turn starts, the running sum grows, and the turn
 * ends.
 */
function metered(scripts: Script[]): Agent {
  const base = echo({ path: DIR, pace: 0 });
  const waiting = [...scripts];
  return {
    ...base,
    provider: 'meter',
    displayName: 'Meter backend',
    create: (start: Start) => {
      const session = base.create(start);
      const say = (action: Bag): void => { start.emit('chat', action); };
      let running: string | undefined;
      return {
        ...session,
        begin: (turnId, text, model, from) => {
          const script = waiting.shift() ?? { end: 'complete' as const };
          if (script.unstated !== true) {
            say({
              type: 'chat/turnStarted',
              turnId,
              startedAt: '2026-10-04T10:00:00.000Z',
              message: { text, ...(from?.origin === undefined ? {} : { origin: from.origin }), ...(model === undefined ? {} : { model: { id: model.id } }) },
            });
          }
          for (const usage of script.reports ?? []) say({ type: 'chat/usage', turnId, usage });
          if (script.worker === true) {
            // A harness that runs its own subagents counts every call the turn
            // and its workers made into the turn's own sum. Its worker's chat
            // carries no report of its own, and where one does it is the
            // harness's own bookkeeping rather than a second bill.
            const chat = start.subagent?.('call-1', { title: 'Scout', prompt: 'look around' });
            if (chat !== undefined) {
              chat.emit({ type: 'chat/turnStarted', turnId: chat.turnId, startedAt: '2026-10-04T10:00:01.000Z', message: { text: 'look around' } });
              chat.emit({ type: 'chat/usage', turnId: chat.turnId, usage: report({ inputTokens: 900 }) });
              chat.end('complete');
            }
          }
          if (script.end === 'held') { running = turnId; return; }
          running = undefined;
          if (script.end === 'error') {
            say({
              type: 'chat/error',
              turnId,
              duration: 1,
              part: { kind: 'error', error: { errorType: 'turnFailed', message: 'the model refused' } },
            });
            return;
          }
          say({ type: 'chat/turnComplete', turnId, duration: 1 });
        },
        cancel: (turnId) => {
          if (running !== turnId) return;
          running = undefined;
          say({ type: 'chat/turnCancelled', turnId, duration: 1 });
        },
      };
    },
  };
}

/** An in-memory `Usage`: the records the host wrote, in the order it wrote them. */
function keeping(): Usage & { entries: ModelUse[] } {
  const entries: ModelUse[] = [];
  return {
    entries,
    record: (entry) => {
      entries.push(entry as ModelUse);
      return Promise.resolve();
    },
    total: () => Promise.resolve({}),
  };
}

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** One host with one store behind it, the lines it logged and the actions it sent. */
function serving(scripts: Script[], usage: Usage | undefined, users?: Users, usagePer?: 'turn' | 'report') {
  const said: string[] = [];
  const host = createHost({
    path: DIR,
    agents: [metered(scripts)],
    sessions: memorySessions(),
    ...(usage === undefined ? {} : { usage }),
    ...(usagePer === undefined ? {} : { usagePer }),
    onEvent: (message) => said.push(message),
    ...(users === undefined ? {} : { users }),
  });
  const wire = peer();
  const client = host.accept(wire);
  void (async () => {
    await client.handle({
      method: 'initialize',
      params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
    });
    if (users !== undefined) {
      await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token: 'ana' } });
    }
  })();
  return { host, client, wire, said };
}

/** Somebody else, on the host that is already running. */
async function colleague(host: ReturnType<typeof createHost>, token: string): Promise<Client> {
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: token, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] },
  });
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: RECORD.resource, token } });
  return client;
}

const uri = 'ahp-session:/metered';
const chatUri = 'ahp-chat:/metered';

const open = (client: Client): Promise<unknown> => client.handle({
  method: 'createSession', params: { channel: uri, provider: 'meter', config: {} },
});

const ask = (client: Client, text = 'go', turn = 't1'): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: turn, message: { text } } },
});

/** Watch the chat, which is what makes its actions arrive on this connection. */
const watch = (client: Client): Promise<unknown> =>
  client.handle({ method: 'subscribe', params: { channel: chatUri } });

const stop = (client: Client, turn = 't1'): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: turn } },
});

/** Claude Code's final report, cost in `_meta.cost`. */
const report = (over: Bag = {}): Bag => ({
  inputTokens: 100,
  outputTokens: 20,
  cacheReadTokens: 5,
  model: 'anthropic/opus-5',
  _meta: { cacheWriteTokens: 7, cost: { amount: 0.25, currency: 'USD' } },
  ...over,
});

it('writes one record for a turn that completed, saying what its last report said', async () => {
  const usage = keeping();
  const { client } = serving([
    { reports: [report({ inputTokens: 40 }), report()], end: 'complete' },
  ], usage, directory());
  await settle();
  await open(client);
  await ask(client);
  await settle();

  expect(usage.entries).toHaveLength(1);
  expect(usage.entries[0]).toEqual({
    // When the turn began, not when its last report was sent.
    at: '2026-10-04T10:00:00.000Z',
    kind: 'model',
    source: 'agent',
    owner: 'user:ana',
    team: 'backend',
    project: 'ahpd',
    session: 'meter:/metered',
    chat: 'ahp-chat://default/bWV0ZXI6L21ldGVyZWQ',
    turn: 't1',
    agent: 'meter',
    model: { name: 'anthropic/opus-5', input: 100, output: 20, cache: { read: 5, write: 7 } },
    cost: { amount: 0.25, currency: 'usd', from: 'harness' },
    pools: ['user:ana', 'team:backend', 'project:backend:ahpd'],
  });
});

it('writes the same record for a turn that was stopped and for one that failed', async () => {
  const stopped = keeping();
  const held = serving([{ reports: [report()], end: 'held' }], stopped, directory());
  await settle();
  await open(held.client);
  await ask(held.client, 'go', 't1');
  await stop(held.client, 't1');
  await settle();
  expect(stopped.entries).toHaveLength(1);
  expect(stopped.entries[0]).toMatchObject({ turn: 't1', model: { name: 'anthropic/opus-5' } });

  const failed = keeping();
  const { client } = serving([{ reports: [report()], end: 'error' }], failed, directory());
  await settle();
  await open(client);
  await ask(client, 'go', 't2');
  await settle();
  expect(failed.entries).toHaveLength(1);
  expect(failed.entries[0]).toMatchObject({ turn: 't2', model: { name: 'anthropic/opus-5' } });
});

it('writes nothing for a turn that reported no usage at all', async () => {
  const usage = keeping();
  const { client } = serving([{ end: 'complete' }], usage, directory());
  await settle();
  await open(client);
  await ask(client);
  await settle();

  expect(usage.entries).toEqual([]);
});

it('names the model the turn asked for when no report said which one ran', async () => {
  const usage = keeping();
  const { client } = serving([
    { reports: [{ inputTokens: 100, outputTokens: 20 }], end: 'complete' },
  ], usage, directory());
  await settle();
  await open(client);
  // The turn names the model as a client would pick it from a session's list.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go', model: { id: 'deepseek-chat' } } } },
  });
  await settle();

  expect(usage.entries[0]?.model.name).toBe('deepseek-chat');
});

it('charges the person who sent the turn, and not the one the session belongs to', async () => {
  const usage = keeping();
  const started = serving([{ reports: [report()], end: 'complete' }], usage, directory());
  await settle();
  await open(started.client);
  // Ana's session, and a turn somebody else sends on it.
  await ask(await colleague(started.host, 'dan'));
  await settle();

  expect(usage.entries).toHaveLength(1);
  // The scope is still the session's, which is who owns it; the owner is the
  // person who asked, which is who spent it.
  expect(usage.entries[0]).toMatchObject({
    owner: 'user:dan',
    team: 'backend',
    project: 'ahpd',
    pools: ['user:dan', 'team:backend', 'project:backend:ahpd'],
  });
});

it('charges a session nobody can be charged to no pool at all', async () => {
  const usage = keeping();
  // No users directory: there is no person to name and no team to work under.
  const { client } = serving([{ reports: [report()], end: 'complete' }], usage);
  await settle();
  await open(client);
  await ask(client);
  await settle();

  expect(usage.entries).toHaveLength(1);
  expect(usage.entries[0]).toMatchObject({ pools: [] });
  expect(usage.entries[0]?.owner).toBeUndefined();
  expect(usage.entries[0]?.team).toBeUndefined();
});

it('charges the owner and the team alone where the work names no project', async () => {
  const usage = keeping();
  const { host } = serving([{ reports: [report()], end: 'complete' }], usage, directory());
  await settle();
  // A session opened by somebody whose only membership is the team itself, so
  // their work is team work and names no project.
  const theirs = await colleague(host, 'eve');
  await open(theirs);
  await ask(theirs);
  await settle();

  expect(usage.entries[0]).toMatchObject({
    owner: 'user:eve',
    team: 'backend',
    pools: ['user:eve', 'team:backend'],
  });
  expect(usage.entries[0]?.project).toBeUndefined();
});

it('keeps each harness\'s own spelling of the cost', async () => {
  const usage = keeping();
  // cofold and Claude Code write `{ amount, currency: 'USD' }`, and ACP
  // writes the currency the agent answered in.
  const { client } = serving([
    { reports: [report({ _meta: { cost: { amount: 3, currency: 'USD' } } })], end: 'complete' },
    { reports: [report({ _meta: { cost: { amount: 4, currency: 'EUR' } } })], end: 'complete' },
    { reports: [report({ _meta: {} })], end: 'complete' },
  ], usage, directory());
  await settle();
  await open(client);
  await ask(client, 'first', 't1');
  await ask(client, 'second', 't2');
  await ask(client, 'third', 't3');
  await settle();

  expect(usage.entries.map((one) => one.cost)).toEqual([
    { amount: 3, currency: 'usd', from: 'harness' },
    { amount: 4, currency: 'eur', from: 'harness' },
    undefined,
  ]);
});

it('does not let a store that cannot keep the record break the turn', async () => {
  const failing: Usage = {
    record: () => Promise.reject(new Error('the disk is full')),
    total: () => Promise.resolve({}),
  };
  const { client, said } = serving([{ reports: [report()], end: 'complete' }], failing, directory());
  await settle();
  await open(client);
  await ask(client);
  await settle();

  // The turn ran to its end, and the failure says which session's work it was.
  expect(said.some((line) => line.includes('meter:/metered') && line.includes('the disk is full'))).toBe(true);
});

it('counts a worker once, because the turn that delegated it already counted it', async () => {
  const usage = keeping();
  const { client, wire } = serving([
    // Claude Code adds every call the turn's own agent and its subagents made
    // into the turn's sum, so the report already carries the worker's tokens.
    { reports: [report({ inputTokens: 100, outputTokens: 20 })], worker: true, end: 'complete' },
  ], usage, directory());
  await settle();
  await open(client);
  await watch(client);
  await ask(client);
  await settle();

  // The turn ended once and was billed once, even though its worker reported
  // 900 input tokens of its own.
  expect(sent(wire, 'chat/turnComplete')).toHaveLength(1);
  expect(usage.entries).toHaveLength(1);
  expect(usage.entries[0]).toMatchObject({ model: { input: 100, output: 20 } });
});

it('runs the turn normally on a host with no usage port', async () => {
  const { client, wire } = serving([{ reports: [report()], end: 'complete' }], undefined);
  await settle();
  await open(client);
  await watch(client);
  await ask(client);
  await settle();

  expect(sent(wire, 'chat/turnComplete')).toHaveLength(1);
  expect(sent(wire, 'chat/usage')).toHaveLength(1);
});

it('writes one record per report where the host was asked for that', async () => {
  const usage = keeping();
  const { client } = serving([{
    reports: [
      report({ inputTokens: 40, outputTokens: 5, cacheReadTokens: 0, _meta: { cacheWriteTokens: 0, cost: { amount: 0.1, currency: 'USD' } } }),
      report(),
      report({ inputTokens: 130, outputTokens: 31, _meta: { cacheWriteTokens: 7, cost: { amount: 0.3, currency: 'USD' } } }),
    ],
    end: 'complete',
  }], usage, directory(), 'report');
  await settle();
  await open(client);
  await ask(client);
  await settle();

  // Three reports and three records, and the turn's end added no fourth.
  expect(usage.entries).toHaveLength(3);
  expect(usage.entries.map((one) => one.model)).toEqual([
    { name: 'anthropic/opus-5', input: 40, output: 5, cache: { read: 0, write: 0 } },
    { name: 'anthropic/opus-5', input: 60, output: 15, cache: { read: 5, write: 7 } },
    { name: 'anthropic/opus-5', input: 30, output: 11, cache: { read: 0, write: 0 } },
  ]);
  // Each is what this round added rather than what the turn had spent, so the
  // three add up to the last report and no further.
  const spent = (key: 'input' | 'output'): number =>
    usage.entries.reduce((sum, one) => sum + (one.model[key] ?? 0), 0);
  expect(spent('input')).toBe(130);
  expect(spent('output')).toBe(31);
  expect(usage.entries.reduce((sum, one) => sum + (one.cost?.amount ?? 0), 0)).toBeCloseTo(0.3);
  expect(usage.entries.every((one) => one.cost?.currency === 'usd' && one.cost.from === 'harness')).toBe(true);
  // Each belongs to the turn and to the person who sent it.
  expect(usage.entries.every((one) => one.turn === 't1' && one.owner === 'user:ana')).toBe(true);
});

it('writes the reports of a turn that never said it began, per report', async () => {
  const usage = keeping();
  const { client } = serving([{
    unstated: true,
    reports: [
      report({ inputTokens: 40, outputTokens: 5, cacheReadTokens: 0, _meta: { cacheWriteTokens: 0, cost: { amount: 0.1, currency: 'USD' } } }),
      report(),
    ],
    end: 'complete',
  }], usage, directory(), 'report');
  await settle();
  await open(client);
  await ask(client);
  await settle();

  // The report was the only thing said about the turn, so each is written as it
  // arrived rather than waited for, and the turn's end added nothing. The first
  // is what it said and the second is what it added, not the whole sum again.
  expect(usage.entries.map((one) => one.model)).toEqual([
    { name: 'anthropic/opus-5', input: 40, output: 5, cache: { read: 0, write: 0 } },
    { name: 'anthropic/opus-5', input: 60, output: 15, cache: { read: 5, write: 7 } },
  ]);
  expect(usage.entries.every((one) => one.turn === 't1' && one.owner === 'user:ana')).toBe(true);
});

it('writes a count that went down as the value it is now', async () => {
  const usage = keeping();
  const { client } = serving([{
    reports: [
      report({ outputTokens: 31, _meta: { cacheWriteTokens: 7 } }),
      // A harness that recounted and reports fewer output tokens than before.
      report({ outputTokens: 4, _meta: { cacheWriteTokens: 7 } }),
    ],
    end: 'complete',
  }], usage, directory(), 'report');
  await settle();
  await open(client);
  await ask(client);
  await settle();

  expect(usage.entries.map((one) => one.model.output)).toEqual([31, 4]);
});
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentsChannel } from '../src/agents/channel.js';
import { invokeOperation } from '../src/kinds/operations.js';
import { createHost } from '../src/host.js';
import { fileUsers } from '../src/access/users.js';
import { fileResources } from '../src/resources/resources.js';
import { memoryRecords } from '../src/resources/records.js';
import { servedRecords } from '../src/resources/recordschannel.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { Engine, AgentView, AgentTemplate, ServedEngine } from '../src/types/agents.js';
import type { ConnectorRef } from '../src/types/connectors.js';
import type { HostOptions, Users } from '../src/types/index.js';
import type { PluginView, ViewHandle } from '../src/types/plugin.js';
import type { RecordCollection } from '../src/types/records.js';
import type { Vault } from '../src/types/vault.js';
import type { Icon } from '@microsoft/agent-host-protocol';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * The agents channel over a store in memory and a vault that is a map.
 *
 * The host is in this process, over a real users file, so the grant a caller
 * holds is the one the daemon would see: `agent:list` opens the channel and
 * reads the caller's own agents, their teams' and the host's, `agent:put` and
 * `agent:remove` make and remove one beside that owner's own rule, and a host
 * record takes `agent:host` on top.
 *
 * The engine's `open` hands back an agent that reads the record's values through
 * the view it was given, which is how a test tells an edit from a rebuild.
 */

const URI = 'x-ahpd-agents://';
const ROOT = 'ahp-root://';

type Bag = Record<string, any>;

/**
 * The engine's schema: what a person fills in, one secret, one field only the
 * host may set, and the `env` a key variable is set in.
 */
const SCHEMA: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    secret: { type: 'string', writeOnly: true },
    command: { type: 'string' },
    env: { type: 'object' },
  },
  required: ['target'],
};

/**
 * An engine whose records name connectors: a list of logins and one account,
 * each marked with the adapter it names, beside a field that is not marked.
 */
const LINKED: Record<string, unknown> = {
  type: 'object',
  properties: {
    target: { type: 'string' },
    logins: { type: 'array', items: { type: 'string', 'x-ahpd-connector': { adapter: 'claude-login' } } },
    account: { type: 'string', 'x-ahpd-connector': { adapter: 'mail' } },
  },
};

/** The connectors the host serves to the linked engine's records: whose each is, and of which adapter. */
const CONNECTORS: ConnectorRef[] = [
  { id: 'host-login', adapter: 'claude-login', owner: 'host' },
  { id: 'cy-login', adapter: 'claude-login', owner: 'user:cy' },
  { id: 'ana-login', adapter: 'claude-login', owner: 'user:ana' },
  { id: 'host-mail', adapter: 'mail', owner: 'host' },
];

/**
 * The subset of JSON Schema this engine's form uses, as the daemon's checker
 * reads it: a value of the named type, the required fields, and no field the
 * schema does not describe.
 */
const check = (value: unknown, schema: Bag, label: string): void => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`);
  const given = value as Bag;
  const properties = (schema['properties'] ?? {}) as Bag;
  for (const name of (schema['required'] ?? []) as string[]) {
    if (given[name] === undefined) throw new Error(`${label}.${name} is required`);
  }
  for (const [name, one] of Object.entries(properties) as [string, Bag][]) {
    if (given[name] === undefined) continue;
    if (one['type'] === 'string' && typeof given[name] !== 'string') throw new Error(`${label}.${name} must be text`);
    if (one['type'] === 'boolean' && typeof given[name] !== 'boolean') throw new Error(`${label}.${name} must be true or false`);
  }
  for (const name of Object.keys(given)) {
    if (!(name in properties)) throw new Error(`${label}.${name} is not a field`);
  }
};

/** A vault that is a map, and says what is in it. */
const made = (): Vault & { held: Map<string, string> } => {
  const held = new Map<string, string>();
  return {
    held,
    get: async (name) => held.get(name),
    set: async (name, value) => { held.set(name, value); },
    delete: async (name) => held.delete(name),
    list: async () => [...held.keys()].sort(),
  };
};

let home: string;
let usersFile: string;
beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-agents-'));
  usersFile = join(home, 'users.json');
  writeFileSync(usersFile, JSON.stringify({
    teams: [{ id: 'backend' }],
    roles: {
      lister: ['agent:list'],
      // A session's first message is a write of it, which announces it.
      writer: ['agent:list', 'agent:put', 'agent:remove', 'session:create', 'session:write'],
      teamer: ['agent:list', 'agent:put', 'agent:remove', 'session:create'],
      reader: ['agent:list'],
      'host-maker': ['agent:list', 'agent:put', 'agent:remove', 'agent:host', 'session:create'],
      all: ['agent:list', 'agent:put', 'agent:remove', 'agent:host', 'session:create'],
      'all-agents': ['agent:all'],
      'config-writer': ['config:write'],
      // What it takes to start on a host agent, which is what a removal must
      // not hand to somebody the record never named.
      starter: ['session:write', 'session:create'],
    },
    users: [
      { id: 'ana', roles: ['lister'] },
      { id: 'bo', roles: [] },
      { id: 'cy', roles: ['writer'] },
      { id: 'di', roles: ['teamer'], memberships: ['backend'] },
      { id: 'el', roles: ['reader'], memberships: ['backend'] },
      { id: 'fa', roles: ['host-maker'] },
      { id: 'gi', roles: ['all'] },
      { id: 'ja', roles: ['all-agents'] },
      { id: 'ha', roles: ['config-writer'] },
      { id: 'ka', roles: ['starter'] },
    ],
  }));
});
afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

type Host = ReturnType<typeof createHost>;

/** One record as `open` was handed it, kept to tell a rebuild from an edit. */
type Opened = AgentView;

/**
 * Two icons as the host sends them, after it resolved a template's `mark:`.
 */
const ALPHA_ICONS: Icon[] = [
  { src: 'data:image/svg+xml;base64,YWxwaGE=', contentType: 'image/svg+xml', sizes: ['any'] },
];
const BETA_ICONS: Icon[] = [
  { src: 'data:image/svg+xml;base64,YmV0YQ==', contentType: 'image/svg+xml', sizes: ['any'], theme: 'dark' },
];

/**
 * What the `checker` engine offers as templates, each with the command a record
 * made from it carries and the icons the host resolved at load.
 */
const TEMPLATES: AgentTemplate[] = [
  { name: 'Alpha', description: 'One target.', icon: { src: 'mark:alpha' }, icons: ALPHA_ICONS, config: { command: 'checker-alpha' } },
  { name: 'Beta', description: 'Another target.', icon: { src: 'mark:beta' }, icons: BETA_ICONS, config: { command: 'checker-beta' } },
];

/** The id of each record a `prober` backend was asked about, in order. */
const probed: string[] = [];

/**
 * One engine, over the echo backend.
 *
 * `probe` is built only for the `prober` engine: the host asks a fresh agent what
 * it offers, and an answer moves the root list a second time, so a case about
 * one `root/agentsChanged` is served an engine that answers nothing.
 */
const engineOf = (name: string, opened: Opened[], probing: boolean, handles: Map<string, ViewHandle>): Engine => ({
  name,
  title: 'Checker',
  description: 'Answers what it is told.',
  schema: SCHEMA,
  hostOnly: ['command'],
  keyVariables: ['API_KEY'],
  capabilities: [{ type: 'view', name: 'main', title: 'Status', description: 'What the agent last answered.' }],
  open: (record: AgentView, view?: ViewHandle): Agent => {
    opened.push(record);
    if (view !== undefined) handles.set(record.id, view);
    const base = echo({ path: home, pace: 0 });
    // The echo backend has a probe of its own, and a probe that answers moves
    // the root list again: an engine that says nothing offers none.
    delete base.probe;
    return {
      ...base,
      provider: record.id,
      displayName: record.name,
      schema: () => SCHEMA,
      ...(probing
        ? {
            probe: async () => {
              probed.push(record.id);
              const target = String(record.config['target']);
              if (target === 'broken') throw new Error('no answer from the target');
              return { models: [{ id: `on-${target}`, name: `On ${target}` }], customizations: [], commands: [] };
            },
          }
        : {}),
    };
  },
});

/**
 * An engine whose backend serves another id: a record may not be one of these,
 * because a client names a record by its id and the fold keys on the backend's.
 */
const misnamed = (opened: Opened[], handles: Map<string, ViewHandle>): ServedEngine => {
  const engine = engineOf('misnamed', opened, false, handles);
  return {
    ...engine,
    by: 'test',
    open: (record: AgentView, view?: ViewHandle) => ({ ...engine.open(record, view), provider: 'not-the-id' }),
  };
};

/**
 * A host serving the agents channel over one engine, the `checker` one.
 *
 * `fold` is called with each agent list before the host takes it, so a case
 * can ask something of the host while a fold is in flight.
 */
async function served(options: { register?: boolean; fold?: (agents: Agent[]) => Promise<void>; connectors?: readonly ConnectorRef[] } = {}) {
  const register = options.register ?? true;
  const collection: RecordCollection = await memoryRecords().collection('agents', { format: 'json' });
  const opened: Opened[] = [];
  const problems: string[] = [];
  const ended: string[] = [];
  const vault = made();
  /** The view handle each opening was handed, by agent id. */
  const handles = new Map<string, ViewHandle>();
  const engines: Record<string, ServedEngine> = register
    ? {
        checker: { ...engineOf('checker', opened, false, handles), templates: TEMPLATES, by: 'test' },
        prober: { ...engineOf('prober', opened, true, handles), by: 'test' },
        picker: {
          ...engineOf('picker', opened, false, handles),
          templates: TEMPLATES,
          templateOf: (record, made) => made.find((one) => one.name.toLowerCase() === record.id),
          by: 'test',
        },
        misnamed: misnamed(opened, handles),
        linked: { ...engineOf('linked', opened, false, handles), schema: LINKED, by: 'test' },
      }
    : {};
  // What serves an id the records do not hold: the daemon's own backend, and
  // one a plugin would have brought.
  const holders = new Map([['base', 'the daemon'], ['preset', 'plugin agent-claude']]);
  const users = fileUsers({ path: usersFile });
  // One store for every fold: a port the host was built over cannot move.
  const resources = fileResources();
  const baseAgent = { ...echo({ path: home, pace: 0 }), provider: 'base', displayName: 'Base' };
  let host: Host | undefined;
  let wire: ReturnType<typeof servedRecords>;
  /** The options the host is built over, with the records' agents beside the base. */
  const hostOptions = (agents: Agent[]): HostOptions => ({
    path: home,
    agents: [baseAgent, ...agents],
    resources,
    channels: wire.channels,
    methods: wire.methods,
    users,
    // Whose each record is, as the daemon hands it over: the list a caller is
    // sent holds the agents it may use, so `cy` reads the one it owns.
    agentOwners: () => lists.owners(),
  });
  const lists = agentsChannel({
    collection,
    engines: () => engines,
    vault: () => vault,
    check,
    refold: async (agents) => {
      if (host === undefined) throw new Error('the channel folded before there was a host');
      await options.fold?.(agents);
      const refused = host.replace(hostOptions(agents));
      if (refused !== undefined) throw new Error(refused);
      return new Set(agents.map((one) => one.provider));
    },
    endSessionsOf: async (id) => {
      ended.push(id);
      await host?.endSessionsOf(id);
    },
    holderOf: (id) => holders.get(id),
    ...(options.connectors === undefined ? {} : { connectors: () => options.connectors as readonly ConnectorRef[] }),
    onProblem: (line) => { problems.push(line); },
  });
  wire = servedRecords('ahpd', [lists.channel], {
    ...lists.methods,
    // The one command over the channel's own operations, so a case can run
    // `pause` the way a client that draws the record's ids does.
    'x-ahpd/invokeOperation': invokeOperation({
      channels: () => ({ [URI]: lists.operations }),
      check,
      onProblem: (line) => { problems.push(line); },
    }),
  });
  host = createHost(hostOptions([]));
  await lists.openAll();
  return { host, users, collection, lists, engines, opened, ended, problems, handles, vault, close: async () => { await host?.close(); } };
}

/** A client signed in as `id`, whose channel actions are kept. */
const as = async (host: Host, users: Users, id: string, locale?: string) => {
  const token = await users.mint(id);
  const seen: { method: string; params: Bag }[] = [];
  const client = host.accept({
    send: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
    notify: (method, params) => { seen.push({ method, params: params as Bag }); },
  });
  const ready = await client.handle({
    method: 'initialize', params: { clientId: id, protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT], ...(locale === undefined ? {} : { locale }) },
  }) as Bag;
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource: users.resource.resource, token } });
  const call = async (method: string, params: Bag) => client.handle({ method, params }).then(
    (result) => ({ result: result as Bag }),
    (error: { code: number; message: string }) => ({ code: error.code, message: error.message }),
  );
  /** Every row a subscribe to `channel` answered, by id. */
  const rows = async (channel = URI): Promise<Record<string, Bag>> => {
    const answer = await call('subscribe', { channel }) as Bag;
    if (answer['result'] === undefined) throw new Error(`subscribe refused: ${JSON.stringify(answer)}`);
    const records = (answer['result'] as Bag)['snapshot'].state.records as { id: string; record: Bag }[];
    return Object.fromEntries(records.map((one) => [one.id, one.record]));
  };
  /** The `agents` the root state holds now, by provider. */
  const agents = async (): Promise<string[]> => {
    const answer = await call('subscribe', { channel: ROOT }) as Bag;
    if (answer['result'] === undefined) throw new Error(`root refused: ${JSON.stringify(answer)}`);
    return ((answer['result'] as Bag)['snapshot'].state.agents as { provider: string }[]).map((one) => one.provider);
  };
  /** Every action of one type this client was sent, in the order it arrived. */
  const actions = (type: string): Bag[] => seen
    .filter((one) => one.method === 'action' && (one.params as Bag)['action']?.type === type)
    .map((one) => (one.params as Bag)['action'] as Bag);
  return { call, rows, agents, actions, ready, seen, close: () => { client.close(); } };
};

/** Wait until `check` holds, or give up: an action may land after the answer. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((done) => { setTimeout(done, 5); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

it('puts a record, lists it ready, and answers with no config of another engine', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');

  const answer = await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  expect(answer).toMatchObject({ result: { id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', state: 'ready' } });
  expect(await cy.agents()).toContain('mine');
  expect((await cy.rows())['mine']).toMatchObject({ name: 'Mine', state: 'ready' });
  await close();
});

it('sends a record its own icon as one icon, and keeps the icon field', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const icon = { src: 'data:image/svg+xml;base64,bWluZQ==', contentType: 'image/svg+xml', sizes: ['any'] };

  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', icon, config: { target: 'a' },
  });

  const row = (await cy.rows())['mine'];
  expect(row?.['icon']).toEqual(icon);
  expect(row?.['icons']).toEqual([icon]);
  await close();
});

it("sends a record with no icon its template's icons, matched by command", async () => {
  const { host, users, close } = await served();
  const fa = await as(host, users, 'fa');

  await fa.call('x-ahpd/agents/put', {
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', config: { target: 'a', command: 'checker-beta' },
  });

  const row = (await fa.rows())['theirs'];
  expect(row).not.toHaveProperty('icon');
  expect(row?.['icons']).toEqual(BETA_ICONS);
  await close();
});

it("sends a record no icon the template its engine names, whatever its command", async () => {
  const { host, users, close } = await served();
  const fa = await as(host, users, 'fa');

  // The engine answers by id, so a record named for a template is drawn with
  // it even with no command, and a command alone matches nothing.
  await fa.call('x-ahpd/agents/put', { id: 'alpha', engine: 'picker', owner: 'host', name: 'Alpha', config: { target: 'a' } });
  await fa.call('x-ahpd/agents/put', {
    id: 'other', engine: 'picker', owner: 'host', name: 'Other', config: { target: 'a', command: 'checker-beta' },
  });

  const rows = await fa.rows();
  expect(rows['alpha']?.['icons']).toEqual(ALPHA_ICONS);
  expect(rows['other']).not.toHaveProperty('icons');
  await close();
});

it('sends a record no icons when no template has its command', async () => {
  const { host, users, close } = await served();
  const fa = await as(host, users, 'fa');

  await fa.call('x-ahpd/agents/put', {
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', config: { target: 'a', command: 'checker-nothing' },
  });

  expect((await fa.rows())['theirs']).not.toHaveProperty('icons');
  await close();
});

it('edits a record on the view open was handed, without opening it again', async () => {
  const { host, users, opened, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  expect(opened).toHaveLength(1);

  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine, renamed', description: 'One line', config: { target: 'b' },
  });
  // The same view, updated: a session holding the backend reads the new record.
  expect(opened).toHaveLength(1);
  expect(opened[0]?.name).toBe('Mine, renamed');
  expect(opened[0]?.description).toBe('One line');
  expect(opened[0]?.config).toEqual({ target: 'b' });
  expect((await cy.rows())['mine']).toMatchObject({ name: 'Mine, renamed', description: 'One line' });
  await close();
});

it('asks an edited agent again what it offers, and not one whose record did not move', async () => {
  probed.splice(0);
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  /** The model ids the root state lists for `mine`, once they are `want`. */
  const offered = async (want: string[]): Promise<string[]> => {
    let ids: string[] = [];
    const end = Date.now() + WAIT_MS;
    while (Date.now() < end) {
      const answer = await cy.call('subscribe', { channel: ROOT }) as Bag;
      const agents = (answer['result'] as Bag)['snapshot'].state.agents as { provider: string; models?: { id: string }[] }[];
      ids = agents.find((one) => one.provider === 'mine')?.models?.map((one) => one.id) ?? [];
      if (JSON.stringify(ids) === JSON.stringify(want)) return ids;
      await new Promise((done) => { setTimeout(done, 5); });
    }
    return ids;
  };
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'prober', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  expect(await offered(['on-a'])).toEqual(['on-a']);
  expect(probed).toEqual(['mine']);

  // A new name moves nothing the backend offers from, so it is not asked again.
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'prober', owner: 'user:cy', name: 'Mine, renamed', config: { target: 'a' },
  });
  expect(probed).toEqual(['mine']);

  // A new target is what it offers from: the same backend is asked again.
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'prober', owner: 'user:cy', name: 'Mine, renamed', config: { target: 'b' },
  });
  expect(await offered(['on-b'])).toEqual(['on-b']);
  expect(probed).toEqual(['mine', 'mine']);
  await close();
});

it('sends one root/agentsChanged with the new agent', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const before = cy.actions('root/agentsChanged').length;

  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  await until(() => cy.actions('root/agentsChanged').length > before);
  await new Promise((done) => { setTimeout(done, 20); });

  /*
   * A change of the users directory sends the list again, whatever it holds,
   * and the token `as` minted is one. Its watch can fire after the put, so a
   * list sent again the same is not a second change.
   */
  const sent = cy.actions('root/agentsChanged').slice(before)
    .filter((one, at, all) => at === 0 || !isDeepStrictEqual(one['agents'], all[at - 1]?.['agents']));
  expect(sent).toHaveLength(1);
  expect((sent[0]?.['agents'] as { provider: string }[]).map((one) => one.provider)).toContain('mine');
  await close();
});

it('keeps a key out of every row, answer and log, and puts it in the vault', async () => {
  const { host, users, collection, problems, vault, close } = await served();
  const cy = await as(host, users, 'cy');

  const put = await cy.call('x-ahpd/agents/put', {
    id: 'mine',
    engine: 'checker',
    owner: 'user:cy',
    name: 'Mine',
    config: { target: 'a', secret: 'sk-agent-1', env: { API_KEY: 'sk-env-2' } },
  });
  const rows = await cy.rows();
  const check = await cy.call('x-ahpd/agents/check', { id: 'mine' });
  const shown = JSON.stringify([put, rows, check, problems]);
  expect(shown).not.toContain('sk-agent-1');
  expect(shown).not.toContain('sk-env-2');

  // The record keeps references, and the vault keeps the values.
  const kept = await collection.get('mine');
  expect(kept?.config).toEqual({
    target: 'a',
    secret: { $secret: 'user:cy/agent/mine/secret' },
    env: { API_KEY: { $secret: 'user:cy/agent/mine/env.API_KEY' } },
  });
  expect(vault.held.get('user:cy/agent/mine/secret')).toBe('sk-agent-1');
  expect(vault.held.get('user:cy/agent/mine/env.API_KEY')).toBe('sk-env-2');
  // And what `open` was handed is the value, which is what a session uses.
  expect(rows['mine']).toMatchObject({ state: 'ready' });
  await close();
});

it('keeps a secret a client sent empty, and never asks it to send one back', async () => {
  const { host, users, vault, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a', secret: 'sk-agent-1' },
  });
  // A client that read the row has no value to send, so it sends the field empty.
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'b', secret: '' },
  });
  expect(vault.held.get('user:cy/agent/mine/secret')).toBe('sk-agent-1');
  // A field left out drops the secret, which is what a record written whole says.
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'c' },
  });
  expect(vault.held.has('user:cy/agent/mine/secret')).toBe(false);
  await close();
});

it('refuses an engine this host does not serve', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'gone', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  })).toMatchObject({ code: -32602, message: 'gone is not an engine this host serves' });
  await close();
});

it('lists a record of an engine nobody serves as unavailable, and keeps it on disk', async () => {
  const { host, users, collection, lists, close } = await served({ register: false });
  // Written by hand, as an older daemon's folder would hold one.
  await collection.put({ id: 'old', engine: 'checker', owner: 'user:cy', name: 'Old', config: { target: 'a' } });
  await lists.openAll();
  const cy = await as(host, users, 'cy');
  expect((await cy.rows())['old']).toMatchObject({ state: 'unavailable' });
  expect(await collection.get('old')).toMatchObject({ id: 'old' });
  expect(await cy.agents()).not.toContain('old');
  await close();
});

it('lists a stored record that says kind and not engine as unavailable, and names the missing engine', async () => {
  const { host, users, collection, lists, problems, close } = await served();
  // Written by hand, as a record from before the rename to engine would be.
  await collection.put({ id: 'old', kind: 'checker', owner: 'user:cy', name: 'Old', config: { target: 'a' } });
  await lists.openAll();
  const cy = await as(host, users, 'cy');
  expect((await cy.rows())['old']).toMatchObject({ state: 'unavailable' });
  expect(await cy.agents()).not.toContain('old');
  expect(problems.some((line) => line.includes('old') && line.includes('names no engine'))).toBe(true);
  await close();
});

it('refuses an id another owner holds, and one written by hand', async () => {
  const { host, users, collection, close } = await served();
  const fa = await as(host, users, 'fa');
  const cy = await as(host, users, 'cy');
  await fa.call('x-ahpd/agents/put', {
    id: 'shared', engine: 'checker', owner: 'host', name: 'Shared', config: { target: 'a' },
  });
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'shared', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  })).toMatchObject({ code: -32009, message: "shared is host's, and an agent id is unique" });

  await collection.put({ id: 'odd', engine: 'checker', name: 'Odd', config: { target: 'a' } });
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'odd', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  })).toMatchObject({ code: -32009, message: 'odd is a record written by hand, and an agent id is unique' });
  await close();
});

it("refuses a host-only field on a team's record", async () => {
  const { host, users, close } = await served();
  const di = await as(host, users, 'di');
  expect(await di.call('x-ahpd/agents/put', {
    id: 'ours', engine: 'checker', owner: 'team:backend', name: 'Ours', config: { target: 'a', command: 'rm -rf /' },
  })).toMatchObject({ code: -32602, message: 'command is a host-only field of checker, so only a host agent may set it' });
  // The host's own record may.
  const fa = await as(host, users, 'fa');
  expect(await fa.call('x-ahpd/agents/put', {
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', config: { target: 'a', command: 'true' },
  })).toMatchObject({ result: { state: 'ready' } });
  await close();
});

it('refuses an env variable outside the engine key variables, and keeps one inside', async () => {
  const { host, users, vault, close } = await served();
  const di = await as(host, users, 'di');
  expect(await di.call('x-ahpd/agents/put', {
    id: 'ours', engine: 'checker', owner: 'team:backend', name: 'Ours', config: { target: 'a', env: { NODE_OPTIONS: '--require ./x.js' } },
  })).toMatchObject({ code: -32602, message: 'NODE_OPTIONS is not a key variable of checker, so only a host agent may set it' });

  expect(await di.call('x-ahpd/agents/put', {
    id: 'ours', engine: 'checker', owner: 'team:backend', name: 'Ours', config: { target: 'a', env: { API_KEY: 'sk-team-1' } },
  })).toMatchObject({ result: { state: 'ready' } });
  expect(vault.held.get('team:backend/agent/ours/env.API_KEY')).toBe('sk-team-1');
  await close();
});

it("refuses fromEnv on a person's record, and reads it for the host's", async () => {
  const { host, users, opened, close } = await served();
  const cy = await as(host, users, 'cy');
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a', secret: { fromEnv: 'HOME' } },
  })).toMatchObject({ code: -32602, message: "An agent's secret may read the daemon's environment only for a host agent" });

  process.env['AHPD_TEST_AGENT_KEY'] = 'sk-from-env';
  try {
    const fa = await as(host, users, 'fa');
    expect(await fa.call('x-ahpd/agents/put', {
      id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_AGENT_KEY' } },
    })).toMatchObject({ result: { state: 'ready' } });
    // What `open` was handed is the value, never the reference.
    expect(opened.at(-1)?.config['secret']).toBe('sk-from-env');
  } finally {
    delete process.env['AHPD_TEST_AGENT_KEY'];
  }
  await close();
});

/*
 * A field that names a connector.
 *
 * The engine's schema marks it `x-ahpd-connector`, as a trigger's field is
 * marked, and a put is checked against the connectors the host serves: the id
 * has to be one of the adapter the mark names, and the record owner's own or
 * the host's.
 */
describe('a field that names a connector', () => {
  it('refuses a connector the host does not serve, and writes nothing', async () => {
    const { host, users, collection, vault, close } = await served({ connectors: CONNECTORS });
    const cy = await as(host, users, 'cy');
    expect(await cy.call('x-ahpd/agents/put', {
      id: 'mine', engine: 'linked', owner: 'user:cy', name: 'Mine', config: { logins: ['cy-login', 'gone'] },
    })).toMatchObject({ code: -32602, message: 'logins names gone, and this host serves no claude-login connector with that id' });
    expect(await collection.get('mine')).toBeUndefined();
    expect(vault.held.size).toBe(0);
    expect(await cy.call('x-ahpd/agents/put', {
      id: 'mine', engine: 'linked', owner: 'user:cy', name: 'Mine', config: { account: 'gone' },
    })).toMatchObject({ code: -32602, message: 'account names gone, and this host serves no mail connector with that id' });
    await close();
  });

  it('refuses a connector of another adapter', async () => {
    const { host, users, close } = await served({ connectors: CONNECTORS });
    const fa = await as(host, users, 'fa');
    expect(await fa.call('x-ahpd/agents/put', {
      id: 'theirs', engine: 'linked', owner: 'host', name: 'Theirs', config: { logins: ['host-mail'] },
    })).toMatchObject({ code: -32602, message: 'logins names host-mail, and this host serves no claude-login connector with that id' });
    await close();
  });

  it("refuses another person's connector, and takes the owner's own and the host's", async () => {
    const { host, users, collection, close } = await served({ connectors: CONNECTORS });
    const cy = await as(host, users, 'cy');
    expect(await cy.call('x-ahpd/agents/put', {
      id: 'mine', engine: 'linked', owner: 'user:cy', name: 'Mine', config: { logins: ['ana-login'] },
    })).toMatchObject({ code: -32602, message: 'logins names ana-login, which belongs to user:ana, so user:cy may not use it' });
    expect(await cy.call('x-ahpd/agents/put', {
      id: 'mine', engine: 'linked', owner: 'user:cy', name: 'Mine', config: { logins: ['cy-login', 'host-login'], account: 'host-mail' },
    })).toMatchObject({ result: { state: 'ready' } });
    expect((await collection.get('mine'))?.config).toEqual({ logins: ['cy-login', 'host-login'], account: 'host-mail' });
    await close();
  });

  it("refuses a person's connector on a host record", async () => {
    const { host, users, close } = await served({ connectors: CONNECTORS });
    const fa = await as(host, users, 'fa');
    expect(await fa.call('x-ahpd/agents/put', {
      id: 'theirs', engine: 'linked', owner: 'host', name: 'Theirs', config: { logins: ['host-login', 'cy-login'] },
    })).toMatchObject({ code: -32602, message: 'logins names cy-login, which belongs to user:cy, so host may not use it' });
    await close();
  });

  it('checks no field the schema does not mark', async () => {
    const { host, users, close } = await served({ connectors: CONNECTORS });
    const cy = await as(host, users, 'cy');
    expect(await cy.call('x-ahpd/agents/put', {
      id: 'mine', engine: 'linked', owner: 'user:cy', name: 'Mine', config: { target: 'gone' },
    })).toMatchObject({ result: { state: 'ready' } });
    await close();
  });
});

it('reads the agents each caller may use, and refuses one with no grant', async () => {
  const { host, users, close } = await served();
  const fa = await as(host, users, 'fa');
  const di = await as(host, users, 'di');
  const cy = await as(host, users, 'cy');
  await fa.call('x-ahpd/agents/put', {
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', config: { target: 'a' },
  });
  await di.call('x-ahpd/agents/put', {
    id: 'ours', engine: 'checker', owner: 'team:backend', name: 'Ours', config: { target: 'a' },
  });
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });

  // A person reads their own agents, their teams' and the host's, and no one else's.
  expect(Object.keys(await cy.rows()).sort()).toEqual(['mine', 'theirs']);
  // A team member reads the team's and the host's.
  const el = await as(host, users, 'el');
  expect(Object.keys(await el.rows()).sort()).toEqual(['ours', 'theirs']);
  // A caller with no grant reads nothing, its own included.
  const bo = await as(host, users, 'bo');
  expect(await bo.call('subscribe', { channel: URI })).toMatchObject({ code: -32009 });
  expect(await bo.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:bo', name: 'Mine', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });
  await close();
});

it('requires agent:host for the host record and the same person for a user record', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const gi = await as(host, users, 'gi');
  // `cy` may make its own, and may not make the host's.
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  })).toMatchObject({ result: { state: 'ready' } });
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', config: { target: 'a' },
  })).toMatchObject({ code: -32009 });

  // Even every grant does not make another person's record this caller's.
  expect(await gi.call('x-ahpd/agents/remove', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(Object.keys(await gi.rows())).toEqual([]);
  // `cy` removes its own.
  expect(await cy.call('x-ahpd/agents/remove', { id: 'mine' })).toMatchObject({ result: {} });
  await close();
});

it("removes a record's secrets, and takes the agent out of the list", async () => {
  const { host, users, collection, vault, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a', secret: 'sk-agent-1' },
  });
  expect(vault.held.size).toBe(1);
  expect(await cy.call('x-ahpd/agents/remove', { id: 'mine' })).toMatchObject({ result: {} });
  expect(await collection.get('mine')).toBeUndefined();
  expect(vault.held.size).toBe(0);
  expect(await cy.agents()).not.toContain('mine');
  expect(await cy.rows()).toEqual({});
  await close();
});

it('ends the sessions of a removed agent', async () => {
  const { host, users, ended, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  const uri = 'ahp-session:/on-mine';
  await cy.call('createSession', { channel: uri, provider: 'mine' });
  // The chat the host minted for the session, read off its state by the host's
  // own root, since Cy may write the session and not read it.
  const root = host.accept({ send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} }, undefined, true);
  await root.handle({ method: 'initialize', params: { clientId: 'root', protocolVersions: ['0.9.0'] } });
  const opened = await root.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: { defaultChat: string } } };
  // Its first message, which announces it, so its end is said.
  await cy.call('dispatchAction', {
    channel: opened.snapshot.state.defaultChat,
    action: { type: 'chat/turnStarted', turnId: 'first', startedAt: new Date().toISOString(), message: { text: 'hi', origin: { kind: 'user' } } },
  });
  await until(() => cy.seen.some((one) => one.method === 'root/sessionAdded'));

  await cy.call('x-ahpd/agents/remove', { id: 'mine' });
  // The removal is a root method, not a root action: what a client reads as a
  // row going is `root/sessionRemoved`.
  const removed = () => cy.seen.filter((one) => one.method === 'root/sessionRemoved');
  await until(() => removed().length > 0);
  expect(ended).toContain('mine');
  expect(JSON.stringify(removed())).toContain('on-mine');
  await close();
});

it('refuses a start on an agent while it is being removed', async () => {
  // Ask while the removal's fold is in flight: the record is out of the store
  // and the host still serves the agent, which is the moment the id is neither
  // the owner's nor anybody else's.
  let armed = false;
  let during: { owner: Bag; other: Bag } | undefined;
  const { host, users, close } = await served({
    fold: async (agents) => {
      if (!armed || agents.some((one) => one.provider === 'mine')) return;
      during = {
        owner: await ownerAgain.call('createSession', { channel: 'ahp-session:/owner-again', provider: 'mine' }),
        other: await ka.call('createSession', { channel: 'ahp-session:/other', provider: 'mine' }),
      };
    },
  });
  const cy = await as(host, users, 'cy');
  // The same person on a second connection: the removal has the first one busy.
  const ownerAgain = await as(host, users, 'cy');
  // Holds `session:write`, which is what a host agent takes and a person's own
  // agent does not.
  const ka = await as(host, users, 'ka');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });

  // Before the removal: `cy` starts on its own, and `ka` does not.
  expect(await ownerAgain.call('createSession', { channel: 'ahp-session:/before', provider: 'mine' }))
    .toHaveProperty('result');
  expect(await ka.call('createSession', { channel: 'ahp-session:/elsewhere', provider: 'mine' }))
    .toEqual({ code: -32002, message: 'No agent provider registered for: mine' });

  armed = true;
  expect(await cy.call('x-ahpd/agents/remove', { id: 'mine' })).toMatchObject({ result: {} });
  // During the removal: refused to the owner, because the agent is going out,
  // and to `ka`, who would otherwise take an unowned id for a host agent.
  expect(during).toEqual({
    owner: { code: -32002, message: 'No agent provider registered for: mine' },
    other: { code: -32002, message: 'No agent provider registered for: mine' },
  });
  await close();
});

it('turns an agent off: the row is disabled and the fold no longer gets it', async () => {
  const folded: string[][] = [];
  const { host, users, opened, close } = await served({
    fold: async (agents) => { folded.push(agents.map((one) => one.provider)); },
  });
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  expect(folded.at(-1)).toContain('mine');

  const answer = await cy.call('x-ahpd/agents/disable', { id: 'mine' }) as Bag;
  expect(answer['result']).toMatchObject({ id: 'mine', mode: 'disabled', state: 'disabled' });
  expect(answer['result']).not.toHaveProperty('alerts');
  expect(folded.at(-1)).not.toContain('mine');
  expect(await cy.agents()).not.toContain('mine');
  expect((await cy.rows())['mine']).toMatchObject({ state: 'disabled', mode: 'disabled' });
  // A record that is off is not built, so nothing is asked of its engine.
  expect(opened).toHaveLength(1);
  await close();
});

it('pauses an agent: it stays open, its row is paused and its alerts show', async () => {
  const folded: string[][] = [];
  const { host, users, opened, close } = await served({
    fold: async (agents) => { folded.push(agents.map((one) => one.provider)); },
  });
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  expect(opened).toHaveLength(1);

  const answer = await cy.call('x-ahpd/agents/pause', { id: 'mine' }) as Bag;
  expect(answer['result']).toMatchObject({ id: 'mine', mode: 'paused', state: 'paused' });
  // A paused record is opened, so it is folded and nothing is rebuilt for it.
  expect(folded.at(-1)).toContain('mine');
  expect(opened).toHaveLength(1);
  expect(await cy.agents()).toContain('mine');
  expect((await cy.rows())['mine']).toMatchObject({ state: 'paused', mode: 'paused' });
  await close();
});

it('keeps the alerts of a paused record', async () => {
  const { host, users, collection, lists, close } = await served();
  delete process.env['AHPD_TEST_PAUSED_KEY'];
  await collection.put({
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', mode: 'paused',
    config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_PAUSED_KEY' } },
  });
  await lists.openAll();

  const fa = await as(host, users, 'fa');
  const row = (await fa.rows())['theirs'];
  // A paused record is read as one that is on, so its missing key raises an
  // alert, and the row still says it is paused.
  expect(row).toMatchObject({ state: 'paused', mode: 'paused' });
  expect(row?.['alerts']).toMatchObject([{ level: 'error', ref: 'env:AHPD_TEST_PAUSED_KEY' }]);
  await close();
});

it('lists on an agent record only the operations its mode offers now', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });

  expect((await cy.rows())['mine']?.['operations']).toEqual(['pause', 'disable', 'check', 'remove']);

  await cy.call('x-ahpd/agents/pause', { id: 'mine' });
  const paused = (await cy.rows())['mine'];
  expect(paused?.['operations']).toEqual(['enable', 'disable', 'remove']);
  expect(paused?.['operations']).not.toContain('pause');

  await cy.call('x-ahpd/agents/disable', { id: 'mine' });
  expect((await cy.rows())['mine']?.['operations']).toEqual(['enable', 'remove']);
  await close();
});

it('pauses an agent through x-ahpd/invokeOperation, as the fixed command does', async () => {
  const { host, users, collection, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });

  const answer = await cy.call('x-ahpd/invokeOperation', {
    channel: URI, operationId: 'pause', target: { id: 'mine' },
  }) as Bag;
  expect(answer['result']).toMatchObject({ id: 'mine', mode: 'paused', state: 'paused' });
  expect((await collection.get('mine'))?.['mode']).toBe('paused');

  // It is paused now, so the record does not offer Pause again.
  expect(await cy.call('x-ahpd/invokeOperation', { channel: URI, operationId: 'pause', target: { id: 'mine' } }))
    .toMatchObject({ code: -32602, message: 'pause is not offered on mine now' });
  await close();
});

it('moves a record to paused from enabled or off, and out again', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });

  expect(await cy.call('x-ahpd/agents/pause', { id: 'mine' })).toMatchObject({
    result: { mode: 'paused', state: 'paused' },
  });
  expect(await cy.call('x-ahpd/agents/disable', { id: 'mine' })).toMatchObject({
    result: { mode: 'disabled', state: 'disabled' },
  });
  expect(await cy.call('x-ahpd/agents/pause', { id: 'mine' })).toMatchObject({
    result: { mode: 'paused', state: 'paused' },
  });
  expect(await cy.call('x-ahpd/agents/enable', { id: 'mine' })).toMatchObject({
    result: { mode: 'enabled', state: 'ready' },
  });
  await close();
});

it('keeps the sessions of an agent turned off or paused', async () => {
  const { host, users, ended, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  await cy.call('createSession', { channel: 'ahp-session:/on-mine', provider: 'mine' });

  expect(await cy.call('x-ahpd/agents/disable', { id: 'mine' })).toMatchObject({ result: { state: 'disabled' } });
  expect(ended).not.toContain('mine');
  expect(await cy.call('x-ahpd/agents/pause', { id: 'mine' })).toMatchObject({ result: { state: 'paused' } });
  expect(ended).not.toContain('mine');
  await close();
});

it('raises no alert for a disabled record whose environment variable is missing', async () => {
  const { host, users, collection, lists, opened, close } = await served();
  delete process.env['AHPD_TEST_OFF_KEY'];
  await collection.put({
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', mode: 'disabled',
    config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_OFF_KEY' } },
  });
  await lists.openAll();

  const fa = await as(host, users, 'fa');
  const row = (await fa.rows())['theirs'];
  expect(row).toMatchObject({ state: 'disabled' });
  expect(row).not.toHaveProperty('alerts');
  // Nothing was opened, so no key was read.
  expect(opened).toHaveLength(0);
  expect(await fa.call('x-ahpd/agents/check', { id: 'theirs' }))
    .toMatchObject({ code: -32602, message: 'theirs is turned off.' });
  await close();
});

it('turns an agent on again and opens it', async () => {
  const { host, users, opened, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  await cy.call('x-ahpd/agents/disable', { id: 'mine' });

  const answer = await cy.call('x-ahpd/agents/enable', { id: 'mine' }) as Bag;
  expect(answer['result']).toMatchObject({ id: 'mine', mode: 'enabled', state: 'ready' });
  expect(opened).toHaveLength(2);
  expect(await cy.agents()).toContain('mine');
  await close();
});

it('keeps an agent off when its record is put again', async () => {
  const { host, users, collection, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  await cy.call('x-ahpd/agents/disable', { id: 'mine' });

  const answer = await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine, renamed', config: { target: 'b' },
  }) as Bag;
  expect(answer['result']).toMatchObject({ id: 'mine', name: 'Mine, renamed', mode: 'disabled', state: 'disabled' });
  expect((await collection.get('mine'))?.mode).toBe('disabled');
  expect(await cy.agents()).not.toContain('mine');

  // An edit is not a toggle.
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', mode: 'enabled', config: { target: 'b' },
  })).toMatchObject({
    code: -32602,
    message: 'x-ahpd/agents/put does not take mode; use x-ahpd/agents/enable, x-ahpd/agents/pause or x-ahpd/agents/disable',
  });
  await close();
});

it('refuses a toggle to a caller without agent:put and to one who is not the owner', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const ana = await as(host, users, 'ana');
  const gi = await as(host, users, 'gi');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });

  expect(await ana.call('x-ahpd/agents/disable', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await gi.call('x-ahpd/agents/disable', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await ana.call('x-ahpd/agents/pause', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await gi.call('x-ahpd/agents/pause', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await cy.call('x-ahpd/agents/disable', { id: 'mine' })).toMatchObject({ result: { state: 'disabled' } });

  expect(await ana.call('x-ahpd/agents/enable', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await gi.call('x-ahpd/agents/enable', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await gi.call('x-ahpd/agents/pause', { id: 'mine' })).toMatchObject({ code: -32009 });
  expect(await cy.call('x-ahpd/agents/enable', { id: 'mine' })).toMatchObject({ result: { state: 'ready' } });
  await close();
});

it('raises a probe alert when the probe throws, and clears it when one answers', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'prober', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  const answered = await cy.call('x-ahpd/agents/check', { id: 'mine' }) as Bag;
  expect(answered['result']).toMatchObject({ id: 'mine', state: 'ready' });
  expect(answered['result']).not.toHaveProperty('alerts');
  expect(answered['result']).not.toHaveProperty('health');

  await cy.call('x-ahpd/agents/put', {
    id: 'broken', engine: 'prober', owner: 'user:cy', name: 'Broken', config: { target: 'broken' },
  });
  expect(await cy.call('x-ahpd/agents/check', { id: 'broken' })).toMatchObject({
    result: {
      id: 'broken',
      alerts: [{ level: 'warning', ref: 'probe', text: 'no answer from the target', at: expect.any(String) }],
    },
  });

  // A record the probe answers asks for the alert to be cleared.
  await cy.call('x-ahpd/agents/put', {
    id: 'broken', engine: 'prober', owner: 'user:cy', name: 'Broken', config: { target: 'a' },
  });
  expect(await cy.call('x-ahpd/agents/check', { id: 'broken' })).toMatchObject({ result: { id: 'broken' } });
  expect((await cy.rows())['broken']).not.toHaveProperty('alerts');
  // And a record of an engine nobody serves says so, rather than answering `ok`.
  expect(await cy.call('x-ahpd/agents/check', { id: 'gone' })).toMatchObject({ code: -32602 });
  await close();
});

it('shows a probe alert beside a gap of the same record', async () => {
  const { host, users, collection, lists, close } = await served();
  process.env['AHPD_TEST_AGENT_COMBO'] = 'sk-combo';
  try {
    await collection.put({
      id: 'theirs',
      engine: 'prober',
      owner: 'host',
      name: 'Theirs',
      config: { target: 'broken', env: { KEY: { fromEnv: 'AHPD_TEST_AGENT_COMBO' } } },
    });
    await lists.openAll();
    const fa = await as(host, users, 'fa');
    expect(await fa.call('x-ahpd/agents/check', { id: 'theirs' })).toMatchObject({
      result: { alerts: [{ level: 'warning', ref: 'probe' }] },
    });
    // A variable that goes away leaves the probe's alert in place, and a check
    // that cannot build the record again adds the gap beside it.
    delete process.env['AHPD_TEST_AGENT_COMBO'];
    expect(await fa.call('x-ahpd/agents/check', { id: 'theirs' })).toMatchObject({
      result: {
        state: 'failed',
        alerts: [
          { level: 'warning', ref: 'probe' },
          { level: 'error', ref: 'env:AHPD_TEST_AGENT_COMBO' },
        ],
      },
    });
  } finally {
    delete process.env['AHPD_TEST_AGENT_COMBO'];
  }
  await close();
});

it('answers a row with the config the engine describes, and refuses one it does not', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a', extra: 'x' },
  })).toMatchObject({ code: -32602, message: 'agent mine.extra is not a field' });
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: {},
  })).toMatchObject({ code: -32602, message: 'agent mine.target is required' });
  await close();
});

it('lets agent:all read every agent and remove one however it is owned', async () => {
  const { host, users, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');
  const fa = await as(host, users, 'fa');

  // Holds `agent:all` alone: no `agent:list`, and an empty store still opens.
  const ja = await as(host, users, 'ja');
  expect(await ja.rows()).toEqual({});

  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  await di.call('x-ahpd/agents/put', {
    id: 'ours', engine: 'checker', owner: 'team:backend', name: 'Ours', config: { target: 'a' },
  });
  await fa.call('x-ahpd/agents/put', {
    id: 'theirs', engine: 'checker', owner: 'host', name: 'Theirs', config: { target: 'a' },
  });

  // Every row, the other person's and another team's included.
  expect(Object.keys(await ja.rows()).sort()).toEqual(['mine', 'ours', 'theirs']);
  // And the remove of another person's agent is allowed, which `agent:remove`
  // alone would have refused.
  expect(await ja.call('x-ahpd/agents/remove', { id: 'mine' })).toMatchObject({ result: {} });
  expect(Object.keys(await cy.rows())).toEqual(['theirs']);
  await close();
});

it('lists each missing variable on the row, and clears them once the record opens', async () => {
  const { host, users, collection, lists, close } = await served();
  await collection.put({
    id: 'theirs',
    engine: 'checker',
    owner: 'host',
    name: 'Theirs',
    config: { target: 'a', secret: { fromEnv: 'AHPD_TEST_AGENT_KEY' }, env: { KEY: { fromEnv: 'AHPD_TEST_AGENT_OTHER' } } },
  });
  expect(process.env['AHPD_TEST_AGENT_KEY']).toBeUndefined();
  expect(process.env['AHPD_TEST_AGENT_OTHER']).toBeUndefined();
  await lists.openAll();
  const fa = await as(host, users, 'fa');
  const failed = (await fa.rows())['theirs'];
  expect(failed).toMatchObject({
    state: 'failed',
    alerts: [
      { level: 'error', ref: 'env:AHPD_TEST_AGENT_KEY', text: 'the environment holds no AHPD_TEST_AGENT_KEY' },
      { level: 'error', ref: 'env:AHPD_TEST_AGENT_OTHER', text: 'the environment holds no AHPD_TEST_AGENT_OTHER' },
    ],
  });
  expect(failed).not.toHaveProperty('health');

  process.env['AHPD_TEST_AGENT_KEY'] = 'sk-from-env';
  try {
    // A gap that is fixed leaves the row, and the one still missing stays.
    await lists.openAll();
    expect((await fa.rows())['theirs']).toMatchObject({
      state: 'failed',
      alerts: [{ level: 'error', ref: 'env:AHPD_TEST_AGENT_OTHER' }],
    });
    expect(((await fa.rows())['theirs'] as { alerts: unknown[] }).alerts).toHaveLength(1);
    process.env['AHPD_TEST_AGENT_OTHER'] = 'sk-other';
    await lists.openAll();
    const row = (await fa.rows())['theirs'];
    expect(row).toMatchObject({ state: 'ready' });
    expect(row).not.toHaveProperty('alerts');
  } finally {
    delete process.env['AHPD_TEST_AGENT_KEY'];
    delete process.env['AHPD_TEST_AGENT_OTHER'];
  }
  // A check that cannot build the record again raises the same gaps.
  expect(await fa.call('x-ahpd/agents/check', { id: 'theirs' })).toMatchObject({
    result: { state: 'failed', alerts: [{ ref: 'env:AHPD_TEST_AGENT_KEY' }, { ref: 'env:AHPD_TEST_AGENT_OTHER' }] },
  });
  await close();
});

it('reads a config that does not fit its engine as invalid, with no alert', async () => {
  const { host, users, collection, lists, close } = await served();
  await collection.put({ id: 'odd', engine: 'checker', owner: 'host', name: 'Odd', config: { target: 'a', extra: 'x' } });
  await lists.openAll();
  const fa = await as(host, users, 'fa');
  const row = (await fa.rows())['odd'];
  expect(row).toMatchObject({ state: 'invalid' });
  expect(row).not.toHaveProperty('alerts');
  expect(row).not.toHaveProperty('health');
  await close();
});

it('refuses an agent whose backend serves another id, and does not serve it', async () => {
  const { host, users, collection, lists, problems, close } = await served();
  const cy = await as(host, users, 'cy');

  // A put says why, and nothing is written: the id is still free.
  const answer = await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'misnamed', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  expect(answer).toMatchObject({ code: -32603, message: expect.stringContaining('not-the-id') });
  expect(await collection.get('mine')).toBeUndefined();
  expect(problems.some((line) => line.includes('mine') && line.includes('not-the-id'))).toBe(true);

  // A record written by hand is said and left out of the list, and its row says why.
  await collection.put({ id: 'odd', engine: 'misnamed', owner: 'user:cy', name: 'Odd', config: { target: 'a' } });
  await lists.openAll();
  expect(problems.some((line) => line.includes('odd') && line.includes('not-the-id'))).toBe(true);
  expect(await cy.agents()).not.toContain('odd');
  expect((await cy.rows())['odd']).toMatchObject({
    state: 'failed',
    alerts: [{ level: 'error', ref: 'open', text: expect.stringContaining('not-the-id'), at: expect.any(String) }],
  });
  await close();
});

it('opens a record again when the plugin that registered its engine is reloaded', async () => {
  const { host, users, lists, engines, opened, ended, handles, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  });
  expect(opened.filter((one) => one.engine === 'checker')).toHaveLength(1);

  // A reload imports the module again: the same name, a new engine object.
  engines['checker'] = { ...engineOf('checker', opened, false, handles), by: 'test' };
  await lists.openAll();
  expect(opened.filter((one) => one.engine === 'checker')).toHaveLength(2);
  // The backend the old module built goes, and its sessions with it.
  expect(ended).toContain('mine');
  expect((await cy.rows())['mine']).toMatchObject({ state: 'ready' });
  await close();
});

it('refuses an id the daemon or a plugin already serves, before writing the record', async () => {
  const { host, users, collection, close } = await served();
  const cy = await as(host, users, 'cy');
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'base', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  })).toMatchObject({ code: -32009, message: 'base is served by the daemon, and an agent id is unique' });
  expect(await cy.call('x-ahpd/agents/put', {
    id: 'preset', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
  })).toMatchObject({ code: -32009, message: 'preset is served by plugin agent-claude, and an agent id is unique' });
  expect(await collection.get('base')).toBeUndefined();
  expect(await collection.get('preset')).toBeUndefined();
  await close();
});

it('keeps an open record and its agent when its secret cannot be read', async () => {
  const { host, users, lists, opened, ended, problems, vault, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', {
    id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a', secret: 'sk-agent-1' },
  });
  const openedBefore = opened.length;

  const reading = vault.get;
  vault.get = async () => { throw new Error('the vault is unreachable'); };
  try {
    await lists.openAll();
  } finally {
    vault.get = reading;
  }

  expect(problems.some((line) => line.includes('mine') && line.includes('the vault is unreachable'))).toBe(true);
  // A vault hiccup is not the record going: the backend and its sessions stay.
  expect(ended).not.toContain('mine');
  expect(opened).toHaveLength(openedBefore);
  expect(await cy.agents()).toContain('mine');
  expect((await cy.rows())['mine']).toMatchObject({ state: 'ready' });
  await close();
});

it('runs the commands one at a time, so two owners cannot both take an id', async () => {
  const { host, users, collection, close } = await served();
  const cy = await as(host, users, 'cy');
  const di = await as(host, users, 'di');

  const answers = await Promise.all([
    cy.call('x-ahpd/agents/put', {
      id: 'shared', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' },
    }),
    di.call('x-ahpd/agents/put', {
      id: 'shared', engine: 'checker', owner: 'team:backend', name: 'Ours', config: { target: 'a' },
    }),
  ]);

  // One put made the record, and the other arrived to find it taken.
  expect(answers.filter((one) => 'result' in one)).toHaveLength(1);
  expect(answers.filter((one) => 'code' in one && one.code === -32009)).toHaveLength(1);
  // The record the last answer left is the one owner's, not both.
  expect(['user:cy', 'team:backend']).toContain((await collection.get('shared'))?.owner);
  await close();
});

/** A view with one bound Text, and the data it starts from. */
const viewOf = (dataModel: Record<string, unknown>): PluginView => ({
  root: 'plan',
  components: { plan: { id: 'plan', component: 'Text', text: { path: '/plan' } } },
  dataModel,
});

it('puts a view on the agent row, and sends the change to a subscriber', async () => {
  const { host, users, handles, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', { id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' } });
  // The caller reads its own agent, and its subscription is what the change reaches.
  await cy.rows();

  expect((await cy.rows())['mine']).not.toHaveProperty('views');
  handles.get('mine')!.showView(viewOf({ plan: 'max' }));
  await until(() => cy.actions('x-ahpd-agents/changed').length > 0);

  expect((await cy.rows())['mine']?.['views']).toEqual({ main: viewOf({ plan: 'max' }) });
  // A subscriber is sent the changed row, not only the next snapshot.
  expect(cy.actions('x-ahpd-agents/changed').at(-1)).toMatchObject({ id: 'mine', record: { views: { main: viewOf({ plan: 'max' }) } } });
  await close();
});

it('replaces the view on a second show, and clear takes it away', async () => {
  const { host, users, handles, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', { id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' } });
  const handle = handles.get('mine')!;

  handle.showView(viewOf({ plan: 'max' }));
  handle.showView(viewOf({ plan: 'pro' }));
  expect((await cy.rows())['mine']?.['views']).toEqual({ main: viewOf({ plan: 'pro' }) });

  handle.clearView();
  expect((await cy.rows())['mine']).not.toHaveProperty('views');
  await close();
});

it('takes the view away when the engine unloads, and ignores the old handle', async () => {
  const { host, users, lists, engines, handles, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', { id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' } });
  const handle = handles.get('mine')!;
  handle.showView(viewOf({ plan: 'max' }));
  expect((await cy.rows())['mine']).toHaveProperty('views');

  delete engines['checker'];
  await lists.openAll();
  expect((await cy.rows())['mine']).not.toHaveProperty('views');

  handle.showView(viewOf({ plan: 'pro' }));
  expect((await cy.rows())['mine']).not.toHaveProperty('views');
  await close();
});

it('takes the view away when the agent is removed, and ignores the old handle', async () => {
  const { host, users, handles, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', { id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' } });
  const handle = handles.get('mine')!;
  handle.showView(viewOf({ plan: 'max' }));

  expect(await cy.call('x-ahpd/agents/remove', { id: 'mine' })).toEqual({ result: {} });
  expect(await cy.rows()).not.toHaveProperty('mine');
  handle.showView(viewOf({ plan: 'pro' }));
  expect(await cy.rows()).not.toHaveProperty('mine');
  await close();
});

it('refuses a bad view, or one on a surface no capability names, and the row keeps what it held', async () => {
  const { host, users, handles, problems, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', { id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' } });
  const handle = handles.get('mine')!;
  handle.showView(viewOf({ plan: 'max' }));

  handle.showView(viewOf({ over: 'x'.repeat(64 * 1024) }));
  handle.showView(viewOf({ plan: 'pro' }), 'side' as never);

  expect((await cy.rows())['mine']?.['views']).toEqual({ main: viewOf({ plan: 'max' }) });
  expect(problems).toEqual([
    'x-ahpd-agents: mine\'s view was not kept: plugin test: showView needs the view to be at most 65536 bytes of JSON',
    'x-ahpd-agents: mine: showView on side, a surface no view capability of checker names',
  ]);
  await close();
});

it('sends one value of the view data to the agent\'s readers, and the row holds it', async () => {
  const { host, users, handles, close } = await served();
  const cy = await as(host, users, 'cy');
  await cy.call('x-ahpd/agents/put', { id: 'mine', engine: 'checker', owner: 'user:cy', name: 'Mine', config: { target: 'a' } });
  await cy.rows();
  const handle = handles.get('mine')!;
  handle.showView(viewOf({ plan: 'max' }));
  await until(() => cy.actions('x-ahpd-agents/changed').length > 0);
  const changes = cy.actions('x-ahpd-agents/changed').length;

  handle.setViewData('/plan', 'pro');
  await until(() => cy.actions('x-ahpd-agents/viewData').length > 0);

  expect(cy.actions('x-ahpd-agents/viewData')).toEqual([
    { type: 'x-ahpd-agents/viewData', id: 'mine', surface: 'main', path: '/plan', value: 'pro' },
  ]);
  expect(cy.actions('x-ahpd-agents/changed')).toHaveLength(changes);
  expect((await cy.rows())['mine']?.['views']).toEqual({ main: viewOf({ plan: 'pro' }) });
  await close();
});

/*
 * The list sends its operations beside the records, as the tunnel list does,
 * so a client draws each row's buttons with the host's words, in the locale
 * the client sent.
 */
it('lists its operations in the locale the client sent, and in English for one that sent none', async () => {
  const { host, users, close } = await served();
  const operationsOf = async (one: Awaited<ReturnType<typeof as>>): Promise<Record<string, Bag>> => {
    const answer = await one.call('subscribe', { channel: URI }) as Bag;
    const listed = ((answer['result'] as Bag)['snapshot'].state as Bag)['operations'] as Bag[];
    return Object.fromEntries(listed.map((op) => [String(op['id']), op]));
  };

  // One client id has one locale, so the English client comes after the Portuguese one is read.
  const inPt = await operationsOf(await as(host, users, 'cy', 'pt-BR'));
  expect(Object.keys(inPt)).toEqual(['enable', 'pause', 'disable', 'check', 'remove']);
  expect(inPt['disable']).toMatchObject({ label: 'Desativar', description: 'Desativa o agente. Ninguém o usa até ele ser ativado de novo.' });
  expect(inPt['remove']).toMatchObject({ label: 'Remover', confirmation: 'Remover este agente? As sessões dele terminam e ele é excluído.' });
  const inEn = await operationsOf(await as(host, users, 'cy'));
  expect(inEn['disable']).toMatchObject({ label: 'Disable', description: 'Turns the agent off. Nobody can use it until it is on again.' });
  await close();
});


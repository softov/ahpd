import { expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT as DEPLOYMENT } from '../../server/src/commands/authorize.js';
import { memoryAutomations } from '../src/automations.js';
import { frozenCopy } from '../src/frozen.js';
import { createHost, ROOT, refusalReason } from '../src/host.js';
import { foldHostOptions, pluginHost, raise } from '../src/plugins.js';
import { fileResources } from '../src/resources.js';
import { memorySessions } from '../src/sessions.js';
import { fileUsers } from '../src/users.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import { hello, settle } from './support/host.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostHandlers } from '../src/types/events.js';
import type { HostOptions, HostTool } from '../src/types/host.js';
import type { PluginContext, TriggerTypeDefinition } from '../src/types/plugin.js';
import type { Request, Peer } from '../src/types/rpc.js';
import type { ResourceProvider } from '../src/types/resources.js';
import type { Principal, Users } from '../src/types/users.js';

/*
 * What a value may not do once it has crossed the plugin boundary.
 *
 * A plugin is trusted code - it may import `fs` and patch a module - so this is
 * not a sandbox. It is the narrower promise the host can keep: every value that
 * crosses is a frozen copy, so a plugin that writes to one is refused where it
 * stands rather than changing what the host reads next. Each case below tries
 * one write and checks both halves - that it throws, and that the host is
 * exactly as it was. Decision `a-plugin-gets-frozen-copies-of-host-values`.
 */

const DIR = '/tmp/ahpd-plugin-boundary';

const RECORD = {
  resource: 'ahpd://users',
  resource_name: 'ahpd users',
  authorization_servers: ['https://example.test/users'],
  required: false,
};

/** A person who may read a `bot:`, so the provider behind the scheme is reached. */
const ana: Principal = { id: 'ana', roles: [], can: () => true };

/** The same person without that grant, which is what the gate is asked about below. */
const held: Principal = { id: 'ana', roles: [], can: (grant) => grant !== 'bot:get' };

const directory = (): Users => ({
  resource: RECORD,
  verify: async (token) => (token === 'held' ? held : ana),
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
  mint: async () => 'nonsense',
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/**
 * One value as a bag, so a case can write to what its contract forbids.
 *
 * The values below are typed - a `PluginHost`, an `Agent`, an `McpServer` - and
 * none of those types has an index signature, which is the compiler saying what
 * the contract says: this is not a thing you write to. Every write here is the
 * hostile one being refused, so the cast is the reaching past the type rather
 * than a claim about the value.
 */
const bag = (one: unknown): Bag => one as Bag;

/** A host serving `bot:` from `provider`, with a directory and a session store. */
async function served(provider: ResourceProvider, who: Principal = ana) {
  const sessions = memorySessions();
  const host = createHost({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    resources: fileResources(),
    resourceProviders: { bot: provider },
    users: directory(),
    sessions,
  });
  const client = host.accept(peer(), who);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  return { host, client, sessions };
}

/**
 * A provider that records the principal it was handed and then tries to change
 * it.
 *
 * The attempt is the write every case below is about, and it throws where the
 * provider stands - so the command it was serving fails, which is the refusal
 * the host keeps.
 */
function rewriting(attempt: (who: Principal) => void): { provider: ResourceProvider; seen: Principal[] } {
  const seen: Principal[] = [];
  const grab = (who: Principal | undefined): void => {
    if (who === undefined) throw new Error('the host handed this provider no principal');
    seen.push(who);
    attempt(who);
  };
  return {
    seen,
    provider: {
      authorize: async () => false,
      read: async (_uri, _wanted, reader) => { grab(reader); return { data: 'held', encoding: 'utf-8' }; },
      write: async (_uri, _content, _owner, reader) => { grab(reader); },
      remove: async (_uri, _recursive, _owner, reader) => { grab(reader); },
    },
  };
}

const read = (client: { handle: (request: { method: string; params: Record<string, unknown> }) => Promise<unknown> }) =>
  client.handle({ method: 'resourceRead', params: { channel: ROOT, uri: 'bot://one' } });

it('copies plain data, freezes the copy, and leaves the source alone', () => {
  const source = { one: { two: [1, 2] } };
  const copy = frozenCopy(source);

  expect(copy).toEqual(source);
  expect(copy).not.toBe(source);
  expect(copy.one).not.toBe(source.one);
  expect(copy.one.two).not.toBe(source.one.two);
  expect(Object.isFrozen(copy)).toBe(true);
  expect(Object.isFrozen(copy.one)).toBe(true);
  expect(Object.isFrozen(copy.one.two)).toBe(true);
  // The source is the caller's own and is not touched by the copy.
  expect(Object.isFrozen(source)).toBe(false);
  source.one.two.push(3);
  expect(source.one.two).toEqual([1, 2, 3]);
  expect(copy.one.two).toEqual([1, 2]);

  expect(() => { (copy.one as { three?: number }).three = 3; }).toThrow(TypeError);
  expect(() => { copy.one.two.push(4); }).toThrow(TypeError);
});

it('refuses a provider whose read rewrites the reader it was handed', async () => {
  const { provider, seen } = rewriting((who) => { (who as { id: string }).id = 'bob'; });
  const { client } = await served(provider);

  await expect(read(client)).rejects.toThrow(TypeError);
  // The write threw where it was made, so what the host holds is still the
  // person who signed in - and the person is unchanged, not merely unwritten.
  expect(seen[0]?.id).toBe('ana');
  expect(Object.isFrozen(seen[0])).toBe(true);
});

it('refuses a provider whose write rewrites the writer it was handed', async () => {
  const { provider, seen } = rewriting((who) => { (who as { id: string }).id = 'bob'; });
  const { client } = await served(provider);

  await expect(client.handle({
    method: 'resourceWrite',
    params: { channel: ROOT, uri: 'bot://one', data: 'x', encoding: 'utf-8' },
  })).rejects.toThrow(TypeError);
  expect(seen[0]?.id).toBe('ana');
});

it('refuses a provider whose remove rewrites the writer it was handed', async () => {
  const { provider, seen } = rewriting((who) => { (who as { id: string }).id = 'bob'; });
  const { client } = await served(provider);

  await expect(client.handle({
    method: 'resourceDelete', params: { channel: ROOT, uri: 'bot://one' },
  })).rejects.toThrow(TypeError);
  expect(seen[0]?.id).toBe('ana');
});

it('refuses a provider that redefines a property of the reader', async () => {
  const { provider } = rewriting((who) => {
    Object.defineProperty(who, 'memberships', { value: ['backend'], configurable: true });
  });
  const { client } = await served(provider);

  await expect(read(client)).rejects.toThrow(TypeError);
});

it('refuses a provider whose authorize rewrites the person it was handed', async () => {
  let asked = 0;
  const provider: ResourceProvider = {
    authorize: async (_uri, who) => {
      asked += 1;
      // Only the first ask widens; the second answers, so the command reaches
      // the gate and is refused there rather than failing in the provider.
      if (asked === 1) {
        (who as unknown as { can: unknown }).can = () => true;
        return true;
      }
      return false;
    },
    read: async () => ({ data: 'held', encoding: 'utf-8' }),
  };
  const { client } = await served(provider, held);

  await expect(read(client)).rejects.toThrow(TypeError);
  // And the same command is refused exactly as it would have been: `can` did
  // not move, so `bot:get` is still a grant this person does not hold.
  await expect(read(client)).rejects.toMatchObject({
    code: -32009,
    message: refusalReason('ana', 'bot:get'),
  });
  expect(asked).toBe(2);
});

it('keeps a session owned by the reader a provider tried to rename', async () => {
  const { provider } = rewriting((who) => { (who as { id: string }).id = 'bob'; });
  const { client, sessions } = await served(provider);

  await expect(read(client)).rejects.toThrow(TypeError);
  await client.handle({ method: 'createSession', params: { channel: 'echo:/live', provider: 'echo' } });
  expect(sessions.owner('live')).toBe('user:ana');
});

it('freezes the deployment principal and its roles', () => {
  expect(Object.isFrozen(DEPLOYMENT)).toBe(true);
  expect(Object.isFrozen(DEPLOYMENT.roles)).toBe(true);
  expect(() => { (DEPLOYMENT as unknown as { can: unknown }).can = () => false; }).toThrow(TypeError);
  expect(() => { (DEPLOYMENT.roles as string[]).push('admin'); }).toThrow(TypeError);
  expect(DEPLOYMENT.can('anything:at:all')).toBe(true);
});

it('freezes the roles a person signed in with, which no provider may add to', async () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-boundary-'));
  try {
    const people = fileUsers({ path: join(root, 'users.json') });
    await people.add('ana', ['admin']);
    const who = await people.verify(await people.mint('ana'));
    if (who === undefined) throw new Error('the directory handed this case no principal');

    // The roles are the grants the gate reads, so they are frozen where the
    // principal is built and not only the record around them.
    expect(Object.isFrozen(who)).toBe(true);
    expect(Object.isFrozen(who.roles)).toBe(true);
    expect(() => { (who.roles as string[]).push('guest'); }).toThrow(TypeError);
    expect(who.roles).toEqual(['admin']);

    // And the same write from a provider, at the boundary: the reader it was
    // handed is the person who signed in, with the roles the file gave them.
    const { provider, seen } = rewriting((one) => { (one.roles as string[]).push('guest'); });
    const { client } = await served(provider, who);
    await expect(read(client)).rejects.toThrow(TypeError);
    expect(seen[0]?.roles).toEqual(['admin']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

it('freezes the principal an embedder hands its host, roles and all', async () => {
  const mine: Principal = { id: 'ana', roles: ['member'], can: () => true };
  const { provider, seen } = rewriting((one) => { (one.roles as string[]).push('admin'); });
  const { client } = await served(provider, mine);

  // An embedder's own literal is the host's from the moment a connection
  // holds it, and a principal frozen one level deep leaves the roles free.
  expect(Object.isFrozen(mine)).toBe(true);
  expect(Object.isFrozen(mine.roles)).toBe(true);
  expect(() => { (mine.roles as string[]).push('admin'); }).toThrow(TypeError);

  await expect(read(client)).rejects.toThrow(TypeError);
  expect(seen[0]?.roles).toEqual(['member']);
});

/*
 * ---------------------------------------------------------------------------
 * What an agent's start holds, and what a host tool's call holds.
 * ---------------------------------------------------------------------------
 *
 * The backend half of the same promise: every value in a `Start`, and the
 * turns a host tool is handed, is the host's own copy. Each case starts a
 * session with a backend that tries one write and then checks the next session
 * - or the client - still sees what the host holds.
 */

/** This checkout, as an absolute path, for the file read below. */
const REPO = fileURLToPath(new URL('../../..', import.meta.url)).replace(/\/$/, '');

/** One connected client, as much of it as these cases use. */
type Client = { handle: (request: Request) => Promise<unknown> };

/** A tool of the host's own, so a backend is handed a definition to rename. */
const NOTES: HostTool = {
  definition: {
    name: 'notes',
    description: 'Write a note down',
    inputSchema: { type: 'object', properties: {} },
  },
  run: () => 'noted',
};

/** A tool that reads the conversation and then tries to change it. */
const ROBBING: HostTool = {
  definition: {
    name: 'rob',
    description: 'Reads the conversation, then changes it',
    inputSchema: { type: 'object', properties: {} },
  },
  run: async (_input, at) => {
    const found = await at.context(at.session);
    const turn = found?.turns[0] as Bag | undefined;
    if (turn === undefined) throw new Error('the host handed this tool no turns');
    turn.mine = true;
    return 'changed one';
  },
};

/**
 * The echo backend, behind an agent that tries one write on its `Start`.
 *
 * The attempt runs where a backend's own would - inside `create`, with the
 * `Start` the host built - so what it writes to is the object the host would
 * otherwise be reading again.
 */
function probing(attempt: (start: Start) => void): Agent {
  const inner = echo({ path: DIR, pace: 0 });
  return {
    ...inner,
    provider: 'probe',
    displayName: 'Probe',
    description: 'Echo, after trying a write on what the host handed it',
    create: (start) => { attempt(start); return inner.create(start); },
  };
}

/** A host with the probe backend, a tool and an MCP server of its own. */
async function began(agent: Agent, over: Partial<HostOptions> = {}) {
  const sessions = memorySessions();
  const host = createHost({
    path: DIR,
    agents: [agent],
    resources: fileResources(),
    tools: [NOTES],
    mcpServers: { ours: { type: 'http', url: 'https://mcp.example.test/one' } },
    sessionConfig: { notes: { type: 'string', title: 'Notes', default: 'none' } },
    users: directory(),
    sessions,
    ...over,
  });
  const client = host.accept(peer(), ana);
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  return { host, client, sessions };
}

/** Start one session of the probe backend. */
const started = (client: Client, uri: string) =>
  client.handle({ method: 'createSession', params: { channel: uri, provider: 'probe' } });

/**
 * How a refused write comes back from a start.
 *
 * A backend that throws while its session is being made is reported as
 * `-32602` and in its own words - the host's choice, so a client reads the
 * backend's sentence rather than an internal error. So what these cases check
 * is that the write was refused where it was made, and the engine's sentence
 * about a frozen value is the refusal.
 */
const refused = (what: string) => expect.objectContaining({
  code: -32602,
  message: expect.stringContaining(what),
});

/** Start one, and answer the chat it opened. */
const chatOf = async (client: Client, uri: string): Promise<string> => {
  await started(client, uri);
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  return opened.snapshot.state.defaultChat;
};

it('refuses an agent that writes a default into a session key the host contributed', async () => {
  let attempt: (start: Start) => void = () => {};
  const { client } = await began(probing((one) => attempt(one)));

  attempt = (one) => {
    const properties = one.schema().properties as Record<string, Bag>;
    (properties.notes as Bag).default = 'mine';
  };
  await expect(started(client, 'probe:/one')).rejects.toMatchObject(refused('read only property'));

  // The next session is drawn with the key the host holds, not the one this
  // backend wrote.
  let drawn: unknown;
  attempt = (one) => { drawn = ((one.schema().properties as Record<string, Bag>).notes as Bag).default; };
  await started(client, 'probe:/two');
  expect(drawn).toBe('none');
});

it('refuses an agent that renames a tool definition it was handed', async () => {
  let attempt: (start: Start) => void = () => {};
  const { client } = await began(probing((one) => attempt(one)));

  attempt = (one) => { bag(one.tools?.[0]?.definition).name = 'mine'; };
  await expect(started(client, 'probe:/one')).rejects.toMatchObject(refused('read only property'));

  // The tool the next session is offered is the host's, under its own name.
  attempt = () => {};
  await started(client, 'probe:/two');
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'probe:/two' } }) as {
    snapshot: { state: { serverTools?: { name: string; description?: string }[] } };
  };
  const notes = opened.snapshot.state.serverTools?.find((one) => one.name === 'notes');
  expect(notes?.description).toBe('Write a note down');
});

it('refuses an agent that rewrites an MCP server entry it was handed', async () => {
  let attempt: (start: Start) => void = () => {};
  const { client } = await began(probing((one) => attempt(one)));

  attempt = (one) => { bag(one.mcpServers?.ours).url = 'https://mine.test/'; };
  await expect(started(client, 'probe:/one')).rejects.toMatchObject(refused('read only property'));

  let drawn: unknown;
  attempt = (one) => { drawn = bag(one.mcpServers?.ours).url; };
  await started(client, 'probe:/two');
  expect(drawn).toBe('https://mcp.example.test/one');
});

it('refuses an agent that replaces a method on the store it was handed', async () => {
  let attempt: (start: Start) => void = () => {};
  const { client } = await began(probing((one) => attempt(one)));

  attempt = (one) => { bag(one.resources).read = () => { throw new Error('mine'); }; };
  await expect(started(client, 'probe:/one')).rejects.toMatchObject(refused('read only property'));

  // The store the resource commands are served from is the host's, and reads
  // exactly what it read before.
  const found = await client.handle({
    method: 'resourceRead',
    params: { channel: ROOT, uri: `file://${REPO}/LICENSE` },
  }) as { data: string; encoding: string };
  expect(found.encoding).toBe('utf-8');
  expect(found.data.length).toBeGreaterThan(0);
});

it('refuses a tool that writes to a turn it was handed', async () => {
  let handed: Start | undefined;
  const { client } = await began(probing((one) => { handed = one; }), { tools: [ROBBING] });

  const chat = await chatOf(client, 'probe:/live');
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await settle();

  const tool = handed?.tools?.find((one) => one.definition.name === 'rob');
  expect(tool).toBeDefined();
  await expect(tool?.run?.({})).rejects.toThrow(TypeError);

  // The turn the host holds is the one the client sent, unwritten.
  const opened = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns: Bag[] } };
  };
  expect(opened.snapshot.state.turns[0]?.message).toMatchObject({ text: 'hello' });
  expect(opened.snapshot.state.turns[0]).not.toHaveProperty('mine');
});

/*
 * ---------------------------------------------------------------------------
 * What a plugin registered, once the host has taken its copy.
 * ---------------------------------------------------------------------------
 *
 * The registration half of the same promise: the fold takes the host's own copy
 * of every agent, tool, schema and trigger type, and reads that rather than the
 * object the plugin still holds. So a plugin that reaches back into what it
 * registered changes nothing the host holds, and one that registers after
 * `apply` returned is refused where it stands.
 */

/** The context a loader builds for a plugin, as much of it as these cases need. */
const context = (): PluginContext => ({
  path: DIR,
  paths: [DIR],
  version: sdkVersion(),
  hostName: 'test',
  configDir: DIR,
  log: () => {},
  say: () => {},
});

/** The one type these cases register, and the automation watching for it. */
const WEATHER: TriggerTypeDefinition = {
  type: 'weather',
  title: 'The weather',
  description: 'What a forecast says.',
  events: [{ id: 'storm', title: 'A storm is coming', description: 'Heavy rain on the way.' }],
};

const AUTOMATION = 'ahp-automation:/batten';

const WATCHER: Bag = {
  title: 'Batten down',
  enabled: true,
  message: { text: 'Weather: {{event}}' },
  session: { provider: 'echo', workingDirectories: [`file://${DIR}`] },
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'weather',
    title: 'The weather',
    events: [{ id: 'storm' }],
    config: {},
  }],
};

/** The runs of that one automation, newest first, off its entry. */
const runs = (store: ReturnType<typeof memoryAutomations>): Bag[] =>
  ((store.get(AUTOMATION)?.runs ?? []) as Bag[]);

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, tries = 600): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened`);
};

it('refuses every registration a plugin makes after apply returned', () => {
  const { host, seal } = pluginHost('late', context());
  seal();

  // One sentence for every method, because the mistake is the same one: what a
  // plugin registers is read once, by the fold, and the fold has already been.
  const sentence = /nothing may be registered after apply returned/;
  expect(() => { host.registerTriggerType(WEATHER); }).toThrow(sentence);
  expect(() => { host.registerTool(NOTES); }).toThrow(sentence);
  expect(() => { host.registerAgent(echo({ path: DIR, pace: 0 })); }).toThrow(sentence);
  expect(() => { host.registerClose(() => {}); }).toThrow(sentence);
});

it('refuses a type another plugin already has, and a fire of it is refused too', async () => {
  const store = memoryAutomations();
  store.create(AUTOMATION, WATCHER);
  const first = pluginHost('first', context());
  first.host.registerTriggerType(WEATHER);
  first.seal();
  const second = pluginHost('second', context());
  second.host.registerTriggerType(WEATHER);
  second.seal();

  const { options, problems } = foldHostOptions(
    { path: DIR, agents: [echo({ path: DIR, pace: 0 })], automations: store },
    [first.contribution, second.contribution],
  );
  // The first registration keeps the name, and the plugin that lost it keeps
  // everything else it contributed.
  expect(problems).toEqual(['plugin second registers trigger type weather, which plugin first already registered']);

  const host = createHost(options);
  const client = host.accept(peer(), ana);
  await client.handle(hello(['0.9.0'], { clientId: 'probe', initialSubscriptions: [ROOT] }));

  // The plugin that lost the name holds nothing of it: the type it registered
  // is the host's to arbitrate, and the host gave it to the plugin that asked
  // first - so a fire of it is refused where the plugin stands rather than
  // dropped in silence, which is what the plugin's own door says about any
  // type it does not hold.
  expect(() => { second.host.fireTrigger('weather', 'storm', { where: 'the coast' }); })
    .toThrow('plugin second: fireTrigger needs weather to be a type this plugin registered');
  await new Promise((r) => { setTimeout(r, 20); });
  expect(runs(store)).toEqual([]);

  // And the plugin that holds the name still starts its run.
  first.host.fireTrigger('weather', 'storm', { where: 'the coast' });
  await until(() => runs(store).length === 1, 'the run the fire started');
});

it('keeps the tool name a plugin registered, not the one it writes later', () => {
  const { host, contribution } = pluginHost('tools', context());
  const mine: HostTool = {
    definition: { name: 'notes', description: 'Write a note down', inputSchema: { type: 'object', properties: {} } },
    run: () => 'noted',
  };
  host.registerTool(mine);

  const { options } = foldHostOptions({ path: DIR, agents: [] }, [contribution]);

  // The plugin reaches back into the definition it handed over.
  bag(mine.definition).name = 'mine';
  bag(mine.definition).description = 'Mine now';

  // What the host holds is its own copy of the definition as it was registered.
  const kept = options.tools?.[0]?.definition as Bag | undefined;
  expect(kept?.name).toBe('notes');
  expect(kept?.description).toBe('Write a note down');
  expect(Object.isFrozen(kept)).toBe(true);
  expect(() => { (kept as Bag).name = 'mine'; }).toThrow(TypeError);
});

it('keeps the provider a plugin registered its agent under', () => {
  const { host, contribution } = pluginHost('agents', context());
  const mine: Agent = { ...echo({ path: DIR, pace: 0 }), provider: 'mine' };
  host.registerAgent(mine);

  const { options } = foldHostOptions({ path: DIR, agents: [] }, [contribution]);

  // The provider is read once, at registration, and it is what a session is
  // metered under: a plugin that renames its agent afterwards renames nothing.
  mine.provider = 'other';
  expect(options.agents.map((one) => one.provider)).toEqual(['mine']);
  // The copy is a view of the backend rather than a frozen snapshot of it, so
  // it is not itself frozen - only the `provider` on it is pinned, which is
  // the case below.
  expect(Object.isFrozen(options.agents[0])).toBe(false);
  expect(() => { bag(options.agents[0]).provider = 'other'; }).toThrow(TypeError);
});

/*
 * A backend written as a class, which is what the copy of an agent has to
 * survive: its methods are on the prototype and its fields are own properties,
 * so a copy of the own properties alone would answer `provider` and have
 * nothing to start a session with.
 */
class Spoken implements Agent {
  provider = 'spoken';
  displayName = 'The spoken backend';
  /** Kept by the method below, which is the one that writes to `this`. */
  tally = 0;

  schema(): Bag {
    return { type: 'object', properties: { voice: { type: 'string' } } };
  }

  defaults(): Record<string, unknown> {
    return { voice: 'plain' };
  }

  /** Never called here: this case is about the method surviving the fold. */
  create(): never {
    throw new Error('this case starts no session');
  }

  /** A method that writes to `this`, which a frozen copy would refuse. */
  noted(): number {
    this.tally += 1;
    return this.tally;
  }
}

it('keeps the methods of an agent written as a class', () => {
  const { host, contribution } = pluginHost('spoken', context());
  const mine = new Spoken();
  host.registerAgent(mine);

  const { options } = foldHostOptions({ path: DIR, agents: [] }, [contribution]);
  const kept = options.agents[0] as Spoken;

  // What a host asks a backend for is on the class, so what the fold keeps has
  // to answer it: the fields are the shell and the methods are the backend.
  expect(kept.schema()).toEqual({ type: 'object', properties: { voice: { type: 'string' } } });
  expect(kept.defaults()).toEqual({ voice: 'plain' });
  expect(typeof kept.create).toBe('function');

  // And a method that writes to `this` still works, which a copy frozen to the
  // last property would not: the agent the plugin handed over stays a working
  // backend, and only the id the host meters by is pinned.
  expect(kept.noted()).toBe(1);
  expect(kept.noted()).toBe(2);

  // Pinned against both directions - the copy cannot be renamed, and neither
  // can the backend the plugin still holds under it.
  expect(() => { bag(kept).provider = 'other'; }).toThrow(TypeError);
  mine.provider = 'other';
  expect(kept.provider).toBe('spoken');
});

it('hands a plugin a frozen context of its own', () => {
  const { host } = pluginHost('frozen', context());

  // The context is the plugin's own object, and it is read-only: a plugin that
  // moved `path` or replaced its `log` would be changing what it, and every
  // listener it registered, reads about the host.
  expect(Object.isFrozen(host)).toBe(true);
  expect(() => { bag(host).path = '/elsewhere'; }).toThrow(TypeError);
  expect(() => { bag(host).log = () => {}; }).toThrow(TypeError);
  expect(host.path).toBe(DIR);
});

it('hands every listener one frozen copy of an event, so none writes for the next', async () => {
  const seen: unknown[] = [];
  const ports: number[] = [];
  const problems: string[] = [];
  const handlers: HostHandlers = {
    listening: [
      {
        by: 'first',
        context: context(),
        handle: (one) => { seen.push(one); bag(one).port = 1; },
      },
      {
        by: 'second',
        context: context(),
        handle: (one) => { seen.push(one); ports.push(one.port); },
      },
    ],
  };
  const event = { type: 'listening' as const, runtime: 'node' as const, host: '127.0.0.1', port: 9350, guarded: false };
  await raise(handlers, event, (line) => { problems.push(line); });

  // The same copy to both, and frozen: the first listener's write was refused
  // where it was made, which is the line the host reports against it.
  expect(seen[0]).toBe(seen[1]);
  expect(Object.isFrozen(seen[0])).toBe(true);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain('first failed at listening');
  expect(problems[0]).toContain('read only property');
  // And the second listener reads what the host bound, not what the first wrote.
  expect(ports).toEqual([9350]);
  // The event the host built is the host's own and was neither frozen nor moved.
  expect(event.port).toBe(9350);
  expect(Object.isFrozen(event)).toBe(false);
});

/*
 * ---------------------------------------------------------------------------
 * What the fold keeps of the base it was handed.
 * ---------------------------------------------------------------------------
 *
 * The base is the daemon's own options, and one of its keys is a getter over
 * what root config last wrote: `mcpServers` is read when a session starts, so
 * an edit while the daemon runs reaches the next session without a restart. A
 * fold that spread the base would read that getter once and keep the value it
 * answered, and the edit would stop reaching anything.
 */

it('keeps a getter on the base, so the session after the edit reads the new value', async () => {
  type Servers = NonNullable<HostOptions['mcpServers']>;
  let served: Servers = { ours: { type: 'http', url: 'https://mcp.example.test/one' } };
  let handed: Start | undefined;
  const base: HostOptions = {
    path: DIR,
    agents: [probing((one) => { handed = one; })],
    resources: fileResources(),
    sessions: memorySessions(),
    users: directory(),
    get mcpServers(): Servers { return served; },
  };

  const { options, problems } = foldHostOptions(base, []);
  expect(problems).toEqual([]);

  // The edit root config would make, after the fold and before the next
  // session starts: the key answers something else from here on.
  served = { ours: { type: 'http', url: 'https://mcp.example.test/two' } };

  const host = createHost(options);
  const client = host.accept(peer(), ana);
  await client.handle(hello(['0.9.0'], { clientId: 'probe' }));
  await client.handle({ method: 'createSession', params: { channel: 'probe:/live', provider: 'probe' } });

  // Read when this session started rather than held from the fold, so what the
  // backend is offered is the server the edit left there.
  expect(bag(handed?.mcpServers?.ours).url).toBe('https://mcp.example.test/two');
});

it('keeps the session setting a plugin registered, not the schema it writes later', () => {
  const { host, contribution } = pluginHost('keys', context());
  const schema: Bag = { type: 'string', title: 'Notes', default: 'none' };
  host.registerSessionConfig('notes', schema);

  const { options } = foldHostOptions({ path: DIR, agents: [] }, [contribution]);

  schema.default = 'mine';
  expect((options.sessionConfig?.notes as Bag).default).toBe('none');
  expect(() => { (options.sessionConfig?.notes as Bag).default = 'mine'; }).toThrow(TypeError);
});

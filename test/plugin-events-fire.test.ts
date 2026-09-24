import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { memoryAutomations } from '../packages/sdk/src/automations.js';
import { foldHostOptions, pluginHost } from '../packages/sdk/src/plugins.js';
import { sdkVersion } from '../packages/sdk/src/version.js';
import { echo } from '../examples/echo/agent.js';
import type { Agent } from '../packages/sdk/src/types/agent.js';
import type { EventName, HostEvent } from '../packages/sdk/src/types/events.js';
import type { HostOptions, HostTool } from '../packages/sdk/src/types/host.js';
import type { ResourceStore } from '../packages/sdk/src/types/resources.js';
import type { TerminalStore } from '../packages/sdk/src/types/terminals.js';
import type { PluginContext } from '../packages/sdk/src/types/plugin.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The first events, at the host's own moments.
 *
 * A plugin subscribed to every event, one host driven the way `test/host.test.ts`
 * drives one, and one case per event: what fired, how many times, and with what
 * the moment knew. A turn that streamed several deltas is deliberately one of
 * them, because "no event per token" is a rule and not an omission.
 */

const DIR = '/tmp/plugin-events';
const ROOT = 'ahp-root://';
const AUTOMATIONS = 'ahp-automations://';

const EVENT_NAMES: readonly EventName[] = [
  'session_start', 'session_end', 'turn_start', 'turn_end', 'message', 'tool_call',
  'client_connect', 'client_disconnect', 'authenticated', 'automation_fire',
  'resource_write', 'terminal_open', 'log',
];

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

const settle = async (times = 12): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const wait = async (ms: number): Promise<void> => { await new Promise((r) => { setTimeout(r, ms); }); };

const context = (): PluginContext => ({ path: DIR, paths: [DIR], version: sdkVersion(), log: () => {}, say: () => {} });

/** One host, one plugin subscribed to everything, and what it saw. */
function watched(extra: Partial<HostOptions> = {}) {
  const seen: HostEvent[] = [];
  const lines: string[] = [];
  const { host: plugin, contribution } = pluginHost('probe', context());
  for (const name of EVENT_NAMES) plugin.on(name, (event) => { seen.push(event); });

  const base: HostOptions = {
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    onEvent: (line) => { lines.push(line); },
    ...extra,
  };
  const { options } = foldHostOptions(base, [contribution]);
  const p = peer();
  const host = createHost(options);
  const client = host.accept(p);
  return { seen, lines, host, client, peer: p };
}

const hello = (client: ReturnType<ReturnType<typeof createHost>['accept']>) => client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: [ROOT] },
});

const of = (seen: HostEvent[], type: EventName): HostEvent[] => seen.filter((event) => event.type === type);

/** A backend that calls the host's first contributed tool as it starts. */
const tooler = (outcome: (said: string) => void): Agent => {
  const inner = echo({ path: DIR, pace: 0 });
  return {
    ...inner,
    provider: 'tooler',
    displayName: 'Tooler',
    create: (start) => {
      const tool = start.tools?.[0];
      if (tool?.run !== undefined) {
        void Promise.resolve(tool.run({})).then(
          () => { outcome('ok'); },
          (error: unknown) => { outcome(`threw: ${error instanceof Error ? error.message : String(error)}`); },
        );
      }
      return inner.create(start);
    },
  };
};

const probeTool = (run: () => Promise<string> | string): HostTool => ({
  definition: { name: 'probe_tool', description: 'A tool the test calls.', inputSchema: { type: 'object', properties: {} } },
  run,
});

it('fires session_start with its provider, and session_end when it is disposed', async () => {
  const { seen, client } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
  await settle();

  const started = of(seen, 'session_start');
  expect(started).toHaveLength(1);
  expect(started[0]).toMatchObject({ session: 'ahp-session:/one', provider: 'echo' });

  await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
  await settle();
  const ended = of(seen, 'session_end');
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ session: 'ahp-session:/one' });
});

it('fires message, turn_start and turn_end once each, and nothing per delta', async () => {
  const { seen, client } = watched({ agents: [echo({ path: DIR, pace: 60 })] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/turn', provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/turn' } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/turn', action: { type: 'chat/turnStarted', turnId: 'turn-1', message: { text: 'hello there' } } },
  });
  await wait(500);

  const about = seen.filter((event) => event.type === 'message' || event.type === 'turn_start' || event.type === 'turn_end');
  expect(about.map((event) => event.type)).toEqual(['message', 'turn_start', 'turn_end']);
  // The host's own chat URI, not the client's alias for it: the event carries
  // what the host calls the channel, which is the identity it uses everywhere.
  expect(about[0]).toMatchObject({ session: 'ahp-session:/turn', chat: expect.stringMatching(/^ahp-chat:/), turn: 'turn-1', text: 'hello there' });
  expect(about[1]).toMatchObject({ turn: 'turn-1' });
  expect(about[2]).toMatchObject({ turn: 'turn-1', status: 'complete' });
});

it('fires turn_end cancelled when a running turn is stopped', async () => {
  const { seen, client } = watched({ agents: [echo({ path: DIR, pace: 60 })] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/cancel', provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/cancel' } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/cancel', action: { type: 'chat/turnStarted', turnId: 'turn-c', message: { text: 'one two three four five' } } },
  });
  await settle(1);
  client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-chat:/cancel', action: { type: 'chat/turnCancelled', turnId: 'turn-c' } },
  });
  await wait(200);

  const ended = of(seen, 'turn_end');
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ turn: 'turn-c', status: 'cancelled' });
});

it('fires tool_call once, after a host tool answered', async () => {
  const outcomes: string[] = [];
  const { seen, client } = watched({ agents: [tooler((said) => outcomes.push(said))], tools: [probeTool(() => 'fine')] });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/tool', provider: 'tooler' } });
  await settle();

  expect(outcomes).toEqual(['ok']);
  const calls = of(seen, 'tool_call');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ session: 'ahp-session:/tool', tool: 'probe_tool', ok: true });
});

it('fires tool_call with the failure when a host tool throws', async () => {
  const outcomes: string[] = [];
  const { seen, client } = watched({
    agents: [tooler((said) => outcomes.push(said))],
    tools: [probeTool(() => { throw new Error('boom'); })],
  });
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/bad-tool', provider: 'tooler' } });
  await settle();

  expect(outcomes).toEqual(['threw: boom']);
  const calls = of(seen, 'tool_call');
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatchObject({ tool: 'probe_tool', ok: false, error: 'boom' });
});

it('fires client_connect on initialize and client_disconnect on close', async () => {
  const { seen, client } = watched();
  await hello(client);
  await settle();
  expect(of(seen, 'client_connect').map((event) => (event as { client: string }).client)).toEqual(['probe']);

  client.close();
  await settle();
  expect(of(seen, 'client_disconnect').map((event) => (event as { client: string }).client)).toEqual(['probe']);
});

it('fires authenticated when a client pushes a token for one of its resources', async () => {
  const resource = 'https://example.test';
  const { seen, client } = watched({
    agents: [{ ...echo({ path: DIR, pace: 0 }), protectedResources: [{ resource }] }],
  });
  await hello(client);
  await client.handle({ method: 'authenticate', params: { channel: ROOT, resource, token: 'shh' } });
  await settle();

  const auth = of(seen, 'authenticated');
  expect(auth).toHaveLength(1);
  expect(auth[0]).toMatchObject({ client: 'probe', resource });
});

it('fires resource_write once the store accepted the write', async () => {
  const store: ResourceStore = {
    list: async () => [],
    read: async () => ({ data: '', encoding: 'utf-8' }),
    resolve: async () => ({ type: 'file', uri: 'file:///tmp/x' }) as never,
    complete: async () => [],
    write: async () => {},
  };
  const { seen, client } = watched({ resources: store });
  await hello(client);
  await client.handle({ method: 'resourceRequest', params: { channel: ROOT, uri: 'file:///tmp/x', write: true } });
  await client.handle({ method: 'resourceWrite', params: { channel: ROOT, uri: 'file:///tmp/x', data: 'x', encoding: 'utf-8' } });
  await settle();

  const writes = of(seen, 'resource_write');
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ uri: 'file:///tmp/x' });
});

it('fires terminal_open once the terminal exists', async () => {
  const store = {
    create: (options: { uri: string; cwd: string; claim: unknown; name?: string }) => ({
      uri: options.uri,
      title: () => options.name ?? 'Terminal',
      claim: () => options.claim,
      lifecycle: () => ({ status: 'running' }),
    }),
  } as unknown as TerminalStore;
  const { seen, client } = watched({ terminals: store });
  await hello(client);
  await client.handle({ method: 'createTerminal', params: { channel: 'ahp-terminal:/one', claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' } });
  await settle();

  const opened = of(seen, 'terminal_open');
  expect(opened).toHaveLength(1);
  expect(opened[0]).toMatchObject({ terminal: 'ahp-terminal:/one', cwd: '/tmp' });
});

it('fires automation_fire when an automation starts a session', async () => {
  const { seen, client } = watched({ automations: memoryAutomations() });
  await hello(client);
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: AUTOMATIONS,
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/nightly',
        definition: {
          title: 'Nightly',
          enabled: true,
          message: { text: 'review' },
          session: { provider: 'echo', workingDirectories: [`file://${DIR}`] },
          triggers: [],
        },
      },
    },
  });
  await client.handle({ method: 'runAutomation', params: { channel: AUTOMATIONS, automation: 'ahp-automation:/nightly', requestId: 'r1' } });
  await settle();

  const fired = of(seen, 'automation_fire');
  expect(fired).toHaveLength(1);
  expect(fired[0]).toMatchObject({ automation: 'ahp-automation:/nightly' });
});

it('fires log with the same line onEvent receives', async () => {
  const { seen, lines, client } = watched();
  await hello(client);
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/log', provider: 'echo' } });
  await settle();

  const logged = of(seen, 'log').map((event) => (event as { line: string }).line);
  expect(lines.length).toBeGreaterThan(0);
  expect(logged).toEqual(lines);
});

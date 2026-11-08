import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { createSandbox } from '../src/host/sandbox.js';
import { SANDBOX_ENABLED_PROPERTY } from '../src/types/sandbox.js';
import { echo } from '../../../examples/echo/agent.js';
import type { HostContext } from '../src/host/context.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { ComputerPort } from '../src/types/computers.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * Each chat's sandbox as this host keeps it, as VS Code's agent configuration
 * service keeps it: the operator's floor published on the session, each
 * chat's selection read from the values it runs on and resolved for its
 * runtime on `Start.computers`, each chat's applied enablement kept apart,
 * and a client's request the session's computer cannot host rejected in the
 * computer's words and put back.
 */

const DIR = '/tmp/ahpd-host-sandbox';

type Note = { method: string; params: unknown };

const peer = (notes: Note[] = []): Peer => ({
  send: () => {}, notify: (method, params) => { notes.push({ method, params }); }, request: async () => ({}), answered: () => {}, close: () => {},
});

const settle = async (times = 40): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/**
 * The echo backend with VS Code's sandbox switch in its schema, taking the
 * switch on a running session, and keeping each start it is handed.
 */
const switched = (started: Start[]): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    schema: () => {
      const own = base.schema();
      return { ...own, properties: { ...(own.properties as Bag), sandboxEnabled: SANDBOX_ENABLED_PROPERTY } };
    },
    create: (start) => {
      started.push(start);
      const session = base.create(start);
      return { ...session, setConfig: (key: string) => (key === 'sandboxEnabled' ? true : `${key} is not a key this backend takes`) };
    },
  };
};

const REFUSAL = 'computer://box cannot host the sandbox: bubblewrap (bwrap) not installed';

/** A computers port whose one machine, `box`, cannot host the sandbox runtime. */
const port = (): ComputerPort => ({
  how: async () => ({ command: 'true', args: [] }),
  sandboxSupport: async (id) => (id === 'box' ? REFUSAL : undefined),
});

const opened = async (notes: Note[], options: Parameters<typeof createHost>[0]) => {
  const host = createHost(options);
  const client = host.accept(peer(notes));
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  return client;
};

const stateOf = async (client: Awaited<ReturnType<typeof opened>>, channel: string): Promise<Bag> =>
  ((await client.handle({ method: 'subscribe', params: { channel } })) as { snapshot: { state: Bag } }).snapshot.state;

const sandboxStateOf = (state: Bag): Bag | undefined => (state._meta as Bag | undefined)?.['vscode.sandboxState'] as Bag | undefined;

const selecting = async (client: Awaited<ReturnType<typeof opened>>, uri: string, clientSeq: number, value: string): Promise<void> => {
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, clientSeq, action: { type: 'session/configChanged', config: { sandboxEnabled: value } } },
  });
  await settle();
};

/** The session's actions as they were said, the metaChanged and configChanged ones, in order. */
const saidOf = (notes: Note[]): Bag[] => notes
  .filter((one) => one.method === 'action')
  .map((one) => (one.params as { channel: string; action: Bag }).action)
  .filter((action) => action.type === 'session/metaChanged' || action.type === 'session/configChanged');

it('publishes the operator\'s floor on a session as vscode.resolvedSandboxPolicy', async () => {
  const floor = { enabled: true, allowBypass: false, blockedHosts: ['evil.test'], failClosed: true };
  const client = await opened([], { path: DIR, agents: [echo({ path: DIR, pace: 0 })], managedSettingsSandbox: floor });
  await client.handle({ method: 'createSession', params: { channel: 'echo:/floor', provider: 'echo' } });
  await settle();
  expect((await stateOf(client, 'echo:/floor'))._meta).toMatchObject({ 'vscode.resolvedSandboxPolicy': floor });
});

/*
 * The switch is VS Code's platform property, which a session sets for its
 * chats and a chat for itself, and a client reads it as declared.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostSchema.ts#L379-L386
 */
it('declares the switch as VS Code\'s platform property, session- and chat-mutable, and a client reads it as declared', async () => {
  expect(SANDBOX_ENABLED_PROPERTY).toEqual({
    type: 'string',
    title: 'Sandbox',
    description: 'Sandbox behavior for this session. Default follows the global setting.',
    enum: ['default', 'on', 'off'],
    sessionMutable: true,
    chatMutable: true,
  });
  const client = await opened([], { path: DIR, agents: [switched([])], computers: port() });
  await client.handle({ method: 'createSession', params: { channel: 'echo:/declared', provider: 'echo' } });
  await settle();
  const schema = ((await stateOf(client, 'echo:/declared')).config as { schema: { properties: Bag } }).schema;
  expect(schema.properties.sandboxEnabled).toEqual(SANDBOX_ENABLED_PROPERTY);
});

it('resolves a chat\'s sandbox for its runtime on Start.computers, the root settings and the selection within the floor', async () => {
  const started: Start[] = [];
  const client = await opened([], {
    path: DIR,
    agents: [switched(started)],
    computers: port(),
    managedSettingsSandbox: { enabled: false, allowedHosts: ['managed.test'] },
    providerConfigurations: [{
      provider: 'sandbox', title: 'Agent Sandbox', description: 'The sandbox.',
      settings: [{ key: 'sandbox', group: 'Agent Sandbox' }],
      properties: { sandbox: { type: 'object', title: 'Agent Sandbox' } },
    }],
  });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-root://', clientSeq: 1, action: { type: 'root/configChanged', config: { sandbox: { enabled: 'off', allowedNetworkDomains: ['local.test'] } } } },
  });
  await client.handle({ method: 'createSession', params: { channel: 'echo:/resolved', provider: 'echo', config: { sandboxEnabled: 'on' } } });
  await settle();
  const start = started.at(-1);
  expect(start?.computers?.sandbox?.()).toMatchObject({ enabled: 'on', allowedNetworkDomains: ['managed.test'] });
});

/*
 * A chat takes its selection from the values it runs on: a chat with values
 * of its own its own, and every other chat its session's, as VS Code reads a
 * chat's config values for its sandbox.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionSandbox.ts#L17-L69
 */
it('reads each chat\'s selection from the values it runs on, its own where it has them and its session\'s otherwise', () => {
  const own = { sandboxEnabled: 'off' };
  const held = {
    config: { sandboxEnabled: 'on' },
    defaultChat: 'ahp-chat:/lead',
    chats: new Map([['ahp-chat:/lead', {}], ['ahp-chat:/peer', {}], ['ahp-chat:/other', {}]]),
    backends: new Map([['ahp-chat:/other', { config: own }]]),
  };
  const sandbox = createSandbox({
    sessions: new Map([['echo:/chats', held]]),
    kept: { config: () => undefined },
    dispatch: () => {},
    log: () => {},
    options: {},
    rootConfig: {},
    chatConfig: (_uri: string, one: typeof held, chat: string) => (chat === 'ahp-chat:/other' ? own : one.config),
    getChatOwnConfigValues: () => ({}),
  } as unknown as HostContext);
  expect(sandbox.config('echo:/chats', 'ahp-chat:/lead').enabled).toBe('on');
  expect(sandbox.config('echo:/chats', 'ahp-chat:/peer').enabled).toBe('on');
  expect(sandbox.config('echo:/chats', 'ahp-chat:/other').enabled).toBe('off');
});

/*
 * A change of the session's selection reaches every chat that takes it, each
 * chat's applied enablement kept apart and the default chat's also at the
 * session level, which older clients read.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1159-L1170
 */
it('applies a session\'s selection to each chat that takes it, each chat\'s state apart and the default chat\'s also at the top', async () => {
  const client = await opened([], { path: DIR, agents: [switched([])], computers: port() });
  const uri = 'echo:/chats';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: { sandboxEnabled: 'off' } } });
  await settle();
  const lead = String((await stateOf(client, uri)).defaultChat);
  const PEER = 'ahp-chat:/sandbox-peer';
  await client.handle({ method: 'createChat', params: { channel: uri, chat: PEER } });
  await settle();
  expect(sandboxStateOf(await stateOf(client, uri))).toMatchObject({ chats: { [lead]: { enabled: false }, [PEER]: { enabled: false } }, enabled: false });

  await selecting(client, uri, 3, 'on');
  expect(sandboxStateOf(await stateOf(client, uri))).toMatchObject({ chats: { [lead]: { enabled: true }, [PEER]: { enabled: true } }, enabled: true });
});

/*
 * The failure is said before the selection is put back, then the chat
 * applies the selection put back, which leaves the rejection reported and
 * the failure said; a new selection clears the rejection.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1146-L1157
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1180-L1223
 */
it('rejects a client\'s request to turn the sandbox on where its computer cannot host it, in the computer\'s words, puts it back, and a new selection clears the rejection', async () => {
  const notes: Note[] = [];
  const client = await opened(notes, { path: DIR, agents: [switched([])], computers: port() });
  const uri = 'echo:/rejected';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: { computer: 'computer://box', sandboxEnabled: 'off' } } });
  await settle();
  const chat = String((await stateOf(client, uri)).defaultChat);
  // Applied off at the start, which is what a rejection puts the chat back to.
  expect(sandboxStateOf(await stateOf(client, uri))).toMatchObject({ chats: { [chat]: { enabled: false } } });

  await selecting(client, uri, 5, 'on');
  const failure = { enabled: false, rejectedSelection: true, error: { clientId: 'probe', clientSeq: 5, message: REFUSAL } };
  const said = saidOf(notes);
  const failed = said.findIndex((action) => action.type === 'session/metaChanged'
    && JSON.stringify((action._meta as Bag | undefined)?.['vscode.sandboxState']) === JSON.stringify({ chats: { [chat]: failure }, ...failure }));
  const back = said.findIndex((action, at) => at > failed && action.type === 'session/configChanged'
    && (action.config as Bag).sandboxEnabled === 'off');
  expect(failed).toBeGreaterThanOrEqual(0);
  expect(back).toBeGreaterThan(failed);
  const state = await stateOf(client, uri);
  expect((state.config as { values: Bag }).values.sandboxEnabled).toBe('off');
  expect(sandboxStateOf(state)).toEqual({ chats: { [chat]: { enabled: false, rejectedSelection: true } }, enabled: false, rejectedSelection: true });

  await selecting(client, uri, 6, 'default');
  expect(sandboxStateOf(await stateOf(client, uri))).toEqual({ chats: { [chat]: { enabled: false } }, enabled: false });
});

/*
 * Under a floor that keeps the sandbox on and allows bypass, a client's `off`
 * is kept and is the chat's enablement, as VS Code's runtime takes it with its
 * session command; the chat then runs outside the sandbox.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentConfigurationService.ts#L1117-L1121
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionSandbox.ts#L410-L421
 */
it('keeps a client\'s off under a floor that allows bypass, and takes it as the chat\'s enablement', async () => {
  const started: Start[] = [];
  const client = await opened([], { path: DIR, agents: [switched(started)], computers: port(), managedSettingsSandbox: { enabled: true, allowBypass: true } });
  const uri = 'echo:/bypassed';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await settle();
  const chat = String((await stateOf(client, uri)).defaultChat);
  expect(sandboxStateOf(await stateOf(client, uri))).toMatchObject({ chats: { [chat]: { enabled: true } } });

  await selecting(client, uri, 4, 'off');
  const state = await stateOf(client, uri);
  expect((state.config as { values: Bag }).values.sandboxEnabled).toBe('off');
  expect(sandboxStateOf(state)).toMatchObject({ chats: { [chat]: { enabled: false } }, enabled: false });
  expect(started.at(-1)?.computers?.sandbox?.(chat)).toMatchObject({ enabled: 'off' });
});

/*
 * Under a floor that fails closed, a client's `off` is refused in the words
 * VS Code reads as its runtime's refusal of a sandbox the managed policy does
 * not allow, and put back.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionSandbox.ts#L280-L290
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotSessionLauncher.ts#L999-L1002
 */
it('refuses a client\'s off under a floor that fails closed, in the words VS Code reads as its runtime\'s, and puts the selection back', async () => {
  const notes: Note[] = [];
  const client = await opened(notes, { path: DIR, agents: [switched([])], computers: port(), managedSettingsSandbox: { enabled: true, failClosed: true } });
  const uri = 'echo:/closed';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await settle();
  const chat = String((await stateOf(client, uri)).defaultChat);

  await selecting(client, uri, 7, 'off');
  const message = 'Sandbox configuration update violates managed policy. Contact your administrator for more information.';
  const said = saidOf(notes);
  const failed = said.findIndex((action) => action.type === 'session/metaChanged'
    && JSON.stringify((action._meta as Bag | undefined)?.['vscode.sandboxState']).includes(message));
  const back = said.findIndex((action, at) => at > failed && action.type === 'session/configChanged'
    && (action.config as Bag).sandboxEnabled === 'on');
  expect(failed).toBeGreaterThanOrEqual(0);
  expect(back).toBeGreaterThan(failed);
  const state = await stateOf(client, uri);
  expect((state.config as { values: Bag }).values.sandboxEnabled).toBe('on');
  expect(sandboxStateOf(state)).toMatchObject({ chats: { [chat]: { enabled: true, rejectedSelection: true } } });
});

/*
 * A change of the root sandbox settings applies every chat's sandbox again,
 * as VS Code's runtimes apply theirs on a root change.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8229-L8243
 */
it('applies every chat\'s sandbox again when the root sandbox settings move', async () => {
  const client = await opened([], { path: DIR, agents: [switched([])], computers: port() });
  const uri = 'echo:/rooted';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await settle();
  const chat = String((await stateOf(client, uri)).defaultChat);
  expect(sandboxStateOf(await stateOf(client, uri))).toMatchObject({ chats: { [chat]: { enabled: false } } });

  await client.handle({
    method: 'dispatchAction',
    params: { channel: 'ahp-root://', clientSeq: 2, action: { type: 'root/configChanged', config: { sandbox: { enabled: 'on' } } } },
  });
  await settle();
  expect(sandboxStateOf(await stateOf(client, uri))).toMatchObject({ chats: { [chat]: { enabled: true } }, enabled: true });
});

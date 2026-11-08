import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Bag } from '../src/types/common.js';
import type { ComputerPort } from '../src/types/computers.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * Each chat's sandbox as this host keeps it: the operator's floor published on
 * the session as VS Code publishes the floor its runtime resolved, the chat's
 * sandbox resolved for its runtime on `Start.computers`, and a chat's request
 * the session's computer cannot host rejected in the computer's words and put
 * back, as VS Code's host rejects a sandbox change its runtime cannot apply.
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
      return {
        ...own,
        properties: {
          ...(own.properties as Bag),
          sandboxEnabled: { type: 'string', title: 'Sandbox', enum: ['default', 'on', 'off'], sessionMutable: true },
        },
      };
    },
    create: (start) => {
      started.push(start);
      const session = base.create(start);
      return { ...session, setConfig: (key: string) => (key === 'sandboxEnabled' ? true : `${key} is not a key this backend takes`) };
    },
  };
};

/** A computers port whose one machine, `box`, cannot host the sandbox runtime. */
const port = (): ComputerPort => ({
  how: async () => ({ command: 'true', args: [] }),
  sandboxSupport: async (id) => (id === 'box' ? 'computer://box cannot host the sandbox: bubblewrap (bwrap) not installed' : undefined),
});

const opened = async (notes: Note[], options: Parameters<typeof createHost>[0]) => {
  const host = createHost(options);
  const client = host.accept(peer(notes));
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
  return client;
};

const stateOf = async (client: Awaited<ReturnType<typeof opened>>, channel: string): Promise<Bag> =>
  ((await client.handle({ method: 'subscribe', params: { channel } })) as { snapshot: { state: Bag } }).snapshot.state;

it('publishes the operator\'s floor on a session as vscode.resolvedSandboxPolicy', async () => {
  const floor = { enabled: true, allowBypass: false, blockedHosts: ['evil.test'], failClosed: true };
  const client = await opened([], { path: DIR, agents: [echo({ path: DIR, pace: 0 })], managedSettingsSandbox: floor });
  await client.handle({ method: 'createSession', params: { channel: 'echo:/floor', provider: 'echo' } });
  await settle();
  expect((await stateOf(client, 'echo:/floor'))._meta).toMatchObject({ 'vscode.resolvedSandboxPolicy': floor });
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

it('rejects a chat\'s request to turn the sandbox on where its computer cannot host it, in the computer\'s words, and puts it back', async () => {
  const notes: Note[] = [];
  const client = await opened(notes, { path: DIR, agents: [switched([])], computers: port() });
  const uri = 'echo:/rejected';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo', config: { computer: 'computer://box', sandboxEnabled: 'off' } } });
  await settle();
  const chat = String((await stateOf(client, uri)).defaultChat);
  // Applied off at the start, which is what a rejection puts the chat back to.
  expect((await stateOf(client, uri))._meta).toMatchObject({ 'vscode.sandboxState': { chats: { [chat]: { enabled: false } } } });

  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, clientSeq: 5, action: { type: 'session/configChanged', config: { sandboxEnabled: 'on' } } },
  });
  await settle();
  const state = await stateOf(client, uri);
  const failure = { enabled: false, rejectedSelection: true, error: { clientId: 'probe', clientSeq: 5, message: 'computer://box cannot host the sandbox: bubblewrap (bwrap) not installed' } };
  expect(state._meta).toMatchObject({ 'vscode.sandboxState': { chats: { [chat]: failure }, ...failure } });
  expect((state.config as { values: Bag }).values.sandboxEnabled).toBe('off');
  // The failure said before the selection is put back, so a client can say it
  // before it reconciles its toggle.
  const said = notes
    .filter((one) => one.method === 'action')
    .map((one) => (one.params as { channel: string; action: Bag }).action)
    .filter((action) => action.type === 'session/metaChanged' || action.type === 'session/configChanged');
  const failed = said.findIndex((action) => action.type === 'session/metaChanged'
    && (action._meta as Bag | undefined)?.['vscode.sandboxState'] !== undefined
    && JSON.stringify(action._meta).includes('rejectedSelection'));
  const back = said.findIndex((action, at) => at > failed && action.type === 'session/configChanged'
    && (action.config as Bag).sandboxEnabled === 'off');
  expect(failed).toBeGreaterThanOrEqual(0);
  expect(back).toBeGreaterThan(failed);
});

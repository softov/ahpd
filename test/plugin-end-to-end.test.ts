import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost } from '../packages/sdk/src/host.js';
import { loadPlugins } from '../packages/server/src/plugins.js';
import { echo } from '../examples/echo/agent.js';
import type { HostOptions } from '../packages/sdk/src/types/host.js';
import type { PluginSpec } from '../packages/sdk/src/types/plugin.js';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The whole path, once: a spec on disk to a served conversation.
 *
 * Every other test stops at an edge - the resolver at a URL, the loader at a
 * contribution, the fold at an option object. This one follows the same
 * fixture through all of them and then drives a turn, which is the only way to
 * know a plugin's backend is served exactly as a literal one is rather than
 * merely folded like one.
 */

const REPO = join(import.meta.dirname, '..');

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

/** One backend the daemon would have had anyway, so the plugin's is provably extra. */
const base = (): HostOptions => ({
  path: '/tmp/plugin-e2e',
  agents: [{ ...echo({ path: '/tmp/plugin-e2e', pace: 0 }), provider: 'base', displayName: 'Base backend' }],
});

const load = (specs: PluginSpec[]) => loadPlugins(specs, { base: base(), configDir: REPO, cwd: REPO, log: () => {} });

const initialize = async (client: ReturnType<ReturnType<typeof createHost>['accept']>) => await client.handle({
  method: 'initialize',
  params: { clientId: 'probe', protocolVersions: ['0.8.0'], initialSubscriptions: ['ahp-root://'] },
}) as { snapshots: { state: { agents: { provider: string }[] } }[] };

it('serves a backend that arrived as a plugin, through a whole turn', async () => {
  const { options, loaded, problems } = await load(['./test/fixtures/plugin-echo']);
  expect(problems).toEqual([]);
  expect(loaded[0]?.name).toBe('echo-plugin');
  // The module exports no title, so this is the manifest's, which is what the
  // `ahpd` key is for.
  expect(loaded[0]?.title).toBe('Echo plugin');

  const host = createHost(options);
  const said = peer();
  const client = host.accept(said);
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base', 'echo']);

  const uri = 'ahp-session:/plugin';
  const chat = 'ahp-chat:/plugin';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello there' } } },
  });
  await settle();

  const types = said.notes
    .filter((note) => note.method === 'action')
    .map((note) => (note.params as { action: { type: string } }).action.type);
  const ordering = types.filter((type) => type === 'chat/turnStarted' || type === 'chat/responsePart' || type === 'chat/delta');
  expect(ordering.slice(0, 3)).toEqual(['chat/turnStarted', 'chat/responsePart', 'chat/delta']);

  const opened = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: { turns: { responseParts: { content: string }[] }[] } };
  };
  expect(opened.snapshot.state.turns[0]?.responseParts[0]?.content).toBe('hello there');
});

it('leaves the host with only its own backend when the spec is switched off', async () => {
  const { options, loaded, problems } = await load([{ name: './test/fixtures/plugin-echo', enabled: false }]);
  expect(problems).toEqual([]);
  expect(loaded).toEqual([]);

  const host = createHost(options);
  const client = host.accept(peer());
  const ready = await initialize(client);
  expect(ready.snapshots[0]?.state.agents.map((one) => one.provider)).toEqual(['base']);
});

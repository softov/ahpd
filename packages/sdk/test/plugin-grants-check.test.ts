import { loggerOf } from '../src/log.js';
import { expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Bag } from '../src/types/common.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext, PluginHost } from '../src/types/plugin.js';

/*
 * A grant a plugin's channel, method or tunnel kind asks for, held against the
 * list `ahpd.grants` carries.
 *
 * A role editor draws its chips from that list, so a required grant nothing
 * lists is one no role can be given. It is a line in the fold's `problems`
 * naming the plugin and the grant, and the plugin loads all the same.
 */

const at = '/tmp/plugin-grants-check';

const context = (): LoaderContext => ({
  path: at,
  paths: [at],
  version: '0.0.0',
  hostName: 'host',
  configDir: at,
  log: loggerOf(() => {}),
  say: () => {},
});

/** The host a plugin registered into, folded over one backend, as the loader folds it. */
const folded = (register: (host: PluginHost) => void) => {
  const recording = pluginHost('demo', context());
  register(recording.host);
  recording.seal();
  return foldHostOptions({ path: at, agents: [echo({ path: at })] }, [recording.contribution]);
};

/** A client that subscribes to `uri`, and the answer it got. */
const subscribed = async (options: HostOptions, uri: string): Promise<Bag> => {
  const made = createHost(options);
  const client = made.accept({ send: () => {}, request: async () => ({}), answered: () => {}, close: () => {}, notify: () => {} });
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  const answer = await client.handle({ method: 'subscribe', params: { channel: uri } }).then(
    (result) => ({ result }),
    (error: unknown) => ({ error }),
  );
  await made.close();
  return answer as Bag;
};

it('reports a channel grant no entry lists, and serves the channel all the same', async () => {
  const { options, problems } = folded((host) => {
    host.registerChannel('x-notes', { grant: 'notes:read', snapshot: () => ({ items: ['one'] }) });
  });

  expect(problems).toEqual(['plugin demo requires notes:read, which no entry of ahpd.grants lists']);
  // The graph is built and the channel answers: the line is about the list, not
  // about whether the plugin works.
  const answer = await subscribed(options, 'x-notes://all');
  expect(answer['result']).toMatchObject({ snapshot: { state: { items: ['one'] } } });
});

it('says nothing once the plugin registers the subject its channel asks for', async () => {
  const { options, problems } = folded((host) => {
    host.registerGrants('notes', { operations: ['pin'] });
    host.registerChannel('x-notes', { grant: 'notes:read', snapshot: () => ({ items: ['one'] }) });
  });

  // `notes` has an entry now, and `read` is one of its groups.
  expect(problems).toEqual([]);
  expect((await subscribed(options, 'x-notes://all'))['result']).toMatchObject({ snapshot: { state: { items: ['one'] } } });
});

it('lists a method\'s grant when the table has the subject, and when the grant is a group of every subject', () => {
  const listed = folded((host) => {
    host.registerChannel('x-notes', { grant: 'notes:read', snapshot: () => ({}) });
    host.registerGrants('notes', { operations: ['pin'] });
    host.registerMethod('x-demo/session', { grant: 'session:list', handle: () => ({ ok: true }) });
    host.registerMethod('x-demo/everything', { grant: '*:read', handle: () => ({ ok: true }) });
    host.registerMethod('x-demo/any', { grant: '*:*', handle: () => ({ ok: true }) });
  });

  expect(listed.problems).toEqual([]);
  expect(Object.keys(listed.options.methods ?? {}).sort()).toEqual(['x-demo/any', 'x-demo/everything', 'x-demo/session']);
});

it('reports a tunnel kind operation\'s own grant by the same list', () => {
  const kind = (grant: string) => ({
    name: 'notes-tunnel',
    title: 'Notes tunnel',
    description: 'A tunnel that carries notes.',
    schema: { type: 'object' },
    create: async () => {},
    remove: async () => {},
    invoke: async () => {},
    operations: [{ id: 'pin', label: 'Pin', grant }],
  });

  const missing = folded((host) => {
    host.registerChannel('x-notes', { grant: 'session:read', snapshot: () => ({}) });
    host.registerTunnelKind(kind('notes:pin'));
  });
  expect(missing.problems).toEqual(['plugin demo requires notes:pin, which no entry of ahpd.grants lists']);

  const named = folded((host) => {
    host.registerGrants('notes', { operations: ['pin'] });
    host.registerChannel('x-notes', { grant: 'notes:read', snapshot: () => ({}) });
    host.registerTunnelKind(kind('notes:pin'));
  });
  expect(named.problems).toEqual([]);
});

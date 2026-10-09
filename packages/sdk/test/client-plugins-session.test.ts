import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../src/host.js';
import { clientPluginsIn } from '../src/clientplugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * The plugins a client hands a session.
 *
 * A client contributes more than tools: it announces plugins, which live on
 * its machine and which a backend running here can only open once they are
 * here. So the host copies each one and reports it on the session, and what is
 * checked here is the reporting - that a subscriber watches one arrive as
 * `loading` and settle as `loaded` or `error`, that the backend's own
 * customizations are still in the same list, and that a plugin goes when the
 * client that handed it over does.
 *
 * The client side is a fake peer answering the two `resource*` methods a copy
 * is made of, over a directory tree held in memory.
 */

const URI = 'ahp-session:/plugins';
const PLUGIN = 'virtual://plugin/one';
const OTHER = 'virtual://plugin/two';

/** The plugin's own tree: a manifest at the root and a file under a directory. */
const TREE: Record<string, string> = {
  [`${PLUGIN}/plugin.json`]: '{"name":"one"}',
  [`${PLUGIN}/agents/one.md`]: 'agent one',
};

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** What a client would list for one URI, worked out from the tree it holds. */
const listing = (uri: string, tree: Record<string, string>): unknown => {
  const prefix = uri.endsWith('/') ? uri : `${uri}/`;
  const entries: { name: string; type: string }[] = [];
  for (const path of Object.keys(tree)) {
    if (!path.startsWith(prefix)) continue;
    const rest = path.slice(prefix.length);
    const slash = rest.indexOf('/');
    const name = slash === -1 ? rest : rest.slice(0, slash);
    if (entries.some((one) => one.name === name)) continue;
    entries.push({ name, type: slash === -1 ? 'file' : 'directory' });
  }
  return { entries };
};

function peer(tree: Record<string, string>, gone: Set<string> = new Set()): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async (method: string, params: unknown) => {
      const uri = String((params as { uri?: unknown }).uri ?? '');
      if (gone.has(uri)) throw new Error(`${uri} is not there`);
      if (method === 'resourceList') return listing(uri, tree);
      if (method === 'resourceRead') {
        const data = tree[uri];
        if (data === undefined) throw new Error(`${uri} is not there`);
        return { data, encoding: 'utf-8' };
      }
      return {};
    },
    answered: () => {},
    close: () => {},
  };
}

/** One host, its own directory, and the calls its backend took to switch a customization. */
function serving(withPort = true) {
  const dir = mkdtempSync(join(tmpdir(), 'ahpd-client-plugins-'));
  dirs.push(dir);
  const toggled: { id: string; enabled: boolean }[] = [];
  const base = echo({ path: dir, pace: 0 });
  const agent: Agent = {
    ...base,
    create: (start) => {
      const session = base.create(start);
      session.setCustomizationEnabled = (id, enabled) => {
        toggled.push({ id, enabled });
        return Promise.resolve(false);
      };
      return session;
    },
  };
  let served: ReturnType<typeof createHost>;
  served = createHost({
    path: dir,
    agents: [agent],
    ...(withPort ? { clientPlugins: clientPluginsIn(join(dir, 'copies'), () => served.clients) } : {}),
  });
  return { served, dir, toggled };
}

async function joins(held: ReturnType<typeof serving>['served'], clientId: string, tree: Record<string, string> = {}, gone?: Set<string>) {
  const p = peer(tree, gone);
  const client = held.accept(p);
  // The old version on purpose: this host gates no action by the version a
  // connection agreed, so everything said here is also what a `0.9.0` client
  // reads - including the `session/customizationUpdated` a client plugin
  // arrives on.
  await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'] } });
  return { client, peer: p };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((n) => n.channel === channel)
  .map((n) => n.action);

/* A copy is a client's whole plugin tree read over its connection, so each
 * step is a promise this host waits on. Six turns of the loop is enough for a
 * tree this small. */
const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A session with one client watching it, joined before anything is announced. */
async function session(held: ReturnType<typeof serving>['served'], id = 'watcher') {
  const a = await joins(held, id);
  // The probe that seeds the session with the backend's own customizations is
  // fire and forget, and a session made before it lands is one with none.
  await settle();
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  return a;
}

const announce = (
  client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> },
  customizations: unknown[],
  tools: { name: string }[] = [],
) => client.handle({
  method: 'dispatchAction',
  params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { customizations, tools } } },
});

const names = (one: Record<string, unknown>) => one.type;

it('watches a client plugin load, then reports it beside the backend\'s own', async () => {
  const { served } = serving();
  const a = await session(served);
  const b = await joins(served, 'plugin', TREE);
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });

  await announce(b.client, [{ type: 'plugin', uri: PLUGIN, nonce: 'n1', name: 'one' }]);
  await settle();

  const said = actions(a.peer, URI);
  const updated = said.filter((one) => one.type === 'session/customizationUpdated')
    .map((one) => one.customization as Record<string, unknown>);
  // The whole of a load: it is here before it is copied, because a copy is a
  // client's tree read over its connection and the session must not sit empty
  // while that happens.
  expect(updated.map((one) => (one.load as { kind: string }).kind)).toEqual(['loading', 'loaded']);
  expect(updated.map((one) => one.clientId)).toEqual(['plugin', 'plugin']);
  expect(updated[1]).toMatchObject({ type: 'plugin', uri: PLUGIN, name: 'one', clientId: 'plugin', load: { kind: 'loaded' } });

  // And the list, once, after the copy settled - the backend's own entries
  // first, this host's after them.
  const changed = said.filter((one) => one.type === 'session/customizationsChanged');
  expect(changed).toHaveLength(1);
  const listed = changed[0]?.customizations as Record<string, unknown>[];
  expect(listed.map(names)).toContain('plugin');
  expect(listed[listed.length - 1]).toMatchObject({ uri: PLUGIN, clientId: 'plugin' });
  expect(listed.some((one) => one.type !== 'plugin')).toBe(true);
});

it('says nothing when the same plugin at the same revision is announced again', async () => {
  const { served } = serving();
  const a = await session(served);
  const b = await joins(served, 'plugin', TREE);
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });
  const one = { type: 'plugin', uri: PLUGIN, nonce: 'n1' };
  await announce(b.client, [one]);
  await settle();
  const before = actions(a.peer, URI).filter((action) => String(action.type).startsWith('session/customization')).length;

  // A second announcement that carries something new, so it is answered by
  // this host rather than dropped as a repeat of the last one - and the plugin
  // in it is still what is already on disk.
  await announce(b.client, [one], [{ name: 'openFile' }]);
  await settle();

  const after = actions(a.peer, URI).filter((action) => String(action.type).startsWith('session/customization'));
  expect(after).toHaveLength(before);
});

it('reports the reason a plugin ends in error rather than a list that never settles', async () => {
  const { served } = serving();
  const a = await session(served);
  // One of the two cannot be read, and the other can: a client's tree with a
  // hole in it is that plugin's failure and nobody else's.
  const b = await joins(served, 'plugin', TREE, new Set([OTHER]));
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });

  await announce(b.client, [
    { type: 'plugin', uri: PLUGIN, nonce: 'n1' },
    { type: 'plugin', uri: OTHER, nonce: 'n1' },
  ]);
  await settle();

  const settled = actions(a.peer, URI)
    .filter((one) => one.type === 'session/customizationUpdated')
    .map((one) => one.customization as Record<string, unknown>)
    .filter((one) => (one.load as { kind: string }).kind !== 'loading');
  expect(settled.find((one) => one.uri === PLUGIN)?.load).toEqual({ kind: 'loaded' });
  expect(settled.find((one) => one.uri === OTHER)?.load)
    .toEqual({ kind: 'error', message: `${OTHER} is not there` });
});

it('says a host with nowhere to put a copy keeps no client plugins', async () => {
  const { served } = serving(false);
  const a = await session(served);
  const b = await joins(served, 'plugin', TREE);
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });

  await announce(b.client, [{ type: 'plugin', uri: PLUGIN, nonce: 'n1' }]);
  await settle();

  const settled = actions(a.peer, URI)
    .filter((one) => one.type === 'session/customizationUpdated')
    .map((one) => one.customization as Record<string, unknown>);
  // One entry, and it is already the answer. A host with no port cannot say
  // `loading` and mean it - there is nothing on its way.
  expect(settled).toHaveLength(1);
  expect(settled[0]?.load).toEqual({ kind: 'error', message: 'this host keeps no client plugins' });
});

it('answers a toggle on a client plugin itself, and never asks the backend', async () => {
  const { served, toggled } = serving();
  const a = await session(served);
  const b = await joins(served, 'plugin', TREE);
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });
  await announce(b.client, [{ type: 'plugin', uri: PLUGIN, nonce: 'n1' }]);
  await settle();

  b.client.handle({
    method: 'dispatchAction',
    params: {
      channel: URI,
      action: { type: 'session/customizationToggled', id: `plugin|${PLUGIN}`, enablement: [{ kind: 'session', enabled: false }] },
    },
  });
  await settle();

  // Still on the list, with the decision on it: switching one off is not
  // throwing it away, and a client that did it has to be able to undo it.
  const last = actions(a.peer, URI)
    .filter((one) => one.type === 'session/customizationUpdated')
    .map((one) => one.customization as Record<string, unknown>)
    .findLast((one) => one.uri === PLUGIN);
  expect(last?.enablement).toEqual([{ kind: 'session', enabled: false }]);
  // The backend has never heard of this customization, so it is not asked
  // about one - and answering a toggle itself is the whole of the difference.
  expect(toggled).toEqual([]);
});

it('takes a client\'s plugins away with the client', async () => {
  const { served } = serving();
  const a = await session(served);
  const b = await joins(served, 'plugin', TREE);
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });
  await announce(b.client, [{ type: 'plugin', uri: PLUGIN, nonce: 'n1' }]);
  await settle();

  const listed = () => actions(a.peer, URI)
    .filter((one) => one.type === 'session/customizationsChanged')
    .map((one) => (one.customizations as Record<string, unknown>[]).map(names));
  expect(listed().at(-1)).toContain('plugin');

  b.client.handle({ method: 'unsubscribe', params: { channel: URI } });
  await settle();

  // The plugin is one client's, and it goes when that client does - which is
  // also the only thing that can still reach the files it was copied from.
  expect(listed().at(-1)).not.toContain('plugin');
});

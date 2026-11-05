import { describe, expect, it } from 'vitest';
import { createHost, ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { fileResources } from '../src/resources/resources.js';
import { sdkVersion } from '../src/version.js';
import { echo } from '../../../examples/echo/agent.js';
import type { CanvasState } from '@microsoft/agent-host-protocol';
import { memorySessions } from '../src/sessions/sessions.js';
import type { Agent } from '../src/types/agent.js';
import type { LoaderContext, PluginHost } from '../src/types/plugin.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * A plugin's three canvas calls.
 *
 * Each one reaches the host's canvas store through the entry the fold carries,
 * so what a plugin opens is what a client subscribes to. A plugin host on its
 * own refuses the calls by name, and the key `canvasesEnabled` decides whether
 * the store takes them at all.
 */

const DIR = '/tmp/plugin-canvases';

const STATE: CanvasState = {
  instanceId: 'board-1',
  extensionId: 'com.brbyte.canvas',
  canvasId: 'board',
  extensionName: 'Canvas',
  title: 'Board',
  status: 'ready',
  url: 'https://canvas.test/board',
};

const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: () => {}, say: () => {},
});

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** What a window does to turn canvases on or off, as it pushes the key. */
const canvases = (client: Client, on: boolean): Promise<unknown> => client.handle({
  method: 'dispatchAction',
  params: { channel: ROOT, action: { type: 'root/configChanged', config: { canvasesEnabled: on } } },
});

/** A host with plugins folded over it, one live session, and the client watching it. */
async function made({ count = 1, on = false }: { count?: number; on?: boolean } = {}) {
  const plugins = Array.from({ length: count }, (_, at) => pluginHost(at === 0 ? 'board' : `other${at}`, context()));
  const { options } = foldHostOptions({
    path: DIR,
    agents: [echo({ path: DIR, pace: 0 })],
    resources: fileResources(),
  }, plugins.map((one) => one.contribution));
  const host = createHost(options);
  const client = host.accept(peer());
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['1.0.0'], initialSubscriptions: [ROOT] },
  });
  if (on) await canvases(client, true);
  const uri = 'ahp-session:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const state = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chat = state.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  const hosts = plugins.map((one) => one.host);
  return { client, chat, hosts, closers: plugins.map((one) => one.contribution.closers) };
}

/** What one call refused with. */
const refused = async (call: () => Promise<unknown>): Promise<string> => {
  try {
    await call();
  }
  catch (error) {
    return (error as Error).message;
  }
  throw new Error('the call was not refused');
};

/** A chat's state, as a subscribe answers it. */
const chatState = async (client: Client, chat: string) =>
  (await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
    snapshot: { state: Record<string, unknown> };
  }).snapshot.state;

/** A canvas's state, as a subscribe answers it. */
const canvasState = async (client: Client, resource: string) =>
  (await client.handle({ method: 'subscribe', params: { channel: resource } }) as {
    snapshot: { state: CanvasState };
  }).snapshot.state;

describe('before a host is built', () => {
  it('refuses each call by name', async () => {
    const { host } = pluginHost('board', context());
    await expect(host.openCanvas('ahp-chat:/c', STATE)).rejects.toThrow('plugin board: openCanvas needs the canvas to be opened once a host is built over this plugin');
    expect(() => host.updateCanvas('ahp-canvas:/x', STATE)).toThrow('plugin board: updateCanvas needs the canvas to be drawn once a host is built over this plugin');
    expect(() => host.closeCanvas('ahp-canvas:/x')).toThrow('plugin board: closeCanvas needs ahp-canvas:/x to be closed once a host is built over this plugin');
  });
});

describe('canvasesEnabled', () => {
  it('is off until a window turns it on', async () => {
    const { hosts, chat } = await made();
    await expect((hosts[0] as PluginHost).openCanvas(chat, STATE)).rejects.toThrow('Canvases are disabled.');
  });

  it('lets the three calls through when it is on', async () => {
    const { hosts, client, chat } = await made({ on: true });
    const plugin = hosts[0] as PluginHost;
    const resource = await plugin.openCanvas(chat, STATE);
    expect(resource.startsWith('ahp-canvas:/')).toBe(true);

    const listed = await chatState(client, chat);
    expect(listed.canvases).toEqual([{ resource }]);
    expect(await canvasState(client, resource)).toEqual(STATE);
    expect(() => plugin.closeCanvas(resource)).not.toThrow();
  });
});

describe('a client that agreed 0.9.0', () => {
  /*
   * A canvas's actions are 0.10.0's, so they are held back from it - and from
   * it again once it comes back, as VS Code's host keeps the version a client
   * agreed for the connection it reconnects on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1351-L1362
   */
  it('is sent no canvas action after it comes back, as before it went, as VS Code\'s host', async () => {
    const plugins = [pluginHost('board', context())];
    const { options } = foldHostOptions({
      path: DIR,
      agents: [echo({ path: DIR, pace: 0 })],
      resources: fileResources(),
    }, plugins.map((one) => one.contribution));
    const host = createHost(options);
    const notes: { method: string; params: { action?: { type?: string } } }[] = [];
    const listening = (): Peer => ({
      send: () => {}, notify: (method, params) => { notes.push({ method, params: params as { action?: { type?: string } } }); },
      request: async () => ({}), answered: () => {}, close: () => {},
    });
    const first = host.accept(listening());
    await first.handle({ method: 'initialize', params: { clientId: 'older', protocolVersions: ['0.9.0'], initialSubscriptions: [ROOT] } });
    await canvases(first, true);
    await first.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'echo' } });
    const opened = await first.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const chat = opened.snapshot.state.defaultChat;
    await first.handle({ method: 'subscribe', params: { channel: chat } });
    const plugin = plugins[0]?.host as PluginHost;
    const shown = (): unknown[] => notes.filter((one) => one.method === 'action' && one.params.action?.type === 'chat/canvasesChanged');
    await plugin.openCanvas(chat, STATE);
    expect(shown()).toEqual([]);

    first.close();
    const back = host.accept(listening());
    const replayed = await back.handle({
      method: 'reconnect', params: { channel: ROOT, clientId: 'older', lastSeenServerSeq: 0, subscriptions: [ROOT, chat] },
    }) as { type: string; actions?: { action: { type: string } }[] };
    expect((replayed.actions ?? []).filter((one) => one.action.type === 'chat/canvasesChanged')).toEqual([]);
    await plugin.openCanvas(chat, { ...STATE, instanceId: 'board-2' });
    expect(shown()).toEqual([]);
  });
});

describe('a state a plugin gives', () => {
  it('is replaced whole, and a state without a url is sent without one', async () => {
    const { hosts, client, chat } = await made({ on: true });
    const plugin = hosts[0] as PluginHost;
    const resource = await plugin.openCanvas(chat, STATE);
    const { url: _url, ...without } = STATE;
    plugin.updateCanvas(resource, { ...without, title: 'Drawn again' });

    const state = await canvasState(client, resource);
    expect(state.title).toBe('Drawn again');
    expect(Object.hasOwn(state, 'url')).toBe(false);
  });

  it('needs an instanceId, an extensionId and a canvasId', async () => {
    const { hosts, chat } = await made({ on: true });
    const plugin = hosts[0] as PluginHost;
    for (const member of ['instanceId', 'extensionId', 'canvasId'] as const) {
      expect(await refused(() => plugin.openCanvas(chat, { ...STATE, [member]: '' })))
        .toBe(`plugin board: openCanvas needs state.${member} to be a non-empty string`);
    }
  });

  it('needs a url that is absolute http(s), and the url is not in the sentence', async () => {
    const { hosts, chat } = await made({ on: true });
    const plugin = hosts[0] as PluginHost;
    for (const url of ['board/1', 'file:///board', 'ftp://canvas.test/board', 'https://']) {
      const message = await refused(() => plugin.openCanvas(chat, { ...STATE, url }));
      expect(message).toBe('plugin board: openCanvas needs state.url to be an absolute http(s) URL with a host');
      expect(message).not.toContain(url);
    }
  });

  /*
   * A name no session holds as a chat is refused in the reference host's
   * words for a canvas operation on a chat outside its session.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6643-L6648
   */
  it('cannot be drawn on a chat no session holds', async () => {
    const { hosts, chat } = await made({ on: true });
    const plugin = hosts[0] as PluginHost;
    await expect(plugin.openCanvas('ahp-session:/one', STATE)).rejects.toThrow("Canvas operation targeted a chat outside session 'ahp-session:/one'.");
    await expect(plugin.openCanvas('ahp-chat:/nobody', STATE)).rejects.toThrow("Canvas operation targeted a chat outside session 'ahp-chat:/nobody'.");
    await expect(plugin.openCanvas(chat, STATE)).resolves.toMatch(/^ahp-canvas:/);
  });
});

describe('a chat whose session sleeps', () => {
  /*
   * Woken with its session before a canvas opens on it, as the reference
   * restores a session's chat before a canvas operation.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6601-L6604
   */
  it('is woken with its session, and the canvas opens on it', async () => {
    const plugin = pluginHost('board', context());
    const base = echo({ path: DIR, pace: 0 });
    let starts = 0;
    let closes = 0;
    const counted: Agent = {
      ...base,
      create: (start) => {
        starts += 1;
        const session = base.create(start);
        return { ...session, close: (reason) => { closes += 1; return session.close(reason); } };
      },
    };
    const { options } = foldHostOptions({
      path: DIR,
      agents: [counted],
      resources: fileResources(),
      sessions: memorySessions(),
      sessionResidencyLimit: 1,
    }, [plugin.contribution]);
    const client = createHost(options).accept(peer());
    await client.handle({
      method: 'initialize',
      params: { clientId: 'probe', protocolVersions: ['1.0.0'], initialSubscriptions: [ROOT] },
    });
    await canvases(client, true);
    const opened = async (name: string): Promise<string> => {
      const uri = `ahp-session:/${name}`;
      await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
      const chat = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { defaultChat: string } };
      }).snapshot.state.defaultChat;
      await client.handle({
        method: 'dispatchAction',
        params: { channel: chat, action: { type: 'chat/turnStarted', turnId: `${name}-1`, startedAt: new Date().toISOString(), message: { text: 'hello', origin: { kind: 'user' } } } },
      });
      for (let tries = 0; tries < 200 && ((await chatState(client, chat)).turns as unknown[]).length === 0; tries += 1) {
        await new Promise((r) => { setTimeout(r, 1); });
      }
      await client.handle({ method: 'unsubscribe', params: { channel: chat } });
      await client.handle({ method: 'unsubscribe', params: { channel: uri } });
      return chat;
    };
    const first = await opened('one');
    await opened('two');
    for (let tries = 0; tries < 200 && closes === 0; tries += 1) await new Promise((r) => { setTimeout(r, 1); });
    expect(closes).toBe(1);

    const resource = await plugin.host.openCanvas(first, STATE);
    expect(starts).toBe(3);
    expect((await chatState(client, first)).canvases).toEqual([{ resource }]);
    expect(await canvasState(client, resource)).toEqual(STATE);
  });
});

describe('a canvas another plugin opened', () => {
  it('is refused to update and to close', async () => {
    const { hosts, chat } = await made({ count: 2, on: true });
    const [board, other] = hosts as [PluginHost, PluginHost];
    const resource = await board.openCanvas(chat, STATE);
    expect(() => other.updateCanvas(resource, STATE)).toThrow('was opened by board');
    expect(() => other.closeCanvas(resource)).toThrow('was opened by board');
    expect(() => board.closeCanvas(resource)).not.toThrow();
  });
});

describe('closeCanvas', () => {
  it('does nothing the second time, and the chat lists none', async () => {
    const { hosts, client, chat } = await made({ on: true });
    const plugin = hosts[0] as PluginHost;
    const resource = await plugin.openCanvas(chat, STATE);
    plugin.closeCanvas(resource);
    expect(() => plugin.closeCanvas(resource)).not.toThrow();
    expect(Object.hasOwn(await chatState(client, chat), 'canvases')).toBe(false);
  });
});

describe('the closer a plugin gains', () => {
  it('is absent until it opens a canvas, and there is one however many it opens', async () => {
    const { hosts, closers, chat } = await made({ on: true });
    expect(closers[0]).toEqual([]);
    const plugin = hosts[0] as PluginHost;
    await plugin.openCanvas(chat, STATE);
    await plugin.openCanvas(chat, { ...STATE, instanceId: 'board-2', canvasId: 'board-2' });
    expect(closers[0]).toHaveLength(1);
  });
});

describe('an unload', () => {
  it('closes the canvases the plugin still had open', async () => {
    const { hosts, closers, client, chat } = await made({ on: true });
    const resource = await (hosts[0] as PluginHost).openCanvas(chat, STATE);
    // What the daemon does to a plugin it unloads while it runs.
    for (const close of closers[0] ?? []) await close();

    expect(Object.hasOwn(await chatState(client, chat), 'canvases')).toBe(false);
    await expect(client.handle({ method: 'subscribe', params: { channel: resource } }))
      .rejects.toMatchObject({ code: -32008 });
  });

  it('closes them while the key is off, because it is the host\'s own road', async () => {
    const { hosts, closers, client, chat } = await made({ on: true });
    const resource = await (hosts[0] as PluginHost).openCanvas(chat, STATE);
    await canvases(client, false);
    // A call is refused while the key is off, and the host's own road is not.
    expect(() => (hosts[0] as PluginHost).closeCanvas(resource)).toThrow('Canvases are disabled.');
    for (const close of closers[0] ?? []) await close();
    expect(Object.hasOwn(await chatState(client, chat), 'canvases')).toBe(false);
  });
});

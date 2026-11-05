import { describe, expect, it } from 'vitest';
import { ROOT } from '../src/host.js';
import { createCanvases } from '../src/host/canvases.js';
import { canvasResource, chatOfCanvas } from '../src/host/channels.js';
import { call, directory, hello, host, peer, signIn, watching } from './users-gate-helpers.js';
import type { CanvasState } from '@microsoft/agent-host-protocol';
import type { ServedCanvases } from '../src/types/plugin.js';

/*
 * The canvases of a chat.
 *
 * A plugin opens one with a live URL, and the chat's state lists it. The store
 * is what holds the state, says the two actions, and answers an `ahp-canvas:`
 * channel; the chat's own removal and move roads are what take it away again.
 */

const STATE: CanvasState = {
  instanceId: 'board-1',
  extensionId: 'com.brbyte.canvas',
  canvasId: 'board',
  extensionName: 'Canvas',
  title: 'Board',
  status: 'ready',
  url: 'https://canvas.test/board',
};

/** A chat name, for the store's own cases, which need no session. */
const CHAT = 'ahp-chat://default/YWhwLXNlc3Npb246L29uZQ';

/** A store, and every action it said, over chats that are all live. */
const recording = (holds: boolean | (() => boolean) = true, enabled = true) => {
  const said: { channel: string; action: Record<string, unknown> }[] = [];
  const store = createCanvases({
    dispatch: (channel, action) => { said.push({ channel, action }); },
    holds: typeof holds === 'function' ? holds : () => holds,
    restore: async () => {},
    enabled: () => enabled,
  });
  return { store, said };
};

/** The three calls the host fills in on a plugin's entry. */
const wired = (served: ServedCanvases) => {
  if (served.open === undefined || served.update === undefined || served.close === undefined)
    throw new Error('the host filled no canvas calls in');
  return { open: served.open, update: served.update, close: served.close };
};

type Client = ReturnType<ReturnType<typeof host>['accept']>;

/** What a window pushes to let the host serve canvases, which is off by default. */
const canvasesOn = (client: Client) => client.handle({
  method: 'dispatchAction',
  params: { channel: ROOT, action: { type: 'root/configChanged', config: { canvasesEnabled: true } } },
});

/** A client that agreed on `1.0.0`, which is the version canvases arrive at. */
const at = async (made: ReturnType<typeof host>, clientId: string): Promise<{ client: Client; seen: ReturnType<typeof watching> }> => {
  const seen = watching();
  const client = made.accept(seen);
  await client.handle({
    method: 'initialize',
    params: { channel: ROOT, clientId, protocolVersions: ['1.0.0'], initialSubscriptions: [ROOT] },
  });
  await canvasesOn(client);
  return { client, seen };
};

/** One session under `uri`, and the client watching its default chat. */
const sessionAt = async (client: Client, uri = 'ahp-session:/one'): Promise<string> => {
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'base' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chat = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  return chat;
};

/** A host with one plugin that may open canvases. */
const withCanvases = (over: Parameters<typeof host>[0] = {}) => {
  const served: ServedCanvases = { by: 'fixture' };
  const made = host({ pluginCanvases: [served], ...over });
  return { made, served, calls: wired(served) };
};

/** A subscribe to a canvas, which a gone one refuses. */
const refusedCanvas = (client: Client, resource: string) =>
  expect(client.handle({ method: 'subscribe', params: { channel: resource } }))
    .rejects.toMatchObject({ code: -32008, message: `Canvas is no longer available: ${resource}` });

describe('the store', () => {
  it('answers a canvas before the chat that lists it, and lists the whole of them', async () => {
    const { store, said } = recording();
    const resource = await store.open(CHAT, STATE, 'fixture');
    // The name carries the chat in base64url, so it reads back to the chat.
    expect(resource.startsWith(canvasResource(CHAT, ''))).toBe(true);
    expect(chatOfCanvas(resource)).toBe(CHAT);
    expect(said.map((one) => one.action.type)).toEqual(['canvas/stateChanged', 'chat/canvasesChanged']);
    expect(said[0]!.channel).toBe(resource);
    expect(said[0]!.action.canvas).toEqual(STATE);
    expect(said[1]!.channel).toBe(CHAT);
    expect(said[1]!.action.canvases).toEqual([{ resource }]);
  });

  it('draws an instance again on the channel it already has, and says no new list', async () => {
    const { store, said } = recording();
    const first = await store.open(CHAT, STATE, 'fixture');
    const again = await store.open(CHAT, { ...STATE, title: 'Drawn again' }, 'fixture');
    expect(again).toBe(first);
    expect(said.map((one) => one.action.type)).toEqual(['canvas/stateChanged', 'chat/canvasesChanged', 'canvas/stateChanged']);
    expect(store.snapshot(first)).toMatchObject({ title: 'Drawn again' });
  });

  /*
   * An instance opened again as it is says nothing, as the reference's
   * projection keeps a canvas it already shows.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L5196-L5210
   */
  it('says nothing for an instance opened again as it is', async () => {
    const { store, said } = recording();
    const first = await store.open(CHAT, STATE, 'fixture');
    const before = said.length;
    expect(await store.open(CHAT, { ...STATE }, 'fixture')).toBe(first);
    expect(said.slice(before)).toEqual([]);
  });

  /*
   * The chat is brought back before anything opens on it, as the reference
   * restores a session's chat before a canvas operation, and a chat the
   * restore cannot bring back opens nothing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6601-L6604
   */
  it('brings the chat back before it opens a canvas on it, and opens nothing on a chat that cannot be', async () => {
    const said: string[] = [];
    let back = false;
    const store = createCanvases({
      dispatch: (_channel, action) => { said.push(String(action.type)); },
      holds: () => back,
      restore: async (chat) => {
        if (chat !== CHAT) throw new Error(`Canvas operation targeted a chat outside session '${chat}'.`);
        said.push('restored');
        back = true;
      },
      enabled: () => true,
    });
    await store.open(CHAT, STATE, 'fixture');
    expect(said).toEqual(['restored', 'canvas/stateChanged', 'chat/canvasesChanged']);
    await expect(store.open('ahp-chat:/nobody', STATE, 'fixture')).rejects.toThrow("Canvas operation targeted a chat outside session 'ahp-chat:/nobody'.");
    expect(said).toHaveLength(3);
  });

  it('takes a canvas off its chat, and says the list is absent when it was the last one', async () => {
    const { store, said } = recording();
    const resource = await store.open(CHAT, STATE, 'fixture');
    store.close(resource, 'fixture');
    expect(store.snapshot(resource)).toBeUndefined();
    expect(store.listOf(CHAT)).toBeUndefined();
    const last = said.at(-1);
    expect(last?.channel).toBe(CHAT);
    expect(last?.action.type).toBe('chat/canvasesChanged');
    // The protocol's absence-means-none: the key is there and carries nothing.
    expect(Object.hasOwn(last?.action ?? {}, 'canvases')).toBe(true);
    expect(last?.action.canvases).toBeUndefined();
  });

  /*
   * The reference installs and says a canvas's state only when it is not the
   * one it holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1192-L1197
   */
  it('says nothing for an update that leaves the state as it was, and says one that moves it', async () => {
    const { store, said } = recording();
    const resource = await store.open(CHAT, STATE, 'fixture');
    const before = said.length;
    store.update(resource, { ...STATE }, 'fixture');
    expect(said.slice(before)).toEqual([]);
    store.update(resource, { ...STATE, title: 'Board, moved' }, 'fixture');
    expect(said.slice(before)).toEqual([
      { channel: resource, action: { type: 'canvas/stateChanged', canvas: { ...STATE, title: 'Board, moved' } } },
    ]);
  });

  /*
   * The reference asks whether canvases are served before it looks for
   * anything to close.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6615-L6621
   */
  it('refuses a close while canvases are off, though nothing is open under the name', () => {
    const { store } = recording(true, false);
    expect(() => store.close(canvasResource(CHAT, 'gone'), 'fixture')).toThrow('Canvases are disabled.');
  });

  it('refuses an update or a close from a plugin that did not open the canvas', async () => {
    const { store } = recording();
    const resource = await store.open(CHAT, STATE, 'one');
    expect(() => store.update(resource, STATE, 'two')).toThrow('was opened by one');
    expect(() => store.close(resource, 'two')).toThrow('was opened by one');
    expect(store.snapshot(resource)).toEqual(STATE);
  });

  it('tells a chat that moved that its list is empty, and says nothing to one that is gone', async () => {
    const moved = recording(true);
    const resource = await moved.store.open(CHAT, STATE, 'fixture');
    moved.store.forgetChat(CHAT);
    expect(moved.store.snapshot(resource)).toBeUndefined();
    const last = moved.said.at(-1);
    expect(last?.channel).toBe(CHAT);
    expect(Object.hasOwn(last?.action ?? {}, 'canvases')).toBe(true);
    expect(last?.action.canvases).toBeUndefined();

    // The chat was live when the plugin opened, and is gone when it is forgotten.
    let live = true;
    const gone = recording(() => live);
    await gone.store.open(CHAT, STATE, 'fixture');
    live = false;
    const before = gone.said.length;
    gone.store.forgetChat(CHAT);
    expect(gone.said).toHaveLength(before);
  });
});

describe('a chat\'s snapshot', () => {
  it('lists its canvas, and has no field at all once the canvas closes', async () => {
    const { made, calls } = withCanvases();
    const { client } = await at(made, 'canvas');
    const chat = await sessionAt(client);
    const resource = await calls.open(chat, STATE);

    const listed = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    expect(listed.snapshot.state.canvases).toEqual([{ resource }]);

    calls.close(resource);
    const after = await client.handle({ method: 'subscribe', params: { channel: chat } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    expect(Object.hasOwn(after.snapshot.state, 'canvases')).toBe(false);
  });
});

describe('a subscribe to a canvas', () => {
  it('answers its state, and a canvas that closed is refused with -32008', async () => {
    const { made, calls } = withCanvases();
    const { client } = await at(made, 'canvas');
    const chat = await sessionAt(client);
    const resource = await calls.open(chat, STATE);

    const opened = await client.handle({ method: 'subscribe', params: { channel: resource } }) as {
      snapshot: { resource: string; state: CanvasState };
    };
    expect(opened.snapshot.resource).toBe(resource);
    expect(opened.snapshot.state).toEqual(STATE);

    calls.close(resource);
    await refusedCanvas(client, resource);
  });

  it('answers the same channel for an instance already open, and sends no second list', async () => {
    const { made, calls } = withCanvases();
    const { client, seen } = await at(made, 'canvas');
    const chat = await sessionAt(client);
    const lists = () => seen.seen
      .filter((one) => one.method === 'action' && one.params.action?.type === 'chat/canvasesChanged')
      .length;

    const first = await calls.open(chat, STATE);
    expect(lists()).toBe(1);
    expect(await calls.open(chat, { ...STATE, title: 'Drawn again' })).toBe(first);
    expect(lists()).toBe(1);
  });
});

describe('who may read a canvas', () => {
  it('is asked of the chat\'s session, and a guest who may read files only is refused', async () => {
    const { made, calls } = withCanvases({
      users: directory({ a: ['file:read', 'file:write', 'session:read', 'session:write', 'config:write'], g: ['file:read'] }),
    });
    const admin = made.accept(peer());
    await hello(admin, 'admin');
    await signIn(admin, 'a');
    // The key is the host's, so pushing it needs `config:write`.
    await canvasesOn(admin);
    await admin.handle({ method: 'createSession', params: { channel: 'ahp-session:/one', provider: 'base' } });
    const opened = await admin.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const resource = await calls.open(opened.snapshot.state.defaultChat, STATE);

    const guest = made.accept(peer());
    await hello(guest, 'guest');
    await signIn(guest, 'g');
    expect(await call(guest, 'subscribe', { channel: resource }))
      .toMatchObject({ code: -32009, message: expect.stringContaining('session:state') });
  });
});

describe('a canvas whose chat goes', () => {
  it('goes with the session the chat is in', async () => {
    const { made, calls } = withCanvases();
    const { client } = await at(made, 'canvas');
    const chat = await sessionAt(client);
    const resource = await calls.open(chat, STATE);

    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/one' } });
    await refusedCanvas(client, resource);
  });

  it('goes when its own chat is removed, and the session stays', async () => {
    const { made, calls } = withCanvases();
    const { client } = await at(made, 'canvas');
    await sessionAt(client);
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/one', chat: 'peer:/spare' } });
    const resource = await calls.open('peer:/spare', STATE);

    await client.handle({ method: 'disposeChat', params: { channel: 'peer:/spare' } });
    await refusedCanvas(client, resource);
  });

  it('goes when the chat moves, and the chat is told its list is now empty', async () => {
    const { made, calls } = withCanvases();
    const { client, seen } = await at(made, 'canvas');
    await sessionAt(client);
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/two', provider: 'base' } });
    await client.handle({ method: 'createChat', params: { channel: 'ahp-session:/one', chat: 'peer:/spare' } });
    await client.handle({ method: 'subscribe', params: { channel: 'peer:/spare' } });
    const resource = await calls.open('peer:/spare', STATE);

    await client.handle({
      method: 'moveChat',
      params: { channel: 'peer:/spare', destination: { kind: 'session', session: 'ahp-session:/two' } },
    });

    // The chat is still live in the session it moved to, so it is told.
    const lists = seen.seen.filter((one) => one.method === 'action'
      && one.params.channel === 'peer:/spare'
      && one.params.action?.type === 'chat/canvasesChanged');
    const last = lists.at(-1);
    expect(Object.hasOwn(last?.params.action ?? {}, 'canvases')).toBe(true);
    expect(last?.params.action.canvases).toBeUndefined();
    await refusedCanvas(client, resource);
  });
});

describe('a second client of the session', () => {
  it('is sent the canvas channel and the URL as they are', async () => {
    const { made, calls } = withCanvases();
    const first = await at(made, 'canvas');
    const chat = await sessionAt(first.client);

    const other = await at(made, 'second');
    const view = await other.client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/one' } }) as {
      snapshot: { state: { defaultChat: string } };
    };
    const theirChat = view.snapshot.state.defaultChat;
    await other.client.handle({ method: 'subscribe', params: { channel: theirChat } });

    const resource = await calls.open(chat, STATE);
    const lists = other.seen.seen.filter((one) => one.method === 'action' && one.params.action?.type === 'chat/canvasesChanged');
    expect(lists).toHaveLength(1);
    // Under the chat's one URI, and the resource untouched.
    expect(theirChat).toBe(chat);
    expect(lists[0]!.params.channel).toBe(theirChat);
    expect(lists[0]!.params.action.canvases).toEqual([{ resource }]);

    const opened = await other.client.handle({ method: 'subscribe', params: { channel: resource } }) as {
      snapshot: { state: CanvasState };
    };
    expect(opened.snapshot.state).toEqual(STATE);
    expect(opened.snapshot.state.url).toBe(STATE.url);
  });
});

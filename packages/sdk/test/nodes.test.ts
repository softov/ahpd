import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { echo } from '../../../examples/echo/agent.js';
import { createHost } from '../src/host.js';
import { listen } from '../src/listen.js';
import { fileNodes, JOIN_PATH, liveNodes } from '../src/nodes.js';
import { uriOf } from '../src/resources/fileuri.js';
import { createPeer, receive } from '../src/rpc.js';
import { fileSessions } from '../src/sessions/sessions.js';
import type { Agent } from '../src/types/agent.js';
import type { Host } from '../src/types/host.js';
import type { NodeChange } from '../src/types/host.js';
import type { Listener } from '../src/types/listen.js';
import type { Handler } from '../src/types/rpc.js';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * The hub's half of a join: who may dial the join path, what a node says when
 * it gets there, and the socket a session runs on.
 *
 * The node here is a real client of the hub's own listener - the same door, the
 * same frames - whose answer to `node/open` is an in-process `createHost` piped
 * to the data socket. So what crosses the wire is what `ahpd join` would put
 * there, without an ahpd spawned per session. What is under test is the
 * registry: that a node's token opens that path and nothing else, that a node
 * too old for a resume is turned away in a sentence, that a session in a node
 * is a `NestedHost` the proxy reads as a process, and that the folder the host
 * inside works in is the node's workdir rather than this host's.
 */

/** The deployment's own key: the hub's door for clients, and no node's. */
const HUB_TOKEN = 'hub-key';
/** The node this hub knows. */
const NODE = 'box';
/** The oldest ahpd a hub admits, and the hello's own id, which a refusal answers. */
const AHPD = '0.14.1';
const HELLO = 1;

type Bag = Record<string, any>;

/** What a case made, closed before its folder goes. */
const dirs: string[] = [];
const listeners: Listener[] = [];
const hosts: Host[] = [];
const sockets: WebSocket[] = [];

afterEach(async () => {
  // Sockets first: a hub closing behind a node that is still dialling waits on it.
  for (const socket of sockets.splice(0)) socket.close();
  for (const host of hosts.splice(0)) await host.close();
  for (const listener of listeners.splice(0)) await listener.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
});

/** Wait for something that happens asynchronously, without a fixed sleep. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

/** The chat the hub minted for a session, read off its state as a client reads it. */
const mintedChat = async (client: { handle(request: unknown): Promise<unknown> }, session: string): Promise<string> =>
  ((await client.handle({ method: 'subscribe', params: { channel: session } })) as { snapshot: { state: { defaultChat: string } } }).snapshot.state.defaultChat;

/** A client of the hub's session, which keeps what the host told it. */
const watching = (): { seen: { method: string; params: Bag }[]; send: () => void; request: () => Promise<object>; answered: () => void; notify: (method: string, params: unknown) => void; close: () => void } => {
  const seen: { method: string; params: Bag }[] = [];
  return {
    seen,
    send: () => {},
    request: async () => ({}),
    answered: () => {},
    close: () => {},
    notify: (method: string, params: unknown) => { seen.push({ method, params: params as Bag }); },
  };
};

/** Whether a socket opens, or the HTTP sentence that turned it away. */
const knock = (url: string): Promise<'open' | string> => new Promise((done) => {
  const socket = new WebSocket(url);
  socket.on('open', () => { socket.close(); done('open'); });
  socket.on('error', (error: Error) => done(error.message));
});

/**
 * A hub: the file of who may join, the registry of who has, and one host
 * behind a listener that hands a node's sockets to the registry.
 *
 * `restart` is what the hub's own option says a session on a node does when
 * that node's `ahpd join` restarts, and `reconnectMs` is how long the registry
 * waits for a node that is dialling again - short here, so a case about a node
 * that never comes back is a case and not a wait.
 *
 * `dir` is the folder a hub is started on. The sessions are kept on disk under
 * it, so a second hub started on the same folder is the same daemon after a
 * restart, reading the rows the first one wrote.
 */
const hubOf = async (options: { restart?: 'end' | 'reconnect'; dir?: string } = {}) => {
  const dir = options.dir ?? mkdtempSync(join(tmpdir(), 'ahpd-hub-'));
  dirs.push(dir);
  const folders = { hub: join(dir, 'hub'), node: join(dir, 'node') };
  mkdirSync(folders.hub, { recursive: true });
  mkdirSync(folders.node, { recursive: true });
  const nodes = fileNodes({ path: join(dir, 'users.nodes.json') });
  const token = await nodes.add(NODE);
  const registry = liveNodes({ file: nodes, reconnectMs: 300 });
  const agent: Agent = { ...echo({ path: folders.hub }), provider: 'echo', displayName: 'Echo' };
  const host = createHost({
    path: folders.hub,
    sessions: fileSessions({ dir: join(dir, 'sessions') }),
    agents: [agent],
    // The spec the node's host would load. This test's node never loads it:
    // what it holds is the same host, in this process.
    agentPlugins: { echo: '@ahpd/echo' },
    ...(options.restart === undefined ? {} : { nodeRestart: options.restart }),
    computers: {
      how: async () => ({ command: 'true', args: [] }),
      // A node dialled this hub, so its machine is not on this host and every
      // session in it runs nested.
      remote: () => true,
      connect: (id, asked) => registry.connect(id, asked),
    },
  });
  hosts.push(host);
  const listener = await listen(
    { port: 0, token: HUB_TOKEN, join: { path: JOIN_PATH, verify: (presented) => nodes.verify(presented) } },
    (peer, principal, root, where) => {
      if (where?.node === undefined) return host.accept(peer, principal, root);
      return registry.accept(where.node, peer, where.url);
    },
  );
  listeners.push(listener);
  return { dir, folders, nodes, token, registry, host, url: `ws://127.0.0.1:${String(listener.port)}` };
};

type Hub = Awaited<ReturnType<typeof hubOf>>;

/**
 * A host inside the node, whose frames cross the socket the hub named.
 *
 * The host is the node's, not the socket's: a socket is one connection to it,
 * and the session it holds outlives the connection, which is what a node
 * restart is - the socket goes, the transcript stays where the node keeps it.
 */
const servedHost = (host: Host, socket: WebSocket) => {
  const peer = createPeer({
    send: (text) => { socket.send(text); },
    close: () => { /* the hub closes the socket, which is what ends this side */ },
    isOpen: () => socket.readyState === WebSocket.OPEN,
  });
  const accepted = host.accept(peer);
  const handler: Handler = (request) => accepted.handle(request);
  const messages: Bag[] = [];
  return {
    messages,
    /** One line the hub sent the session's socket, as the host inside reads it. */
    heard: (line: string): void => {
      messages.push(JSON.parse(line) as Bag);
      receive(line, peer, handler);
    },
  };
};

/**
 * A node of the hub: one control socket, and one host of its own per session.
 *
 * It does what `ahpd join` does and nothing else - says `node/hello`, and
 * answers `node/open` by dialling the socket the hub named with the same token
 * - so what the hub reads here is what it reads from a node on another box.
 *
 * `host` is the node's own store, given when a case has to survive a restart:
 * a node that is started again serves the same transcripts, and this test's
 * node keeps them in one in-process host rather than in a file.
 */
const joinNode = (hub: Hub, options: { ahpd?: string; host?: Host } = {}) => {
  const agent: Agent = { ...echo({ path: hub.folders.node }), provider: 'echo', displayName: 'Echo' };
  const servedBy = options.host ?? createHost({ path: hub.folders.node, agents: [agent] });
  if (options.host === undefined) hosts.push(servedBy);
  const url = `${hub.url}${JOIN_PATH}?tkn=${hub.token}`;
  const control = new WebSocket(url);
  sockets.push(control);
  /** Every frame the hub answered this node's hello with. */
  const greeted: Bag[] = [];
  /** Every `node/open` the hub asked for. */
  const asked: Bag[] = [];
  /** Every session socket this node served, with the frames the host inside was sent. */
  const served: (ReturnType<typeof servedHost> & { socket: WebSocket })[] = [];
  const handle = async (raw: unknown): Promise<void> => {
    const frame = JSON.parse(String(raw)) as Bag;
    if (frame.method === undefined) { greeted.push(frame); return; }
    if (frame.method !== 'node/open') return;
    asked.push(frame);
    const id = (frame.params as Bag | undefined)?.id;
    if (typeof id !== 'string' || id === '') return;
    const socket = new WebSocket(`${url}&data=${encodeURIComponent(id)}`);
    sockets.push(socket);
    const inside = servedHost(servedBy, socket);
    served.push({ ...inside, socket });
    socket.on('message', (one) => {
      const line = String(one);
      if (line.trim() !== '') inside.heard(line);
    });
    await new Promise<void>((done, fail) => {
      socket.on('open', () => { done(); });
      socket.on('error', (error: Error) => { fail(error); });
    });
    // Answered once its socket is up, so the hub knows the session exists and
    // waits for it rather than asking again.
    control.send(JSON.stringify({ jsonrpc: '2.0', id: frame.id, result: { id } }));
  };
  control.on('open', () => {
    control.send(JSON.stringify({
      jsonrpc: '2.0',
      id: HELLO,
      method: 'node/hello',
      params: { versions: { ahpd: options.ahpd ?? AHPD, protocol: ['1.0.0'] }, workdir: hub.folders.node },
    }));
  });
  control.on('message', (raw) => { void handle(raw); });
  return { greeted, asked, served, control, store: servedBy };
};

/**
 * A window on the hub with one session in the node, and the turns it sends.
 *
 * `say` waits for the turn to end, so a case is a sequence of turns rather than
 * of sleeps. `said` is what the hub told the window, which is where a session
 * that ended is read. `turns` reads the conversation back as the hub holds it,
 * which is what says a resumed session still has what it had.
 */
const inNode = async (hub: Hub) => {
  const peer = watching();
  const client = hub.host.accept(peer);
  const uri = 'ahp-session:/on-the-node';
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({
    method: 'createSession',
    params: {
      channel: uri,
      provider: 'echo',
      config: { computer: `computer://${NODE}` },
      workingDirectories: [uriOf(hub.folders.hub)],
    },
  });
  const chat = await mintedChat(client, uri);
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  const said = (type: string): Bag[] => peer.seen
    .filter(({ params }) => params?.action?.type === type)
    .map(({ params }) => params.action as Bag);
  let seq = 0;
  const say = async (turnId: string, text: string): Promise<void> => {
    const before = said('chat/turnComplete').length;
    seq += 1;
    await client.handle({
      method: 'dispatchAction',
      params: { channel: chat, clientSeq: seq, action: { type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
    });
    await until(() => said('chat/turnComplete').length > before);
  };
  const turns = async (): Promise<string[]> => {
    const read = await client.handle({ method: 'subscribe', params: { channel: chat } }) as { snapshot: { state: Bag } };
    return ((read.snapshot.state.turns ?? []) as Bag[]).map((one) => String(one.id));
  };
  return { peer, client, uri, chat, said, say, turns };
};

it('a node token opens the join path and nothing else, and the deployment key is refused there', async () => {
  const hub = await hubOf();
  expect(await knock(`${hub.url}${JOIN_PATH}?tkn=${hub.token}`)).toBe('open');
  // The key that opens every client's door opens no node's.
  expect(await knock(`${hub.url}${JOIN_PATH}?tkn=${HUB_TOKEN}`)).toContain('401');
  // And a node's token is one path's, not a client's.
  expect(await knock(`${hub.url}/?tkn=${hub.token}`)).toContain('401');
  expect(await knock(`${hub.url}/?tkn=${HUB_TOKEN}`)).toBe('open');
});

it('a node older than 0.14.1 is refused at its hello, and one new enough is admitted with its folder', async () => {
  const old = await hubOf();
  const refused = joinNode(old, { ahpd: '0.14.0' });
  await until(() => refused.greeted.length > 0);
  expect(String(refused.greeted[0]?.error?.message)).toContain('Update ahpd on the node.');
  expect(old.registry.joined()).toEqual([]);

  const hub = await hubOf();
  const node = joinNode(hub);
  await until(() => node.greeted.length > 0);
  expect(node.greeted[0]?.result).toEqual({ node: NODE, workdir: hub.folders.node });
  expect(hub.registry.joined()).toEqual([{ id: NODE, workdir: hub.folders.node }]);
});

it('the registry answers nothing for a machine it does not serve, and says a node is not connected', async () => {
  const hub = await hubOf();
  // An id of no node of this hub is another port's to answer, so the host then
  // asks the port for a command instead.
  expect(await hub.registry.connect('elsewhere', { plugins: [] })).toBeUndefined();
  // One of the file that has not dialled is a session that cannot start.
  await expect(hub.registry.connect(NODE, { plugins: [] })).rejects.toThrow(`node ${NODE} is not connected`);
});

it('a session in a joined node runs in the host the node serves, at the node\'s folder', async () => {
  const hub = await hubOf();
  const node = joinNode(hub);
  await until(() => hub.registry.joined().length === 1);

  const peer = watching();
  const client = hub.host.accept(peer);
  const uri = 'ahp-session:/in-the-node';
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  await client.handle({
    method: 'createSession',
    params: {
      channel: uri,
      provider: 'echo',
      config: { computer: `computer://${NODE}` },
      workingDirectories: [uriOf(hub.folders.hub)],
    },
  });
  const chat = await mintedChat(client, uri);
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hello node' } } },
  });
  await until(() => peer.seen.some(({ params }) => params?.action?.type === 'chat/turnComplete' && params?.channel === chat));
  expect(peer.seen.some(({ params }) => params?.action?.type === 'session/creationFailed')).toBe(false);
  // The turn came back out of the host inside the node, whole.
  const delta = peer.seen
    .filter(({ params }) => params?.action?.type === 'chat/delta')
    .map(({ params }) => String(params?.action?.content))
    .join('');
  expect(delta).toBe('hello node');

  // The hub asked for one session, with the plugin the node's host must load.
  expect(node.asked[0]?.params?.plugins).toEqual(['@ahpd/echo']);
  /*
   * And the host inside creates its session at the node's own workdir: the
   * folder this hub named is a path on this host, and the session there works
   * where the node said its sessions start.
   */
  const [first] = node.served;
  const created = first?.messages.find((one) => one.method === 'createSession');
  expect(created?.params?.workingDirectories).toEqual([uriOf(hub.folders.node)]);
}, 30_000);

it('says when a node joins and when it goes, and tells a late watcher where it already is', async () => {
  const hub = await hubOf();
  const seen: NodeChange[] = [];
  hub.registry.watch((change) => { seen.push(change); });
  const node = joinNode(hub);
  await until(() => hub.registry.joined().length === 1);
  expect(seen).toEqual([{ id: NODE, joined: true, workdir: hub.folders.node }]);

  /*
   * A watcher taken after the node arrived is told where it already is, so a
   * meter that starts late charges the node from now rather than not at all.
   */
  const late: NodeChange[] = [];
  const handle = hub.registry.watch((change) => { late.push(change); });
  expect(late).toEqual([{ id: NODE, joined: true, workdir: hub.folders.node }]);

  // And the node going is said once, whichever moment says it.
  hub.registry.drop(NODE);
  expect(seen).toEqual([
    { id: NODE, joined: true, workdir: hub.folders.node },
    { id: NODE, joined: false },
  ]);
  expect(late).toEqual([
    { id: NODE, joined: true, workdir: hub.folders.node },
    { id: NODE, joined: false },
  ]);
  handle.close();
  // A watcher that closed hears nothing more.
  hub.registry.drop(NODE);
  expect(late).toHaveLength(2);
});

it('takes a node\'s connection away when it is removed or its token is replaced', async () => {
  const hub = await hubOf();
  joinNode(hub);
  await until(() => hub.registry.joined().length === 1);
  // A new token refuses the old one, so the connection the old one opened goes.
  await hub.registry.add(NODE);
  expect(hub.registry.joined()).toEqual([]);

  const again = await hubOf();
  joinNode(again);
  await until(() => again.registry.joined().length === 1);
  expect(await again.registry.remove(NODE)).toBe(true);
  expect(again.registry.joined()).toEqual([]);
});

it('a hub started again resumes the session against the node store that kept it', async () => {
  const first = await hubOf();
  const node = joinNode(first);
  await until(() => first.registry.joined().length === 1);
  const one = await inNode(first);
  await one.say('t1', 'hello node');
  // The hub goes down as `ahpd restart` does: its session is stopped and not
  // disposed, so the node keeps the transcript it holds.
  await first.host.close();

  const second = await hubOf({ dir: first.dir });
  const again = joinNode(second, { host: node.store });
  await until(() => second.registry.joined().length === 1);

  const peer = watching();
  const client = second.host.accept(peer);
  await client.handle({ method: 'initialize', params: { clientId: 'window', protocolVersions: ['1.0.0'] } });
  const rows = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as { items: Bag[] };
  expect(rows.items.map((row) => row.resource)).toEqual([one.uri]);

  // The chat the session keeps from the hub that made it.
  const chat = await mintedChat(client, one.uri);
  await client.handle({ method: 'subscribe', params: { channel: chat } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, clientSeq: 1, action: { type: 'chat/turnStarted', turnId: 't2', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'after the restart' } } },
  });
  await until(() => peer.seen.some(({ params }) => params?.action?.type === 'chat/turnComplete'));
  const read = await client.handle({ method: 'subscribe', params: { channel: chat } }) as { snapshot: { state: Bag } };
  expect((read.snapshot.state.turns as Bag[]).map((turn) => String(turn.id))).toEqual(['t1', 't2']);
  // The session inside was opened by its own id rather than made again.
  expect(again.asked).toHaveLength(1);
}, 30_000);

it('ends a session whose node went, in a sentence that names the node, and resumes it on the next turn', async () => {
  const hub = await hubOf();
  const node = joinNode(hub);
  await until(() => hub.registry.joined().length === 1);
  const one = await inNode(hub);
  await one.say('t1', 'hello node');

  // The node's `ahpd join` restarts: the socket this session runs on goes, and
  // the node dials the hub again with the transcript it kept on its own disk.
  node.served[0]?.socket.close();
  await until(() => one.said('session/creationFailed').length === 1);
  expect(String(one.said('session/creationFailed')[0]?.error?.message)).toContain(`computer://${NODE}`);

  // And the process goes with it, so the hub has no socket of this node until
  // the node dials again - which is the moment its join is waiting for.
  node.control.close();
  await until(() => hub.registry.joined().length === 0);
  const again = joinNode(hub, { host: node.store });
  await until(() => hub.registry.joined().length === 1);
  // The next turn is the resume: it opens the session inside by its own id.
  await one.say('t2', 'still there?');
  expect(again.asked).toHaveLength(1);
  // And the conversation the node kept came back with it.
  expect(await one.turns()).toEqual(['t1', 't2']);
}, 30_000);

it('keeps a session on a node that restarted, and answers its next turn through the new socket', async () => {
  const hub = await hubOf({ restart: 'reconnect' });
  const node = joinNode(hub);
  await until(() => hub.registry.joined().length === 1);
  const one = await inNode(hub);
  await one.say('t1', 'hello node');

  node.served[0]?.socket.close();
  // The session opens itself again on the socket the node dials back.
  await until(() => node.asked.length === 2);
  expect(one.said('session/creationFailed')).toEqual([]);
  await one.say('t2', 'back again');
  expect(one.said('session/creationFailed')).toEqual([]);
  expect(await one.turns()).toEqual(['t1', 't2']);
}, 30_000);

it('waits a bounded time for a node that is dialling again, and names the node when it does not come back', async () => {
  const hub = await hubOf();
  joinNode(hub);
  await until(() => hub.registry.joined().length === 1);
  hub.registry.drop(NODE);
  await expect(hub.registry.connect(NODE, { plugins: ['@ahpd/echo'] }))
    .rejects.toThrow(`node ${NODE} is not connected: it did not join within 300ms`);

  // A node that dials inside the bound is the answer rather than a failure.
  const waiting = hub.registry.connect(NODE, { plugins: ['@ahpd/echo'] });
  const again = joinNode(hub);
  await expect(waiting).resolves.toMatchObject({ workingDirectory: hub.folders.node });
  await until(() => again.asked.length === 1);
}, 30_000);

import { afterEach, expect, it, vi } from 'vitest';
import { createHost } from '../src/host.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import { startedNow } from './support/started.js';

/*
 * Who else is in this session.
 *
 * The case this daemon exists for and the one it could not answer: several
 * clients drive the same session and none of them could see the others.
 * Membership is the host's to keep - a client announces itself and the host
 * takes it out again - so what is checked here is the taking out, which is
 * where the protocol names three separate ways it happens.
 */

const DIR = '/tmp/presence';

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return { notes, send: () => {}, notify: (method, params) => notes.push({ method, params }), request: async () => ({}), answered: () => {}, close: () => {} };
}

const host = () => createHost({ path: DIR, agents: [echo({ path: DIR, pace: 0 })] });

/**
 * The example backend, with what a session's clients come to for the work.
 *
 * A backend reaches the clients of its session through two calls: the tools it
 * may offer, retold whenever they move, and the one that fails what a client
 * that is gone still owed it. A fake that keeps both is what says whether a
 * client is still in the session as far as anything but the bookkeeping goes.
 */
const watched = (pace = 0, backend?: Agent) => {
  const base = backend ?? echo({ path: DIR, pace });
  /** One entry per chat started, which is a spawn or a restart of one. */
  const spawned: string[] = [];
  /** The tool names each chat was handed as it started, the list it is born with. */
  const born: string[][] = [];
  /** The tool names each chat was handed, in the order it was handed them. */
  const offered: string[][] = [];
  /** The clients each chat was told have gone. */
  const gone: string[] = [];
  const agent: Agent = {
    ...base,
    create: (start) => {
      spawned.push(start.chatUri);
      const chat = startedNow(base.create(start));
      // What the backend is handed at creation: a tool the creator brought has
      // to be here for it to reach the first turn. Recorded only once the
      // backend has actually started, so a create it refused is not one here.
      born.push((start.tools ?? []).map((one) => one.definition.name));
      return {
        ...chat,
        // A backend that can be told, so the list is a real one rather than
        // one this host built and had nowhere to send.
        setTools: async (tools) => { offered.push(tools.map((one) => one.definition.name)); return true; },
        clientGone: (clientId) => { gone.push(clientId); chat.clientGone?.(clientId); },
      };
    },
  };
  return { agent, spawned, born, offered, gone };
};

// The cases that hold a clock put it back, so no test runs on another's time.
afterEach(() => { vi.useRealTimers(); });

/** A connected client, named, watching nothing yet. */
async function joins(held: ReturnType<typeof host>, clientId: string) {
  const p = peer();
  const client = held.accept(p);
  await client.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'] } });
  return { client, peer: p };
}

const actions = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> })
  .filter((n) => n.channel === channel)
  .map((n) => n.action);

/** The envelopes one client heard on one channel, whole, for the sequence and the origin. */
const envelopes = (p: ReturnType<typeof peer>, channel: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as {
    channel: string;
    action: Record<string, unknown>;
    serverSeq: number;
    origin?: { clientId: string; clientSeq: number };
  })
  .filter((n) => n.channel === channel);

const clientsIn = async (client: { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> }, uri: string) => {
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { activeClients: { clientId: string }[] } };
  };
  return opened.snapshot.state.activeClients.map((one) => one.clientId).sort();
};

/** The removals one client heard about on one channel. */
const removals = (p: ReturnType<typeof peer>, channel: string) =>
  actions(p, channel).filter((one) => one.type === 'session/activeClientRemoved');

/** Settle whatever the last call set going: the same wait, on either clock. */
const settle = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (vi.isFakeTimers()) await vi.advanceTimersByTimeAsync(0);
    else await new Promise((r) => { setTimeout(r, 0); });
  }
};

const URI = 'ahp-session:/shared';

type Client = { handle(r: { method: string; params: Record<string, unknown> }): Promise<unknown> };

/** A client subscribing to the session, and announcing what it provides there. */
const enter = async (client: Client, id: string, tools: unknown[] = []): Promise<void> => {
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: id, tools } } },
  });
};

/*
 * An announcement that changes nothing is still a session action this host
 * accepted, so it goes to every client of the session, sequenced: "Host
 * sequences it - assigns a `serverSeq`, applies it to the authoritative state,
 * broadcasts the action envelope to all subscribed clients."
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/docs/guide/ahp-and-acp.md#how-they-compose
 */
it('says an unchanged announcement to every client, each time at the next sequence', async () => {
  const held = host();
  const { client, peer: one } = await joins(held, 'one');
  const { client: second, peer: two } = await joins(held, 'two');
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await second.handle({ method: 'subscribe', params: { channel: URI } });

  const announce = (clientSeq: number) => client.handle({
    method: 'dispatchAction',
    params: { channel: URI, clientSeq, action: { type: 'session/activeClientSet', activeClient: { clientId: 'one', tools: [] } } },
  });
  await announce(1);
  await settle();
  await announce(2);
  await announce(3);
  await settle();

  for (const p of [one, two]) {
    const said = envelopes(p, URI).filter((e) => e.action.type === 'session/activeClientSet');
    expect(said.map((e) => e.origin?.clientSeq)).toEqual([1, 2, 3]);
    const seqs = said.map((e) => e.serverSeq);
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    expect(new Set(seqs).size).toBe(seqs.length);
  }
  // Said again, the entry is the one the session already held.
  expect(await clientsIn(second, URI)).toEqual(['one']);
});

/*
 * A read or archived bit set to what it already is changes nothing in the
 * catalogue, and goes to every client as an unchanged announcement does.
 */
it('says a session flag set again to every client, at the next sequence', async () => {
  const held = host();
  const { client, peer: one } = await joins(held, 'one');
  const { client: second, peer: two } = await joins(held, 'two');
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await second.handle({ method: 'subscribe', params: { channel: URI } });

  const read = (clientSeq: number) => client.handle({
    method: 'dispatchAction',
    params: { channel: URI, clientSeq, action: { type: 'session/isReadChanged', isRead: false } },
  });
  // A session its own client created starts read, so the first moves the bit
  // and the second says it again.
  await read(1);
  await settle();
  const at = envelopes(one, URI).at(-1)?.serverSeq ?? 0;
  await read(2);
  await settle();

  for (const p of [one, two]) {
    const said = envelopes(p, URI).filter((e) => e.action.type === 'session/isReadChanged');
    expect(said.map((e) => e.origin?.clientSeq)).toEqual([1, 2]);
    expect(said.at(-1)?.serverSeq).toBeGreaterThan(at);
  }
});

/*
 * A client reconciles what it contributes whenever the session's state moves,
 * and an echo is the state moving. One that sent its set again on every move
 * would run a loop with any host that echoes; VS Code's session handler
 * compares what it would send with the entry the state holds and with what it
 * sent last, so an echo of somebody's unchanged set moves it to nothing.
 * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostSessionHandler.ts#L1237-L1253
 */
it('leaves a client that reconciles on every move, as VS Code does, sending its set once', async () => {
  const held = host();
  const reconciling = peer();
  const client = held.accept(reconciling);
  await client.handle({ method: 'initialize', params: { clientId: 'one', protocolVersions: ['0.9.0'] } });
  const { client: second } = await joins(held, 'two');
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: URI } }) as {
    snapshot: { state: { activeClients: Record<string, unknown>[] } };
  };
  await second.handle({ method: 'subscribe', params: { channel: URI } });

  // The client's half, as VS Code's handler keeps it: the entries the state
  // holds, what it means to publish, and what it published last.
  let entries = opened.snapshot.state.activeClients;
  const wanted = { clientId: 'one', tools: [] };
  let last: unknown;
  let sent = 0;
  let seq = 0;
  const reconcile = (): void => {
    const existing = entries.find((one) => one.clientId === 'one');
    if (JSON.stringify(existing) === JSON.stringify(wanted)) { last = undefined; return; }
    if (JSON.stringify(last) === JSON.stringify(wanted)) return;
    sent += 1;
    seq += 1;
    void client.handle({ method: 'dispatchAction', params: { channel: URI, clientSeq: seq, action: { type: 'session/activeClientSet', activeClient: wanted } } });
    last = wanted;
  };
  const notify = reconciling.notify;
  reconciling.notify = (method, params) => {
    notify(method, params);
    const envelope = params as { channel: string; action: Record<string, unknown> };
    if (method !== 'action' || envelope.channel !== URI) return;
    if (envelope.action.type === 'session/activeClientSet') {
      const entry = envelope.action.activeClient as Record<string, unknown>;
      entries = [...entries.filter((one) => one.clientId !== entry.clientId), entry];
    }
    reconcile();
  };
  reconcile();
  await settle();

  // The other client says its set, then says it again unchanged.
  for (const clientSeq of [1, 2, 3]) {
    await second.handle({ method: 'dispatchAction', params: { channel: URI, clientSeq, action: { type: 'session/activeClientSet', activeClient: { clientId: 'two', tools: [] } } } });
    await settle();
  }

  expect(sent).toBe(1);
  expect(actions(reconciling, URI).filter((a) => a.type === 'session/activeClientSet')).toHaveLength(4);
});

it('says so again when what a client contributes has changed', async () => {
  const held = host();
  const { client, peer: p } = await joins(held, 'one');
  const { client: second, peer: two } = await joins(held, 'two');
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await client.handle({ method: 'subscribe', params: { channel: URI } });
  await second.handle({ method: 'subscribe', params: { channel: URI } });

  await client.handle({
    method: 'dispatchAction',
    params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: 'one', tools: [] } } },
  });
  await settle();
  // A tool arriving is a change, and has to go out.
  await client.handle({
    method: 'dispatchAction',
    params: {
      channel: URI,
      action: { type: 'session/activeClientSet', activeClient: { clientId: 'one', tools: [{ name: 'openBrowserPage' }] } },
    },
  });
  await settle();

  expect(actions(p, URI).filter((a) => a.type === 'session/activeClientSet')).toHaveLength(2);
  // A change is the session's, so every client watching it hears it.
  expect(actions(two, URI).filter((a) => a.type === 'session/activeClientSet')).toHaveLength(2);
});

it('is an empty list before anybody says otherwise, because the field is required', async () => {
  const held = host();
  const { client } = await joins(held, 'one');
  await client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  // Not absent. `activeClients` is required in `SessionState`, and a session
  // nobody has opened having nobody in it is a real answer.
  expect(await clientsIn(client, URI)).toEqual([]);
});

it('shows one client to another, which is the whole reason a host keeps it', async () => {
  const held = host();
  const a = await joins(held, 'one');
  const b = await joins(held, 'two');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });

  b.client.handle({
    method: 'dispatchAction',
    params: {
      channel: URI,
      action: {
        type: 'session/activeClientSet',
        activeClient: { clientId: 'two', displayName: 'VS Code', tools: [{ name: 'openFile' }] },
      },
    },
  });

  // The other client hears about it, which is not something the two of them
  // could have told each other.
  const said = actions(a.peer, URI).filter((one) => one.type === 'session/activeClientSet');
  expect(said).toHaveLength(1);
  expect(said[0]?.activeClient).toMatchObject({ clientId: 'two', displayName: 'VS Code' });
  expect(await clientsIn(a.client, URI)).toEqual(['two']);
});

/*
 * The entry as sent, under the `clientId` it names: the reference host takes a
 * set as sent, and a client's leaving takes out its own entry, so the sender's
 * leaving leaves this one.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1659-L1677
 */
it('holds an entry that names another client as sent, and the sender\'s leaving leaves it', async () => {
  const held = host();
  const a = await joins(held, 'honest');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  await a.client.handle({
    method: 'dispatchAction',
    params: {
      channel: URI,
      action: { type: 'session/activeClientSet', activeClient: { clientId: 'somebody-else', tools: [{ name: 'openFile' }] } },
    },
  });
  expect(await clientsIn(a.client, URI)).toEqual(['somebody-else']);
  const said = a.peer.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { action: { type: string }; rejectionReason?: string })
    .find((one) => one.action.type === 'session/activeClientSet');
  expect(said?.rejectionReason).toBeUndefined();
  const b = await joins(held, 'watcher');
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });
  await a.client.handle({ method: 'unsubscribe', params: { channel: URI } });
  expect(await clientsIn(b.client, URI)).toEqual(['somebody-else']);
});

/*
 * An entry that names no client is held as sent: the reference host takes a
 * set as sent, and the protocol's reducer keys the entry by the `clientId` it
 * carries. A client's leaving takes out its own entry, which this is not.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L2008-L2011
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/reducer.ts#L264-L273
 */
it('holds an entry that names no client as sent, and the sender\'s leaving leaves it', async () => {
  const held = host();
  const a = await joins(held, 'honest');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  const entry = { displayName: 'Nobody', tools: [] };
  await a.client.handle({
    method: 'dispatchAction',
    params: { channel: URI, clientSeq: 1, action: { type: 'session/activeClientSet', activeClient: entry } },
  });
  const said = a.peer.notes
    .filter((n) => n.method === 'action')
    .map((n) => n.params as { action: { type: string; activeClient?: unknown }; rejectionReason?: string })
    .find((one) => one.action.type === 'session/activeClientSet');
  expect(said?.rejectionReason).toBeUndefined();
  expect(said?.action.activeClient).toEqual(entry);
  /** The session's entries as a client subscribing now is handed them. */
  const entries = async (client: Client) => ((await client.handle({ method: 'subscribe', params: { channel: URI } })) as {
    snapshot: { state: { activeClients: unknown[] } };
  }).snapshot.state.activeClients;
  expect(await entries(a.client)).toEqual([entry]);
  const b = await joins(held, 'watcher');
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });
  await a.client.handle({ method: 'unsubscribe', params: { channel: URI } });
  expect(await entries(b.client)).toEqual([entry]);
});

it('replaces what a client contributes rather than merging it', async () => {
  const held = host();
  const a = await joins(held, 'one');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  const announce = (tools: { name: string }[]) => a.client.handle({
    method: 'dispatchAction',
    params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: 'one', tools } } },
  });
  await announce([{ name: 'a' }, { name: 'b' }]);
  await announce([{ name: 'a' }]);
  const opened = await a.client.handle({ method: 'subscribe', params: { channel: URI } }) as {
    snapshot: { state: { activeClients: { tools: unknown[] }[] } };
  };
  // Re-announcing is how a client refreshes what it offers, so a tool taken
  // away has to be able to go.
  expect(opened.snapshot.state.activeClients[0]?.tools).toEqual([{ name: 'a' }]);
});

/*
 * The entry as the client sent it, `tools` left out included: the reference
 * host reduces a set as sent, and a VS Code window reads `tools` of every
 * client in the session, so a list this host made up would read as one the
 * client never sent.
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2750-L2752
 * https://github.com/microsoft/vscode/blob/58a595f76bdc150460d7e0d279d26cc6fc577b0a/src/vs/workbench/contrib/chat/browser/agentSessions/agentHost/agentHostCustomizationService.ts#L1083-L1101
 */
it('holds an entry that names no tools as it was sent, and its client provides none', async () => {
  const { agent, offered } = watched();
  const held = createHost({ path: DIR, agents: [agent] });
  const a = await joins(held, 'one');
  const b = await joins(held, 'two');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  await b.client.handle({ method: 'subscribe', params: { channel: URI } });
  await enter(b.client, 'two', [{ name: 'openFile', inputSchema: { type: 'object' } }]);
  await a.client.handle({
    method: 'dispatchAction',
    params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: 'one', displayName: 'cli' } } },
  });
  await settle();

  const said = actions(b.peer, URI).filter((one) => one.type === 'session/activeClientSet');
  expect(said.at(-1)?.activeClient).toEqual({ clientId: 'one', displayName: 'cli' });
  const opened = await b.client.handle({ method: 'subscribe', params: { channel: URI } }) as {
    snapshot: { state: { activeClients: Record<string, unknown>[] } };
  };
  expect(opened.snapshot.state.activeClients.find((one) => one.clientId === 'one')).toEqual({ clientId: 'one', displayName: 'cli' });
  // The other client's tool is all the chat is offered.
  expect(offered.at(-1)).toEqual(['two__openFile']);
});

it('holds a creator\'s entry that names no tools as it was sent', async () => {
  const held = host();
  const a = await joins(held, 'creator');
  await a.client.handle({
    method: 'createSession',
    params: { channel: URI, provider: 'echo', activeClient: { clientId: 'creator', displayName: 'cli' } },
  });
  const opened = await a.client.handle({ method: 'subscribe', params: { channel: URI } }) as {
    snapshot: { state: { activeClients: Record<string, unknown>[] } };
  };
  expect(opened.snapshot.state.activeClients).toEqual([{ clientId: 'creator', displayName: 'cli' }]);
});

/*
 * The creator's `clientId` MUST match the connection's, and VS Code's host
 * refuses an entry that names none, as one naming another.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2209-L2213
 */
it('refuses a creator\'s entry that names no client, and makes nothing', async () => {
  const held = host();
  const a = await joins(held, 'creator');
  await expect(a.client.handle({
    method: 'createSession',
    params: { channel: URI, provider: 'echo', activeClient: { displayName: 'cli', tools: [] } },
  })).rejects.toMatchObject({ code: -32602, message: 'createSession.activeClient.clientId must match the connection\'s clientId' });
  await expect(a.client.handle({ method: 'subscribe', params: { channel: URI } })).rejects.toThrow();
});

it('takes a client out on unsubscribe, on disconnect, and on a reconnect that drops it', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const held = host();
  const a = await joins(held, 'watcher');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });

  // One: unsubscribing.
  const b = await joins(held, 'leaver');
  await enter(b.client, 'leaver');
  expect(await clientsIn(a.client, URI)).toEqual(['leaver']);
  b.client.handle({ method: 'unsubscribe', params: { channel: URI } });
  expect(await clientsIn(a.client, URI)).toEqual([]);
  expect(removals(a.peer, URI)).toMatchObject([{ clientId: 'leaver' }]);

  // Two: going away without saying anything, which is the way that waits. A
  // socket that dropped is a client that may be back, so nothing is taken
  // from it until the window is up.
  const c = await joins(held, 'dropper');
  await enter(c.client, 'dropper');
  expect(await clientsIn(a.client, URI)).toEqual(['dropper']);
  c.client.close();
  expect(await clientsIn(a.client, URI)).toEqual(['dropper']);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await clientsIn(a.client, URI)).toEqual([]);

  // Three: coming back and not asking for it again.
  const d = await joins(held, 'forgetful');
  await enter(d.client, 'forgetful');
  expect(await clientsIn(a.client, URI)).toEqual(['forgetful']);
  await d.client.handle({
    method: 'reconnect',
    params: { clientId: 'forgetful', subscriptions: [], lastSeenServerSeq: 0 },
  });
  expect(await clientsIn(a.client, URI)).toEqual([]);
});

it('keeps a client in while another window of theirs is still watching', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const held = host();
  const a = await joins(held, 'watcher');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });

  // One person, two windows, one client id. Closing the first must not take
  // them out of the session the second is still in.
  const first = await joins(held, 'twice');
  const second = await joins(held, 'twice');
  await first.client.handle({ method: 'subscribe', params: { channel: URI } });
  await second.client.handle({ method: 'subscribe', params: { channel: URI } });
  first.client.handle({
    method: 'dispatchAction',
    params: { channel: URI, action: { type: 'session/activeClientSet', activeClient: { clientId: 'twice', tools: [] } } },
  });
  expect(await clientsIn(a.client, URI)).toEqual(['twice']);

  first.client.close();
  expect(await clientsIn(a.client, URI)).toEqual(['twice']);
  second.client.close();
  // Both windows are gone, and the client with them once the window is up.
  expect(await clientsIn(a.client, URI)).toEqual(['twice']);
  await vi.advanceTimersByTimeAsync(30_000);
  expect(await clientsIn(a.client, URI)).toEqual([]);
});

/*
 * A client that dropped is a client that is still there.
 *
 * What a client announced in a session - the tools it runs, the plugins it
 * handed over - is in the session's hands rather than the connection's, and a
 * socket that dropped for a moment is not a client that has finished with the
 * session it was in. So the removal waits, and a client that subscribes again
 * inside the window has never left: it is the same client, in the same
 * session, with everything it contributed still there and nothing said about
 * it. That is the difference between a window that reconnects and one that has
 * to be told again what it provides.
 */

it('keeps a client that dropped, with its tool, for thirty seconds', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { agent, offered, gone } = watched();
  const held = createHost({ path: DIR, agents: [agent] });
  const a = await joins(held, 'watcher');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });

  const b = await joins(held, 'dropper');
  await enter(b.client, 'dropper', [{ name: 'openFile' }]);
  await settle();
  // What it announced is offered to the session's chats, named for the client.
  expect(offered.at(-1)).toContain('dropper__openFile');

  b.client.close();
  await settle();
  await vi.advanceTimersByTimeAsync(29_999);

  // One millisecond short: nothing said, nothing taken away, nothing failed.
  expect(removals(a.peer, URI)).toEqual([]);
  expect(await clientsIn(a.client, URI)).toEqual(['dropper']);
  expect(offered.at(-1)).toContain('dropper__openFile');
  expect(gone).toEqual([]);

  await vi.advanceTimersByTimeAsync(1);

  // And at thirty seconds it is out, with everything it brought.
  expect(removals(a.peer, URI)).toMatchObject([{ clientId: 'dropper' }]);
  expect(await clientsIn(a.client, URI)).toEqual([]);
  expect(offered.at(-1)).not.toContain('dropper__openFile');
  expect(gone).toEqual(['dropper']);
});

it('has not gone anywhere when it subscribes again inside the window', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { agent, spawned, offered } = watched();
  const held = createHost({ path: DIR, agents: [agent] });
  const a = await joins(held, 'watcher');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });

  const b = await joins(held, 'back-soon');
  await enter(b.client, 'back-soon', [{ name: 'openFile' }]);
  await settle();
  const announced = actions(a.peer, URI).filter((one) => one.type === 'session/activeClientSet').length;
  expect(announced).toBe(1);

  b.client.close();
  await settle();
  await vi.advanceTimersByTimeAsync(10_000);

  // The same client, on a new connection, watching the same session again.
  const again = await joins(held, 'back-soon');
  await again.client.handle({ method: 'subscribe', params: { channel: URI } });
  await settle();
  await vi.advanceTimersByTimeAsync(30_000);

  // Nothing said about it either way, and its chat was never started again:
  // a client that never left is not one to tell anybody about.
  expect(removals(a.peer, URI)).toEqual([]);
  expect(await clientsIn(a.client, URI)).toEqual(['back-soon']);
  expect(actions(a.peer, URI).filter((one) => one.type === 'session/activeClientSet')).toHaveLength(announced);
  expect(offered.at(-1)).toContain('back-soon__openFile');
  expect(spawned).toHaveLength(1);
});

it('leaves no wait running when the host closes', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  const { agent } = watched();
  const held = createHost({ path: DIR, agents: [agent] });
  const a = await joins(held, 'watcher');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  await a.client.handle({ method: 'subscribe', params: { channel: URI } });
  const b = await joins(held, 'dropper');
  await enter(b.client, 'dropper');

  b.client.close();
  await settle();
  expect(vi.getTimerCount()).toBeGreaterThan(0);

  await held.close();
  // The host is gone, so nothing is waiting to take anybody out of it.
  expect(vi.getTimerCount()).toBe(0);
  a.client.close();
});

/*
 * The sessions not disposed, said as a session is made and disposed: a turn
 * starting and ending moves nothing.
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-root/state.ts#L39
 */
it('says how many sessions there are when that changes', async () => {
  const held = host();
  const a = await joins(held, 'one');
  await a.client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  const opened = await a.client.handle({ method: 'subscribe', params: { channel: URI } }) as { snapshot: { state: { defaultChat: string } } };
  await a.client.handle({
    method: 'dispatchAction',
    params: { channel: opened.snapshot.state.defaultChat, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'hi' } } },
  });
  await settle();
  const said = (): unknown[] => actions(a.peer, 'ahp-root://')
    .filter((one) => one.type === 'root/activeSessionsChanged')
    .map((one) => one.activeSessions);
  // The session made, and its turn's start and end moving nothing.
  expect(said()).toEqual([1]);
  await a.client.handle({ method: 'disposeSession', params: { channel: URI } });
  expect(said()).toEqual([1, 0]);
});

/*
 * Claiming a place in a session at the moment it is made.
 *
 * `CreateSessionParams.activeClient` is the protocol's own shortcut for the
 * dispatch that would otherwise follow: without it, the client that created a
 * session owns one it is briefly not in, and every other client watching the
 * root sees a session with nobody in it until the second round trip lands.
 */
it('takes the creator into the session it created, without a second round trip', async () => {
  const held = host();
  const a = await joins(held, 'creator');
  const b = await joins(held, 'watcher');
  await a.client.handle({
    method: 'createSession',
    params: {
      channel: URI,
      provider: 'echo',
      activeClient: { clientId: 'creator', tools: [{ name: 'openBrowserPage' }] },
    },
  });
  expect(await clientsIn(b.client, URI)).toEqual(['creator']);
  // What it contributes comes with it. The field is a whole `activeClient`,
  // not a flag, and dropping the tools would make the shortcut lossy.
  const seen = (await b.client.handle({ method: 'subscribe', params: { channel: URI } }) as {
    snapshot: { state: { activeClients: { tools: { name: string }[] }[] } };
  }).snapshot.state.activeClients;
  expect(seen[0]?.tools.map((one) => one.name)).toEqual(['openBrowserPage']);
});

/*
 * The protocol says the creator's `clientId` MUST match the connection's, and
 * VS Code's host refuses a request whose entry names another, before the
 * session is made.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2209-L2213
 */
it('refuses a creator that names another client, and makes nothing', async () => {
  const held = host();
  const a = await joins(held, 'creator');
  await expect(a.client.handle({
    method: 'createSession',
    params: { channel: URI, provider: 'echo', activeClient: { clientId: 'somebody-else', tools: [] } },
  })).rejects.toMatchObject({ code: -32602, message: 'createSession.activeClient.clientId must match the connection\'s clientId' });
  await expect(a.client.handle({ method: 'subscribe', params: { channel: URI } })).rejects.toThrow();
});

it('leaves a session nobody claimed empty', async () => {
  const held = host();
  const a = await joins(held, 'creator');
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo' } });
  // Subscribing is not being *active* in it: the protocol has a client say so.
  expect(await clientsIn(a.client, URI)).toEqual([]);
});

it('offers a tool the creator brought on the session\'s first turn', async () => {
  const { agent, born } = watched();
  const held = createHost({ path: DIR, agents: [agent] });
  const a = await joins(held, 'creator');
  await a.client.handle({
    method: 'createSession',
    params: { channel: URI, provider: 'echo', activeClient: { clientId: 'creator', tools: [{ name: 'openFile' }] } },
  });
  // Recorded before the backend is started, so the very first list it is
  // handed already holds the tool - not one a `retool` adds one turn later.
  expect(born[0]).toEqual(['creator__openFile']);
});

it('takes the creator back out when the session never opens', async () => {
  // A backend that refuses once, then starts: the first create has no session
  // for the presence it wrote to belong to, and the second is the same client
  // making a session that does open.
  let refuse = true;
  const base = echo({ path: DIR, pace: 0 });
  const agent: Agent = {
    ...base,
    create: (start) => { if (refuse) throw new Error('this backend will not start'); return base.create(start); },
  };
  const { agent: watchedOne, born } = watched(0, agent);
  const held = createHost({ path: DIR, agents: [watchedOne] });
  const a = await joins(held, 'creator');
  const activeClient = { clientId: 'creator', tools: [{ name: 'openFile' }] };

  await expect(a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo', activeClient } }))
    .rejects.toThrow(/will not start/);
  // Nothing came of it, so nothing is in it.
  expect(born).toEqual([]);

  refuse = false;
  await a.client.handle({ method: 'createSession', params: { channel: URI, provider: 'echo', activeClient } });
  // A client the failed create left behind would make this second announcement
  // read as one already made, and the tool would never be handed to the chat.
  expect(born).toEqual([['creator__openFile']]);
});

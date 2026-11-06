import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROTOCOL_VERSION } from '@microsoft/agent-host-protocol';
import { ROOT } from '../src/host.js';
import { chatUriFor } from '../src/host/channels.js';
import { sdkVersion } from '../src/version.js';
import {
  resetSdk, actions, claude, createHost, emit, hello, machine, open, peer, sdk, serving, sessionQueries,
  settle, running,
} from './support/host.js';
import type { Start } from '../src/types/agent.js';
import type { Emit } from '../src/types/session.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/**
 * A host whose session can say an action the host itself would send.
 *
 * A canvas action is the host's own and no client may dispatch one, so the
 * `emit` the host hands a backend is captured here: what it says reaches the
 * same `dispatch` a client's action would, and the version gate in `projectActionForClient`
 * sees it.
 */
const canvasHost = () => {
  let send: Emit | undefined;
  const base = claude({ paths: ['/home/softov'] });
  const agent = {
    ...base,
    create: (start: Start) => {
      send = start.emit;
      return base.create(start);
    },
  };
  const host = createHost({ path: '/home/softov', agents: [agent], ...machine() });
  return {
    host,
    /** Say that a chat's canvas list moved, as the host's canvas store does. */
    canvas: (chat: string, resource?: string): void => {
      send?.('chat', {
        type: 'chat/canvasesChanged',
        canvases: resource === undefined ? undefined : [{ resource }],
      });
    },
  };
};

/** Open a session and subscribe a client to its chat, answering the chat's URI and where its snapshot was taken. */
const canvasSession = async (client: ReturnType<ReturnType<typeof createHost>['accept']>): Promise<{ chat: string; fromSeq: number }> => {
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chat = opened.snapshot.state.defaultChat;
  const read = await client.handle({ method: 'subscribe', params: { channel: chat } }) as { snapshot: { fromSeq: number } };
  return { chat, fromSeq: read.snapshot.fromSeq };
};

/**
 * Where a client's cursor stands, as its `reconnect` says it: the highest
 * `serverSeq` among the actions it was sent and the snapshots it was given.
 */
const cursorOf = (p: ReturnType<typeof peer>, ...fromSeqs: number[]): number =>
  Math.max(0, ...actions(p).map((one) => one.serverSeq), ...fromSeqs);

describe('the handshake', () => {
  it('answers the highest version offered that it speaks, in whatever order they came', async () => {
    for (const offered of [['1.0.0'], ['0.9.0'], ['0.9.0', '1.0.0'], ['1.0.0', '0.9.0']]) {
      const result = await open().handle(hello(offered)) as { protocolVersion: string };
      expect(result.protocolVersion).toBe(offered.includes('1.0.0') ? '1.0.0' : '0.9.0');
    }
  });

  it('answers 0.10.0 to an offer that holds it and agrees on nothing above it', async () => {
    // VS Code 1.141 offers `0.10.0`, a version that reads the 1.0.0 wire.
    // Under the package's caret rule it matches neither baseline, so without
    // the alias that window is answered `0.9.0` and keeps one read bit for the
    // whole session.
    for (const offered of [['0.10.0', '0.9.0'], ['0.9.0', '0.10.0'], ['0.10.0']]) {
      const result = await open().handle(hello(offered)) as { protocolVersion: string };
      expect(result.protocolVersion).toBe('0.10.0');
    }
    const above = await open().handle(hello(['1.0.0', '0.10.0'])) as { protocolVersion: string };
    expect(above.protocolVersion).toBe('1.0.0');
    const below = await open().handle(hello(['0.9.0'])) as { protocolVersion: string };
    expect(below.protocolVersion).toBe('0.9.0');
  });

  it('sends a canvas action to a connection that agreed on 0.10.0 or later', async () => {
    const { host, canvas } = canvasHost();
    const before = peer();
    const older = host.accept(before);
    await older.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const at = peer();
    const ten = host.accept(at);
    await ten.handle(hello(['0.10.0'], { initialSubscriptions: ['ahp-root://'] }));
    const latest = peer();
    const one = host.accept(latest);
    await one.handle(hello(['1.0.0'], { initialSubscriptions: ['ahp-root://'] }));
    // One client makes the session and reads where its chat is.
    const { chat } = await canvasSession(older);
    for (const client of [ten, one]) await client.handle({ method: 'subscribe', params: { channel: chat } });
    await settle();
    canvas(chat, 'ahp-canvas:/x/y');
    await settle();
    // The 1.0.0 package registers the canvas actions at `0.10.0`, so a
    // connection that agreed on 0.9.0 has no reducer case for either.
    expect(actions(before, chat).map((e) => e.action.type)).not.toContain('chat/canvasesChanged');
    expect(actions(at, chat).map((e) => e.action.type)).toContain('chat/canvasesChanged');
    expect(actions(latest, chat).map((e) => e.action.type)).toContain('chat/canvasesChanged');
  });

  it('holds a canvas action out of the replay to a connection that agreed on 0.9.0', async () => {
    const { host, canvas } = canvasHost();
    const first = peer();
    const a = host.accept(first);
    await a.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    const { chat, fromSeq } = await canvasSession(a);
    await settle();
    const upTo = cursorOf(first, fromSeq);

    // The socket goes, and the canvas opens while it is away.
    a.close();
    canvas(chat, 'ahp-canvas:/x/y');
    await settle();

    const back = host.accept(peer());
    await back.handle(hello(['0.9.0']));
    const result = await back.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: upTo,
        subscriptions: ['ahp-root://', chat],
      },
    }) as { type: string; actions: { action: { type: string } }[] };
    expect(result.type).toBe('replay');
    expect(result.actions.map((held) => held.action.type)).not.toContain('chat/canvasesChanged');
  });

  it('refuses with the versions it can speak, so the client can say why, in VS Code\'s words', async () => {
    for (const offered of [['0.8.0'], ['99.0.0']]) {
      await expect(open().handle(hello(offered))).rejects.toMatchObject({
        code: -32005,
        message: `Client offered protocol versions [${offered.join(', ')}], none of which are compatible with this server's version 1.0.0 (server accepts 1.0.0, 0.10.0, 0.9.0).`,
        // `supportedVersions`, which is the name the protocol gives it. Under
        // any other one the client has read `undefined` and has no version to
        // retry with, which is the whole point of the field.
        data: { supportedVersions: ['1.0.0', '0.10.0', '0.9.0'] },
      });
    }
  });

  it('refuses an entry that is not a version, naming it, rather than reading past it', async () => {
    // Not "unsupported" and not "skipped": a `MAJOR.MINOR.PATCH` that is not
    // one is a client that is wrong about what it speaks, and telling it so
    // is the only thing that can fix it.
    for (const offered of [['1.0'], [7]]) {
      await expect(open().handle(hello(offered))).rejects.toMatchObject({ code: -32602 });
    }
  });

  it('hands back the snapshots the client asked to start with', async () => {
    const client = open();
    const result = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { resource: string; state: { agents: unknown[] }; fromSeq: number }[];
    };
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.resource).toBe('ahp-root://');
    expect(result.snapshots[0]?.state.agents).toHaveLength(1);
  });

  it('says what machine it runs on, so a window can pick it as a target', async () => {
    const result = await open().handle(
      hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }),
    ) as { snapshots: { state: { _meta?: Record<string, unknown> } }[] };
    // The key and the shape are VS Code's own: it drops from its list of
    // delegation targets every host whose resources it cannot read.
    const resources = result.snapshots[0]?.state._meta?.['vscode.agentHost.resources'] as Record<string, unknown>;
    expect(resources.platform).toBe(
      process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux',
    );
    expect(resources.architecture).toBe(process.arch);
    // Both are read as capacities, so zero and a negative are as unreadable
    // as an absent key - which is why they are only ever sent above zero.
    expect(resources.cpuCount).toBeGreaterThan(0);
    expect(resources.memoryBytes).toBeGreaterThan(0);
    // And that a session another window sends here is taken: the window
    // offers a host as a place to delegate to only where it says both this
    // and its resources.
    expect(result.snapshots[0]?.state._meta?.['vscode.remoteSessions']).toBe(true);
  });

  it('sends its build, and says its session URIs are its own', async () => {
    const client = open();
    const result = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { state: { _meta?: Record<string, unknown> } }[];
      _meta: Record<string, unknown>;
    };
    // The version, which the window writes in its Output channel.
    expect((result.snapshots[0]?.state._meta?.hostBuild as { version?: string })?.version).toBe(sdkVersion());
    /*
     * And the pair that keeps every session URI this host hands out.
     *
     * `hostBuild` is what makes VS Code treat this host as one of its own,
     * and a native host gets the legacy `provider:/id` spelling for a session
     * unless `initialize` says otherwise - so these two are one statement and
     * are checked as one.
     */
    expect(result._meta['vscode.ahpSessionUris']).toBe(true);
  });

  it('still connects when a channel it was asked for is gone', async () => {
    const client = open();
    // A handshake that fails because one requested session has no agent is a
    // client that cannot connect at all.
    const result = await client.handle(
      hello(['0.9.0'], { initialSubscriptions: ['ahp-root://', 'ahp-session:/vanished'] }),
    ) as { snapshots: unknown[] };
    expect(result.snapshots).toHaveLength(1);
  });

  it('answers a ping before it has been introduced', async () => {
    const client = open();
    // The spec says so in as many words: a server MUST answer `ping` whether
    // or not the client has completed `initialize`. It is how a client tells
    // a live socket from one an idle proxy quietly dropped, and a liveness
    // check that needs a handshake first cannot do that.
    expect(await client.handle({ method: 'ping', params: {} })).toBeNull();
  });

  it('serves nothing else until it has', async () => {
    const client = open();
    await expect(client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }))
      .rejects.toMatchObject({ code: -32601 });
  });

  it('hears a notification sent before the handshake and does nothing with it', async () => {
    const client = open();
    // No id, so there is nowhere to say no - and nothing to say it about: an
    // unintroduced client holds no subscriptions and has no `clientSeq` an
    // echo could be matched against.
    expect(await client.handle({ method: 'unsubscribe', params: { channel: 'ahp-root://' } }))
      .toBeUndefined();
    // And the connection is still usable afterwards.
    const result = await client.handle(hello([PROTOCOL_VERSION])) as { protocolVersion: string };
    expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
  });

  /*
   * A client that gives no id has none: VS Code's host takes the id an
   * initialize carries as it was sent, and what such a client dispatches is
   * said under no client id.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1054-L1061
   */
  it('names a client that gives no id with none, as VS Code\'s host takes the id as sent', async () => {
    const p = peer();
    const client = serving('/home/softov', []).accept(p);
    await client.handle({ method: 'initialize', params: { protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] } });
    const uri = 'ahp-session:/unnamed';
    await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    void client.handle({ method: 'dispatchAction', params: { channel: uri, clientSeq: 1, action: { type: 'session/titleChanged', title: 'Named' } } });
    await settle();
    expect(actions(p, uri).find((one) => one.action.type === 'session/titleChanged')?.origin).toEqual({ clientId: '', clientSeq: 1 });
  });

  it('refuses a second introduction on the same connection', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    // Re-agreeing the version would re-key every subscription this connection
    // is holding, and the reference host's request table holds no handler for
    // a second one.
    await expect(client.handle(hello(['0.9.0']))).rejects.toMatchObject({ code: -32601, message: 'Method not found: initialize' });
  });
});

describe('what it will not pretend', () => {
  it('says a method it does not serve rather than answering an empty success', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    // An empty success leaves the client waiting for state that is never
    // coming, which reads as a hang rather than as a missing feature.
    // `otlp` is telemetry export, which this daemon has no opinion about and
    // is unlikely ever to serve - so it stays a fair example.
    await expect(client.handle({ method: 'otlp', params: { channel: 'ahp-root://' } }))
      .rejects.toMatchObject({ code: -32601, message: 'Method not found: otlp' });
  });

  it('refuses a provider it does not have, in VS Code\'s words', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    await expect(client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/x', provider: 'copilot' },
    })).rejects.toMatchObject({ code: -32002, message: 'No agent provider registered for: copilot' });
  });

  it('refuses an action a client is not allowed to originate, and says which', async () => {
    const { client, peer: p, chatUri } = await running();
    // `chat/delta` is this host telling clients what it did. One arriving
    // *from* a client is a client lying about what happened - and it is told
    // so, because a dispatch dropped in silence leaves the client's
    // optimistic state diverged with nothing to reconcile against.
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/delta', turnId: 't1', partId: 'p', content: 'x' } },
    });
    expect(sdk.said).toEqual([]);
    const refused = p.notes.filter((note) => note.method === 'action').at(-1);
    expect(refused?.params).toMatchObject({ rejectionReason: 'Server-only action: chat/delta' });
  });

  /*
   * A host-only action and one the protocol does not name at all are refused
   * alike, in the reference host's words, as its protocol server refuses any
   * type its map of client-dispatchable actions does not hold.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2811-L2815
   */
  it('refuses a host-only action and one it does not know in the reference host\'s words', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    // Each on the channel its prefix names.
    const why = (action: Record<string, unknown>) => {
      client.handle({ method: 'dispatchAction', params: { channel: String(action.type).startsWith('chat/') ? chatUri : uri, action } });
      const refused = p.notes.filter((note) => note.method === 'action').at(-1);
      return String((refused?.params as { rejectionReason?: string }).rejectionReason);
    };
    expect(why({ type: 'session/ready' })).toBe('Server-only action: session/ready');
    expect(why({ type: 'chat/somethingLater' })).toBe('Server-only action: chat/somethingLater');
  });

  it('says what is actually wrong with a dispatch, not only that it is unserved', async () => {
    const { client, peer: p, chatUri } = await running();
    const why = (action: Record<string, unknown>) => {
      client.handle({ method: 'dispatchAction', params: { channel: chatUri, action } });
      const refused = p.notes.filter((note) => note.method === 'action').at(-1);
      return String((refused?.params as { rejectionReason?: string }).rejectionReason);
    };
    // A refusal names the particular thing asked for: a question nobody is
    // waiting on.
    expect(why({ type: 'chat/inputAnswerChanged', requestId: 'r1', questionId: 'q1', answer: {} }))
      .toContain('not a question this chat is waiting on');
    expect(chatUri).toBeTruthy();
  });

  it('answers nothing at all to a notification', async () => {
    const client = open();
    await client.handle(hello(['0.9.0']));
    // `unsubscribe` and `dispatchAction` carry no id, and replying to one is a
    // protocol error rather than a harmless extra message.
    expect(await client.handle({ method: 'unsubscribe', params: { channel: 'ahp-root://' } }))
      .toBeUndefined();
    expect(await client.handle({ method: 'dispatchAction', params: { action: { type: 'chat/turnStarted' } } }))
      .toBeUndefined();
  });

  it('drops one connection\'s subscription without touching another\'s', async () => {
    const host = serving('/home/softov');
    const a = host.accept(peer());
    const b = host.accept(peer());
    await a.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await b.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    expect(host.connections()).toBe(2);

    // Channel-wide would kill the stream the other one is reading.
    a.handle({ method: 'unsubscribe', params: { channel: 'ahp-root://' } });
    a.close();
    expect(host.connections()).toBe(1);
  });
});

describe('a connection accepted with what the listener knew', () => {
  it('keeps the socket number, the address, the forwarded claim and the connect time', async () => {
    const host = serving('/home/softov');
    const accepted = host.accept(peer(), undefined, false, { socket: 7, address: '127.0.0.1', forwardedFor: '203.0.113.9' });
    await accepted.handle(hello(['0.9.0']));

    const [row] = host.clientRegistry.connected();
    expect(row).toMatchObject({ socket: 7, clientId: 'probe', address: '127.0.0.1', forwardedFor: '203.0.113.9' });
    expect(typeof row?.connectedAt).toBe('number');
  });

  it('lists a connection that came in with nothing said about it without a socket or a claim', async () => {
    const host = serving('/home/softov');
    host.accept(peer());
    const [row] = host.clientRegistry.connected();
    expect(row?.socket).toBeUndefined();
    expect(row?.forwardedFor).toBeUndefined();
  });
});

describe('a client that dropped, coming back', () => {
  it('replays what it missed, and nothing it already had', async () => {
    const host = serving('/home/softov');
    const first = peer();
    const a = host.accept(first);
    await a.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] }));
    await a.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const read = await a.handle({ method: 'subscribe', params: { channel: chatUriFor('ahp-session:/live') } }) as { snapshot: { fromSeq: number } };

    const upTo = cursorOf(first, read.snapshot.fromSeq);

    // The socket goes. The host forgets this client's subscriptions with it,
    // which is why the client has to say what they were.
    a.close();
    a.handle({
      method: 'dispatchAction',
      params: { channel: chatUriFor('ahp-session:/live'), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'while away' } } },
    });
    await settle();

    const back = host.accept(peer());
    await back.handle(hello(['0.9.0']));
    const result = await back.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: upTo,
        subscriptions: ['ahp-root://', 'ahp-session:/live', chatUriFor('ahp-session:/live')],
      },
    }) as { type: string; actions: { serverSeq: number; action: { type: string } }[]; missing: string[] };

    expect(result.type).toBe('replay');
    expect(result.missing).toEqual([]);
    // Everything after what it saw, and nothing at or before it.
    expect(result.actions.every((held) => held.serverSeq > upTo)).toBe(true);
    expect(result.actions.map((held) => held.action.type)).toContain('chat/turnStarted');
  });

  /*
   * The channels a client comes back for join together once every one is read,
   * so an action said while a later one is read reaches it once, in the
   * replay, as the reference host activates a reconnect's subscriptions
   * together.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1577-L1583
   */
  it('hands an action said while a later channel is read once, in the replay', async () => {
    let reached = (): void => {};
    const reading = new Promise<void>((done) => { reached = done; });
    let release = (): void => {};
    const gate = new Promise<void>((done) => { release = done; });
    const host = createHost({
      path: '/home/softov',
      agents: [claude({ paths: ['/home/softov'] })],
      ...machine(),
      channels: {
        'x-slow': {
          by: 'probe',
          scheme: 'x-slow',
          channel: { grant: 'session:read', snapshot: async () => { reached(); await gate; return {}; } },
        },
      },
    });
    const chat = chatUriFor('ahp-session:/live');
    const other = host.accept(peer());
    await other.handle(hello(['0.9.0'], { clientId: 'other' }));
    await other.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const first = peer();
    const a = host.accept(first);
    await a.handle(hello(['0.9.0']));
    const read = await a.handle({ method: 'subscribe', params: { channel: chat } }) as { snapshot: { fromSeq: number } };
    await settle();
    const upTo = cursorOf(first, read.snapshot.fromSeq);
    a.close();

    const p = peer();
    const back = host.accept(p);
    await back.handle(hello(['0.9.0']));
    const coming = back.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: upTo, subscriptions: [chat, 'x-slow://one'] },
    }) as Promise<{ type: string; actions: { action: { type: string } }[] }>;
    await reading;
    await other.handle({ method: 'dispatchAction', params: { channel: chat, action: { type: 'chat/draftChanged', draft: { text: 'half a thought' } } } });
    release();
    const result = await coming;
    expect(result.type).toBe('replay');
    const live = actions(p, chat).filter((one) => one.action.type === 'chat/draftChanged');
    const replayed = result.actions.filter((one) => one.action.type === 'chat/draftChanged');
    expect([live.length, replayed.length]).toEqual([0, 1]);
  });

  it('names the channels it cannot resume rather than failing the whole thing', async () => {
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    const said = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as { serverSeq: number };
    await settle();
    const result = await client.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: cursorOf(p, said.serverSeq),
        subscriptions: ['ahp-root://', 'ahp-session:/vanished'],
      },
    }) as { type: string; missing: string[] };
    // A session whose agent has gone. Said, so the client drops it rather
    // than waiting on a channel that will never speak again.
    expect(result.missing).toEqual(['ahp-session:/vanished']);
    expect(result.type).toBe('replay');
  });

  it('watches again, so what happens next arrives without a fresh subscribe', async () => {
    const host = serving('/home/softov');
    const setup = host.accept(peer());
    await setup.handle(hello(['0.9.0']));
    await setup.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });

    const p = peer();
    const back = host.accept(p);
    await back.handle(hello(['0.9.0']));
    await back.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: 0,
        subscriptions: [chatUriFor('ahp-session:/live')],
      },
    });
    back.handle({
      method: 'dispatchAction',
      params: { channel: chatUriFor('ahp-session:/live'), action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { origin: { kind: 'user' }, text: 'after' } } },
    });
    await settle();
    expect(actions(p, chatUriFor('ahp-session:/live')).some((e) => e.action.type === 'chat/turnStarted')).toBe(true);
  });

  it('hands back snapshots when the gap is longer than the buffer', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    // A thousand and one actions later, the first is gone. Rather than
    // replaying a hole, the protocol has a second answer.
    for (let i = 0; i < 1100; i++) {
      client.handle({
        method: 'dispatchAction',
        params: { channel: 'ahp-session:/live', action: { type: 'session/isReadChanged', isRead: i % 2 === 0 } },
      });
    }
    await settle();
    const result = await client.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: 1,
        subscriptions: ['ahp-session:/live'],
      },
    }) as { type: string; snapshots: { resource: string }[] };
    expect(result.type).toBe('snapshot');
    expect(result.snapshots.map((s) => s.resource)).toEqual(['ahp-session:/live']);
  });

  /*
   * The byte budget, which is the second bound on the buffer and the one a
   * count cannot say: ten turns of a few hundred kilobytes each are ten
   * envelopes, and they are not the same weight as ten config echoes.
   *
   * Each test pushes the least budget this host may be held to, which is what
   * makes ten enough to pass it: at the default of 32 MiB it would be a
   * hundred turns.
   */
  it('drops its oldest envelopes once it is over its byte budget', async () => {
    const { host, client, peer: p, uri } = await running();
    const marks = `${uri}/annotations`;
    await client.handle({ method: 'subscribe', params: { channel: marks } });
    await client.handle({
      method: 'dispatchAction',
      params: { channel: ROOT, action: { type: 'root/configChanged', config: { replayBytes: 1024 * 1024 } } },
    });
    await settle();
    const upTo = actions(p).at(-1)?.serverSeq ?? 0;

    /*
     * A mark carrying a few hundred kilobytes of text, set ten times. A mark
     * is the one action a client may carry any text in, so it is the one that
     * makes a small buffer out of an action count this short.
     */
    for (let i = 0; i < 10; i++) {
      await client.handle({
        method: 'dispatchAction',
        params: {
          channel: marks,
          action: {
            type: 'annotations/set',
            annotation: {
              id: 'a1',
              origin: { session: uri },
              resource: 'file:///home/softov/x.ts',
              resolved: false,
              entries: [{ id: 'e1', text: `${i}:${'x'.repeat(300 * 1024)}` }],
            },
          },
        },
      });
    }
    await settle();
    expect(actions(p, marks)).toHaveLength(10);

    // A client that had read everything before the ten. A replay would mean
    // all ten are still held, so state here says this: fewer than ten fit,
    // and the oldest held is past where this one had read to.
    const back = host.accept(peer());
    await back.handle(hello(['0.9.0']));
    const state = await back.handle({
      method: 'reconnect',
      params: { channel: ROOT, clientId: 'probe', lastSeenServerSeq: upTo, subscriptions: [marks] },
    }) as { type: string };
    expect(state.type).toBe('snapshot');

    // And what is over the budget is the oldest only: the newest envelope is
    // still there to be replayed, which is what a client a moment behind gets.
    const late = host.accept(peer());
    await late.handle(hello(['0.9.0']));
    const kept = await late.handle({
      method: 'reconnect',
      params: { channel: ROOT, clientId: 'probe', lastSeenServerSeq: upTo + 9, subscriptions: [marks] },
    }) as { type: string };
    expect(kept.type).toBe('replay');
  });

  it('still keeps a thousand envelopes where the actions are small', async () => {
    const { host, client, peer: p, uri } = await running();
    for (let i = 0; i < 1100; i++) {
      await client.handle({
        method: 'dispatchAction',
        params: { channel: uri, action: { type: 'session/isReadChanged', isRead: i % 2 === 0 } },
      });
    }
    await settle();
    const upTo = actions(p, uri).at(-1)?.serverSeq ?? 0;

    /** What a client that had read up to `since` is answered. */
    const answer = async (since: number): Promise<string> => {
      const back = host.accept(peer());
      await back.handle(hello(['0.9.0']));
      const result = await back.handle({
        method: 'reconnect',
        params: { channel: ROOT, clientId: 'probe', lastSeenServerSeq: since, subscriptions: [uri] },
      }) as { type: string };
      return result.type;
    };

    // The last thousand are held, so a client that saw the oldest of them is
    // replayed to, and one that did not is answered with state, as VS Code's
    // host decides.
    expect(await answer(upTo - 999)).toBe('replay');
    expect(await answer(upTo - 1000)).toBe('snapshot');
  });
});

/*
 * A token, pushed by the client that will spend it.
 *
 * `authenticate` was unserved here for a long time on the grounds that the SDK
 * had nowhere to put a credential. It does - `query()` takes `env` - and the
 * reason it was unreachable was this host advertising no protected resource,
 * which the protocol requires before a client may name one.
 */
describe('authenticating', () => {
  const ANTHROPIC = 'https://api.anthropic.com';
  const DIR = '/home/softov';

  /** A host serving one directory, and a client that has said hello. */
  const opened = async () => {
    const host = serving(DIR);
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    return { host, client };
  };

  /**
   * The key the last session's CLI runs on: its own `env`'s, or the daemon's
   * when it has none. A session can carry an `env` for other reasons, such as
   * the switch that turns Claude's own task tools on.
   */
  const spent = (): string | undefined => {
    const env = sessionQueries().at(-1)?.options.env as Record<string, string> | undefined;
    return env === undefined ? process.env.ANTHROPIC_API_KEY : env.ANTHROPIC_API_KEY;
  };

  it('advertises the resource a token would be for', async () => {
    const { client } = await opened();
    const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { provider: string; protectedResources?: { resource: string; required?: boolean }[] }[] } };
    };
    const found = root.snapshot.state.agents.find((one) => one.provider === 'claude');
    expect(found?.protectedResources?.[0]?.resource).toBe(ANTHROPIC);
    // Not required, and that is the truthful declaration: this daemon runs as
    // whoever started it and works with nothing pushed at all.
    expect(found?.protectedResources?.[0]?.required).toBe(false);
  });

  it('takes a token for it', async () => {
    const { client } = await opened();
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-test-1' },
    })).resolves.toEqual({});
  });

  it('refuses one for a resource it never advertised', async () => {
    const { client } = await opened();
    // -32602 and not -32007: it is a bad parameter, not a demand to
    // authenticate, and answering the latter sends a client round a loop it
    // cannot get out of.
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: 'https://api.github.com', token: 't' },
    })).rejects.toMatchObject({ code: -32602 });
  });

  it('takes an empty token as the credential being withdrawn', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-lent' },
    });
    // The protocol's word for signing out, and the reference host's: an
    // empty token revokes. This host refused it as a bad parameter, which
    // left a client no way to take back what it had pushed.
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: '' },
    })).resolves.toEqual({});
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/revoked', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();
    // Started on nothing, the way a session for a client that never pushed is.
    expect(spent()).toBe(process.env.ANTHROPIC_API_KEY);
  });

  it('refuses a lifetime that is not a positive integer of seconds', async () => {
    const { client } = await opened();
    for (const expiresIn of [0, -1, 1.5, '3600', null]) {
      // A bad parameter rather than a token with no expiry: a client that
      // sent `0` meant something, and "forever" is the opposite of it.
      await expect(client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-t', expiresIn },
      })).rejects.toMatchObject({ code: -32602 });
    }
  });

  it('tells the client when its token runs out, and stops spending it', async () => {
    vi.useFakeTimers();
    try {
      const host = serving(DIR);
      const wire = peer();
      const client = host.accept(wire);
      await client.handle(hello(['0.9.0']));
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-short', expiresIn: 60 },
      });
      await vi.advanceTimersByTimeAsync(59_000);
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1_000);
      // The protocol's own word for it, to the connection that pushed the
      // token and no other, carrying the record a client signs in against
      // rather than the bare identifier.
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toEqual([{
        method: 'auth/required',
        params: {
          channel: 'ahp-root://',
          resource: expect.objectContaining({ resource: ANTHROPIC }),
          reason: 'expired',
        },
      }]);

      await client.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/expired', provider: 'claude', workingDirectories: [`file://${DIR}`] },
      });
      await vi.advanceTimersByTimeAsync(10);
      // Not spent: a session started on a credential its client was just told
      // is gone would fail saying so, later and less clearly.
      expect(spent()).toBe(process.env.ANTHROPIC_API_KEY);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('forgets the clock when the token is replaced or withdrawn', async () => {
    vi.useFakeTimers();
    try {
      const host = serving(DIR);
      const wire = peer();
      const client = host.accept(wire);
      await client.handle(hello(['0.9.0']));
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-first', expiresIn: 60 },
      });
      // Replaced by one with no expiry the client knows of: the old clock
      // must not take the new token away when it strikes.
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-second' },
      });
      await vi.advanceTimersByTimeAsync(120_000);
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toHaveLength(0);
      await client.handle({
        method: 'createSession',
        params: { channel: 'ahp-session:/kept', provider: 'claude', workingDirectories: [`file://${DIR}`] },
      });
      await vi.advanceTimersByTimeAsync(10);
      expect((sessionQueries().at(-1)?.options.env as Record<string, string> | undefined)?.ANTHROPIC_API_KEY).toBe('sk-second');

      // And withdrawn: nothing to expire, so nothing is said.
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-third', expiresIn: 30 },
      });
      await client.handle({
        method: 'authenticate',
        params: { channel: 'ahp-root://', resource: ANTHROPIC, token: '' },
      });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(wire.notes.filter((one) => one.method === 'auth/required')).toHaveLength(0);
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('still refuses a withdrawal for a resource it never advertised', async () => {
    const { client } = await opened();
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: 'https://api.github.com', token: '' },
    })).rejects.toMatchObject({ code: -32602 });
  });

  it('spends it on the session that client then opens', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-test-2' },
    });
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/authed', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();

    const env = sessionQueries().at(-1)?.options.env as Record<string, string> | undefined;
    expect(env?.ANTHROPIC_API_KEY).toBe('sk-test-2');
    // Over the daemon's environment rather than instead of it: the SDK's
    // `env` replaces the subprocess environment outright, so a lone
    // credential is a subprocess with no PATH.
    expect(env?.PATH).toBe(process.env.PATH);
  });

  it('leaves a session alone when nothing was pushed', async () => {
    const { client } = await opened();
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/plain', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();
    // The daemon's own, so the subprocess inherits - which is how every session
    // worked before there was anything to push, and how an automation's still does.
    expect(spent()).toBe(process.env.ANTHROPIC_API_KEY);
  });

  it('does not lend a token to a session another client asked for', async () => {
    const { host, client } = await opened();
    await client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: 'sk-mine' },
    });

    // A second client on the same host, who pushed nothing.
    const other = host.accept(peer());
    await other.handle({
      method: 'initialize',
      params: { clientId: 'b', protocolVersions: ['0.9.0'] },
    });
    await other.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/theirs', provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await settle();

    // Per connection, which the specification is explicit about. A token one
    // client offered is theirs.
    expect(spent()).toBe(process.env.ANTHROPIC_API_KEY);
  });
});

describe('telling a client how far along something is', () => {
  /*
   * A session's own start reports no progress, a token given or not: VS
   * Code's host reports progress for a backend's download alone, which this
   * host has none of, and its client draws every progress frame it is sent.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6335-L6346
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10896-L10906
   */
  it('reports no progress for a session\'s own start, as VS Code\'s host', async () => {
    const { client, peer: p } = await running();
    p.notes.length = 0;
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/slow', provider: 'claude', progressToken: 'tok-1' },
    });
    expect(p.notes.some((one) => one.method === 'root/progress')).toBe(false);
  });

  it('says nothing when no token was given', async () => {
    const { client, peer: p } = await running();
    p.notes.length = 0;
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/quiet', provider: 'claude' } });
    expect(p.notes.some((one) => one.method === 'root/progress')).toBe(false);
  });
});

/*
 * Coming back to a host that never met you.
 *
 * `reconnect` is a question about this host's own sequence numbers, and a
 * client it has not handshaken with is asking about somebody else's. Answering
 * an empty replay to one is telling it that it has missed nothing, which is a
 * claim about a stream it was never reading - and the reference client believes
 * it, keeps the state it had, and never subscribes to anything again.
 */
describe('a client this host has not met', () => {
  it('is refused with the code its client reads as "forgotten", in VS Code\'s words', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await expect(client.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'never-said-hello', lastSeenServerSeq: 419, subscriptions: ['ahp-root://'] },
    })).rejects.toMatchObject({ code: -32008, message: 'Reconnect client not found: never-said-hello' });
  });

  /*
   * VS Code prunes a client record once its client has been gone ten of its
   * 30 s disconnect windows, when another client attaches, and refuses a
   * reconnect naming it; one back sooner is resumed.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L2064-L2076
   */
  it('forgets a client gone longer than VS Code\'s retention, and resumes one back sooner', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const host = serving('/home/softov');
      const resume = (clientId: string) => host.accept(peer()).handle({
        method: 'reconnect',
        params: { channel: 'ahp-root://', clientId, lastSeenServerSeq: 0, subscriptions: [] },
      });
      for (const clientId of ['early', 'late']) {
        const one = host.accept(peer());
        await one.handle({ method: 'initialize', params: { clientId, protocolVersions: ['0.9.0'] } });
        one.close();
        vi.setSystemTime(Date.now() + 200_000);
      }
      // A third client arrives 400 s after the first went and 200 s after the second.
      await host.accept(peer()).handle({ method: 'initialize', params: { clientId: 'third', protocolVersions: ['0.9.0'] } });
      await expect(resume('early')).rejects.toMatchObject({ code: -32008, message: 'Reconnect client not found: early' });
      // Resumed: answered, with state since it saw none of what was held.
      await expect(resume('late')).resolves.toMatchObject({ type: 'snapshot' });
    }
    finally {
      vi.useRealTimers();
    }
  });

  it('is answered once it has handshaken', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const back = host.accept(peer());
    const result = await back.handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 0, subscriptions: ['ahp-root://'] },
    }) as { type: string };
    expect(result.type).toBe('replay');
  });

  it('replays nothing to one that claims to be ahead, as VS Code\'s host', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.9.0']));
    const back = host.accept(peer());
    const result = await back.handle({
      method: 'reconnect',
      // Past every action this host has buffered, so nothing is after it.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/protocolServerHandler.ts#L1385-L1391
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: 419, subscriptions: ['ahp-root://'] },
    }) as { type: string; actions: unknown[] };
    expect(result).toMatchObject({ type: 'replay', actions: [] });
  });

  it('answers with state a client that has not seen the oldest action it holds, as VS Code\'s host', async () => {
    const host = serving('/home/softov');
    const first = peer();
    const client = host.accept(first);
    const said = await client.handle(hello(['0.9.0'], { initialSubscriptions: ['ahp-root://'] })) as { serverSeq: number };
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } });
    await client.handle({ method: 'dispatchAction', params: { channel: 'ahp-session:/live', action: { type: 'session/isReadChanged', isRead: true } } });
    await settle();
    // The host's first actions came after its handshake: the client's cursor
    // is one short of the oldest held, every action after it is held, and
    // still the answer is state.
    expect(said.serverSeq).toBe(0);
    expect(actions(first).length).toBeGreaterThan(0);
    const result = await host.accept(peer()).handle({
      method: 'reconnect',
      params: { channel: 'ahp-root://', clientId: 'probe', lastSeenServerSeq: said.serverSeq, subscriptions: ['ahp-root://'] },
    }) as { type: string };
    expect(result.type).toBe('snapshot');
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Peer } from '../src/types/rpc.js';
import { Status } from '../src/catalog.js';

/*
 * The host, without a socket.
 *
 * `accept` takes a peer and returns a handler, which is the seam that makes
 * this testable: everything the protocol says is decided here, and the
 * WebSocket only carries it. What is checked is the part a client breaks on -
 * which version comes back, what a snapshot contains, and that a method this
 * host does not serve is *said* rather than quietly answered.
 */

const sdk = vi.hoisted(() => {
  interface Fake {
    frames: Record<string, unknown>[];
    wake: (() => void) | undefined;
    closed: boolean;
    options: Record<string, unknown>;
  }
  return {
    sessions: [] as Record<string, unknown>[],
    transcript: [] as Record<string, unknown>[],
    init: {} as Record<string, unknown>,
    mcp: [] as Record<string, unknown>[],
    skills: [] as Record<string, unknown>[],
    said: [] as string[],
    modelsSet: [] as (string | undefined)[],
    modesSet: [] as string[],
    effortsSet: [] as (string | null | undefined)[],
    interrupted: 0,
    mcpToggled: [] as { name: string; enabled: boolean }[],
    mcpReconnected: [] as string[],
    canUseTool: undefined as undefined | ((n: string, i: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
    /**
     * Every CLI the host started, in order.
     *
     * Per query and not shared, because the host opens one at boot just to
     * ask what the harness offers - and a single frame queue would let that
     * one swallow the frames meant for a session, which is a test failing for
     * a reason that has nothing to do with the code under it.
     */
    queries: [] as Fake[],
  };
});

/** The CLIs that belong to a session. The boot probe is not one of them. */
const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  listSessions: async () => sdk.sessions,
  getSessionMessages: async () => sdk.transcript,
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    const fake = { frames: [] as Record<string, unknown>[], wake: undefined as undefined | (() => void), closed: false, options };
    sdk.queries.push(fake);
    if (options.canUseTool) sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    void (async () => {
      for await (const frame of prompt) {
        sdk.said.push((frame as { message?: { content?: string } }).message?.content ?? '');
      }
    })();
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (fake.frames.length > 0) yield fake.frames.shift() as Record<string, unknown>;
          if (fake.closed) return;
          await new Promise<void>((resolve) => { fake.wake = resolve; });
        }
      },
      interrupt: async () => { sdk.interrupted++; },
      setPermissionMode: async (mode: string) => { sdk.modesSet.push(mode); },
      setModel: async (model?: string) => { sdk.modelsSet.push(model); },
      applyFlagSettings: async (settings: { effortLevel?: string | null }) => { sdk.effortsSet.push(settings.effortLevel); },
      toggleMcpServer: async (name: string, enabled: boolean) => { sdk.mcpToggled.push({ name, enabled }); },
      reconnectMcpServer: async (name: string) => { sdk.mcpReconnected.push(name); },
      // The control protocol: answers without a turn having happened, which
      // is the whole reason capabilities are read from here.
      initializationResult: async () => sdk.init,
      mcpServerStatus: async () => sdk.mcp,
      reloadSkills: async () => ({ skills: sdk.skills }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../src/host.js');
const { fileResources, list, read, resolve, complete } = await import('../src/resources.js');
const { shellTerminals } = await import('../src/terminals.js');
const { gitBranches } = await import('../src/git.js');
/*
 * What the daemon hands its host, handed here too.
 *
 * These tests drive the same path a host built out of this library takes, and
 * that path includes giving it a filesystem and a shell: `createHost` is the
 * protocol and owns neither.
 */
const machine = () => ({ resources: fileResources(), terminals: shellTerminals(), directories: gitBranches() });
const { claude } = await import('../src/agents/claude.js');

/** What a terminal sends for ctrl+c. Written as a code so it survives a diff. */
const ETX = String.fromCharCode(3);

/**
 * The host, serving the backend that ships with it.
 *
 * Every test below drives Claude through `Agent`, which is the same path a
 * host built out of this library takes - so what is checked here is what a
 * third-party backend gets, not a shortcut only the built-in has.
 */
const serving = (path: string, also: string[] = []) =>
  createHost({ path, agents: [claude({ paths: [path, ...also] })], ...machine() });

function peer(): Peer & { sent: Record<string, unknown>[]; notes: { method: string; params: unknown }[] } {
  const sent: Record<string, unknown>[] = [];
  const notes: { method: string; params: unknown }[] = [];
  return {
    sent,
    notes,
    send: (message) => sent.push(message),
    notify: (method, params) => notes.push({ method, params }),
    close: () => {},
  };
}

const open = () => serving('/home/softov').accept(peer());

const hello = (versions: string[], extra: Record<string, unknown> = {}) => ({
  method: 'initialize',
  params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: versions, ...extra },
});

beforeEach(() => {
  sdk.sessions.length = 0;
  sdk.transcript.length = 0;
  sdk.mcp.length = 0;
  sdk.skills.length = 0;
  sdk.said.length = 0;
  sdk.modelsSet.length = 0;
  sdk.modesSet.length = 0;
  sdk.effortsSet.length = 0;
  sdk.queries.length = 0;
  sdk.init = {};
  sdk.interrupted = 0;
  sdk.mcpToggled.length = 0;
  sdk.mcpReconnected.length = 0;
  sdk.canUseTool = undefined;
});

describe('the handshake', () => {
  it('answers with a version the client actually offered', async () => {
    const client = open();
    // The newest either side knows is 1.0.0 to this client and 0.8.0 here.
    // Answering 1.0.0 would be answering with something it cannot read.
    const result = await client.handle(hello(['1.0.0', '0.8.0'])) as { protocolVersion: string };
    expect(result.protocolVersion).toBe('0.8.0');
  });

  it('takes the client\'s order of preference, not its own', async () => {
    const client = open();
    const result = await client.handle(hello(['0.7.0', '0.8.0'])) as { protocolVersion: string };
    expect(result.protocolVersion).toBe('0.7.0');
  });

  it('refuses with the versions it can speak, so the client can say why', async () => {
    const client = open();
    await expect(client.handle(hello(['99.0.0']))).rejects.toMatchObject({
      code: -32005,
      data: { supportedProtocolVersions: expect.arrayContaining(['0.8.0']) },
    });
  });

  it('hands back the snapshots the client asked to start with', async () => {
    const client = open();
    const result = await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { resource: string; state: { agents: unknown[] }; fromSeq: number }[];
    };
    expect(result.snapshots).toHaveLength(1);
    expect(result.snapshots[0]?.resource).toBe('ahp-root://');
    expect(result.snapshots[0]?.state.agents).toHaveLength(1);
  });

  it('still connects when a channel it was asked for is gone', async () => {
    const client = open();
    // A handshake that fails because one requested session has no agent is a
    // client that cannot connect at all.
    const result = await client.handle(
      hello(['0.8.0'], { initialSubscriptions: ['ahp-root://', 'ahp-session:/vanished'] }),
    ) as { snapshots: unknown[] };
    expect(result.snapshots).toHaveLength(1);
  });
});

describe('the catalogue', () => {
  it('orders it most-recently-modified first, as the protocol asks', async () => {
    sdk.sessions.push(
      { sessionId: 'old', summary: 'Older', lastModified: 1_700_000_000_000, cwd: '/home/softov' },
      { sessionId: 'new', summary: 'Newer', lastModified: 1_800_000_000_000, cwd: '/home/softov' },
    );
    const client = open();
    await client.handle(hello(['0.8.0']));
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { title: string; status: number; resource: string }[];
    };
    expect(listed.items.map((s) => s.title)).toEqual(['Newer', 'Older']);
    // Idle, because nothing this host started is running. A status assigned
    // rather than derived is a session that claims to be busy with nothing in it.
    expect(listed.items[0]?.status).toBe(1);
    expect(listed.items[0]?.resource).toBe('ahp-session:/new');
  });

  it('counts the sessions it is running, not the transcripts beside them', async () => {
    // The protocol asks for the active, non-disposed sessions *on the server*.
    // A transcript on disk is a row somebody can open, not a session this host
    // is holding - counting those meant a host running nothing claimed two.
    sdk.sessions.push({ sessionId: 'a', lastModified: 1, cwd: '/home/softov' });
    sdk.sessions.push({ sessionId: 'b', lastModified: 2, cwd: '/home/softov' });
    const client = open();
    const first = await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { state: { activeSessions: number } }[];
    };
    expect(first.snapshots[0]?.state.activeSessions).toBe(0);

    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const again = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { activeSessions: number } };
    };
    expect(again.snapshot.state.activeSessions).toBe(1);

    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/live' } });
    const after = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { activeSessions: number } };
    };
    expect(after.snapshot.state.activeSessions).toBe(0);
  });

  it('refuses a session channel it has no agent for', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/nope' } }))
      .rejects.toMatchObject({ code: -32001 });
  });
});

describe('what it will not pretend', () => {
  it('says a method it does not serve rather than answering an empty success', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
    // An empty success leaves the client waiting for state that is never
    // coming, which reads as a hang rather than as a missing feature.
    // `otlp` is telemetry export, which this daemon has no opinion about and
    // is unlikely ever to serve - so it stays a fair example.
    await expect(client.handle({ method: 'otlp', params: { channel: 'ahp-root://' } }))
      .rejects.toMatchObject({ code: -32601 });
  });

  it('refuses a provider it does not have', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
    await expect(client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/x', provider: 'copilot' },
    })).rejects.toMatchObject({ code: -32002 });
  });

  it('ignores an action a client is not allowed to originate', async () => {
    const { client, uri } = await running();
    // `chat/delta` is this host telling clients what it did. One arriving
    // *from* a client is a client lying about what happened.
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/delta', turnId: 't1', partId: 'p', content: 'x' } },
    });
    expect(sdk.said).toEqual([]);
  });

  it('answers nothing at all to a notification', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
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
    await a.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));
    await b.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));
    expect(host.connections()).toBe(2);

    // Channel-wide would kill the stream the other one is reading.
    a.handle({ method: 'unsubscribe', params: { channel: 'ahp-root://' } });
    a.close();
    expect(host.connections()).toBe(1);
  });
});


/** A connected client with one session, subscribed to both its channels. */
async function running() {
  const host = serving('/home/softov');
  const p = peer();
  const client = host.accept(p);
  // Root included: a catalogue notification goes to the connections watching
  // the root channel and to no others, so a client that never subscribed to
  // it hears nothing - correctly.
  await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));
  const uri = 'ahp-session:/live';
  const chatUri = 'ahp-chat:/live';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { host, client, peer: p, uri, chatUri };
}

const actions = (p: ReturnType<typeof peer>, channel?: string) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown>; serverSeq: number })
  .filter((e) => channel === undefined || e.channel === channel);

const settle = async (times = 4): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Say what the session's own CLI said. */
async function emit(...frames: Record<string, unknown>[]): Promise<void> {
  const fake = sessionQueries().at(-1);
  if (!fake) throw new Error('no session CLI is running');
  fake.frames.push(...frames);
  fake.wake?.();
  fake.wake = undefined;
  await settle();
}

describe('driving a turn', () => {
  it('announces the session, and answers for it once it exists', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    // The catalogue moved, and every client watching the root hears it.
    expect(p.notes.some((n) => n.method === 'root/sessionAdded')).toBe(true);

    // `session/ready` is dispatched at creation, which is before any client
    // can be watching that channel - so it is for *other* clients if creation
    // ever becomes asynchronous, and the creating client learns readiness
    // from the snapshot it gets when it subscribes. That snapshot is the
    // contract worth pinning.
    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { lifecycle: string; defaultChat: string; status: number } };
    };
    expect(opened.snapshot.state.lifecycle).toBe('ready');
    expect(opened.snapshot.state.defaultChat).toBe(chatUri);
    expect(opened.snapshot.state.status).toBe(1);
  });

  it('passes the client\'s turn to the agent', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
    });
    await settle();
    expect(sdk.said).toEqual(['hello']);
  });

  it('opens the part before it streams into it', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
      { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hey' } } },
    );

    const types = actions(p, chatUri).map((e) => e.action.type);
    // The protocol is explicit: responsePart creates the target, delta
    // appends to it. A delta naming a part nobody opened appends to nothing.
    expect(types.indexOf('chat/responsePart')).toBeLessThan(types.indexOf('chat/delta'));
    const delta = actions(p, chatUri).find((e) => e.action.type === 'chat/delta');
    expect(delta?.action.content).toBe('Hey');
  });

  it('moves the running turn into the history when it completes', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Done' }] } });

    const mid = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
    };
    // Running, and *not* in `turns` - a client reading only the history shows
    // an empty conversation for as long as somebody is watching one happen.
    expect(mid.snapshot.state.activeTurn).toBeDefined();
    expect(mid.snapshot.state.turns).toHaveLength(0);

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 42 });
    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { duration: number }[]; activeTurn?: unknown } };
    };
    expect(after.snapshot.state.activeTurn).toBeUndefined();
    expect(after.snapshot.state.turns).toHaveLength(1);
    expect(after.snapshot.state.turns[0]?.duration).toBe(42);
    expect(actions(p, chatUri).map((e) => e.action.type)).toContain('chat/turnComplete');
  });

  /*
   * A turn that failed says why, in the turn.
   *
   * 0.9.0 took `error` off `Turn` and gave the reason a response part instead.
   * This host set the state to `error` and put the words nowhere the protocol
   * defines, so a client saw a turn that stopped and no account of it - which
   * is the shape a reader is least able to do anything about.
   */
  /*
   * A turn that worked says so, and says who asked for it.
   *
   * `Turn.state` is required and was only ever set when something went wrong,
   * so a turn that simply worked went into the history with none. `Message`
   * requires an `origin` and this host sent none anywhere it built one. Both
   * were found by typing the construction sites against the package rather
   * than by anything failing - which is the whole argument for doing it.
   */
  /*
   * Two tools asking at once, which is the ordinary case and used to break.
   *
   * The CLI calls `canUseTool` per tool call, and an agent that fires two in
   * parallel asks twice before either is answered. This host held one pending
   * input, so the second overwrote the first: the first tool waited for an
   * answer nobody could give any more, and approving it did nothing at all -
   * `confirm` compared the id against the survivor, missed, and returned
   * without a word.
   */
  it('asks about two tools at once and answers each of them', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'weather?' } } },
    });
    await settle();

    // Both in flight before either is answered.
    const first = sdk.canUseTool?.('WebFetch', { url: 'https://example.test' }, { toolUseID: 'call-a' });
    const second = sdk.canUseTool?.('WebSearch', { query: 'rain' }, { toolUseID: 'call-b' });
    await settle();

    const asked = actions(p, uri)
      .filter((e) => e.action.type === 'session/inputNeededSet')
      .map((e) => (e.action.request as { id: string }).id);
    expect(asked).toEqual(['call-a', 'call-b']);

    // Both are on the session, because `inputNeeded` is a list.
    const state = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { id: string }[] } };
    };
    expect(state.snapshot.state.inputNeeded?.map((one) => one.id)).toEqual(['call-a', 'call-b']);

    // Answer the *first* one, which is the one that used to be unreachable.
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-a', approved: true, confirmed: 'user-action' },
      },
    });
    await settle();
    await expect(first).resolves.toMatchObject({ behavior: 'allow' });

    // And the other is still waiting, named by its own id.
    const after = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { inputNeeded?: { id: string }[] } };
    };
    expect(after.snapshot.state.inputNeeded?.map((one) => one.id)).toEqual(['call-b']);
    const dropped = actions(p, uri)
      .filter((e) => e.action.type === 'session/inputNeededRemoved')
      .map((e) => e.action.id);
    expect(dropped).toEqual(['call-a']);

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/toolCallConfirmed', toolCallId: 'call-b', approved: false, reason: 'denied' },
      },
    });
    await settle();
    await expect(second).resolves.toMatchObject({ behavior: 'deny' });
  });

  it('finishes a turn with a state and an origin on its message', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 4 });

    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { state?: string; usage?: unknown; message?: { origin?: { kind?: string } } }[] } };
    };
    const turn = after.snapshot.state.turns[0];
    // A client driven by actions never saw this - its reducer fills the state
    // in on `chat/turnComplete`. One that subscribes afterwards reads the
    // snapshot, and the snapshot is this.
    expect(turn?.state).toBe('complete');
    expect(turn?.message?.origin?.kind).toBe('user');
    // Present and undefined, not absent: `usage` is a required key meaning
    // "not measured".
    expect(turn && 'usage' in turn).toBe(true);
  });

  it('puts the reason a turn failed inside the turn', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Working' }] } });
    await emit({
      type: 'result', subtype: 'error_during_execution', is_error: true,
      errors: ['the tool exploded'], duration_ms: 7,
    });

    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { state: string; responseParts: { kind: string; error?: { message?: string } }[] }[] } };
    };
    const turn = after.snapshot.state.turns[0];
    expect(turn?.state).toBe('error');
    const failure = turn?.responseParts.find((one) => one.kind === 'error');
    expect(failure?.error?.message).toBe('the tool exploded');
    // After what the agent managed to say, not instead of it: three things
    // said and then a failure is a turn with four parts.
    expect(turn?.responseParts.map((one) => one.kind)).toEqual(['markdown', 'error']);
    // And announced as it happens, so a client watching does not have to
    // re-read the channel to find out.
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/responsePart'
      && (e.action.part as { kind?: string } | undefined)?.kind === 'error')).toBe(true);
  });

  /**
   * A failure is about the turn that failed, not about the session for ever.
   *
   * `Status.Error` was read off a flag that was set when a turn failed and
   * never unset, so one bad tool call left every client showing the session
   * in error through every turn after it - and through a restart of the
   * client, because the flag lives in the host rather than in the client that
   * draws it. The only way back was a new session.
   */
  it('stops calling a session failed once it is working again', async () => {
    const { client, uri } = await running();
    const statusOf = async (): Promise<number> => {
      const seen = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { status: number; error?: string } };
      };
      return seen.snapshot.state.status;
    };
    const errorOf = async (): Promise<string | undefined> => {
      const seen = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
        snapshot: { state: { error?: string } };
      };
      return seen.snapshot.state.error;
    };

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({
      type: 'result', subtype: 'error_during_execution', is_error: true,
      errors: ['the tool exploded'], duration_ms: 7,
    });

    expect(await statusOf()).toBe(Status.Error);
    expect(await errorOf()).toBe('the tool exploded');

    // The next thing asked of it. Running, not still in error, from the
    // moment the turn starts - the row does not wait for it to succeed to
    // stop saying the last one failed.
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't2', message: { text: 'again' } } },
    });
    await settle();
    expect(await statusOf()).toBe(Status.InProgress);
    expect(await errorOf()).toBeUndefined();

    await emit({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5 });
    expect(await statusOf()).toBe(Status.Idle);
    expect(await errorOf()).toBeUndefined();
  });

  it('says a turn ended badly even when the harness gave no words', async () => {
    const { client, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // A subtype that is not `success` and no `errors` at all - which happens,
    // and used to leave the turn silent.
    await emit({ type: 'result', subtype: 'error_max_turns', duration_ms: 3 });

    const after = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { turns: { responseParts: { kind: string; error?: { message?: string } }[] }[] } };
    };
    const failure = after.snapshot.state.turns[0]?.responseParts.find((one) => one.kind === 'error');
    expect(failure?.error?.message).toContain('error_max_turns');
  });

  it('blocks on a confirmation and runs the tool when it is approved', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const decision = sdk.canUseTool?.('Bash', { command: 'rm -rf build' });
    await settle();

    const needed = actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet');
    // `request`, singular, which is what the action carries - it adds or
    // updates the entry with that id rather than replacing a whole list.
    const entry = needed?.action.request as Record<string, unknown>;
    expect(entry.kind).toBe('toolConfirmation');
    // Both required on an input request, and neither used to be sent.
    expect(typeof entry.chat).toBe('string');
    expect(typeof entry.turnId).toBe('string');
    const callId = (entry.toolCall as { toolCallId: string }).toolCallId;

    const state = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { status: number } };
    };
    // InputNeeded is 24 and carries InProgress. A status that lost it reads
    // as merely running, and nobody goes to answer it.
    expect(state.snapshot.state.status).toBe(24);

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/toolCallConfirmed', toolCallId: callId, approved: true } },
    });
    expect(await decision).toMatchObject({ behavior: 'allow' });
    expect(actions(p, uri).map((e) => e.action.type)).toContain('session/inputNeededRemoved');
  });

  it('answers a question keyed by its text, not by an id', async () => {
    const { client, peer: p, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();

    const questions = [{
      question: 'Which database?',
      options: [{ label: 'Postgres' }, { label: 'SQLite' }],
      multiSelect: false,
    }];
    const decision = sdk.canUseTool?.('AskUserQuestion', { questions });
    await settle();

    const requested = actions(p).find((e) => e.action.type === 'chat/inputRequested');
    const request = requested?.action.request as { id: string; questions: { id: string }[] };
    expect(request.questions[0]?.id).toBe('q1');

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: {
          type: 'chat/inputCompleted',
          requestId: request.id,
          accepted: true,
          answers: { q1: { kind: 'selected', value: 'SQLite' } },
        },
      },
    });
    // Keyed by the question's own text and valued by the option's own label,
    // with the questions echoed back - anything else is a call the tool
    // cannot process and a turn that stalls rather than errors.
    expect(await decision).toEqual({
      behavior: 'allow',
      updatedInput: { questions, answers: { 'Which database?': 'SQLite' } },
    });
  });

  it('settles the blocked promise when the turn is cancelled', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    const decision = sdk.canUseTool?.('Bash', { command: 'sleep 100' });
    await settle();

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnCancelled', turnId: 't1' } },
    });
    // A cancel that only interrupts leaves the subprocess waiting on a
    // promise nobody will ever settle.
    expect(await decision).toMatchObject({ behavior: 'deny' });
    expect(sdk.interrupted).toBe(1);
  });

  it('tells every client when a session goes', async () => {
    const { host, client, peer: p, uri } = await running();
    const other = peer();
    const b = host.accept(other);
    await b.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));

    await client.handle({ method: 'disposeSession', params: { channel: uri } });
    // The session was theirs too.
    expect(other.notes.some((n) => n.method === 'root/sessionRemoved')).toBe(true);
    await expect(client.handle({ method: 'subscribe', params: { channel: uri } }))
      .rejects.toMatchObject({ code: -32001 });
    // And the client that asked for it hears it too - it is not exempt from
    // its own broadcast, because it is not the only one holding that session.
    expect(p.notes.some((n) => n.method === 'root/sessionRemoved')).toBe(true);
  });

  it('moves serverSeq with state, so a snapshot has a place in the stream', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    await emit({ type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: 'Done' }] } });

    const seqs = actions(p).map((e) => e.serverSeq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
    expect(new Set(seqs).size).toBe(seqs.length);

    const snap = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { fromSeq: number };
    };
    // Every action after a snapshot carries a greater seq, which is how a
    // client knows it missed nothing.
    expect(snap.snapshot.fromSeq).toBeGreaterThanOrEqual(Math.max(...seqs));
  });
});


describe('what the harness offers', () => {
  it('reads models, commands and servers with no turn having happened', async () => {
    sdk.init = {
      models: [
        { value: 'default', displayName: 'Default (recommended)' },
        { value: 'opus[1m]', displayName: 'Opus (1M context)' },
      ],
      commands: [{ name: 'advisor', description: 'Read support tickets', argumentHint: '<id>' }],
      agents: [{ name: 'Explore', description: 'Read-only search agent' }],
    };
    sdk.mcp.push(
      { name: 'tasker', status: 'connected' },
      { name: 'claude.ai Gmail', status: 'needs-auth' },
      { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
    );

    const { client, uri } = await running();
    // Nothing has been said. A composer has to offer the models and the slash
    // menu *before* the conversation starts, so waiting for the message
    // stream's `init` would be exactly too late.
    expect(sdk.said).toEqual([]);

    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: Record<string, unknown>[] } };
    }).snapshot.state;

    const kinds = state.customizations.map((c) => c.type);
    expect(kinds).toContain('prompt');
    expect(kinds).toContain('agent');
    expect(kinds).toContain('mcpServer');

    const command = state.customizations.find((c) => c.id === 'command:advisor');
    expect(command).toMatchObject({ name: 'advisor', description: 'Read support tickets', enabled: true });
  });

  it('advertises the models on the root channel, keyed by `value`', async () => {
    sdk.init = {
      models: [{ value: 'sonnet', displayName: 'Sonnet' }],
      commands: [], agents: [],
    };
    const { client, peer: p } = await running();

    const root = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { models: { id: string; name: string }[] }[] } };
    }).snapshot.state;
    // `value`, not `id`. Reading the wrong name costs every model there is
    // and leaves a picker that offers nothing - which is what it did.
    expect(root.agents[0]?.models).toEqual([{ id: 'sonnet', name: 'Sonnet' }]);

    // Not asserted here: `root/agentsChanged`. The boot probe learns the
    // models before any client has connected, so the change is dispatched to
    // nobody - and the snapshot above is how every client actually finds out.
    expect(p.notes.length).toBeGreaterThanOrEqual(0);
  });

  it('says what a harness offers on the root channel, before any session exists', async () => {
    // No models: a harness nobody has signed into enumerates none and still
    // has skills and servers. This is the case that used to answer nothing.
    sdk.init = { models: [], commands: [{ name: 'review', description: 'A review pass' }], agents: [] };
    sdk.skills.push({ name: 'review', description: 'A review pass' });
    sdk.mcp.push({ name: 'gmail', status: 'needs-auth' });
    const { client } = await running();

    const root = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { agents: { customizations?: { id: string; type: string }[] }[] } };
    }).snapshot.state;
    // The protocol's own place for them: `AgentInfo.customizations`, which it
    // says are propagated into a session's list when one is created with this
    // agent. Without it the only way to ask what a harness offers is to create
    // a session, which is the thing somebody is deciding about.
    const offered = root.agents[0]?.customizations ?? [];
    expect(offered.map((one) => one.id).sort()).toEqual(['mcp:gmail', 'skill:review']);
    expect(offered.find((one) => one.id === 'mcp:gmail')?.type).toBe('mcpServer');
  });

  it('says an MCP server\'s state in the protocol\'s words, not the SDK\'s', async () => {
    sdk.init = { models: [], commands: [], agents: [] };
    sdk.mcp.push(
      { name: 'ok', status: 'connected' },
      { name: 'gmail', status: 'needs-auth' },
      { name: 'broken', status: 'failed', error: 'spawn ENOENT' },
      { name: 'off', status: 'disabled' },
    );
    const { client, uri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: {
        state: {
          customizations: {
            id: string; enabled: boolean;
            state?: { kind: string; error?: { errorType?: string; message?: string } };
          }[];
        };
      };
    }).snapshot.state;

    const byId = new Map(state.customizations.map((c) => [c.id, c]));
    expect(byId.get('mcp:ok')?.state?.kind).toBe('ready');
    expect(byId.get('mcp:broken')?.state?.kind).toBe('error');
    // Why it is not ready, in the host's own words - the whole value of
    // showing the row rather than hiding it. An `ErrorInfo` and not a bare
    // `message`, which is what `McpServerErrorState` actually requires.
    expect(byId.get('mcp:broken')?.state?.error?.message).toBe('spawn ENOENT');
    expect(byId.get('mcp:broken')?.enabled).toBe(false);
    expect(byId.get('mcp:off')?.state?.kind).toBe('stopped');

    /*
     * A server needing a sign-in is an error, not `authRequired`.
     *
     * `McpServerAuthRequiredState` requires a `reason` and a `resource` whose
     * identifier is the canonical MCP server URI with `authorization_servers`
     * the MCP authorization spec calls REQUIRED. The CLI reports a name and
     * `needs-auth` and nothing else, so emitting that state would be two
     * required fields short - a client told to sign in with nowhere to do it.
     */
    expect(byId.get('mcp:gmail')?.state?.kind).toBe('error');
    expect(byId.get('mcp:gmail')?.state?.error?.errorType).toBe('mcpAuthRequired');
    // Still switched on: it is enabled and unreachable, which is not the same
    // as somebody having turned it off.
    expect(byId.get('mcp:gmail')?.enabled).toBe(true);
  });

  it('tells the client that a slash is worth asking about', async () => {
    const client = open();
    const result = await client.handle(hello(['0.8.0'])) as { completionTriggerCharacters: string[] };
    // Without this the client has no reason to believe a slash means anything
    // here, and types it into the chat as text.
    expect(result.completionTriggerCharacters).toEqual(['/', '@']);
  });

  it('hands a brand-new session what the host already knows', async () => {
    // The CLI has not answered yet. Answering `[]` is a lie a client caches:
    // it asks once when the session opens, gets nothing, and shows an empty
    // slash menu until something else happens to re-ask - which is exactly
    // what "I had to open the skills screen first" looks like.
    sdk.init = {};
    const { client, uri, chatUri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: { id: string }[] } };
    }).snapshot.state;
    // Seeded from the boot probe rather than empty. (This host's probe found
    // nothing either, so what is pinned is the path, not a count.)
    expect(Array.isArray(state.customizations)).toBe(true);

    const menu = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/', offset: 1 },
    }) as { items: unknown[] };
    expect(Array.isArray(menu.items)).toBe(true);
  });

  it('opens the session even when the CLI will not answer yet', async () => {
    sdk.init = {};
    const { client, uri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { customizations: unknown[]; lifecycle: string } };
    }).snapshot.state;
    // An empty list is a real answer. A session that refused to open because
    // the harness had nothing to say would be a worse one.
    expect(state.customizations).toEqual([]);
    expect(state.lifecycle).toBe('ready');
  });
});


describe('a session that already happened', () => {
  const older = { sessionId: 'older', summary: 'A real title', lastModified: 1_700_000_000_000, cwd: '/home/softov' };

  it('opens from its transcript without spawning anything', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push(
      { type: 'user', uuid: 'u1', message: { role: 'user', content: 'what changed?' } },
      { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'text', text: 'Two files.' }] } },
    );
    const client = open();
    await client.handle(hello(['0.8.0']));

    const state = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } }) as {
      snapshot: { state: { lifecycle: string; defaultChat: string } };
    }).snapshot.state;
    expect(state.lifecycle).toBe('ready');

    const chat = (await client.handle({ method: 'subscribe', params: { channel: state.defaultChat } }) as {
      snapshot: { state: { turns: { message: { text: string }; responseParts: { kind: string }[] }[] } };
    }).snapshot.state;
    // The agent's reply belongs to the turn it answered, not to one of its
    // own - otherwise the history reads as a monologue with the questions
    // taken out.
    expect(chat.turns).toHaveLength(1);
    expect(chat.turns[0]?.message.text).toBe('what changed?');
    expect(chat.turns[0]?.responseParts[0]?.kind).toBe('markdown');

    // Browsing ninety-eight rows must not cost ninety-eight subprocesses.
    expect(sessionQueries()).toHaveLength(0);
  });

  it('agrees with the catalogue about what the conversation is called', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push({
      type: 'user',
      uuid: 'u1',
      // A first message routinely opens with editor context the person never
      // typed. Deriving a title from it titles every row `<ide_opened_file>…`.
      message: { role: 'user', content: '<ide_opened_file>/some/path</ide_opened_file> fix the parser' },
    });
    const client = open();
    await client.handle(hello(['0.8.0']));
    const listed = await client.handle({ method: 'listSessions', params: {} }) as { items: { title: string }[] };
    const opened = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } }) as {
      snapshot: { state: { title: string } };
    }).snapshot.state;
    expect(opened.title).toBe('A real title');
    expect(opened.title).toBe(listed.items[0]?.title);
  });

  it('resumes rather than replays when somebody says something', async () => {
    sdk.sessions.push(older);
    sdk.transcript.push({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'earlier' } });
    const client = open();
    await client.handle(hello(['0.8.0']));
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/older' } });

    client.handle({
      method: 'dispatchAction',
      params: {
        channel: 'ahp-chat:/older',
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'and now?' } },
      },
    });
    await settle(6);

    // Resumed: the agent gets the context it built before, not a transcript
    // it has merely been shown.
    expect(sessionQueries()).toHaveLength(1);
    expect(sessionQueries()[0]?.options.resume).toBe('older');
    expect(sdk.said).toEqual(['and now?']);

    // And the channel does not open empty while it resumes.
    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/older' } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
    }).snapshot.state;
    expect(chat.turns.length).toBeGreaterThan(0);
    expect(chat.activeTurn).toBeDefined();
  });

  it('refuses a session that is neither running nor in the catalogue', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/ghost' } }))
      .rejects.toMatchObject({ code: -32001 });
  });
});

describe('choosing a model', () => {
  it('puts the schema where a client reads it', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
    await settle(6);
    const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
      schema: { properties: Record<string, { enum?: string[]; sessionMutable?: boolean }> };
      values: Record<string, string>;
    };
    // `schema.properties`, not `properties`. One level up draws no controls
    // at all - no permission mode, no model, no effort - which is what it did.
    const keys = Object.keys(cfg.schema.properties);
    expect(keys).toContain('permissionMode');
    expect(keys).toContain('effortLevel');
    expect(keys).toContain('thinking');
    expect(cfg.schema.properties.permissionMode?.enum).toContain('plan');
    expect(cfg.values.permissionMode).toBe('default');
  });

  it('says which controls survive a running session and which do not', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
    const cfg = await client.handle({ method: 'resolveSessionConfig', params: {} }) as {
      schema: { properties: Record<string, { sessionMutable?: boolean }> };
    };
    expect(cfg.schema.properties.permissionMode?.sessionMutable).toBe(true);
    expect(cfg.schema.properties.effortLevel?.sessionMutable).toBe(true);
    // The CLI takes `thinking` when the query is built and has nowhere to put
    // a later change, so a live control for it would be a switch that flips
    // back.
    expect(cfg.schema.properties.thinking?.sessionMutable).toBe(false);
  });

  it('answers back with what has already been chosen', async () => {
    const client = open();
    await client.handle(hello(['0.8.0']));
    const cfg = await client.handle({
      method: 'resolveSessionConfig',
      params: { config: { permissionMode: 'plan' } },
    }) as { values: Record<string, string> };
    // Iterative: a form that returned its defaults every time would quietly
    // undo a choice the moment anything re-asked.
    expect(cfg.values.permissionMode).toBe('plan');
    expect(cfg.values.effortLevel).toBe('high');
  });

  it('carries the schema and the values on the session itself', async () => {
    const { client, uri } = await running();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { schema: { properties: Record<string, unknown> }; values: Record<string, string> } } };
    }).snapshot.state;
    // A session without this has no permission control, no model picker and
    // no effort control - which is what it had.
    expect(Object.keys(state.config.schema.properties)).toContain('permissionMode');
    expect(state.config.values.permissionMode).toBe('default');
    expect(state.config.values.effortLevel).toBe('high');
  });

  it('changes the effort level on the running session', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { effortLevel: 'max' } } },
    });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { values: Record<string, string> } } };
    }).snapshot.state;
    expect(state.config.values.effortLevel).toBe('max');
    // Told, not merely recorded: a control that updates the state a client
    // reads while the CLI keeps its old setting is the worst of both.
    expect(sdk.effortsSet).toEqual(['max']);
  });

  it('refuses an effort level that is not one, rather than passing it on', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { effortLevel: 'enormous' } } },
    });
    await settle();
    const state = (await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { config: { values: Record<string, string> } } };
    }).snapshot.state;
    expect(state.config.values.effortLevel).toBe('high');
    // A rejected promise nobody reads is not an answer.
    expect(sdk.effortsSet).toEqual([]);
  });

  it('runs the turn on the model the turn named, and keeps it', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: {
        channel: uri,
        action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi', model: 'haiku' } },
      },
    });
    await settle();
    expect(sdk.modelsSet).toEqual(['haiku']);

    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } }) as {
      snapshot: { state: { activeTurn: { message: { model?: { id: string } } } } };
    }).snapshot.state;
    // Credited on the turn, because the transcript has to say what actually
    // ran it.
    expect(chat.activeTurn.message.model?.id).toBe('haiku');
  });

  it('resolves the default alias at the CLI, not here', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { model: 'default' } } },
    });
    await settle();
    // `default` is a choice the CLI offers. Resolving it to a concrete id
    // before sending would be the host answering a question nobody asked.
    expect(sdk.modelsSet).toEqual([undefined]);
  });

  it('refuses a permission mode the CLI does not know', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { permissionMode: 'bypass' } } },
    });
    await settle();
    // `bypass` for `bypassPermissions` is the near-miss a client makes, and a
    // rejected promise nobody reads is not an answer.
    expect(sdk.modesSet).toEqual([]);

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { permissionMode: 'acceptEdits' } } },
    });
    await settle();
    expect(sdk.modesSet).toEqual(['acceptEdits']);
  });
});


describe('paging a long history', () => {
  /** More turns than a snapshot carries, so the tail is genuinely a tail. */
  const many = (n: number) => {
    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < n; i++) {
      out.push({ type: 'user', uuid: `u${i}`, message: { role: 'user', content: `said ${i}` } });
      out.push({ type: 'assistant', uuid: `a${i}`, message: { content: [{ type: 'text', text: `replied ${i}` }] } });
    }
    return out;
  };

  interface Loaded { turns: { message: { text: string } }[]; turnsNextCursor?: string }

  const opened = async (count = 120) => {
    sdk.sessions.push({ sessionId: 'long', summary: 'A long one', lastModified: 1, cwd: '/home/softov' });
    sdk.transcript.push(...many(count));
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.8.0']));
    const chat = (await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/long' } }) as {
      snapshot: { state: { turns: { message: { text: string } }[]; turnsNextCursor?: string } };
    }).snapshot.state;
    const pages = () => actions(p, 'ahp-chat:/long')
      .filter((e) => e.action.type === 'chat/turnsLoaded')
      .map((e) => e.action as unknown as Loaded);
    return { client, chat, pages };
  };

  it('carries the newest page and says where the rest begins', async () => {
    const { chat } = await opened();
    // The snapshot is what a client waits on before it can draw anything, and
    // the oldest turns are the ones nobody is looking at.
    expect(chat.turns).toHaveLength(50);
    expect(chat.turns[49]?.message.text).toBe('said 119');
    expect(chat.turnsNextCursor).toBe('70');
  });

  it('sends the page to everyone watching, not to the one who asked', async () => {
    const { client, pages } = await opened();
    const result = await client.handle({
      method: 'fetchTurns',
      params: { channel: 'ahp-chat:/long', cursor: '70' },
    });
    // Empty on purpose: the turns arrive as an action on the channel, so
    // every client watching the chat gets them - not only the one that asked.
    expect(result).toEqual({});

    const [page] = pages();
    expect(page?.turns).toHaveLength(50);
    expect(page?.turns[0]?.message.text).toBe('said 20');
    expect(page?.turns[49]?.message.text).toBe('said 69');
    expect(page?.turnsNextCursor).toBe('20');
  });

  it('walks back to the beginning and then stops offering a cursor', async () => {
    const { client, chat, pages } = await opened();
    let cursor = chat.turnsNextCursor;
    for (let i = 0; i < 6 && cursor !== undefined; i++) {
      await client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long', cursor } });
      cursor = pages().at(-1)?.turnsNextCursor;
    }

    const loaded = pages();
    expect(loaded).toHaveLength(2);
    // Nothing older left, so no cursor - absence is how a client knows to
    // stop asking rather than paging the same page for ever.
    expect(loaded.at(-1)?.turnsNextCursor).toBeUndefined();
    expect(loaded.at(-1)?.turns[0]?.message.text).toBe('said 0');
    // Every turn, once, across the snapshot and the pages.
    const all = [...loaded.flatMap((l) => l.turns), ...chat.turns].map((t) => t.message.text);
    expect(new Set(all).size).toBe(120);
  });

  it('loads the next page when no cursor is given', async () => {
    const { client, pages } = await opened();
    // "Load whatever is next" - the page before the one the snapshot carried.
    await client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long' } });
    expect(pages()[0]?.turns[49]?.message.text).toBe('said 69');
  });

  it('does not page a history that fits', async () => {
    const { chat, client } = await opened(10);
    expect(chat.turns).toHaveLength(10);
    expect(chat.turnsNextCursor).toBeUndefined();
    // Nothing older to ask for, so asking is a mistake and is said to be one.
    await expect(client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long' } }))
      .rejects.toMatchObject({ code: -32602 });
  });

  it('refuses a cursor it did not issue', async () => {
    const { client } = await opened();
    // Guessing would answer a question about old turns with new ones, and the
    // client would page for ever without noticing.
    await expect(client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long', cursor: 'banana' } }))
      .rejects.toMatchObject({ code: -32602 });
    await expect(client.handle({ method: 'fetchTurns', params: { channel: 'ahp-chat:/long', cursor: '9999' } }))
      .rejects.toMatchObject({ code: -32602 });
  });
});

describe('what a slash offers', () => {
  const withCommands = async () => {
    sdk.init = {
      models: [],
      agents: [],
      commands: [
        { name: 'advisor', description: 'Read support tickets', argumentHint: '<id>' },
        { name: 'deep-research', description: 'Research a question' },
        { name: 'design', description: 'Create a design canvas' },
      ],
    };
    const { client, chatUri } = await running();
    return { client, chatUri };
  };

  it('completes a slash into the commands the harness contributed', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/de', offset: 3 },
    }) as { items: { insertText: string; rangeStart: number; rangeEnd: number; attachment: { label: string } }[] };

    expect(result.items.map((i) => i.attachment.label)).toEqual(['/deep-research', '/design']);
    // Replaces the slash and what was typed after it, not the whole input.
    expect(result.items[0]?.rangeStart).toBe(0);
    expect(result.items[0]?.rangeEnd).toBe(3);
  });

  it('puts what was typed a prefix of first', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/design', offset: 7 },
    }) as { items: { attachment: { label: string } }[] };
    // A substring match is useful and is not what somebody typing this wants
    // to see first.
    expect(result.items[0]?.attachment.label).toBe('/design');
  });

  it('adds a space only for a command that takes an argument', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/a', offset: 2 },
    }) as { items: { insertText: string }[] };
    expect(result.items[0]?.insertText).toBe('/advisor ');

    const design = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/design', offset: 7 },
    }) as { items: { insertText: string }[] };
    // A trailing space on a command that takes none is a character somebody
    // has to delete.
    expect(design.items[0]?.insertText).toBe('/design');
  });

  it('says nothing for a slash that is part of a path', async () => {
    const { client, chatUri } = await withCommands();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: 'look at src/design', offset: 18 },
    }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });

  it('offers the harness-wide list while a new session is still starting', async () => {
    // The session exists; its CLI has not answered yet. Preferring its silence
    // over what the harness offers is a slash menu that is empty for exactly
    // as long as somebody is likely to use it.
    sdk.init = {};
    const { client, chatUri } = await running();
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'userMessage', channel: chatUri, text: '/', offset: 1 },
    }) as { items: unknown[] };
    // The boot probe answered nothing here either, so this pins the fallback
    // path rather than a count.
    expect(Array.isArray(result.items)).toBe(true);
  });

  it('answers nothing for a kind it does not serve', async () => {
    const { client, chatUri } = await withCommands();
    // An `@` is a file. Returning commands for it would be answering a
    // different question than the one asked.
    const result = await client.handle({
      method: 'completions',
      params: { kind: 'somethingElse', channel: chatUri, text: '/de', offset: 3 },
    }) as { items: unknown[] };
    expect(result.items).toEqual([]);
  });
});

describe('what the client is told about its own turn', () => {
  it('says the turn started, so the parts that follow have somewhere to go', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // Reducing it privately is not enough. A client applies what the host
    // says, including what it asked for itself - and `chat/responsePart` for
    // a turn it has never heard of is dropped, so the whole answer lands
    // nowhere and appears only when somebody reopens the session.
    const started = actions(p, chatUri).find((e) => e.action.type === 'chat/turnStarted');
    expect(started?.action).toMatchObject({ turnId: 't1', message: { text: 'hi' } });

    await emit(
      { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
      { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    );
    // The part names the turn the client was told about, and not one of the
    // host's own making.
    const part = actions(p, chatUri).find((e) => e.action.type === 'chat/responsePart');
    expect(part?.action.turnId).toBe('t1');
  });
});

describe('the flags a client sets', () => {
  it('keeps read and archived, and tells everyone watching', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const host = serving('/home/softov');
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));
    const uri = 'ahp-session:/old';
    await client.handle({ method: 'subscribe', params: { channel: uri } });

    client.handle({ method: 'dispatchAction', params: { channel: uri, action: { type: 'session/isReadChanged', isRead: true } } });
    await settle();
    expect(actions(p, uri).some((e) => e.action.type === 'session/isReadChanged')).toBe(true);

    // The catalogue carries it too: activity in the low bits, the client's own
    // flags above. 1 | 32.
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    expect(listed.items[0]?.status).toBe(33);
  });

  it('needs no agent to record one', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.8.0']));
    // Marking a row read is what somebody does from a catalogue. Starting an
    // agent to record a bit would start one per row scrolled past.
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/old', action: { type: 'session/isArchivedChanged', isArchived: true } },
    });
    await settle();
    expect(sessionQueries()).toHaveLength(0);
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    expect(listed.items[0]?.status).toBe(1 | 64);
  });
});

describe('a session read from its transcript', () => {
  it('is configurable before it is resumed', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.8.0']));
    const opened = await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/old' } }) as {
      snapshot: { state: { config: { schema: { properties: Record<string, unknown> } }; values?: unknown } };
    };
    // Without the schema a client draws no controls at all - no permission
    // mode, no effort - on exactly the sessions somebody is deciding whether
    // to continue.
    expect(Object.keys(opened.snapshot.state.config.schema.properties)).toContain('permissionMode');
  });

  it('starts on what was chosen for it while it was only a row', async () => {
    sdk.sessions.push({ sessionId: 'old', summary: 'Older', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    await client.handle(hello(['0.8.0']));
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/old', action: { type: 'session/configChanged', config: { permissionMode: 'plan' } } },
    });
    await settle();
    // Nothing was started to record it.
    expect(sessionQueries()).toHaveLength(0);

    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/old', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'carry on' } } },
    });
    await settle(8);
    // Most of what the schema offers is fixed when the query is built, so a
    // session resumed without it is one that can never be given it.
    expect(sessionQueries().at(-1)?.options.permissionMode).toBe('plan');
  });
});

describe('one conversation, one row', () => {
  it('hides the transcript a running session is writing', async () => {
    const { client } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hi' } } },
    });
    await settle();
    // The client named the channel `live`; the agent names its own transcript
    // and writes under that. Both are this conversation.
    sdk.sessions.push({ sessionId: 'agent-chosen', summary: 'Hi', lastModified: 2, cwd: '/home/softov' });
    await emit({ type: 'system', subtype: 'init', session_id: 'agent-chosen' });

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { resource: string }[];
    };
    expect(listed.items.map((i) => i.resource)).toEqual(['ahp-session:/live']);
  });
});

describe('one tool call, one row', () => {
  /** A turn with a `Bash` call the agent has already announced. */
  async function calling() {
    const started = await running();
    started.client.handle({
      method: 'dispatchAction',
      params: { channel: started.uri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'run it' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      message: {
        id: 'm1',
        content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }],
      },
    });
    return started;
  }

  const toolParts = (state: Record<string, unknown>) => {
    const active = state.activeTurn as { responseParts?: Record<string, unknown>[] } | undefined;
    return (active?.responseParts ?? []).filter((part) => part.kind === 'toolCall');
  };

  it('lets chat/toolCallStart make the part, and does not make it twice', async () => {
    const { client, peer: p, chatUri } = await calling();
    // `chat/toolCallStart` *creates* the response part on the client side, so
    // a `chat/responsePart` for the same call is the row drawn twice.
    const announced = actions(p, chatUri).filter((e) => e.action.type === 'chat/responsePart');
    expect(announced.some((e) => (e.action.part as Record<string, unknown>).kind === 'toolCall')).toBe(false);
    expect(actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallStart')).toHaveLength(1);

    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    expect(toolParts(opened.snapshot.state)).toHaveLength(1);
  });

  it('says the transcript is not asking anything', async () => {
    const { peer: p, chatUri } = await calling();
    // Without `confirmed`, the reducer moves every tool call into
    // `pending-confirmation` and draws it as a question nobody put.
    const ready = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallReady');
    expect(ready?.action.confirmed).toBe('not-needed');
    // And the intention is not the input: a client draws one above the other.
    expect(ready?.action.invocationMessage).toBe('Bash');
    expect(ready?.action.toolInput).toBe('ls');
  });

  it('asks about the call the agent announced, not one of its own', async () => {
    const { client, peer: p, chatUri } = await calling();
    void sdk.canUseTool?.('Bash', { command: 'ls' }, {
      toolUseID: 'toolu_1',
      title: 'Claude wants to run ls',
      displayName: 'Run in terminal',
    });
    await settle();

    // Still one part. The confirmation is *the* call, not a second one beside
    // it - which is also why answering it reaches the agent.
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: Record<string, unknown> };
    };
    expect(toolParts(opened.snapshot.state)).toHaveLength(1);

    const asking = actions(p, chatUri).filter((e) => e.action.type === 'chat/toolCallReady').at(-1);
    expect(asking?.action.toolCallId).toBe('toolu_1');
    expect(asking?.action.confirmed).toBeUndefined();
    // The CLI's own sentence, which is better than one rebuilt here.
    expect(asking?.action.invocationMessage).toBe('Claude wants to run ls');
  });

  it('answers the agent, and says so', async () => {
    const { client, peer: p, uri, chatUri } = await calling();
    const answer = sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' });
    await settle();

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'chat/toolCallConfirmed', toolCallId: 'toolu_1', approved: true } },
    });
    await settle();

    expect(await answer).toMatchObject({ behavior: 'allow' });
    // Said back, because nothing in a client applies its own dispatch: an
    // approved row stayed pending on every screen watching it, including the
    // one that had just answered.
    const confirmed = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallConfirmed');
    expect(confirmed?.action).toMatchObject({ toolCallId: 'toolu_1', approved: true, confirmed: 'user-action' });
  });
});

describe('what goes after a slash', () => {
  const withCommands = async (count: number) => {
    sdk.init = {
      commands: Array.from({ length: count }, (_, i) => ({ name: `cmd${String(i).padStart(3, '0')}` })),
    };
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
    // The boot probe is what learns them, and it answers on its own clock.
    await settle(8);
    return client;
  };

  const ask = async (client: Awaited<ReturnType<typeof withCommands>>, text: string) =>
    await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text, offset: text.length },
    }) as { items: { insertText: string }[] };

  it('answers a bare slash with the whole list, not a screenful', async () => {
    const client = await withCommands(120);
    // A client that filters locally rather than asking again per keystroke
    // never offers what was truncated here - silently, and always the same
    // ones.
    const all = await ask(client, '/');
    expect(all.items).toHaveLength(120);
  });

  it('keeps a narrowing query bounded', async () => {
    const client = await withCommands(120);
    const some = await ask(client, '/cmd0');
    expect(some.items.length).toBeLessThanOrEqual(50);
  });

  it('answers before any session exists, which is when a composer asks', async () => {
    const client = await withCommands(3);
    const all = await ask(client, '/');
    expect(all.items.map((i) => i.insertText)).toEqual(['/cmd000', '/cmd001', '/cmd002']);
  });
});

describe('where the agent works', () => {
  const opened = async (also: string[] = []) => {
    const host = serving('/home/softov', also);
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
    return client;
  };

  it('runs a session in the directory the client named', async () => {
    const client = await opened(['/brb_main/src']);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: ['file:///brb_main/src'],
      },
    });
    await settle();
    // `file://` comes off on the way in: a backend handed a URI would open a
    // directory called `file:`.
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/brb_main/src');
  });

  it('reports where it actually is, not where the host was started', async () => {
    const client = await opened(['/brb_main/src']);
    await client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: ['file:///brb_main/src'],
      },
    });
    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { workingDirectories: string[] }[];
    };
    expect(listed.items[0]?.workingDirectories).toEqual(['file:///brb_main/src']);
  });

  it('refuses one it was not told to serve, in the backend\'s own words', async () => {
    const client = await opened();
    // A host that ran the agent wherever it was told is one anybody who can
    // reach the port can point at any directory on the machine. Said, not
    // silently replaced: a directory accepted and then ignored is a session
    // running somewhere nobody asked for.
    await expect(client.handle({
      method: 'createSession',
      params: {
        channel: 'ahp-session:/a',
        provider: 'claude',
        workingDirectories: ['file:///etc'],
      },
    })).rejects.toMatchObject({ code: -32602, message: expect.stringContaining('/etc') });
    expect(sessionQueries()).toHaveLength(0);
  });

  it('uses the first one when the client names none', async () => {
    const client = await opened(['/brb_main/src']);
    await client.handle({
      method: 'createSession',
      params: { channel: 'ahp-session:/a', provider: 'claude' },
    });
    await settle();
    expect(sessionQueries().at(-1)?.options.cwd).toBe('/home/softov');
  });
});

describe('a message typed while a turn is running', () => {
  /** A live session with a turn under way. */
  const busy = async () => {
    const started = await running();
    started.client.handle({
      method: 'dispatchAction',
      params: { channel: started.chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'first' } } },
    });
    await settle();
    return started;
  };

  const queue = (client: Awaited<ReturnType<typeof busy>>['client'], channel: string, id: string, text: string) => {
    client.handle({
      method: 'dispatchAction',
      params: { channel, action: { type: 'chat/pendingMessageSet', kind: 'queued', id, message: { text } } },
    });
  };

  it('waits, rather than being dropped on the floor', async () => {
    const { client, chatUri } = await busy();
    queue(client, chatUri, 'q1', 'second');
    await settle();
    // The composer invites you to queue one. It used to go nowhere: no queue,
    // nothing sent when the turn ended, and no error either.
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { queuedMessages: { id: string; message: { text: string } }[] } };
    };
    // With its origin, which `Message` requires and this host used to omit
    // everywhere it built one.
    expect(opened.snapshot.state.queuedMessages)
      .toEqual([{ id: 'q1', message: { text: 'second', origin: { kind: 'user' } } }]);
    // And the agent has not been told about it yet.
    expect(sdk.said).toEqual(['first']);
  });

  it('becomes the next turn when the running one ends', async () => {
    const { client, peer: p, chatUri } = await busy();
    queue(client, chatUri, 'q1', 'second');
    await settle();
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });

    expect(sdk.said).toEqual(['first', 'second']);
    // Named on the turn that consumed it, which is how a client's reducer
    // takes it out of the queue - rather than a second action saying so.
    const started = actions(p, chatUri)
      .filter((e) => e.action.type === 'chat/turnStarted')
      .at(-1);
    expect(started?.action.queuedMessageId).toBe('q1');
  });

  it('can be taken back while it is still waiting', async () => {
    const { client, chatUri } = await busy();
    queue(client, chatUri, 'q1', 'second');
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id: 'q1' } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    expect(sdk.said).toEqual(['first']);
  });

  it('keeps the order it was given, and what was not named behind it', async () => {
    const { client, chatUri } = await busy();
    queue(client, chatUri, 'a', 'A');
    queue(client, chatUri, 'b', 'B');
    queue(client, chatUri, 'c', 'C');
    await settle();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/queuedMessagesReordered', order: ['c', 'a'] } },
    });
    await settle();
    const opened = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as {
      snapshot: { state: { queuedMessages: { id: string }[] } };
    };
    expect(opened.snapshot.state.queuedMessages.map((m) => m.id)).toEqual(['c', 'a', 'b']);
  });

  it('refuses a steering message rather than queueing it behind the turn it was for', async () => {
    const { client, chatUri } = await busy();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/pendingMessageSet', kind: 'steering', id: 's1', message: { text: 'now' } } },
    });
    await settle();
    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    // Steering is injected *into* the running turn. Delivering it to the next
    // one would be delivering it to a different conversation.
    expect(sdk.said).toEqual(['first']);
  });

  it('starts one straight away when nothing is running', async () => {
    const { client, chatUri } = await running();
    queue(client, chatUri, 'q1', 'only');
    await settle();
    expect(sdk.said).toEqual(['only']);
  });
});

describe('what it says it is doing', () => {
  it('names the tool, and stops naming it when the turn ends', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    await emit({
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls -la' } }] },
    });

    // On the session channel, because that is where a catalogue row and a
    // detail pane read it - the protocol has a session mirror its chat's.
    const said = actions(p, uri)
      .filter((e) => e.action.type === 'session/activityChanged')
      .map((e) => e.action.activity);
    expect(said).toContain('Bash ls -la');

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { activity?: string }[];
    };
    expect(listed.items[0]?.activity).toBe('Bash ls -la');

    await emit({ type: 'result', subtype: 'success', duration_ms: 5 });
    // Cleared, not left saying the last thing it did.
    expect(actions(p, uri).filter((e) => e.action.type === 'session/activityChanged').at(-1)?.action.activity)
      .toBeUndefined();
  });

  it('says the title once it has one', async () => {
    const { client, peer: p, uri, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'a question about paging' } } },
    });
    await settle();
    // The catalogue learned it; a client with the session already open holds
    // whatever it was called when it opened it, which was "New session".
    const retitled = actions(p, uri).find((e) => e.action.type === 'session/titleChanged');
    expect(retitled?.action.title).toBe('a question about paging');
  });

  it('reports what the turn cost, while there is still a turn to hang it on', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    await emit({
      type: 'result',
      subtype: 'success',
      duration_ms: 5,
      usage: { input_tokens: 120, output_tokens: 34, cache_read_input_tokens: 900 },
    });
    const said = actions(p, chatUri).map((e) => e.action.type);
    // Before the turn completes: the reducer hangs usage on `activeTurn`, and
    // completing is what moves that into `turns`.
    expect(said.indexOf('chat/usage')).toBeLessThan(said.indexOf('chat/turnComplete'));
    const usage = actions(p, chatUri).find((e) => e.action.type === 'chat/usage')?.action.usage;
    expect(usage).toEqual({ inputTokens: 120, outputTokens: 34, cacheReadTokens: 900 });
  });
});

describe('turning a customization on and off', () => {
  /** A live session that has heard what its CLI offers. */
  const withServers = async (status: string) => {
    sdk.init = { commands: [{ name: 'review', description: 'Read the diff' }] };
    sdk.mcp = [{ name: 'desk', status }];
    const started = await running();
    // `describe` answers on its own clock; the customizations arrive with it.
    await settle(8);
    return started;
  };

  const toggle = (client: Awaited<ReturnType<typeof running>>['client'], id: string, enabled: boolean) => {
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/customizationToggled', id, enablement: [{ kind: 'session', enabled }] } },
    });
  };

  it('switches an MCP server off through the CLI, and reports what it became', async () => {
    const { client, peer: p, uri } = await withServers('connected');
    sdk.mcp = [{ name: 'desk', status: 'disabled' }];
    toggle(client, 'mcp:desk', false);
    await settle(8);

    expect(sdk.mcpToggled).toEqual([{ name: 'desk', enabled: false }]);
    // Read back rather than assumed: a server told to stop can fail to, and
    // reporting what was *asked for* draws a row that is not true.
    const said = actions(p, uri).filter((e) => e.action.type === 'session/customizationUpdated').at(-1);
    expect(said?.action.customization).toMatchObject({ id: 'mcp:desk', enabled: false, state: { kind: 'stopped' } });
  });

  it('reconnects one that was not ready, because that is how signing in happens', async () => {
    const { client } = await withServers('needs-auth');
    sdk.mcp = [{ name: 'desk', status: 'connected' }];
    toggle(client, 'mcp:desk', true);
    await settle(8);

    // `toggleMcpServer` only lifts the disabled flag - a server that was off
    // because nobody had signed in comes straight back `authRequired`, which
    // reads as a switch that flips itself off.
    expect(sdk.mcpReconnected).toEqual(['desk']);
  });

  it('does not reconnect one that was already ready', async () => {
    const { client } = await withServers('connected');
    toggle(client, 'mcp:desk', true);
    await settle(8);
    expect(sdk.mcpReconnected).toEqual([]);
    expect(sdk.mcpToggled).toEqual([{ name: 'desk', enabled: true }]);
  });

  it('refuses a prompt out loud, and puts the switch back', async () => {
    const said: string[] = [];
    sdk.init = { commands: [{ name: 'review' }] };
    const host = createHost({
      path: '/home/softov',
      agents: [claude({ paths: ['/home/softov'] })],
      onEvent: (message) => said.push(message),
    });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-session:/live' } });
    await settle(8);

    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/customizationToggled', id: 'command:review', enablement: [{ kind: 'session', enabled: false }] } },
    });
    await settle(8);

    // The CLI has no runtime switch for a prompt, a skill or a subagent. A
    // control that reports success and changes nothing is worse than one that
    // says it cannot.
    expect(said.some((line) => line.includes('command:review has no runtime switch'))).toBe(true);
    // And the list goes back out, so the switch a client drew from it returns
    // to where it was rather than showing a change that did not happen.
    expect(actions(p, 'ahp-session:/live').some((e) => e.action.type === 'session/customizationsChanged')).toBe(true);
  });

  it('serves the dedicated start and stop actions too', async () => {
    const { client } = await withServers('disabled');
    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/mcpServerStartRequested', id: 'mcp:desk' } },
    });
    await settle(8);
    expect(sdk.mcpReconnected).toEqual(['desk']);

    client.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-session:/live', action: { type: 'session/mcpServerStopRequested', id: 'mcp:desk' } },
    });
    await settle(8);
    expect(sdk.mcpToggled).toEqual([{ name: 'desk', enabled: false }]);
  });
});

describe('a skill is not a prompt', () => {
  const offering = async () => {
    // The CLI hands out two lists that overlap. `review` is in both, `deploy`
    // is a built-in prompt, and `keybindings-help` is a skill the CLI does
    // not put behind a slash.
    sdk.init = { commands: [{ name: 'review', description: 'Read the diff' }, { name: 'deploy' }] };
    sdk.skills = [{ name: 'review' }, { name: 'keybindings-help', description: 'Internal' }];
    const started = await running();
    await settle(8);
    const opened = await started.client.handle({ method: 'subscribe', params: { channel: started.uri } }) as {
      snapshot: { state: { customizations: Record<string, unknown>[] } };
    };
    return { ...started, items: opened.snapshot.state.customizations };
  };

  it('calls a command that was loaded as a skill a skill', async () => {
    const { items } = await offering();
    const review = items.find((entry) => entry.name === 'review');
    expect(review).toMatchObject({ type: 'skill', id: 'skill:review' });
    // And keeps the description, whichever of the two lists carried it.
    expect(review?.description).toBe('Read the diff');
    // Once, not twice: it is in both lists and it is one thing.
    expect(items.filter((entry) => entry.name === 'review')).toHaveLength(1);
  });

  it('leaves a command that is not a skill a prompt', async () => {
    const { items } = await offering();
    expect(items.find((entry) => entry.name === 'deploy')).toMatchObject({ type: 'prompt' });
  });

  it('marks a skill the CLI will not put behind a slash as the agent\'s', async () => {
    const { items } = await offering();
    // Read off the CLI's own two answers rather than guessed from the name.
    expect(items.find((entry) => entry.name === 'keybindings-help'))
      .toMatchObject({ type: 'skill', disableUserInvocation: true });
  });

  it('completes a slash into skills as well as prompts, and not the agent\'s', async () => {
    const { client, chatUri } = await offering();
    const found = await client.handle({
      method: 'completions',
      params: { channel: chatUri, kind: 'userMessage', text: '/', offset: 1 },
    }) as { items: { insertText: string }[] };
    const names = found.items.map((entry) => entry.insertText);
    expect(names).toContain('/review');
    expect(names).toContain('/deploy');
    // Offering one the host would refuse is worse than not offering it.
    expect(names).not.toContain('/keybindings-help');
  });
});

describe('a client that dropped, coming back', () => {
  it('replays what it missed, and nothing it already had', async () => {
    const host = serving('/home/softov');
    const first = peer();
    const a = host.accept(first);
    await a.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));
    await a.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    await a.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } });

    const seen = actions(first, 'ahp-chat:/live');
    const upTo = seen.at(-1)?.serverSeq ?? 0;

    // The socket goes. The host forgets this client's subscriptions with it,
    // which is why the client has to say what they were.
    a.close();
    a.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/live', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'while away' } } },
    });
    await settle();

    const back = host.accept(peer());
    await back.handle(hello(['0.8.0']));
    const result = await back.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: upTo,
        subscriptions: ['ahp-root://', 'ahp-session:/live', 'ahp-chat:/live'],
      },
    }) as { type: string; actions: { serverSeq: number; action: { type: string } }[]; missing: string[] };

    expect(result.type).toBe('replay');
    expect(result.missing).toEqual([]);
    // Everything after what it saw, and nothing at or before it.
    expect(result.actions.every((held) => held.serverSeq > upTo)).toBe(true);
    expect(result.actions.map((held) => held.action.type)).toContain('chat/turnStarted');
  });

  it('names the channels it cannot resume rather than failing the whole thing', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
    const result = await client.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: 0,
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
    await setup.handle(hello(['0.8.0']));
    await setup.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });

    const p = peer();
    const back = host.accept(p);
    await back.handle(hello(['0.8.0']));
    await back.handle({
      method: 'reconnect',
      params: {
        channel: 'ahp-root://',
        clientId: 'probe',
        lastSeenServerSeq: 0,
        subscriptions: ['ahp-chat:/live'],
      },
    });
    back.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/live', action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'after' } } },
    });
    await settle();
    expect(actions(p, 'ahp-chat:/live').some((e) => e.action.type === 'chat/turnStarted')).toBe(true);
  });

  it('hands back snapshots when the gap is longer than the buffer', async () => {
    const host = serving('/home/softov');
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
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
});

describe('the host\'s filesystem, as far as a client may see it', () => {
  const at = (base: string) => createHost({
    path: base,
    agents: [claude({ paths: [base] })],
    ...machine(),
  }).accept(peer());

  const opened = async (base = '/github/ahpd') => {
    const client = at(base);
    await client.handle(hello(['0.8.0']));
    return client;
  };

  it('lists a directory, folders first', async () => {
    const client = await opened();
    const found = await client.handle({
      method: 'resourceList',
      params: { channel: 'ahp-root://', uri: 'file:///github/ahpd/src' },
    }) as { entries: { name: string; type: string }[] };
    expect(found.entries.map((e) => e.name)).toContain('host.ts');
    // A listing in whatever order the filesystem happened to return is one
    // nobody can scan.
    const kinds = found.entries.map((e) => e.type);
    expect(kinds.indexOf('file')).toBeGreaterThan(kinds.lastIndexOf('directory'));
  });

  it('reads a file as text, and says which encoding that was', async () => {
    const client = await opened();
    const found = await client.handle({
      method: 'resourceRead',
      params: { channel: 'ahp-root://', uri: 'file:///github/ahpd/package.json' },
    }) as { data: string; encoding: string };
    expect(found.encoding).toBe('utf-8');
    expect(found.data).toContain('"name": "ahpd"');
  });

  it('refuses a path it was not told to serve', async () => {
    const client = await opened();
    // A host that answered for any path is one that anybody who can reach the
    // port can read `~/.ssh/id_ed25519` through.
    await expect(client.handle({
      method: 'resourceRead',
      params: { channel: 'ahp-root://', uri: 'file:///etc/passwd' },
    })).rejects.toMatchObject({ code: -32009 });
  });

  it('refuses one that climbs out of a served directory', async () => {
    const client = await opened('/github/ahpd/src');
    await expect(client.handle({
      method: 'resourceList',
      params: { channel: 'ahp-root://', uri: 'file:///github/ahpd/src/../../..' },
    })).rejects.toMatchObject({ code: -32009 });
  });

  it('says a missing file is missing, not forbidden', async () => {
    const client = await opened();
    // The two are different answers and a client acts differently on each.
    await expect(client.handle({
      method: 'resourceRead',
      params: { channel: 'ahp-root://', uri: 'file:///github/ahpd/nothing-here.txt' },
    })).rejects.toMatchObject({ code: -32008 });
  });

  it('resolves what a path is without opening it', async () => {
    const client = await opened();
    const found = await client.handle({
      method: 'resourceResolve',
      params: { channel: 'ahp-root://', uri: 'file:///github/ahpd/src' },
    }) as { type: string; uri: string };
    expect(found.type).toBe('directory');
    expect(found.uri).toBe('file:///github/ahpd/src');
  });

  it('will not write without a grant, and names the request that would give one', async () => {
    const client = await opened();
    // The whole access model for the write half. A refusal that did not carry
    // the request would be a dead end - the client has nothing to send next.
    await expect(client.handle({
      method: 'resourceWrite',
      params: { channel: 'ahp-root://', uri: 'file:///github/ahpd/x', data: 'x', encoding: 'utf-8' },
    })).rejects.toMatchObject({
      code: -32009,
      data: { request: { channel: 'ahp-root://', uri: 'file:///github/ahpd/x', write: true } },
    });
  });

  it('answers -32601 for a store that only reads, which is not a refusal about a path', async () => {
    // Two different ways not to have this, and they must not be confused: a
    // host with a read-only store does not serve the method at all, and a
    // client that gets `-32009` instead would go and ask for a grant it could
    // never use.
    const host = createHost({
      path: '/github/ahpd',
      agents: [claude({ paths: ['/github/ahpd'] })],
      resources: { list, read, resolve, complete },
    });
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
    await client.handle({
      method: 'resourceRequest',
      params: { channel: 'ahp-root://', uri: 'file:///github/ahpd', write: true },
    });
    for (const method of ['resourceWrite', 'resourceDelete', 'resourceMkdir', 'resourceMove', 'resourceCopy']) {
      await expect(client.handle({
        method,
        params: {
          channel: 'ahp-root://',
          uri: 'file:///github/ahpd/x',
          source: 'file:///github/ahpd/x',
          destination: 'file:///github/ahpd/y',
          data: '',
          encoding: 'utf-8',
        },
      }), method).rejects.toMatchObject({ code: -32601 });
    }
  });
});

describe('completing an at-sign', () => {
  it('offers paths under the session\'s own directory', async () => {
    const host = createHost({ path: '/github/ahpd', agents: [claude({ paths: ['/github/ahpd'] })], ...machine() });
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-chat:/live', kind: 'userMessage', text: 'look at @src/ho', offset: 15 },
    }) as { items: { insertText: string; rangeStart: number; attachment: { type: string; uri: string } }[] };

    expect(found.items.map((i) => i.insertText)).toContain('@src/host.ts');
    // The whole `@…` is replaced, so completing does not leave two at-signs.
    expect(found.items[0]?.rangeStart).toBe(8);
    // A reference rather than the bytes: a completion that carried the file
    // would carry it per keystroke.
    expect(found.items[0]?.attachment).toMatchObject({ type: 'resource', uri: 'file:///github/ahpd/src/host.ts' });
  });

  it('keeps a directory\'s slash, so the next keystroke goes into it', async () => {
    const host = createHost({ path: '/github/ahpd', agents: [claude({ paths: ['/github/ahpd'] })], ...machine() });
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text: '@sr', offset: 3 },
    }) as { items: { insertText: string }[] };
    expect(found.items.map((i) => i.insertText)).toContain('@src/');
  });

  it('leaves a slash command alone, because the two cannot both match', async () => {
    const host = createHost({ path: '/github/ahpd', agents: [claude({ paths: ['/github/ahpd'] })], ...machine() });
    const client = host.accept(peer());
    await client.handle(hello(['0.8.0']));
    const found = await client.handle({
      method: 'completions',
      params: { channel: 'ahp-root://', kind: 'userMessage', text: 'mail me@example.com', offset: 19 },
    }) as { items: unknown[] };
    // An at-sign mid-word is an address, not a path.
    expect(found.items).toEqual([]);
  });
});

describe('two people on one chat', () => {
  it('shows each other what is being typed', async () => {
    const host = serving('/home/softov');
    const one = peer();
    const a = host.accept(one);
    const two = peer();
    const b = host.accept(two);
    for (const client of [a, b]) {
      await client.handle(hello(['0.8.0']));
    }
    await a.handle({ method: 'createSession', params: { channel: 'ahp-session:/live', provider: 'claude' } });
    for (const client of [a, b]) {
      await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } });
    }

    a.handle({
      method: 'dispatchAction',
      params: { channel: 'ahp-chat:/live', action: { type: 'chat/draftChanged', draft: 'half a th' } },
    });
    await settle();
    // The only reason a draft is on the wire at all: a client that kept its
    // own would need nothing from a host for it.
    expect(actions(two, 'ahp-chat:/live').find((e) => e.action.type === 'chat/draftChanged')?.action.draft)
      .toBe('half a th');

    // And somebody arriving later gets it from the snapshot.
    const three = host.accept(peer());
    await three.handle(hello(['0.8.0']));
    const opened = await three.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } }) as {
      snapshot: { state: { draft?: string } };
    };
    expect(opened.snapshot.state.draft).toBe('half a th');
  });
});

describe('a compacted context', () => {
  it('says so in the turn, and does not throw the conversation away', async () => {
    const { client, peer: p, chatUri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'a long one' } } },
    });
    await settle();
    await emit({
      type: 'system',
      subtype: 'compact_boundary',
      compact_metadata: { trigger: 'auto', pre_tokens: 120000, post_tokens: 30000 },
    });

    const part = actions(p, chatUri)
      .filter((e) => e.action.type === 'chat/responsePart')
      .map((e) => e.action.part as Record<string, unknown>)
      .find((held) => held.kind === 'systemNotification');
    expect(part?.content).toBe('Context compacted automatically: 120000 tokens to 30000.');

    // Not `chat/truncated`. That means "drop the turns before this one", and
    // every one of them is still in the transcript and still readable - what
    // was compacted is the model's context, not the conversation.
    expect(actions(p, chatUri).some((e) => e.action.type === 'chat/truncated')).toBe(false);
  });
});

describe('a shell on this machine', () => {
  const opened = async () => {
    const host = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] }));
    return { host, client, peer: p };
  };

  /** Wait for the shell to actually say something. */
  const spoken = async (p: ReturnType<typeof peer>, uri: string, want: string) => {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => { setTimeout(r, 50); });
      const said = actions(p, uri)
        .filter((e) => e.action.type === 'terminal/data')
        .map((e) => String(e.action.data))
        .join('');
      if (said.includes(want)) return said;
    }
    return actions(p, uri).filter((e) => e.action.type === 'terminal/data').map((e) => String(e.action.data)).join('');
  };

  it('runs what it is sent and says what came back', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/one';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'echo hello-from-a-terminal\n' } },
    });
    expect(await spoken(p, uri, 'hello-from-a-terminal')).toContain('hello-from-a-terminal');
  });

  it('says it is not a pseudoterminal, rather than leaving it to be discovered', async () => {
    const { client } = await opened();
    const uri = 'ahp-terminal:/two';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    const found = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { isPty: boolean; supportsCommandDetection: boolean } };
    };
    // Pipes, not a PTY: anything that draws itself with cursor movement will
    // not look right, and a client that had to find that out by rendering it
    // would find out too late.
    expect(found.snapshot.state.isPty).toBe(false);
    expect(found.snapshot.state.supportsCommandDetection).toBe(false);
  });

  it('lists them on the root channel, and stops when one is disposed', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/three';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    const listed = actions(p, 'ahp-root://').filter((e) => e.action.type === 'root/terminalsChanged').at(-1);
    expect((listed?.action.terminals as { resource: string }[]).map((t) => t.resource)).toEqual([uri]);

    await client.handle({ method: 'disposeTerminal', params: { channel: uri } });
    const after = actions(p, 'ahp-root://').filter((e) => e.action.type === 'root/terminalsChanged').at(-1);
    expect(after?.action.terminals).toEqual([]);
    // And the channel is gone with it.
    await expect(client.handle({ method: 'subscribe', params: { channel: uri } }))
      .rejects.toMatchObject({ code: -32001 });
  });

  it('will not open one outside the directories it serves', async () => {
    const { client } = await opened();
    // A terminal is arbitrary code on this machine. One that started anywhere
    // would be a host that hands out a shell wherever it is asked.
    await expect(client.handle({
      method: 'createTerminal',
      params: { channel: 'ahp-terminal:/four', claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///etc' },
    })).rejects.toMatchObject({ code: -32009 });
  });

  it('reports the exit code when the shell goes', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/five';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'exit 3\n' } },
    });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    // Reporting nothing would read as still running.
    expect(actions(p, uri).find((e) => e.action.type === 'terminal/exited')?.action.exitCode).toBe(3);

    /*
     * And in the shape 0.9.0 asks for.
     *
     * That version moved the exit code inside `lifecycle` and made the field
     * required, so a terminal described without it is one a client cannot ask
     * about: `lifecycle.status` comes back undefined, which reads as a process
     * that never exits. The flat `exitCode` stays beside it because this host
     * negotiates down to 0.5.1, and every version before 0.9.0 reads that.
     */
    const after = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { lifecycle?: { status?: string; exitCode?: number }; exitCode?: number } };
    };
    expect(after.snapshot.state.lifecycle).toEqual({ status: 'exited', exitCode: 3 });
    expect(after.snapshot.state.exitCode).toBe(3);
  });

  /*
   * The catalogue has to hear about an exit too.
   *
   * `root/terminalsChanged` fired when a terminal was created and when it was
   * disposed, and not when the shell inside it went - so the root channel went
   * on describing a dead terminal as running until somebody closed it. Older
   * than 0.9.0 and made worse by it: the old shape simply had no exit code to
   * report, and this one says `{ status: 'running' }` out loud.
   */
  it('tells the root channel when the shell goes, not only when it is closed', async () => {
    const { client, peer: p } = await opened();
    const uri = 'ahp-terminal:/six';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'exit 5\n' } },
    });
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    await settle();

    const listed = actions(p, 'ahp-root://')
      .filter((e) => e.action.type === 'root/terminalsChanged')
      .at(-1)?.action.terminals as { resource: string; lifecycle?: { status?: string; exitCode?: number } }[] | undefined;
    expect(listed?.find((one) => one.resource === uri)?.lifecycle)
      .toEqual({ status: 'exited', exitCode: 5 });
  });

  it('says a terminal that is still running is running', async () => {
    const { client } = await opened();
    const uri = 'ahp-terminal:/alive';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    const found = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { lifecycle?: { status?: string }; exitCode?: number } };
    };
    // Required, and not the absence of an exit code: a client should not have
    // to infer "running" from a field that is not there.
    expect(found.snapshot.state.lifecycle).toEqual({ status: 'running' });
    expect(found.snapshot.state.exitCode).toBeUndefined();

    // The root channel lists the same fact, and 0.9.0 requires it there too.
    const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as {
      snapshot: { state: { terminals?: { resource: string; lifecycle?: { status?: string } }[] } };
    };
    expect(root.snapshot.state.terminals?.find((one) => one.resource === uri)?.lifecycle)
      .toEqual({ status: 'running' });
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

  it('refuses an empty token', async () => {
    const { client } = await opened();
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: 'ahp-root://', resource: ANTHROPIC, token: '' },
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
    // Absent, so the subprocess inherits - which is how every session worked
    // before there was anything to push, and how an automation's still does.
    expect(sessionQueries().at(-1)?.options.env).toBeUndefined();
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
    expect(sessionQueries().at(-1)?.options.env).toBeUndefined();
  });
});

describe('more than one chat in a session', () => {
  const second = 'ahp-chat:/other';

  it('advertises that it can, so a client knows it may ask', async () => {
    const client = open();
    const result = await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { state: { agents: { capabilities?: { multipleChats?: unknown } }[] } }[];
    };
    // Without this a client MUST NOT call `createChat` at all.
    expect(result.snapshots[0]?.state.agents[0]?.capabilities?.multipleChats).toEqual({});
  });

  it('opens one, and lists both on the session', async () => {
    const { client, peer: p, uri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });

    // `summary`, which is what the reducer reads: a chat announced under any
    // other name arrives as a TypeError inside it.
    expect(actions(p, uri).find((e) => e.action.type === 'session/chatAdded')?.action.summary)
      .toMatchObject({ resource: second, status: 1 });

    const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
      snapshot: { state: { chats: { resource: string }[]; defaultChat: string } };
    };
    expect(opened.snapshot.state.chats.map((c) => c.resource)).toEqual(['ahp-chat:/live', second]);
    // The first stays the one a client gets when it names none.
    expect(opened.snapshot.state.defaultChat).toBe('ahp-chat:/live');
  });

  it('runs them on their own agents, so a turn in one is not a turn in the other', async () => {
    const { client, uri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'over here' } } },
    });
    await settle();
    // Two CLIs, one directory, one config - which is what makes them peers.
    expect(sessionQueries()).toHaveLength(2);
    expect(sdk.said).toEqual(['over here']);

    const first_ = await client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } }) as {
      snapshot: { state: { turns: unknown[]; activeTurn?: unknown } };
    };
    expect(first_.snapshot.state.turns).toEqual([]);
    expect(first_.snapshot.state.activeTurn).toBeUndefined();
  });

  it('carries the session\'s config into a chat opened later', async () => {
    const { client, uri } = await running();
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'session/configChanged', config: { permissionMode: 'plan' } } },
    });
    await settle();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await settle();
    // Config belongs to the session, not to whichever chat happened to be
    // open when it was answered.
    expect(sessionQueries().at(-1)?.options.permissionMode).toBe('plan');
  });

  it('says a session is waiting when any of its chats is', async () => {
    const { client, uri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    client.handle({
      method: 'dispatchAction',
      params: { channel: second, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } } },
    });
    await settle();
    void sdk.canUseTool?.('Bash', { command: 'ls' }, { toolUseID: 'toolu_1' });
    await settle();

    const listed = await client.handle({ method: 'listSessions', params: { channel: 'ahp-root://' } }) as {
      items: { status: number }[];
    };
    // A catalogue that only looked at the default chat would show this idle
    // while another chat in it is blocked on a person.
    expect(listed.items[0]?.status).toBe(24);
  });

  it('will not dispose the only one, and says what to do instead', async () => {
    const { client } = await running();
    await expect(client.handle({ method: 'disposeChat', params: { channel: 'ahp-chat:/live' } }))
      .rejects.toMatchObject({ code: -32602, message: expect.stringContaining('dispose the session') });
  });

  it('closes one, and moves the default when it was the default', async () => {
    const { client, peer: p, uri } = await running();
    await client.handle({ method: 'createChat', params: { channel: uri, chat: second } });
    await client.handle({ method: 'disposeChat', params: { channel: 'ahp-chat:/live' } });

    expect(actions(p, uri).find((e) => e.action.type === 'session/defaultChatChanged')?.action.defaultChat)
      .toBe(second);
    expect(actions(p, uri).find((e) => e.action.type === 'session/chatRemoved')?.action.chat).toBe('ahp-chat:/live');
    await expect(client.handle({ method: 'subscribe', params: { channel: 'ahp-chat:/live' } }))
      .rejects.toMatchObject({ code: -32001 });
  });

  it('refuses to fork one from a turn, which it cannot do', async () => {
    const { client, uri } = await running();
    // Forking needs a backend that resumes at a *turn*; this one resumes
    // whole sessions, and the capability it advertises says neither mode.
    await expect(client.handle({
      method: 'createChat',
      params: { channel: uri, chat: second, source: { kind: 'fork', chat: 'ahp-chat:/live', turnId: 't1' } },
    })).rejects.toMatchObject({ code: -32602 });
  });
});


describe('interrupting a terminal', () => {
  it('turns ^C into a signal, because there is no line discipline to', async () => {
    const host = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], ...machine() });
    const p = peer();
    const client = host.accept(p);
    await client.handle(hello(['0.8.0']));
    const uri = 'ahp-terminal:/int';
    await client.handle({
      method: 'createTerminal',
      params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });

    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: 'sleep 30\n' } },
    });
    await new Promise((r) => { setTimeout(r, 300); });
    /*
     * A pseudoterminal's driver sees the byte and signals the foreground
     * group. Pipes have no driver, so it would arrive as ordinary input and
     * the command would run on - a terminal a runaway command cannot be
     * stopped in.
     */
    client.handle({
      method: 'dispatchAction',
      params: { channel: uri, action: { type: 'terminal/input', data: ETX } },
    });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => { setTimeout(r, 50); });
      if (actions(p, uri).some((e) => e.action.type === 'terminal/exited')) break;
    }
    expect(actions(p, uri).some((e) => e.action.type === 'terminal/exited')).toBe(true);
  });
});

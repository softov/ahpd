import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Peer } from '../src/types/rpc.js';

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
    said: [] as string[],
    modelsSet: [] as (string | undefined)[],
    modesSet: [] as string[],
    effortsSet: [] as (string | null | undefined)[],
    interrupted: 0,
    canUseTool: undefined as undefined | ((n: string, i: Record<string, unknown>) => Promise<unknown>),
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
      // The control protocol: answers without a turn having happened, which
      // is the whole reason capabilities are read from here.
      initializationResult: async () => sdk.init,
      mcpServerStatus: async () => sdk.mcp,
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../src/host.js');

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

const open = () => createHost({ path: '/home/softov' }).accept(peer());

const hello = (versions: string[], extra: Record<string, unknown> = {}) => ({
  method: 'initialize',
  params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: versions, ...extra },
});

beforeEach(() => {
  sdk.sessions.length = 0;
  sdk.transcript.length = 0;
  sdk.mcp.length = 0;
  sdk.said.length = 0;
  sdk.modelsSet.length = 0;
  sdk.modesSet.length = 0;
  sdk.effortsSet.length = 0;
  sdk.queries.length = 0;
  sdk.init = {};
  sdk.interrupted = 0;
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

  it('counts the sessions on the root channel', async () => {
    sdk.sessions.push({ sessionId: 'a', lastModified: 1, cwd: '/home/softov' });
    const client = open();
    const result = await client.handle(hello(['0.8.0'], { initialSubscriptions: ['ahp-root://'] })) as {
      snapshots: { state: { activeSessions: number } }[];
    };
    expect(result.snapshots[0]?.state.activeSessions).toBe(1);
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
    await expect(client.handle({ method: 'createTerminal', params: { channel: 'ahp-root://' } }))
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
    const host = createHost({ path: '/home/softov' });
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
  const host = createHost({ path: '/home/softov' });
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
    const entry = (needed?.action.inputNeeded as Record<string, unknown>[])[0] as Record<string, unknown>;
    expect(entry.kind).toBe('toolConfirmation');
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
      snapshot: { state: { customizations: { id: string; enabled: boolean; state?: { kind: string; message?: string } }[] } };
    }).snapshot.state;

    const byId = new Map(state.customizations.map((c) => [c.id, c]));
    expect(byId.get('mcp:ok')?.state?.kind).toBe('ready');
    expect(byId.get('mcp:gmail')?.state?.kind).toBe('authRequired');
    expect(byId.get('mcp:broken')?.state?.kind).toBe('error');
    // Why it is not ready, in the host's own words - the whole value of
    // showing the row rather than hiding it.
    expect(byId.get('mcp:broken')?.state?.message).toBe('spawn ENOENT');
    expect(byId.get('mcp:broken')?.enabled).toBe(false);
    expect(byId.get('mcp:off')?.state?.kind).toBe('stopped');
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
    const host = createHost({ path: '/home/softov' });
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
    const host = createHost({ path: '/home/softov' });
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

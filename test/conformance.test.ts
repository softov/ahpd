import { beforeEach, expect, it, vi } from 'vitest';
import {
  changesetReducer, chatReducer, rootReducer, sessionReducer, terminalReducer,
} from '@microsoft/agent-host-protocol';
import type { ChangesetSource } from '../src/types/changes.js';
import type { Peer } from '../src/types/rpc.js';

/*
 * Everything this host says, read by the client that will read it.
 *
 * The rest of the suite checks what the host does. This checks the *shape* of
 * what it says, and it checks it with the protocol package's own reducers -
 * `rootReducer`, `sessionReducer`, `chatReducer` and the rest - rather than by
 * reading state back out of a snapshot this host also wrote.
 *
 * The difference is the whole point. A snapshot is this host agreeing with
 * itself: a field under the wrong name, or beside its action rather than
 * inside it, round-trips perfectly and is still unreadable to anybody else.
 * Every shape defect this repository has had was invisible that way -
 * `inputNeeded: [entry]` where the action carries `request`, a tool result
 * beside `chat/toolCallComplete` rather than in its `result`, a
 * `chat/turnCancelled` with no `duration`, which is not a missing number but
 * `NaN` and throws inside the reducer. VS Code runs these reducers. So does
 * `ahpc`. This is the only test that runs what they run.
 *
 * Each channel starts from the snapshot this host serves for it and then has
 * every action applied in the order they were sent, which is exactly what a
 * subscribed client does.
 */

const sdk = vi.hoisted(() => {
  interface Fake {
    frames: Record<string, unknown>[];
    wake: (() => void) | undefined;
    closed: boolean;
    options: Record<string, unknown>;
  }
  return {
    canUseTool: undefined as undefined | ((n: string, i: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
    queries: [] as Fake[],
  };
});

const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  listSessions: async () => [],
  getSessionMessages: async () => [],
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    const fake = { frames: [] as Record<string, unknown>[], wake: undefined as undefined | (() => void), closed: false, options };
    sdk.queries.push(fake);
    if (options.canUseTool) sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    void (async () => { for await (const _ of prompt) { /* drained */ } })();
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (fake.frames.length > 0) yield fake.frames.shift() as Record<string, unknown>;
          if (fake.closed) return;
          await new Promise<void>((resolve) => { fake.wake = resolve; });
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../src/host.js');
const { claude } = await import('../src/agents/claude.js');
const { shellTerminals } = await import('../src/terminals.js');
const { echo } = await import('../examples/echo/agent.js');

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    close: () => {},
  };
}

const settle = async (times = 6): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

beforeEach(() => {
  sdk.queries.length = 0;
  sdk.canUseTool = undefined;
});

async function running() {
  const host = createHost({ path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/live';
  const chatUri = 'ahp-chat:/live';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
  const root = await client.handle({ method: 'subscribe', params: { channel: 'ahp-root://' } }) as { snapshot: { state: unknown } };
  const session = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: unknown } };
  const chat = await client.handle({ method: 'subscribe', params: { channel: chatUri } }) as { snapshot: { state: unknown } };
  return {
    client, peer: p, uri, chatUri,
    opened: { 'ahp-root://': root.snapshot.state, [uri]: session.snapshot.state, [chatUri]: chat.snapshot.state },
  };
}

/** Say what the session's own CLI said. */
async function said(...frames: Record<string, unknown>[]): Promise<void> {
  const fake = sessionQueries().at(-1);
  if (!fake) throw new Error('no session CLI is running');
  fake.frames.push(...frames);
  fake.wake?.();
  fake.wake = undefined;
  await settle();
}

const dispatch = (client: { handle(r: { method: string; params: unknown }): unknown }, channel: string, action: Record<string, unknown>): void => {
  void client.handle({ method: 'dispatchAction', params: { channel, action } });
};

/** The reducer for a channel, by the scheme of its URI. */
const reducerFor = (channel: string): ((state: never, action: never) => unknown) => {
  if (channel.startsWith('ahp-root:')) return rootReducer as never;
  // Before the session test, because a changeset URI is a session URI with a
  // scope on the end: `<sessionUri>/changeset/<scope>`.
  if (channel.includes('/changeset/')) return changesetReducer as never;
  if (channel.startsWith('ahp-session:')) return sessionReducer as never;
  if (channel.startsWith('ahp-chat:')) return chatReducer as never;
  if (channel.startsWith('ahp-terminal:')) return terminalReducer as never;
  if (channel.startsWith('ahp-changeset:')) return changesetReducer as never;
  throw new Error(`no reducer for ${channel}`);
};

/**
 * Every channel as a client holds it: its snapshot, with every action applied.
 *
 * The action that throws is named rather than left to a stack trace, because
 * the useful half of this failing is knowing which one this host got wrong.
 */
function held(p: ReturnType<typeof peer>, opened: Record<string, unknown>): Record<string, Record<string, unknown>> {
  const state: Record<string, Record<string, unknown>> = {};
  for (const [channel, snapshot] of Object.entries(opened)) {
    state[channel] = structuredClone(snapshot) as Record<string, unknown>;
  }
  for (const note of p.notes) {
    if (note.method !== 'action') continue;
    const { channel, action } = note.params as { channel: string; action: Record<string, unknown> };
    const before = state[channel];
    if (!before) continue;
    try {
      state[channel] = reducerFor(channel)(before as never, action as never) as Record<string, unknown>;
    } catch (wrong) {
      throw new Error(`${String(action.type)} on ${channel}: ${wrong instanceof Error ? wrong.message : String(wrong)}`);
    }
  }
  return state;
}

type Chat = {
  turns: { state?: string; responseParts: Record<string, unknown>[] }[];
  activeTurn?: { responseParts: Record<string, unknown>[] };
};
type Session = { inputNeeded?: { id: string; kind: string }[]; status: number };

it('reduces a whole turn - prose, a tool that ran, and a tool that failed', async () => {
  const { client, peer: p, uri, chatUri, opened } = await running();
  dispatch(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } });
  await settle();
  await said(
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Looking' } } },
  );
  await said({
    type: 'assistant',
    message: { id: 'm2', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] },
  });
  await said({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'one two' }] },
  });
  await said({
    type: 'assistant',
    message: { id: 'm3', content: [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/nope' } }] },
  });
  await said({
    type: 'user',
    message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true, content: 'no such file' }] },
  });
  await said({ type: 'result', subtype: 'success', is_error: false, duration_ms: 42 });

  const state = held(p, opened);
  const chat = state[chatUri] as Chat;
  expect(chat.turns).toHaveLength(1);
  const parts = chat.turns[0]?.responseParts ?? [];
  expect(parts.map((one) => one.kind)).toEqual(['markdown', 'toolCall', 'toolCall']);

  // The tool's own output, which reaches a client only from inside `result`.
  const ran = parts[1]?.toolCall as { status: string; success: boolean; pastTenseMessage: string; content: { type: string; text: string }[] };
  expect(ran.status).toBe('completed');
  expect(ran.success).toBe(true);
  expect(ran.pastTenseMessage).toBeTruthy();
  expect(ran.content[0]).toEqual({ type: 'text', text: 'one two' });

  // And a tool that went wrong is `completed` too. `ToolCallStatus` has no
  // `failed`, so a status of this host's invention is one a reducer drops.
  const broke = parts[2]?.toolCall as { status: string; success: boolean; error?: { message: string } };
  expect(broke.status).toBe('completed');
  expect(broke.success).toBe(false);
  expect(broke.error?.message).toContain('no such file');
});

it('reduces a tool call somebody had to allow', async () => {
  const { client, peer: p, uri, chatUri, opened } = await running();
  dispatch(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } });
  await settle();
  await said({
    type: 'assistant',
    message: { id: 'm1', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'rm -rf x' } }] },
  });
  const asked = sdk.canUseTool?.('Bash', { command: 'rm -rf x' }, { toolUseID: 'toolu_1' });
  await settle();

  const waiting = held(p, opened);
  expect((waiting[uri] as Session).inputNeeded?.map((one) => one.kind)).toEqual(['toolConfirmation']);
  const open = (waiting[chatUri] as Chat).activeTurn?.responseParts ?? [];
  expect((open[0]?.toolCall as { status: string }).status).toBe('pending-confirmation');

  dispatch(client, chatUri, { type: 'chat/toolCallConfirmed', toolCallId: 'toolu_1', approved: true, confirmed: 'user-action' });
  await settle();
  await expect(asked).resolves.toMatchObject({ behavior: 'allow' });
  await said({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'gone' }] } });
  await said({ type: 'result', subtype: 'success', duration_ms: 5 });

  const state = held(p, opened);
  expect((state[uri] as Session).inputNeeded).toBeUndefined();
  const call = (state[chatUri] as Chat).turns[0]?.responseParts[0]?.toolCall as { status: string; confirmed: string };
  expect(call).toMatchObject({ status: 'completed', confirmed: 'user-action' });
});

it('reduces a question, and takes decline for an answer', async () => {
  const { client, peer: p, uri, chatUri, opened } = await running();
  dispatch(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } });
  await settle();
  const asked = sdk.canUseTool?.('AskUserQuestion', {
    header: 'Which way?',
    questions: [{ question: 'Left or right?', options: [{ label: 'Left' }, { label: 'Right' }] }],
  }, { toolUseID: 'req_1' });
  await settle();

  const waiting = held(p, opened);
  expect((waiting[uri] as Session).inputNeeded?.map((one) => one.kind)).toEqual(['chatInput']);
  // `chat/inputRequested` opens its own response part, the way toolCallStart
  // does - so exactly one is in the turn, not one and a duplicate.
  expect((waiting[chatUri] as Chat).activeTurn?.responseParts.map((one) => one.kind)).toEqual(['inputRequest']);

  /*
   * `response`, which is the field `chat/inputCompleted` has.
   *
   * `ChatInputResponseKind` is `accept`, `decline` or `cancel`. This host read
   * an `accepted` key that no client sends, so every answer arrived as an
   * accept - a person declining a question was indistinguishable from one
   * answering it, and the agent carried on with an answer nobody gave.
   */
  dispatch(client, chatUri, { type: 'chat/inputCompleted', requestId: 'req_1', response: 'decline' });
  await settle();
  await expect(asked).resolves.toMatchObject({ behavior: 'deny' });
  expect((held(p, opened)[uri] as Session).inputNeeded).toBeUndefined();
});

it('reduces a cancelled turn without throwing on its duration', async () => {
  const { client, peer: p, chatUri, opened } = await running();
  dispatch(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } });
  await settle();
  await said(
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Half' } } },
  );
  dispatch(client, chatUri, { type: 'chat/turnCancelled', turnId: 't1' });
  await settle();

  // `duration` is required and clamped with `Math.max(0, duration)`, so an
  // absent one is NaN rather than a missing number and the reducer throws
  // building a timestamp out of it - which stops that client reading the
  // channel at all, over a turn somebody merely cancelled.
  const chat = held(p, opened)[chatUri] as Chat;
  expect(chat.turns[0]?.state).toBe('cancelled');
  expect(chat.activeTurn).toBeUndefined();
});

it('reduces a turn that failed', async () => {
  const { client, peer: p, chatUri, opened } = await running();
  dispatch(client, chatUri, { type: 'chat/turnStarted', turnId: 't1', message: { text: 'go' } });
  await settle();
  await said({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 3 });

  const chat = held(p, opened)[chatUri] as Chat;
  expect(chat.turns[0]?.state).toBe('error');
  // 0.9.0 took `error` off `Turn` and gave the reason a response part, so what
  // went wrong is in the turn rather than beside it.
  expect(chat.turns[0]?.responseParts.some((one) => one.kind === 'error')).toBe(true);
});

it('reduces a terminal, from the bytes a shell wrote', async () => {
  const host = createHost({ path: '/tmp', agents: [claude({ paths: ['/tmp'] })], terminals: shellTerminals() });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: 'probe', protocolVersions: ['0.9.0'] },
  });
  const uri = 'ahp-terminal:/one';
  await client.handle({
    method: 'createTerminal',
    params: { channel: uri, claim: { kind: 'client', clientId: 'probe' }, cwd: 'file:///tmp' },
  });
  const first = await client.handle({ method: 'subscribe', params: { channel: uri } }) as { snapshot: { state: unknown } };
  dispatch(client, uri, { type: 'terminal/input', data: 'echo conformance-marker\n' });
  const heard = (): boolean => p.notes.some((n) => n.method === 'action'
    && JSON.stringify((n.params as { action: unknown }).action).includes('conformance-marker'));
  for (let i = 0; i < 100 && !heard(); i++) await new Promise((r) => { setTimeout(r, 20); });

  const state = held(p, { [uri]: first.snapshot.state })[uri] as {
    content: { type: string; value?: string; output?: string }[]; isPty: boolean;
  };
  /*
   * `terminal/data` appends to `content`, which is typed parts rather than one
   * string - a naive consumer rebuilds the raw stream by joining them. This
   * host writes to pipes rather than a pty and says so, which is what stops a
   * client drawing it as something that answers cursor movement.
   */
  expect(state.isPty).toBe(false);
  const raw = state.content.map((part) => part.type === 'command' ? part.output : part.value).join('');
  expect(raw).toContain('conformance-marker');
  await client.handle({ method: 'disposeTerminal', params: { channel: uri } });
});

it('reduces a changeset, through an operation and a turn', async () => {
  /*
   * A scripted source rather than `gitChanges`, for the reason
   * `test/operations.test.ts` uses one: what is under test is the shape of
   * what this host says about a changeset, and a real `git` would make it
   * depend on a repository somebody had to build first.
   */
  const source: ChangesetSource = {
    scopes: () => [{ id: 'uncommitted', label: 'Uncommitted Changes', changeKind: 'uncommitted' }],
    state: async () => ({ status: 'complete', files: [{ id: 'file:///tmp/ops/a.txt', edit: {} }] }),
    summary: () => ({ files: 1 }),
    operations: () => [{ id: 'commit', label: 'Commit', scopes: ['changeset'], writes: true }],
    invoke: async () => ({ message: 'committed' }),
  };
  const host = createHost({ path: '/tmp/ops', agents: [echo({ path: '/tmp/ops', pace: 0 })], changes: source });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  // `commit` writes, and a write is granted rather than assumed.
  await client.handle({
    method: 'resourceRequest', params: { channel: 'ahp-root://', uri: 'file:///tmp/ops', write: true },
  });
  const uri = 'ahp-session:/one';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'echo' } });
  const changeset = `${uri}/changeset/uncommitted`;
  const opened = await client.handle({ method: 'subscribe', params: { channel: changeset } }) as {
    snapshot: { state: unknown };
  };

  // A turn disables every operation while it runs, and an operation moves
  // through `running` and back. Both are `changeset/operationStatusChanged`
  // and `changeset/operationsChanged`, and both go through the reducer here.
  dispatch(client, 'ahp-chat:/one', { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } });
  await settle(12);
  await client.handle({ method: 'invokeChangesetOperation', params: { channel: changeset, operationId: 'commit' } });
  await settle(12);

  const state = held(p, { [changeset]: opened.snapshot.state })[changeset] as {
    operations?: { id: string; status: string }[];
    files?: unknown[];
  };
  expect(state.operations?.map((one) => one.id)).toEqual(['commit']);
  expect(state.operations?.[0]?.status).toBe('idle');
  expect(state.files).toHaveLength(1);
});

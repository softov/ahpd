import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A call a stop catches is told the turn was stopped, and the CLI is closed.
 *
 * A stop ends the turn, and the protocol's reducer closes a call still open
 * then as cancelled and skipped, never denied. This backend holds two kinds of
 * call: one waiting on a person's confirmation, answered in `canUseTool`, and
 * one a client is running, answered through the SDK server's handler. A stop
 * answers both with what happened, so no promise is left waiting, and closes
 * the CLI, as the reference stop aborts its query; the next turn goes to a CLI
 * that resumes the conversation.
 *
 * The cases hear an answer when its promise settles and a close when it is
 * called.
 */

const sdk = vi.hoisted(() => {
  const state = {
    held: [] as Record<string, unknown>[],
    wake: undefined as (() => void) | undefined,
    heard: [] as unknown[],
    canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
    servers: new Map<string, Record<string, unknown>>(),
    reset() { state.held = []; state.wake = undefined; state.heard = []; state.servers.clear(); },
    push(...frames: Record<string, unknown>[]) {
      state.held.push(...frames);
      state.wake?.();
      state.wake = undefined;
    },
    async next(): Promise<Record<string, unknown>> {
      while (state.held.length === 0) await new Promise<void>((resolve) => { state.wake = resolve; });
      return state.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => {
    sdk.servers.set(given.name as string, given);
    return { type: 'sdk', name: given.name, tools: given.tools };
  },
  query: ({ options }: { options: Record<string, unknown> }) => ({
    async *[Symbol.asyncIterator]() {
      sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
      for (;;) yield await sdk.next();
    },
    interrupt: async () => { sdk.heard.push('interrupt'); },
    setPermissionMode: async () => {},
    setModel: async () => {},
    applyFlagSettings: async () => {},
    toggleMcpServer: async () => {},
    reconnectMcpServer: async () => {},
    setMcpServers: async () => {},
    initializationResult: async () => ({}),
    mcpServerStatus: async () => [],
    reloadSkills: async () => ({ skills: [] }),
    reloadPlugins: async () => ({ plugins: [] }),
    supportedModels: async () => [],
    streamInput: async () => {},
    close: () => { sdk.heard.push('close'); },
  }),
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A tool a client offers, named the way the host names one: `<clientId>__<name>`. */
const offered: BoundTool = {
  owner: 'room',
  definition: {
    name: 'room__post_message',
    description: 'Say something in a room',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
} as unknown as BoundTool;

/** The name the CLI calls the client's tool by. */
const CALLED = 'mcp__client__room__post_message';

/** The model calling the client's tool, as the CLI reports the call. */
const calling = {
  type: 'assistant', parent_tool_use_id: null, uuid: 'a1',
  message: {
    id: 'msg_1', role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_post', name: CALLED, input: { text: 'hello' } }],
  },
};

/** A session with the client's tool on offer and a turn running, saying what it says to `emit`. */
async function started(emit: (channel: string, action: Bag) => void = () => {}): Promise<{ session: ReturnType<typeof createSession> }> {
  sdk.reset();
  const session = createSession({
    uri: 'ahp-session:/stopped-call',
    chatUri: 'ahp-chat:/stopped-call',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-stopped-call-')),
    emit: (channel, action) => { emit(channel, action as Bag); },
  });
  await settle();
  await session.setTools?.([offered]);
  session.sendMessage('t1', 'say hello in the room');
  await settle();
  sdk.push(calling);
  await settle();
  return { session };
}

/** The handler the SDK server was handed for the client's tool, which is what runs a call. */
const handler = (): ((input: Bag, extra: unknown) => Promise<unknown>) => {
  const tools = (sdk.servers.get('client')?.tools ?? []) as { name: string; handler: (input: Bag, extra: unknown) => Promise<unknown> }[];
  const tool = tools.find((one) => one.name === 'room__post_message');
  if (tool === undefined) throw new Error('the SDK server was handed no room__post_message');
  return tool.handler;
};

/** The text of an answer, whichever of the two kinds of call it settled. */
const said = (answer: unknown): string => {
  const bag = answer as Bag;
  if (typeof bag.message === 'string') return bag.message;
  return ((bag.content ?? []) as Bag[]).map((part) => part.text).join('');
};

/** The CLI reporting the call's result, which it does once it has recorded an answer. */
const reported = (text: string) => ({
  type: 'user', parent_tool_use_id: null, uuid: 'u1',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_post', is_error: true, content: text }] },
});

/** The CLI hearing an answer: kept as heard, and the call's result reported after it. */
const heard = (answer: unknown): void => {
  sdk.heard.push(answer);
  sdk.push(reported(said(answer)));
};

/*
 * The CLI calls a client's tool under the client server's prefix, and the call
 * names the tool by the name its client announced, so the client that owns it
 * finds it, as VS Code's Claude takes the prefix off.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L637-L638
 */
it('names a client tool\'s call by the tool\'s own name', async () => {
  const sent: Bag[] = [];
  const { session } = await started((_channel, action) => { sent.push(action); });
  expect(sent.find((one) => one.type === 'chat/toolCallStart')).toMatchObject({
    toolCallId: 'toolu_post',
    toolName: 'post_message',
    displayName: 'post_message',
    contributor: { kind: 'client', clientId: 'room' },
  });
  await session.close();
});

/*
 * The reference stop aborts its query, which fails every send it had not
 * answered; a question still waiting is answered here, so nothing waits on it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L487-L495
 */
it('tells a call waiting on a person that the turn was stopped, and closes the CLI', async () => {
  const { session } = await started();
  void sdk.canUseTool!(CALLED, { text: 'hello' }, { toolUseID: 'toolu_post', signal: new AbortController().signal, suggestions: [] })
    .then(heard);
  await settle();

  session.abort();
  await settle();

  const answered = sdk.heard.filter((one) => one !== 'close');
  expect(answered).toEqual([expect.objectContaining({ behavior: 'deny' })]);
  expect(said(answered[0])).toBe('The turn was stopped');
  expect(sdk.heard).toContain('close');
  expect(sdk.heard).not.toContain('interrupt');
});

it('tells a call a client is running that the turn was stopped, and closes the CLI', async () => {
  const { session } = await started();
  const asking = sdk.canUseTool!(CALLED, { text: 'hello' }, { toolUseID: 'toolu_post', signal: new AbortController().signal, suggestions: [] });
  await settle();
  session.confirm('toolu_post', true);
  await asking;
  void handler()({ text: 'hello' }, { _meta: { 'claudecode/toolUseId': 'toolu_post' } }).then(heard);
  await settle();

  session.abort();
  await settle();

  const answered = sdk.heard.filter((one) => one !== 'close');
  expect(answered).toHaveLength(1);
  expect(said(answered[0])).toContain('The turn was stopped');
  expect(sdk.heard).toContain('close');
  expect(sdk.heard).not.toContain('interrupt');
});

/*
 * A session stopped to be started again, as a restart or a move stops one.
 *
 * Its clients go on holding this chat's state, and the session that starts
 * behind it runs none of what this one held. So the question's entry comes
 * down and the turn ends cancelled, said where its clients hear it.
 * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L118
 */
it('says the questions and the turn it held ended, when it is stopped to start again', async () => {
  const sent: { channel: string; action: Bag }[] = [];
  const { session } = await started((channel, action) => { sent.push({ channel, action }); });
  void sdk.canUseTool!(CALLED, { text: 'hello' }, { toolUseID: 'toolu_post', signal: new AbortController().signal, suggestions: [] });
  await settle();
  /** The entries a client watching the session holds up, from every set and removal said so far. */
  const up = (): string[] => [...sent.reduce((held, { action }) => {
    if (action.type === 'session/inputNeededSet') held.add(String((action.request as Bag).id));
    if (action.type === 'session/inputNeededRemoved') held.delete(String(action.id));
    return held;
  }, new Set<string>())];
  expect(up()).toEqual(['toolu_post']);

  await session.close('stopping');

  expect(up()).toEqual([]);
  expect(sent.filter((one) => one.action.type === 'chat/turnCancelled').map((one) => one.action.turnId)).toEqual(['t1']);
});

it('closes the CLI at once at a stop of a turn whose open call the CLI runs itself', async () => {
  const { session } = await started();
  sdk.push({
    type: 'assistant', parent_tool_use_id: null, uuid: 'a2',
    message: {
      id: 'msg_2', role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_wait', name: 'Bash', input: { command: 'sleep 100', description: 'Wait' } }],
    },
  });
  await settle();

  session.abort();

  // Nothing of the CLI's own is answered here, and the close stops it.
  expect(sdk.heard).toEqual(['close']);
});

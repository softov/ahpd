import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { Bag } from '@ahpd/sdk';

/*
 * A turn stopped by a person leaves the session idle, not failed.
 *
 * The host says the stop, and the session's `abort` ends the turn cancelled
 * and closes the CLI. A CLI that is interrupted ends its turn with a result of
 * its own, `error_during_execution` with `is_error: true`, copied below from
 * the SDK this package depends on: what a closed CLI says after the stop is
 * read by nobody, so it fails nothing.
 */

/** The SDK's stream as a queue a test pushes frames into, read one at a time. */
const sdk = vi.hoisted(() => {
  const state = {
    held: [] as Record<string, unknown>[],
    wake: undefined as (() => void) | undefined,
    reset() { state.held = []; state.wake = undefined; },
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

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => ({
    async *[Symbol.asyncIterator]() {
      for (;;) yield await sdk.next();
    },
    interrupt: async () => {},
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
    close: () => {},
  }),
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The result the SDK sends after an interrupt, as the real one sent it. */
const interrupted = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  errors: ['[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use'],
  stop_reason: 'tool_use',
  duration_ms: 6000,
};

/** A turn that failed while it ran. */
const failed = { ...interrupted, errors: ['API Error: 500'], stop_reason: null };

/** A Bash call the model made, still running when the person stops the turn. */
const running = {
  type: 'assistant', parent_tool_use_id: null, uuid: 'a1',
  message: {
    id: 'msg_1', role: 'assistant',
    content: [{ type: 'tool_use', id: 'toolu_wait', name: 'Bash', input: { command: 'sleep 100', description: 'Wait' } }],
  },
};

/** The result the CLI writes for that call after the interrupt, as a real transcript holds it. */
const late = {
  type: 'user', parent_tool_use_id: null, uuid: 'u1',
  message: {
    role: 'user',
    content: [{
      type: 'tool_result', tool_use_id: 'toolu_wait', is_error: true,
      content: 'The user doesn\'t want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed.',
    }],
  },
};

/**
 * A session running turn `t1`: `sent` is what the session says, and `chat` is
 * what the chat's clients are told, the host's actions among them. The host
 * says the client's start before it hands the session the turn, and the
 * client's stop before it tells the session to stop; an end the session then
 * reports of a turn already ended is no client's to reduce.
 */
async function started() {
  sdk.reset();
  const sent: Bag[] = [];
  const chat: Bag[] = [];
  const edits: string[][] = [];
  const said = (action: Bag): void => { chat.push(action); };
  const backend = createSession({
    uri: 'ahp-session:/cancelled',
    chatUri: 'ahp-chat:/cancelled',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-cancelled-')),
    emit: (channel, action) => {
      sent.push(action as Bag);
      if (channel === 'chat') chat.push(action as Bag);
    },
    onFileEdit: (turnId, path, phase) => { edits.push([turnId, path, phase]); },
  });
  await settle();
  const before = backend.chatState();
  const session = {
    ...backend,
    abort: (): void => {
      said({ type: 'chat/turnCancelled', turnId: 't1', duration: 0 });
      backend.abort();
    },
  };
  said({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'count to 200', origin: { kind: 'user' } } });
  session.sendMessage('t1', 'count to 200');
  await settle();
  return { session, sent, chat, before, edits };
}

/** The chat a client builds from the state it started with and every chat action after it. */
const replayed = (before: Bag, chat: Bag[]): Bag =>
  chat.reduce<Bag>((state, action) => chatReducer(state as never, action as never) as unknown as Bag, before);

/** A call as a chat's ended turns hold it. */
const callIn = (state: Bag, id: string): Bag | undefined => ((state.turns ?? []) as Bag[])
  .flatMap((turn) => (turn.responseParts ?? []) as Bag[])
  .map((part) => part.toolCall as Bag | undefined)
  .find((call) => call?.toolCallId === id);

it('leaves a session idle when its turn was stopped, whatever its closed CLI says after', async () => {
  const { session, sent } = await started();

  session.abort();
  await settle();
  sdk.push(interrupted);
  await settle();

  // The session reports the turn's end once, and no failure.
  expect(sent.filter((one) => one.type === 'chat/turnCancelled')).toHaveLength(1);
  expect(sent.some((one) => one.type === 'chat/error')).toBe(false);
  expect(session.chatState().status).toBe(1);
});

it('leaves a stopped call as a client watching it built it', async () => {
  const { session, chat, before } = await started();
  sdk.push(running);
  await settle();

  session.abort();
  await settle();
  sdk.push(interrupted);
  await settle();

  const watched = callIn(replayed(before, chat), 'toolu_wait');
  expect(watched?.status).toBe('cancelled');
  expect(callIn(session.chatState(), 'toolu_wait')).toEqual(watched);
});

it('changes nothing when a stopped call\'s result comes after the stop', async () => {
  const { session, chat, before } = await started();
  sdk.push(running);
  await settle();

  session.abort();
  await settle();
  const stopped = chat.length;
  sdk.push(late, interrupted);
  await settle();

  // Every action the session sent names a turn, as the protocol requires.
  expect(chat.filter((one) => 'turnId' in one && typeof one.turnId !== 'string')).toEqual([]);
  // A client that reads the chat afterwards reads the call a client watching built.
  const watched = callIn(replayed(before, chat), 'toolu_wait');
  expect(watched?.status).toBe('cancelled');
  expect(callIn(session.chatState(), 'toolu_wait')).toEqual(watched);
  // And the stopped session does not go back to thinking.
  expect(chat.slice(stopped).filter((one) => one.type === 'chat/activityChanged' && one.activity !== undefined)).toEqual([]);
});

it('records a stopped edit against the turn it was made in', async () => {
  const { session, edits } = await started();
  sdk.push({
    type: 'assistant', parent_tool_use_id: null, uuid: 'a1',
    message: {
      id: 'msg_1', role: 'assistant',
      content: [{ type: 'tool_use', id: 'toolu_write', name: 'Write', input: { file_path: '/tmp/stopped.txt', content: 'half' } }],
    },
  });
  await settle();

  session.abort();
  await settle();
  sdk.push({ ...late, message: { role: 'user', content: [{ ...late.message.content[0], tool_use_id: 'toolu_write' }] } }, interrupted);
  await settle();

  expect(edits).toEqual([['t1', '/tmp/stopped.txt', 'before'], ['t1', '/tmp/stopped.txt', 'after']]);
});

it('still marks a session failed when a turn that was not stopped fails', async () => {
  const { session, sent } = await started();

  sdk.push(failed);
  await settle();

  // The failure is the turn's, said in its error part; `SessionState`
  // declares no field for it.
  const failure = sent.find((one) => one.type === 'chat/error');
  expect(((failure?.part as Bag | undefined)?.error as Bag | undefined)?.message).toBe('API Error: 500');
  expect('error' in session.sessionState()).toBe(false);
  expect(session.chatState().status).toBe(2);
});

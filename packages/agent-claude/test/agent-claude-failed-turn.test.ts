import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import { bag } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';

/*
 * A turn the CLI fails ends with the CLI's own words.
 *
 * The CLI gives up on a request with a frame of its own, an assistant message
 * with `error` and no model behind it, and then a `result` with `is_error`
 * whose `result` holds the same words. The frames below are the ones a CLI
 * 2.1.301 on SDK 0.3.301 sent for a turn with no login.
 */

/** The SDK's stream as a queue a test pushes frames into, read one at a time. */
const sdk = vi.hoisted(() => {
  const state = {
    held: [] as Record<string, unknown>[],
    wake: undefined as (() => void) | undefined,
    /** Every CLI a session started, with the options it was given and the way to close it. */
    queries: [] as { options: Record<string, unknown>; close: () => void }[],
    /** Every prompt the CLIs were handed, and the uuid it carried. */
    said: [] as unknown[],
    uuids: [] as (string | undefined)[],
    /** What the CLI's stream throws once it has nothing left to read, as a CLI that died. */
    failing: undefined as Error | undefined,
    reset() {
      state.held = [];
      state.wake = undefined;
      state.queries = [];
      state.said = [];
      state.uuids = [];
      state.failing = undefined;
    },
    push(...frames: Record<string, unknown>[]) {
      state.held.push(...frames);
      state.wake?.();
      state.wake = undefined;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  deleteSession: async () => {},
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    let closed = false;
    const fake = {
      options,
      close: (): void => {
        closed = true;
        sdk.wake?.();
      },
    };
    sdk.queries.push(fake);
    // What the session handed this CLI, read as the real one reads it.
    void (async () => {
      for await (const frame of prompt) {
        const { message, uuid } = frame as { message?: { content?: unknown }; uuid?: string };
        sdk.said.push(message?.content);
        sdk.uuids.push(uuid);
      }
    })().catch(() => { /* a CLI closed mid-read is the end of its stream */ });
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (sdk.held.length > 0) yield sdk.held.shift() as Record<string, unknown>;
          if (sdk.failing !== undefined) throw sdk.failing;
          if (closed) return;
          await new Promise<void>((resolve) => { sdk.wake = resolve; });
        }
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
      close: () => fake.close(),
    };
  },
}));

const { createSession } = await import('../src/session.js');
const { OpenLogins } = await import('../src/logins.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A session over a temporary folder, and everything it said on its chat. */
const live = (extra: Record<string, unknown> = {}) => {
  const chat: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/failed',
    chatUri: 'ahp-chat:/failed',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-failed-')),
    emit: (channel, action) => { if (channel === 'chat') chat.push(action as Bag); },
    ...extra,
  });
  return { session, chat };
};

const WORDS = 'Not logged in · Please run /login';

/** The CLI's own notice of the failure, as it sent it. */
const notice = {
  type: 'assistant',
  message: {
    diagnostics: null, id: '95843c42-b2b6-4665-ae38-c3432428fc59', container: null, model: '<synthetic>', role: 'assistant',
    stop_details: null, stop_reason: 'stop_sequence', stop_sequence: '', type: 'message',
    usage: {
      output_tokens_details: null, input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0,
      server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: null,
      cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }, inference_geo: null, iterations: null, speed: null, fallback_credit: null,
    },
    content: [{ type: 'text', text: WORDS }],
    context_management: null,
  },
  parent_tool_use_id: null,
  session_id: 'a144c24f-213e-4626-b34e-86f88206eab8',
  uuid: '8805f971-b7f8-493c-9960-27f9a1ea9ce3',
  timestamp: '2026-10-29T23:21:22.611Z',
  error: 'authentication_failed',
  is_api_error_message: true,
};

/** The result that ends the turn, as the CLI sent it. */
const result = {
  duration_api_ms: 0, stop_reason: 'stop_sequence', session_id: 'a144c24f-213e-4626-b34e-86f88206eab8', total_cost_usd: 0,
  usage: {
    output_tokens_details: { thinking_tokens: 0 }, input_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0,
    server_tool_use: { web_search_requests: 0, web_fetch_requests: 0 }, service_tier: 'standard',
    cache_creation: { ephemeral_1h_input_tokens: 0, ephemeral_5m_input_tokens: 0 }, inference_geo: '', iterations: [], speed: 'standard', fallback_credit: null,
  },
  modelUsage: {}, permission_denials: [], terminal_reason: 'api_error', fast_mode_state: 'off', fast_mode_disabled_reason: 'sdk_opt_in_required',
  safety_stops: 0, is_error: true, num_turns: 1, subtype: 'success', api_error_status: null, result: WORDS, type: 'result',
  duration_ms: 493, uuid: '18cfc8d0-a84e-4f81-a830-241e40c40175', queued_turn_count: 0, result_index: 0,
};

it("ends a turn the CLI failed with the CLI's own words, said once", async () => {
  sdk.reset();
  const chat: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/failed',
    chatUri: 'ahp-chat:/failed',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-failed-')),
    emit: (channel, action) => { if (channel === 'chat') chat.push(action as Bag); },
  });
  await settle();
  const before = session.chatState();
  // The client's start, which the host says before it hands the session the turn.
  chat.push({ type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text: 'Reply with the single word: ok', origin: { kind: 'user' } } });
  session.sendMessage('t1', 'Reply with the single word: ok');
  await settle();
  sdk.push(notice, result);
  await settle();

  const ended = chat.filter((one) => one.type === 'chat/error' && one.turnId === 't1');
  expect(ended).toHaveLength(1);
  expect(JSON.stringify(ended[0]?.part)).toContain(WORDS);
  // The words are the turn's failure, and not an answer beside it.
  const state = chat.reduce<Bag>((held, action) => chatReducer(held as never, action as never) as unknown as Bag, before);
  const parts = ((state.turns ?? []) as Bag[]).flatMap((turn) => (turn.responseParts ?? []) as Bag[]);
  expect(parts.filter((part) => part.kind === 'markdown' && String(part.content).includes(WORDS))).toEqual([]);
});

it('marks a failed model call resumable, on chat/error and on the turn', async () => {
  sdk.reset();
  const { session, chat } = live();
  await settle();
  session.sendMessage('t1', 'Reply with the single word: ok');
  await settle();
  sdk.push(notice, result);
  await settle();

  /*
   * Typed by the result's subtype, as VS Code's Claude mapper types a failed
   * result.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L541-L544
   */
  const part = { kind: 'error', error: { errorType: 'success', message: WORDS }, resumable: true };
  expect(chat.filter((one) => one.type === 'chat/error').at(-1)?.part).toEqual(part);
  expect((bag((session.chatState().turns as Bag[]).at(-1)).responseParts as Bag[]).at(-1)).toEqual(part);
  // A `success` the CLI says failed is a turn in error, so it can be resumed.
  expect(bag((session.chatState().turns as Bag[]).at(-1)).state).toBe('error');
});

it('does not mark a turn refused before the CLI resumable', async () => {
  sdk.reset();
  const { session, chat } = live();
  await settle();
  // The CLI dies, so the next turn is one that never reaches one.
  sdk.failing = new Error('the CLI went away');
  sdk.queries.at(-1)?.close();
  await settle();
  session.sendMessage('t1', 'one');
  await settle();

  const part = chat.find((one) => one.type === 'chat/error')?.part as Bag;
  expect(String(bag(part.error).message)).toContain('the CLI went away');
  expect(bag(part.error).errorType).toBe('sendFailed');
  expect(part.resumable).toBeUndefined();
  expect((bag((session.chatState().turns as Bag[]).at(-1)).responseParts as Bag[]).at(-1)).toEqual(part);
});

/*
 * A failure outside a result is typed by the stage it happened at, as VS
 * Code's host types a send that failed: `sendFailed`, for a turn whose CLI was
 * gone before it and for one whose CLI ended under it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2575
 */
it('types a failure outside a result as a failed send', async () => {
  sdk.reset();
  const { session, chat } = live();
  await settle();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'));
  await settle();
  // The CLI ends under the turn, and the CLI after it is gone before the next.
  sdk.queries.at(-1)?.close();
  await settle();
  sdk.failing = new Error('the CLI went away');
  session.sendMessage('t2', 'two');
  await settle();
  expect(chat.filter((one) => one.type === 'chat/error').map((one) => [one.turnId, bag(bag(one.part).error).errorType]))
    .toEqual([['t1', 'sendFailed'], ['t2', 'sendFailed']]);
});

/*
 * A stream that ends with no result fails the turn it was answering, as the
 * reference pipeline fails every send it had not answered, and the next turn
 * goes to a CLI that resumes the conversation.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L696-L718
 */
it('fails a turn whose CLI ended without a result, and sends the next to a CLI that resumes the conversation', async () => {
  sdk.reset();
  const { session, chat } = live();
  await settle();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'));
  await settle();
  sdk.queries.at(-1)?.close();
  await settle();

  expect(chat.filter((one) => one.type === 'chat/error').map((one) => [one.turnId, bag(bag(one.part).error).message]))
    .toEqual([['t1', 'Claude SDK stream ended without a result message']]);
  session.sendMessage('t2', 'two');
  await settle();
  expect(sdk.queries).toHaveLength(2);
  expect(sdk.queries.at(-1)?.options.resume).toBe(SESSION);
  expect(sdk.said).toEqual(['one', 'two']);
  sdk.push(worked);
  await settle();
  expect(chat.filter((one) => one.type === 'chat/turnComplete').map((one) => one.turnId)).toEqual(['t2']);
});

it('does not mark a turn whose login was refused resumable', async () => {
  sdk.reset();
  const logins = new OpenLogins();
  logins.opened({ id: 'work', adapter: 'claude-login', owner: 'host', config: { token: 'token-work' } });
  const { session, chat } = live({ preset: { logins: ['work'] }, logins: { open: logins, owner: () => 'host' } });
  await settle();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(
    { ...notice, message: { ...notice.message, content: [{ type: 'text', text: 'denied' }] } },
    { ...result, result: 'denied' },
  );
  await settle();

  const part = chat.filter((one) => one.type === 'chat/error').at(-1)?.part as Bag;
  expect(String(bag(part.error).message)).toContain('Claude refused login work (authentication_failed)');
  expect(part.resumable).toBeUndefined();
});

const SESSION = 'a144c24f-213e-4626-b34e-86f88206eab8';

/** An assistant frame, the CLI's record of a step of the turn, under `uuid`. */
const step = (uuid: string) => ({
  type: 'assistant',
  parent_tool_use_id: null,
  uuid,
  session_id: SESSION,
  message: { id: 'msg', role: 'assistant', model: 'claude', content: [{ type: 'text', text: 'ok' }] },
});

/** A result that ends the turn as one the model call failed. */
const broke = { ...result, subtype: 'error_during_execution', is_error: true };

/** A result that ends the turn as one that worked. */
const worked = { ...result, subtype: 'success', is_error: false, result: 'ok' };

/** A session with one turn that worked and one that failed, both ending in their own chain entry. */
const twoTurns = async () => {
  const { session, chat } = live();
  await settle();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'), worked);
  await settle();
  session.sendMessage('t2', 'two');
  await settle();
  sdk.push(step('a2'), broke);
  await settle();
  return { session, chat };
};

it('resumes a failed turn at the end of the turn before, and sends its prompt again', async () => {
  sdk.reset();
  const { session, chat } = await twoTurns();
  const clis = sdk.queries.length;
  const prompts = sdk.said.length;

  const said = chat.length;
  expect(() => session.resumeTurn?.('t2')).not.toThrow();

  await settle();
  // The client's resume is the host's to say, and nothing of the new run fails.
  expect(chat.slice(said).some((one) => one.type === 'chat/turnResume' || one.type === 'chat/error')).toBe(false);
  // A new CLI, cut at the end of the turn before - not at this turn's own last
  // entry, which holds the prompt that failed.
  expect(sdk.queries).toHaveLength(clis + 1);
  expect(sdk.queries.at(-1)?.options.resume).toBe(SESSION);
  expect(sdk.queries.at(-1)?.options.resumeSessionAt).toBe('a1');
  // The prompt once more, under an id of its own.
  expect(sdk.said.slice(prompts)).toEqual(['two']);
  expect(sdk.uuids[prompts]).not.toBe(sdk.uuids[prompts - 1]);
  // The turn is open again, with what it said before, and out of the history.
  const state = session.chatState() as Bag;
  expect(bag(state.activeTurn).id).toBe('t2');
  expect((state.turns as Bag[]).map((one) => one.id)).toEqual(['t1']);
});

it('resumes a turn whose model call failed, as the CLI reports it', async () => {
  sdk.reset();
  const { session } = live();
  await settle();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'), worked);
  await settle();
  session.sendMessage('t2', 'two');
  await settle();
  sdk.push(notice, result);
  await settle();

  expect(() => session.resumeTurn?.('t2')).not.toThrow();
  await settle();
  expect(sdk.queries.at(-1)?.options.resumeSessionAt).toBe('a1');
  expect(sdk.said.at(-1)).toBe('two');
});

it("starts a conversation's first turn over under its id", async () => {
  sdk.reset();
  const { session } = live();
  await settle();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'), broke);
  await settle();
  const clis = sdk.queries.length;

  expect(() => session.resumeTurn?.('t1')).not.toThrow();
  await settle();
  // Nothing to cut back to, so the conversation is deleted and named again.
  expect(sdk.queries).toHaveLength(clis + 1);
  expect(sdk.queries.at(-1)?.options.resume).toBeUndefined();
  expect(sdk.queries.at(-1)?.options.resumeSessionAt).toBeUndefined();
  expect(sdk.said.at(-1)).toBe('one');
});

it('ends a resumed turn that fails again with one more resumable error part', async () => {
  sdk.reset();
  const { session } = await twoTurns();
  expect(() => session.resumeTurn?.('t2')).not.toThrow();
  await settle();
  sdk.push(step('a3'), broke);
  await settle();

  const errors = ((session.chatState() as Bag).turns as Bag[])
    .at(-1)?.responseParts as Bag[];
  expect(errors.filter((part) => part.kind === 'error')).toHaveLength(2);
  expect(errors.at(-1)?.resumable).toBe(true);
  // And the turn can be asked for again.
  expect(() => session.resumeTurn?.('t2')).not.toThrow();
});

it('refuses a turn that cannot be resumed', async () => {
  // A turn is running.
  sdk.reset();
  const running = live();
  await settle();
  running.session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'), broke);
  await settle();
  running.session.sendMessage('t2', 'two');
  await settle();
  expect(() => running.session.resumeTurn?.('t1')).toThrow();

  // A turn that is not the latest.
  sdk.reset();
  const older = live();
  await settle();
  older.session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'), broke);
  await settle();
  older.session.sendMessage('t2', 'two');
  await settle();
  sdk.push(step('a2'), worked);
  await settle();
  expect(() => older.session.resumeTurn?.('t1')).toThrow();
  // A turn that did not fail.
  expect(() => older.session.resumeTurn?.('t2')).toThrow();

  // A turn that failed with nothing to run again on, whose part says so.
  sdk.reset();
  const gone = live();
  await settle();
  sdk.queries.at(-1)?.close();
  await settle();
  gone.session.sendMessage('t1', 'one');
  await settle();
  const turns = (gone.session.chatState() as Bag).turns as Bag[];
  expect((bag(turns.at(-1)).responseParts as Bag[]).at(-1)?.resumable).toBeUndefined();
  expect(() => gone.session.resumeTurn?.('t1')).toThrow();
});

/*
 * A result fails its turn as VS Code's Claude mapper reads one: a `success`
 * the CLI says failed and an `error_during_execution`; a turn or budget limit
 * the CLI stopped at completes the turn. Its duration is the time from the
 * send on this host's clock, as VS Code's pipeline completes a turn.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L568-L577
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L684-L693
 */
it('completes a turn the CLI stopped at a limit, measured on this host', async () => {
  sdk.reset();
  const { session, chat } = live();
  await settle();
  const sent = Date.now();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'), { ...result, subtype: 'error_max_turns', is_error: true, errors: [], duration_ms: 600000 });
  await settle();
  expect(chat.filter((one) => one.type === 'chat/error')).toEqual([]);
  const ended = chat.find((one) => one.type === 'chat/turnComplete' && one.turnId === 't1');
  expect(Number(ended?.duration)).toBeLessThanOrEqual(Date.now() - sent);
  expect(bag((session.chatState().turns as Bag[]).at(-1)).state).toBe('complete');
});

it('fails a turn whose result is an error during execution, typed by it, in its errors', async () => {
  sdk.reset();
  const { chat, session } = live();
  await settle();
  session.sendMessage('t1', 'one');
  await settle();
  sdk.push(step('a1'), { ...result, subtype: 'error_during_execution', is_error: true, errors: ['API Error: 500', 'again'] });
  await settle();
  expect(chat.filter((one) => one.type === 'chat/error').map((one) => bag(bag(one.part).error)))
    .toEqual([{ errorType: 'error_during_execution', message: 'API Error: 500\nagain' }]);
});

/*
 * A CLI running on its own, with no prompt pending, opens no turn a client did
 * not start: its lead frames are dropped, as VS Code's Claude router maps a
 * frame only to the prompt it answers, and a question it asks is refused, as
 * VS Code's host rejects a permission without an active turn.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkMessageRouter.ts#L82-L84
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1739-L1748
 */
it('opens no turn for a lead frame no prompt is pending for, and refuses its question', async () => {
  sdk.reset();
  const { chat, session } = live();
  await settle();
  sdk.push(step('a1'), worked);
  await settle();
  expect(chat).toEqual([]);
  expect((session.chatState() as Bag).activeTurn).toBeUndefined();
  const canUseTool = sdk.queries.at(-1)?.options.canUseTool as (name: string, input: Bag, about: Bag) => Promise<Bag>;
  expect(await canUseTool('Bash', { command: 'ls' }, { toolUseID: 'toolu_alone', signal: new AbortController().signal }))
    .toMatchObject({ behavior: 'deny' });
  expect(chat).toEqual([]);
});


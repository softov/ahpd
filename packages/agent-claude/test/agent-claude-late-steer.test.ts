import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { chatReducer } from '@microsoft/agent-host-protocol';
import type { Bag } from '@ahpd/sdk';

/*
 * A steering message the turn could not take in before its last answer.
 *
 * The CLI reads a message pushed while a turn runs at the turn's next tool
 * boundary. A message that arrives after the last one, while the model writes
 * its answer, is run by the CLI as a turn of its own: the first result, a
 * second `system/init`, the frames that answer the message, and a second
 * result. Each frame and result names the client uuids it answers in
 * `user_message_uuids`, and `command_lifecycle` frames say when the CLI queued,
 * started and completed each one.
 *
 * The fixtures are trimmed from real captures of the SDK this package depends
 * on (0.3.301, its bundled CLI 2.1.301), model `haiku`,
 * `includePartialMessages`:
 * - `claude-late-steer.jsonl`: a second message at the first text delta of a
 *   turn with no tool call;
 * - `claude-folded-steer.jsonl`: one at the tool call of a turn running
 *   `sleep 4`, in the same session;
 * - `claude-cancelled-steer.jsonl`: one at the first text delta of a turn that
 *   was interrupted once the CLI had queued it, which the CLI ran after the
 *   stop, and then a third prompt sent after that message's result;
 * - `claude-folded-stop.jsonl`: a turn interrupted at its first text delta
 *   after the CLI folded in a message sent at its tool call;
 * - `claude-failed-steer.jsonl`: a turn that failed at a turn limit of one,
 *   with a message sent as its tool's result arrived, which the CLI ran after
 *   the failure.
 * Trimmed: the `system/init` frames to the fields this host reads, thinking
 * signatures shortened, and the rate limit events left out.
 *
 * The `-transcript` fixtures are what the SDK's own transcript reader returned
 * for the same sessions, with the same signatures shortened.
 * `claude-folded-stop-transcript.jsonl` is a session that stopped a turn with a
 * message queued and then one with a message folded in, and
 * `claude-tool-stop-transcript.jsonl` one that stopped a turn while its tool
 * call ran.
 *
 * A read here is the backend's alone. The host reads a message the CLI ran
 * after the turn's last answer back inside the turn it steered, from its record
 * of the turns the chat began, which `host-local-turns.test.ts` in the sdk
 * drives with these same captures.
 */

const sdk = vi.hoisted(() => {
  const state = {
    held: [] as Record<string, unknown>[],
    wake: undefined as (() => void) | undefined,
    /** What the session handed the CLI, in order. */
    handed: [] as Bag[],
    /** The options of each CLI the session started, in order. */
    started: [] as Bag[],
    /** What the SDK's transcript reader returns. */
    messages: [] as Record<string, unknown>[],
    reset() { state.held = []; state.wake = undefined; state.handed = []; state.started = []; state.messages = []; },
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
  getSessionMessages: async () => sdk.messages,
  query: (given: { prompt: AsyncGenerator<Bag>; options?: Bag }) => {
    sdk.started.push(given.options ?? {});
    void (async () => { for await (const one of given.prompt) sdk.handed.push(one); })();
    // A closed CLI's stream ends, and the frames that come after are the next CLI's.
    let closed = false;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (sdk.held.length === 0 && !closed) await new Promise<void>((resolve) => { sdk.wake = resolve; });
          if (closed) return;
          yield sdk.held.shift() as Record<string, unknown>;
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
      close: () => {
        closed = true;
        sdk.wake?.();
        sdk.wake = undefined;
      },
    };
  },
}));

const { createSession } = await import('../src/session.js');
const { turnsOf } = await import('../src/transcript.js');

const fixture = (name: string): Record<string, unknown>[] => readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The late and the folded captures, one session: its prompts by the uuid each was sent under. */
const FIRST = '9975eb65-d506-4ab4-a8e6-6b318497c4e1';
const LATE = '46569a15-a821-8da6-9ea4-802e84d5af14';
const TOOL = '34c360d4-3f3a-4633-8f85-551354bb6668';
const FOLDED = '7e5694fd-eb5f-8b42-88a6-5eb2f7464e74';
/** The stop capture's. */
const STOPPED = '624de920-26a9-4fbf-b003-2ee6adf70168';
const SURVIVOR = 'cf45d386-073e-8d42-90d8-c9f220a3d39d';
const GAMMA = '9a9f0415-a3b9-4dd3-8784-8ecb598426be';
/** A stop after the CLI folded a steering message in. */
const FOLD_STOPPED = '932db394-2ecd-4674-9536-593a3644009b';
const FOLD_STEER = 'df6deef5-26bc-45aa-81b0-10339b67e721';
/** A turn that failed at its turn limit with a steering message queued. */
const LIMITED = '0bbc4aff-8f2b-4536-a33a-8d0587e38461';
const AFTER_LIMIT = 'efe5b13b-5b99-8a8e-88c6-aec14eb8e451';

const ALPHA_TEXT = 'Reply with exactly the word ALPHA and nothing else.';
const BETA_TEXT = 'Reply with exactly the word BETA and nothing else.';
const DONE_TEXT = 'Run the shell command `sleep 4` with the Bash tool, then reply with exactly the word DONE.';
const BETA2_TEXT = 'Also, at the very end of your reply, add the word BETA2.';
const COUNT_TEXT = 'Count from 1 to 60, one number per line, and nothing else.';
const GAMMA_TEXT = 'Reply with exactly the word GAMMA and nothing else.';
const SLEEP_COUNT_TEXT = 'Run the shell command `sleep 3` with the Bash tool, then count from 1 to 40, one number per line.';
const SLEEP_DONE_TEXT = 'Run the shell command `sleep 3` with the Bash tool, then reply with exactly the word DONE.';

/** Where a capture's frames stop for something to be sent: just after the frame `at` finds. */
const splitAfter = (frames: Record<string, unknown>[], at: (frame: Bag) => boolean): [Record<string, unknown>[], Record<string, unknown>[]] => {
  const index = frames.findIndex((frame) => at(frame as Bag));
  if (index < 0) throw new Error('the capture has no such frame');
  return [frames.slice(0, index + 1), frames.slice(index + 1)];
};

const isDelta = (frame: Bag): boolean => frame.type === 'stream_event' && (frame.event as Bag).type === 'content_block_delta';
const isToolCall = (frame: Bag): boolean => frame.type === 'assistant'
  && ((frame.message as Bag).content as Bag[]).some((block) => block.type === 'tool_use');

/** The late capture, cut at the first text delta, where the probe sent its second message. */
const late = (): [Record<string, unknown>[], Record<string, unknown>[]] => splitAfter(fixture('claude-late-steer.jsonl'), isDelta);

/** The folded capture, cut at the tool call, where the probe sent its second message. */
const folded = (): [Record<string, unknown>[], Record<string, unknown>[]] => splitAfter(fixture('claude-folded-steer.jsonl'), isToolCall);

/** Every record with one client uuid put in another's place, as the CLI would have written it. */
const renamed = (frames: Record<string, unknown>[], from: string, to: string): Record<string, unknown>[] =>
  frames.map((frame) => JSON.parse(JSON.stringify(frame).split(from).join(to)) as Record<string, unknown>);

/** The uuid the session handed the CLI its last message under. */
const lastSent = (): string => String(sdk.handed.at(-1)?.uuid ?? '');

/**
 * A turn a client sends, as the host takes it: refused while the chat has an
 * active turn, which is the host's rule in `packages/sdk/src/host/lifecycle.ts`,
 * and begun otherwise. Whether it was begun.
 */
const hostSends = (session: { chatState: () => unknown; sendMessage: (turnId: string, text: string) => unknown }, turnId: string, text: string): boolean => {
  if ((session.chatState() as Bag).activeTurn !== undefined) return false;
  session.sendMessage(turnId, text);
  return true;
};

/** The chat a client builds from the state it started with and every chat action after it. */
const replayed = (before: Bag, chat: Bag[]): Bag =>
  chat.reduce<Bag>((state, action) => chatReducer(state as never, action as never) as unknown as Bag, before);

/**
 * A session, and what its chat's clients are told, the host's actions among
 * them: the host says a client's start before it hands the session the turn,
 * and a client's stop of the chat's turn before it tells the session to stop.
 */
async function opened() {
  sdk.reset();
  const chat: Bag[] = [];
  const backend = createSession({
    uri: 'ahp-session:/late',
    chatUri: 'ahp-chat:/late',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-late-steer-')),
    // Copied as sent, as the wire would carry it: a part announced empty is filled in place afterwards.
    emit: (channel, action) => {
      if (channel === 'chat') chat.push(structuredClone(action) as Bag);
    },
  });
  await settle();
  // A copy: the state a session answers holds its own lists, which the turns that follow fill.
  const before = structuredClone(backend.chatState()) as Bag;
  const session = {
    ...backend,
    sendMessage: (turnId: string, text: string): void => {
      chat.push({ type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } });
      backend.sendMessage(turnId, text);
    },
    abort: (): void => {
      const running = (replayed(before, chat).activeTurn as Bag | undefined)?.id;
      if (running !== undefined) chat.push({ type: 'chat/turnCancelled', turnId: running, duration: 0 });
      backend.abort();
    },
  };
  return { session, chat, before };
}

/** The prose of one turn, part by part. */
const prose = (turn: Bag): string[] => ((turn.responseParts ?? []) as Bag[])
  .filter((part) => part.kind === 'markdown')
  .map((part) => String(part.content ?? ''));

/** What a client shows of each turn: its id, how it ended, the message it answers and whose that is, and its prose. */
const history = (turns: Bag[]): unknown[] => turns.map((turn) => [
  turn.id,
  turn.state,
  (turn.message as Bag).text,
  ((turn.message as Bag).origin as Bag | undefined)?.kind,
  prose(turn),
]);

/** The turns a transcript reads back as, from what the SDK's reader returns for it. */
async function readBack(messages: Record<string, unknown>[]): Promise<Bag[]> {
  sdk.messages = messages;
  return await turnsOf('session', '/tmp/project') as unknown as Bag[];
}

const said = (one: Bag): unknown => (one.message as Bag).content;

/** The late capture through a session, the steering message sent under `id`. */
async function liveLate(id: string) {
  const live = await opened();
  const [first, rest] = late();
  live.session.sendMessage(FIRST, ALPHA_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(live.session.sendSteeringMessage?.({ id, text: BETA_TEXT })).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(rest, LATE, steered));
  await settle();
  return { ...live, steered };
}

/** The folded capture through a session. */
async function liveFolded() {
  const live = await opened();
  const [first, rest] = folded();
  live.session.sendMessage(TOOL, DONE_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(live.session.sendSteeringMessage?.({ id: 's-folded', text: BETA2_TEXT })).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(rest, FOLDED, steered));
  await settle();
  return { ...live, steered };
}

/**
 * The stop capture through a session: the turn stopped once the CLI has queued
 * the steering message, which closes that CLI with the message in it, and the
 * capture's third prompt sent after the stop, which the next CLI answers.
 */
async function liveStop() {
  const live = await opened();
  const [first, rest] = splitAfter(fixture('claude-cancelled-steer.jsonl'), isDelta);
  const [queued, afterStop] = splitAfter(rest, (frame) => frame.type === 'command_lifecycle' && frame.command_uuid === SURVIVOR);
  const [, third] = splitAfter(afterStop, (frame) => frame.type === 'result'
    && (frame.user_message_uuids as string[]).includes(SURVIVOR));
  live.session.sendMessage(STOPPED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(live.session.sendSteeringMessage?.({ id: 's-stop', text: BETA_TEXT })).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(queued, SURVIVOR, steered));
  await settle();
  live.session.abort();
  await settle();
  live.session.sendMessage(GAMMA, GAMMA_TEXT);
  await settle();
  sdk.push(...renamed(third, SURVIVOR, steered));
  await settle();
  return { ...live, steered, conversation: String((first[0] as Bag).session_id) };
}

/** What the stop capture's turn had said when it was stopped: the count up to 25. */
const STOPPED_PROSE = Array.from({ length: 25 }, (_, at) => String(at + 1)).join('\n');

it('answers a steering message the CLI runs after the turn\'s last answer inside that turn', async () => {
  const { chat, before } = await liveLate(LATE);

  // The CLI was handed the steering message under the uuid its frames answer.
  expect(sdk.handed.map((one) => one.uuid)).toEqual([FIRST, LATE]);
  // One turn, begun by the client and ended once, after the answer to the steer.
  expect(chat.filter((one) => one.type === 'chat/turnStarted')).toHaveLength(1);
  const ends = chat.filter((one) => one.type === 'chat/turnComplete' || one.type === 'chat/error');
  expect(ends).toHaveLength(1);
  expect(ends[0]).toMatchObject({ type: 'chat/turnComplete', turnId: FIRST });

  const state = replayed(before, chat);
  expect(state.activeTurn).toBeUndefined();
  const turns = state.turns as Bag[];
  expect(history(turns)).toEqual([[FIRST, 'complete', ALPHA_TEXT, 'user', ['ALPHA', 'BETA']]]);
  // The turn is charged for both of the CLI's turns: the second result's running total.
  expect(((turns[0] as Bag).usage as Bag)?._meta).toMatchObject({ 'ahpd.cost': { amount: 0.00179864, currency: 'USD' } });
});

it('gives a steering message whose id is not a UUID a uuid of its own, and answers it in the turn', async () => {
  const { chat, before, steered } = await liveLate('s1');

  expect(steered).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u);
  // The steering message keeps its own id where a client sees it: the host
  // said its set, and the session says its removal when the CLI reads it.
  expect(chat.filter((one) => one.type === 'chat/pendingMessageSet')).toEqual([]);
  expect(chat.filter((one) => one.type === 'chat/pendingMessageRemoved')).toEqual([expect.objectContaining({ kind: 'steering', id: 's1' })]);
  expect(history(replayed(before, chat).turns as Bag[])).toEqual([[FIRST, 'complete', ALPHA_TEXT, 'user', ['ALPHA', 'BETA']]]);
});

it('ends the turn at its one result when the CLI folds the steering message into it', async () => {
  const { chat, before } = await liveFolded();

  const ends = chat.filter((one) => one.type === 'chat/turnComplete' || one.type === 'chat/error');
  expect(ends).toHaveLength(1);
  const state = replayed(before, chat);
  expect(state.activeTurn).toBeUndefined();
  expect(history(state.turns as Bag[])).toEqual([[TOOL, 'complete', DONE_TEXT, 'user', ['DONE BETA2']]]);
});

/*
 * A stop closes the CLI, as the reference stop aborts its query: the steering
 * message the CLI held goes with it and no turn opens for it, and the next turn
 * goes to a CLI that resumes the conversation.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L487-L495
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L415-L421
 */
it('opens no turn for steering after a stop, and sends the next turn to a CLI that resumes the conversation', async () => {
  const { chat, before, conversation } = await liveStop();

  expect(chat.filter((one) => one.type === 'chat/turnStarted').map((one) => one.turnId)).toEqual([STOPPED, GAMMA]);
  expect(sdk.started).toHaveLength(2);
  expect(sdk.started[1]).toMatchObject({ resume: conversation });
  const state = replayed(before, chat);
  expect(state.activeTurn).toBeUndefined();
  expect(history(state.turns as Bag[])).toEqual([
    [STOPPED, 'cancelled', COUNT_TEXT, 'user', [STOPPED_PROSE]],
    [GAMMA, 'complete', GAMMA_TEXT, 'user', ['GAMMA']],
  ]);
});

it('reads a steering message the CLI took in at a tool call back in the turn it steered, and one it ran late as the prompt it wrote', async () => {
  const foldedOne = await liveFolded();
  const foldedTurns = replayed(foldedOne.before, foldedOne.chat).turns as Bag[];

  const read = await readBack(renamed(fixture('claude-steered-transcript.jsonl'), FOLDED, foldedOne.steered));
  // The folded one comes back marked by the SDK's reader, in the turn a client saw.
  expect(history(read).at(-1)).toEqual(history(foldedTurns)[0]);
  // The late one is a prompt of its own in the transcript, which the host's
  // record of the turns the chat began reads back inside the turn it steered.
  expect(history(read)).toEqual([
    [FIRST, 'complete', ALPHA_TEXT, 'user', ['ALPHA']],
    [LATE, 'complete', BETA_TEXT, 'user', ['BETA']],
    [TOOL, 'complete', DONE_TEXT, 'user', ['DONE BETA2']],
  ]);
});

it('reads a stop back as a cancelled turn, and the steering message the CLI ran after it as a turn of its own', async () => {
  const read = await readBack(fixture('claude-cancelled-steer-transcript.jsonl'));
  expect(history(read)).toEqual([
    [STOPPED, 'cancelled', COUNT_TEXT, 'user', [STOPPED_PROSE]],
    [SURVIVOR, 'complete', BETA_TEXT, 'user', ['BETA']],
    [GAMMA, 'complete', GAMMA_TEXT, 'user', ['GAMMA']],
  ]);
});

it('reads a steering message the CLI took in before a stop back inside the stopped turn', async () => {
  const read = await readBack(fixture('claude-folded-stop-transcript.jsonl'));
  expect(history(read)).toEqual([
    ['136f888d-a4e8-4f3e-a0dc-935c62dfd988', 'cancelled', COUNT_TEXT, 'user', ['1\n2\n3\n4']],
    ['056b0890-1fcc-409a-ac24-b9fbca0270a3', 'complete', BETA_TEXT, 'user', ['BETA']],
    ['932db394-2ecd-4674-9536-593a3644009b', 'cancelled', 'Run the shell command `sleep 3` with the Bash tool, then count from 1 to 40, one number per line.', 'user', ['1']],
  ]);
});

it('reads a stop that came while a tool call ran back as a cancelled turn', async () => {
  const read = await readBack(fixture('claude-tool-stop-transcript.jsonl'));
  expect(history(read)).toEqual([
    ['f6f6985d-8229-4c51-9468-ce0c145f71db', 'cancelled', 'Run the shell command `sleep 8` with the Bash tool, then reply with exactly the word DONE.', 'user', []],
    ['bac3f7c1-5bc6-82a0-bf9f-fcb5bcf77548', 'complete', BETA_TEXT, 'user', ['BETA']],
  ]);
});

it('opens no turn for a steering message the CLI took in before the stop', async () => {
  const { session, chat, before } = await opened();
  const [first, rest] = splitAfter(fixture('claude-folded-stop.jsonl'), isToolCall);
  const [taken] = splitAfter(rest, isDelta);
  session.sendMessage(FOLD_STOPPED, SLEEP_COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(session.sendSteeringMessage?.({ id: 's-folded', text: BETA2_TEXT })).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(taken, FOLD_STEER, steered));
  await settle();
  session.abort();
  await settle();

  // The CLI had started the message inside the stopped turn, which the stop closed with it.
  expect((session.chatState() as Bag).activeTurn).toBeUndefined();
  expect(chat.filter((one) => one.type === 'chat/turnStarted')).toHaveLength(1);
  expect(chat.filter((one) => one.type === 'chat/error')).toEqual([]);
  const live = history(replayed(before, chat).turns as Bag[]);
  expect(live).toEqual([[FOLD_STOPPED, 'cancelled', SLEEP_COUNT_TEXT, 'user', ['1']]]);
  // Read back, the stopped turn is the one a client saw.
  const read = await readBack(renamed(fixture('claude-folded-stop-transcript.jsonl'), FOLD_STEER, steered));
  expect(history(read).slice(-1)).toEqual(live);
});

/*
 * A steering message is the turn's it went into, as the reference steering
 * entry takes the in-flight send's turn: when that turn fails, no turn opens
 * for the message, and what the CLI answers it with goes nowhere.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L454-L470
 */
it('opens no turn for a steering message the CLI holds when its turn fails', async () => {
  const { session, chat, before } = await opened();
  // The probe sent the steering message as the tool's result arrived, which is the turn's last round.
  const [first, rest] = splitAfter(fixture('claude-failed-steer.jsonl'), (frame) => frame.type === 'user');
  const [failed, answered] = splitAfter(rest, (frame) => frame.type === 'result');
  session.sendMessage(LIMITED, SLEEP_DONE_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(session.sendSteeringMessage?.({ id: 's-limit', text: BETA_TEXT })).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(failed, AFTER_LIMIT, steered));
  await settle();
  sdk.push(...renamed(answered, AFTER_LIMIT, steered));
  await settle();

  expect(chat.filter((one) => one.type === 'chat/error')).toEqual([expect.objectContaining({ turnId: LIMITED })]);
  expect(chat.filter((one) => one.type === 'chat/turnStarted').map((one) => one.turnId)).toEqual([LIMITED]);
  expect(history(replayed(before, chat).turns as Bag[])).toEqual([
    [LIMITED, 'error', SLEEP_DONE_TEXT, 'user', []],
  ]);
  // The CLI owes nothing once it has answered the message, so a turn sent now goes out.
  expect(hostSends(session, GAMMA, GAMMA_TEXT)).toBe(true);
  await settle();
  expect(sdk.handed.map((one) => one.uuid)).toEqual([LIMITED, steered, GAMMA]);
});

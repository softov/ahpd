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
 * - `claude-stopped-turn.jsonl`: a turn interrupted at its first text delta
 *   with nothing queued, and a prompt sent right after the stop;
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
    /** What the SDK's transcript reader returns. */
    messages: [] as Record<string, unknown>[],
    reset() { state.held = []; state.wake = undefined; state.handed = []; state.messages = []; },
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
  getSessionMessages: async () => sdk.messages,
  query: (given: { prompt: AsyncGenerator<Bag> }) => {
    void (async () => { for await (const one of given.prompt) sdk.handed.push(one); })();
    return {
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
/** A stop with nothing queued, and a prompt sent right after it. */
const HALTED = 'b894055c-32a4-4d79-9e12-1f5d77db9866';
const AFTER = '352a49cc-15ea-4bac-8f49-bdacd767953e';
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
const hostSends = (session: { chatState: () => unknown; begin: (turnId: string, text: string) => void }, turnId: string, text: string): boolean => {
  if ((session.chatState() as Bag).activeTurn !== undefined) return false;
  session.begin(turnId, text);
  return true;
};

async function opened() {
  sdk.reset();
  const chat: Bag[] = [];
  const session = createSession({
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
  const before = structuredClone(session.chatState()) as Bag;
  return { session, chat, before };
}

/** The chat a client builds from the state it started with and every chat action after it. */
const replayed = (before: Bag, chat: Bag[]): Bag =>
  chat.reduce<Bag>((state, action) => chatReducer(state as never, action as never) as unknown as Bag, before);

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
  live.session.begin(FIRST, ALPHA_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(live.session.steer?.(id, BETA_TEXT)).toBe(true);
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
  live.session.begin(TOOL, DONE_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(live.session.steer?.('s-folded', BETA2_TEXT)).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(rest, FOLDED, steered));
  await settle();
  return { ...live, steered };
}

/**
 * The stop capture through a session: the turn stopped once the CLI has queued
 * the steering message, and the third prompt sent once that message's result
 * is in.
 */
async function liveStop() {
  const live = await opened();
  const [first, rest] = splitAfter(fixture('claude-cancelled-steer.jsonl'), isDelta);
  const [queued, afterStop] = splitAfter(rest, (frame) => frame.type === 'command_lifecycle' && frame.command_uuid === SURVIVOR);
  const [answered, third] = splitAfter(afterStop, (frame) => frame.type === 'result'
    && (frame.user_message_uuids as string[]).includes(SURVIVOR));
  live.session.begin(STOPPED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(live.session.steer?.('s-stop', BETA_TEXT)).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(queued, SURVIVOR, steered));
  await settle();
  live.session.cancel(STOPPED);
  await settle();
  sdk.push(...renamed(answered, SURVIVOR, steered));
  await settle();
  live.session.begin(GAMMA, GAMMA_TEXT);
  await settle();
  sdk.push(...renamed(third, SURVIVOR, steered));
  await settle();
  return { ...live, steered };
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
  // The steering message keeps its own id where a client sees it.
  expect(chat.filter((one) => one.type === 'chat/pendingMessageSet')).toEqual([expect.objectContaining({ kind: 'steering', id: 's1' })]);
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

it('begins a queued message only once the steering message the CLI still owed has its answer', async () => {
  const { session, chat, before } = await opened();
  const [first, rest] = late();
  const [owed, after] = splitAfter(rest, (frame) => frame.type === 'result');
  session.begin(FIRST, ALPHA_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(session.steer?.('s1', BETA_TEXT)).toBe(true);
  session.queue('q1', 'second');
  await settle();
  const steered = String(sdk.handed[1]?.uuid ?? '');
  // The first answer's result: the steer is still owed, so the queue waits.
  sdk.push(...renamed(owed, LATE, steered));
  await settle();
  expect(chat.filter((one) => one.type === 'chat/turnStarted')).toHaveLength(1);
  expect(sdk.handed.map(said)).not.toContain('second');

  sdk.push(...renamed(after, LATE, steered));
  await settle();
  const started = chat.filter((one) => one.type === 'chat/turnStarted');
  expect(started).toHaveLength(2);
  expect(started[1]).toMatchObject({ queuedMessageId: 'q1' });
  expect(sdk.handed.map(said).at(-1)).toBe('second');

  expect(history(replayed(before, chat).turns as Bag[])).toEqual([[FIRST, 'complete', ALPHA_TEXT, 'user', ['ALPHA', 'BETA']]]);
});

it('answers a steering message the CLI runs after a stop in a turn that carries it', async () => {
  const { chat, before, steered } = await liveStop();

  expect(chat.filter((one) => one.type === 'chat/turnCancelled')).toEqual([expect.objectContaining({ turnId: STOPPED })]);
  const state = replayed(before, chat);
  expect(state.activeTurn).toBeUndefined();
  // What the stopped answer said after the stop is not added to it, nor opened as a turn.
  expect(history(state.turns as Bag[])).toEqual([
    [STOPPED, 'cancelled', COUNT_TEXT, 'user', [STOPPED_PROSE]],
    [steered, 'complete', BETA_TEXT, 'user', ['BETA']],
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
  const live = await liveStop();
  const liveTurns = replayed(live.before, live.chat).turns as Bag[];

  const read = await readBack(renamed(fixture('claude-cancelled-steer-transcript.jsonl'), SURVIVOR, live.steered));
  expect(history(read)).toEqual(history(liveTurns));
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

it('opens the turn of a steering message the CLI holds as its turn is stopped, so a turn sent meanwhile waits for it', async () => {
  const { session, chat, before } = await opened();
  const [first, rest] = splitAfter(fixture('claude-cancelled-steer.jsonl'), isDelta);
  const [queued, afterStop] = splitAfter(rest, (frame) => frame.type === 'command_lifecycle' && frame.command_uuid === SURVIVOR);
  const [answered, third] = splitAfter(afterStop, (frame) => frame.type === 'result'
    && (frame.user_message_uuids as string[]).includes(SURVIVOR));
  session.begin(STOPPED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(session.steer?.('s-stop', BETA_TEXT)).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(queued, SURVIVOR, steered));
  await settle();
  session.cancel(STOPPED);
  await settle();

  // The steering message's turn opens as the stopped turn ends, naming the message it answers.
  expect(chat.filter((one) => one.type === 'chat/turnStarted').at(-1)).toMatchObject({
    turnId: steered, queuedMessageId: 's-stop', message: { text: BETA_TEXT, origin: { kind: 'user' } },
  });
  // It is the chat's active turn, so the host refuses a turn sent now.
  expect(hostSends(session, GAMMA, GAMMA_TEXT)).toBe(false);

  sdk.push(...renamed(answered, SURVIVOR, steered));
  await settle();
  // Answered, it ends, and a turn sent now gets only its own answer.
  expect(hostSends(session, GAMMA, GAMMA_TEXT)).toBe(true);
  await settle();
  sdk.push(...renamed(third, SURVIVOR, steered));
  await settle();
  expect(sdk.handed.map((one) => one.uuid)).toEqual([STOPPED, steered, GAMMA]);
  expect(history(replayed(before, chat).turns as Bag[])).toEqual([
    [STOPPED, 'cancelled', COUNT_TEXT, 'user', [STOPPED_PROSE]],
    [steered, 'complete', BETA_TEXT, 'user', ['BETA']],
    [GAMMA, 'complete', GAMMA_TEXT, 'user', ['GAMMA']],
  ]);
});

it('ends a steering message\'s own turn for good when it is stopped before the CLI took the message in', async () => {
  const { session, chat, before } = await opened();
  const [first, rest] = splitAfter(fixture('claude-cancelled-steer.jsonl'), isDelta);
  const [queued, afterStop] = splitAfter(rest, (frame) => frame.type === 'command_lifecycle' && frame.command_uuid === SURVIVOR);
  const [answered] = splitAfter(afterStop, (frame) => frame.type === 'result'
    && (frame.user_message_uuids as string[]).includes(SURVIVOR));
  session.begin(STOPPED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(session.steer?.('s-stop', BETA_TEXT)).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(queued, SURVIVOR, steered));
  await settle();
  session.cancel(STOPPED);
  await settle();
  // The message's own turn, stopped while the CLI still holds the message.
  session.cancel(steered);
  await settle();
  sdk.push(...renamed(answered, SURVIVOR, steered));
  await settle();

  // The message was that turn's prompt, so no turn opens for it again, and its answer goes nowhere.
  expect(chat.filter((one) => one.type === 'chat/turnStarted').map((one) => one.turnId)).toEqual([STOPPED, steered]);
  expect(history(replayed(before, chat).turns as Bag[])).toEqual([
    [STOPPED, 'cancelled', COUNT_TEXT, 'user', [STOPPED_PROSE]],
    [steered, 'cancelled', BETA_TEXT, 'user', []],
  ]);
  expect(hostSends(session, GAMMA, GAMMA_TEXT)).toBe(true);
});

it('ends no turn sent after a stop at the stopped turn\'s result', async () => {
  const { session, chat, before } = await opened();
  const [first, rest] = splitAfter(fixture('claude-stopped-turn.jsonl'), isDelta);
  session.begin(HALTED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  session.cancel(HALTED);
  await settle();
  // Nothing was left with the CLI, so a turn sent now begins at once.
  expect(hostSends(session, AFTER, GAMMA_TEXT)).toBe(true);
  await settle();
  sdk.push(...rest);
  await settle();

  expect(chat.filter((one) => one.type === 'chat/error')).toEqual([]);
  expect(history(replayed(before, chat).turns as Bag[])).toEqual([
    [HALTED, 'cancelled', COUNT_TEXT, 'user', ['1']],
    [AFTER, 'complete', GAMMA_TEXT, 'user', ['GAMMA']],
  ]);
});

/*
 * A stopped turn starts nothing behind it: the reference host leaves queued
 * messages queued, and a message set while idle starts the first of them.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1950-L1954
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L245-L286
 */
it('starts nothing behind a stopped turn, and its queue\'s head once a message is queued after it', async () => {
  const { session, chat } = await opened();
  const [first, rest] = splitAfter(fixture('claude-stopped-turn.jsonl'), isDelta);
  const [stopped] = splitAfter(rest, (frame) => frame.type === 'result');
  session.begin(HALTED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  session.queue('waiting', BETA_TEXT);
  await settle();
  session.cancel(HALTED);
  await settle();
  sdk.push(...stopped);
  await settle();

  expect((session.chatState() as Bag).activeTurn).toBeUndefined();
  expect(sdk.handed.some((one) => JSON.stringify(one).includes('BETA'))).toBe(false);
  session.queue('later', GAMMA_TEXT);
  await settle();
  const started = chat.filter((one) => one.type === 'chat/turnStarted');
  expect(started.at(-1)?.queuedMessageId).toBe('waiting');
});

/*
 * A client's reorder, or removal, while nothing runs runs the reference host's
 * drain, which starts the head of a queue a stop left waiting.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L71-L90
 */
it.each([
  ['reorders', 'reorder'],
  ['takes a message back from', 'unqueue'],
] as const)('starts the head once a client %s a stopped turn\'s queue', async (_, change) => {
  const { session, chat } = await opened();
  const [first, rest] = splitAfter(fixture('claude-stopped-turn.jsonl'), isDelta);
  const [stopped] = splitAfter(rest, (frame) => frame.type === 'result');
  session.begin(HALTED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  session.queue('waiting', BETA_TEXT);
  session.queue('later', GAMMA_TEXT);
  await settle();
  session.cancel(HALTED);
  await settle();
  sdk.push(...stopped);
  await settle();
  const started = (): Bag[] => chat.filter((one) => one.type === 'chat/turnStarted');
  expect(started()).toHaveLength(1);

  if (change === 'reorder') session.reorder(['later', 'waiting']);
  else session.unqueue('waiting');
  await settle();
  expect(started().at(-1)?.queuedMessageId).toBe('later');
});

/*
 * Steering that came too late to steer a turn runs next, ahead of queued
 * messages, in the order it came, and the chat shows the steering message set
 * last, as the protocol's reducer holds one.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L266-L267
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/common/agentSessionMessage.ts#L17-L22
 */
it('runs two idle steering messages in the order they were sent, ahead of what is queued', async () => {
  const { session, chat } = await opened();
  const [first, rest] = splitAfter(fixture('claude-stopped-turn.jsonl'), isDelta);
  const [stopped] = splitAfter(rest, (frame) => frame.type === 'result');
  session.begin(HALTED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  session.cancel(HALTED);
  await settle();
  // The CLI still owes the stopped turn's result, so these wait for it.
  session.queue('waiting', BETA_TEXT);
  session.queue('s1', ALPHA_TEXT, undefined, undefined, undefined, undefined, 'steering');
  session.queue('s2', GAMMA_TEXT, undefined, undefined, undefined, undefined, 'steering');
  await settle();
  sdk.push(...stopped);
  await settle();

  expect(chat.filter((one) => one.type === 'chat/turnStarted').at(-1)?.queuedMessageId).toBe('s1');
  const state = session.chatState() as Bag;
  expect((state.steeringMessage as Bag | undefined)?.id).toBe('s2');
  expect((state.queuedMessages as Bag[]).map((one) => one.id)).toEqual(['waiting']);
});

/*
 * A steering `!command` waits as steering and runs as a command, as the
 * reference host's drain admits a `!` command from its queue.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/localCommand/localCommandContribution.ts#L30-L44
 */
it('runs an idle steering !command ahead of what is queued, as a command', async () => {
  const { session, chat } = await opened();
  const [first, rest] = splitAfter(fixture('claude-stopped-turn.jsonl'), isDelta);
  const [stopped] = splitAfter(rest, (frame) => frame.type === 'result');
  session.begin(HALTED, COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  session.cancel(HALTED);
  await settle();
  session.queue('waiting', BETA_TEXT);
  session.ran?.('t-cmd', 'echo hi', async () => ({ success: true, said: 'Ran echo hi', output: 'hi', code: 0 }), 'c1', 'steering');
  await settle();
  expect(chat.filter((one) => one.type === 'chat/pendingMessageSet' && one.id === 'c1').map((one) => one.kind)).toEqual(['steering']);

  sdk.push(...stopped);
  await settle();
  // The command runs first, and the queued message after it.
  const started = chat.filter((one) => one.type === 'chat/turnStarted');
  expect(started.map((one) => one.queuedMessageId)).toEqual([undefined, 'c1', 'waiting']);
  expect(started[1]).toMatchObject({ message: { text: '!echo hi' } });
});

it('opens no turn for a steering message the CLI took in before the stop', async () => {
  const { session, chat, before } = await opened();
  const [first, rest] = splitAfter(fixture('claude-folded-stop.jsonl'), isToolCall);
  const [taken, after] = splitAfter(rest, isDelta);
  session.begin(FOLD_STOPPED, SLEEP_COUNT_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(session.steer?.('s-folded', BETA2_TEXT)).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(taken, FOLD_STEER, steered));
  await settle();
  session.cancel(FOLD_STOPPED);
  await settle();

  // The CLI had started the message inside the stopped turn, so no turn is left to answer it.
  expect((session.chatState() as Bag).activeTurn).toBeUndefined();
  sdk.push(...renamed(after, FOLD_STEER, steered));
  await settle();
  expect(chat.filter((one) => one.type === 'chat/turnStarted')).toHaveLength(1);
  expect(chat.filter((one) => one.type === 'chat/error')).toEqual([]);
  const live = history(replayed(before, chat).turns as Bag[]);
  expect(live).toEqual([[FOLD_STOPPED, 'cancelled', SLEEP_COUNT_TEXT, 'user', ['1']]]);
  // Read back, the stopped turn is the one a client saw.
  const read = await readBack(renamed(fixture('claude-folded-stop-transcript.jsonl'), FOLD_STEER, steered));
  expect(history(read).slice(-1)).toEqual(live);
});

it('opens the turn of a steering message the CLI holds when its turn fails', async () => {
  const { session, chat, before } = await opened();
  // The probe sent the steering message as the tool's result arrived, which is the turn's last round.
  const [first, rest] = splitAfter(fixture('claude-failed-steer.jsonl'), (frame) => frame.type === 'user');
  const [failed, answered] = splitAfter(rest, (frame) => frame.type === 'result');
  session.begin(LIMITED, SLEEP_DONE_TEXT);
  await settle();
  sdk.push(...first);
  await settle();
  expect(session.steer?.('s-limit', BETA_TEXT)).toBe(true);
  await settle();
  const steered = lastSent();
  sdk.push(...renamed(failed, AFTER_LIMIT, steered));
  await settle();

  // The turn ends where it failed, and the steering message's turn is the chat's active turn at once.
  expect(chat.filter((one) => one.type === 'chat/error')).toEqual([expect.objectContaining({ turnId: LIMITED })]);
  expect(chat.filter((one) => one.type === 'chat/turnStarted').at(-1)).toMatchObject({ turnId: steered, queuedMessageId: 's-limit' });
  expect(hostSends(session, GAMMA, GAMMA_TEXT)).toBe(false);
  sdk.push(...renamed(answered, AFTER_LIMIT, steered));
  await settle();
  expect(history(replayed(before, chat).turns as Bag[])).toEqual([
    [LIMITED, 'error', SLEEP_DONE_TEXT, 'user', []],
    [steered, 'complete', BETA_TEXT, 'user', ['BETA']],
  ]);
});

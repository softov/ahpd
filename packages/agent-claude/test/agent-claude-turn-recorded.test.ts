import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, SubagentChat, SubagentRequest } from '@ahpd/sdk';

/*
 * The id a turn is written under in the CLI's transcript.
 *
 * The CLI writes a streamed prompt under the `uuid` the prompt carries and
 * echoes nothing back, so the session names it when it sends it: the turn's
 * own id where that is a UUID, and a uuid of its own otherwise, which it says
 * to the host once through `onTurnRecorded`. The reference writes a prompt
 * under its turn id the same way.
 *
 * The capture here is `claude-subagent-ask.jsonl`, a real `claude -p` session
 * that delegated and was answered: its first `user` frame is the worker's own
 * prompt, and the frames after it are tool results, none of which names the
 * lead turn.
 */

/**
 * The SDK's stream as a queue a test pushes frames into, and the CLI's input
 * as the list of prompts the session put on it.
 *
 * Pulled one frame at a time, so a test can begin a turn between two frames
 * the way a live stream allows. Each query reads the feed that was current
 * when it was made, so a session left over from an earlier case never takes a
 * later case's frames.
 */
const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    feed: fresh(),
    /** Every prompt the current session sent the CLI, in order. */
    sent: [] as Record<string, unknown>[],
    /** Start a new feed for the next session. */
    reset() { state.feed = fresh(); state.sent = []; },
    /** Queue frames for the current session to read. */
    push(...frames: Record<string, unknown>[]) {
      const feed = state.feed;
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    /** One feed's next frame, once one is queued. */
    async next(feed: Feed): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: ({ prompt, options }: { prompt: AsyncIterable<Record<string, unknown>>; options: Record<string, unknown> }) => {
    const feed = sdk.feed;
    const sent = sdk.sent;
    void options;
    // The input read as the CLI reads it, one prompt at a time.
    void (async () => { for await (const one of prompt) sent.push(one); })().catch(() => {});
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: async () => {},
      // The control protocol `describe()` asks before any turn runs.
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

const fixture = (name: string): Record<string, unknown>[] => readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A turn id of the shape a client like VS Code sends. */
const TURN = 'bbbbbbbb-0000-4000-8000-000000000001';

/** Run a real session, recording every id it reports a turn under. */
async function replay() {
  sdk.reset();
  const recorded: [string, string][] = [];
  const main: { channel: string; action: Bag }[] = [];
  const subagent = (): SubagentChat => {
    const uri = 'ahp-chat://subagent/fake';
    return {
      uri,
      turnId: 'wturn',
      emit: (action: Bag) => { main.push({ channel: 'worker', action }); },
      end: () => {},
    };
  };
  const session = createSession({
    uri: 'ahp-session:/recorded',
    chatUri: 'ahp-chat:/recorded',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-recorded-')),
    emit: (channel, action) => { main.push({ channel, action: action as Bag }); },
    subagent: subagent as (toolCallId: string, request: SubagentRequest) => SubagentChat,
    onTurnRecorded: (turnId, transcriptId) => { recorded.push([turnId, transcriptId]); },
  });
  await settle();
  return { session, recorded, main };
}

it('writes a turn whose id is a UUID under that id, and has nothing to report', async () => {
  const { session, recorded } = await replay();

  session.begin(TURN, 'hello');
  await settle();

  expect(sdk.sent.map((one) => one.uuid)).toEqual([TURN]);
  expect(recorded).toEqual([]);
});

it('writes a turn whose id is not a UUID under one of its own, and reports the pair once', async () => {
  const lines = fixture('claude-subagent-ask.jsonl');
  const { session, recorded } = await replay();

  session.begin('t1', 'Delegate this to a subagent');
  await settle();
  const written = String(sdk.sent[0]?.uuid);
  expect(written).toMatch(UUID);
  // The frames of a turn that delegated: a worker's prompt and tool results,
  // none of which is the lead turn's prompt or says anything about it.
  sdk.push(...lines);
  await settle(80);

  expect(recorded).toEqual([['t1', written]]);
});

it('writes each turn of a session under its own id', async () => {
  const lines = fixture('claude-subagent-ask.jsonl');
  const result = lines.at(-1) as Record<string, unknown>;
  const { session, recorded } = await replay();

  session.begin('t1', 'and one thing');
  await settle();
  sdk.push(result);
  await settle();
  session.begin('t2', 'and another thing');
  await settle();
  sdk.push(result);
  await settle();

  const [first, second] = sdk.sent.map((one) => String(one.uuid));
  expect(first).not.toBe(second);
  expect(recorded).toEqual([['t1', first], ['t2', second]]);
});

it('writes a failed turn sent again under a new id, and reports it', async () => {
  const { session, recorded } = await replay();

  session.begin(TURN, 'hello');
  await settle();
  // The CLI's own ending for a turn that failed, as it streams it.
  sdk.push({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 5, errors: ['failed'] });
  await settle();
  expect((session.chatState() as { turns?: { id?: string; state?: string }[] }).turns?.at(-1)?.state).toBe('error');

  expect(session.resume?.(TURN)).toBe(true);
  await settle();

  const again = String(sdk.sent[1]?.uuid);
  expect(again).toMatch(UUID);
  expect(again).not.toBe(TURN);
  expect(recorded).toEqual([[TURN, again]]);
});

/*
 * A turn begun while one runs takes its place, said at once, as the reducer
 * replaces the active turn, and its prompt goes to the CLI once the CLI has
 * answered the one in front of it, as the reference Claude agent sends one
 * prompt after another.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/claude/claudeAgent.ts#L486-L492
 */
it('says a turn begun while one runs at once, and sends its prompt once the one before it is answered', async () => {
  const { session, main } = await replay();

  session.begin('t1', 'the first thing');
  await settle();
  expect((session.chatState() as { activeTurn?: { id?: string } }).activeTurn?.id).toBe('t1');

  session.begin('t2', 'a second thing');
  await settle();

  const after = session.chatState() as { activeTurn?: { id?: string; message?: { text?: string } }; turns?: Bag[] };
  expect(after.activeTurn?.id).toBe('t2');
  expect(after.activeTurn?.message?.text).toBe('a second thing');
  expect(after.turns ?? []).toEqual([]);
  const started = main.filter((one) => one.action.type === 'chat/turnStarted').map((one) => one.action.turnId);
  expect(started).toEqual(['t1', 't2']);
  expect(sdk.sent).toHaveLength(1);

  // The first prompt's answer ends no turn, and the second prompt goes then.
  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 5, user_message_uuids: [String(sdk.sent[0]?.uuid)] });
  await settle();
  expect(sdk.sent).toHaveLength(2);
  expect((session.chatState() as { activeTurn?: { id?: string } }).activeTurn?.id).toBe('t2');
  expect((session.chatState() as { turns?: Bag[] }).turns ?? []).toEqual([]);
});

import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, SubagentChat, SubagentRequest } from '@ahpd/sdk';

/*
 * The transcript id a turn was written under, once the CLI has said one.
 *
 * The SDK sends the lead turn and every subagent it delegates to down one
 * stream, told apart only by `parent_tool_use_id`, and the CLI names each
 * prompt by its own uuid - an id no client chose and no host handed out. So
 * what the host keeps against the turn id a client sent is not what a history
 * read back off the transcript asks about, and the session says the pair once
 * per turn through `onTurnRecorded`.
 *
 * The capture here is `claude-subagent-ask.jsonl`, a real `claude -p` session
 * that delegated and was answered: its first `user` frame is the worker's own
 * prompt, so it is the frame that must not be reported for the lead turn.
 */

/**
 * The SDK's stream as a queue a test pushes frames into.
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
    /** Start a new feed for the next session. */
    reset() { state.feed = fresh(); },
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
  query: ({ options }: { options: Record<string, unknown> }) => {
    const feed = sdk.feed;
    void options;
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

/**
 * The lead turn's own prompt, as the CLI echoes it back.
 *
 * A frame the captures here do not carry, because both were trimmed to the
 * delegation; the shape is the harness's own - a `user` frame with no
 * `parent_tool_use_id`, which is what tells it apart from a worker's.
 */
const prompt = (uuid: string, text: string): Record<string, unknown> => ({
  type: 'user', uuid, session_id: 'test-session', message: { role: 'user', content: text },
});

/** Replay through a real session, recording every id it reports a turn under. */
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

it('reports the prompt uuid once for the lead turn', async () => {
  const lines = fixture('claude-subagent-ask.jsonl');
  const asked = '8c6b418f-dba6-4f96-87f2-d60cd177366b';
  const { session, recorded } = await replay();

  session.begin('t1', 'Delegate this to a subagent');
  await settle();
  // The prompt, and then a capture that delegates to a worker.
  sdk.push(prompt(asked, 'Delegate this to a subagent'), ...lines);
  await settle(80);

  expect(recorded).toEqual([['t1', asked]]);
});

it('does not report a subagent\'s own prompt as the turn it was written under', async () => {
  const lines = fixture('claude-subagent-ask.jsonl');
  const { session, recorded } = await replay();

  session.begin('t1', 'Delegate this to a subagent');
  await settle();
  /*
   * Through the delegation and the worker's prompt, before the lead turn's
   * own echo arrives - the worker's frame is the first `user` frame this turn
   * has seen, and its uuid names a prompt in the lead turn's transcript that
   * a client can never ask for by.
   */
  sdk.push(...lines.slice(0, 4));
  await settle(80);

  expect(recorded).toEqual([]);
});

it('reports each turn of a session once, under its own prompt uuid', async () => {
  const lines = fixture('claude-subagent-ask.jsonl');
  const result = lines.at(-1) as Record<string, unknown>;
  const { session, recorded } = await replay();

  session.begin('t1', 'and one thing');
  await settle();
  sdk.push(prompt('aaaaaaaa-0000-4000-8000-000000000001', 'and one thing'), result);
  await settle();

  session.begin('t2', 'and another thing');
  await settle();
  sdk.push(prompt('aaaaaaaa-0000-4000-8000-000000000002', 'and another thing'), result);
  await settle();

  expect(recorded).toEqual([
    ['t1', 'aaaaaaaa-0000-4000-8000-000000000001'],
    ['t2', 'aaaaaaaa-0000-4000-8000-000000000002'],
  ]);
});

it('reports nothing for a turn whose echo carried no uuid', async () => {
  const { session, recorded } = await replay();

  session.begin('t1', 'hi');
  await settle();
  // A frame of the shape the harness sends, with the one field left off.
  sdk.push({ type: 'user', message: { role: 'user', content: 'hi' } });
  await settle();

  expect(recorded).toEqual([]);
});
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

/*
 * A model round that ends with nothing.
 *
 * The Claude stream reports the API message's own boundary - `message_start`
 * to `message_stop` - and a round that produced neither text nor a tool call
 * has only that boundary to say so. The reference host answers such a round
 * with a `systemNotification` part whose `_meta` is `responseRoundEnded`, and
 * its client settles whatever thinking section is open and draws nothing.
 * Without it the next round's thinking is drawn as the same section.
 *
 * The fixtures are trimmed from a real `claude -p --include-partial-messages`
 * capture (see task 01 of `plans/claude/03`): one round with thinking and no
 * answer, and one ordinary round with text.
 */

const sdk = vi.hoisted(() => ({ frames: [] as Record<string, unknown>[] }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => ({
    async *[Symbol.asyncIterator]() {
      for (const frame of sdk.frames) yield frame;
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
  }),
}));

const { createSession } = await import('../packages/agent-claude/src/session.js');

const fixture = (name: string): Record<string, unknown>[] => readFileSync(
  new URL(`./fixtures/${name}`, import.meta.url),
  'utf8',
).split('\n').filter((line) => line.trim() !== '').map((line) => JSON.parse(line) as Record<string, unknown>);

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Replay one fixture through a real session and collect what it emitted. */
async function replay(frames: Record<string, unknown>[]) {
  sdk.frames = frames;
  const sent: { channel: string; action: Record<string, unknown> }[] = [];
  createSession({
    uri: 'ahp-session:/round',
    chatUri: 'ahp-chat:/round',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-round-')),
    emit: (channel, action) => { sent.push({ channel, action: action as Record<string, unknown> }); },
  });
  await settle();
  const parts = sent
    .filter((one) => one.action.type === 'chat/responsePart')
    .map((one) => one.action.part as Record<string, unknown>);
  return { sent, parts };
}

it('announces a round that ended with no text and no tool call', async () => {
  const { parts } = await replay(fixture('claude-empty-round.jsonl'));

  // The thinking part is what the notification settles, so it comes first.
  const reasoning = parts.findIndex((one) => one.kind === 'reasoning');
  const ended = parts.filter((one) => one.kind === 'systemNotification');
  expect(reasoning).toBeGreaterThanOrEqual(0);
  expect(ended).toHaveLength(1);
  expect(ended[0]).toMatchObject({ content: '', _meta: { kind: 'responseRoundEnded' } });
  expect(parts.findIndex((one) => one.kind === 'systemNotification')).toBeGreaterThan(reasoning);
});

it('says nothing extra for a round that answered with text', async () => {
  const { parts } = await replay(fixture('claude-answered-round.jsonl'));
  expect(parts.some((one) => one.kind === 'markdown')).toBe(true);
  expect(parts.some((one) => one.kind === 'systemNotification')).toBe(false);
});

/** The same frames, as a subagent's: its stream events carry the tool call that runs it. */
const asSubagent = (frames: Record<string, unknown>[]): Record<string, unknown>[] => frames
  .filter((one) => one.type === 'stream_event')
  .map((one) => ({ ...one, parent_tool_use_id: 'toolu_subagent' }));

it('does not announce a subagent\'s empty round in the main turn', async () => {
  const main = fixture('claude-answered-round.jsonl');
  const { parts } = await replay([...main.slice(0, -1), ...asSubagent(fixture('claude-empty-round.jsonl')), ...main.slice(-1)]);
  expect(parts.some((one) => one.kind === 'systemNotification')).toBe(false);
});

it('keeps the main round apart from a subagent round streamed inside it', async () => {
  // The main round starts, a subagent's round that answered runs to its end,
  // and then the main round ends empty: the subagent's text is not the main
  // round's answer, and its start did not reset the main round.
  const main = fixture('claude-empty-round.jsonl');
  const start = main.findIndex((one) => one.type === 'stream_event'
    && (one.event as Record<string, unknown>).type === 'message_start');
  const { parts } = await replay([
    ...main.slice(0, start + 1),
    ...asSubagent(fixture('claude-answered-round.jsonl')),
    ...main.slice(start + 1),
  ]);
  expect(parts.filter((one) => one.kind === 'systemNotification')).toHaveLength(1);
});

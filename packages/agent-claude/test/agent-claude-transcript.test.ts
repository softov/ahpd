import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A Claude transcript read back as turns.
 *
 * The CLI writes a prompt, then one `assistant` frame per content block of each
 * API message, with a `user` frame of tool results between the rounds. Live,
 * all of that is one turn; read back, it is one turn too.
 */

const sdk = vi.hoisted(() => ({ messages: [] as Record<string, unknown>[], asked: [] as unknown[] }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  getSessionMessages: async (_id: string, options?: unknown) => { sdk.asked.push(options); return sdk.messages; },
}));

const { turnsOf } = await import('../src/transcript.js');

const frame = (kind: 'user' | 'assistant', uuid: string, message: unknown, extra: Bag = {}): Record<string, unknown> => ({
  type: kind, uuid, timestamp: '2020-01-01T00:00:00.000Z', message, ...extra,
});

const prompt = (uuid: string, text: string): Record<string, unknown> => frame('user', uuid, { role: 'user', content: text });

const results = (uuid: string, id: string, text: string): Record<string, unknown> => frame('user', uuid, {
  role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }],
});

const said = (uuid: string, id: string, blocks: unknown[], outputTokens = 1): Record<string, unknown> => frame('assistant', uuid, {
  id, model: 'claude-opus-5', content: blocks, usage: { input_tokens: 10, output_tokens: outputTokens },
});

async function read(messages: Record<string, unknown>[]): Promise<Bag[]> {
  sdk.messages = messages;
  return await turnsOf('session') as unknown as Bag[];
}

/*
 * The transcript is read once, with its system entries, and a compaction
 * boundary or a notification is drawn on its turn as a notification part,
 * other system entries dropped, as VS Code's replay keeps them.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L186-L208
 */
it('draws a compaction boundary and a notification on their turn, read with the system entries', async () => {
  const system = (uuid: string, message: Bag): Record<string, unknown> => ({ type: 'system', uuid, timestamp: '2020-01-01T00:00:00.000Z', message });
  sdk.asked = [];
  const turns = await read([
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'text', text: 'Looking.' }]),
    system('s1', { subtype: 'compact_boundary' }),
    system('s2', { subtype: 'notification', text: 'Context was compacted.' }),
    system('s3', { subtype: 'api_retry' }),
  ]);

  expect(sdk.asked).toEqual([{ includeSystemMessages: true }]);
  expect((turns[0]?.responseParts as Bag[]).filter((one) => one.kind === 'systemNotification')).toEqual([
    { kind: 'systemNotification', content: '[compact_boundary]' },
    { kind: 'systemNotification', content: 'Context was compacted.' },
  ]);
});

it('reads a prompt and every round that answered it as one turn', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
    results('u2', 'toolu_1', 'a b c'),
    said('a2', 'm2', [{ type: 'tool_use', id: 'toolu_2', name: 'Read', input: { file_path: '/tmp/a' } }]),
    results('u3', 'toolu_2', 'contents'),
    said('a3', 'm3', [{ type: 'text', text: 'All read.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({ id: 'u1', message: { text: 'look around', origin: { kind: 'user' } } });
  const parts = turns[0]?.responseParts as Bag[];
  expect(parts.map((part) => part.kind)).toEqual(['toolCall', 'toolCall', 'markdown']);
  expect(parts[0]?.toolCall).toMatchObject({ toolCallId: 'toolu_1', status: 'completed', content: [{ type: 'text', text: 'a b c' }] });
  expect(parts[1]?.toolCall).toMatchObject({ toolCallId: 'toolu_2', status: 'completed', content: [{ type: 'text', text: 'contents' }] });
  expect(parts[2]).toMatchObject({ content: 'All read.' });
});

it('counts one message\'s usage once however many frames repeat it', async () => {
  const turns = await read([
    prompt('u1', 'think then answer'),
    said('a1', 'm1', [{ type: 'thinking', thinking: 'hmm' }], 4),
    said('a2', 'm1', [{ type: 'text', text: 'One.' }], 4),
    said('a3', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }], 4),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.usage).toMatchObject({ outputTokens: 4, inputTokens: 10, model: 'claude-opus-5' });
});

it('keeps an API error Claude Code wrote as the turn\'s content, and not its model as the model the turn ran on', async () => {
  const failed = frame('assistant', 'a2', {
    id: 'm2', model: '<synthetic>', content: [{ type: 'text', text: 'API Error: Upstream idle timeout exceeded' }],
    usage: { input_tokens: 0, output_tokens: 0 },
  }, { isApiErrorMessage: true });
  const turns = await read([
    prompt('u1', 'split the file'),
    said('a1', 'm1', [{ type: 'text', text: 'Starting.' }]),
    failed,
  ]);
  const parts = turns[0]?.responseParts as Bag[];
  expect(parts.at(-1)).toMatchObject({ content: 'API Error: Upstream idle timeout exceeded' });
  expect(turns[0]?.usage).toMatchObject({ model: 'claude-opus-5' });
});

it('sums the usage of an exchange\'s distinct messages', async () => {
  const turns = await read([
    prompt('u1', 'two rounds'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }], 4),
    results('u2', 'toolu_1', 'ok'),
    said('a2', 'm2', [{ type: 'text', text: 'Done.' }], 6),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.usage).toMatchObject({ outputTokens: 10, inputTokens: 20 });
});

it('counts a frame with no message id on its own', async () => {
  const turns = await read([
    prompt('u1', 'no ids'),
    frame('assistant', 'a1', { content: [{ type: 'text', text: 'One.' }], usage: { output_tokens: 3 } }),
    frame('assistant', 'a2', { content: [{ type: 'text', text: 'Two.' }], usage: { output_tokens: 5 } }),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.usage).toMatchObject({ outputTokens: 8 });
});

it('opens an agent turn for a transcript that starts with the agent', async () => {
  const turns = await read([
    said('a1', 'm1', [{ type: 'text', text: 'Starting.' }]),
    said('a2', 'm2', [{ type: 'text', text: 'Still going.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]).toMatchObject({ id: 'a1', message: { text: '', origin: { kind: 'agent' } } });
  expect((turns[0]?.responseParts as Bag[]).map((part) => part.content)).toEqual(['Starting.', 'Still going.']);
});

it('starts a new turn at the next prompt', async () => {
  const turns = await read([
    prompt('u1', 'first'),
    said('a1', 'm1', [{ type: 'text', text: 'One.' }]),
    prompt('u2', 'second'),
    said('a2', 'm2', [{ type: 'text', text: 'Two.' }]),
  ]);
  expect(turns.map((turn) => (turn.message as Bag).text)).toEqual(['first', 'second']);
});

it('reads a CLI echo between two rounds as no prompt', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'text', text: 'One.' }]),
    prompt('u2', '<local-command-stdout>Set model to claude-opus-5</local-command-stdout>'),
    said('a2', 'm2', [{ type: 'text', text: 'Two.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect((turns[0]?.responseParts as Bag[]).map((part) => part.content)).toEqual(['One.', 'Two.']);
});

it('reads every CLI echo marker as no prompt, in a string or a text block', async () => {
  const turns = await read([
    prompt('u1', '<command-name>/model</command-name>\n<command-message>model</command-message>\n<command-args>opus</command-args>'),
    prompt('u2', '<command-message>model</command-message>'),
    prompt('u3', '<command-args>opus</command-args>'),
    prompt('u4', '<local-command-stderr>no</local-command-stderr>'),
    prompt('u5', '<local-command-caveat>Caveat: the messages below were generated by the user</local-command-caveat>'),
    frame('user', 'u6', { role: 'user', content: [{ type: 'text', text: '<local-command-stdout>ok</local-command-stdout>' }] }),
  ]);
  expect(turns).toHaveLength(0);
});

it('reads a prompt that only mentions a marker as a prompt', async () => {
  const turns = await read([prompt('u1', 'what does <command-name> mean?')]);
  expect(turns).toHaveLength(1);
});

it('reads a compact summary as no prompt', async () => {
  const turns = await read([
    prompt('u1', 'keep going'),
    said('a1', 'm1', [{ type: 'text', text: 'One.' }]),
    frame('user', 'u2', { role: 'user', content: 'This session is being continued from a previous conversation.' }, { isCompactSummary: true }),
    said('a2', 'm2', [{ type: 'text', text: 'Two.' }]),
  ]);
  expect(turns).toHaveLength(1);
  expect(turns[0]?.message).toMatchObject({ text: 'keep going' });
});

/*
 * How long a past turn and its calls ran, off the frames.
 *
 * The CLI writes a time on every frame and the protocol has nowhere to put a
 * call's own, so the frames are what a duration is measured from: a call runs
 * from its `tool_use` to its `tool_result`, which its `_meta` says under VS
 * Code's key, and a turn lasts from the frame that opened it to the last one
 * that answered it.
 */

/** The same frame, at a time of its own. */
const when = (at: string, one: Record<string, unknown>): Record<string, unknown> => ({ ...one, timestamp: at });

it('measures a restored call between the frames that ran it', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }])),
    when('2020-01-01T00:00:09.500Z', results('u2', 'toolu_1', 'a b c')),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(call._meta).toEqual({ toolKind: 'terminal', 'vscode.toolCallDurationMs': 4500 });
});

it('says no duration for a restored call with no result', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }])),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(call._meta).toEqual({ toolKind: 'terminal' });
});

it('reads a call with no result back as one its turn ended around, and that turn as stopped', async () => {
  /*
   * A call the transcript holds no result for never finished. The reference
   * reads it back cancelled as skipped, which is how the protocol's reducer
   * holds a call still open when its turn ends, and reads the turn that held
   * it back cancelled.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L389-L417
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514
   */
  const turns = await read([
    prompt('u1', 'look around'),
    said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }]),
    prompt('u2', 'and then'),
    said('a2', 'm2', [{ type: 'text', text: 'Done.' }]),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(call).toMatchObject({ toolCallId: 'toolu_1', status: 'cancelled', reason: 'skipped', invocationMessage: expect.anything() });
  expect(call).not.toHaveProperty('success');
  expect(call).not.toHaveProperty('pastTenseMessage');
  expect(turns.map((turn) => turn.state)).toEqual(['cancelled', 'complete']);
});

it('gives a restored turn how long it took', async () => {
  const turns = await read([
    when('2020-01-01T00:00:00.000Z', prompt('u1', 'look around')),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'text', text: 'Looking.' }])),
    when('2020-01-01T00:00:09.500Z', results('u2', 'toolu_1', 'a b c')),
  ]);
  expect(turns[0]?.duration).toBe(9500);
});

it('gives a turn a single frame answered no time at all', async () => {
  const turns = await read([prompt('u1', 'hello')]);
  expect(turns[0]?.duration).toBe(0);
});

it('says a restored call\'s duration on VS Code\'s key alone', async () => {
  const turns = await read([
    prompt('u1', 'look around'),
    when('2020-01-01T00:00:05.000Z', said('a1', 'm1', [{ type: 'tool_use', id: 'toolu_1', name: 'TodoWrite', input: { todos: [] } }])),
    when('2020-01-01T00:00:09.500Z', results('u2', 'toolu_1', 'ok')),
  ]);
  const call = (turns[0]?.responseParts as Bag[])[0]?.toolCall as Bag;
  expect(Object.keys(call._meta as Bag)).toEqual(['vscode.toolCallDurationMs']);
});

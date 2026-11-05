import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A host tool that says nobody is asked about it.
 *
 * `confirm: false` on a `HostTool` is carried to the bound tool, and the CLI
 * asks this host about a contributed tool through `canUseTool` like any other.
 * The flag is answered there as an allow, with no `input_needed_set` - a row
 * nobody was asked about is a decision made before the turn began - and a deny
 * list still wins over it, because that is a person's answer about the tool.
 */

const sdk = vi.hoisted(() => ({
  frames: [] as Record<string, unknown>[],
  canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  getSessionMessages: async () => sdk.frames,
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    let close = (): void => {};
    const closed = new Promise<void>((resolve) => { close = resolve; });
    return {
      async *[Symbol.asyncIterator]() {
        sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
        // The frames answer the turn's prompt, as a CLI's do, and the CLI stays
        // open until it is closed.
        await prompt[Symbol.asyncIterator]().next();
        for (const frame of sdk.frames) yield frame;
        await closed;
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
      close,
    };
  },
}));

const { createSession } = await import('../src/session.js');

/** The name the CLI calls a contributed tool by. */
const CALLED = 'mcp__ahp__post_message';

/** A host tool as the bind hands it to a backend. */
const offered = (over: Partial<BoundTool> = {}): BoundTool => ({
  definition: {
    name: 'post_message',
    description: 'Post the reply to the main chat',
    inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
  },
  run: async () => 'Posted to the main chat.',
  ...over,
});

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A session holding `tools`, and what it said on the wire. */
async function sessionWith(tools: BoundTool[], settings: Bag = {}): Promise<{ canUseTool: NonNullable<typeof sdk.canUseTool>; sent: Bag[] }> {
  sdk.frames = [];
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/confirm',
    chatUri: 'ahp-chat:/confirm',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-confirm-')),
    emit: (_channel, action) => { sent.push(action as Bag); },
    tools,
    settings,
  });
  await settle();
  // A turn running, as the CLI asks about a call only inside one.
  session.sendMessage('t1', 'go');
  await settle();
  return { canUseTool: sdk.canUseTool!, sent };
}

it('runs a host tool that needs no confirmation, without asking anybody', async () => {
  const { canUseTool, sent } = await sessionWith([offered({ confirm: false })]);

  expect(await canUseTool(CALLED, { text: 'hello' }, { toolUseID: 'toolu_post' }))
    .toEqual({ behavior: 'allow', updatedInput: { text: 'hello' } });
  // Nothing was drawn: a call nobody was asked about is not a question that was
  // answered, and a client is not left holding a confirmation for it.
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toEqual([]);
  expect(sent.filter((one) => one.type === 'chat/toolCallStart')).toEqual([]);
});

it('asks about a host tool that says nothing, as it always has', async () => {
  const { canUseTool, sent } = await sessionWith([offered()]);

  // Nothing settles it, so the question is held and never awaited: what the
  // test reads is the entry it put on the chat.
  void canUseTool(CALLED, { text: 'hello' }, { toolUseID: 'toolu_ask' });
  await settle();
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toHaveLength(1);
});

it('still refuses a tool the deny list names', async () => {
  const { canUseTool, sent } = await sessionWith(
    [offered({ confirm: false })],
    { permissions: { allow: [], deny: [CALLED] } },
  );

  // The flag is the host's claim about the tool; the deny list is a person's
  // answer, and it wins.
  expect(await canUseTool(CALLED, { text: 'hello' }, { toolUseID: 'toolu_denied' }))
    .toEqual({ behavior: 'deny', message: `${CALLED} is denied for this session` });
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toEqual([]);
});

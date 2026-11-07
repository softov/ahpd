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

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
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
const CALLED = 'mcp__host__post_message';

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
async function sessionWith(tools: BoundTool[], settings: Bag = {}): Promise<{
  canUseTool: NonNullable<typeof sdk.canUseTool>;
  sent: Bag[];
  session: ReturnType<typeof createSession>;
}> {
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
  return { canUseTool: sdk.canUseTool!, sent, session };
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

/*
 * The flag is the host's claim about the tool; the deny list is a person's
 * answer, and it wins: the call is put to the host, whose chain refuses a tool
 * the session's lists deny before any client is asked, and the CLI is answered
 * the refusal in VS Code's words.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L167-L180
 */
it('puts a tool the deny list names to the host, and answers the CLI its refusal', async () => {
  const { canUseTool, sent, session } = await sessionWith(
    [offered({ confirm: false })],
    { permissions: { allow: [], deny: [CALLED] } },
  );

  const answered = canUseTool(CALLED, { text: 'hello' }, { toolUseID: 'toolu_denied' });
  await settle();
  expect(sent.filter((one) => one.type === 'chat/toolCallReady').map((one) => one.toolCallId)).toEqual(['toolu_denied']);
  expect(session.confirm('toolu_denied', false)).toBe(true);
  expect(await answered).toEqual({ behavior: 'deny', message: 'User declined' });
});

/*
 * A question carries what the host decides it by, beside its ready, and no
 * options of its own: the kind, the path (the CLI's `blockedPath` first) or
 * the URL, and a shell call's command in bash, as VS Code's Claude fills its
 * pending confirmation; and the sandbox bypass and the managed approval VS
 * Code's Copilot agent carries from its runtime, read from the CLI's
 * `dangerouslyDisableSandbox`, a policy's `matchedAskRule` and
 * `suppressAlwaysAllowRule`.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeCanUseTool.ts#L147-L175
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L8105-L8112
 */
it('says what the host decides a question by on its ready, and offers no options of its own', async () => {
  const { canUseTool, sent } = await sessionWith([]);
  const readyOf = (id: string): Bag | undefined => sent.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === id);
  void canUseTool('Bash', { command: 'rm -rf build', dangerouslyDisableSandbox: true }, {
    toolUseID: 'c-shell', suggestions: [{ type: 'addRules', rules: [{ toolName: 'Bash' }], behavior: 'allow', destination: 'localSettings' }],
  });
  void canUseTool('Read', { file_path: '/work/a.txt' }, { toolUseID: 'c-read', blockedPath: '/etc/passwd', suppressAlwaysAllowRule: true });
  void canUseTool('WebFetch', { url: 'https://example.com/x' }, { toolUseID: 'c-url', matchedAskRule: { source: 'policySettings', toolName: 'WebFetch' } });
  void canUseTool('Edit', { file_path: '/work/b.txt' }, { toolUseID: 'c-edit', matchedAskRule: { source: 'userSettings', toolName: 'Edit' } });
  await settle();

  expect(readyOf('c-shell')).toMatchObject({
    permissionKind: 'shell', shellLanguage: 'bash', shellCommand: 'rm -rf build', requestSandboxBypass: true,
  });
  expect(readyOf('c-shell')).not.toHaveProperty('options');
  expect(readyOf('c-read')).toMatchObject({ permissionKind: 'read', permissionPath: '/etc/passwd', managedApprovalRequired: true });
  expect(readyOf('c-url')).toMatchObject({ permissionKind: 'url', permissionUrl: 'https://example.com/x', managedApprovalRequired: true });
  expect(readyOf('c-url')).not.toHaveProperty('permissionPath');
  expect(readyOf('c-edit')).toMatchObject({ permissionKind: 'write', permissionPath: '/work/b.txt' });
  expect(readyOf('c-edit')).not.toHaveProperty('managedApprovalRequired');
});

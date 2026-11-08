import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { bag } from '@ahpd/sdk';
import type { Bag, BoundTool } from '@ahpd/sdk';
import type { ClaudeSessionOptions } from '../src/session/context.js';

/*
 * A host tool that the agent's shell, and the call it runs for.
 *
 * A host tool's `run` is given the call the CLI named, so a tool that starts
 * something - a terminal, a shell - can say which call it is for and show it
 * on that call while it runs. A marked `bash` takes the place of Claude's own
 * shell, and its calls are read by the owner's terminal rules as `Bash` calls
 * are.
 */

/** The SDK's stream as a queue a test pushes frames into. */
const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const fresh = (): Feed => ({ held: [], wake: undefined });
  const state = {
    feed: fresh(),
    /** Every in-process server the session declared, newest last. */
    servers: [] as Record<string, unknown>[],
    /** The options the last query was built with. */
    options: undefined as undefined | Record<string, unknown>,
    canUseTool: undefined as undefined | ((name: string, input: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
    reset() {
      state.feed = fresh();
      state.servers.length = 0;
      state.options = undefined;
      state.canUseTool = undefined;
    },
    push(...frames: Record<string, unknown>[]) {
      const feed = state.feed;
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    async next(feed: Feed): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('../../sdk/test/support/warmed.js')).warmed({
  createSdkMcpServer: (given: Record<string, unknown>) => {
    sdk.servers.push(given);
    return { type: 'sdk', name: given.name, tools: given.tools };
  },
  getSessionMessages: async () => [],
  query: ({ options }: { options: Record<string, unknown> }) => {
    sdk.options = options;
    sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    const feed = sdk.feed;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next(feed);
      },
      interrupt: async () => {},
      stopTask: async () => {},
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

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setImmediate(r); });
};

const until = async (done: () => boolean): Promise<void> => {
  for (const by = Date.now() + WAIT_MS; !done() && Date.now() < by;) await new Promise((r) => { setTimeout(r, 2); });
  expect(done()).toBe(true);
};

/** A session holding `tools`, and what it said on its chat. */
async function open(tools: BoundTool[], extra: Partial<ClaudeSessionOptions> = {}) {
  sdk.reset();
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/host-shell',
    chatUri: 'ahp-chat:/host-shell',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-host-shell-')),
    emit: (channel, action) => { if (channel === 'chat') sent.push(action as Bag); },
    tools,
    ...extra,
  });
  await settle();
  return { session, sent };
}

/** The handler of a tool the session declared on its `host` server. */
const handlerOf = (name: string): ((input: Record<string, unknown>, extra?: unknown) => Promise<Bag>) => {
  const server = sdk.servers.at(-1) as { tools: { name: string; handler: (input: Record<string, unknown>, extra?: unknown) => Promise<Bag> }[] };
  const one = server.tools.find((tool) => tool.name === name);
  if (one === undefined) throw new Error(`no host tool named ${name}`);
  return one.handler;
};

/** The assistant frame that calls one tool, which opens its call. */
const called = (name: string, id: string): Record<string, unknown> => ({
  type: 'assistant',
  parent_tool_use_id: null,
  message: { id: `m-${id}`, role: 'assistant', content: [{ type: 'tool_use', id, name, input: { path: 'a.txt' } }] },
});

/** The result of that call, as the CLI writes it. */
const answered = (text: string, id: string): Record<string, unknown> => ({
  type: 'user',
  parent_tool_use_id: null,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: text }] },
});

const actionOf = (sent: Bag[], type: string): Bag | undefined => sent.find((one) => one.type === type);

it('gives a host tool the call id the CLI named', async () => {
  let seen: string | undefined;
  const tool: BoundTool = {
    definition: { name: 'open_file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    run: async (_input, call) => {
      seen = call?.toolCallId;
      return 'opened';
    },
  };
  const { sent } = await open([tool]);

  const answer = await handlerOf('open_file')({ path: 'a.txt' }, { _meta: { 'claudecode/toolUseId': 'toolu_1' } });
  await settle();
  expect(seen).toBe('toolu_1');
  expect(answer).toEqual({ content: [{ type: 'text', text: 'opened' }] });
  // Nobody was asked, so nothing was drawn for the call.
  expect(sent.filter((one) => one.type === 'session/inputNeededSet')).toEqual([]);
});

it('shows the terminal a host tool opened on its call, and keeps it in the completion', async () => {
  const terminal = { uri: 'ahp-terminal://shell/chat/toolu_1', isPty: true };
  const tool: BoundTool = {
    definition: { name: 'open_file', inputSchema: { type: 'object', properties: { path: { type: 'string' } } } },
    run: async (_input, call) => {
      call?.opened?.(terminal);
      return 'opened a.txt';
    },
  };
  const { session, sent } = await open([tool]);
  // A turn for the call to run in: a lead frame no prompt is pending for opens none.
  session.sendMessage('t1', 'open a.txt');
  await settle();

  sdk.push(called('mcp__host__open_file', 'toolu_1'));
  await until(() => sent.some((one) => one.type === 'chat/toolCallStart' && one.toolCallId === 'toolu_1'));
  await handlerOf('open_file')({ path: 'a.txt' }, { _meta: { 'claudecode/toolUseId': 'toolu_1' } });

  const block = { type: 'terminal', resource: terminal.uri, title: 'Terminal', isPty: true };
  expect(actionOf(sent, 'chat/toolCallContentChanged')).toMatchObject({
    toolCallId: 'toolu_1',
    content: [block],
  });

  sdk.push(answered('opened a.txt', 'toolu_1'));
  await until(() => actionOf(sent, 'chat/toolCallComplete') !== undefined);

  const changed = sent.findIndex((one) => one.type === 'chat/toolCallContentChanged');
  const complete = sent.findIndex((one) => one.type === 'chat/toolCallComplete');
  expect(changed).toBeGreaterThan(-1);
  expect(changed).toBeLessThan(complete);
  // The completion replaces the call's content, so the terminal has to be in it
  // or the shell closes the moment the command ends.
  expect(bag(actionOf(sent, 'chat/toolCallComplete')?.result).content).toEqual([
    block,
    { type: 'text', text: 'opened a.txt' },
  ]);
});

it('disallows Bash and aliases it to a marked host bash, and leaves an unmarked one alone', async () => {
  const shell: BoundTool = {
    definition: { name: 'bash', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
    overridesBuiltInTool: true,
    run: async () => 'ran',
  };
  await open([shell]);
  expect(sdk.options?.disallowedTools).toContain('Bash');
  expect(sdk.options?.toolAliases).toEqual({ Bash: 'mcp__host__bash' });

  // The same tool without the mark is just another host tool: Claude keeps its
  // own Bash.
  const plain: BoundTool = {
    definition: { name: 'bash', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
    run: async () => 'ran',
  };
  await open([plain]);
  expect((sdk.options?.disallowedTools as string[] | undefined) ?? []).not.toContain('Bash');
  expect(sdk.options?.toolAliases).toBeUndefined();
});

it('asks about a marked host shell\'s call as a shell command, which the owner\'s terminal rules read', async () => {
  const { session, sent } = await open([{
    definition: { name: 'bash', inputSchema: { type: 'object', properties: { command: { type: 'string' } } } },
    overridesBuiltInTool: true,
    run: async () => 'ran',
  }]);
  session.sendMessage('t1', 'run the tests');
  await settle();

  void sdk.canUseTool!('mcp__host__bash', { command: 'make test' }, { toolUseID: 'toolu_bash' });
  await settle();
  // The host decides the question at its shell step, as it decides one about
  // Claude's own Bash, so the same terminal rules answer both.
  expect(sent.find((one) => one.type === 'chat/toolCallReady' && one.toolCallId === 'toolu_bash')).toMatchObject({
    permissionKind: 'shell', shellLanguage: 'bash', shellCommand: 'make test',
  });
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, expect, it, vi } from 'vitest';
import type { Bag, BoundTool } from '@ahpd/sdk';

/*
 * A turn that starts after a client announced its tools, and what the CLI has
 * when it reads the turn's prompt.
 *
 * The host hands a session a client's tools when the client becomes active and
 * does not wait for the session to take them; the session holds them until
 * the next send, which gives them to the CLI with `setMcpServers` before the
 * turn's prompt, and the CLI answers once it has the servers. A turn the
 * client sends next is a turn of a session that has those tools, by the order
 * the protocol applies actions in. This fake answers `setMcpServers` only when
 * the test says, connects only a server name it does not have yet, as the SDK
 * does, and records which tools the CLI had when it read each prompt.
 */

const sdk = vi.hoisted(() => ({
  /** The servers the CLI has, as the answered `setMcpServers` calls left them. */
  landed: {} as Record<string, { tools?: unknown[] }>,
  /** Calls the CLI has not answered yet, oldest first. */
  unanswered: [] as (() => void)[],
  /** Each prompt the CLI read, with how many tools of the `client` server it had then. */
  read: [] as { text: string; tools: number }[],
  feed: { held: [] as Record<string, unknown>[], wake: undefined as (() => void) | undefined },
  reset() {
    sdk.landed = {};
    sdk.unanswered = [];
    sdk.read = [];
    sdk.feed.held = [];
    sdk.feed.wake = undefined;
  },
  push(...frames: Record<string, unknown>[]) {
    sdk.feed.held.push(...frames);
    sdk.feed.wake?.();
    sdk.feed.wake = undefined;
  },
  /** Answer the oldest call the CLI holds. */
  answer() {
    sdk.unanswered.shift()?.();
  },
}));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { prompt: AsyncIterable<{ message: { content: unknown } }> }) => {
    let closed = false;
    const textOf = (content: unknown): string => typeof content === 'string'
      ? content
      : (content as { text?: string }[]).map((block) => block.text ?? '').join('');
    void (async () => {
      for await (const message of given.prompt) {
        sdk.read.push({ text: textOf(message.message.content), tools: sdk.landed.client?.tools?.length ?? 0 });
      }
    })();
    const wake = async (): Promise<void> => {
      while (sdk.feed.held.length === 0) {
        if (closed) return;
        await new Promise<void>((resolve) => { sdk.feed.wake = resolve; });
      }
    };
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          await wake();
          if (closed) return;
          yield sdk.feed.held.shift();
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      setMcpServers: (servers: Record<string, { tools?: unknown[] }>) => new Promise<void>((resolve) => {
        sdk.unanswered.push(() => {
          // A name it has already is kept as it was; a name left out goes.
          const next: Record<string, { tools?: unknown[] }> = {};
          for (const [name, server] of Object.entries(servers)) next[name] = sdk.landed[name] ?? server;
          sdk.landed = next;
          resolve();
        });
      }),
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      reloadPlugins: async () => ({ plugins: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => {
        closed = true;
        sdk.feed.wake?.();
        sdk.feed.wake = undefined;
      },
    };
  },
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A tool the client `c1` offers, as the host names it to the session. */
const offered = (name: string): BoundTool => ({
  owner: 'c1',
  definition: { name: `c1__${name}`, description: name, inputSchema: { type: 'object', properties: {} } },
}) as unknown as BoundTool;

async function open() {
  sdk.reset();
  const said: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/tools',
    chatUri: 'ahp-chat:/tools',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-tools-')),
    emit: (_channel, action) => { said.push(action as Bag); },
  });
  await settle();
  sdk.push({ type: 'system', subtype: 'init', session_id: 'cli-1' });
  await settle();
  return { session, said };
}

/** Answer every call the CLI is or comes to be holding. */
const answerAll = async (): Promise<void> => {
  for (let i = 0; i < 6; i++) {
    sdk.answer();
    await settle();
  }
};

beforeEach(() => { sdk.reset(); });

it('sends a turn begun after a client announced its tools once the CLI has them', async () => {
  const { session } = await open();
  // As the host does: the tools go to the session, and nothing waits for them.
  void session.setTools?.([offered('post_message')]);
  session.sendMessage('t1', 'post it in the room');
  await settle();
  await answerAll();

  expect(sdk.read).toEqual([{ text: 'post it in the room', tools: 1 }]);
});

it('gives the CLI the last of two announcements, before the turn after them', async () => {
  const { session } = await open();
  void session.setTools?.([offered('post_message')]);
  void session.setTools?.([offered('post_message'), offered('create_poll')]);
  session.sendMessage('t1', 'post it and ask');
  await settle();
  await answerAll();

  expect(sdk.read).toEqual([{ text: 'post it and ask', tools: 2 }]);
});

/*
 * A client's tools announced while a turn runs reach the CLI at the next send:
 * the running turn keeps the tools it started with, as VS Code's Claude
 * applies its client-tool diff by rebinding its query at the next send.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L1072-L1080
 */
it('keeps a running turn on the tools it started with, and gives the CLI a change at the next send', async () => {
  const { session } = await open();
  session.sendMessage('t1', 'look around');
  await settle();
  void session.setTools?.([offered('post_message')]);
  await settle();
  // Nothing is asked of the CLI while the turn runs.
  expect(sdk.unanswered).toHaveLength(0);

  sdk.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1, session_id: 'cli-1' });
  await settle();
  session.sendMessage('t2', 'post it in the room');
  await settle();
  await answerAll();

  expect(sdk.read).toEqual([{ text: 'look around', tools: 0 }, { text: 'post it in the room', tools: 1 }]);
});

it('sends a turn at once when no tools are on their way', async () => {
  const { session } = await open();
  session.sendMessage('t1', 'just answer');
  await settle();

  expect(sdk.read).toEqual([{ text: 'just answer', tools: 0 }]);
});

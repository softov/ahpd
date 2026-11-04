import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A turn that names a model the CLI will not take.
 *
 * `setModel` is the only thing that knows whether the CLI has the model, and
 * the switch is awaited before the turn's prompt goes out: a model it takes is
 * the one the turn is credited to, and a refusal is logged while the turn runs
 * on, and is credited to, the model the session has.
 */

const sdk = vi.hoisted(() => {
  interface Feed { held: Record<string, unknown>[]; wake: (() => void) | undefined }
  const feed: Feed = { held: [], wake: undefined };
  return {
    feed,
    /** The stream the session pushes prompts onto, which nothing else reads. */
    prompt: undefined as AsyncGenerator<Bag> | undefined,
    /** Every model the CLI was asked for, in the order it was asked. */
    asked: [] as string[],
    /** What the CLI says about a model it will not take. */
    refuses: {} as Record<string, string>,
    /** What each model waits on before it is taken, so a switch is held until a case lets it go. */
    takes: {} as Record<string, Promise<void>>,
    reset() {
      feed.held = [];
      feed.wake = undefined;
      sdk.asked = [];
      sdk.refuses = {};
      sdk.takes = {};
    },
    push(...frames: Record<string, unknown>[]) {
      feed.held.push(...frames);
      feed.wake?.();
      feed.wake = undefined;
    },
    async next(): Promise<Record<string, unknown>> {
      while (feed.held.length === 0) await new Promise<void>((resolve) => { feed.wake = resolve; });
      return feed.held.shift() as Record<string, unknown>;
    },
  };
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: (given: { prompt: AsyncGenerator<Bag> }) => {
    sdk.prompt = given.prompt;
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) yield await sdk.next();
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async (model?: string) => {
        const said = String(model);
        sdk.asked.push(said);
        await sdk.takes[said];
        const why = sdk.refuses[said];
        if (why !== undefined) throw new Error(why);
      },
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
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The frame a turn ends with, with no round under it. */
const ended = (): Record<string, unknown> => ({ type: 'result', subtype: 'success', is_error: false, duration_ms: 1 });

/**
 * A real session over a CLI that answers nothing, and the two things it says:
 * what it emitted, and what it pushed at the CLI.
 *
 * The prompts are read by one reader for the whole session, because a second
 * `next()` on the same generator queues behind the first - which would make an
 * absent prompt look like a late one.
 */
async function open() {
  sdk.reset();
  const said: Bag[] = [];
  const prompts: string[] = [];
  const session = createSession({
    uri: 'ahp-session:/model',
    chatUri: 'ahp-chat:/model',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-model-')),
    emit: (_channel, action) => { said.push(action as Bag); },
  });
  await settle();
  const stream = sdk.prompt as AsyncGenerator<Bag>;
  void (async () => {
    for (;;) {
      const one = await stream.next();
      if (one.done === true) return;
      prompts.push(String(((one.value as Bag).message as Bag).content));
    }
  })();
  /** The kinds of the actions the chat received, in order. */
  const chat = (): string[] => said.filter((one) => String(one.type).startsWith('chat/')).map((one) => String(one.type));
  /** The message of one turn, as the session holds the turn. */
  const message = (turnId: string): Bag => {
    const held = session.chatState() as { turns?: Bag[]; activeTurn?: Bag };
    return ([...(held.turns ?? []), ...(held.activeTurn === undefined ? [] : [held.activeTurn])]
      .find((turn) => turn.id === turnId)?.message ?? {}) as Bag;
  };
  return { session, said, prompts, chat, message };
}

/*
 * A model the CLI will not take is logged and the turn runs on the model the
 * session has, as the reference logs a model that would not change and sends
 * the prompt all the same; the turn handed behind it is a send of its own,
 * sent once the CLI has answered the one in front of it.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L351-L360
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkPipeline.ts#L408-L436
 */
it('runs a turn on the model it has when the CLI refuses the one it named, and sends the turn handed behind it after it', async () => {
  const { session, prompts, chat, message } = await open();
  const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
  sdk.refuses['claude-2.1'] = "Model 'claude-2.1' not found";

  session.changeModel({ id: 'opus' });
  session.sendMessage('t1', 'first');
  await settle();
  sdk.push(ended());
  await settle();
  expect(prompts).toEqual(['first']);

  session.changeModel({ id: 'claude-2.1' });
  session.sendMessage('t2', 'second');
  session.sendMessage('t3', 'third');
  await settle();

  // Sent on the model the session has, the refusal logged, and nothing ended in error.
  expect(prompts).toEqual(['first', 'second']);
  expect(message('t2').model).toEqual({ id: 'opus' });
  expect(chat()).not.toContain('chat/error');
  expect(warned.mock.calls.some(([line]) => String(line).includes("The harness would not take model claude-2.1: Model 'claude-2.1' not found"))).toBe(true);

  sdk.push(ended());
  await settle();
  expect(prompts).toEqual(['first', 'second', 'third']);
  expect(message('t3').model).toEqual({ id: 'opus' });
  warned.mockRestore();
});

it('runs on a model the CLI takes, and says which one, as before', async () => {
  const { session, prompts, chat, message } = await open();

  session.changeModel({ id: 'opus' });
  session.sendMessage('t1', 'first');
  await settle();

  expect(sdk.asked).toEqual(['opus']);
  expect(message('t1').model).toEqual({ id: 'opus' });
  expect(prompts).toEqual(['first']);
  // The host said the turn's start; the session says nothing of it, and no error.
  expect(chat().filter((one) => one === 'chat/turnStarted' || one === 'chat/error')).toEqual([]);
});

it('holds a turn handed behind a turn that is switching models, and sends the prompts in order', async () => {
  const { session, prompts } = await open();
  // Held until the case lets it go, rather than for a time: a count of ticks
  // on Windows can outlast any short wait.
  let release = (): void => {};
  sdk.takes.slow = new Promise<void>((resolve) => { release = resolve; });

  session.changeModel({ id: 'slow' });
  session.sendMessage('t1', 'first');
  session.sendMessage('t2', 'second');
  await settle(5);

  // The turn is busy before its prompt is out, so the turn handed behind it
  // waits: nothing of either turn has reached the CLI.
  expect(prompts).toEqual([]);

  release();
  await settle(60);
  // The switch has gone through and the first turn is running alone. A turn
  // naming no model skips the wait entirely, so this is where it would have
  // overtaken it.
  expect(prompts).toEqual(['first']);

  sdk.push(ended());
  await settle(30);
  expect(prompts).toEqual(['first', 'second']);
  expect(sdk.asked).toEqual(['slow']);
});
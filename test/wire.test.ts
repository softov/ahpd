import { expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checker, collapse, SCHEMA } from '../tools/wire.mjs';
import type { Peer } from '../src/types/rpc.js';

/*
 * Everything this host sends, against everything the protocol declares.
 *
 * The rest of the suite checks what the host does and `conformance.test.ts`
 * checks that the protocol's own reducers can read it. Neither can see an
 * *undeclared* field: a reducer ignores what it does not know, and a snapshot
 * this host wrote and read back agrees with itself whatever is in it.
 *
 * TypeScript cannot see one either. A conditional spread - `...(x ? { model }
 * : {})` - is not excess-property-checked, which is how `SessionState.model`,
 * `argumentHint` and `scope` each reached the wire from a codebase typed
 * against the package. So this is the only check that closes the objects:
 * `tools/schema.mjs` generates a strict schema out of the package's own
 * declarations - `additionalProperties: false` everywhere, which the shipped
 * `state.schema.json` has nowhere - and every frame goes through it.
 *
 * The capture is written out as it goes, which is the conformance fixture:
 * one file holding what a client actually receives, checkable by hand with
 * `npm run wire -- test/fixtures/wire.jsonl` and diffable when something
 * moves. It is synthetic on purpose - the agent is mocked, the prompts are
 * `hello` - because a capture off a real daemon carries somebody's work.
 */

const sdk = vi.hoisted(() => {
  interface Fake {
    frames: Record<string, unknown>[];
    wake: (() => void) | undefined;
    closed: boolean;
    options: Record<string, unknown>;
  }
  return {
    canUseTool: undefined as undefined | ((n: string, i: Record<string, unknown>, about?: Record<string, unknown>) => Promise<unknown>),
    queries: [] as Fake[],
  };
});

const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  listSessions: async () => [],
  getSessionMessages: async () => [],
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    const fake = { frames: [] as Record<string, unknown>[], wake: undefined as undefined | (() => void), closed: false, options };
    sdk.queries.push(fake);
    if (options.canUseTool) sdk.canUseTool = options.canUseTool as typeof sdk.canUseTool;
    void (async () => { for await (const _ of prompt) { /* drained */ } })();
    return {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (fake.frames.length > 0) yield fake.frames.shift() as Record<string, unknown>;
          if (fake.closed) return;
          await new Promise<void>((resolve) => { fake.wake = resolve; });
        }
      },
      interrupt: async () => {},
      setPermissionMode: async () => {},
      setModel: async () => {},
      applyFlagSettings: async () => {},
      toggleMcpServer: async () => {},
      reconnectMcpServer: async () => {},
      initializationResult: async () => ({
        commands: [{ name: 'review', description: 'Review the diff' }],
        outputStyles: ['default', 'concise'],
      }),
      mcpServerStatus: async () => [{ name: 'notes', status: 'connected' }],
      reloadSkills: async () => ({ skills: [{ name: 'writing', description: 'How to write' }] }),
      supportedModels: async () => [{ model: 'claude-opus-5', displayName: 'Opus 5' }],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../src/host.js');
const { claude } = await import('../src/agents/claude.js');
const { echo } = await import('../examples/echo/agent.js');
const { shellTerminals } = await import('../src/terminals.js');
const { fileResources } = await import('../src/resources.js');
const { memoryAutomations } = await import('../src/automations.js');
const { hostTools } = await import('../src/tools.js');

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** Every frame this host put on the wire, in order. */
const wire: Record<string, unknown>[] = [];

function peer(): Peer {
  return {
    send: () => {},
    // A notification is a frame as it goes: method and params, which is what
    // a recorder on the socket would have written down.
    notify: (method, params) => { wire.push({ method, params }); },
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
}

/**
 * One request, with its answer recorded as the response frame it becomes.
 *
 * `handle` returns the `result` half; the transport wraps it. Recording it
 * this way is what lets snapshots be checked at all - a snapshot is answered
 * to a request and never notified.
 */
const asking = (client: { handle(r: { method: string; params: unknown }): Promise<unknown> }) =>
  async (method: string, params: Record<string, unknown> = {}): Promise<unknown> => {
    const result = await client.handle({ method, params });
    wire.push({ result });
    return result;
  };

/** Say what a session's own CLI said. */
async function said(...frames: Record<string, unknown>[]): Promise<void> {
  const fake = sessionQueries().at(-1);
  if (!fake) throw new Error('no session CLI is running');
  fake.frames.push(...frames);
  fake.wake?.();
  fake.wake = undefined;
  await settle();
}

it('sends nothing the protocol does not declare, and nothing short of what it requires', async () => {
  const host = createHost({
    path: '/home/softov',
    agents: [claude({ paths: ['/home/softov'] }), echo({ path: '/home/softov', pace: 0 })],
    resources: fileResources(),
    terminals: shellTerminals(),
    automations: memoryAutomations(),
    tools: hostTools(),
  });
  const client = host.accept(peer());
  const ask = asking(client);

  await ask('initialize', {
    channel: 'ahp-root://', clientId: 'wire', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'],
  });
  await ask('resolveSessionConfig', {});
  await ask('listSessions', { channel: 'ahp-root://' });

  const uri = 'ahp-session:/wire';
  const chatUri = 'ahp-chat:/wire';
  await ask('createSession', { channel: uri, provider: 'claude' });
  await ask('subscribe', { channel: 'ahp-root://' });
  await ask('subscribe', { channel: uri });
  await ask('subscribe', { channel: chatUri });
  await settle();

  // A whole turn: prose, a tool that ran, its result, and the usage that ends
  // it. Every action on the chat channel comes out of these frames.
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'hello' } } },
  });
  await settle();
  await said(
    { type: 'stream_event', event: { type: 'message_start', message: { id: 'm1' } } },
    { type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } },
    { type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Reading' } } },
    {
      type: 'stream_event',
      event: { type: 'content_block_start', index: 1, content_block: { type: 'tool_use', id: 'tc1', name: 'Read' } },
    },
    {
      type: 'stream_event',
      event: { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '{"file_path":"/home/softov/a"}' } },
    },
    {
      type: 'assistant',
      message: { id: 'm1', model: 'claude-opus-5', content: [{ type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/home/softov/a' } }] },
    },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'ok' }] } },
    { type: 'assistant', message: { id: 'm2', content: [{ type: 'text', text: 'Done.' }] } },
    {
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 12,
      usage: { input_tokens: 10, output_tokens: 4 },
    },
  );

  // The rest of the session channel: a title, the flags a client keeps, a
  // config value, a draft, a queued message, and a mark on a file.
  for (const action of [
    { type: 'session/isReadChanged', isRead: true },
    { type: 'session/isArchivedChanged', isArchived: false },
    { type: 'session/titleChanged', title: 'A wire capture' },
    { type: 'session/configChanged', config: { permissionMode: 'plan' } },
    { type: 'session/activeClientSet', activeClient: { clientId: 'wire', displayName: 'The wire capture', tools: [] } },
  ]) void client.handle({ method: 'dispatchAction', params: { channel: uri, action } });
  for (const action of [
    { type: 'chat/draftChanged', draft: { text: 'half a thought', origin: { kind: 'user' } } },
    { type: 'chat/pendingMessageSet', kind: 'queued', id: 'q1', message: { text: 'and then this', origin: { kind: 'user' } } },
  ]) void client.handle({ method: 'dispatchAction', params: { channel: chatUri, action } });
  await settle();

  await ask('subscribe', { channel: `${uri}/annotations` });
  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: `${uri}/annotations`,
      action: {
        type: 'annotations/set',
        annotation: {
          id: 'a1',
          origin: { session: uri, chat: chatUri },
          resource: 'file:///home/softov/a',
          resolved: false,
          entries: [],
        },
      },
    },
  });
  await settle();

  // A second chat, which is the other half of the session channel.
  await ask('createChat', { channel: uri, chat: 'ahp-chat:/wire-2' });
  await ask('subscribe', { channel: 'ahp-chat:/wire-2' });
  await ask('completions', { channel: chatUri, text: '/', position: 1 });
  await ask('sessionConfigCompletions', { channel: 'ahp-root://', provider: 'claude', key: 'branch', query: '' });
  await ask('disposeChat', { channel: 'ahp-chat:/wire-2' });

  // A terminal, from the bytes a shell writes.
  const terminal = 'ahp-terminal:/wire';
  await ask('createTerminal', { channel: terminal, cwd: 'file:///home/softov', command: 'echo hi' });
  await ask('subscribe', { channel: terminal });
  void client.handle({
    method: 'dispatchAction', params: { channel: terminal, action: { type: 'terminal/resized', cols: 100, rows: 30 } },
  });
  await settle(20);
  await ask('disposeTerminal', { channel: terminal });

  // An automation, its run, and the run's own channel.
  await ask('subscribe', { channel: 'ahp-automations://' });
  await ask('listAutomationTriggerDefinitions', { channel: 'ahp-root://' });
  void client.handle({
    method: 'dispatchAction',
    params: {
      channel: 'ahp-automations://',
      action: {
        type: 'automation/createRequested',
        resource: 'ahp-automation:/nightly',
        definition: {
          title: 'Nightly review',
          enabled: true,
          message: { text: 'review what changed', origin: { kind: 'automation' } },
          session: { provider: 'echo', workingDirectories: ['file:///home/softov'] },
          triggers: [],
        },
      },
    },
  });
  await settle();
  const run = await ask('runAutomation', {
    channel: 'ahp-automations://', automation: 'ahp-automation:/nightly', requestId: 'r1',
  }) as { resource: string };
  await settle();
  await ask('subscribe', { channel: run.resource });
  await ask('fetchAutomationRuns', { channel: 'ahp-automations://', automation: 'ahp-automation:/nightly' });

  // And a reconnect, which is the one answer carrying several snapshots.
  await ask('reconnect', { clientId: 'wire', subscriptions: ['ahp-root://', uri, chatUri], lastSeenServerSeq: 0 });
  await ask('disposeSession', { channel: uri });
  await settle();

  /*
   * The fixture, with the parts that move on every run taken out.
   *
   * A capture whose timestamps and generated ids change each time is one
   * nobody can diff, and the reason to keep it is to see what moved when
   * something changes. So the volatile values are replaced by stable ones -
   * the shapes are what this file is for, and a UUID is the same shape
   * whichever UUID it is.
   */
  let minted = 0;
  const names = new Map<string, string>();
  const steady = (text: string): string => text
    .replace(/\d{4}-\d{2}-\d{2}T[\d:.]+Z/g, '2020-01-01T00:00:00.000Z')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, (found) => {
      if (!names.has(found)) names.set(found, `00000000-0000-4000-8000-${String(minted++).padStart(12, '0')}`);
      return names.get(found) as string;
    });
  mkdirSync('test/fixtures', { recursive: true });
  writeFileSync('test/fixtures/wire.jsonl', `${wire.map((one) => steady(JSON.stringify(one))).join('\n')}\n`);

  /*
   * Generated rather than committed, so it cannot drift from the package.
   *
   * `npm test` runs `tools/schema.mjs` first; this is for a bare `vitest run`,
   * which is how the suite is usually driven while working.
   */
  if (!existsSync(fileURLToPath(SCHEMA))) execFileSync(process.execPath, ['tools/schema.mjs'], { stdio: 'inherit' });
  const check = checker();
  const defects = wire.flatMap((frame) => check.frame(frame));
  const found = collapse(defects).map(([key, entry]) => `x${String(entry.count)}  ${key} (${entry.sample})`);
  // Both directions matter: an undeclared key is this host inventing
  // something a client cannot read, and a missing required one is this host
  // not keeping its own promise. The same capture shows both.
  expect(found).toEqual([]);
  // And enough of it was actually routed to a declaration to mean anything: a
  // capture nothing recognised would pass this test saying nothing.
  expect(check.checked()).toBeGreaterThan(60);
});

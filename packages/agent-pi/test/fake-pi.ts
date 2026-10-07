/*
 * The fake pi the suites drive, and every helper two or more of them call.
 *
 * pi's SDK is loaded here, before any case, so a case that builds pi tools does
 * not wait seconds for the import inside a few milliseconds of settling, and
 * `root` is a directory made fresh for each case and thrown away after it.
 *
 * Not a test file. `vitest` collects `*.test.ts`, and this is imported by the
 * suites that are. Those hooks therefore register once per importing file,
 * because `vitest` gives each test file its own module graph; a config that
 * turned `isolate` off would share one `root` across files.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeAll, beforeEach } from 'vitest';
import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { Bag, Start } from '../../sdk/src/types/index.js';
import { forget } from '../src/catalog.js';
import type { PiModel } from '../src/models.js';
import { modelFor, THINKING_KEY } from '../src/models.js';
import { loadPi } from '../src/pi.js';
import { piSession } from '../src/session.js';
import type { OpenPi } from '../src/session.js';
import type { BackendOptions, PiBackend } from '../src/backend.js';
import type { PiOptions, PiTurn } from '../src/types.js';

// pi's SDK, loaded before any case, so a case that builds pi tools does not
// wait seconds for the import inside a few milliseconds of settling.
beforeAll(async () => { await loadPi(); }, 60_000);

export let root: string;
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'ahpd-pi-')); });
afterEach(() => { rmSync(root, { recursive: true, force: true }); forget(); });

export const turn = (turnId = 't1'): PiTurn => ({
  turnId,
  messages: 0,
  blocks: new Map(),
  waiting: new Map(),
  parts: [],
  calls: new Map(),
});

/**
 * The events pi raises for one assistant message, in pi's order: the message
 * and each block streamed by its index, then each call it asked for run.
 */
export const streamed = (content: Bag[]): AgentSessionEvent[] => {
  const message = { role: 'assistant', content };
  const events: Bag[] = [{ type: 'message_start', message }];
  const update = (contentIndex: number, inner: Bag): void => {
    events.push({ type: 'message_update', message, assistantMessageEvent: { contentIndex, partial: message, ...inner } });
  };
  content.forEach((block, index) => {
    if (block.type === 'thinking') {
      update(index, { type: 'thinking_start' });
      update(index, { type: 'thinking_delta', delta: block.thinking });
      update(index, { type: 'thinking_end', content: block.thinking });
    }
    else if (block.type === 'text') {
      update(index, { type: 'text_start' });
      update(index, { type: 'text_delta', delta: block.text });
      update(index, { type: 'text_end', content: block.text });
    }
    else if (block.type === 'toolCall') {
      update(index, { type: 'toolcall_start' });
      update(index, { type: 'toolcall_end', toolCall: block });
    }
  });
  events.push({ type: 'message_end', message });
  for (const block of content.filter((one) => one.type === 'toolCall')) {
    events.push({ type: 'tool_execution_start', toolCallId: block.id, toolName: block.name, args: block.arguments });
    events.push({
      type: 'tool_execution_end', toolCallId: block.id, toolName: block.name, result: 'ok', isError: false,
    });
  }
  return events as unknown as AgentSessionEvent[];
};

/** A pi that raises whatever a test tells it to, and records what it was asked. */
export function fakePi() {
  let listener: ((event: AgentSessionEvent) => void) | undefined;
  const asked: Bag[] = [];
  const opens: BackendOptions[] = [];
  const runtime: PiModel[] = [
    { provider: 'anthropic', id: 'claude-opus-5', name: 'Opus 5', contextWindow: 200000, maxTokens: 64000 },
    { provider: 'openai', id: 'gpt-5', name: 'GPT-5' },
  ];
  let settle = true;
  let leaf = 'entry-1';
  let moves = true;
  /** Whether the model the session is on takes an image, as pi's `input` says. */
  let takes = true;
  const backend: PiBackend = {
    id: 'pi-session-1',
    file: '/tmp/pi/pi-session-1.jsonl',
    subscribe: (one) => { listener = one; return () => { listener = undefined; }; },
    prompt: async (text, images) => {
      asked.push({ kind: 'prompt', text, images: images ?? [] });
      if (settle) listener?.({ type: 'agent_settled' });
    },
    steer: async (text, images) => { asked.push({ kind: 'steer', text, images: images ?? [] }); },
    abort: async () => { asked.push({ kind: 'abort' }); listener?.({ type: 'agent_settled' }); },
    models: async () => runtime,
    levels: (model) => (model.provider === 'anthropic' ? ['off', 'medium', 'high'] : ['off']),
    chosen: () => ({ id: 'anthropic/claude-opus-5', config: { [THINKING_KEY]: 'off' } }),
    takesImages: () => takes,
    /*
     * pi's own runtime is what resolves a pick, so a model it does not list is
     * refused rather than taken. That is the whole of what a turn cannot do.
     */
    choose: async (id, config) => {
      asked.push({ kind: 'choose', id, ...(config ? { config } : {}) });
      return modelFor(runtime, id) !== undefined;
    },
    rename: (title) => { asked.push({ kind: 'rename', title }); },
    rewind: async (entryId) => { asked.push({ kind: 'rewind', entryId }); return moves; },
    leaf: () => leaf,
    close: () => { asked.push({ kind: 'close' }); },
  };
  return {
    backend,
    asked,
    opens,
    raise: (event: AgentSessionEvent) => { listener?.(event); },
    hold: () => { settle = false; },
    setLeaf: (next: string) => { leaf = next; },
    refuseRewind: () => { moves = false; },
    /** The session's model takes no image, so a picture goes by its path. */
    noImages: () => { takes = false; },
    open: (async (options: BackendOptions) => { opens.push(options); return backend; }) as OpenPi,
  };
}

/** One session, with everything it emitted. */
export function opened(
  over: Partial<Start> = {},
  options: PiOptions = {},
  open?: OpenPi,
) {
  const pi = fakePi();
  const sent: { channel: string; action: Bag }[] = [];
  const start: Start = {
    uri: 'ahp-session:/s1',
    chatUri: 'ahp-chat:/s1',
    settings: {},
    workingDirectory: root,
    schema: () => ({}),
    emit: (channel, action) => { sent.push({ channel, action }); },
    ...over,
  } as Start;
  // No file of pi's is read for a resumed session here: the fake has none.
  const session = piSession(options, start, open ?? pi.open, async () => undefined);
  const types = (channel?: string) => sent
    .filter((one) => channel === undefined || one.channel === channel)
    .map((one) => String(one.action.type));
  const last = (type: string) => [...sent].reverse().find((one) => one.action.type === type)?.action;
  return { session, pi, sent, types, last };
}

export const settled = async (): Promise<void> => { await new Promise((done) => { setTimeout(done, 5); }); };

/**
 * Send pi's own start and then call the hook, in the order pi raises them.
 *
 * pi-agent-core 0.87.1 emits `tool_execution_start` before `beforeToolCall`
 * calls the extension's `tool_call` handler, so a test that calls the hook
 * first is testing an order pi never uses.
 */
export const driveCall = (
  pi: ReturnType<typeof fakePi>,
  toolCallId: string,
  toolName: string,
  input: Bag,
): Promise<Bag | undefined> => {
  pi.raise({ type: 'tool_execution_start', toolCallId, toolName, args: input });
  return pi.opens[0]!.onToolCall!(
    { type: 'tool_call', toolCallId, toolName, input } as never,
  ) as Promise<Bag | undefined>;
};

/**
 * A pi session file, written by pi's own `SessionManager`: a model and a level
 * set first, pi's leading system message, a turn that thinks, answers and runs
 * a tool, and a second turn that fails.
 *
 * `name` adds the `session_info` entry pi keeps a title a person chose in, for
 * a suite that needs a session pi itself calls something.
 */
export async function sessionOnDisk(sessionDir: string, name?: string) {
  const { SessionManager } = await loadPi();
  const store = SessionManager.create(root, sessionDir);
  store.appendModelChange('anthropic', 'claude-opus-5');
  store.appendThinkingLevelChange('medium');
  store.appendMessage({ role: 'system', content: '', sections: { preamble: 'You are pi.' }, timestamp: Date.now() } as never);
  if (name !== undefined) store.appendSessionInfo(name);
  const first = store.appendMessage({ role: 'user', content: [{ type: 'text', text: 'read a.ts' }], timestamp: Date.now() });
  store.appendMessage(answer([
    { type: 'thinking', thinking: 'I should read it.' },
    { type: 'text', text: 'Reading it.' },
    { type: 'toolCall', id: 'call-1', name: 'read', arguments: { path: 'a.ts' } },
  ], 'toolUse'));
  store.appendMessage({
    role: 'toolResult',
    toolCallId: 'call-1',
    toolName: 'read',
    content: [{ type: 'text', text: 'export {};' }],
    isError: false,
    timestamp: Date.now(),
  } as never);
  const firstEnd = store.appendMessage(answer([{ type: 'text', text: ' It is empty.' }], 'stop'));
  const second = store.appendMessage({ role: 'user', content: 'again', timestamp: Date.now() });
  const secondEnd = store.appendMessage(answer([], 'error', {
    errorMessage: '429 rate limited',
    usage: {
      input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  }));
  // The file itself, for a suite that has to look at the disk rather than at
  // what a listing made of it.
  return { id: store.getSessionId(), file: String(store.getSessionFile()), first, firstEnd, second, secondEnd };
}

/** What pi stores for one assistant message, with the fields a test varies. */
export const answer = (content: Bag[], stopReason: string, extra: Bag = {}): never => ({
  role: 'assistant',
  content,
  api: 'anthropic-messages',
  provider: 'anthropic',
  model: 'claude-opus-5',
  usage: {
    input: 10,
    output: 5,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 15,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason,
  timestamp: Date.now(),
  ...extra,
}) as never;
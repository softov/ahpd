import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import type { Bag } from '@ahpd/sdk';

/*
 * A turn stopped by a person leaves the session idle, not failed.
 *
 * `cancel` ends the turn as cancelled and interrupts the SDK, and the SDK
 * then ends the interrupted turn with a result of its own:
 * `error_during_execution` with `is_error: true`. That frame is copied below
 * from the SDK this package depends on. Read as a failure, it set the
 * session's error, and VS Code drew every stopped session as failed.
 */

/** The SDK's stream as a queue a test pushes frames into, read one at a time. */
const sdk = vi.hoisted(() => {
  const state = {
    held: [] as Record<string, unknown>[],
    wake: undefined as (() => void) | undefined,
    reset() { state.held = []; state.wake = undefined; },
    push(...frames: Record<string, unknown>[]) {
      state.held.push(...frames);
      state.wake?.();
      state.wake = undefined;
    },
    async next(): Promise<Record<string, unknown>> {
      while (state.held.length === 0) await new Promise<void>((resolve) => { state.wake = resolve; });
      return state.held.shift() as Record<string, unknown>;
    },
  };
  return state;
});

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => ({
    async *[Symbol.asyncIterator]() {
      for (;;) yield await sdk.next();
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
    close: () => {},
  }),
}));

const { createSession } = await import('../src/session.js');

const settle = async (times = 30): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** The result the SDK sends after an interrupt, as the real one sent it. */
const interrupted = {
  type: 'result',
  subtype: 'error_during_execution',
  is_error: true,
  errors: ['[ede_diagnostic] result_type=user last_content_type=n/a stop_reason=tool_use'],
  stop_reason: 'tool_use',
  duration_ms: 6000,
};

/** A turn that failed while it ran. */
const failed = { ...interrupted, errors: ['API Error: 500'], stop_reason: null };

async function started() {
  sdk.reset();
  const sent: Bag[] = [];
  const session = createSession({
    uri: 'ahp-session:/cancelled',
    chatUri: 'ahp-chat:/cancelled',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-cancelled-')),
    emit: (_channel, action) => { sent.push(action as Bag); },
  });
  await settle();
  session.begin('t1', 'count to 200');
  await settle();
  return { session, sent };
}

it('leaves a session idle when its turn was stopped and the interrupt result comes after', async () => {
  const { session, sent } = await started();

  session.cancel('t1');
  await settle();
  sdk.push(interrupted);
  await settle();

  expect(sent.filter((one) => one.type === 'chat/turnCancelled')).toHaveLength(1);
  expect(sent.some((one) => one.type === 'chat/error')).toBe(false);
  expect(session.sessionState().error).toBeUndefined();
  expect(session.chatState().status).toBe(1);
});

it('still marks a session failed when a turn that was not stopped fails', async () => {
  const { session, sent } = await started();

  sdk.push(failed);
  await settle();

  expect(sent.some((one) => one.type === 'chat/error')).toBe(true);
  expect(session.sessionState().error).toBe('API Error: 500');
  expect(session.chatState().status).toBe(2);
});

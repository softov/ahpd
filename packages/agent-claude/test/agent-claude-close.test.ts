import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

/*
 * A session's close waits for the CLI's process.
 *
 * The query's `close` starts its cleanup and returns nothing; the cleanup, the
 * one that ends when the process has exited, is what `Symbol.asyncDispose`
 * answers. A host that closes before another process takes its stores waits
 * on the session's close, so the session hands that cleanup back.
 */

const sdk = vi.hoisted(() => ({ exited: false, closed: false }));

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  query: () => ({
    async *[Symbol.asyncIterator]() { /* nothing streamed */ },
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
    close: () => { sdk.closed = true; },
    [Symbol.asyncDispose]: () => new Promise<void>((done) => {
      setTimeout(() => { sdk.exited = true; done(); }, 50);
    }),
  }),
}));

const { createSession } = await import('../src/session.js');

it('settles its close once the query has cleaned up, and not before', async () => {
  const session = createSession({
    uri: 'ahp-session:/close',
    chatUri: 'ahp-chat:/close',
    cwd: mkdtempSync(join(tmpdir(), 'ahpd-close-')),
    emit: () => {},
  });
  const closing = session.close();
  expect(sdk.closed).toBe(true);
  expect(sdk.exited).toBe(false);
  await closing;
  expect(sdk.exited).toBe(true);
});

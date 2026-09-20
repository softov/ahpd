import { expect, it, vi } from 'vitest';
import type { Peer } from '../packages/sdk/src/types/rpc.js';

/*
 * The per-tool load policy, as the Claude SDK is handed it.
 *
 * A host tool's `deferLoading` never reaches a published `ToolDefinition`; the
 * backend turns it into `_meta['anthropic/alwaysLoad']` on the raw definition
 * `createSdkMcpServer` receives, because the SDK's `tool()` helper is not used
 * here. The SDK is mocked because what is under test is the object this host
 * builds, not the SDK's reading of it - a rename in the SDK should fail this
 * test rather than silently defer the one tool the instruction names.
 */

const sdk = vi.hoisted(() => {
  interface Fake {
    frames: Record<string, unknown>[];
    wake: (() => void) | undefined;
    closed: boolean;
    options: Record<string, unknown>;
  }
  return { queries: [] as Fake[] };
});

const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  createSdkMcpServer: (given: Record<string, unknown>) => ({ type: 'sdk', name: given.name, tools: given.tools }),
  listSessions: async () => [],
  getSessionMessages: async () => [],
  query: ({ prompt, options }: { prompt: AsyncIterable<unknown>; options: Record<string, unknown> }) => {
    const fake = { frames: [] as Record<string, unknown>[], wake: undefined as undefined | (() => void), closed: false, options };
    sdk.queries.push(fake);
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
      initializationResult: async () => ({}),
      mcpServerStatus: async () => [],
      reloadSkills: async () => ({ skills: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../packages/sdk/src/host.js');
const { claude } = await import('../packages/agent-claude/src/claude.js');
const { hostTools } = await import('../packages/sdk/src/tools.js');

const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

function peer(): Peer {
  return { send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {} };
}

it('marks the tool the instruction names eager, defers remove and list, and leaves the rest alone', async () => {
  // The whole set, so a tool with no policy is in the sample beside the three
  // that carry one.
  const host = createHost({
    path: '/home/softov',
    agents: [claude({ paths: ['/home/softov'] })],
    tools: hostTools(),
  });
  const client = host.accept(peer());
  await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
  await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/policy', provider: 'claude' } });
  await settle();

  const tools = (sessionQueries().at(-1)?.options.mcpServers as Record<string, { tools: { name: string; _meta?: Record<string, unknown> }[] }>).ahp?.tools ?? [];
  const byName = new Map(tools.map((one) => [one.name, one]));
  expect(byName.get('add_artifact_or_reference')?._meta).toEqual({ 'anthropic/alwaysLoad': true });
  expect(byName.get('remove_artifact_or_reference')?._meta).toEqual({ 'anthropic/alwaysLoad': false });
  expect(byName.get('list_artifacts_and_references')?._meta).toEqual({ 'anthropic/alwaysLoad': false });
  // A host tool that defined no policy passes no `_meta`, which is the SDK's
  // own default rather than a deferred tool being forced either way.
  expect(byName.get('ahp_resource')?._meta).toBeUndefined();
});

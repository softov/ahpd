import { expect, it, vi } from 'vitest';
import type { Peer } from '../src/types/rpc.js';

/*
 * A tool call that stopped because nobody has signed in.
 *
 * The CLI reports a *server's* status and never a call's, so "this call is
 * blocked on that server" is a join nothing upstream makes: every tool named
 * `mcp__<server>__<tool>` is running against one, and a server that starts
 * asking for a sign-in blocks whatever was in flight against it. That is what
 * `chat/toolCallAuthRequired` says, and the protocol's reducer refuses it
 * unless the call carries an MCP contributor - so both halves are here.
 *
 * `src/mcp.js` is mocked because the real one reads the person's own
 * `~/.claude.json` and fetches `/.well-known/oauth-protected-resource` off the
 * network. Without a discovered resource there is no `McpAuthRequirement` to
 * carry, and the host says `error` rather than inventing one - which is the
 * behaviour `host.test.ts` checks.
 */

const sdk = vi.hoisted(() => {
  interface Fake {
    frames: Record<string, unknown>[];
    wake: (() => void) | undefined;
    closed: boolean;
    options: Record<string, unknown>;
  }
  return {
    mcp: [{ name: 'desk', status: 'connected' }] as Record<string, unknown>[],
    queries: [] as Fake[],
  };
});

const sessionQueries = () => sdk.queries.filter((q) => q.options.canUseTool !== undefined);

vi.mock('../src/mcp.js', () => ({
  // One remote server, so there is a URL to discover a resource at.
  serversFor: () => ({ desk: { type: 'http', url: 'https://desk.example/mcp' } }),
  urlOf: (config: { url?: string }) => config.url,
  protectedResource: async () => ({
    resource: 'https://desk.example/mcp',
    authorization_servers: ['https://desk.example'],
    scopes_supported: ['tickets.read'],
  }),
}));

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
      mcpServerStatus: async () => sdk.mcp,
      reloadSkills: async () => ({ skills: [] }),
      supportedModels: async () => [],
      streamInput: async () => {},
      close: () => { fake.closed = true; fake.wake?.(); },
    };
  },
}));

const { createHost } = await import('../src/host.js');
const { claude } = await import('../src/agents/claude.js');

const settle = async (times = 10): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes, send: () => {}, notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}), answered: () => {}, close: () => {},
  };
}

const actions = (p: ReturnType<typeof peer>) => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as { channel: string; action: Record<string, unknown> });

/** Say what the session's own CLI said. */
async function said(...frames: Record<string, unknown>[]): Promise<void> {
  const fake = sessionQueries().at(-1);
  if (!fake) throw new Error('no session CLI is running');
  fake.frames.push(...frames);
  fake.wake?.();
  fake.wake = undefined;
  await settle();
}

const uri = 'ahp-session:/auth';
const chatUri = 'ahp-chat:/auth';

async function running() {
  sdk.queries.length = 0;
  sdk.mcp = [{ name: 'desk', status: 'connected' }];
  const host = createHost({ path: '/home/softov', agents: [claude({ paths: ['/home/softov'] })] });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize', params: { clientId: 'a', protocolVersions: ['0.9.0'] },
  });
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  await settle();
  return { client, peer: p };
}

/** Make the CLI report a status and let the host notice. */
const becomes = async (
  client: { handle(r: { method: string; params: unknown }): unknown },
  status: string,
) => {
  sdk.mcp = [{ name: 'desk', status }];
  // A start request is one of the moments the host re-reads the servers;
  // nothing here polls, because a status nobody asked about moves nothing.
  void client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/mcpServerStartRequested', id: 'mcp:desk' } },
  });
  await settle(12);
};

it('says which running call a sign-in is blocking, and says when it is not', async () => {
  const { client, peer: p } = await running();
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'find the ticket' } } },
  });
  await settle();
  await said({
    type: 'assistant',
    message: {
      id: 'm1',
      content: [{ type: 'tool_use', id: 'tc1', name: 'mcp__desk__search', input: { query: 'ticket' } }],
    },
  });

  // Whose tool it is. Without this the reducer drops the auth action, and a
  // client draws a call that is running and never finishes.
  const started = actions(p).find((one) => one.action.type === 'chat/toolCallStart');
  expect(started?.action.contributor).toEqual({ kind: 'mcp', customizationId: 'mcp:desk' });

  await becomes(client, 'needs-auth');
  const asked = actions(p).find((one) => one.action.type === 'chat/toolCallAuthRequired');
  expect(asked?.action.toolCallId).toBe('tc1');
  // The whole requirement, because a client is being told to sign in and
  // needs somewhere to do it: the resource, discovered off the server's own
  // `/.well-known/oauth-protected-resource`.
  expect(asked?.action.auth).toMatchObject({
    reason: 'required',
    resource: { resource: 'https://desk.example/mcp', authorization_servers: ['https://desk.example'] },
  });
  // And at the session level, which is where a client looking at a list of
  // sessions rather than at a conversation sees that one is stuck.
  const blocked = actions(p).find((one) => one.action.type === 'session/inputNeededSet');
  // The chat under this host's own name, which is what a client dispatches
  // to whether or not it has subscribed under a spelling of its own.
  expect(blocked?.action.request).toMatchObject({ kind: 'toolAuthentication', turnId: 't1' });
  expect(String((blocked?.action.request as { chat?: string }).chat)).toContain('ahp-chat:');

  await becomes(client, 'connected');
  const freed = actions(p).find((one) => one.action.type === 'chat/toolCallAuthResolved');
  expect(freed?.action.toolCallId).toBe('tc1');
  const lifted = actions(p).filter((one) => one.action.type === 'session/inputNeededRemoved');
  expect(lifted.some((one) => one.action.id === 'auth:tc1')).toBe(true);
});

it('says nothing about a call that had already finished', async () => {
  const { client, peer: p } = await running();
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'find it' } } },
  });
  await settle();
  await said(
    {
      type: 'assistant',
      message: { id: 'm1', content: [{ type: 'tool_use', id: 'tc1', name: 'mcp__desk__search', input: {} }] },
    },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tc1', content: 'found' }] } },
  );

  await becomes(client, 'needs-auth');
  // The server needs signing in and nothing is waiting on it. A host that
  // reported the call anyway would move a completed row back into
  // `auth-required`, which the reducer takes and a client then draws for ever.
  expect(actions(p).filter((one) => one.action.type === 'chat/toolCallAuthRequired')).toEqual([]);
});

it('leaves the harness\'s own tools alone, because no server is behind them', async () => {
  const { client, peer: p } = await running();
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', message: { text: 'read it' } } },
  });
  await settle();
  await said({
    type: 'assistant',
    message: { id: 'm1', content: [{ type: 'tool_use', id: 'tc1', name: 'Read', input: { file_path: '/tmp/a' } }] },
  });
  const started = actions(p).find((one) => one.action.type === 'chat/toolCallStart');
  expect(started?.action.contributor).toBeUndefined();

  await becomes(client, 'needs-auth');
  expect(actions(p).filter((one) => one.action.type === 'chat/toolCallAuthRequired')).toEqual([]);
});

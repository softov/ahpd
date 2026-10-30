import { beforeEach, expect, it, vi } from 'vitest';
import { ROOT } from '../src/host.js';
import { claude, createHost, machine, peer, resetSdk, sdk, sessionQueries, settle } from './support/host.js';
import type { Fake } from './support/claude-sdk.js';

/*
 * A token is spent only on the sessions its connection watches.
 *
 * This host keeps a pushed token per connection and spends it only on the
 * sessions that connection asks for, a backend's token and an MCP server's
 * alike (`docs/sdk/AUTHENTICATION.md`). A client is in a session while it
 * watches it under any spelling, which is also who is asked to sign in for one
 * of its servers. So two clients on one host each sign in for their own.
 *
 * `src/mcp.js` is mocked because the real one reads the person's own
 * `~/.claude.json` and fetches the server's protected resource off the network.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

vi.mock('../../agent-claude/src/mcp.js', () => ({
  // The host offers none of its own here.
  offeredServers: () => ({}),
  serversFor: () => ({ desk: { type: 'http', url: 'https://desk.example/desk' } }),
  urlOf: (config: { url?: string }) => config.url,
  protectedResource: async () => ({ resource: 'https://desk.example/', authorization_servers: ['https://login.example'] }),
}));

beforeEach(resetSdk);

const DIR = '/home/softov';
const DESK = 'https://desk.example/';
const ONE = 'ahp-session:/one';
const TWO = 'ahp-session:/two';

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** A client that has said hello under its own id. */
const introduced = async (host: ReturnType<typeof createHost>, clientId: string) => {
  const wire = peer();
  const client = host.accept(wire);
  await client.handle({ method: 'initialize', params: { channel: ROOT, clientId, protocolVersions: ['0.9.0'] } });
  return { client, wire };
};

/** A session the client makes and watches, and the CLI it runs. */
const opened = async (client: Client, uri: string): Promise<Fake> => {
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'claude', workingDirectories: [`file://${DIR}`] },
  });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  // `describe` answers on its own clock; the server's state arrives with it.
  await settle(8);
  const cli = sessionQueries().at(-1);
  if (cli === undefined) throw new Error(`no CLI runs for ${uri}`);
  return cli;
};

/** Two clients on one host, each watching a session of its own whose server waits for a sign-in. */
const twoClients = async () => {
  sdk.mcp = [{ name: 'desk', status: 'needs-auth' }];
  const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })], ...machine() });
  const ana = await introduced(host, 'ana');
  const bea = await introduced(host, 'bea');
  const one = await opened(ana.client, ONE);
  const two = await opened(bea.client, TWO);
  return { host, ana, bea, one, two };
};

/** The `Authorization` header a session's CLI was last given for its server. */
const header = (cli: Fake): string | undefined =>
  (cli.options.mcpServers as Record<string, { headers?: Record<string, string> }> | undefined)?.desk?.headers?.Authorization;

const signIns = (wire: ReturnType<typeof peer>, reason: string) => wire.notes
  .filter((one) => one.method === 'auth/required' && (one.params as { reason?: unknown }).reason === reason);

it('spends a token only on the sessions its connection watches', async () => {
  const { ana, one, two } = await twoClients();
  await expect(ana.client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'desk-ana' },
  })).resolves.toEqual({});
  await settle(8);

  expect(header(one)).toBe('Bearer desk-ana');
  // Bea's session waits for the same resource, and Ana's token is not hers.
  expect(header(two)).toBeUndefined();
});

it('refuses a token for a server only another connection watches', async () => {
  const { host } = await twoClients();
  const cy = await introduced(host, 'cy');
  // Neither session is Cy's, so no resource it was told about waits for this.
  await expect(cy.client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'desk-cy' },
  })).rejects.toMatchObject({ code: -32602 });
  await settle(8);
  expect(sdk.mcpDeclared).toEqual([]);
});

it('refuses a token aimed at a session its connection does not watch', async () => {
  const { bea, one } = await twoClients();
  await expect(bea.client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'desk-bea', target: { kind: 'mcpServer', session: ONE, customizationId: 'mcp:desk' } },
  })).rejects.toMatchObject({ code: -32602 });
  await settle(8);
  expect(header(one)).toBeUndefined();
});

it('asks a client watching under an older spelling to sign in, by that spelling', async () => {
  sdk.mcp = [{ name: 'desk', status: 'connected' }];
  const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })], ...machine() });
  const ana = await introduced(host, 'ana');
  await ana.client.handle({
    method: 'createSession',
    params: { channel: ONE, provider: 'claude', workingDirectories: [`file://${DIR}`] },
  });
  // The name a session had before this host named one `ahp-session:`, which a
  // client may still watch it by.
  await ana.client.handle({ method: 'subscribe', params: { channel: 'claude:/one' } });
  await settle(8);

  // The server starts asking for a sign-in, read when somebody asks it to start.
  sdk.mcp = [{ name: 'desk', status: 'needs-auth' }];
  void ana.client.handle({
    method: 'dispatchAction',
    params: { channel: ONE, action: { type: 'session/mcpServerStartRequested', id: 'mcp:desk' } },
  });
  await settle(12);

  expect(signIns(ana.wire, 'required')).toEqual([{
    method: 'auth/required',
    params: { channel: 'claude:/one', resource: expect.objectContaining({ resource: DESK }), reason: 'required' },
  }]);
  // And its token, aimed at the session under that spelling, is taken.
  await expect(ana.client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'desk-ana', target: { kind: 'mcpServer', session: 'claude:/one', customizationId: 'mcp:desk' } },
  })).resolves.toEqual({});
});

it('names a session its connection watches when a token runs out', async () => {
  const { bea } = await twoClients();
  vi.useFakeTimers();
  try {
    await bea.client.handle({
      method: 'authenticate',
      params: { channel: ROOT, resource: DESK, token: 'desk-bea', expiresIn: 60 },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    // Bea's own session, though Ana's waits for the same resource and was opened first.
    expect(signIns(bea.wire, 'expired')).toEqual([{
      method: 'auth/required',
      params: { channel: TWO, resource: { resource: DESK }, reason: 'expired' },
    }]);
  }
  finally {
    vi.useRealTimers();
  }
});

import { beforeEach, expect, it, vi } from 'vitest';
import { ROOT } from '../src/host.js';
import { claude, createHost, hostTools, machine, peer, resetSdk, sdk, sendAnswered, sessionQueries, settle } from './support/host.js';
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
  toClaudeMcpServers: () => ({}),
  serversFor: () => ({ desk: { type: 'http', url: 'https://desk.example/desk' } }),
  urlOf: (config: { url?: string }) => config.url,
  protectedResource: async () => ({ resource: 'https://desk.example/', authorization_servers: ['https://login.example'] }),
}));

beforeEach(resetSdk);

const DIR = '/home/softov';
const DESK = 'https://desk.example/';
/** The server's row, named by its internal uri: no file here declares it. */
const DESK_ID = 'claude-internal:/mcp/desk#mcp=desk';
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
  // The CLI its first send starts, whose `describe` answers on its own clock;
  // the server's state arrives with it.
  await sendAnswered(client, uri);
  await settle(8);
  const cli = sessionQueries().at(-1);
  if (cli === undefined) throw new Error(`no CLI runs for ${uri}`);
  return cli;
};

/** Two clients on one host, each watching a session of its own whose server waits for a sign-in. */
const twoClients = async () => {
  sdk.mcp = [{ name: 'desk', status: 'needs-auth' }];
  // The host's own tools too, which ride the session's in-process host server.
  const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })], ...machine(), tools: hostTools() });
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
  // The whole set the session holds goes back with the token, its in-process
  // host server among it.
  expect(Object.keys(one.options.mcpServers as Record<string, unknown>)).toContain('host');
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

/*
 * VS Code takes a token aimed at an MCP server of an existing session from any
 * connection, watching it or not.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L2155-L2164
 */
it('takes a token aimed at a session its connection does not watch, as VS Code\'s', async () => {
  const { bea } = await twoClients();
  await expect(bea.client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'desk-bea', target: { kind: 'mcpServer', session: ONE, customizationId: DESK_ID } },
  })).resolves.toEqual({});
});

/*
 * A server's sign-in is its `authRequired` state, which a client watching the
 * session reads, as a VS Code window reads it: VS Code's host says no
 * `auth/required` for it. A session is watched and aimed at by the one URI it
 * is held by: the same id in a provider's scheme is no session, and a token
 * aimed at it names no server.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L729-L736
 */
it('leaves a server\'s sign-in to its state, and refuses a token aimed at another URI of the session', async () => {
  sdk.mcp = [{ name: 'desk', status: 'connected' }];
  const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })], ...machine() });
  const ana = await introduced(host, 'ana');
  await ana.client.handle({
    method: 'createSession',
    params: { channel: ONE, provider: 'claude', workingDirectories: [`file://${DIR}`] },
  });
  await ana.client.handle({ method: 'subscribe', params: { channel: ONE } });
  await sendAnswered(ana.client, ONE);
  await settle(8);

  // The server starts asking for a sign-in, read when somebody asks it to start.
  sdk.mcp = [{ name: 'desk', status: 'needs-auth' }];
  void ana.client.handle({
    method: 'dispatchAction',
    params: { channel: ONE, action: { type: 'session/mcpServerStartRequested', id: DESK_ID } },
  });
  await settle(12);

  expect(signIns(ana.wire, 'required')).toEqual([]);
  const state = (await ana.client.handle({ method: 'subscribe', params: { channel: ONE } }) as {
    snapshot: { state: { customizations?: { id?: string; state?: { kind?: string } }[] } };
  }).snapshot.state;
  expect(state.customizations?.find((one) => one.id === DESK_ID)?.state?.kind).toBe('authRequired');
  await expect(ana.client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'desk-ana', target: { kind: 'mcpServer', session: 'claude:/one', customizationId: DESK_ID } },
  })).rejects.toMatchObject({ code: -32602 });
  await expect(ana.client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'desk-ana', target: { kind: 'mcpServer', session: ONE, customizationId: DESK_ID } },
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

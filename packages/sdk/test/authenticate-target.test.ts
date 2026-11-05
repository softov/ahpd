import { beforeEach, expect, it, vi } from 'vitest';
import { ROOT } from '../src/host.js';
import { claude, createHost, hello, machine, peer, resetSdk, sdk, sessionQueries, settle } from './support/host.js';
import type { Fake } from './support/claude-sdk.js';

/*
 * A token aimed at one MCP server, with `authenticate`'s `target`.
 *
 * A client that answers one server's sign-in names that server by its session
 * and its customization id, and the protocol has the host give the token to
 * that server alone: never to a server beside it, another session, or a
 * backend's own resource, even when they share the resource. A target the host
 * cannot find is `-32602`.
 * https://github.com/microsoft/agent-host-protocol/blob/0b7b7f9f4ceb2fbd8846557416f765ac73da647d/docs/specification/authentication.md#L117-L155
 *
 * `src/mcp.js` is mocked because the real one reads the person's own
 * `~/.claude.json` and fetches each server's protected resource off the
 * network. Two of these servers share one resource, as two servers behind one
 * authorization server do, and the third shares the Claude backend's own.
 */

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

vi.mock('../../agent-claude/src/mcp.js', () => ({
  // The host offers none of its own here.
  toClaudeMcpServers: () => ({}),
  serversFor: () => ({
    desk: { type: 'http', url: 'https://desk.example/desk' },
    tickets: { type: 'http', url: 'https://desk.example/tickets' },
    keys: { type: 'http', url: 'https://api.anthropic.com/mcp' },
  }),
  urlOf: (config: { url?: string }) => config.url,
  protectedResource: async (url: string) => ({
    resource: url.startsWith('https://api.anthropic.com/') ? 'https://api.anthropic.com' : 'https://desk.example/',
    authorization_servers: ['https://login.example'],
  }),
}));

beforeEach(resetSdk);

const DIR = '/home/softov';
const DESK = 'https://desk.example/';
const ANTHROPIC = 'https://api.anthropic.com';
const ONE = 'ahp-session:/one';
const TWO = 'ahp-session:/two';
const THREE = 'ahp-session:/three';

/** A target, as a client names the server whose sign-in it answers. */
const at = (session: string, customizationId: string) => ({ kind: 'mcpServer', session, customizationId });

/** A server's row id: no file here declares a server, so each is named by its internal uri. */
const serverId = (name: string): string => `claude-internal:/mcp/${name}#mcp=${name}`;

/**
 * One client with two Claude sessions, each with three servers that wait for a
 * sign-in, and the CLI each session runs.
 *
 * A skill too, so each session publishes a customization that is not a server.
 */
const twoSessions = async () => {
  sdk.init = { commands: [{ name: 'review', description: 'A review pass' }] };
  sdk.skills.push({ name: 'review', description: 'A review pass' });
  sdk.mcp = [
    { name: 'desk', status: 'needs-auth' },
    { name: 'tickets', status: 'needs-auth' },
    { name: 'keys', status: 'needs-auth' },
  ];
  const host = createHost({ path: DIR, agents: [claude({ paths: [DIR] })], ...machine() });
  const wire = peer();
  const client = host.accept(wire);
  await client.handle(hello(['0.9.0']));
  const opened = async (uri: string): Promise<Fake> => {
    await client.handle({
      method: 'createSession',
      params: { channel: uri, provider: 'claude', workingDirectories: [`file://${DIR}`] },
    });
    await client.handle({ method: 'subscribe', params: { channel: uri } });
    // `describe` answers on its own clock; the servers' states arrive with it.
    await settle(8);
    const cli = sessionQueries().at(-1);
    if (cli === undefined) throw new Error(`no CLI runs for ${uri}`);
    return cli;
  };
  const one = await opened(ONE);
  const two = await opened(TWO);
  return { client, wire, one, two };
};

/** The `Authorization` header a session's CLI was last given for one of its servers. */
const header = (cli: Fake, server: string): string | undefined =>
  (cli.options.mcpServers as Record<string, { headers?: Record<string, string> }> | undefined)?.[server]?.headers?.Authorization;

/**
 * The key the last session's CLI runs on: its own `env`'s, or the daemon's when
 * it has none.
 */
const spent = (): string | undefined => {
  const env = sessionQueries().at(-1)?.options.env as Record<string, string> | undefined;
  return env === undefined ? process.env.ANTHROPIC_API_KEY : env.ANTHROPIC_API_KEY;
};

it('gives a targeted token to that server in that session alone', async () => {
  const { client, one, two } = await twoSessions();
  await expect(client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: DESK, token: 'tickets-two', target: at(TWO, serverId('tickets')) },
  })).resolves.toEqual({});
  await settle(8);

  expect(header(two, 'tickets')).toBe('Bearer tickets-two');
  // Not the server beside it, which waits for the same resource.
  expect(header(two, 'desk')).toBeUndefined();
  // And nothing in the other session, whose servers wait for it too.
  expect(header(one, 'desk')).toBeUndefined();
  expect(header(one, 'tickets')).toBeUndefined();
  expect(sdk.mcpReconnected).toEqual(['tickets']);
});

it('refuses a target it cannot find, and gives the token to nobody', async () => {
  const { client } = await twoSessions();
  const state = (await client.handle({ method: 'subscribe', params: { channel: TWO } }) as {
    snapshot: { state: { customizations: { id: string; type: string }[] } };
  }).snapshot.state;
  const skills = state.customizations.find((one) => one.type !== 'mcpServer');
  expect(skills).toBeDefined();

  for (const target of [
    // A kind this host does not know names a consumer it cannot confine the token to.
    { ...at(TWO, serverId('tickets')), kind: 'hostOwned' },
    at('ahp-session:/nowhere', serverId('tickets')),
    at(TWO, serverId('nowhere')),
    at(TWO, skills?.id ?? ''),
    serverId('tickets'),
  ]) {
    await expect(client.handle({
      method: 'authenticate',
      params: { channel: ROOT, resource: DESK, token: 'lost', target },
    })).rejects.toMatchObject({ code: -32602 });
  }
  await settle(8);
  expect(sdk.mcpDeclared).toEqual([]);
});

it('refuses a targeted token for a resource its server is not waiting for', async () => {
  const { client } = await twoSessions();
  // A resource this host advertises, for the backend itself, and not the one
  // this server waits for.
  await expect(client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: ANTHROPIC, token: 'sk-wrong', target: at(TWO, serverId('tickets')) },
  })).rejects.toMatchObject({ code: -32602 });
  await settle(8);
  expect(sdk.mcpDeclared).toEqual([]);
});

it('never starts a session on a token aimed at a server, even one that shares the backend\'s resource', async () => {
  const { client, two } = await twoSessions();
  await client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: ANTHROPIC, token: 'sk-keys', target: at(TWO, serverId('keys')) },
  });
  await settle(8);
  expect(header(two, 'keys')).toBe('Bearer sk-keys');

  await client.handle({
    method: 'createSession',
    params: { channel: THREE, provider: 'claude', workingDirectories: [`file://${DIR}`] },
  });
  await settle(8);
  // The token is that server's, and an agent-level resource never gets it.
  expect(spent()).toBe(process.env.ANTHROPIC_API_KEY);
});

it('withdraws a targeted token and keeps the one pushed for the resource', async () => {
  const { client } = await twoSessions();
  await client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: ANTHROPIC, token: 'sk-agent' },
  });
  await client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: ANTHROPIC, token: 'sk-keys', target: at(TWO, serverId('keys')) },
  });
  await settle(8);
  await expect(client.handle({
    method: 'authenticate',
    params: { channel: ROOT, resource: ANTHROPIC, token: '', target: at(TWO, serverId('keys')) },
  })).resolves.toEqual({});

  await client.handle({
    method: 'createSession',
    params: { channel: THREE, provider: 'claude', workingDirectories: [`file://${DIR}`] },
  });
  await settle(8);
  // Revoked "limited to `target`", so the client's token for the backend stands.
  expect(spent()).toBe('sk-agent');
});

it('says a targeted token ran out on the session of its server', async () => {
  const { client, wire } = await twoSessions();
  vi.useFakeTimers();
  try {
    await client.handle({
      method: 'authenticate',
      params: { channel: ROOT, resource: DESK, token: 'tickets-short', expiresIn: 60, target: at(TWO, serverId('tickets')) },
    });
    await vi.advanceTimersByTimeAsync(60_000);
    const expired = wire.notes.filter((one) => one.method === 'auth/required'
      && (one.params as { reason?: unknown }).reason === 'expired');
    // On the session that server belongs to, which is where its requirement is drawn.
    expect(expired).toEqual([{
      method: 'auth/required',
      params: { channel: TWO, resource: { resource: DESK }, reason: 'expired' },
    }]);
  }
  finally {
    vi.useRealTimers();
  }
});

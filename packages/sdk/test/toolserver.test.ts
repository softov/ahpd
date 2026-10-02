import { expect, describe, it } from 'vitest';
import { createHost } from '../src/host.js';
import { toolServers } from '../src/toolserver.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { Peer } from '../src/types/rpc.js';
import type { ToolsEndpoint, ToolsServers } from '../src/toolserver.js';

/*
 * The host's tools as an MCP server over HTTP.
 *
 * A backend that cannot call them in process - an ACP agent, which asks its
 * client - is handed a URL and a token instead, and everything here is about
 * that boundary: what the endpoint lists, what a call answers, and who may
 * reach it. The transport is streamable HTTP with the JSON-RPC under it written
 * out longhand, so the cases are the protocol's and not a library's.
 */

const ORIGIN = 'http://127.0.0.1:4242';

const peer = (): Peer => ({
  send: () => {}, notify: () => {}, request: async () => ({}), answered: () => {}, close: () => {},
});

/** A tool, in the shape the host binds one and the endpoint lists it. */
const tool = (name: string, answer: string) => ({
  definition: {
    name,
    description: `${name} does one thing`,
    inputSchema: { type: 'object' as const, properties: { what: { type: 'string' } }, required: ['what'] },
  },
  run: async (input: Record<string, unknown>) => `${answer} ${String(input['what'] ?? '')}`.trim(),
});

/** What one message asked, answered by these servers over these tools. */
const call = async (
  servers: ToolsServers,
  endpoint: ToolsEndpoint,
  method: string,
  params?: unknown,
  token = endpoint.token,
): Promise<{ status: number; said: Record<string, unknown> }> => {
  const answered = await servers.request(new Request(endpoint.url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
  }));
  if (answered === undefined) throw new Error('the endpoint answered nothing');
  return { status: answered.status, said: await answered.json() as Record<string, unknown> };
};

describe('a session\'s tools server', () => {
  const serving = () => {
    const servers = toolServers({ origin: () => ORIGIN, name: 'ahpd', version: '9.9.9' });
    const tools = [tool('peek', 'peeked'), tool('poke', 'poked')];
    return { servers, endpoint: servers.open(tools) as ToolsEndpoint };
  };

  it('answers initialize with what it is, before anything is asked of it', async () => {
    const { servers, endpoint } = serving();
    const { status, said } = await call(servers, endpoint, 'initialize');
    expect(status).toBe(200);
    expect(said).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: {
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ahpd', version: '9.9.9' },
      },
    });
  });

  it('lists the tools the session was given, with their schemas', async () => {
    const { servers, endpoint } = serving();
    const { said } = await call(servers, endpoint, 'tools/list');
    expect((said.result as { tools: { name: string; description: string; inputSchema: unknown }[] }).tools).toEqual([
      {
        name: 'peek',
        description: 'peek does one thing',
        inputSchema: { type: 'object', properties: { what: { type: 'string' } }, required: ['what'] },
      },
      {
        name: 'poke',
        description: 'poke does one thing',
        inputSchema: { type: 'object', properties: { what: { type: 'string' } }, required: ['what'] },
      },
    ]);
  });

  it('runs a tool and answers what it said', async () => {
    const { servers, endpoint } = serving();
    const { said } = await call(servers, endpoint, 'tools/call', { name: 'poke', arguments: { what: 'the turnstile' } });
    expect(said.result).toEqual({ content: [{ type: 'text', text: 'poked the turnstile' }] });
  });

  it('says a tool that threw in the content, which is where a model reads it', async () => {
    const { servers, endpoint } = serving();
    const opened = servers.open([{
      definition: { name: 'broken' },
      run: () => { throw new Error('the port was not there'); },
    }]) as ToolsEndpoint;
    const { said } = await call(servers, opened, 'tools/call', { name: 'broken' });
    expect(said.result).toEqual({
      content: [{ type: 'text', text: 'the port was not there' }],
      isError: true,
    });
  });

  it('refuses a token that is not this session\'s, before reading the call', async () => {
    const { servers, endpoint } = serving();
    const { status, said } = await call(servers, endpoint, 'tools/list', undefined, 'not-the-token');
    expect(status).toBe(401);
    expect((said.error as { message: string }).message).toContain("only its own session's token");
  });

  it('does not let one session\'s token reach another\'s tools', async () => {
    const servers = toolServers({ origin: () => ORIGIN });
    const mine = servers.open([tool('mine', 'mine')]) as ToolsEndpoint;
    const theirs = servers.open([tool('theirs', 'theirs')]) as ToolsEndpoint;

    // The other token on this path is a 401, and this token on the other path
    // reaches that other session's tools and no others.
    expect((await call(servers, mine, 'tools/list', undefined, theirs.token)).status).toBe(401);
    expect((await call(servers, theirs, 'tools/list', undefined, mine.token)).status).toBe(401);
    const said = await call(servers, theirs, 'tools/call', { name: 'theirs', arguments: { what: 'now' } });
    expect(said.said.result).toEqual({ content: [{ type: 'text', text: 'theirs now' }] });
    // The paths are of their own as well, so a token alone is not an address.
    expect(mine.url).not.toBe(theirs.url);
  });

  it('answers nothing at a path that is not one, so the listener answers it', async () => {
    const { servers } = serving();
    expect(await servers.request(new Request(`${ORIGIN}/api/anything`))).toBeUndefined();
  });

  it('is a 404 at a path of its own once the session has ended', async () => {
    const servers = toolServers({ origin: () => ORIGIN });
    const endpoint = servers.open([tool('peek', 'peeked')]) as ToolsEndpoint;
    expect((await call(servers, endpoint, 'tools/list')).status).toBe(200);

    endpoint.close();
    const gone = await servers.request(new Request(endpoint.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }));
    expect(gone?.status).toBe(404);
  });

  it('opens nothing on a host with no address to serve one on', () => {
    const servers = toolServers({ origin: () => undefined });
    expect(servers.open([tool('peek', 'peeked')])).toBeUndefined();
  });

  it('answers a notification with the fact that it was heard, and a stream with 405', async () => {
    const { servers, endpoint } = serving();
    const heard = await servers.request(new Request(endpoint.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    }));
    expect(heard?.status).toBe(202);
    expect(await servedText(heard)).toBe('');
    const stream = await servers.request(new Request(endpoint.url, { headers: { authorization: `Bearer ${endpoint.token}` } }));
    expect(stream?.status).toBe(405);
  });

  it('refuses a method it does not answer, and a body that is not one message', async () => {
    const { servers, endpoint } = serving();
    const unknown = await call(servers, endpoint, 'resources/list');
    expect((unknown.said.error as { code: number }).code).toBe(-32601);

    const batched = await servers.request(new Request(endpoint.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
      body: JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }]),
    }));
    expect(batched?.status).toBe(400);
  });
});

/** A response's body as text, for the answer that has none. */
const servedText = async (response: Response | undefined): Promise<string> =>
  response === undefined ? '' : await response.text();

describe('what a session is handed', () => {
  const DIR = '/tmp/ahpd-toolserver';
  const peerOf = peer;

  /**
   * A host with the host's tools and somewhere to serve them on.
   *
   * The backend is the `examples/echo` agent, which asks for nothing - so the
   * endpoint is opened the way a backend that wants one would open it, from the
   * `Start` it was given.
   */
  const serving = async (origin: string | undefined) => {
    const servers = toolServers({ origin: () => origin });
    const seen: Start[] = [];
    const base = echo({ path: DIR, pace: 0 });
    const agent: Agent = {
      ...base,
      create: (start: Start) => {
        seen.push(start);
        return base.create(start);
      },
    };
    const host = createHost({
      path: DIR,
      agents: [agent],
      tools: [{ definition: { name: 'peek', description: 'peek does one thing' }, run: () => 'peeked' }],
      toolsServers: servers,
    });
    const client = host.accept(peerOf());
    await client.handle({ method: 'initialize', params: { clientId: 'probe', protocolVersions: ['0.9.0'] } });
    await client.handle({ method: 'createSession', params: { channel: 'ahp-session:/served', provider: 'echo' } });
    return { servers, client, start: seen.at(0) as Start };
  };

  it('opens an endpoint the listener answers, and closes it with the session', async () => {
    const { servers, client, start } = await serving(ORIGIN);
    expect(start.toolsServer).toBeDefined();
    const endpoint = start.toolsServer?.() as ToolsEndpoint;
    expect(endpoint.url).toMatch(new RegExp(`^${ORIGIN}/ahp-mcp/`));

    // What the listener would answer with it, which is the same registry.
    const { said } = await call(servers, endpoint, 'tools/call', { name: 'peek' });
    expect(said.result).toEqual({ content: [{ type: 'text', text: 'peeked' }] });

    await client.handle({ method: 'disposeSession', params: { channel: 'ahp-session:/served' } });
    const gone = await servers.request(new Request(endpoint.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${endpoint.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }));
    expect(gone?.status).toBe(404);
  });

  it('is left out on a host with nowhere to serve one, rather than handing out a dead URL', async () => {
    const { start } = await serving(undefined);
    // The host still offers the field - it is the one that knows the listener
    // is not there - and opening one answers nothing.
    expect(start.toolsServer?.()).toBeUndefined();
  });
});
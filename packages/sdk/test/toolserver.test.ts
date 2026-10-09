import { expect, describe, it } from 'vitest';
import { createHost } from '../src/host.js';
import { toolServers } from '../src/tools/server.js';
import { toMcpContent } from '../src/tools/mcpcontent.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, BoundTool, Start } from '../src/types/agent.js';
import type { ClientCallAnswer } from '../src/tools/clientcalls.js';
import type { OnWire } from '../src/types/wire.js';
import type { Peer } from '../src/types/rpc.js';
import type { RunClientTool, ToolsEndpoint, ToolsServers } from '../src/tools/server.js';
import type { ToolResultContent } from '@microsoft/agent-host-protocol';

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

describe('a client\'s tool, run through the server', () => {
  /** A client's tool: an owner, and no `run` of this host's own. */
  const clientTool = (name: string, owner = 'vscode'): BoundTool => ({
    definition: { name: `${owner}__${name}`, description: `${name} is run by ${owner}` },
    owner,
  });

  /** What a client said its own tool did. */
  const answer = (value: string, content?: OnWire<ToolResultContent>[]): ClientCallAnswer => ({
    ok: true,
    text: value,
    content: content ?? [{ type: 'text', text: value }],
  });

  /**
   * An endpoint as a backend that handed over a runner would be given one.
   *
   * The host's own `peek` is served beside the client's `openFile`, because a
   * backend takes both through the same list and only one of them is this
   * server's to run.
   */
  const serving = (runClient?: RunClientTool, toolsChanged?: 'notify' | 'list') => {
    const servers = toolServers({ origin: () => ORIGIN, name: 'ahpd', version: '9.9.9' });
    const endpoint = servers.open(
      [tool('peek', 'peeked'), clientTool('openFile')],
      runClient,
      toolsChanged,
    ) as ToolsEndpoint;
    return { servers, endpoint };
  };

  /** The names this path lists, in the order it lists them. */
  const names = async (servers: ToolsServers, endpoint: ToolsEndpoint): Promise<string[]> => {
    const { said } = await call(servers, endpoint, 'tools/list');
    return (said.result as { tools: { name: string }[] }).tools.map((one) => one.name);
  };

  it('runs a client\'s tool through the runner, and hands it the request as it came', async () => {
    const seen: { tool: BoundTool; input: Record<string, unknown>; meta: Record<string, unknown> | undefined }[] = [];
    const { servers, endpoint } = serving(async (asked, input, meta) => {
      seen.push({ tool: asked, input, meta });
      return answer('opened /a.txt');
    });

    const { said } = await call(servers, endpoint, 'tools/call', {
      name: 'vscode__openFile',
      arguments: { path: '/a.txt' },
      _meta: { toolCallId: 'call-1' },
    });
    expect(said.result).toEqual({ content: [{ type: 'text', text: 'opened /a.txt' }] });

    // The tool as the host bound it, so the backend can see whose tool it has
    // been asked to run; the arguments as the model wrote them; and `_meta` as
    // it came, so a backend reads a call id the agent put there.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.tool.definition.name).toBe('vscode__openFile');
    expect(seen[0]?.tool.owner).toBe('vscode');
    expect(seen[0]?.input).toEqual({ path: '/a.txt' });
    expect(seen[0]?.meta).toEqual({ toolCallId: 'call-1' });
  });

  it('runs the host\'s own tools itself, runner or not', async () => {
    const { servers, endpoint } = serving(async () => answer('the runner was not asked'));
    const { said } = await call(servers, endpoint, 'tools/call', { name: 'peek', arguments: { what: 'x' } });
    expect(said.result).toEqual({ content: [{ type: 'text', text: 'peeked x' }] });
  });

  it('answers an image as an image and another embedded resource as a blob, beside the text', async () => {
    const { servers, endpoint } = serving(async () => answer('here it is', [
      { type: 'text', text: 'here it is' },
      { type: 'embeddedResource', data: 'iVBORw0KGgo=', contentType: 'image/png' },
      { type: 'embeddedResource', data: 'JVBERi0=', contentType: 'application/pdf' },
    ]));

    const { said } = await call(servers, endpoint, 'tools/call', { name: 'vscode__openFile', arguments: {} });
    expect(said.result).toEqual({
      content: [
        { type: 'text', text: 'here it is' },
        { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
        {
          type: 'resource',
          resource: { uri: expect.any(String), mimeType: 'application/pdf', blob: 'JVBERi0=' },
        },
      ],
    });
  });

  it('says a client\'s failed call in the content, which is where a model reads it', async () => {
    const { servers, endpoint } = serving(async () => ({
      ok: false,
      text: 'the file is not there',
      content: [{ type: 'text', text: 'the file is not there' }],
    }));

    const { said } = await call(servers, endpoint, 'tools/call', { name: 'vscode__openFile', arguments: {} });
    expect(said.result).toEqual({
      content: [{ type: 'text', text: 'the file is not there' }],
      isError: true,
    });
  });

  it('says a runner that threw the same way, rather than failing the request', async () => {
    const { servers, endpoint } = serving(() => { throw new Error('the client went away'); });
    const { said } = await call(servers, endpoint, 'tools/call', { name: 'vscode__openFile', arguments: {} });
    expect(said.result).toEqual({ content: [{ type: 'text', text: 'the client went away' }], isError: true });
  });

  it('still refuses a client\'s tool when it was handed no runner', async () => {
    const { servers, endpoint } = serving();
    const { said } = await call(servers, endpoint, 'tools/call', { name: 'vscode__openFile', arguments: {} });
    expect((said.error as { message: string }).message).toBe('vscode__openFile is a client\'s tool, which this server cannot run');
  });

  it('serves the tools the session has now, after the list is replaced', async () => {
    const ran: string[] = [];
    const { servers, endpoint } = serving(async (asked) => {
      ran.push(asked.definition.name);
      return answer(`ran ${asked.definition.name}`);
    });
    expect(await names(servers, endpoint)).toEqual(['peek', 'vscode__openFile']);

    endpoint.setTools([tool('poke', 'poked'), clientTool('saveFile', 'zed')]);
    expect(await names(servers, endpoint)).toEqual(['poke', 'zed__saveFile']);

    // A tool taken away is not one this path answers any more, and the one put
    // in its place reaches the runner as the client's it now is.
    const gone = await call(servers, endpoint, 'tools/call', { name: 'vscode__openFile', arguments: {} });
    expect((gone.said.error as { message: string }).message).toBe('No tool named vscode__openFile');
    const { said } = await call(servers, endpoint, 'tools/call', { name: 'zed__saveFile', arguments: {} });
    expect(said.result).toEqual({ content: [{ type: 'text', text: 'ran zed__saveFile' }] });
    expect(ran).toEqual(['zed__saveFile']);
  });

  it('declares listChanged and streams the notification, when it was asked to notify', async () => {
    const { servers, endpoint } = serving(async () => answer('ran'), 'notify');
    const { said } = await call(servers, endpoint, 'initialize');
    expect((said.result as { capabilities: unknown }).capabilities).toEqual({ tools: { listChanged: true } });

    // A GET under this token is the server-to-client stream, and the token is
    // still asked for before anything is held open.
    const stream = await servers.request(new Request(endpoint.url, { headers: { authorization: `Bearer ${endpoint.token}` } }));
    expect(stream?.status).toBe(200);
    const reader = (stream as Response).body?.getReader();
    if (reader === undefined) throw new Error('the notify mode opened no stream to read');

    endpoint.setTools([tool('peek', 'peeked')]);
    const chunk = await reader.read();
    expect(new TextDecoder().decode(chunk.value)).toContain('notifications/tools/list_changed');
    await reader.cancel();

    const wrong = await servers.request(new Request(endpoint.url, { headers: { authorization: 'Bearer not-the-token' } }));
    expect(wrong?.status).toBe(401);
  });

  it('leaves the list to the next tools/list when it was asked for no stream', async () => {
    const { servers, endpoint } = serving(async () => answer('ran'), 'list');
    const { said } = await call(servers, endpoint, 'initialize');
    expect((said.result as { capabilities: unknown }).capabilities).toEqual({ tools: {} });

    const stream = await servers.request(new Request(endpoint.url, { headers: { authorization: `Bearer ${endpoint.token}` } }));
    expect(stream?.status).toBe(405);

    endpoint.setTools([tool('poke', 'poked')]);
    expect(await names(servers, endpoint)).toEqual(['poke']);
  });
});

describe('a client\'s answer, as MCP content', () => {
  it('mints one URI per embedded resource, so two in one answer do not collide', () => {
    expect(toMcpContent({
      ok: true,
      text: '',
      content: [
        { type: 'embeddedResource', data: 'AA==', contentType: 'application/pdf' },
        { type: 'embeddedResource', data: 'BB==', contentType: 'application/zip' },
      ],
    }, 'call-1')).toEqual([
      { type: 'resource', resource: { uri: 'ahp-tool-result:call-1/0', mimeType: 'application/pdf', blob: 'AA==' } },
      { type: 'resource', resource: { uri: 'ahp-tool-result:call-1/1', mimeType: 'application/zip', blob: 'BB==' } },
    ]);
  });

  it('puts a block it does not know in the text, where the model still reads it', () => {
    const odd = { type: 'terminal', terminalId: 't-1' } as unknown as OnWire<ToolResultContent>;
    expect(toMcpContent({ ok: true, text: '', content: [odd] }, 'call-1')).toEqual([
      { type: 'text', text: '{"type":"terminal","terminalId":"t-1"}' },
    ]);
  });

  it('falls back to the text when an answer carried no blocks at all', () => {
    // An answer is at least its text, and an empty MCP result would say
    // nothing about a tool that did something.
    expect(toMcpContent({ ok: true, text: 'done', content: [] }, 'call-1')).toEqual([{ type: 'text', text: 'done' }]);
  });
});
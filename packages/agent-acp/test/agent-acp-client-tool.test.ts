import { mkdtempSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { fileResources } from '../../sdk/src/resources.js';
import { toolServers } from '../../sdk/src/tools/server.js';
import { acpAgent } from '../src/index.js';
import { Status } from '@ahpd/sdk';
import type { Bag } from '@ahpd/sdk';
import type { ToolsEndpoint, ToolsServers } from '../../sdk/src/tools/server.js';
import type { Peer } from '../../sdk/src/types/rpc.js';

/*
 * A client's tool, called by an ACP agent through the host's own MCP server.
 *
 * Two things arrive for one call and neither names the other: the `tool_call`
 * the agent reports on the session, and the `tools/call` it makes over HTTP on
 * the endpoint the session was handed. This is the pairing between them, and
 * what the owning client's answer does to the request the agent is blocked on.
 *
 * The server is the scripted subprocess in `test/fixtures/acp-server.mjs`: its
 * `mrep=` reports a call the way an agent reports one, and its `mreq=` really
 * POSTs `tools/call` on that endpoint, so what is checked here is the round
 * trip and not a mock of it.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

function peer(): Peer & { notes: { method: string; params: unknown }[] } {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: async () => {},
  };
}

/** Let the subprocess's work finish, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean, times = 4000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

type Note = { channel: string; action: Record<string, unknown> };

const actions = (p: ReturnType<typeof peer>, channel: string): Note[] => p.notes
  .filter((n) => n.method === 'action')
  .map((n) => n.params as Note)
  .filter((e) => e.channel === channel);

const types = (p: ReturnType<typeof peer>, channel: string): string[] =>
  actions(p, channel).map((e) => String(e.action.type));

/** Everything the server said, as prose. */
const prose = (p: ReturnType<typeof peer>, chatUri: string): string => actions(p, chatUri)
  .filter((e) => e.action.type === 'chat/delta')
  .map((e) => String(e.action.content))
  .join('');

/**
 * What the agent was told for each request, in the order it made them.
 *
 * The fixture says one request's whole MCP result as one `mcp=` chunk, so this
 * is what the agent reads out of the tool call it is blocked on.
 */
const results = (p: ReturnType<typeof peer>, chatUri: string): { isError: boolean; content: Bag[] }[] =>
  [...prose(p, chatUri).matchAll(/mcp=(\S+)/g)]
    .map((one) => JSON.parse(decodeURIComponent(one[1] as string)) as { isError: boolean; content: Bag[] });

/** What the session is still asking a client to run, in the order it was raised. */
const asked = (p: ReturnType<typeof peer>, uri: string): Bag[] => {
  const open = new Map<string, Bag>();
  for (const one of actions(p, uri)) {
    if (one.action.type === 'session/inputNeededSet') {
      const request = one.action.request as Bag;
      if (request.kind === 'toolClientExecution') open.set(String(request.id), request);
    }
    if (one.action.type === 'session/inputNeededRemoved') open.delete(String(one.action.id));
  }
  return [...open.values()];
};

const ended = (p: ReturnType<typeof peer>, chatUri: string): boolean =>
  types(p, chatUri).some((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled');

/** The tool a client announces, as the protocol's `SessionActiveClient.tools` carries it. */
const OPEN_FILE = {
  name: 'openFile',
  title: 'Open a file',
  description: 'Open a file in the editor',
  inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
};

/** What the owning client says its tool did, in the shape `chat/toolCallComplete` carries. */
const OK = (text: string): Bag => ({ success: true, content: [{ type: 'text', text }] });

/** The sessions this file started, so each one's subprocess is stopped. */
const opened: { client: ReturnType<ReturnType<typeof createHost>['accept']>; uri: string }[] = [];

/** The listeners this file bound, so the port is given back. */
const listening: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const one of opened.splice(0)) {
    await one.client.handle({ method: 'disposeSession', params: { channel: one.uri } });
  }
  for (const stop of listening.splice(0)) await stop();
});

/**
 * A real listener in front of the host's tools endpoints.
 *
 * The daemon serves `ToolsServers.request` on its own port, and a session's
 * endpoint URL is an address on it. The fixture is a subprocess and reaches the
 * endpoint the way the daemon's own agents do - a real HTTP request - so the
 * one thing this test has to stand up is the listener, on a port of its own.
 *
 * It counts what lands as well, because that is the only thing that says a
 * request has been taken: from here the request is read, paired and waited on
 * without a single turn of the event loop, so a test that has seen it arrive is
 * a test that may answer the call it is for - and a test that has not is one
 * whose answer would beat the request and find nothing to pair with.
 */
const serve = async (servers: ToolsServers): Promise<{
  origin: string;
  arrived: () => number;
  answers: () => Bag[];
}> => {
  /** How many `tools/call`s have landed here, which is when one may be answered. */
  let arrived = 0;
  /**
   * What the endpoint has answered, in the order it answered.
   *
   * Kept here as well as reported on the chat, because a session disposed
   * mid-request has no channel left to report on: what the agent's own request
   * came back with is then only visible at the socket it came back on.
   */
  const answers: Bag[] = [];
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      // A node request always carries one; the empty one is a `GET`.
      const method = incoming.method ?? 'GET';
      if (method !== 'GET') arrived += 1;
      const port = (server.address() as AddressInfo).port;
      const request = new Request(`http://127.0.0.1:${port}${incoming.url ?? '/'}`, {
        method,
        headers: incoming.headers as Record<string, string>,
        ...(method === 'GET' ? {} : { body: Buffer.concat(chunks) }),
      });
      void servers.request(request).then(async (answer) => {
        if (answer === undefined) {
          outgoing.writeHead(404).end();
          return;
        }
        outgoing.writeHead(answer.status, Object.fromEntries(answer.headers));
        // Flushed before the body is read, because a stream's first chunk can be
        // a long way off: a client waiting for the response's head would
        // otherwise be waiting for the notification it opened the stream for.
        outgoing.flushHeaders();
        const body = answer.body?.getReader();
        if (body === undefined) {
          outgoing.end();
          return;
        }
        /*
         * Written as it comes rather than read whole.
         *
         * A `notify` session's `GET` is open until the session goes, so a
         * listener that waited for the end of that body would wait for the end
         * of the test.
         */
        const sent: Uint8Array[] = [];
        for (;;) {
          const chunk = await body.read();
          if (chunk.done) break;
          sent.push(chunk.value);
          outgoing.write(Buffer.from(chunk.value));
        }
        outgoing.end();
        const said = Buffer.concat(sent).toString('utf8');
        if (method !== 'GET' && said !== '') answers.push(JSON.parse(said) as Bag);
      }).catch(() => { outgoing.end(); });
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  listening.push(() => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }));
  return {
    origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    arrived: () => arrived,
    answers: () => answers,
  };
};

/** A connected client with one ACP session, watching both its channels. */
async function talking(given: { clientToolTimeoutMs?: number; toolsChanged?: 'notify' | 'list' } = {}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-client-tool-'));
  /*
   * The file the fixture reads between the reports and the requests.
   *
   * That read is a round trip on the server's own pipe, so its answer is proof
   * that every report the turn made has reached the bridge - which is what
   * keeps a request from being paired against a session that has not heard of
   * the calls yet.
   */
  writeFileSync(join(path, 'note.txt'), 'the note body');
  /*
   * The host's tools as an MCP server, which is what the session hands the
   * agent: the address is read when a session asks for an endpoint rather than
   * when the servers are built, so the listener is bound first and the variable
   * it reads is filled in after.
   */
  let origin = '';
  const raw = toolServers({ origin: () => origin, name: 'ahpd', version: 'test' });
  /**
   * Every endpoint a session opened, so a test can talk to it as its agent does.
   *
   * The endpoint is the session's own, handed to the agent inside `session/new`
   * and nowhere else, so this is the only way a test reads the list the agent is
   * being served or holds the stream a change goes down.
   */
  const endpoints: ToolsEndpoint[] = [];
  const servers: ToolsServers = {
    ...raw,
    open: (tools, runClient, toolsChanged) => {
      const endpoint = raw.open(tools, runClient, toolsChanged);
      if (endpoint !== undefined) endpoints.push(endpoint);
      return endpoint;
    },
  };
  const bound = await serve(servers);
  origin = bound.origin;
  const host = createHost({
    path,
    agents: [acpAgent({
      command: process.execPath,
      args: [FIXTURE],
      provider: 'acp',
      // These cases are about a client's tools, not the folder, so the agent
      // says it asks about trust on its own and the host does not refuse it.
      honoursTrust: true,
      ...(given.toolsChanged === undefined ? {} : { toolsChanged: given.toolsChanged }),
    })],
    resources: fileResources(),
    toolsServers: servers,
    ...(given.clientToolTimeoutMs === undefined ? {} : { clientToolTimeoutMs: given.clientToolTimeoutMs }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  const uri = 'ahp-session:/client-tool';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'acp', workingDirectories: [`file://${path}`] },
  });
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  return {
    host,
    client,
    peer: p,
    uri,
    chatUri,
    path,
    endpoints,
    arrived: bound.arrived,
    answers: bound.answers,
  };
}

/**
 * A second client in the session, saying it can run these tools.
 *
 * Presence is what carries them: `session/activeClientSet` is the one way a
 * client announces what it provides, and the host forces the id to this
 * connection's own, which is what makes the tool `a__openFile` on the list the
 * session offers.
 */
async function joining(
  host: ReturnType<typeof createHost>,
  uri: string,
  chatUri: string,
  id: string,
  tools: unknown[] = [OPEN_FILE],
) {
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { channel: 'ahp-root://', clientId: id, protocolVersions: ['0.9.0'] },
  });
  await client.handle({ method: 'subscribe', params: { channel: uri } });
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  await client.handle({
    method: 'dispatchAction',
    params: { channel: uri, action: { type: 'session/activeClientSet', activeClient: { name: id, tools } } },
  });
  return { client, peer: p };
}

type Client = Awaited<ReturnType<typeof talking>>['client'];

/** The action a turn began with, dispatched the way a client dispatches it. */
const begin = (client: Client, chatUri: string, turnId: string, text: string): void => {
  void client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId, message: { text } } },
  });
};

/** A client's own word on the call it ran, dispatched the way the protocol says. */
const complete = (client: Client, chatUri: string, toolCallId: string, result: Bag): Promise<unknown> =>
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/toolCallComplete', toolCallId, result } },
  });

/** The text of each MCP result the agent was told, which is what a client said. */
const said = (p: ReturnType<typeof peer>, chatUri: string): unknown[] =>
  results(p, chatUri).map((one) => one.content[0]?.text);

/**
 * Wait for something that is only answered by asking, up to a point.
 *
 * Fewer turns than `until` takes, because every one of these is a request on a
 * socket rather than a look at an array.
 */
const settled = async (check: () => Promise<boolean>, times = 500): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (await check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
};

/** The endpoint a session's first turn opened, which is the one its agent was handed. */
const endpointOf = async (endpoints: ToolsEndpoint[]): Promise<ToolsEndpoint> => {
  await until(() => endpoints.length > 0);
  const one = endpoints[0];
  if (one === undefined) throw new Error('no turn opened a tools endpoint');
  return one;
};

/** One message sent to a session's endpoint, as the agent that was handed it sends one. */
const call = async (endpoint: ToolsEndpoint, message: Bag): Promise<Bag> => {
  const answer = await fetch(endpoint.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${endpoint.token}` },
    body: JSON.stringify(message),
  });
  return await answer.json() as Bag;
};

/** The names on the list that endpoint is serving now. */
const listed = async (endpoint: ToolsEndpoint): Promise<string[]> => {
  const answer = await call(endpoint, { jsonrpc: '2.0', id: 1, method: 'tools/list' });
  return ((answer.result as { tools: { name: string }[] }).tools).map((one) => one.name);
};

/**
 * The stream a `notify` endpoint sends its list changes down, read as it comes.
 *
 * A `GET` held open, which is what an agent that watches for a change holds:
 * the only thing this server ever says on one is that the list moved, so a chunk
 * read here is one notification. `fetch` answers once the response's head is in,
 * which is after the endpoint took the stream, so a change made after this has
 * answered is a change this stream is told about.
 */
const watching = async (endpoint: ToolsEndpoint): Promise<() => Promise<string>> => {
  const answer = await fetch(endpoint.url, { headers: { authorization: `Bearer ${endpoint.token}` } });
  const reader = answer.body?.getReader();
  const decoder = new TextDecoder();
  return async () => {
    const chunk = await reader?.read();
    return chunk === undefined || chunk.done ? '' : decoder.decode(chunk.value);
  };
};

/**
 * Take a session down the way a client does.
 *
 * Out of this file's own list as well, because a session is disposed once: the
 * second time is a session this host has never heard of, and that is what the
 * cleanup at the end of every case would be told.
 */
const dispose = async (client: Client, uri: string): Promise<void> => {
  const at = opened.findIndex((one) => one.uri === uri);
  if (at >= 0) opened.splice(at, 1);
  await client.handle({ method: 'disposeSession', params: { channel: uri } });
};

/**
 * A session whose agent was handed the endpoint with no client in it, and what
 * that agent reads when the client arrives afterwards.
 *
 * The list is what the session may offer at the moment the endpoint is opened,
 * so a client that announces later is the case a fixed list never covers.
 */
const arrivedLater = async (toolsChanged?: 'notify' | 'list'): Promise<string[]> => {
  const { host, client, uri, chatUri, endpoints } = await talking(
    toolsChanged === undefined ? {} : { toolsChanged },
  );
  begin(client, chatUri, 't1', 'hello there');
  const endpoint = await endpointOf(endpoints);
  // Nothing of a client's is on the list the agent was handed: at that moment
  // there was no client in the session.
  expect(await listed(endpoint)).not.toContain('a__openFile');

  await joining(host, uri, chatUri, 'a');
  await settled(async () => (await listed(endpoint)).includes('a__openFile'));
  return await listed(endpoint);
};

/** What a `notify` session's open stream is told when a client announces a tool. */
const notified = async (toolsChanged?: 'notify' | 'list'): Promise<string> => {
  const { host, client, uri, chatUri, endpoints } = await talking(
    toolsChanged === undefined ? {} : { toolsChanged },
  );
  begin(client, chatUri, 't1', 'hello there');
  const endpoint = await endpointOf(endpoints);
  // Opened before the client arrives, because a stream that is not there when
  // the list moves is a stream that is told nothing.
  const next = await watching(endpoint);

  await joining(host, uri, chatUri, 'a');
  return await next();
};

it("answers the agent's request with what the owning client said", async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);

  await complete(a.client, chatUri, 'call-1', OK('opened /a.txt'));
  await until(() => ended(p, chatUri));

  // The request the agent is blocked on is answered with the client's own
  // words, and the row the agent reported is closed by the agent's own update.
  expect(results(p, chatUri)).toEqual([
    { isError: false, content: [{ type: 'text', text: 'opened /a.txt' }] },
  ]);
  expect(types(p, chatUri).filter((type) => type.startsWith('chat/toolCall')))
    .toEqual(['chat/toolCallStart', 'chat/toolCallReady', 'chat/toolCallComplete']);
  // And the entry the client was asked through is gone, not left open.
  expect(asked(p, uri)).toEqual([]);
});

it('pairs two calls of one tool by their arguments', async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  /*
   * Two calls with different arguments, and the requests made in the other
   * order: an agent that names no call on its request has only the arguments
   * to say which of the two it is making.
   */
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mrep=call-2=a__openFile={"path":"/b.txt"}'
    + ' mreq=a__openFile={"path":"/b.txt"}=- mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);
  await complete(a.client, chatUri, 'call-2', OK('the b file'));
  await until(() => arrived() === 2);
  await complete(a.client, chatUri, 'call-1', OK('the a file'));
  await until(() => ended(p, chatUri));

  expect(said(p, chatUri)).toEqual(['the b file', 'the a file']);
});

it('pairs two identical calls with no id by the oldest still open', async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  // Two calls of one tool with the same arguments and no id on either request:
  // the oldest is the only thing left to pair by, and the one it answered is
  // no longer open for the request after it.
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mrep=call-2=a__openFile={"path":"/a.txt"}'
    + ' mreq=a__openFile={"path":"/a.txt"}=- mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);
  await complete(a.client, chatUri, 'call-1', OK('first'));
  await until(() => arrived() === 2);
  await complete(a.client, chatUri, 'call-2', OK('second'));
  await until(() => ended(p, chatUri));

  expect(said(p, chatUri)).toEqual(['first', 'second']);
});

it('refuses a request that two open calls could be for', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking();
  await joining(host, uri, chatUri, 'a');
  /*
   * Two calls of one tool, neither reported with its arguments, and two
   * requests that name no call.
   *
   * Nothing says which call either request is for, so neither is answered with
   * a call's content: an agent handed the wrong one would read it as the answer
   * to the call it meant, which is still open and would wait for ever.
   */
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile=- mrep=call-2=a__openFile=-'
    + ' mreq=a__openFile={"path":"/a.txt"}=- mreq=a__openFile={"path":"/b.txt"}=-',
  );
  await until(() => ended(p, chatUri));

  const ambiguous = '2 calls of a__openFile are open and the request names no call;'
    + ' nothing says which one this is for';
  expect(results(p, chatUri)).toEqual([
    { isError: true, content: [{ type: 'text', text: ambiguous }] },
    { isError: true, content: [{ type: 'text', text: ambiguous }] },
  ]);
  // Both rows are left open, waiting for the client that can really run them.
  expect(asked(p, uri).map((request) => String((request.toolCall as Bag).toolCallId)))
    .toEqual(['call-1', 'call-2']);
});

it('pairs by the id the request carries, over the oldest open call', async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  // The same two calls, and the first request names the newer one: the id is
  // what tells two identical concurrent calls apart, so the answer it waits on
  // is the newer call's and not the oldest's.
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mrep=call-2=a__openFile={"path":"/a.txt"}'
    + ' mreq=a__openFile={"path":"/a.txt"}=call-2 mreq=a__openFile={"path":"/a.txt"}=call-1',
  );
  await until(() => arrived() === 1);
  await complete(a.client, chatUri, 'call-2', OK('the newer'));
  await until(() => arrived() === 2);
  await complete(a.client, chatUri, 'call-1', OK('the older'));
  await until(() => ended(p, chatUri));

  expect(said(p, chatUri)).toEqual(['the newer', 'the older']);
});

it("refuses another client's answer and keeps waiting for the owner's", async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  const b = await joining(host, uri, chatUri, 'b');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);

  await complete(b.client, chatUri, 'call-1', OK('not mine'));
  await until(() => b.peer.notes.some((n) => n.method === 'action'
    && typeof (n.params as { rejectionReason?: unknown }).rejectionReason === 'string'));
  // The refusal names the call and the client, and nothing moved: the entry is
  // still open and the agent is still waiting on it.
  expect(b.peer.notes.map((n) => (n.params as { rejectionReason?: string }).rejectionReason))
    .toContain('call-1 is not a call b is running here');
  expect(asked(p, uri)).toHaveLength(1);
  expect(results(p, chatUri)).toEqual([]);

  await complete(a.client, chatUri, 'call-1', OK('opened /a.txt'));
  await until(() => ended(p, chatUri));
  expect(said(p, chatUri)).toEqual(['opened /a.txt']);
});

it('answers the request with isError when the owning client goes', async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);

  // Out of the session entirely: nothing this client watches still resolves to
  // it, which is one of the three ways the protocol says a client leaves.
  await a.client.handle({ method: 'unsubscribe', params: { channel: uri } });
  await a.client.handle({ method: 'unsubscribe', params: { channel: chatUri } });
  await until(() => ended(p, chatUri));

  // The agent is told the call failed rather than left blocked on a client
  // that is not there: nobody else provides the tool, so there is no hint.
  expect(results(p, chatUri)).toEqual([{
    isError: true,
    content: [{ type: 'text', text: 'The client a that was running openFile is no longer here' }],
  }]);
});

it('answers the request with isError when nobody answers in time', async () => {
  const { host, client, peer: p, uri, chatUri } = await talking({ clientToolTimeoutMs: 1000 });
  await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => ended(p, chatUri), 8000);

  expect(results(p, chatUri)).toEqual([{
    isError: true,
    content: [{ type: 'text', text: 'openFile got no answer from a in 1 s' }],
  }]);
});

it('opens a row of its own for a request the agent never reported', async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  begin(client, chatUri, 't1', 'client tool mreq=a__openFile={"path":"/a.txt"}=-');
  await until(() => arrived() === 1);

  /*
   * Nothing reported this call, and the agent is blocked on it all the same:
   * the call is held and asked for, and drawn on the chat with the client on
   * its start, because a client watching the chat rather than the session has
   * to see the call it is being asked about.
   */
  const start = actions(p, chatUri).find((e) => e.action.type === 'chat/toolCallStart');
  expect(start?.action).toMatchObject({
    toolCallId: 'ahp-mcp-1',
    toolName: 'a__openFile',
    contributor: { kind: 'client', clientId: 'a' },
  });
  // The entry names the tool the client announced, not the one the agent was
  // offered - the same name every sentence about the call uses.
  expect(asked(p, uri).map((request) => (request.toolCall as Bag).toolName)).toEqual(['openFile']);

  await complete(a.client, chatUri, 'ahp-mcp-1', OK('opened /a.txt'));
  await until(() => ended(p, chatUri));
  expect(results(p, chatUri)).toEqual([
    { isError: false, content: [{ type: 'text', text: 'opened /a.txt' }] },
  ]);
});

it("answers with the client's blocks as the MCP content an agent reads", async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);

  await complete(a.client, chatUri, 'call-1', {
    success: true,
    content: [
      { type: 'text', text: 'the shot' },
      { type: 'embeddedResource', data: 'iVBORw0KGgo=', contentType: 'image/png' },
    ],
  });
  await until(() => ended(p, chatUri));

  // The client's own blocks, in the order it sent them: a sentence and the
  // image itself, which an agent takes as an image rather than as a path.
  expect(results(p, chatUri)).toEqual([{
    isError: false,
    content: [
      { type: 'text', text: 'the shot' },
      { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' },
    ],
  }]);
});

it('offers a client that arrived after the session opened, under notify', async () => {
  expect(await arrivedLater('notify')).toContain('a__openFile');
});

it('offers it under list too, where the agent finds it on its next tools/list', async () => {
  // The same change reaches a `list` agent the same way and is heard about
  // differently: the list is the same either way, and only the telling differs.
  expect(await arrivedLater('list')).toContain('a__openFile');
});

it('tells a listening agent that the list moved, under notify', async () => {
  expect(await notified('notify')).toContain('notifications/tools/list_changed');
});

it('tells it the same when the option is not set, which is the default', async () => {
  expect(await notified()).toContain('notifications/tools/list_changed');
});

it('opens no stream under list, and leaves the change to the next tools/list', async () => {
  const { host, client, uri, chatUri, endpoints } = await talking({ toolsChanged: 'list' });
  begin(client, chatUri, 't1', 'hello there');
  const endpoint = await endpointOf(endpoints);

  // The one thing a notification could be sent down is the stream, and this
  // session's endpoint refuses one - which is the whole of what `list` means.
  expect((await fetch(endpoint.url, { headers: { authorization: `Bearer ${endpoint.token}` } })).status).toBe(405);

  await joining(host, uri, chatUri, 'a');
  expect((await fetch(endpoint.url, { headers: { authorization: `Bearer ${endpoint.token}` } })).status).toBe(405);
  // And the change is there all the same: what an agent that re-lists misses is
  // the telling, not the tool.
  expect(await listed(endpoint)).toContain('a__openFile');
});

it("takes a departed client's tool off the list as well as failing its call", async () => {
  const { host, client, peer: p, uri, chatUri, endpoints, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  const endpoint = await endpointOf(endpoints);
  await until(() => arrived() === 1);
  expect(await listed(endpoint)).toContain('a__openFile');

  // Out of the session entirely, which is the departure the host retools on.
  await a.client.handle({ method: 'unsubscribe', params: { channel: uri } });
  await a.client.handle({ method: 'unsubscribe', params: { channel: chatUri } });
  await until(() => ended(p, chatUri));

  // The agent is not offered a tool nobody provides any more, and the call it
  // was blocked on is answered rather than left waiting for the client.
  await settled(async () => !(await listed(endpoint)).includes('a__openFile'));
  expect(await listed(endpoint)).not.toContain('a__openFile');
  expect(results(p, chatUri)).toEqual([{
    isError: true,
    content: [{ type: 'text', text: 'The client a that was running openFile is no longer here' }],
  }]);
});

it('shows the call it is waiting on in its state, and the turn stays in progress', async () => {
  const { host, client, uri, chatUri, arrived } = await talking();
  const a = await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);

  // A client connecting now is drawn the request from the state and not only
  // from the actions it missed.
  const snapshot = (await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { status: number; inputNeeded: Bag[] } };
  };
  expect(snapshot.snapshot.state.inputNeeded).toHaveLength(1);
  expect(snapshot.snapshot.state.inputNeeded[0]).toMatchObject({
    kind: 'toolClientExecution',
    clientId: 'a',
    toolCall: { toolName: 'openFile', status: 'running' },
  });
  // A superset of in progress rather than a status of its own: the turn this
  // call belongs to is still running, and that is what the session says it is.
  expect(snapshot.snapshot.state.status).toBe(Status.InProgress);

  await complete(a.client, chatUri, 'call-1', OK('opened /a.txt'));
  // And it is off the state once it has been answered.
  const after = (await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { inputNeeded?: Bag[] } };
  };
  expect(after.snapshot.state.inputNeeded).toBeUndefined();
});

it('lets go of a call a client is running when the turn is stopped', async () => {
  const { host, client, peer: p, uri, chatUri, arrived } = await talking();
  await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);

  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnCancelled', turnId: 't1', duration: 0 } },
  });
  await until(() => results(p, chatUri).length === 1);

  // A stopped turn is not a turn that goes on waiting: the client is not asked
  // any more, and the agent is told so rather than held on a call nobody owns.
  expect(results(p, chatUri)).toEqual([{
    isError: true,
    content: [{ type: 'text', text: 'The turn was stopped' }],
  }]);
  expect(asked(p, uri)).toEqual([]);
});

it('lets go of one when the session is closed', async () => {
  const { host, client, uri, chatUri, arrived, answers } = await talking();
  await joining(host, uri, chatUri, 'a');
  begin(
    client,
    chatUri,
    't1',
    'client tool mrep=call-1=a__openFile={"path":"/a.txt"} mreq=a__openFile={"path":"/a.txt"}=-',
  );
  await until(() => arrived() === 1);

  await dispose(client, uri);
  await until(() => answers().length === 1);

  // Read at the endpoint rather than on the chat, because the session that
  // answered is going: what it said to the agent is the answer it wrote, and
  // the channel it would have reported on is being torn down beside it.
  expect(answers()[0]).toMatchObject({
    result: { isError: true, content: [{ type: 'text', text: 'The session was closed' }] },
  });
});

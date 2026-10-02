/**
 * The host's own tools, served to a backend as an MCP server over HTTP.
 *
 * A backend that cannot call the host's tools in-process - an ACP agent, which
 * asks its client for them - needs them as a server rather than as a field, and
 * this is that server: JSON-RPC written by hand, over streamable HTTP, on the
 * daemon's own listener rather than a port of its own.
 *
 * One path and one bearer token per session, and nothing else answers. A token
 * names one path and no other, so a session holding a token can reach its own
 * tools and not a neighbour's, and the path stops answering when the session
 * does.
 *
 * Enough of the 2025-06-18 transport for a client that initializes, lists and
 * calls: one message per request, a JSON answer, and no server-to-client
 * stream - there is nothing this server initiates. A `GET` is refused rather
 * than held open, which the transport allows for a server with no stream.
 */

import { timingSafeEqual } from 'node:crypto';
import type { BoundTool } from './types/agent.js';

/** Where these endpoints are served, on the host's own listener. */
export const TOOLS_PREFIX = '/ahp-mcp';

/** The revision of the transport this server speaks. */
const PROTOCOL = '2025-06-18';

/** One session's endpoint, as a backend is handed it. */
export interface ToolsEndpoint {
  /** Where the server is, absolute, on the host's own listener. */
  readonly url: string;
  /** The bearer token every call on it must present. */
  readonly token: string;
  /** Take it back, so the path stops answering. */
  close(): void;
}

/** What a `ToolsServers` was built from. */
export interface ToolsServerOptions {
  /**
   * Where the host's listener is, read when an endpoint opens rather than
   * held: the host is built before the port is bound.
   *
   * Undefined is a host with nothing to serve on - a daemon over stdio, or one
   * still binding - and an endpoint that cannot be opened at all.
   */
  origin(): string | undefined;
  /** What this server is called in `initialize`. */
  name?: string;
  /** Its version, likewise. */
  version?: string;
}

/**
 * Every tools endpoint this host is serving.
 *
 * The `request` is what a listener mounts beside its own answers: it takes the
 * paths under {@link TOOLS_PREFIX} and answers `undefined` for anything else,
 * so a host that serves an API of its own is a host that tries one and then the
 * other.
 */
export interface ToolsServers {
  /** Open an endpoint serving these tools, under a path and a token of its own. */
  open(tools: BoundTool[]): ToolsEndpoint | undefined;
  /** Answer a request for one of the endpoints open here, or nothing for a path that is not one. */
  request(request: Request): Promise<Response | undefined>;
}

/** A JSON-RPC message as it arrives, which is checked before it is read. */
interface Message {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

/** One tool as `tools/list` answers it. */
const listed = (one: BoundTool): Record<string, unknown> => ({
  name: one.definition.name,
  ...(one.definition.description === undefined ? {} : { description: one.definition.description }),
  // MCP requires a schema and this host's is optional, because a client's tool
  // may not have one.
  inputSchema: one.definition.inputSchema ?? { type: 'object', properties: {} },
});

/** One result, in the shape a JSON-RPC answer takes. */
const result = (id: unknown, value: unknown): Record<string, unknown> => ({ jsonrpc: '2.0', id: id ?? null, result: value });

/** One failure, in the shape a JSON-RPC answer takes. */
const failure = (id: unknown, code: number, message: string): Record<string, unknown> => ({
  jsonrpc: '2.0',
  id: id ?? null,
  error: { code, message },
});

/** A JSON body, which is what every answer here is. */
const json = (status: number, value: unknown): Response =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

/** What one message asked for, answered against these tools. */
const answered = async (tools: BoundTool[], said: Message, info: { name: string; version: string }): Promise<Record<string, unknown>> => {
  const params = (said.params ?? {}) as { name?: unknown; arguments?: unknown };
  if (said.method === 'initialize') {
    return result(said.id, { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: info });
  }
  if (said.method === 'tools/list') return result(said.id, { tools: tools.map(listed) });
  if (said.method !== 'tools/call') return failure(said.id, -32601, `This server answers initialize, tools/list and tools/call, not ${String(said.method)}`);
  const found = tools.find((one) => one.definition.name === String(params.name));
  if (found === undefined) return failure(said.id, -32602, `No tool named ${String(params.name)}`);
  if (found.run === undefined) return failure(said.id, -32602, `${String(params.name)} is a client's tool, which this server cannot run`);
  /*
   * A tool that throws is a failed call and not a failed request: the model is
   * the one that has to be told, so the sentence goes in the content with
   * `isError` rather than in a JSON-RPC error the client would surface to
   * somebody who did not write the tool.
   */
  try {
    const text = await found.run((params.arguments ?? {}) as Record<string, unknown>);
    return result(said.id, { content: [{ type: 'text', text }] });
  }
  catch (error: unknown) {
    return result(said.id, {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    });
  }
};

/**
 * Whether a header carries the token it is checked against.
 *
 * Compared without stopping at the first difference, over buffers of one
 * length: a token is a secret, and a comparison that says how far it got is a
 * way of finding out the one that was right. The length still differs
 * observably, which is why a token is generated rather than chosen.
 */
const bearer = (header: string | null, token: string): boolean => {
  const given = Buffer.from(header ?? '', 'utf8');
  const said = Buffer.from(`Bearer ${token}`, 'utf8');
  return given.length === said.length && timingSafeEqual(given, said);
};

/**
 * The endpoints of one host, and the handler a listener mounts to serve them.
 *
 * Nothing here is started: the host asks for an endpoint per session and takes
 * it back when the session ends, and the listener is asked for the path either
 * way.
 */
export const toolServers = (options: ToolsServerOptions): ToolsServers => {
  /** What each path serves, by path. An entry is one live session's tools. */
  const serving = new Map<string, { token: string; tools: BoundTool[] }>();
  const info = { name: options.name ?? 'ahpd', version: options.version ?? '0' };

  return {
    open: (tools) => {
      const origin = options.origin();
      if (origin === undefined) return undefined;
      const path = `${TOOLS_PREFIX}/${crypto.randomUUID()}`;
      const token = crypto.randomUUID();
      serving.set(path, { token, tools });
      return {
        url: `${origin.replace(/\/$/, '')}${path}`,
        token,
        close: () => { serving.delete(path); },
      };
    },
    request: async (request) => {
      const path = new URL(request.url).pathname;
      const found = serving.get(path);
      if (found === undefined) {
        // A path of ours nobody is serving: a session that has ended, or one
        // that never existed. Anything else is whoever answers it next.
        return path === TOOLS_PREFIX || path.startsWith(`${TOOLS_PREFIX}/`)
          ? json(404, failure(null, -32001, `No tools server at ${path}`))
          : undefined;
      }
      /*
       * The token before the method and before the body, so a caller with the
       * wrong one is told nothing about what it would have reached.
       */
      if (!bearer(request.headers.get('authorization'), found.token)) {
        return json(401, failure(null, -32001, 'This tools server answers only its own session\'s token'));
      }
      if (request.method === 'GET') {
        return json(405, failure(null, -32000, 'This tools server opens no stream; a call is a POST of one message'));
      }
      if (request.method !== 'POST') {
        return json(405, failure(null, -32000, `This tools server answers POST, not ${request.method}`));
      }
      let said: Message;
      try {
        said = await request.json() as Message;
      }
      catch {
        return json(400, failure(null, -32700, 'A call to this tools server is one JSON-RPC message'));
      }
      if (typeof said !== 'object' || said === null || Array.isArray(said)) {
        return json(400, failure(null, -32600, 'A call to this tools server is one JSON-RPC message, not a batch'));
      }
      // A notification is answered with the fact that it was heard, which is
      // `notifications/initialized` and nothing else this server expects.
      if (said.id === undefined) return new Response(null, { status: 202 });
      return json(200, await answered(found.tools, said, info));
    },
  };
};
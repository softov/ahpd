/**
 * The host's own tools, for a person's MCP client, at `/mcp`.
 *
 * A session's backend is handed its tools at `/ahp-mcp/<uuid>`, under a token
 * only that session holds. This is the other door: a person points VS Code,
 * Claude Code or any MCP client at the host with their own token, and lists and
 * runs the tools that need no session - the session tools, first of all, so a
 * client can see the sessions here and start one without being one.
 *
 * It offers what the host says a caller may run with no session behind the
 * call, which is `sessionlessTools`: a tool says `sessionless: true`, and its
 * grant decides whether this caller is offered it. The grant on the door is
 * `mcp:call`, and a team's key cannot hold it - a team key opens the proxy and
 * nothing else.
 *
 * Nothing is kept between requests. Every one names its caller again, so a
 * token taken away stops the next call, and the list a person sees is the list
 * their grants allow at that moment. No stream is opened: a client finds a
 * changed list on its next `tools/list`.
 */

import type { RequestHandler } from '@cofold/remote';
import { answerTools, type BoundTool, type ToolCaller } from '@ahpd/sdk';
import { guarded, isUnder, json } from './http.js';
import { callerOf, type CallerOptions } from './proxy/caller.js';

/** The path the host's tools are served to a person under, beside `/v1`. */
export const MCP_PREFIX = '/mcp';

/** What `/mcp` serves, as the daemon's `mcpTools` key says it. */
export type McpTools = 'none' | 'all';

/** What the door is built from. */
export interface McpOptions {
  /** What `/mcp` serves: nothing, the default, or every sessionless tool the caller's grants allow. */
  setting: McpTools;
  /**
   * The deployment's own token and the people who may call.
   *
   * No `whose`, deliberately: a session's token has its own endpoint, and a
   * token this host cannot place is told to sign in rather than answered with
   * the tools a person holds.
   */
  caller: CallerOptions;
  /** The tools a caller may run with no session, read for each request. */
  tools(caller: ToolCaller): BoundTool[];
  /** What answers a path that is not `/mcp`: the proxy, and then the API. */
  otherwise(request: Request): Promise<Response>;
  /** What `initialize` answers as this server's version. */
  version: string;
}

/** One refusal, in the shape an MCP client reads: a JSON-RPC error rather than a message. */
const refused = (status: number, message: string): Response =>
  json(status, { jsonrpc: '2.0', id: null, error: { code: -32001, message } });

/**
 * The door at `/mcp`.
 *
 * A request that is not `/mcp` is handed on untouched, so this sits in front of
 * the proxy and the API as one more mount rather than a replacement for them.
 * Everything `/mcp` answers is decided per request: the setting first, because
 * a door that is off exists for nobody, and then the caller, before the body is
 * read - a caller refused the door learns nothing about the tools behind it.
 */
export function mcpHandler(options: McpOptions): RequestHandler {
  return guarded(async (request, path) => {
    if (!isUnder(path, MCP_PREFIX)) return options.otherwise(request);
    if (options.setting !== 'all') return refused(404, `No MCP server at ${path}`);
    const called = await callerOf(request, options.caller, 'mcp:call');
    if ('refusal' in called) return refused(called.refusal.status, called.refusal.message);
    /*
     * A session has an endpoint of its own, which is where its tools live. One
     * reaching here is a caller options mistake as much as a caller's: the door
     * is a person's, and it says so instead of serving a session's list.
     */
    if (called.caller.kind === 'session') {
      return refused(401, 'A session\'s token is served at its own tools endpoint; /mcp answers a person');
    }
    if (called.caller.kind === 'root') {
      return answerTools(request, { tools: options.tools({ root: true }), toolsChanged: 'list' }, { name: 'ahpd', version: options.version });
    }
    return answerTools(request, {
      tools: options.tools({ principal: called.caller.principal }),
      toolsChanged: 'list',
    }, { name: 'ahpd', version: options.version });
  });
}

/*
 * The door at `/mcp`: the setting, the caller and the tools a caller is offered.
 *
 * A person's MCP client is outside the host, so what it may do is decided here
 * rather than in a session: the deployment's setting says whether the door
 * exists, the grant on it says who may knock, and each tool's own grant decides
 * what the answer lists. The host is real - a sessionless tool is bound to a
 * caller - and the client is a JSON-RPC message written by hand, which is what
 * an MCP client sends.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createHost, doorOf, fileUsers, hostTools, type RequestHandler, type Users } from '@ahpd/sdk';
import { echo } from '../../../examples/echo/agent.js';
import { mcpHandler, type McpTools } from '../src/mcp.js';
import { withoutApi } from '../src/http.js';

/** The deployment's own token, which these cases never send anywhere but here. */
const ROOT_TOKEN = 'deployment-token-for-the-mcp-tests';

/** A made-up name a client is pointed at, never a machine anybody runs. */
const ORIGIN = 'https://ahpd.example.com';

/** The name a session's token would take, for the case that it is refused. */
const SESSION_TOKEN = 'session-token-4f0c1a';

let home: string;
let users: Users;
let host: ReturnType<typeof createHost>;
let ana: string;
let gus: string;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'ahpd-mcp-'));
  users = fileUsers({ path: join(home, 'users.json') });
  await users.addTeam('backend');
  await users.add('ana', ['member'], { memberships: ['backend'], primary: 'backend' });
  // A role that reads sessions and may knock, and no more.
  await users.addRole('viewer', ['session:read', 'mcp:call']);
  await users.add('gus', ['viewer'], { memberships: ['backend'], primary: 'backend' });
  ana = await users.mint('ana');
  gus = await users.mint('gus');
  host = serving();
});

/** The host these cases call into, with the operator's per-tool rule where a case sets one. */
const serving = (eligibleForAutoApproval?: Record<string, boolean>): ReturnType<typeof createHost> => createHost({
  path: home,
  agents: [{ ...echo({ path: home, pace: 0 }), provider: 'base' }],
  users,
  tools: hostTools(),
  ...(eligibleForAutoApproval === undefined ? {} : { eligibleForAutoApproval }),
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

/** The door, over the host above, with `otherwise` answering a sentence of its own. */
const door = (setting: McpTools = 'all', token = ROOT_TOKEN, whose?: (given: string) => { session: string } | undefined): RequestHandler =>
  mcpHandler({
    setting,
    caller: { token, users, ...(whose === undefined ? {} : { whose }) },
    tools: (caller) => host.sessionlessTools(caller),
    otherwise: async () => new Response('not /mcp', { status: 418 }),
    version: '9.9.9',
  });

/** One JSON-RPC message, posted to `/mcp` with `token`. */
const ask = async (
  handler: RequestHandler,
  method: string,
  params?: unknown,
  token?: string,
): Promise<{ status: number; said: Record<string, unknown> }> => {
  const answered = await handler(new Request(`${ORIGIN}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, ...(params === undefined ? {} : { params }) }),
  }));
  return { status: answered.status, said: await answered.json() as Record<string, unknown> };
};

/** The names `tools/list` answered. */
const listed = (said: Record<string, unknown>): string[] =>
  ((said.result as { tools: { name: string }[] }).tools).map((one) => one.name);

/** One tool call, as the model would have asked for it. */
const call = (handler: RequestHandler, name: string, args: Record<string, unknown>, token: string) =>
  ask(handler, 'tools/call', { name, arguments: args }, token);

const ELEVEN = ['list_sessions', 'list_agents', 'list_models', 'create_session', 'create_chat', 'rename_chat', 'archive_chat', 'send_message', 'get_session_context', 'delete_session', 'move_session'];

describe('/mcp is off unless the deployment turns it on', () => {
  it('answers 404 for every request while mcpTools is none', async () => {
    const off = door('none');
    for (const token of [undefined, ana, ROOT_TOKEN]) {
      const answered = await ask(off, 'tools/list', undefined, token);
      expect(answered.status).toBe(404);
      expect((answered.said.error as { message: string }).message).toContain('No MCP server');
    }
  });

  it('leaves a path that is not /mcp to the handler behind it', async () => {
    const answered = await door()(new Request(`${ORIGIN}/v1/models`));
    expect(answered.status).toBe(418);
    expect(await answered.text()).toBe('not /mcp');
  });

  it('is not mounted at all with the HTTP API off', async () => {
    const nowhere = await withoutApi(doorOf({}))(new Request(`${ORIGIN}/mcp`));
    expect(nowhere.status).toBe(404);
    expect((await nowhere.json() as { message: string }).message).toBe('No API at /mcp');
  });

  it('is handed to the HTTP API when it is on, beside /api and /v1', async () => {
    const api = async (asked: Request): Promise<Response> => new Response(new URL(asked.url).pathname);
    const handler = withoutApi(doorOf({}), api);
    for (const path of ['/api/user/list', '/v1/models', '/mcp']) {
      expect(await (await handler(new Request(`${ORIGIN}${path}`))).text()).toBe(path);
    }
  });
});

describe('/mcp serves the sessionless tools a caller may run', () => {
  it('answers initialize with what it is, and no stream', async () => {
    const { status, said } = await ask(door(), 'initialize', undefined, ana);
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
    expect((await door()(new Request(`${ORIGIN}/mcp`, { headers: { authorization: `Bearer ${ana}` } }))).status).toBe(405);
  });

  it('lists the eleven session tools for a member', async () => {
    expect(listed((await ask(door(), 'tools/list', undefined, ana)).said)).toEqual(ELEVEN);
  });

  it('lists a viewer the four it may read', async () => {
    expect(listed((await ask(door(), 'tools/list', undefined, gus)).said)).toEqual(['list_sessions', 'list_agents', 'list_models', 'get_session_context']);
  });

  it('runs create_session for a member, and the session it makes is the caller\'s', async () => {
    const answered = await call(door(), 'create_session', {
      relationship: 'independent',
      prompt: 'Say hello.',
      title: 'A session from a client',
      workspace: home,
      worktree: false,
    }, ana);
    const content = (answered.said.result as { content: { text: string }[]; isError?: boolean }).content;
    expect((answered.said.result as { isError?: boolean }).isError).toBeFalsy();
    expect(content[0]?.text).toContain('New session created');
    const rows = listed((await ask(door(), 'tools/list', undefined, ana)).said);
    expect(rows).toContain('create_session');
  });

  it('refuses a viewer\'s create_session, which is not a tool it is offered', async () => {
    const answered = await call(door(), 'create_session', {
      relationship: 'independent', prompt: 'Say hello.', title: 'Not mine', workspace: home, worktree: false,
    }, gus);
    // The request is answered, and the refusal is what the model reads: the
    // tool is not in this caller's list, so there is nothing to run and the
    // call names no tool rather than running one and refusing it.
    expect(answered.status).toBe(200);
    expect((answered.said.error as { message: string }).message).toBe('No tool named create_session');
  });

  it('lists every sessionless tool for the deployment token, which is root', async () => {
    expect(listed((await ask(door(), 'tools/list', undefined, ROOT_TOKEN)).said)).toEqual(ELEVEN);
  });

  it('refuses a tool the operator\'s rule names, and runs one it does not', async () => {
    host = serving({ 'host/create_session': false });

    const refused = await call(door(), 'create_session', {
      relationship: 'independent', prompt: 'Say hello.', title: 'Not allowed', workspace: home, worktree: false,
    }, ana);
    const result = refused.said.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('eligibleForAutoApproval');

    // The door still runs what the rule does not name.
    const ran = await call(door(), 'list_sessions', {}, ana);
    expect((ran.said.result as { isError?: boolean }).isError).toBeFalsy();
  });
});

describe('/mcp asks who is calling before it reads the call', () => {
  it('refuses no token, and a token it does not know, with 401', async () => {
    for (const token of [undefined, 'not-a-token-this-host-minted']) {
      const answered = await ask(door(), 'tools/list', undefined, token);
      expect(answered.status).toBe(401);
      expect(answered.said.error).toBeDefined();
    }
  });

  it('sends each 401 a bearer challenge: the realm alone with no token, invalid_token with one', async () => {
    const challenged = async (handler: RequestHandler, token?: string): Promise<string | null> => (await handler(new Request(`${ORIGIN}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(token === undefined ? {} : { authorization: `Bearer ${token}` }) },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    }))).headers.get('www-authenticate');
    expect(await challenged(door())).toBe('Bearer realm="ahpd"');
    expect(await challenged(door(), 'not-a-token-this-host-minted')).toBe('Bearer realm="ahpd", error="invalid_token"');
    const whose = (given: string) => (given === SESSION_TOKEN ? { session: 'session-1' } : undefined);
    expect(await challenged(door('all', ROOT_TOKEN, whose), SESSION_TOKEN)).toBe('Bearer realm="ahpd", error="invalid_token"');
  });

  it('refuses a team key with 403, because a team key opens the proxy only', async () => {
    const key = await users.mintToken!(undefined, { team: 'backend', grants: ['proxy:call'] });
    const answered = await ask(door(), 'tools/list', undefined, key.secret);
    expect(answered.status).toBe(403);
    expect((answered.said.error as { message: string }).message).toContain('mcp:call');
  });

  it('refuses a session\'s own token with 401: a session has its own tools endpoint', async () => {
    const whose = (given: string) => (given === SESSION_TOKEN ? { session: 'session-1' } : undefined);
    const answered = await ask(door('all', ROOT_TOKEN, whose), 'tools/list', undefined, SESSION_TOKEN);
    expect(answered.status).toBe(401);
    expect((answered.said.error as { message: string }).message).toContain('its own tools endpoint');
  });

  it('does not read a token in the query string', async () => {
    const answered = await door()(new Request(`${ORIGIN}/mcp?tkn=${encodeURIComponent(ana)}`));
    expect(answered.status).toBe(401);
  });

  it('refuses a guest with 403: the built-in guest does not hold mcp:call', async () => {
    await users.add('gil', ['guest']);
    const gil = await users.mint('gil');
    const answered = await ask(door(), 'tools/list', undefined, gil);
    expect(answered.status).toBe(403);
    expect((answered.said.error as { message: string }).message).toContain('mcp:call');
  });

  it('lists the tools for a member in no team: /mcp charges nothing', async () => {
    await users.add('nia', ['member']);
    const nia = await users.mint('nia');
    expect(listed((await ask(door(), 'tools/list', undefined, nia)).said)).toEqual(ELEVEN);
  });

  it('refuses a caller without mcp:call with 403, naming the grant', async () => {
    await users.addRole('reader', ['session:read']);
    await users.add('fay', ['reader']);
    const fay = await users.mint('fay');
    const answered = await ask(door(), 'tools/list', undefined, fay);
    expect(answered.status).toBe(403);
    expect((answered.said.error as { message: string }).message).toContain('mcp:call');
  });
});

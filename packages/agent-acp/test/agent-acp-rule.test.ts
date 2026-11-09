import { mkdtempSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { toolServers } from '../../sdk/src/tools/server.js';
import { acpAgent } from '../src/index.js';
import { anyone, signIn } from './people.js';
import type { Bag, HostTool } from '@ahpd/sdk';
import type { ToolsServers } from '../../sdk/src/tools/server.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import { WAIT_MS } from '../../../tools/wait.ts';

/*
 * A tool the operator's rule makes ask every time, on an ACP session.
 *
 * Two ways a call reaches this bridge. The agent's own tool is a permission
 * request, which the bridge puts to the host, whose chain makes a question
 * about a tool the rule names one a managed rule asks; a tool of the host's or
 * a client's is called over the MCP server the session was handed, where the
 * bridge is out of the path.
 *
 * The scripted subprocess in `test/fixtures/acp-server.mjs` makes both for
 * real: `execrun` asks over the protocol, and `mreq` POSTs `tools/call` on the
 * endpoint the session was given.
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
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`still waiting after ${ms} ms`);
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

/** What the agent was told for each request, in the order it made them. */
const results = (p: ReturnType<typeof peer>, chatUri: string): { isError: boolean; content: Bag[] }[] =>
  [...prose(p, chatUri).matchAll(/mcp=(\S+)/g)]
    .map((one) => JSON.parse(decodeURIComponent(one[1] as string)) as { isError: boolean; content: Bag[] });

/** The first question the session put up, if it asked one. */
const question = (p: ReturnType<typeof peer>, uri: string): Bag | undefined =>
  actions(p, uri).find((e) => e.action.type === 'session/inputNeededSet')?.action.request as Bag | undefined;

const endedTurn = async (p: ReturnType<typeof peer>, chatUri: string, count: number): Promise<void> => {
  const done = (): number => types(p, chatUri).filter((type) => type === 'chat/turnComplete').length;
  await until(() => done() >= count);
  expect(done()).toBeGreaterThanOrEqual(count);
};

/** A tool of the host's own, reached over the MCP server rather than in process. */
const hostTool = (ran: string[]): HostTool => ({
  definition: {
    name: 'list_sessions',
    title: 'List sessions',
    description: 'List the sessions',
    inputSchema: { type: 'object', properties: {} },
  },
  run: () => {
    ran.push('list_sessions');
    return 'the sessions';
  },
});

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
 * The daemon serves `ToolsServers.request` on its own port, and the fixture is
 * a subprocess that reaches an endpoint the way the daemon's own agents do - a
 * real HTTP request. This is that listener, on a port of its own.
 */
const serve = async (servers: ToolsServers): Promise<{ origin: string }> => {
  const server = createServer((incoming, outgoing) => {
    const chunks: Buffer[] = [];
    incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
    incoming.on('end', () => {
      // A node request always carries one; the empty one is a `GET`.
      const method = incoming.method ?? 'GET';
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
        for (;;) {
          const chunk = await body.read();
          if (chunk.done) break;
          outgoing.write(Buffer.from(chunk.value));
        }
        outgoing.end();
      }).catch(() => { outgoing.end(); });
    });
  });
  await new Promise<void>((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  listening.push(() => new Promise<void>((resolve) => { server.close(() => { resolve(); }); }));
  return { origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
};

/** A connected client with one ACP session, watching both its channels. */
async function talking(options: { rules?: Record<string, boolean> } = {}) {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-rule-'));
  let origin = '';
  const servers = toolServers({ origin: () => origin, name: 'ahpd', version: 'test' });
  const bound = await serve(servers);
  origin = bound.origin;
  const ran: string[] = [];
  const host = createHost({
    path,
    agents: [acpAgent({
      command: process.execPath,
      args: [FIXTURE],
      provider: 'acp',
      // These cases are about the rule rather than the folder, so the agent
      // says it asks about trust on its own and the host does not refuse it.
      honoursTrust: true,
    })],
    // Somebody for this window to be, without whom it may not set a host key.
    users: anyone(),
    tools: [hostTool(ran)],
    toolsServers: servers,
    // The operator's rule, the daemon's setting.
    ...(options.rules === undefined ? {} : { eligibleForAutoApproval: options.rules }),
  });
  const p = peer();
  const client = host.accept(p);
  await client.handle({
    method: 'initialize',
    params: { clientId: 'probe', protocolVersions: ['0.9.0'], initialSubscriptions: ['ahp-root://'] },
  });
  await signIn(client);
  const uri = 'ahp-session:/rule';
  await client.handle({
    method: 'createSession',
    params: { channel: uri, provider: 'acp', workingDirectories: [`file://${path}`] },
  });
  const chatUri = ((await client.handle({ method: 'subscribe', params: { channel: uri } })) as {
    snapshot: { state: { defaultChat: string } };
  }).snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  opened.push({ client, uri });
  return { client, peer: p, uri, chatUri, ran };
}

const begin = (
  client: Awaited<ReturnType<typeof talking>>['client'],
  chatUri: string,
  text: string,
): void => {
  client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'chat/turnStarted', turnId: 't1', startedAt: new Date().toISOString(), message: { text, origin: { kind: 'user' } } } },
  });
};

/** VS Code's options for a question nothing may keep an answer to. */
const ONCE = [
  { id: 'allow-once', label: 'Allow Once', kind: 'approve' },
  { id: 'skip', label: 'Skip', kind: 'deny', group: 2 },
];

/** The call a question is about, in the shape the entry carries it. */
const call = (entry: Bag | undefined): Bag => (entry?.toolCall ?? {}) as Bag;

/*
 * A host tool the agent calls over the MCP server it was handed runs as the
 * agent called it: no backend checks a call before its runtime asks, as no
 * VS Code agent does.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostManagedSettings.ts#L43-L47
 */
it('runs a host tool the agent calls over the MCP server it was handed', async () => {
  const { client, peer: p, uri, chatUri, ran } = await talking();
  begin(client, chatUri, 'mreq=list_sessions={}=-');
  await endedTurn(p, chatUri, 1);

  expect(types(p, uri)).not.toContain('session/inputNeededSet');
  expect(ran).toEqual(['list_sessions']);
  expect(results(p, chatUri)).toEqual([{ isError: false, content: [{ type: 'text', text: 'the sessions' }] }]);
});

/*
 * A question about a tool the operator's rule names offers VS Code's Allow Once
 * and Skip, as VS Code's host puts a question a managed policy asks; the agent
 * is answered with its own once option of the kind picked.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/sessionPermissions.ts#L566-L610
 */
it('offers the host\'s Allow Once and Skip alone for a matched tool the agent asks about itself', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { shell: false } });
  begin(client, chatUri, 'execrun');
  await until(() => question(p, uri) !== undefined);

  expect(call(question(p, uri)).options).toEqual(ONCE);
  // The call's own ready carries the same choices, and no "always" among them.
  const ready = actions(p, chatUri)
    .filter((e) => e.action.type === 'chat/toolCallReady' && e.action.toolCallId === 'call-run')
    .at(-1)?.action;
  expect(ready?.options).toEqual(ONCE);
});

it('offers VS Code\'s grants of the command for a tool the rule does not name', async () => {
  const { client, peer: p, uri, chatUri } = await talking({ rules: { another_tool: false } });
  begin(client, chatUri, 'execrun');
  await until(() => question(p, uri) !== undefined);

  const offered = call(question(p, uri)).options as Bag[];
  expect(offered.at(0)).toEqual(ONCE[0]);
  expect(offered.at(-1)).toEqual(ONCE[1]);
  expect(offered.some((one) => String(one.id).startsWith('allow-session-rules:'))).toBe(true);
});

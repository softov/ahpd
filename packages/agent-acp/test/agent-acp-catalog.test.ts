import { mkdtempSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { SessionUpdate } from '@agentclientprotocol/sdk';
import { uriOf } from '@ahpd/sdk';
import type { Agent, Bag, Emit, McpServer, Session, Start } from '@ahpd/sdk';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { acpAgent, watchSession } from '../src/index.js';
import { mapUpdate } from '../src/mapping.js';
import { MACHINE_KEYS, optionsSchema } from '../src/plugin.js';
import { toolsReachable } from '../src/session/opening.js';
import type { AcpOptions, AcpTurn } from '../src/types.js';

/*
 * The catalogue, the config schema and a resumed session.
 *
 * The server behind every case is the real scripted subprocess in
 * `test/fixtures/acp-server.mjs`, so what is checked is a genuine handshake:
 * the modes and config options `session/new` names, the commands a prompt
 * advertises, the rows `session/list` returns and the requests `session/load`,
 * `session/set_mode` and `session/set_config_option` actually reach. The
 * fixture records every request in a file when `ACP_LOG` names one, which is
 * how a test proves what the bridge asked for rather than reading state it
 * could have invented.
 */

const FIXTURE = fileURLToPath(new URL('./fixtures/acp-server.mjs', import.meta.url));

/** Everything this file made, so each case leaves nothing behind. */
const made: string[] = [];
const started: Session[] = [];

afterEach(() => {
  for (const session of started.splice(0)) session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true });
});

/** A fresh directory under the system temp root, kept for cleanup. */
const scratch = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'ahpd-acp-catalog-'));
  made.push(path);
  return path;
};

/**
 * The backend under test, with its own request log.
 *
 * The provider is named for the case that needs one of its own: the sessions
 * this process watched are held by provider, and a case that watches a session
 * would otherwise be watched by every later case on the same name.
 */
function backend(flags: string[] = [], provider = 'acp'): { agent: Agent; log: string } {
  const log = join(scratch(), 'requests.jsonl');
  return {
    agent: acpAgent({
      command: process.execPath,
      args: [FIXTURE, ...flags],
      env: { ACP_LOG: log },
      provider,
    }),
    log,
  };
}

type Watcher = {
  emit: Emit;
  actions: { channel: string; action: Bag }[];
  types(): string[];
  endings(): string[];
};

/** A session's emitted actions, which is how a test knows a turn has settled. */
function watcher(): Watcher {
  const actions: { channel: string; action: Bag }[] = [];
  const types = (): string[] => actions.map((one) => String(one.action.type));
  return {
    actions,
    emit: (channel, action) => { actions.push({ channel, action }); },
    types,
    endings: () => types().filter((type) => type === 'chat/turnComplete' || type === 'chat/turnCancelled' || type === 'chat/error'),
  };
}

/** The start a session is handed, without the host that would normally build it. */
const opening = (id: string, over: Partial<Start> = {}): Start => ({
  uri: `ahp-session:/${id}`,
  chatUri: `ahp-chat:/${id}`,
  settings: {},
  schema: () => ({ type: 'object', properties: {} }),
  emit: () => {},
  // The host always resolves this, and its own answer when the deployment said
  // nothing is ten minutes.
  clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  // This case is not about trust, and an absent answer is untrusted - decision
  // `a-folder-is-untrusted-until-a-client-says-otherwise` - so the folder is
  // one the host vouched for, as a session a window opened for itself is.
  trusted: () => true,
  ...over,
});

/** One session of a backend, watched and remembered for cleanup. */
function start(agent: Agent, id: string, over: Partial<Start> = {}): { session: Session; watch: Watcher } {
  const watch = watcher();
  const session = agent.create(opening(id, { ...over, emit: watch.emit }));
  started.push(session);
  return { session, watch };
}

/** The subprocess's work finishing, up to a point; the fixture never sleeps. */
const until = async (check: () => boolean, times = 3000): Promise<void> => {
  for (let i = 0; i < times; i++) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
};

/** Run one turn and wait for the action that ends it. */
const runTurn = async (session: Session, watch: Watcher, turnId: string, text: string): Promise<void> => {
  const before = watch.endings().length;
  session.begin(turnId, text);
  await until(() => watch.endings().length > before);
};

/** Every request the fixture was sent, in order, and which server took it. */
const requests = (log: string): { pid?: number; method?: string; params?: Record<string, unknown> }[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { pid?: number; method?: string; params?: Record<string, unknown> });
  }
  catch {
    // No file yet is no requests yet.
    return [];
  }
};

/** The session's config state, which is where the learned schema lives. */
const configOf = (session: Session): { schema: Bag; values: Record<string, unknown> } => {
  const state = session.sessionState() as { config: { schema: Bag; values: Record<string, unknown> } };
  return state.config;
};

const propertiesOf = (session: Session): Record<string, Record<string, unknown>> =>
  configOf(session).schema.properties as Record<string, Record<string, unknown>>;

/** The config the session announced to its clients, in order. */
const changed = (watch: Watcher): Record<string, unknown>[] =>
  watch.actions.filter((one) => one.action.type === 'session/configChanged')
    .map((one) => (one.action.config ?? {}) as Record<string, unknown>);

it('offers no models before a session, because ACP has no pre-session catalogue', async () => {
  const { agent } = backend();
  const offered = await agent.probe?.();
  // ACP names models and commands on `session/new` and in `session/update`,
  // never on `initialize`, so an empty offer is the honest answer rather than
  // a missing one. Nothing is spawned to answer it.
  expect(offered).toEqual({ models: [], customizations: [], commands: [] });
});

it('carries an approvals control on the session, with no enum before a server is asked', () => {
  const agent = acpAgent({ command: 'node', model: 'gpt-5' });
  const properties = agent.schema().properties as Record<string, Record<string, unknown>>;
  expect(Object.keys(properties)).toEqual(['permissionMode']);
  expect(properties.permissionMode).toMatchObject({ type: 'string', scope: 'session', sessionMutable: true });
  expect(properties.permissionMode?.enum).toBeUndefined();
  // A model is the turn's rather than a config property, but the configured id
  // is still the default a client is offered.
  expect(agent.defaults()).toEqual({ model: 'gpt-5' });
});

it('keeps no per-session state file of its own', () => {
  // The ACP server owns the conversation, so undefined is the real answer
  // rather than a path to something this bridge never writes.
  expect(acpAgent({ command: 'node' }).stateFile?.('acp-session-1', '/tmp')).toBeUndefined();
});

it('reports the server model options once a session has opened', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'models');
  // Nothing has asked the server yet, and ACP has no model list before it does.
  expect(session.models()).toEqual([]);
  await runTurn(session, watch, 't1', 'hi');
  expect(session.models()).toEqual([
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]);
});

it('tells the host once the server has named its models', async () => {
  const { agent } = backend();
  const seen: { id: string; name: string }[][] = [];
  const { session, watch } = start(agent, 'handshake', { onHandshake: () => seen.push(session.models()) });
  expect(seen).toEqual([]);
  await runTurn(session, watch, 't1', 'hi');
  // Once, and only after the models are known, so the host reads a full list.
  expect(seen).toEqual([[
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]]);
  await runTurn(session, watch, 't2', 'again');
  expect(seen).toHaveLength(1);
});

it('sets the model a turn chose on the server before prompting', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'chosen');
  const before = watch.endings().length;
  session.begin('t1', 'hi', { id: 'thorough' });
  await until(() => watch.endings().length > before);

  expect(requests(log).find((one) => one.method === 'session/set_config_option')?.params)
    .toMatchObject({ configId: 'model', value: 'thorough' });
  expect(session.models()).toEqual([
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]);
});

it('reads the legacy models list, and sets a chosen model the old way', async () => {
  const { agent, log } = backend(['--legacy']);
  const { session, watch } = start(agent, 'legacy');
  // The list comes with the answer that opens the session, so before that
  // there is none to offer.
  expect(session.models()).toEqual([]);
  const before = watch.endings().length;
  session.begin('t1', 'hi', { id: 'thorough' });
  await until(() => watch.endings().length > before);

  expect(session.models()).toEqual([
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]);
  // No option to set it through, so the call this server knew instead is the
  // one that goes out - and the turn runs rather than failing for want of a
  // model it could have been given.
  expect(requests(log).find((one) => one.method === 'session/set_model')?.params)
    .toMatchObject({ modelId: 'thorough' });
  expect(watch.endings()).toEqual(['chat/turnComplete']);
});

describe('the MCP servers a session is opened with', () => {
  /** The host's own tools server, as `Start.toolsServer` opens one. */
  const hostTools = { url: 'http://127.0.0.1:4242/ahp-mcp/one', token: 't-kn', setTools: () => {}, close: () => {} };

  const servers: Record<string, McpServer> = {
    files: { type: 'stdio', command: 'mcp-files', args: ['--root', '/tmp'], env: { KEY: 'k-1' } },
    api: { type: 'http', url: 'https://example.test/mcp', headers: { authorization: 'Bearer k-2' } },
  };

  /** What `session/new` was sent, with the servers it carried. */
  const opened = (log: string): unknown => requests(log).find((one) => one.method === 'session/new')?.params?.['mcpServers'];

  /** A backend over the fixture, with a log of its own for the lines it leaves. */
  const withLog = (over: Partial<AcpOptions> = {}, flags: string[] = []) => {
    const log = join(scratch(), 'requests.jsonl');
    const said: string[] = [];
    return {
      said,
      log,
      agent: acpAgent({
        command: process.execPath,
        args: [FIXTURE, ...flags],
        env: { ACP_LOG: log },
        provider: 'acp',
        log: (line) => { said.push(line); },
        ...over,
      }),
    };
  };

  it('carries a stdio server whatever the server says it can take', async () => {
    const { agent, log } = withLog();
    const { session, watch } = start(agent, 'stdio', { mcpServers: servers });
    const before = watch.endings().length;
    session.begin('t1', 'hi');
    await until(() => watch.endings().length > before);

    expect(opened(log)).toEqual([
      {
        name: 'files',
        command: 'mcp-files',
        args: ['--root', '/tmp'],
        env: [{ name: 'KEY', value: 'k-1' }],
      },
      {
        type: 'http',
        name: 'api',
        url: 'https://example.test/mcp',
        headers: [{ name: 'authorization', value: 'Bearer k-2' }],
      },
    ]);
  });

  it('leaves an http server out of a server that takes none, and says which', async () => {
    const { agent, log, said } = withLog({}, ['--no-http-mcp']);
    const { session, watch } = start(agent, 'nohttp', { mcpServers: servers });
    const before = watch.endings().length;
    session.begin('t1', 'hi');
    await until(() => watch.endings().length > before);

    // The stdio one is untouched: only what the handshake refuses is left out.
    expect(opened(log)).toEqual([
      { name: 'files', command: 'mcp-files', args: ['--root', '/tmp'], env: [{ name: 'KEY', value: 'k-1' }] },
    ]);
    expect(said).toEqual(['api: this ACP server takes no MCP server over HTTP, so it was left out']);
  });

  it('offers the host\'s own tools as one server with its token, on by default', async () => {
    const { agent, log } = withLog();
    const { session, watch } = start(agent, 'tools', { toolsServer: () => hostTools });
    const before = watch.endings().length;
    session.begin('t1', 'hi');
    await until(() => watch.endings().length > before);

    expect(opened(log)).toEqual([{
      type: 'http',
      name: 'ahp',
      url: 'http://127.0.0.1:4242/ahp-mcp/one',
      headers: [{ name: 'authorization', value: 'Bearer t-kn' }],
    }]);
  });

  it('leaves the host\'s tools out where the deployment said hostTools: false', async () => {
    const { agent, log } = withLog({ hostTools: false });
    const { session, watch } = start(agent, 'notools', { toolsServer: () => hostTools });
    const before = watch.endings().length;
    session.begin('t1', 'hi');
    await until(() => watch.endings().length > before);

    expect(opened(log)).toEqual([]);
  });

  it('leaves the host\'s own tools out of a server that takes none over HTTP, and says which', async () => {
    const { agent, log, said } = withLog({}, ['--no-http-mcp']);
    const { session, watch } = start(agent, 'notoolshttp', { toolsServer: () => hostTools });
    const before = watch.endings().length;
    session.begin('t1', 'hi');
    await until(() => watch.endings().length > before);

    // The host's tools are an HTTP server like any other, so the handshake that
    // refuses the others refuses this one, and says so the same way.
    expect(opened(log)).toEqual([]);
    expect(said).toEqual(['ahp: this ACP server takes no MCP server over HTTP, so it was left out']);
  });

  it('keeps one endpoint of the host\'s own across a server that died', async () => {
    const { agent, log } = withLog();
    let asked = 0;
    const { session, watch } = start(agent, 'respawn', {
      toolsServer: () => {
        asked += 1;
        return hostTools;
      },
    });
    await runTurn(session, watch, 't1', 'die now');
    await runTurn(session, watch, 't2', 'hi again');

    // A second endpoint is a second process answering with a token of its own,
    // for a session nothing is listening to. The load is told the same list the
    // new session was given, because there is only one.
    expect(asked).toBe(1);
    const openedOnNew = requests(log).find((one) => one.method === 'session/new')?.params?.['mcpServers'];
    const openedOnLoad = requests(log).find((one) => one.method === 'session/load')?.params?.['mcpServers'];
    expect(openedOnLoad).toEqual(openedOnNew);
  });

  it('carries the same list on a load, which is the session that continues', async () => {
    const { agent, log } = withLog();
    const { session, watch } = start(agent, 'loaded', { mcpServers: servers, resume: 'old-one' });
    const before = watch.endings().length;
    session.begin('t1', 'hi');
    await until(() => watch.endings().length > before);

    expect(requests(log).find((one) => one.method === 'session/load')?.params?.['mcpServers']).toEqual([
      { name: 'files', command: 'mcp-files', args: ['--root', '/tmp'], env: [{ name: 'KEY', value: 'k-1' }] },
      { type: 'http', name: 'api', url: 'https://example.test/mcp', headers: [{ name: 'authorization', value: 'Bearer k-2' }] },
    ]);
  });

  /*
   * A session in a machine, through a port that spawns on this host as a
   * machine's `docker exec` would, so the handshake is the fixture's own and
   * only where the session says it runs differs.
   */
  const inBox = (url: string): Partial<Start> => ({
    settings: { computer: 'computer://box' },
    computers: {
      how: async (_id, spawn) => ({
        command: spawn.command,
        args: spawn.args ?? [],
        ...(spawn.env === undefined ? {} : { env: spawn.env }),
      }),
    },
    toolsServer: () => ({ url, token: 't-kn', setTools: () => {}, close: () => {} }),
  });

  for (const [url, at] of [
    ['http://127.0.0.1:4242/ahp-mcp/one', '127.0.0.1:4242'],
    ['http://localhost:4242/ahp-mcp/one', 'localhost:4242'],
    ['http://[::1]:4242/ahp-mcp/one', '[::1]:4242'],
    ['http://0.0.0.0:4242/ahp-mcp/one', '0.0.0.0:4242'],
    ['http://[::]:4242/ahp-mcp/one', '[::]:4242'],
  ] as const) {
    it(`leaves the host's tools out of a session in a machine when the daemon is at ${at}, and says why`, async () => {
      const { agent, log, said } = withLog();
      const { session, watch } = start(agent, `boxed-${at}`, inBox(url));
      const before = watch.endings().length;
      session.begin('t1', 'hi');
      await until(() => watch.endings().length > before);

      expect(watch.endings()).toEqual(['chat/turnComplete']);
      expect(opened(log)).toEqual([]);
      expect(said).toEqual([`host tools: computer://box cannot reach the daemon at ${at}, so they were left out`]);
      // The line names where, never the token that opens it.
      expect(said.join('\n')).not.toContain('t-kn');
    });
  }

  it('offers the host\'s tools to a session in a machine where the daemon is on an address it can reach', async () => {
    const { agent, log, said } = withLog();
    const { session, watch } = start(agent, 'boxed-reach', inBox('http://10.0.0.5:4242/ahp-mcp/one'));
    const before = watch.endings().length;
    session.begin('t1', 'hi');
    await until(() => watch.endings().length > before);

    expect(opened(log)).toEqual([{
      type: 'http',
      name: 'ahp',
      url: 'http://10.0.0.5:4242/ahp-mcp/one',
      headers: [{ name: 'authorization', value: 'Bearer t-kn' }],
    }]);
    expect(said).toEqual([]);
  });
});

describe('toolsReachable', () => {
  it('answers true on this host, whatever the address', () => {
    for (const url of ['http://127.0.0.1:1/x', 'http://0.0.0.0:1/x', 'http://[::]:1/x', 'http://10.0.0.5:1/x']) {
      expect(toolsReachable(url, undefined)).toBe(true);
    }
  });

  it('answers false in a machine for a loopback or wildcard address, and true for any other', () => {
    for (const url of ['http://127.0.0.1:1/x', 'http://127.1.2.3:1/x', 'http://localhost:1/x', 'http://[::1]:1/x', 'http://0.0.0.0:1/x', 'http://[::]:1/x']) {
      expect(toolsReachable(url, 'computer://box')).toBe(false);
    }
    for (const url of ['http://10.0.0.5:1/x', 'http://host.docker.internal:1/x', 'http://[fd00::1]:1/x']) {
      expect(toolsReachable(url, 'computer://box')).toBe(true);
    }
  });
});

it('learns the server modes and reports where the session sits after a change', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'modes');
  await runTurn(session, watch, 't1', 'hi');

  expect(propertiesOf(session).permissionMode).toMatchObject({
    enum: ['ask', 'code'],
    enumLabels: ['Ask', 'Code'],
  });
  expect(configOf(session).values.permissionMode).toBe('ask');

  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);
  await until(() => configOf(session).values.permissionMode === 'code');
  expect(configOf(session).values.permissionMode).toBe('code');
  expect(session.settings().permissionMode).toBe('code');
  expect(requests(log).find((one) => one.method === 'session/set_mode')?.params).toMatchObject({ modeId: 'code' });
});

it('announces a mode the agent moved itself, once', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'announced');
  await runTurn(session, watch, 't1', 'hi');
  // The mode and the model the session opened with are the ones in force, so
  // nothing is said until the server moves them.
  expect(changed(watch)).toEqual([]);

  await runTurn(session, watch, 't2', 'shift');
  // Said again at the same turn, which is the point: the second `shift` moves
  // nothing, and a client told the same value twice would have to work out
  // whether anything changed.
  await runTurn(session, watch, 't3', 'shift');

  expect(changed(watch)).toEqual([{ permissionMode: 'code' }, { model: 'thorough' }]);
  expect(configOf(session).values).toMatchObject({ permissionMode: 'code' });
  expect(session.settings().model).toBe('thorough');
});

it('says nothing for a mode the client set itself', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'announced-by-us');
  await runTurn(session, watch, 't1', 'hi');

  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);
  // The update that follows the request carries back what the client already
  // knows, so the announcement is the one thing a client is not sent twice.
  await runTurn(session, watch, 't2', 'hi');

  expect(changed(watch)).toEqual([]);
  expect(session.settings().permissionMode).toBe('code');
});

it('reports a command the server advertises as a customization', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'commands');
  await runTurn(session, watch, 't1', 'hi');

  const plan = session.customizations().find((one) => one.name === 'plan');
  expect(plan).toMatchObject({ type: 'prompt', id: 'command:plan', enabled: true, description: 'Draft a plan' });
  expect(watch.actions.some((one) => one.channel === 'session'
    && one.action.type === 'session/customizationsChanged')).toBe(true);
});

it("takes the agent's name for the session over the one the first prompt gave it", async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'title');
  await runTurn(session, watch, 't1', 'name it please');
  expect(session.title()).toBe('Naming the work');
  // The prompt's own words first, which is all a client had until the agent
  // said better, and the agent's name after it.
  expect(watch.actions.filter((one) => one.action.type === 'session/titleChanged'))
    .toMatchObject([
      { channel: 'session', action: { title: 'name it please' } },
      { channel: 'session', action: { title: 'Naming the work' } },
    ]);
});

it('keeps the name a person gave the session, whatever the agent calls it', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'renamed');
  session.setTitle?.('The name I want');
  await runTurn(session, watch, 't1', 'name it anyway');

  expect(session.title()).toBe('The name I want');
  // Said once and once only: the person renaming is the host's own action.
  expect(watch.actions.some((one) => one.action.type === 'session/titleChanged')).toBe(false);
});

it('lists the sessions the server lists, mapping the fields the contract wants', async () => {
  const { agent } = backend();
  const rows = await agent.list?.();
  expect(rows?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect(rows?.[0]).toEqual({
    id: 'listed-1',
    title: 'One',
    createdAt: '2026-01-01T00:00:00.000Z',
    modifiedAt: '2026-01-01T00:00:00.000Z',
    workingDirectories: ['file:///tmp/one'],
  });
  // A row with no title falls back to its id, and one with no timestamp to now.
  expect(rows?.[1]?.title).toBe('listed-2');
  expect(rows?.[1]?.workingDirectories).toEqual(['file:///tmp/two', 'file:///tmp/two-b']);
  expect(Number.isNaN(Date.parse(String(rows?.[1]?.createdAt)))).toBe(false);
});

it('lists every page of a catalogue the server did not fit into one answer', async () => {
  const { agent, log } = backend(['--pages']);
  const rows = await agent.list?.();
  // The second page is only reached by asking for the cursor the first one
  // named, so a bridge that reads one page reports one session and no error.
  expect(rows?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect(requests(log).filter((one) => one.method === 'session/list')).toHaveLength(2);
});

it('lists a second time on the connection the first one left open', async () => {
  const { agent, log } = backend();
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);
  expect((await agent.list?.())?.map((one) => one.id)).toEqual(['listed-1', 'listed-2']);

  // A subscribe is a list, and a client that reconnects is another: spawning a
  // server for each is a subprocess per subscribe for a catalogue that has not
  // changed. The log names the process each request reached.
  const pids = new Set(requests(log).map((one) => one.pid));
  expect(pids.size).toBe(1);
  expect(requests(log).filter((one) => one.method === 'session/list')).toHaveLength(2);
});

it('finds a listed session by listing its own server, and loads nothing', async () => {
  const { agent, log } = backend();
  const rows = await agent.list?.();
  const found = await agent.find?.('listed-1');

  // The row a client opening the row would be sent has to be the row it was
  // listed, or the next refresh answers a `root/sessionSummaryChanged` for a
  // session that did not change.
  expect(found).toEqual(rows?.[0]);
  expect(found?.title).toBe('One');
  expect(requests(log).some((one) => one.method === 'session/list')).toBe(true);
  // ACP has no call that describes one session: a load replays the whole
  // conversation and answers modes and config, so a find that loaded would cost
  // the conversation to answer a title.
  expect(requests(log).some((one) => one.method === 'session/load')).toBe(false);
});

it('answers nothing for an id the server does not list', async () => {
  const { agent, log } = backend();
  expect(await agent.find?.('a-session-nobody-has')).toBeUndefined();
  expect(requests(log).some((one) => one.method === 'session/list')).toBe(true);
});

it('answers a session this process watched the way its listing answers it', async () => {
  const { agent } = backend([], 'acp-watched');
  // A session this process opened, watched, and a client retitled: the server
  // still lists it under the row it always had, and `list` answers that row. A
  // `find` that answered the watched record instead would be a row every client
  // is told changed by the next refresh, for a session that did not.
  watchSession({ provider: 'acp-watched', id: 'listed-1', cwd: '/tmp/one', additional: [], title: 'a title a client set' });
  const rows = await agent.list?.();

  const found = await agent.find?.('listed-1');
  expect(found).toEqual(rows?.[0]);
  expect(found?.title).toBe('One');
});

it('finds a session the server put on a later page', async () => {
  const { agent, log } = backend(['--pages']);
  // The second page is only reached by asking for the cursor the first named,
  // so a find that read one page would report nothing for a session the
  // listing itself reports.
  expect((await agent.find?.('listed-2'))?.id).toBe('listed-2');
  expect(requests(log).filter((one) => one.method === 'session/list')).toHaveLength(2);
});

it('lists once for every find asking at the same time', async () => {
  const { agent, log } = backend();
  const ids = ['nobody-1', 'nobody-2', 'nobody-3', 'nobody-4', 'nobody-5'];

  // A client whose catalogue is stale asks about a run of ids at once, and
  // every one of them is a listing of this server unless they share one.
  const answers = await Promise.all(ids.map(async (id) => await agent.find?.(id)));
  expect(answers).toEqual([undefined, undefined, undefined, undefined, undefined]);
  expect(requests(log).filter((one) => one.method === 'session/list')).toHaveLength(1);
});

it('answers a find of a missing id from the listing it read a moment ago', async () => {
  const { agent, log } = backend();
  expect(await agent.find?.('nobody-1')).toBeUndefined();
  expect(await agent.find?.('nobody-2')).toBeUndefined();

  // One id after another is the shape an opening client has, and each of them
  // is the whole catalogue of that server paged to the end.
  expect(requests(log).filter((one) => one.method === 'session/list')).toHaveLength(1);
});

it('answers nothing for a session the server dropped since the listing it read', async () => {
  const { agent } = backend();
  expect((await agent.find?.('listed-1'))?.id).toBe('listed-1');
  await agent.delete?.('listed-1', '/tmp/one');

  // The rows a find read are a moment old, and a delete is the one change they
  // cannot have: holding them over it would answer the session the host has
  // just been told is gone, and the host would offer it again.
  expect(await agent.find?.('listed-1')).toBeUndefined();
});

it('spawns a command that cannot start once for the ids of one window', async () => {
  const starts = join(scratch(), 'starts.txt');
  const agent = acpAgent({
    command: process.execPath,
    args: ['-e', `require('node:fs').appendFileSync(${JSON.stringify(starts)}, 'start\\n')`],
    provider: 'acp-dead',
  });

  // A server that does not start leaves nothing to read, and a find that
  // respawned it for every missing id would be a subprocess per subscribe to a
  // session nobody has - the exact cost this whole path exists to remove.
  expect(await agent.find?.('nobody-1')).toBeUndefined();
  expect(await agent.find?.('nobody-2')).toBeUndefined();
  expect(readFileSync(starts, 'utf8').trim().split('\n')).toHaveLength(1);
});

it('answers the watched record for a command that does not start, and nothing else', async () => {
  watchSession({ provider: 'acp-missing-find', id: 'kept', cwd: '/tmp', additional: [], title: 'Kept' });
  const agent = acpAgent({ command: 'ahpd-no-such-acp-server', provider: 'acp-missing-find' });

  // A catalogue read must answer and must never take the daemon down over a
  // subprocess that did not start, which is true of a find as much as a list.
  expect(await agent.find?.('kept')).toEqual({
    id: 'kept',
    title: 'Kept',
    createdAt: expect.any(String),
    modifiedAt: expect.any(String),
    workingDirectories: ['file:///tmp'],
  });
  expect(await agent.find?.('nobody')).toBeUndefined();
});

it('reads back the turn this process watched and nothing for one it did not', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'transcript');
  await runTurn(session, watch, 't1', 'hi');

  const id = session.agentId();
  expect(id).toBeDefined();
  const turns = await agent.transcript?.(String(id));
  expect(turns).toHaveLength(1);
  expect(turns?.[0]?.message.text).toBe('hi');
  expect(turns?.[0]?.state).toBe('complete');
  const parts = turns?.[0]?.responseParts as { kind?: string; content?: string }[];
  expect(parts.some((part) => part.kind === 'markdown' && part.content === 'hello there')).toBe(true);
});

it('reads back each turn with the usage it last reported', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'usage');
  await runTurn(session, watch, 't1', 'spend some of it and count the tokens');
  await runTurn(session, watch, 't2', 'spend some more');

  // A rebuilt turn that answers a different question than the streamed one is
  // the one thing the shared mapping is here to prevent, and usage is the part
  // of it that is not a part.
  const turns = await agent.transcript?.(String(session.agentId()));
  expect(turns).toHaveLength(2);
  // The counts arrive with the prompt's answer rather than in an update, so a
  // rebuild that replayed the updates alone would not have them at all.
  expect(turns?.[0]?.usage).toEqual({
    inputTokens: 1000,
    outputTokens: 400,
    cacheReadTokens: 40,
    _meta: {
      'ahpd.cacheWriteTokens': 10,
      'ahpd.reasoningTokens': 80,
      'ahpd.cost': { amount: 1.75, currency: 'USD' },
      'ahpd.context': { used: 4200, size: 200000 },
    },
  });
  // And the second turn holds what it spent rather than the session's books
  // again, which is a number the replay cannot arrive at from the session's
  // first update: nothing of the first turn's cost is charged to it.
  expect(turns?.[1]?.usage).toEqual({
    _meta: { 'ahpd.cost': { amount: 0.75, currency: 'USD' }, 'ahpd.context': { used: 4200, size: 200000 } },
  });

  // The same usage the chat was sent, turn for turn.
  const live = (session.chatState() as { turns?: { usage?: unknown }[] }).turns ?? [];
  expect(live.map((one) => one.usage)).toEqual([turns?.[0]?.usage, turns?.[1]?.usage]);
});

it('reads back a session this process never watched by loading it from the server', async () => {
  const { agent, log } = backend(['--replay']);
  // Nothing here has opened a session, so this is the read a host makes for a
  // row in the catalogue after a restart: the server is asked to replay it.
  const turns = await agent.transcript?.('acp-session-restored');
  expect(turns?.map((one) => one.message.text)).toEqual(['what did we decide?', 'and the slow one?']);
  expect(requests(log).find((one) => one.method === 'session/load')?.params)
    .toMatchObject({ sessionId: 'acp-session-restored' });
  expect(requests(log).some((one) => one.method === 'session/new')).toBe(false);
});

it('answers nothing for a session a server that cannot load does not have', async () => {
  const { agent, log } = backend(['--no-load']);
  // `undefined` rather than an empty session, which is what the host reads as
  // "no such session" and what a failed read must not look like.
  expect(await agent.transcript?.('a-session-nobody-watched')).toBeUndefined();
  expect(requests(log).some((one) => one.method === 'session/load')).toBe(false);
});

it('loads a session at the folder the server listed it under', async () => {
  const { agent, log } = backend();
  // `listed-1` is the fixture's `/tmp/one`. A server that keeps a conversation
  // by its folder finds nothing when asked with the daemon's, so the read asks
  // the way the server can answer.
  await agent.list?.();
  expect(requests(log).some((one) => one.method === 'session/list')).toBe(true);

  await agent.transcript?.('listed-1');
  expect(requests(log).find((one) => one.method === 'session/load')?.params)
    .toMatchObject({ sessionId: 'listed-1', cwd: '/tmp/one' });
});

it('leaves no server behind after reading a session back', async () => {
  const pidFile = join(scratch(), 'transcript.pid');
  const { agent } = backend([`--grandchild=${pidFile}`]);
  await agent.transcript?.('acp-session-nothing-left');
  await until(() => existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, 'utf8'));

  // The read spawned a server of its own, and a read is not a session.
  await until(() => !running(pid));
  expect(running(pid)).toBe(false);
});

it('answers a second read of the same session from the record, and spawns nothing', async () => {
  const { agent, log } = backend();
  const asked = async (): Promise<number | undefined> =>
    (await agent.transcript?.('acp-session-read-once'))?.length;
  expect(await asked()).toBe(0);
  const loads = requests(log).filter((one) => one.method === 'session/load');

  // The second read is the host re-subscribing to a row it already opened, and
  // the record answers it: a server spawned per read would load it every time.
  expect(await asked()).toBe(0);
  expect(requests(log).filter((one) => one.method === 'session/load')).toHaveLength(loads.length);
});

it('reads back an interleaved turn with its parts in the order they streamed', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'interleaved');
  await runTurn(session, watch, 't1', 'ponder it');

  const turns = await agent.transcript?.(String(session.agentId()));
  const parts = turns?.[0]?.responseParts as { id: string; kind?: string; content?: string }[];
  expect(parts.map((part) => part.kind)).toEqual(['reasoning', 'toolCall', 'reasoning', 'markdown']);
  expect(parts.map((part) => part.content)).toEqual(['first thought', undefined, 'second thought', 'the answer']);
  // The same ids the live turn held, so a reloaded client keys the same parts.
  const live = session.allTurns()[0]?.responseParts as { id: string }[];
  expect(parts.map((part) => part.id)).toEqual(live.map((part) => part.id));
});

it('reads back no part for a message that was only whitespace, with the ids the live turn held', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'blank');
  await runTurn(session, watch, 't1', 'blank it');

  const turns = await agent.transcript?.(String(session.agentId()));
  const parts = turns?.[0]?.responseParts as { id: string; kind?: string; content?: string }[];
  expect(parts.map((part) => part.kind)).toEqual(['reasoning', 'toolCall', 'reasoning', 'markdown']);
  expect(parts.map((part) => part.content)).toEqual(['first thought', undefined, 'second thought', ' \nthe answer']);
  const live = session.allTurns()[0]?.responseParts as { id: string }[];
  expect(parts.map((part) => part.id)).toEqual(live.map((part) => part.id));
  expect(parts.map((part) => part.id)).toEqual(['t1:0', 'call-2', 't1:2', 't1:3']);
});

it('reaches the server for permissionMode and model, and refuses another key naming it', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'config');
  await runTurn(session, watch, 't1', 'hi');

  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);
  expect(await session.setConfig?.('model', 'thorough')).toBe(true);

  const refused = await session.setConfig?.('nonsense', 'x');
  expect(typeof refused).toBe('string');
  expect(String(refused)).toContain('nonsense');

  const asked = requests(log);
  expect(asked.find((one) => one.method === 'session/set_mode')?.params).toMatchObject({ modeId: 'code' });
  expect(asked.find((one) => one.method === 'session/set_config_option')?.params)
    .toMatchObject({ configId: 'model', value: 'thorough' });
});

it('draws every option of its own as a control, and sets each through the server', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'controls');
  await runTurn(session, watch, 't1', 'hi');

  // The model's and the mode's own names, and every other option under the
  // server's id with the values the server serves.
  const properties = propertiesOf(session);
  expect(Object.keys(properties).sort()).toEqual(['acp.telemetry', 'acp.thinking', 'permissionMode']);
  expect(properties['acp.thinking']).toMatchObject({
    type: 'string',
    title: 'Thinking',
    sessionMutable: true,
    enum: ['off', 'deep'],
    enumLabels: ['Off', 'Deep'],
    default: 'off',
  });
  expect(properties['acp.telemetry']).toMatchObject({
    type: 'boolean',
    title: 'Telemetry',
    sessionMutable: true,
    default: false,
  });

  expect(await session.setConfig?.('acp.thinking', 'deep')).toBe(true);
  expect(await session.setConfig?.('acp.telemetry', true)).toBe(true);

  const asked = requests(log).filter((one) => one.method === 'session/set_config_option');
  expect(asked.find((one) => one.params?.configId === 'thinking')?.params).toMatchObject({ value: 'deep' });
  expect(asked.find((one) => one.params?.configId === 'telemetry')?.params).toMatchObject({ type: 'boolean', value: true });
  expect(configOf(session).values).toMatchObject({ 'acp.thinking': 'deep', 'acp.telemetry': true });

  // A key the server named no option for is refused, and so is the wrong kind
  // of value for one it did.
  expect(String(await session.setConfig?.('acp.telemetry', 'yes'))).toContain('true or false');
  expect(String(await session.setConfig?.('acp.nothing', true))).toContain('nothing');
});

it('sets the mode through the option the server named, not the legacy call', async () => {
  const { agent, log } = backend(['--modes']);
  const { session, watch } = start(agent, 'mode-option');
  await runTurn(session, watch, 't1', 'hi');

  // The option is the server's own account of the mode, so its values are the
  // enum a person picks from and setting one is the same call as any other.
  expect(propertiesOf(session).permissionMode?.enum).toEqual(['ask', 'code']);
  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);

  const asked = requests(log);
  expect(asked.some((one) => one.method === 'session/set_mode')).toBe(false);
  expect(asked.find((one) => one.method === 'session/set_config_option')?.params)
    .toMatchObject({ configId: 'mode', value: 'code' });
});

it('sets an option on a session that has not run a turn', async () => {
  const { agent, log } = backend();
  const { session } = start(agent, 'unopened');

  // Nothing has asked the server yet, so the option this key names is not known
  // either: the session is opened before the key is looked up, which is what
  // makes setting one on a fresh session work rather than refuse it by name.
  expect(await session.setConfig?.('acp.thinking', 'deep')).toBe(true);
  expect(requests(log).find((one) => one.method === 'session/set_config_option')?.params)
    .toMatchObject({ configId: 'thinking', value: 'deep' });
});

it('sets the model through the older call on a server with no options', async () => {
  const { agent, log } = backend(['--legacy']);
  const { session, watch } = start(agent, 'legacy');
  await runTurn(session, watch, 't1', 'hi');

  // A server from before config options named its models in a list, and takes
  // a model by the older call. No option to set, so no `session/set_config_option`.
  expect(await session.setConfig?.('model', 'thorough')).toBe(true);
  const asked = requests(log);
  expect(asked.some((one) => one.method === 'session/set_config_option')).toBe(false);
  expect(asked.find((one) => one.method === 'session/set_model')?.params)
    .toMatchObject({ modelId: 'thorough' });
});

it('loads a session on resume rather than opening a new one', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'resume', { resume: 'acp-session-resumed' });
  await runTurn(session, watch, 't1', 'hi');

  expect(session.agentId()).toBe('acp-session-resumed');
  expect(session.models()).toEqual([
    { id: 'fast', name: 'Fast' },
    { id: 'thorough', name: 'Thorough' },
  ]);
  const asked = requests(log);
  expect(asked.some((one) => one.method === 'session/load')).toBe(true);
  expect(asked.some((one) => one.method === 'session/new')).toBe(false);
});

it('holds a load\'s replay out of the turn that asked for it', async () => {
  const { agent } = backend(['--replay']);
  const { session, watch } = start(agent, 'replayed', { resume: 'acp-session-replayed' });
  await runTurn(session, watch, 't1', 'hi');

  // The replay is what the server said before it answered the load, and it is
  // the conversation the session was opened for rather than this turn's answer.
  const held = session.allTurns()[0]?.responseParts as { kind?: string; content?: string }[];
  expect(held.map((part) => part.content)).toEqual(['hello there']);
  expect(JSON.stringify(watch.actions)).not.toContain('we chose the fast one');
});

it('holds a load\'s replay out of the turn after it, whoever asked for the load', async () => {
  const { agent } = backend(['--replay']);
  const { session, watch } = start(agent, 'replayed-from-config');
  // No turn has run, so the config is what opens the server and loads.
  expect(await session.setConfig?.('permissionMode', 'code')).toBe(true);
  expect(session.allTurns()).toEqual([]);

  await runTurn(session, watch, 't1', 'hi');
  const held = session.allTurns()[0]?.responseParts as { kind?: string; content?: string }[];
  expect(held.map((part) => part.content)).toEqual(['hello there']);
});

it('reads a loaded session back with its replayed turns ahead of the new one', async () => {
  const { agent } = backend(['--replay']);
  const { session, watch } = start(agent, 'replayed-history', { resume: 'acp-session-replayed-history' });
  await runTurn(session, watch, 't1', 'hi');

  const turns = await agent.transcript?.(String(session.agentId()));
  // The replay is the conversation the session was resumed for, so it is the
  // beginning of the history rather than something the first turn swallowed.
  expect(turns?.map((one) => one.message.text)).toEqual([
    'what did we decide?',
    'and the slow one?',
    'hi',
  ]);
  const said = (at: number) => (turns?.[at]?.responseParts as { kind?: string; content?: string }[])
    .map((part) => part.content);
  expect(said(0)).toEqual(['we chose the fast one']);
  // The second replayed turn thought before it answered, and the split kept both.
  expect(said(1)).toEqual(['weighing it up', 'we left it for later']);
  expect(said(2)).toEqual(['hello there']);
  expect(turns?.map((one) => one.state)).toEqual(['complete', 'complete', 'complete']);
});

it('reads a message that arrived in several chunks as one turn', async () => {
  const { agent } = backend(['--replay']);
  // The first replayed message is two `user_message_chunk`s, as a message with
  // a block that is not text arrives. A turn is a message, not a chunk.
  const turns = await agent.transcript?.('acp-session-chunked');
  expect(turns?.map((one) => one.message.text)).toEqual([
    'what did we decide?',
    'and the slow one?',
  ]);
  expect(turns).toHaveLength(2);
});

it('does not replay a conversation twice when a read is followed by a turn', async () => {
  const { agent, log } = backend(['--replay']);
  // What a host does for a row it is opening: read the transcript, then send a
  // turn to the same conversation. The read and the turn spawn a server each,
  // so the conversation is replayed twice - and the second replay must not land
  // in the history, or a client reads one conversation as having happened twice.
  await agent.transcript?.('acp-session-once');
  const { session, watch } = start(agent, 'once', { resume: 'acp-session-once' });
  await runTurn(session, watch, 't1', 'hi again');

  expect(requests(log).filter((one) => one.method === 'session/load').length).toBeGreaterThan(1);
  const turns = await agent.transcript?.('acp-session-once');
  // The replayed turns, then the new one, and not the replay a second time.
  expect(turns?.map((one) => one.message.text)).toEqual([
    'what did we decide?',
    'and the slow one?',
    'hi again',
  ]);
});

it('continues the same session after the server dies, rather than starting a new one', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'died');
  // The fixture exits mid-prompt, so the first turn fails and the death that
  // caused it is already heard before the second turn asks for a server.
  await runTurn(session, watch, 't1', 'die now');
  const named = session.agentId();
  expect(named).toBeDefined();

  await runTurn(session, watch, 't2', 'hi again');
  expect(watch.endings()).toEqual(['chat/error', 'chat/turnComplete']);
  // The same conversation, on whichever server answered the second turn.
  expect(session.agentId()).toBe(named);
  const loads = requests(log).filter((one) => one.method === 'session/load');
  expect(loads).toHaveLength(1);
  expect(loads[0]?.params).toMatchObject({ sessionId: named });
  expect(requests(log).filter((one) => one.method === 'session/new')).toHaveLength(1);
});

it('fails the turn after a death when the server cannot load a session', async () => {
  const { agent, log } = backend(['--no-load']);
  const { session, watch } = start(agent, 'died-no-load');
  await runTurn(session, watch, 't1', 'die now');

  await runTurn(session, watch, 't2', 'hi again');
  // A sentence, rather than a `session/new` that would answer with a
  // conversation that had lost everything the first one held.
  expect(watch.types().at(-1)).toBe('chat/error');
  expect(String((watch.actions.at(-1)?.action as { part?: { error?: { message?: string } } })
    .part?.error?.message)).toContain('cannot load a session');
  expect(requests(log).some((one) => one.method === 'session/load')).toBe(false);
  expect(requests(log).filter((one) => one.method === 'session/new')).toHaveLength(1);
});

it('tells a server that advertised session/close to close, and one that did not is not told', async () => {
  const { agent, log } = backend();
  const { session, watch } = start(agent, 'close-capability');
  await runTurn(session, watch, 't1', 'hi');
  const named = String(session.agentId());

  await session.close?.();
  expect(requests(log).find((one) => one.method === 'session/close')?.params).toMatchObject({ sessionId: named });

  const silent = backend(['--no-close']);
  const other = start(silent.agent, 'close-not-advertised');
  await runTurn(other.session, other.watch, 't1', 'hi');
  await other.session.close?.();
  expect(requests(silent.log).some((one) => one.method === 'session/close')).toBe(false);
});

it('leaves no process behind when a session closes', async () => {
  const pidFile = join(scratch(), 'grandchild.pid');
  const { agent } = backend([`--grandchild=${pidFile}`]);
  const { session, watch } = start(agent, 'close');
  await runTurn(session, watch, 't1', 'hi');
  await until(() => existsSync(pidFile));
  const pid = Number(readFileSync(pidFile, 'utf8'));
  expect(running(pid)).toBe(true);

  await session.close?.();
  // The server leads a group of its own, so the grandchild it started is in it
  // and the SIGTERM reaches both.
  await until(() => !running(pid));
  expect(running(pid)).toBe(false);
});

/** Whether a pid is still a process this user could signal. */
const running = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  }
  catch {
    return false;
  }
};

/*
 * When an ACP tool call ran.
 *
 * The protocol carries no time of its own, so a call's start is the time this
 * plugin first heard about it and its end the time it heard the update that
 * finished it. The times ride in the call's `_meta`, and each update is kept
 * with the time it was received, so a conversation read back before a restart
 * carries the same numbers the live client saw - and one a `session/load`
 * replayed after a restart carries none, since its updates were read then and
 * not now.
 */

/** A `tool_call` update, as the fixture's servers send one. */
const toolCall = (toolCallId: string, status: string): SessionUpdate =>
  ({ sessionUpdate: 'tool_call', toolCallId, title: 'Fetch', name: 'fetch', status }) as unknown as SessionUpdate;

/** A `tool_call_update` update, carrying a status and nothing else. */
const toolCallUpdate = (toolCallId: string, status: string): SessionUpdate =>
  ({ sessionUpdate: 'tool_call_update', toolCallId, status }) as unknown as SessionUpdate;

/** The `_meta` an action about a call carries. */
const metaOf = (action: Bag | undefined): Bag => (action?._meta ?? {}) as Bag;

/** Whether an action carries a call's start, its end and how long it took. */
const timed = (action: Bag | undefined): boolean => {
  const meta = metaOf(action);
  return typeof meta['ahpd.startedAt'] === 'string'
    && typeof meta['ahpd.endedAt'] === 'string'
    && typeof meta['ahpd.durationMs'] === 'number';
};

/** Every chat action one tool call was sent, in the order it was sent. */
const forCall = (watch: Watcher, toolCallId: string): Bag[] => watch.actions
  .map((one) => one.action)
  .filter((action) => action.toolCallId === toolCallId);

it('says when a call started and ended, and reads back with the same numbers', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'times');
  await runTurn(session, watch, 't1', 'fetch it later');

  const sent = forCall(watch, 'call-later');
  const ready = sent.find((one) => one.type === 'chat/toolCallReady');
  const complete = sent.find((one) => one.type === 'chat/toolCallComplete');
  // Announced `pending` and started by a later update, so what the ready
  // carries is when the call began and no end yet.
  expect(typeof metaOf(ready)['ahpd.startedAt']).toBe('string');
  expect(metaOf(ready)['ahpd.endedAt']).toBeUndefined();
  expect(timed(complete)).toBe(true);
  const times = metaOf(complete);
  const from = Date.parse(times['ahpd.startedAt'] as string);
  const until_ = Date.parse(times['ahpd.endedAt'] as string);
  expect(until_).toBeGreaterThanOrEqual(from);
  expect(times['ahpd.durationMs']).toBe(until_ - from);

  // The same call, read back out of what this process kept.
  const turns = await agent.transcript?.(String(session.agentId()));
  const parts = turns?.[0]?.responseParts as Bag[];
  const held = parts.find((one) => one.id === 'call-later')?.toolCall as Bag;
  expect(held._meta).toEqual(times);
});

it('starts a call at the first update about it, and ends it at the one that finished it', () => {
  const turn: AcpTurn = { turnId: 't1', parts: [], calls: new Map() };
  mapUpdate(turn, toolCall('c1', 'pending'), 1_000);
  mapUpdate(turn, toolCallUpdate('c1', 'in_progress'), 2_000);
  mapUpdate(turn, toolCallUpdate('c1', 'completed'), 5_000);

  const held = metaOf(turn.parts[0]?.toolCall as Bag);
  // The later update is what the agent began the call on, but the first word
  // about it is what the call started at.
  expect(held['ahpd.startedAt']).toBe(new Date(1_000).toISOString());
  expect(held['ahpd.endedAt']).toBe(new Date(5_000).toISOString());
  expect(held['ahpd.durationMs']).toBe(4_000);
});

it('stamps a call whose row a permission question opened at its first update', () => {
  const turn: AcpTurn = { turnId: 't1', parts: [], calls: new Map() };
  // The row a `session/request_permission` opened, left the way the session
  // leaves it for the mapping to find: a call nobody has heard anything about.
  turn.calls.set('c1', { toolCallId: 'c1', toolName: 'rm', displayName: 'Remove', readied: true, asked: true });
  turn.parts.push({ id: 'c1', kind: 'toolCall', toolCall: { toolCallId: 'c1', toolName: 'rm', displayName: 'Remove', status: 'streaming' } });

  const sent = mapUpdate(turn, {
    sessionUpdate: 'tool_call_update',
    toolCallId: 'c1',
    status: 'in_progress',
    content: [{ type: 'content', content: { type: 'text', text: 'working' } }],
  } as unknown as SessionUpdate, 3_000);
  const held = metaOf(turn.parts[0]?.toolCall as Bag);
  expect(held['ahpd.startedAt']).toBe(new Date(3_000).toISOString());
  // The row is already open, so no start action goes out and the first action
  // sent for the call is what carries the times.
  expect(sent.map((one) => one.type)).toEqual(['chat/toolCallContentChanged']);
  expect(metaOf(sent[0])['ahpd.startedAt']).toBe(held['ahpd.startedAt']);
});

it('times a call that arrives already finished as one moment', () => {
  const turn: AcpTurn = { turnId: 't1', parts: [], calls: new Map() };
  const sent = mapUpdate(turn, toolCall('c1', 'completed'), 7_000);
  const complete = sent.find((one) => one.type === 'chat/toolCallComplete');
  const held = metaOf(turn.parts[0]?.toolCall as Bag);
  expect(held['ahpd.startedAt']).toBe(new Date(7_000).toISOString());
  expect(held['ahpd.endedAt']).toBe(held['ahpd.startedAt']);
  expect(held['ahpd.durationMs']).toBe(0);
  expect(metaOf(complete)).toEqual(held);
});

it('stamps nothing for an update a session load replayed', () => {
  const turn: AcpTurn = { turnId: 't1', parts: [], calls: new Map() };
  // No `at`: the update carries no receive time of its own, and the replay's
  // own clock would time a call by when this process read about it.
  const sent = mapUpdate(turn, toolCall('c1', 'pending'));
  mapUpdate(turn, toolCallUpdate('c1', 'completed'));
  expect(sent.every((one) => one._meta === undefined)).toBe(true);
  expect((turn.parts[0]?.toolCall as Bag)._meta).toBeUndefined();
});

it('says when a command of the person\'s own ran, and how long it took', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'shell');
  const before = watch.endings().length;
  session.ran?.('t1', 'echo hi', async () => ({ success: true, said: 'echoed', output: 'hi\n' }));
  await until(() => watch.endings().length > before);

  const sent = forCall(watch, 't1:command');
  const ready = sent.find((one) => one.type === 'chat/toolCallReady');
  const complete = sent.find((one) => one.type === 'chat/toolCallComplete');
  expect(typeof metaOf(ready)['ahpd.startedAt']).toBe('string');
  expect(metaOf(ready)['ahpd.endedAt']).toBeUndefined();
  expect(timed(complete)).toBe(true);
});

it('reports the folder a session is in as a URI a host reads back as that folder', () => {
  const { agent } = backend();
  /*
   * The session's own directory, as the host reads it: a folder called `C# a b`
   * sent as `file:///…/C# a b` is a folder called `C` to a reader that takes
   * `#` for a fragment, and one node reads `C# a b` where the name has a space.
   * Nothing here runs a turn - the bridge reports the directory it was started
   * in, and that is what a `!` command and a diff's base are read from.
   */
  const where = join(scratch(), 'C# a b');
  mkdirSync(where);
  const { session } = start(agent, 'uris', { workingDirectory: where });
  const asked = [uriOf(where)];
  expect(session.workingDirectories()).toEqual(asked);
  expect((session.sessionState() as { workingDirectories: string[] }).workingDirectories).toEqual(asked);
});

it('never writes a bare timing key on a call', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'bare');
  await runTurn(session, watch, 't1', 'fetch it later');
  const bare = ['startedAt', 'endedAt', 'durationMs'];
  expect(watch.actions.every((one) => bare.every((key) => metaOf(one.action)[key] === undefined))).toBe(true);
});

it('declares every field a preset machine takes as a property of the machine schema', () => {
  const machine = optionsSchema.properties.presets.additionalProperties.properties.machine;
  const properties = machine.properties as Record<string, Record<string, unknown>>;
  for (const key of MACHINE_KEYS) {
    expect(properties, key).toHaveProperty(key);
    expect(typeof properties[key]?.description, key).toBe('string');
    expect(machine.description, key).toContain(key);
  }
});

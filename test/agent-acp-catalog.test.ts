import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import type { Agent, Bag, Emit, Session, Start } from '@ahpd/sdk';
import { acpAgent } from '../packages/agent-acp/src/index.js';

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

/** The backend under test, with its own request log. */
function backend(): { agent: Agent; log: string } {
  const log = join(scratch(), 'requests.jsonl');
  return {
    agent: acpAgent({
      command: process.execPath,
      args: [FIXTURE],
      env: { ACP_LOG: log },
      provider: 'acp',
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

/** Every request the fixture was sent, in order. */
const requests = (log: string): { method?: string; params?: Record<string, unknown> }[] => {
  try {
    return readFileSync(log, 'utf8').trim().split('\n').filter(Boolean)
      .map((line) => JSON.parse(line) as { method?: string; params?: Record<string, unknown> });
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

it('reports a command the server advertises as a customization', async () => {
  const { agent } = backend();
  const { session, watch } = start(agent, 'commands');
  await runTurn(session, watch, 't1', 'hi');

  const plan = session.customizations().find((one) => one.name === 'plan');
  expect(plan).toMatchObject({ type: 'prompt', id: 'command:plan', enabled: true, description: 'Draft a plan' });
  expect(watch.actions.some((one) => one.channel === 'session'
    && one.action.type === 'session/customizationsChanged')).toBe(true);
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
  expect(await agent.transcript?.('a-session-nobody-watched')).toBeUndefined();
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

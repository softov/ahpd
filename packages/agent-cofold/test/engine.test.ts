import { WAIT_MS } from '../../../tools/wait.ts';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { createFakeModel } from '@cofold/agents/testing';
import { echo } from '../../../examples/echo/agent.js';
import { loadPlugins } from '../../server/src/plugins.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import { startedNow } from '../../sdk/test/support/started.js';
import type { Engine, AgentView, Bag, Session, Start } from '@ahpd/sdk';

/*
 * The `cofold` engine: one record per endpoint and key.
 *
 * A record is opened by the engine rather than registered as an agent of its
 * own, so the cases here are what `open` builds and when it reads the record:
 *
 * - the engine a load registers, its form, its template and its host-only
 *   fields, and the fact that the plugin adds no agent of its own;
 * - two records opening two backends, each with its own id, name and
 *   instructions;
 * - an edit to a record, which the next turn reads rather than the turn that
 *   is already running.
 *
 * The model is a script that records every request it is asked, so what each
 * turn was created with is a thing the test reads rather than infers.
 */

const REPO = join(import.meta.dirname, '../../..');
const SOURCE = './packages/agent-cofold/src/index.ts';

/** The folders and sessions one case made, released after it. */
const made: string[] = [];
const started: Session[] = [];

afterEach(async () => {
  for (const session of started.splice(0)) await session.close();
  for (const path of made.splice(0)) rmSync(path, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** A folder of its own for one case, removed after it. */
const folderOf = (label: string): string => {
  const folder = mkdtempSync(join(tmpdir(), `ahpd-cofold-engine-${label}-`));
  made.push(folder);
  return folder;
};

/** The run's zero-delay work finishing, up to a point. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

/** The frames a turn ended with, in order. */
const endings = (actions: Bag[]): string[] => actions
  .map((action) => String(action.type))
  .filter((type) => type === 'chat/turnComplete' || type === 'chat/error' || type === 'chat/turnCancelled');

/** One load of the plugin, with the store in memory so no case writes a session. */
const load = async (options: Bag = {}) => {
  const { loaded, problems, options: served } = await loadPlugins(
    [{ name: SOURCE, options: { memory: true, ...options } }],
    {
      base: { path: folderOf('base'), agents: [echo({ path: folderOf('echo') })] },
      configDir: REPO,
      cwd: REPO,
      log: () => {},
    },
  );
  return { loaded, problems, served };
};

/** The `cofold` engine one load registered. */
const engineOf = async (options: Bag = {}): Promise<Engine> => {
  const { problems, served } = await load(options);
  // An embedder's `adapter` is not in the schema, so the loader names it and
  // passes it through: that one line is the loader's, not a refusal.
  expect(problems).toEqual(options.adapter === undefined ? [] : [
    'plugin agent-cofold: plugins.agent-cofold.options.adapter is not an option agent-cofold knows; passed through',
  ]);
  const engine = served.engines?.['cofold'];
  if (engine === undefined) throw new Error('no cofold engine was registered');
  return engine;
};

/** One record, as an engine is handed it: every field read at each call. */
const viewOf = (id: string, held: () => Bag, name = id): AgentView => ({
  id,
  engine: 'cofold',
  owner: 'host',
  name,
  description: undefined,
  icon: undefined,
  model: undefined,
  get config() { return held(); },
});

/** One record's backend, and a session of it recording what it puts on the wire. */
function opened(
  engine: Engine,
  id: string,
  live: () => Bag,
  folder: string,
  name = id,
): { agent: ReturnType<Engine['open']>; session: Session; actions: Bag[] } {
  const agent = engine.open(viewOf(id, live, name));
  const actions: Bag[] = [];
  const start: Start = {
    uri: `ahp-session:/${id}`,
    chatUri: `ahp-chat:/${id}`,
    settings: {},
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel, action) => { actions.push(action as Bag); },
    workingDirectory: folder,
  };
  const session = startedNow(agent.create(start));
  started.push(session);
  return { agent, session, actions };
}

it('registers the cofold engine, its form, its template and its host-only fields, and no agent', async () => {
  const { problems, served } = await load();
  expect(problems).toEqual([]);
  const engine = served.engines?.['cofold'];
  expect(engine).toMatchObject({
    name: 'cofold',
    title: 'Cofold',
    hostOnly: ['computerConfigDir', 'store', 'memory'],
  });
  expect(typeof engine?.open).toBe('function');

  // The fields of one record: what this backend has, without the four the
  // agents channel owns and without the two only an embedder can set.
  const fields = Object.keys((engine?.schema.properties ?? {}) as Bag).sort();
  expect(fields).toEqual([
    'apiKey', 'autoCompactTokens', 'baseUrl', 'computerConfigDir', 'hostTools', 'instructions', 'memory', 'resource', 'store', 'tools',
  ]);
  for (const owned of ['provider', 'displayName', 'name', 'description', 'icon', 'model', 'adapter', 'policy', 'strictTools']) {
    expect(fields).not.toContain(owned);
  }
  // A record's key is vaulted and answered as set, never read back.
  expect((engine?.schema.properties as Bag | undefined)?.['apiKey']).toMatchObject({ type: 'string', secret: true });

  // One template, and it sets nothing: a record made from it runs on the
  // harness configuration at ~/.config/cofold/config.json, which the harness
  // itself reads.
  const templates = engine?.templates ?? [];
  expect(templates).toHaveLength(1);
  expect(templates[0]?.name).toBe('Cofold');
  expect(templates[0]?.config).toEqual({});
  expect(templates[0]?.description).toContain('~/.config/cofold/config.json');

  // The plugin registers the engine and no agent: every agent is a record.
  expect(served.agents).toHaveLength(1);
});

it('opens one backend per record, with the record\'s own id, name and instructions', async () => {
  const model = createFakeModel({ script: [{ text: 'answered one' }, { text: 'answered two' }], stream: true });
  const engine = await engineOf({ adapter: model });
  const first = opened(engine, 'cofold-one', () => ({ instructions: 'You answer as One.' }), folderOf('one'), 'One');
  const second = opened(engine, 'cofold-two', () => ({ instructions: 'You answer as Two.' }), folderOf('two'), 'Two');

  expect([first.agent.provider, first.agent.displayName]).toEqual(['cofold-one', 'One']);
  expect([second.agent.provider, second.agent.displayName]).toEqual(['cofold-two', 'Two']);

  // One at a time, so the request each turn made is the request of that agent.
  first.session.sendMessage('t1', 'hello');
  await until(() => endings(first.actions).length === 1);
  second.session.sendMessage('t1', 'hello');
  await until(() => endings(second.actions).length === 1);
  expect(endings(first.actions)).toEqual(['chat/turnComplete']);
  expect(endings(second.actions)).toEqual(['chat/turnComplete']);

  expect(model.requests).toHaveLength(2);
  expect(model.requests[0]?.instructions).toContain('You answer as One.');
  expect(model.requests[1]?.instructions).toContain('You answer as Two.');
});

it('applies an edit at the next turn, not to the one already running', async () => {
  const model = createFakeModel({ script: [{ text: 'first' }, { text: 'second' }], stream: true });
  const engine = await engineOf({ adapter: model });
  let held: Bag = { instructions: 'You are the first.' };
  const { session, actions } = opened(engine, 'cofold-live', () => held, folderOf('live'));

  session.sendMessage('t1', 'first');
  await until(() => endings(actions).length === 1);
  expect(endings(actions)).toEqual(['chat/turnComplete']);

  // The record changes under the session. The second turn is built from what
  // it says now, because a session reads its record before each turn.
  held = { instructions: 'You are the second.' };
  session.sendMessage('t2', 'second');
  await until(() => endings(actions).length === 2);
  expect(endings(actions)).toEqual(['chat/turnComplete', 'chat/turnComplete']);

  expect(model.requests).toHaveLength(2);
  expect(model.requests[0]?.instructions).toContain('You are the first.');
  expect(model.requests[1]?.instructions).toContain('You are the second.');
});

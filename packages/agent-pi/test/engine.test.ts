import { WAIT_MS } from '../../../tools/wait.ts';
import { afterEach, expect, it } from 'vitest';
import type { Engine, AgentView, Bag, PluginHost, Session, Start } from '../../sdk/src/types/index.js';
import { DEFAULT_CLIENT_TOOL_TIMEOUT_MS } from '../../sdk/src/tools/clientcalls.js';
import type { BackendOptions, OpenPi } from '../src/index.js';
import { apply } from '../src/plugin.js';
import { PI_KEY_VARIABLES } from '../src/machine.js';
import { fakePi, root } from './fake-pi.js';
import { startedNow } from '../../sdk/test/support/started.js';

/*
 * The `pi` engine: one record per pi agent.
 *
 * A record is opened by the engine rather than registered as an agent of its
 * own, so the cases here are what `open` builds and when it reads the record:
 *
 * - the engine a load registers, its form, its template, its host-only field and
 *   its key variables, and the fact that the plugin adds no agent of its own;
 * - two records opening two backends, each with its own id, name, model and
 *   variables;
 * - an edit to a record, which the next turn reads rather than the turn that
 *   is already running.
 *
 * The backend is a test's own, through the `open` option an embedder may pass:
 * what pi is told at each turn is then a thing the test reads rather than
 * infers, and no model provider is needed.
 */

/** The sessions one case started, released after it. */
const started: Session[] = [];

afterEach(async () => {
  for (const session of started.splice(0)) await session.close();
});

/** The run's zero-delay work finishing, up to a point. */
const until = async (check: () => boolean, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (check()) return;
    await new Promise((resolve) => { setTimeout(resolve, 1); });
  }
  throw new Error(`still waiting after ${ms} ms`);
};

/** One record, as an engine is handed it: every field read at each call. */
const viewOf = (
  id: string,
  held: () => Bag,
  over: { name?: string; model?: () => string | undefined } = {},
): AgentView => ({
  id,
  engine: 'pi',
  owner: 'host',
  name: over.name ?? id,
  description: undefined,
  icon: undefined,
  get model() { return over.model?.(); },
  get config() { return held(); },
});

/** A host that keeps the engine a load registers, and a case's own `open`. */
const kindWith = (open: OpenPi): Engine => {
  const engines: Record<string, Engine> = {};
  const host = {
    paths: [root],
    registerEngine: (engine: Engine) => { engines[engine.name] = engine; },
  } as unknown as PluginHost;
  apply(host, { open });
  const engine = engines['pi'];
  if (engine === undefined) throw new Error('no pi engine was registered');
  return engine;
};

/** One record's agent, a session of it, and everything the session emitted. */
function opened(agent: ReturnType<Engine['open']>): { session: Session; sent: Bag[] } {
  const sent: Bag[] = [];
  const start = {
    uri: 'ahp-session:/pi-engine',
    chatUri: 'ahp-chat:/pi-engine',
    settings: {},
    clientToolTimeoutMs: DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
    workingDirectory: root,
    schema: () => ({ type: 'object', properties: {} }),
    emit: (_channel: string, action: Bag) => { sent.push(action); },
    trusted: () => true,
  } as Start;
  const session = startedNow(agent.create(start));
  started.push(session);
  return { session, sent };
}

/** The frames a turn ended with, in order. */
const endings = (sent: Bag[]): string[] => sent
  .map((action) => String(action.type))
  .filter((type) => type === 'chat/turnComplete' || type === 'chat/error' || type === 'chat/turnCancelled');

/**
 * The message each turn ran with, in order, as the agent reads its turns back:
 * the read names the model a turn ran on, where the start every client holds
 * is the message as the client sent it. The fake pi's session is `pi-session-1`.
 */
const ran = async (agent: ReturnType<Engine['open']>): Promise<Bag[]> =>
  ((await agent.transcript?.('pi-session-1')) ?? []).map((turn) => turn.message as unknown as Bag);

it('registers the pi engine, its form, its template, its host-only field and its key variables', () => {
  const engine = kindWith(async () => fakePi().backend);

  expect(engine).toMatchObject({ name: 'pi', title: 'pi', hostOnly: ['sessionDir'] });
  expect(typeof engine.open).toBe('function');

  // The fields of one record: what this backend has, without the four the
  // agents channel owns.
  const fields = Object.keys((engine.schema.properties ?? {}) as Bag).sort();
  expect(fields).toEqual(['env', 'projectTrust', 'sessionDir']);
  for (const owned of ['provider', 'displayName', 'name', 'description', 'icon', 'model']) {
    expect(fields).not.toContain(owned);
  }

  // Every variable pi takes a key from is declared, and declared secret: a
  // client is told it is set and never what it is. The channel vaults those by
  // `keyVariables`, which is the same list.
  const env = (engine.schema.properties as Bag)['env'] as Bag;
  expect(Object.keys(env.properties as Bag).sort()).toEqual([...PI_KEY_VARIABLES].sort());
  for (const variable of PI_KEY_VARIABLES) {
    expect((env.properties as Bag)[variable]).toMatchObject({ type: 'string', secret: true });
  }
  // A host record may set any other variable; a team's or a person's may not,
  // which the channel refuses by the same list.
  expect(env.additionalProperties).toEqual({ type: 'string' });
  expect(engine.keyVariables).toEqual([...PI_KEY_VARIABLES]);

  // One template, and it sets nothing: a record made from it runs on pi's own
  // agent directory and credentials, which pi itself reads.
  const templates = engine.templates ?? [];
  expect(templates).toHaveLength(1);
  expect(templates[0]?.name).toBe('pi');
  expect(templates[0]?.config).toEqual({});
});

it('opens one backend per record, with the record\'s own id, name, model, trust and variables', async () => {
  const opens: { at: BackendOptions; pi: ReturnType<typeof fakePi> }[] = [];
  const engine = kindWith(async (at) => {
    const pi = fakePi();
    opens.push({ at, pi });
    return pi.backend;
  });
  const first = engine.open(viewOf('pi-one', () => ({ env: { ANTHROPIC_API_KEY: 'one-key' }, projectTrust: 'trust' }), {
    name: 'One',
    model: () => 'anthropic/claude-opus-5',
  }));
  const second = engine.open(viewOf('pi-two', () => ({ env: { OPENAI_API_KEY: 'two-key' }, projectTrust: 'deny' }), {
    name: 'Two',
    model: () => 'openai/gpt-5',
  }));

  expect([first.provider, first.displayName]).toEqual(['pi-one', 'One']);
  expect([second.provider, second.displayName]).toEqual(['pi-two', 'Two']);

  // One at a time, so what each backend was told is that record's.
  const one = opened(first);
  one.session.sendMessage('t1', 'hello');
  await until(() => endings(one.sent).length === 1);
  const two = opened(second);
  two.session.sendMessage('t1', 'hello');
  await until(() => endings(two.sent).length === 1);
  expect(endings(one.sent)).toEqual(['chat/turnComplete']);
  expect(endings(two.sent)).toEqual(['chat/turnComplete']);

  // Each session put its own record's variables on pi, and its own trust.
  // Twice per turn: as pi opens, before its model list, and again before the
  // request.
  expect(opens.map(({ pi }) => pi.asked.filter((one) => one.kind === 'useEnv'))).toEqual([
    [
      { kind: 'useEnv', env: { ANTHROPIC_API_KEY: 'one-key' } },
      { kind: 'useEnv', env: { ANTHROPIC_API_KEY: 'one-key' } },
    ],
    [
      { kind: 'useEnv', env: { OPENAI_API_KEY: 'two-key' } },
      { kind: 'useEnv', env: { OPENAI_API_KEY: 'two-key' } },
    ],
  ]);
  expect(opens.map(({ at }) => at.trustProject)).toEqual([true, false]);

  // The model each turn ran on is the record's own.
  expect((await ran(first))[0]?.model).toMatchObject({ id: 'anthropic/claude-opus-5' });
  expect((await ran(second))[0]?.model).toMatchObject({ id: 'openai/gpt-5' });
  // The start every client holds is the message as it was sent, which named none.
  expect((one.session.chatState().turns as Bag[])[0]?.message).not.toHaveProperty('model');
});

it('applies an edit of the record at the next turn, not to the one already running', async () => {
  const pis: ReturnType<typeof fakePi>[] = [];
  const engine = kindWith(async () => {
    const pi = fakePi();
    pis.push(pi);
    return pi.backend;
  });
  let held: Bag = { env: { ANTHROPIC_API_KEY: 'first-key' } };
  let model: string | undefined;
  const agent = engine.open(viewOf('pi-live', () => held, { model: () => model }));
  const { session, sent } = opened(agent);

  session.sendMessage('t1', 'first');
  await until(() => endings(sent).length === 1);
  expect(endings(sent)).toEqual(['chat/turnComplete']);

  // The record changes under the session: another key, and a model it names
  // now. The second turn is built from what it says, because a session reads
  // its record before each turn, and the first turn was already prompted.
  held = { env: { DEEPSEEK_API_KEY: 'second-key' } };
  model = 'openai/gpt-5';
  session.sendMessage('t2', 'second');
  await until(() => endings(sent).length === 2);
  expect(endings(sent)).toEqual(['chat/turnComplete', 'chat/turnComplete']);

  const pi = pis[0]!;
  /*
   * Two for the first turn: pi is handed the record's variables as it opens,
   * before the model list, and again before the request. One for the second,
   * which carries the edit.
   */
  const used = pi.asked.filter((one) => one.kind === 'useEnv').map((one) => one.env);
  expect(used).toEqual([
    { ANTHROPIC_API_KEY: 'first-key' },
    { ANTHROPIC_API_KEY: 'first-key' },
    { DEEPSEEK_API_KEY: 'second-key' },
  ]);
  // The model moved at the second turn, and not before it.
  expect(pi.asked.filter((one) => one.kind === 'setModel')).toEqual([{ kind: 'setModel', id: 'openai/gpt-5' }]);
  expect((await ran(agent))[1]?.model).toMatchObject({ id: 'openai/gpt-5' });
  // The start every client holds is the message as it was sent, which named none.
  expect((session.chatState().turns as Bag[])[1]?.message).not.toHaveProperty('model');
});

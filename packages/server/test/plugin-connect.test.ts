import { join } from 'node:path';
import { expect, it } from 'vitest';
import { createHost } from '../../sdk/src/host.js';
import { raise } from '../../sdk/src/plugins.js';
import { idOf } from '../../sdk/src/catalog.js';
import { memorySessions } from '../../sdk/src/sessions.js';
import { loadPlugins } from '../src/plugins.js';
import { echo } from '../../../examples/echo/agent.js';
import type { Agent, Start } from '../../sdk/src/types/agent.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { HostOptions } from '../../sdk/src/types/host.js';
import type { PluginSpec } from '../../sdk/src/types/plugin.js';
import type { Peer } from '../../sdk/src/types/rpc.js';
import type { ModelUse, Usage } from '../../sdk/src/types/usage.js';
import type { Users } from '../../sdk/src/types/users.js';

/*
 * A plugin on the other side of its own host's door.
 *
 * Everything else a plugin does it does as part of the host: a backend it
 * registers, a port it sets, a tool it contributes. This is the one thing it
 * cannot be any other way, and the reason `connect()` exists - work that needs
 * a client, done on a host that only ever answers one.
 *
 * The fixture is the plugin, and it does what a bot would: it connects once the
 * socket is bound, starts a session of the backend the daemon already serves,
 * and sends the first turn as soon as somebody else is in the room. The test is
 * the somebody else, and reads the plugin's own account off the daemon's log -
 * which is the only way a loaded fixture can be asked what it did.
 */

const REPO = join(import.meta.dirname, '../../..');
const DIR = '/tmp/plugin-connect';
const SPEC = './packages/server/test/fixtures/plugin-connect';
/* Named as a client names them, which is how the watching client names them too. */
const SESSION = 'ahp-session:/connect';
const CHAT = 'ahp-chat:/connect';
/** The plugin's own id, which is what it calls its connection and its log lines. */
const BY = 'plugin-connect';

/** A client that keeps what the host said, so a test can read it back. */
const peer = (): Peer & { notes: { method: string; params: unknown }[] } => {
  const notes: { method: string; params: unknown }[] = [];
  return {
    notes,
    send: () => {},
    notify: (method, params) => notes.push({ method, params }),
    request: async () => ({}),
    answered: () => {},
    close: () => {},
  };
};

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, tries = 600): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened`);
};

/** The sign-in record a host with a directory advertises, which the type requires. */
const RECORD = { resource: 'ahpd://users', resource_name: 'ahpd users', authorization_servers: ['https://example.test'], required: false };

/**
 * A directory that knows nobody.
 *
 * Nobody has to be in it: a plugin's principal is the one its connection was
 * accepted with, and it never signs in. What the directory is here for is that
 * having one at all is what turns the gate on - without it every command is
 * served and the whole of task 02 is untestable.
 */
const directory = (): Users => ({
  resource: RECORD,
  verify: async () => undefined,
  list: async () => [],
  grantsOfRoles: async () => [],
  grantsOfPerson: async () => undefined,
  add: async () => {},
  roles: async () => [],
  addRole: async () => {},
  removeRole: async () => false,
  teams: async () => [],
  projects: async () => [],
  addTeam: async () => {},
  addProject: async () => {},
  removeTeam: async () => false,
  removeProject: async () => false,
  remove: async () => false,
  mint: async () => '',
});

/**
 * The example backend, reporting what each turn spent.
 *
 * The echo agent answers without a model, so a turn of its own is charged
 * nothing and no record is written for it. This one runs the same turn and
 * reports usage in the middle of it, which is where a harness of its own sends
 * one: a report that arrived after the turn ended is a report for a turn this
 * host has already written and let go of, and it would be dropped.
 */
const reporting = (): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    create: (start: Start) => {
      const held = base.create(start);
      return {
        ...held,
        begin: (...args: Parameters<typeof held.begin>) => {
          const turnId = String(args[0]);
          const say = (action: Bag): void => { start.emit('chat', action); };
          say({ type: 'chat/turnStarted', turnId, startedAt: new Date().toISOString(), message: { text: args[1] } });
          say({ type: 'chat/usage', turnId, usage: { inputTokens: 100, outputTokens: 20, model: 'anthropic/opus-5' } });
          say({ type: 'chat/turnComplete', turnId, duration: 1 });
        },
      };
    },
  };
};

/** An in-memory `Usage`: the records the host wrote, in the order it wrote them. */
const keeping = (): Usage & { entries: ModelUse[] } => {
  const entries: ModelUse[] = [];
  return {
    entries,
    record: (entry) => {
      entries.push(entry as ModelUse);
      return Promise.resolve();
    },
    total: () => Promise.resolve({}),
    pools: () => Promise.resolve([]),
    records: () => Promise.resolve([]),
    groups: () => Promise.resolve([]),
  };
};

/**
 * A daemon with this plugin on it, up to the moment the socket is bound.
 *
 * Not `createHost` alone: the two lines around it are `run.ts`'s, and they are
 * the whole of what a plugin's connection depends on a daemon for. The loader
 * folds the plugin in, the host is built over the folded options, the host is
 * handed back to the contribution that asked for it, and `listening` is raised
 * - which is the moment a connection may be opened.
 *
 * `extra` is what the daemon would have configured beside the plugin, which is
 * how the gate is switched on and what a turn is charged to.
 */
async function started(spec: PluginSpec = SPEC, extra: Partial<HostOptions> = {}) {
  const lines: string[] = [];
  const base: HostOptions = { path: DIR, agents: [echo({ path: DIR, pace: 0 })], ...extra };
  const { options, problems } = await loadPlugins([spec], {
    base, configDir: REPO, cwd: REPO, log: (line) => { lines.push(line); },
  });
  const host = createHost(options);
  // What `run.ts` runs once `createHost` has answered.
  for (const one of options.pluginConnects ?? []) one.host = host;
  await raise(
    options.events,
    { type: 'listening', runtime: 'node', host: '127.0.0.1', port: 0, guarded: false },
    (line) => { lines.push(line); },
  );
  return { host, lines, options, problems };
}

/** Every action type a client was sent, in the order it arrived. */
const sent = (notes: { method: string; params: unknown }[]): string[] => notes
  .filter((note) => note.method === 'action')
  .map((note) => (note.params as { action: { type: string } }).action.type);

/** The three actions of one turn, which is what says a turn happened rather than a frame. */
const TURN = ['chat/turnStarted', 'chat/responsePart', 'chat/delta'];
const turnOf = (types: string[]): string[] => types.filter((type) => TURN.includes(type));

it('serves a plugin that connects to its own host, and a watching client sees the turn', async () => {
  const { host, lines, problems } = await started();
  expect(problems).toEqual([]);

  // Which client the plugin is, said by the plugin: it introduced itself over
  // the connection it opened, and opened a session over the same one.
  await until(() => lines.includes(`${BY} opened ${SESSION}`), 'the plugin to open its session');

  /*
   * Somebody else, and only now.
   *
   * The plugin sends nothing until a client that is not itself is in the
   * session, so this subscription is what starts the turn - which also makes
   * the case free of a race: the turn cannot be missed by a client that has not
   * finished subscribing, because it is the subscription that asks for it.
   */
  const said = peer();
  const watcher = host.accept(said);
  await watcher.handle({ method: 'initialize', params: { clientId: 'watcher', protocolVersions: ['0.9.0'] } });
  await watcher.handle({ method: 'subscribe', params: { channel: SESSION } });
  await watcher.handle({ method: 'subscribe', params: { channel: CHAT } });

  // The plugin watching the same session, from the client side of it.
  await until(() => lines.includes(`${BY} saw chat/responsePart`), 'the turn the plugin sent');

  expect(turnOf(lines
    .filter((line) => line.startsWith(`${BY} saw `))
    .map((line) => line.slice(`${BY} saw `.length)))
    .slice(0, 3)).toEqual(TURN);

  // And the client that is not the plugin was sent the same turn, which is the
  // half that makes this a conversation on the host rather than a private one.
  expect(turnOf(sent(said.notes)).slice(0, 3)).toEqual(TURN);
});

it('tells a plugin that connects while apply runs, rather than handing it nothing', async () => {
  const { lines, problems } = await started({ name: SPEC, options: { when: 'apply' } });

  // Caught by the plugin, so nothing is lost: the plugin is still loaded and
  // the daemon still has it. What it was told names the plugin and says when.
  expect(problems).toEqual([]);
  const told = lines.find((line) => line.startsWith(`${BY} connect during apply:`));
  expect(told).toBeDefined();
  expect(told).toContain(`plugin ${BY}: connect needs a connection`);
  expect(told).toContain('connect from `listening` or later');
});

it('closes every connection a plugin opened when the daemon stops', async () => {
  const { host, lines, options } = await started();
  await until(() => lines.includes(`${BY} opened ${SESSION}`), 'the plugin to open its session');

  const said = peer();
  const watcher = host.accept(said);
  await watcher.handle({ method: 'initialize', params: { clientId: 'watcher', protocolVersions: ['0.9.0'] } });

  // What `run.ts` does the moment `stopping` is raised, before the host goes:
  // the connection is one the daemon opened on the plugin's behalf, so the
  // daemon is the one that takes it down.
  for (const one of options.pluginConnects ?? []) one.close();

  // Seen from the plugin's own side: its connection left the host, and it was
  // told, exactly as any other client's departure is reported.
  await until(() => lines.includes(`${BY} heard client_disconnect`), 'the plugin to see its connection go');
});

/*
 * The second half of the case: a plugin's connection is not nobody's.
 *
 * On a host with a directory every command is answered against the principal
 * the connection arrived with, and a plugin's is `plugin:<name>` - with the
 * grants its entry names and nothing else. These run the same plugin against a
 * host that verifies people, which is the whole difference.
 */

/** The line the fixture logged for a request it was refused. */
const refused = (lines: string[], method: string): string =>
  lines.find((line) => line.startsWith(`${BY} refused ${method}:`)) ?? '';

it('refuses a plugin whose entry grants it nothing the session it asks for', async () => {
  const { lines } = await started(SPEC, { users: directory() });
  await until(() => refused(lines, 'createSession') !== '', 'the plugin to be refused a session');

  // The sentence names the plugin as the principal it signed in as, which is
  // what a person reading the daemon's log needs to know.
  expect(refused(lines, 'createSession')).toContain('-32009');
  expect(refused(lines, 'createSession')).toContain(`plugin:${BY} may not session:create here`);
  expect(lines).not.toContain(`${BY} opened ${SESSION}`);
});

it('lets a plugin holding session:write start a session and refuses it an automation', async () => {
  const { lines, problems } = await started(
    { name: SPEC, grants: ['session:write'], options: { act: 'automation' } },
    { users: directory() },
  );
  expect(problems).toEqual([]);

  // The write group covers `session:create`, so the session is opened - and it
  // does not cover `automation:run`, which is the case the two subjects exist
  // for: a plugin that may work in its own sessions and may not drive the
  // host's schedule.
  await until(() => lines.includes(`${BY} opened ${SESSION}`), 'the plugin to open its session');
  await until(() => refused(lines, 'runAutomation') !== '', 'the plugin to be refused an automation');
  expect(refused(lines, 'runAutomation')).toContain('-32009');
  expect(refused(lines, 'runAutomation')).toContain(`plugin:${BY} may not automation:run here`);
});

it('drops one grant that names nothing, keeps the list beside it, and says which', async () => {
  const { lines, problems } = await started(
    { name: SPEC, grants: ['session:write', 'session:launch'] },
    { users: directory() },
  );

  // One line, naming the entry the person wrote it in: a plugin never sees its
  // own configuration, so the loader is the one that has to say it.
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain(`plugins.${BY}.grants`);
  expect(problems[0]).toContain('session:launch');

  // And the grant beside it was kept rather than the whole list dropped with
  // it: the same connection started its session.
  await until(() => lines.includes(`${BY} opened ${SESSION}`), 'the plugin to open its session');
});

it('records the work of a plugin as the plugin\'s own', async () => {
  const usage = keeping();
  const sessions = memorySessions();
  const { host, lines, problems } = await started(
    { name: SPEC, grants: ['session:write'] },
    { users: directory(), usage, sessions, agents: [reporting()] },
  );
  expect(problems).toEqual([]);
  await until(() => lines.includes(`${BY} opened ${SESSION}`), 'the plugin to open its session');

  /*
   * A client that owes nothing to the gate, which is what asks for the turn:
   * the plugin waits for somebody else to be in the session, and the turn it
   * then sends goes out on its own connection. So what is charged is the
   * plugin's, whoever else happens to be watching.
   */
  const watcher = host.accept(peer(), undefined, true);
  await watcher.handle({ method: 'initialize', params: { clientId: 'watcher', protocolVersions: ['0.9.0'] } });
  await watcher.handle({ method: 'subscribe', params: { channel: SESSION } });

  await until(() => usage.entries.length > 0, 'the turn to be metered');
  expect(sessions.owner(idOf(SESSION))).toBe(`plugin:${BY}`);
  // Its own pool and no other: a plugin belongs to no team, so there is no
  // second pool for its work to be charged to.
  expect(usage.entries[0]).toMatchObject({ owner: `plugin:${BY}`, pools: [`plugin:${BY}`] });
});

import { loggerOf } from '../src/log.js';
import { beforeEach, expect, it, vi } from 'vitest';
import { idOf } from '../src/sessions/catalog.js';
import { ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins/plugins.js';
import { memorySessions } from '../src/sessions/sessions.js';
import { sdkVersion } from '../src/version.js';
import {
  claude, createHost, echo, machine, resetSdk, sdk,
} from './support/host.js';
import {
  directory, hello, peer, signIn,
} from './users-gate-helpers.js';
import type { Agent, Start } from '../src/types/agent.js';
import type { AgentOwner } from '../src/types/agents.js';
import type { HostOptions } from '../src/types/host.js';
import type { LoaderContext } from '../src/types/plugin.js';
import type { Grant } from '../src/types/users.js';
import { WAIT_MS } from '../../../tools/wait.ts';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * A plugin starting a session for somebody.
 *
 * A backend a plugin registers runs turns for whoever is at the keyboard, and a
 * plugin whose own work needs a session - a bot, a machine that has to be talked
 * to - has nobody to be. This is the seam: the plugin names an owner, its host
 * starts the session as that owner taking the steps an automation's run takes,
 * and everything the host already asks of work started for a person is asked
 * here too.
 */

const DIR = '/home/softov';

/** The context every plugin in this repository is handed, without a daemon. */
const context = (): LoaderContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: loggerOf(() => {}), say: () => {},
});

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, ms = WAIT_MS): Promise<void> => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened in ${ms} ms`);
};

/** A client signed in as `who`, which is what puts them in the host's book. */
async function open(host: ReturnType<typeof createHost>, who: string) {
  const client = host.accept(peer());
  await hello(client, who);
  await signIn(client, who);
  return client;
}

/**
 * One host, one plugin that starts sessions, and the sessions it starts.
 *
 * The plugin is folded into the host the way the loader folds it, rather than
 * being handed a host built by hand: `startSession` reaches a live host through
 * the contribution, so a version of this that skipped the fold would be testing
 * something no daemon does.
 */
function starting(tokens: Record<string, Grant[]>, over: Partial<HostOptions> = {}) {
  const sessions = memorySessions();
  const { host: plugin, contribution } = pluginHost('bots', context());
  const base: HostOptions = {
    path: DIR,
    agents: [claude({ paths: [DIR] })],
    ...machine(),
    sessions,
    users: directory(tokens),
    ...over,
  };
  const { options, problems } = foldHostOptions(base, [contribution]);
  const host = createHost(options);
  return { plugin, host, sessions, problems };
}

/** The same, with the one person these cases are about already signed in. */
const startingWith = async (tokens: Record<string, Grant[]>, who: string, over: Partial<HostOptions> = {}) => {
  const made = starting(tokens, over);
  const client = await open(made.host, who);
  return { ...made, client };
};

/** The refusal, or the result, whichever the host answered with. */
const refused = async (one: Promise<unknown>) => one.then(
  () => undefined,
  (error: { code?: number; message: string; data?: unknown }) => ({
    code: error.code, message: error.message, data: error.data,
  }),
);

it('starts a session for an owner, and it is theirs', async () => {
  const { plugin, host, sessions } = starting({ soft: ['session:*'] });
  const client = await open(host, 'soft');

  const uri = await plugin.startSession({ owner: 'user:soft', prompt: 'Say hello to the bot' });

  // Whose it is, recorded the way every other owned session is: the host opened
  // it as `forWhom` of the owner, which is what a resume and a charge read.
  expect(sessions.owner(idOf(uri))).toBe('user:soft');

  // And it is in the catalogue a client of theirs reads, which is the half that
  // makes it a session they have rather than one that merely exists.
  const listed = await client.handle({ method: 'listSessions', params: { channel: ROOT } }) as {
    items: { resource: string }[];
  };
  expect(listed.items.map((one) => one.resource)).toContain(uri);

  // The prompt is the first turn: a session nobody has said anything in is a
  // session that does nothing, which is the whole reason a plugin asks.
  await until(() => sdk.said.some((line) => line.includes('Say hello to the bot')), 'the first turn');
});

it('refuses an owner who may not create a session, in the client\'s own words', async () => {
  const { plugin, client } = await startingWith({ soft: ['session:list'] }, 'soft');

  /*
   * The same question a client is asked at the door, and the same answer: a
   * plugin may not start work the person it is for could not start themselves,
   * and a refusal a client branches on has to read the same whichever door the
   * work came through.
   */
  const fromPlugin = await refused(plugin.startSession({ owner: 'user:soft', prompt: 'Say hello' }));
  const fromClient = await refused(client.handle({
    method: 'createSession', params: { channel: 'ahp-session:/mine', provider: 'claude' },
  }));
  expect(fromPlugin).toEqual(fromClient);
  expect(fromPlugin?.code).toBe(-32009);
});

/**
 * A backend that says when it was spawned, so the door and the spawn can be
 * ordered. Echo rather than the fake Claude, because the case is about when the
 * backend was asked rather than what it did.
 */
const watched = (order: string[]): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    provider: 'watched',
    create: (start: Start) => { order.push('spawn'); return base.create(start); },
  };
};

it('names the session once, with the URI it answers, before the backend spawns', async () => {
  const order: string[] = [];
  const { plugin } = await startingWith({ soft: ['session:create'] }, 'soft', { agents: [watched(order)] });
  const seen: string[] = [];

  const uri = await plugin.startSession({ owner: 'user:soft', provider: 'watched', prompt: 'Say hello' }, (one) => {
    order.push('named');
    seen.push(one);
  });

  // The URI the start answers is the one the plugin was told, and it was told
  // before anything was made: the tool list the backend is spawned with is the
  // one built during `isolated`, which is after this.
  expect(seen).toEqual([uri]);
  expect(order).toEqual(['named', 'spawn']);
});

it('starts the session when the plugin\'s door throws, and says so in the log', async () => {
  const lines: string[] = [];
  const { plugin } = await startingWith({ soft: ['session:create'] }, 'soft', {
    onEvent: (line) => { lines.push(line); },
  });

  const uri = await plugin.startSession({ owner: 'user:soft', prompt: 'Say hello' }, () => {
    throw new Error('nobody is listening');
  });

  // The plugin heard as much as it could, and what it does with that is not a
  // reason to refuse the work the person asked for.
  expect(uri).toMatch(/^ahp-session:\//);
  expect(lines.some((line) => line.includes(uri) && line.includes('nobody is listening'))).toBe(true);
});

it('refuses a door that is not a function, at the boundary', () => {
  const { plugin } = starting({ soft: ['session:create'] });

  expect(() => plugin.startSession({ owner: 'user:soft' }, 'nobody' as never))
    .toThrow(/plugin bots: startSession needs the door to be a function to call with the session's URI, or nothing/);
});

it('asks for computer:write when the config names a source, as a run does', async () => {
  // Named the way an automation names one and a client names one: a source is a
  // machine made for this session, and making one is the grant.
  const asking = { owner: 'user:soft' as const, config: { computer: 'store:code' }, prompt: 'Say hello' };

  const asking_ = await startingWith({ soft: ['session:create'] }, 'soft');
  expect(await refused(asking_.plugin.startSession(asking)))
    .toMatchObject({ code: -32009, message: 'soft may not computer:write here' });

  // And held, the same call gets past that question: what stops it then names
  // the machine rather than the person, which is what says the two are not the
  // same refusal.
  const granted = await startingWith({ soft: ['session:create', 'computer:*'] }, 'soft');
  const stopped = await refused(granted.plugin.startSession(asking));
  expect(stopped?.message).toContain('store:code');
});

/*
 * A chat a plugin starts inside a session it already has.
 *
 * A bot wakes to answer somebody and says what it has to say in a chat of that
 * session - a Back chat may run a harness the Front does not - so the seam is
 * a chat by name, on a backend by name, with that backend's config.
 */

/**
 * A second backend, recording every chat it is asked to start.
 *
 * Echo rather than the fake Claude: the point of the case is which agent the
 * chat went to, and a backend that records its own start says that without a
 * turn having to run. `voice` is a key of its own, so what a config was
 * checked against can be told apart.
 */
const other = (starts: Start[]): Agent => {
  const base = echo({ path: DIR, pace: 0 });
  return {
    ...base,
    provider: 'other',
    schema: () => {
      const schema = base.schema();
      const properties = { ...(schema.properties as Record<string, Record<string, unknown>>) };
      properties.voice = { type: 'string', title: 'Voice' };
      return { ...schema, properties };
    },
    create: (start: Start) => { starts.push(start); return base.create(start); },
  };
};

/*
 * The backend these cases run on, owned by the person at the keyboard.
 *
 * A record of one's own is an agent a person may use without `session:write`,
 * and that is what these cases need: a host agent takes `session:write` to be
 * started on, and that grant covers a chat's group as well, because a chat's
 * groups are the session's - so a role holding it can never be one that may not
 * add a chat.
 */
const OWN = new Map<string, AgentOwner>([['claude', 'user:soft'], ['other', 'user:soft']]);

/** One session the person started, which the plugin then adds a chat to. */
const started = async (
  client: ReturnType<ReturnType<typeof createHost>['accept']>, name = 'back',
): Promise<string> => {
  // A machine of the session's own and a key its own backend declares: what
  // reaches a chat of another backend and what must not is read off these.
  await client.handle({
    method: 'createSession',
    params: { channel: `ahp-session:/${name}`, provider: 'claude', config: { computer: '', permissionMode: 'plan' } },
  });
  return `ahp-session:/${name}`;
};

it('starts a chat on the backend the plugin names, with that backend\'s config', async () => {
  const starts: Start[] = [];
  const { plugin, client } = await startingWith({ soft: ['session:create', 'session:read', 'chat:create'] }, 'soft', {
    agents: [claude({ paths: [DIR] }), other(starts)],
    agentOwners: () => OWN,
  });
  const session = await started(client);

  const chat = await plugin.startChat(session, { provider: 'other', config: { voice: 'loud' }, prompt: 'Say hello' });
  expect(chat).toMatch(/^ahp-chat:\/[0-9a-f-]+$/);

  // Started on the backend it named, handed the config it asked for.
  expect(starts).toHaveLength(1);
  expect(starts[0]?.settings).toMatchObject({ voice: 'loud' });
  /*
   * The session's machine reaches the chat, because no backend owns
   * `computer`, and the session backend's own key does not: `permissionMode`
   * is Claude's, and means nothing to a harness asked for this chat.
   */
  expect(starts[0]?.settings.computer).toBe('');
  expect(starts[0]?.settings).not.toHaveProperty('permissionMode');

  // The chat is one of the session's, and the session is still Claude's.
  const snapshot = (await client.handle({ method: 'subscribe', params: { channel: session } }) as {
    snapshot: { state: { provider?: string; chats: { resource: string }[] } };
  }).snapshot;
  expect(snapshot.state.provider).toBe('claude');
  expect(snapshot.state.chats.map((one) => one.resource)).toContain(chat);
});

it('refuses a chat the session\'s owner may not create, in the client\'s own words', async () => {
  const { plugin, client } = await startingWith({ soft: ['session:create', 'session:read'] }, 'soft', {
    agentOwners: () => OWN,
  });
  const session = await started(client);

  /*
   * The same question a client is asked at the door, and the same answer: a
   * plugin may not add a chat the person the session belongs to could not have
   * added themselves. The session was made and the chat was not.
   */
  const fromPlugin = await refused(plugin.startChat(session, { prompt: 'Say hello' }));
  const fromClient = await refused(client.handle({
    method: 'createChat', params: { channel: session, chat: 'ahp-chat:/second' },
  }));
  expect(fromPlugin).toEqual(fromClient);
  expect(fromPlugin).toMatchObject({ code: -32009, message: 'soft may not chat:create here' });
});

it('refuses a backend it does not have, and a value that backend does not take', async () => {
  const starts: Start[] = [];
  const { plugin, client } = await startingWith({ soft: ['session:create', 'session:read', 'chat:create'] }, 'soft', {
    agents: [claude({ paths: [DIR] }), other(starts)],
    agentOwners: () => OWN,
  });
  const session = await started(client);

  // A backend this host does not hold is refused rather than quietly started
  // on the session's own: the plugin asked for a harness, and did not get it.
  expect(await refused(plugin.startChat(session, { provider: 'nobody', prompt: 'Say hello' })))
    .toMatchObject({ message: 'No agent provider registered for: nobody' });

  // And a value the named backend's schema refuses, before anything starts.
  const refusedValue = await refused(plugin.startChat(session, {
    provider: 'other', config: { voice: 42 }, prompt: 'Say hello',
  }));
  expect(refusedValue?.message).toContain('voice 42 is not a value other takes');
  // Neither refusal made a chat.
  expect(starts).toHaveLength(0);
});

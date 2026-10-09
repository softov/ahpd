import { beforeEach, expect, it, vi } from 'vitest';
import { idOf } from '../src/catalog.js';
import { ROOT } from '../src/host.js';
import { foldHostOptions, pluginHost } from '../src/plugins.js';
import { memorySessions } from '../src/sessions.js';
import { sdkVersion } from '../src/version.js';
import {
  claude, createHost, machine, resetSdk, sdk,
} from './support/host.js';
import {
  directory, hello, peer, signIn,
} from './users-gate-helpers.js';
import type { HostOptions } from '../src/types/host.js';
import type { PluginContext } from '../src/types/plugin.js';
import type { Grant } from '../src/types/users.js';

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
const context = (): PluginContext => ({
  path: DIR, paths: [DIR], version: sdkVersion(), hostName: 'test', configDir: DIR, log: () => {}, say: () => {},
});

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, tries = 600): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened`);
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
const startingWith = async (tokens: Record<string, Grant[]>, who: string) => {
  const made = starting(tokens);
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

it('asks for computer:write when the config names a source, as a run does', async () => {
  // Named the way an automation names one and a client names one: a source is a
  // machine made for this session, and making one is the grant - decision
  // `a-machine-made-for-a-session-counts-against-max-and-needs-computer-write`.
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

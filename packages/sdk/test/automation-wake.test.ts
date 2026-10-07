import { beforeEach, expect, it, vi } from 'vitest';
import { memoryAutomations } from '../src/automations.js';
import { chatUriFor } from '../src/host/channels.js';
import { RECORD, directory } from './users-gate-helpers.js';
import {
  claude, createHost, hello, machine, peer, resetSdk, running, sdk, sessionQueries, settle,
} from './support/host.js';
import type { Bag } from '../src/types/common.js';
import type { AutomationStore } from '../src/types/automations.js';
import type { HostOptions } from '../src/types/host.js';
import type { Grant } from '../src/types/users.js';

vi.mock('@anthropic-ai/claude-agent-sdk', async () => (await import('./support/claude-sdk.js')).fake);

beforeEach(resetSdk);

/*
 * A session doing something, and the automation that wakes on it.
 *
 * What is checked here is the seam between the two: the stream a host already
 * emits, the rule an automation's own trigger means, and the run that starts
 * with the event in its origin and the event in its first message. The rule
 * engine's own arithmetic has its own file, and so does the reading of the
 * actions the stream is made of.
 */

const AUTOMATION = 'ahp-automation:/triage';
const MINE = 'ahp-automation:/mine';
const HERS = 'ahp-automation:/hers';
/** The channel a person presses Run on, and the session the gated cases drive. */
const AUTOMATIONS = 'ahp-automations://';
const LIVE = 'claude:/live';

/** The message a person wrote, naming every placeholder this host fills. */
const MESSAGE = 'Look at {{session}} ({{sessionTitle}}): {{event}} x{{count}} at {{at}} via {{trigger}}';

/** One automation watching for a turn that failed. */
const watching = (): Bag => ({
  title: 'Triage a failed turn',
  enabled: true,
  message: { text: MESSAGE },
  session: { provider: 'claude', workingDirectories: ['file:///home/softov'] },
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'session',
    title: 'When a turn fails',
    events: [{ id: 'turnFailed' }],
    config: {},
  }],
});

/** The same automation, saying what it does about a run of its own still going. */
const waking = (ahpd: Bag): Bag => ({ ...watching(), _meta: { ahpd } });

/** The same automation, narrowed to the sessions one filter names. */
const watchingOnly = (filter: Bag): Bag => ({
  ...watching(),
  triggers: [{ ...(watching().triggers as Bag[])[0], config: { filter } }],
});

/** The same automation, watching for a turn that has been quiet for a second. */
const watchingSilence = (): Bag => ({
  ...watching(),
  triggers: [{
    id: 't1',
    kind: 'event',
    type: 'session',
    title: 'When a turn goes quiet',
    events: [{ id: 'turnCompleted' }],
    config: { when: { turnLongerThan: '1s' } },
  }],
});

/** What driving a session through a host that knows people costs the driver. */
const DRIVER: Grant[] = ['session:create', 'session:state', 'chat:turns', 'chat:send'];

type Client = ReturnType<ReturnType<typeof createHost>['accept']>;

/** The value as a keyed object, for reading what a run was told. */
const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value as Bag
  : {});

/**
 * The runs of one automation, newest first, read off its entry.
 *
 * A run list is not what anything answers with: `fetchAutomationRuns` only
 * acknowledges, and the page arrives on the catalogue as an `automation/set`
 * carrying the automation's entry with the runs it holds and the cursor for
 * the next page. The entry is where a client reads them, so it is where these
 * cases read them - the first page is what nothing had to ask for.
 */
const runsOf = (store: AutomationStore, resource: string = AUTOMATION): Bag[] =>
  (store.get(resource)?.runs ?? []).map(bag);

/** Yield between looks until `done` says so, so a fast run is not timed by ticks. */
const until = async (done: () => boolean, what: string, tries = 600): Promise<void> => {
  for (let i = 0; i < tries; i++) {
    if (done()) return;
    await new Promise((r) => { setTimeout(r, 1); });
  }
  throw new Error(`${what} never happened`);
};

/**
 * A host with one live session, and where that session's CLI sits.
 *
 * The position is read before the session is made rather than assumed, because
 * a test that starts a second host has two live sessions and the fakes are a
 * single list.
 */
async function live(over: Partial<HostOptions> = {}) {
  const cli = sessionQueries().length;
  return { ...(await running(over)), cli };
}

/**
 * A turn that starts and does not end, which is a session in the middle of
 * something - and, in the chat an automation runs in, a person typing.
 */
const begins = async (client: Client, chat: string, turnId: string): Promise<void> => {
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chat, action: { type: 'chat/turnStarted', turnId, message: { text: 'go' } } },
  });
  await settle();
};

/**
 * One turn of a session that ended badly, which is what these rules watch.
 *
 * `cli` is which fake CLI says so: a woken run starts a session of its own,
 * and frames meant for one session must not be pushed onto another.
 */
const fails = async (client: Client, chat: string, turnId: string, cli = 0): Promise<void> => {
  await begins(client, chat, turnId);
  const fake = sessionQueries()[cli];
  if (fake === undefined) throw new Error('no session is running to fail');
  fake.frames.push({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 3 });
  fake.wake?.();
  fake.wake = undefined;
  await settle();
};

/**
 * End the turn the fake at `cli` is running, well.
 *
 * The other half of `fails`, and what an automation that runs one turn at a
 * time is waiting for: a run whose turn has ended is a run nothing is going to
 * hold an event behind.
 */
const ends = async (cli: number): Promise<void> => {
  const fake = sessionQueries()[cli];
  if (fake === undefined) throw new Error('no session is running to end');
  fake.frames.push({ type: 'result', subtype: 'success', is_error: false, duration_ms: 3 });
  fake.wake?.();
  fake.wake = undefined;
  await settle();
};

const signIn = async (client: Client, token: string): Promise<void> => {
  await client.handle({ method: 'authenticate', params: { channel: 'ahp-root://', resource: RECORD.resource, token } });
};

/**
 * A host with a people directory, and one client signed in as `who`.
 *
 * Signed in first, because a host that knows people refuses a create to a
 * connection nobody has answered for - so the session these tests watch is one
 * somebody made, and an automation may be owned by somebody else again.
 */
async function gated(tokens: Record<string, Grant[]>, store: AutomationStore, who: string) {
  const host = createHost({
    path: '/home/softov',
    agents: [claude({ paths: ['/home/softov'] })],
    ...machine(),
    automations: store,
    users: directory(tokens),
  });
  const cli = sessionQueries().length;
  const client = host.accept(peer());
  await client.handle(hello(['0.9.0'], { clientId: who, initialSubscriptions: ['ahp-root://'] }));
  await signIn(client, who);
  const uri = 'ahp-session:/live';
  await client.handle({ method: 'createSession', params: { channel: uri, provider: 'claude' } });
  const opened = await client.handle({ method: 'subscribe', params: { channel: uri } }) as {
    snapshot: { state: { defaultChat: string } };
  };
  const chatUri = opened.snapshot.state.defaultChat;
  await client.handle({ method: 'subscribe', params: { channel: chatUri } });
  return { host, client, chatUri, cli };
}

it('starts a run with a trigger origin when the rule matches', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, watching());
  expect(runsOf(store)).toEqual([]);

  await fails(client, chatUri, 't1', cli);
  await until(() => runsOf(store).length === 1, 'the run');

  const run = bag(runsOf(store)[0]);
  // The origin names the trigger that matched and carries the event: a client
  // reading why a run exists reads this and not the message.
  expect(bag(run['origin'])).toMatchObject({
    kind: 'trigger',
    triggerId: 't1',
    event: { kind: 'turnFailed', count: 1, running: false },
  });
  expect(run['automation']).toBe(AUTOMATION);
  // And it ran something, rather than only being recorded.
  expect(String(run['primarySession'])).toMatch(/^claude:\//);
});

it('fills the placeholders and adds the summary block', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, watching());
  // A title, so the session line is the one a person recognises rather than
  // whatever the harness first called it.
  await client.handle({
    method: 'dispatchAction',
    params: { channel: chatUri, action: { type: 'session/titleChanged', title: 'Nightly live' } },
  });
  await settle();

  const said = sdk.said.length;
  await fails(client, chatUri, 't1', cli);
  await until(() => sdk.said.length > said, "the run's first message");

  const event = bag(bag(bag(runsOf(store)[0])['origin'])['event']);
  const session = String(event['session']);
  const at = String(event['at']);
  expect(session).toMatch(/^claude:\//);
  // Every placeholder filled, and the block after the message - which is where
  // a run that names nothing at all still learns what it is answering.
  expect(sdk.said.at(-1)).toBe(
    `Look at ${session} (Nightly live): A turn failed x1 at ${at} via When a turn fails`
    + `\n\nWhat woke this run: A turn failed\nSession: Nightly live (${session})\nCount: 1\nAt: ${at}`,
  );
});

it('ignores a session the owner may not read', async () => {
  const store = memoryAutomations();
  const { host, client, chatUri, cli } = await gated({ admin: [...DRIVER, 'session:read'], alice: ['file:read'] }, store, 'admin');
  // Alice is somebody this host has met, and reading a session is not hers.
  const hers = host.accept(peer());
  await hers.handle(hello(['0.9.0'], { clientId: 'alice', initialSubscriptions: ['ahp-root://'] }));
  await signIn(hers, 'alice');

  store.create(MINE, watching(), 'user:admin');
  store.create(HERS, watching(), 'user:alice');

  await fails(client, chatUri, 't1', cli);
  await until(() => runsOf(store, MINE).length === 1, "the admin's run");
  // The same event, and the owner of the other automation may not look at the
  // session it happened in.
  expect(runsOf(store, HERS)).toEqual([]);
});

it('ignores every session when the owner has not signed in', async () => {
  const store = memoryAutomations();
  const { host, client, chatUri, cli } = await gated({ admin: DRIVER, bob: ['session:read'] }, store, 'admin');
  store.create(AUTOMATION, watching(), 'user:bob');

  await fails(client, chatUri, 't1', cli);
  await settle(8);
  // Bob has never signed in on this host, so a rule of his has no grants to
  // read a session with - and one nobody has met is not one to guess about.
  expect(runsOf(store)).toEqual([]);

  // And the same event, once he has: the rule was right all along, and what
  // was missing was the person behind it.
  const bob = host.accept(peer());
  await bob.handle(hello(['0.9.0'], { clientId: 'bob', initialSubscriptions: ['ahp-root://'] }));
  await signIn(bob, 'bob');
  await fails(client, chatUri, 't2', cli);
  await until(() => runsOf(store).length === 1, "bob's run");
});

it('gives an automation with no owner every session, and none when the host says so', async () => {
  // An automation nobody made is nobody's work, so every session is offered
  // to it.
  const store = memoryAutomations();
  const first = await live({ automations: store });
  store.create(AUTOMATION, watching());
  await fails(first.client, first.chatUri, 't1', first.cli);
  await until(() => runsOf(store).length === 1, 'the unowned run');

  // And a daemon told otherwise wakes on nothing, which is the switch for a
  // host shared by people whose sessions are not each other's business.
  const shut = memoryAutomations();
  const second = await live({ automations: shut, unownedAutomations: 'none' });
  shut.create(AUTOMATION, watching());
  await fails(second.client, second.chatUri, 't1', second.cli);
  await settle(8);
  expect(runsOf(shut)).toEqual([]);
});

it('wakes on a session in the folder the rule names, and on one a run made', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  // The session these tests drive works in the host's own directory, which is
  // what its events say about it.
  store.create(MINE, watchingOnly({ folders: ['file:///home/softov'] }));
  store.create(HERS, watchingOnly({ folders: ['file:///work/elsewhere'] }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runsOf(store, MINE).length === 1, 'the run for the folder');
  expect(runsOf(store, HERS)).toEqual([]);

  // And who made the session: the same event, in a session a run of another
  // automation made, reaches the rule that asks for one of those.
  const made = memoryAutomations();
  const other = await live({ automations: made });
  made.create(AUTOMATION, watching());
  made.create(MINE, watchingOnly({ automated: false }));
  made.create(HERS, watchingOnly({ automated: true }));

  await fails(other.client, other.chatUri, 't1', other.cli);
  await until(() => runsOf(made).length === 1, 'the run that makes a session');
  await until(() => runsOf(made, MINE).length === 1, 'the run for the session a person made');
  expect(runsOf(made, HERS)).toEqual([]);

  // The session the run started fails a turn the same way, and it is a session
  // an automation made rather than a person.
  const own = sessionQueries()[other.cli + 1];
  expect(own).toBeDefined();
  if (own !== undefined) {
    own.frames.push({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 3 });
    own.wake?.();
    own.wake = undefined;
  }
  await until(() => runsOf(made, HERS).length === 1, "the run for a session a run made");
  expect(runsOf(made, MINE)).toHaveLength(1);
});

it('is not woken by the sessions its own runs made', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, watching());

  await fails(client, chatUri, 't1', cli);
  await until(() => runsOf(store).length === 1, 'the first run');

  // The run's own session fails a turn the same way, which is the event the
  // rule watches. Without the guard a rule that fires on a failure would fire
  // on the failure of its own repair, for ever.
  const own = sessionQueries()[cli + 1];
  expect(own).toBeDefined();
  if (own !== undefined) {
    own.frames.push({ type: 'result', subtype: 'error_during_execution', is_error: true, duration_ms: 3 });
    own.wake?.();
    own.wake = undefined;
  }
  await settle(8);
  expect(runsOf(store)).toHaveLength(1);
});

it('stops at 20 runs an hour and logs the drop', async () => {
  const store = memoryAutomations();
  const lines: string[] = [];
  const { client, chatUri, cli } = await live({
    automations: store,
    onEvent: (line) => { lines.push(line); },
  });
  // A run for each event, which is what the cap is counted in: under the
  // default the twenty-first event would wait behind the first run rather than
  // be a run of its own, and what is being counted here is runs.
  store.create(AUTOMATION, { ...watching(), _meta: { ahpd: { overlap: 'parallel' } } });

  for (let i = 1; i <= 21; i++) await fails(client, chatUri, `t${i}`, cli);
  await until(() => lines.some((line) => line.includes('so this wake was dropped')), 'the drop');

  // One line for the one that was dropped, and twenty runs for the twenty that
  // were not: a rule that fires on every event of a busy session is a rule
  // that would otherwise start a run of its own every second.
  expect(lines.filter((line) => line.includes('so this wake was dropped')))
    .toEqual([`${AUTOMATION} woke 20 times in the last hour, so this wake was dropped`]);
  // Twenty runs, and the entry shows them all: a page nobody has paged past
  // is the whole history, so the count read here is the count there is.
  expect(runsOf(store)).toHaveLength(20);
  expect(store.get(AUTOMATION)?.runsNextCursor).toBeUndefined();
});

it('stops matching when the automation is disabled', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, watching());
  store.update(AUTOMATION, { enabled: false });

  await fails(client, chatUri, 't1', cli);
  await settle(8);
  expect(runsOf(store)).toEqual([]);

  // And switched back on, the same event wakes it: a switch that could not be
  // turned back on would be a removal wearing a boolean.
  store.update(AUTOMATION, { enabled: true });
  await fails(client, chatUri, 't2', cli);
  await until(() => runsOf(store).length === 1, 'the run after it was switched on');
});

/*
 * And what an automation says about a run of its own that is still going.
 *
 * Two answers, both in `_meta.ahpd` on the definition: whether a run makes a
 * session of its own or adds a turn to the one chat it keeps, and what an event
 * arriving mid-run does. The cases below are the whole of both, one event at a
 * time, because what is checked is which of them the host acted on.
 */

/** How many runs of the one automation these cases watch there are. */
const runCount = (store: AutomationStore): number => runsOf(store).length;

/** The newest run of it, as a keyed object. */
const newest = (store: AutomationStore): Bag => bag(runsOf(store)[0]);

it('runs a pinned automation as the next turn in the same chat', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({ session: 'pinned' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  // The session it made is kept, and the definition is where: a host that held
  // it in memory would forget it across a restart, and what it is holding is a
  // session nobody typed into.
  const pin = String(newest(store)['primarySession']);
  expect(bag(bag(store.get(AUTOMATION)?.definition['_meta'])['ahpd'])['pinnedSession']).toBe(pin);
  expect(sessionQueries()).toHaveLength(cli + 2);

  // The run is over, and a second event arrives: the same chat, said again.
  await ends(cli + 1);
  await fails(client, chatUri, 't2', cli);
  await until(() => runCount(store) === 2, 'the second run');
  expect(newest(store)['primarySession']).toBe(pin);
  // Nothing new was made - a session per run is what `new` is - and the second
  // message is in the chat the first one opened.
  expect(sessionQueries()).toHaveLength(cli + 2);
  expect(sdk.said.filter((one) => one.includes('A turn failed'))).toHaveLength(2);
});

it('makes a new pinned session when the old one is gone', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({ session: 'pinned' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  const gone = String(newest(store)['primarySession']);

  await ends(cli + 1);
  await client.handle({ method: 'disposeSession', params: { channel: gone } });
  await settle();

  await fails(client, chatUri, 't2', cli);
  await until(() => runCount(store) === 2, 'the run after the session was disposed of');
  const made = String(newest(store)['primarySession']);
  expect(made).not.toBe(gone);
  // And kept in its place, so the run after this one adds to it rather than
  // making a third.
  expect(bag(bag(store.get(AUTOMATION)?.definition['_meta'])['ahpd'])['pinnedSession']).toBe(made);
});

it('queues one run and folds the rest while one runs', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({}));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  await fails(client, chatUri, 't2', cli);
  await fails(client, chatUri, 't3', cli);
  await settle(8);
  // One waiting run however many events arrive, because what the second adds is
  // what has happened since the first.
  expect(runCount(store)).toBe(1);

  await ends(cli + 1);
  await until(() => runCount(store) === 2, 'the run that was waiting');
  // And it answers both of them: the newest event, counted with the one folded
  // into it, which is the state of things as it now stands.
  expect(bag(bag(newest(store)['origin'])['event'])).toMatchObject({ kind: 'turnFailed', count: 2 });
  expect(newest(store)['primarySession'])
    .not.toBe(bag(runsOf(store)[1])['primarySession']);
});

it('steers the running turn, and queues when nothing runs', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({ overlap: 'steer' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');

  // Into the turn that is going, rather than a second run beside it: the agent
  // halfway through the work is who the news is for.
  const said = sdk.said.length;
  await fails(client, chatUri, 't2', cli);
  await until(() => sdk.said.length > said, 'the steered message');
  expect(runCount(store)).toBe(1);
  expect(String(sdk.said.at(-1))).toContain('A turn failed');

  // And with nothing running, it is a run of its own - which is what a queue
  // with nothing in front of it does.
  await ends(cli + 1);
  await until(() => String(bag(newest(store)['lifecycle'])['status']) === 'completed', 'the first run to end');
  await fails(client, chatUri, 't3', cli);
  await until(() => runCount(store) === 2, 'the run after it');
});

it('starts a run for each event under parallel', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({ overlap: 'parallel' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  await fails(client, chatUri, 't2', cli);
  await until(() => runCount(store) === 2, 'the second run');

  // Two runs at once, each with a session of its own: the fan-out an automation
  // asks for when one event is one piece of work.
  const [second, first] = runsOf(store);
  expect(bag(bag(second?.['origin'])['event'])['count']).toBe(1);
  expect(second?.['primarySession']).not.toBe(first?.['primarySession']);
});

it('drops and counts events under skip', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({ overlap: 'skip' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  await fails(client, chatUri, 't2', cli);
  await fails(client, chatUri, 't3', cli);
  await settle(8);

  // Nothing else started, and the count is on the run they arrived during:
  // that is where a client watching it reads what it never got to answer.
  expect(runCount(store)).toBe(1);
  expect(bag(newest(store)['_meta'])['ahpd.dropped']).toBe(2);
});

it('refuses a pinned automation with parallel', () => {
  const store = memoryAutomations();
  // One chat and a run per event is two turns at once in the same place, which
  // this host does not do - and a setting that quietly did nothing would be
  // worse than one refused where it was written.
  expect(() => store.create(AUTOMATION, waking({ session: 'pinned', overlap: 'parallel' })))
    .toThrow('A pinned automation runs one turn at a time in its own chat, so overlap cannot be parallel');
});

/*
 * And what a pinned run is allowed to do where it runs.
 *
 * A pin is the one road into a session that does not go through `createSession`,
 * so everything that road is gated by has to be asked here too - whose session
 * it is, whether the owner may read it, and whether a turn is already going in
 * it. What the cases below drive is a store-written pin: the pin is put in the
 * definition by the host and read back by the next run, and a run that refused
 * one is a run with no session and the reason on it.
 */

/** What a run that never started says for itself, which is the store's own record. */
const refusalOf = (store: AutomationStore): unknown => bag(bag(newest(store)['lifecycle'])['error'])['message'];

it('refuses to run an automation pinned to a chat that belongs to somebody else', async () => {
  const store = memoryAutomations();
  const { host, client, chatUri, cli } = await gated(
    { admin: [...DRIVER, 'session:read'], alice: ['session:read'] },
    store,
    'admin',
  );
  const hers = host.accept(peer());
  await hers.handle(hello(['0.9.0'], { clientId: 'alice', initialSubscriptions: ['ahp-root://'] }));
  await signIn(hers, 'alice');
  // Alice's automation, pinned to the session the admin made. She may read that
  // session, so her rule wakes on it - and what she may not do is have the host
  // type in it as though the work were hers.
  store.create(AUTOMATION, waking({ session: 'pinned', pinnedSession: LIVE }), 'user:alice');

  const said = sdk.said.length;
  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the refused run');

  expect(refusalOf(store)).toBe('This automation is set to run in a chat that belongs to somebody else');
  // And nothing was said into the chat: the failing turn above is the only
  // message in the list, and the one a run would have sent is not there.
  expect(sdk.said).toHaveLength(said + 1);
  expect(sdk.said.filter((one) => one.includes('A turn failed'))).toEqual([]);
});

it('refuses a press into a chat the automation owner may not read', async () => {
  const store = memoryAutomations();
  // Alice's own session, and Alice may not read it back: what a pinned run
  // would do is put her work into a chat the host cannot show her.
  const { client } = await gated({ alice: [...DRIVER, 'automation:run'] }, store, 'alice');
  store.create(AUTOMATION, waking({ session: 'pinned', pinnedSession: LIVE }), 'user:alice');

  const said = sdk.said.length;
  await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: AUTOMATION, requestId: 'r' },
  });
  await until(() => runCount(store) === 1, 'the refused press');

  expect(refusalOf(store)).toBe('alice may not session:read here');
  expect(sdk.said).toHaveLength(said);
});

it('refuses a press while the chat the automation runs in is busy', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({ session: 'pinned' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  const pin = String(newest(store)['primarySession']);

  // A person presses Run while the run's own turn is still going. One chat has
  // one turn at a time, and what the press gets is the reason rather than a
  // second turn on top of the first.
  const said = sdk.said.length;
  await client.handle({
    method: 'runAutomation', params: { channel: AUTOMATIONS, automation: AUTOMATION, requestId: 'r' },
  });
  await until(() => runCount(store) === 2, 'the refused press');
  expect(refusalOf(store)).toBe('The chat this automation runs in is already running a turn');
  expect(newest(store)['primarySession']).toBeUndefined();
  expect(sdk.said).toHaveLength(said);

  // And the turn that is going is still the first run's: it settles when it
  // ends, which is what a press moving the chat onto its own failed run would
  // have taken away.
  await ends(cli + 1);
  await until(() => String(bag(runsOf(store)[1]?.['lifecycle'])['status']) === 'completed', 'the first run to settle');
  expect(runsOf(store)[1]?.['primarySession']).toBe(pin);
});

it('waits behind a turn a person is running in the chat it is pinned to', async () => {
  const store = memoryAutomations();
  const { client, chatUri, cli } = await live({ automations: store });
  store.create(AUTOMATION, waking({ session: 'pinned' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  const pin = String(newest(store)['primarySession']);
  await ends(cli + 1);
  await until(() => String(bag(newest(store)['lifecycle'])['status']) === 'completed', 'the first run to end');

  // Somebody is typing in the chat the automation runs in. That turn is not the
  // automation's and it is still a turn in the one chat the automation has.
  const pinnedChat = chatUriFor(pin);
  await client.handle({ method: 'subscribe', params: { channel: pinnedChat } });
  await begins(client, pinnedChat, 'p1');

  // The event arrives while that turn is going, so it waits rather than going
  // into the chat as a second turn.
  await fails(client, chatUri, 't2', cli);
  await settle(8);
  expect(runCount(store)).toBe(1);

  // And the moment the person's turn ends, it goes - in the same chat, with no
  // session made for it.
  await ends(cli + 1);
  await until(() => runCount(store) === 2, 'the run that waited');
  expect(newest(store)['primarySession']).toBe(pin);
  expect(sessionQueries()).toHaveLength(cli + 2);
});

it('does not spend one of the twenty on an event it dropped', async () => {
  const store = memoryAutomations();
  const lines: string[] = [];
  const { client, chatUri, cli } = await live({ automations: store, onEvent: (line) => { lines.push(line); } });
  store.create(AUTOMATION, waking({ overlap: 'skip' }));

  await fails(client, chatUri, 't1', cli);
  await until(() => runCount(store) === 1, 'the first run');
  // More events than an hour allows runs, every one of them dropped while the
  // first run is going: an event thrown away is not an event that started a
  // run, and a cap counting them would stop an automation that asked for its
  // events to be dropped long before it had started twenty.
  for (let i = 2; i <= 26; i++) await fails(client, chatUri, `t${i}`, cli);
  await settle(8);
  expect(runCount(store)).toBe(1);
  expect(bag(newest(store)['_meta'])['ahpd.dropped']).toBe(25);

  await ends(cli + 1);
  await until(() => String(bag(newest(store)['lifecycle'])['status']) === 'completed', 'the first run to end');
  await fails(client, chatUri, 't27', cli);
  await until(() => runCount(store) === 2, 'the run after the drops');
  expect(lines.filter((line) => line.includes('so this wake was dropped'))).toEqual([]);
});

it('counts the hour across a switch off and on again', async () => {
  const store = memoryAutomations();
  const lines: string[] = [];
  const { client, chatUri, cli } = await live({ automations: store, onEvent: (line) => { lines.push(line); } });
  store.create(AUTOMATION, { ...watching(), _meta: { ahpd: { overlap: 'parallel' } } });

  for (let i = 1; i <= 20; i++) await fails(client, chatUri, `t${i}`, cli);
  await until(() => runCount(store) === 20, 'the twenty runs');

  // Off and on again is an edit beside the trigger rather than a new
  // automation: what the cap bounds is how often this one starts, and the
  // twenty it has already started are still the last hour's.
  store.update(AUTOMATION, { enabled: false });
  store.update(AUTOMATION, { enabled: true });
  await fails(client, chatUri, 't21', cli);
  await until(() => lines.some((line) => line.includes('so this wake was dropped')), 'the drop');
  expect(runCount(store)).toBe(20);
});

it('stops measuring a turn in a session that is gone', async () => {
  // A turn that goes quiet for longer than the rule allows wakes it: this is
  // what the line below takes away.
  const first = memoryAutomations();
  const one = await live({ automations: first });
  first.create(AUTOMATION, watchingSilence());
  await begins(one.client, one.chatUri, 't1');
  await until(() => (first.get(AUTOMATION)?.runs ?? []).length === 1, 'the run for a silent turn', 4000);

  // And the same turn in a session this host disposes of before the rule's
  // length is up. Nothing will end that turn now, so nothing is waiting on it,
  // and the timer it armed is not one to leave running.
  const second = memoryAutomations();
  const two = await live({ automations: second });
  second.create(AUTOMATION, watchingSilence());
  await begins(two.client, two.chatUri, 't1');
  await two.client.handle({ method: 'disposeSession', params: { channel: two.uri } });
  await settle();
  await new Promise((r) => { setTimeout(r, 1200); });
  expect((second.get(AUTOMATION)?.runs ?? [])).toHaveLength(0);
});

it('starts no run once the host has closed', async () => {
  const store = memoryAutomations();
  const { host, client, chatUri } = await live({ automations: store });
  store.create(AUTOMATION, watchingSilence());

  // A turn armed the rule's timer, and the host closes before the turn has been
  // quiet that long: a wake arriving at a daemon that is going away is a run
  // begun in one.
  await begins(client, chatUri, 't1');
  await host.close();
  await new Promise((r) => { setTimeout(r, 1200); });
  expect(store.get(AUTOMATION)?.runs ?? []).toHaveLength(0);
});

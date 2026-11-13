import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { backSessions, frontSessions, frontsOf, sessionsOf } from '../src/names.js';
import { botStore } from '../src/store.js';
import { botWake } from '../src/wake.js';
import type { ChatMessage, TurnHandle } from '../src/chat.js';
import type { BotSessions } from '../src/wake.js';
import type { BotRecord } from '../src/record.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { ChatRequest } from '../../sdk/src/types/plugin.js';
import type { Owner } from '../../sdk/src/types/usage.js';

/*
 * A message said to a bot wakes the Back chat of its Front.
 *
 * What is checked here is the road between the two chats of one session: the
 * Back chat found by its `tool` origin, or started there and made by the Front
 * turn's `subagent` call, the turn the message becomes in it, and the Front turn
 * left open while it is answered. Nothing is refused here, so nothing ends a
 * Front turn but a notice naming a cause.
 *
 * The host's own halves are stubs: what starts a chat, what reads a session's
 * chats and a chat's turn, and what carries an action are all the plugin's, and
 * `plugin.ts` is where those are real. What the wake decides is the order they
 * happen in, and that is what these cases watch.
 */

/** The session every case below talks in, as this host holds it. */
const CHAT = 'bot-chat:/one';

/** The person of that session, whose talk it is. */
const PERSON: Owner = 'user:ana';

/**
 * Where the bots work in these cases.
 *
 * A real, empty folder, because a wake writes the bot's files before it starts
 * the Back and a folder nothing may write is a wake these cases would be
 * measuring for the wrong reason.
 */
const WORKSPACE = mkdtempSync(join(tmpdir(), 'ahpd-bot-wake-'));

/** One bot, as the store holds it. */
const bot = (over: Partial<BotRecord> = {}): BotRecord => ({
  id: 'backer',
  name: 'Backer',
  labels: [],
  body: 'robot',
  color: 'red',
  provider: 'base',
  workspace: WORKSPACE,
  owner: 'user:soft',
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  ...over,
});

/** The Front: the session's default chat, which a message names as the one it came from. */
const MAIN = 'ahp-chat:/main';

/** The Back chat the first start mints. */
const BACK = 'ahp-chat:/back-1';

/** One message in a Front, as `chat.ts` hands the plugin one. */
const message = (turnId: string, text: string, session = CHAT, chat = MAIN): ChatMessage => ({ session, chat, bot: 'backer', turnId, text });

/**
 * The text a woken message carries: the context block, one blank line, then
 * the person's own words. What is in the block, and what the Front shows, is
 * `bot-context.test.ts`; here it is only in the way of the words.
 */
const carrying = (said: string, main = MAIN): RegExp =>
  new RegExp(`^<context>\\nmain chat: ${main}\\nthis chat: agent-host-session://bot-chat/[^\\n]+\\nfrom: ana\\ntime: [^\\n]+\\n</context>\\n\\n${said}$`);

/** A handle over a Front turn, and what was said through it. */
interface Recorded {
  handle: TurnHandle;
  /** What the turn was answered with. */
  replies: string[];
  /** What a post added to the turn, which leaves it open. */
  posts: string[];
  /** What the turn was ended with instead of an answer. */
  notices: string[];
  /** One entry per ending, which is the only way a handle says it was used. */
  endings: string[];
  /** What the turn failed with. */
  failures: string[];
  /** The `subagent` calls the turn showed: the chat, the title and the call id. */
  calls: { chat: string; title: string; toolCallId?: string }[];
  /**
   * The steers said to be sent on and those taken out, by the Front's ids, and
   * whether the turn they went into has ended, which hands a steer back.
   */
  steering: { sent: string[]; consumed: string[]; ended: boolean };
}

const turn = (): Recorded => {
  const replies: string[] = [];
  const posts: string[] = [];
  const notices: string[] = [];
  const endings: string[] = [];
  const failures: string[] = [];
  const calls: Recorded['calls'] = [];
  const steering = { sent: [] as string[], consumed: [] as string[], ended: false };
  const handle: TurnHandle = {
    complete: (text) => {
      if (text === undefined) endings.push('ended');
      else replies.push(text);
    },
    responsePart: (text) => { posts.push(text); },
    notice: (text) => { notices.push(text); },
    fail: (message) => { failures.push(message); },
    subagent: (chat, title, toolCallId) => { calls.push({ chat, title, ...(toolCallId === undefined ? {} : { toolCallId }) }); },
    steeringSent: (id) => {
      if (steering.ended) return false;
      steering.sent.push(id);
      return true;
    },
    steeringConsumed: (id) => { steering.consumed.push(id); },
  };
  return { handle, replies, posts, notices, endings, failures, calls, steering };
};

/** One chat of a session, as its state lists it. */
type Listed = { resource: string; origin?: Bag };

/**
 * A wake over one host, with everything the host owns stubbed.
 *
 * The collections and the store are real. The sessions' chats are a map that a
 * start adds a chat to with the origin it asked for, `backChat` reads a Back off
 * the same map by that origin, and `send` records what it was asked to carry
 * rather than carrying it.
 *
 * `seeded` is what an earlier daemon left: Front rows and the rows of the Back
 * sessions it started, which say whose bot a session is.
 */
async function sitting(
  record: BotRecord = bot(),
  mayUse?: (owner: Owner, provider: string | undefined) => boolean,
  seeded: { fronts?: string[]; backs?: string[] } = {},
) {
  const records = memoryRecords();
  const store = botStore(
    await records.collection('bots', { body: 'instructions' }),
    await records.collection('bots-gone'),
    () => {},
  );
  await store.put(record);
  const backsRows = await records.collection(sessionsOf(record.id));
  const backs = backSessions(() => backsRows);
  const frontsRows = await records.collection(frontsOf(record.id));
  const fronts = frontSessions(() => frontsRows);

  /** The chats of each session, by the session's URI. */
  const chats = new Map<string, Listed[]>([[CHAT, [{ resource: MAIN, origin: { kind: 'user' } }]]]);
  /** Whose each session is: a URI absent here is one this host no longer has. */
  const owners = new Map<string, Owner>([[CHAT, PERSON]]);
  /** The turn running in a Back chat, where a case names one. */
  const running = new Map<string, string>();
  const starts: { session: string; wanted: ChatRequest }[] = [];
  const sent: { channel: string; action: Bag }[] = [];
  const problems: string[] = [];
  /** What the reader answered for the session while a start was still running. */
  const during: (Record<string, string> | undefined)[] = [];
  /** What a start is refused with, where the host refuses one. */
  let startRefusal: string | undefined;
  /** What a held start waits on, for a case that acts while one is still running. */
  let held: Promise<void> | undefined;
  /** What a send is refused with, where the host refuses one. */
  let sendRefusal: string | undefined;
  /** What a held send waits on, for a case that acts while one is on its way. */
  let sendHeld: Promise<void> | undefined;
  let minted = 0;

  for (const session of seeded.fronts ?? []) await fronts.put(record.id, 'ana', session);
  for (const session of seeded.backs ?? []) await backs.put(record.id, 'ana', 'work', session);

  const sessions: BotSessions = { owner: async (uri) => owners.get(uri) };

  const wake = botWake({
    store,
    fronts,
    backs,
    sessions,
    // What a first wake writes into the folder: the real plugin fills the
    // template, and these cases are about the message rather than the file.
    agents: async (one) => `# ${one.name}\n`,
    backChat: async (session, front) => (chats.get(session) ?? [])
      .find((one) => one.origin?.['kind'] === 'tool' && one.origin['chat'] === front)?.resource,
    startChat: async (session, wanted) => {
      if (startRefusal !== undefined) throw new Error(startRefusal);
      starts.push({ session, wanted });
      // Asked the way the host asks it at the first tool list, with the start
      // still running.
      during.push(wake.bindings(session));
      if (held !== undefined) await held;
      minted += 1;
      const uri = `ahp-chat:/back-${minted}`;
      chats.set(session, [...chats.get(session) ?? [], { resource: uri, ...(wanted.origin === undefined ? {} : { origin: wanted.origin }) }]);
      return uri;
    },
    look: async (chat) => {
      const turn = running.get(chat);
      return { chat, ...(turn === undefined ? {} : { turn }) };
    },
    send: async (channel, action) => {
      sent.push({ channel, action });
      if (sendHeld !== undefined) await sendHeld;
      return sendRefusal;
    },
    ...(mayUse === undefined ? {} : { mayUse }),
    problem: (line) => { problems.push(line); },
  });

  return {
    wake, backs, fronts, starts, sent, problems, running, store, during, chats, owners,
    refuseStart: (line: string) => { startRefusal = line; },
    /** Hold every start from here, and answer with what lets them go. */
    holdStart: (): (() => void) => {
      let go = (): void => {};
      held = new Promise<void>((resolve) => { go = () => { resolve(); }; });
      return go;
    },
    refuseSend: (line: string) => { sendRefusal = line; },
    /** Hold every send from here, and answer with what lets them go. */
    holdSend: (): (() => void) => {
      let go = (): void => {};
      sendHeld = new Promise<void>((resolve) => { go = () => { resolve(); }; });
      return go;
    },
  };
}

it('starts a Back chat in the Front\'s session on the bot\'s provider and model, made by the Front turn\'s subagent call', async () => {
  const one = await sitting(bot({ provider: 'claude', model: 'claude-sonnet-5' }));
  const said = turn();

  await one.wake.woken(message('t1', 'hello'), said.handle);

  expect(one.starts).toHaveLength(1);
  const { session, wanted } = one.starts[0]!;
  expect(session).toBe(CHAT);
  expect(wanted).toMatchObject({
    provider: 'claude',
    model: 'claude-sonnet-5',
    title: '@main/backer/ana',
    // `post_message` is opt-in, so a chat that does not name it is never
    // offered it.
    tools: ['post_message', 'send_message'],
    origin: { kind: 'tool', chat: MAIN },
  });
  // The origin names the call the Front turn shows, which links the Back.
  const origin = wanted.origin as { toolCallId: string };
  expect(said.calls).toEqual([{ chat: BACK, title: 'Backer', toolCallId: origin.toolCallId }]);
});

it('starts a Back on the bot\'s preset alone, and on the host\'s default where the bot names no agent', async () => {
  // A preset is a session whose backend and settings are already decided, so it
  // wins over the provider and the model rather than sitting beside them.
  const preset = await sitting(bot({ preset: 'loud', provider: 'claude', model: 'claude-sonnet-5' }));
  await preset.wake.woken(message('t1', 'hello'), turn().handle);
  expect(preset.starts[0]?.wanted.provider).toBe('loud');
  expect(preset.starts[0]?.wanted).not.toHaveProperty('model');

  // A bot that names no backend says nothing about one: the host runs the chat
  // on its default agent.
  const quiet = { ...bot() };
  delete quiet.provider;
  const none = await sitting(quiet);
  await none.wake.woken(message('t1', 'hello'), turn().handle);
  expect(none.starts[0]?.wanted).not.toHaveProperty('provider');
});

it('refuses a wake whose record, edited by hand, names bot-chat as its agent', async () => {
  const one = await sitting(bot({ provider: 'bot-chat' }));
  const said = turn();

  await one.wake.woken(message('t1', 'hello'), said.handle);

  expect(one.starts).toEqual([]);
  expect(said.failures).toEqual(['Backer was not woken: A bot cannot run on bot-chat, the agent people talk to it through.']);
});

it('refuses a wake whose record names an agent the bot\'s owner may not use', async () => {
  // The owner asked about is the bot's, `user:soft`, and not the `user:ana` who
  // is talking: a chat the host starts for the person would otherwise reach an
  // agent only the bot's owner can be refused.
  const asked: Owner[] = [];
  const one = await sitting(bot({ provider: 'theirs' }), (owner, provider) => {
    asked.push(owner);
    return provider !== 'theirs';
  });
  const said = turn();

  await one.wake.woken(message('t1', 'hello'), said.handle);

  expect(asked).toEqual(['user:soft']);
  expect(one.starts).toEqual([]);
  expect(one.sent).toEqual([]);
  expect(said.failures).toEqual(['Backer was not woken: No provider called theirs']);
  expect(said.notices).toEqual([]);
});

it('starts a Back chat on the first message, and says the second in it', async () => {
  const one = await sitting();
  const first = turn();
  await one.wake.woken(message('t1', 'hello'), first.handle);

  expect(one.starts).toHaveLength(1);
  expect(one.sent).toMatchObject([{
    channel: BACK,
    action: { type: 'chat/pendingMessageSet', kind: 'queued', message: { text: carrying('hello') } },
  }]);
  // The message in the Back is the wake's own entry, not the Front's turn.
  expect(typeof one.sent[0]?.action['id']).toBe('string');
  expect(one.sent[0]?.action['id']).not.toBe('t1');
  // No Back session row is written: the Back is found by its origin.
  expect(await one.backs.sessions('backer')).toEqual([]);
  // And the Front turn is held open, waiting on the Back that was woken.
  expect(one.wake.main(BACK)).toMatchObject({ session: CHAT, turnId: 't1', chat: BACK });

  const second = turn();
  await one.wake.woken(message('t2', 'and again'), second.handle);

  expect(one.starts).toHaveLength(1);
  expect(one.sent[1]).toMatchObject({ channel: BACK, action: { kind: 'queued', message: { text: carrying('and again') } } });
  // What the second message waits on is the second turn.
  expect(one.wake.main(BACK)).toMatchObject({ turnId: 't2', handle: second.handle });
  expect([...first.notices, ...second.notices]).toEqual([]);
  expect([...first.endings, ...second.endings]).toEqual([]);
});

it('continues the Back chat a session already has, found by its origin', async () => {
  const one = await sitting();
  // The Back an earlier talk started, which a restart leaves in the session.
  one.chats.set(CHAT, [
    { resource: MAIN, origin: { kind: 'user' } },
    { resource: 'ahp-chat:/before', origin: { kind: 'tool', chat: MAIN, toolCallId: 'call-before' } },
  ]);

  await one.wake.woken(message('t1', 'hello'), turn().handle);

  expect(one.starts).toEqual([]);
  expect(one.sent[0]?.channel).toBe('ahp-chat:/before');
  expect(one.wake.main('ahp-chat:/before')).toMatchObject({ session: CHAT, turnId: 't1' });
});

it('starts one Back for two Fronts\' messages each, and one for two messages that arrive together', async () => {
  const one = await sitting();
  const release = one.holdStart();
  const a = one.wake.woken(message('t1', 'one'), turn().handle);
  const b = one.wake.woken(message('t2', 'two'), turn().handle);
  await new Promise((done) => { setTimeout(done, 5); });
  release();
  await Promise.all([a, b]);
  expect(one.starts).toHaveLength(1);

  // A second Front of the same session, such as a webhook's thread, has a Back
  // of its own.
  one.chats.set(CHAT, [...one.chats.get(CHAT)!, { resource: 'ahp-chat:/thread', origin: { kind: 'user' } }]);
  await one.wake.woken(message('t3', 'three', CHAT, 'ahp-chat:/thread'), turn().handle);
  expect(one.starts).toHaveLength(2);
  expect(one.starts[1]?.wanted.origin).toMatchObject({ kind: 'tool', chat: 'ahp-chat:/thread' });
});

/*
 * The Back is handed the person's message as the reference Agents window sends
 * a message from one session into another: queued, an agent's, naming the
 * session and the chat it came from, and with no model, agent or attachments,
 * so the Back's defaults apply.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionMessageRouter.ts#L271-L282
 * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/state.ts#L810-L827
 */
it('hands the Back the words as an agent\'s queued message that names the Front', async () => {
  const one = await sitting();
  await one.wake.woken(message('t1', 'read this'), turn().handle);
  const action = one.sent[0]?.action ?? {};
  expect(action).toMatchObject({
    type: 'chat/pendingMessageSet',
    kind: 'queued',
    message: {
      text: carrying('read this'),
      origin: { kind: 'agent' },
      _meta: { 'vscode.chat.delegation': { sourceSession: CHAT, sourceChat: MAIN } },
    },
  });
  expect(Object.keys(action['message'] as Record<string, unknown>).sort()).toEqual(['_meta', 'origin', 'text']);
});

/*
 * A second message into the Front turn that the person did not steer is sent
 * the same way, and waits in the Back behind its running turn: the Front turn
 * is answered by the turn the last message becomes, not by the one in front.
 */
it('answers the Front turn with the turn its last message became', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  const first = String(one.sent[0]?.action['id']);
  one.wake.taken(BACK, 'r1', first);

  await one.wake.woken(message('t1', 'stop that'), said.handle);
  const second = one.sent[1]?.action ?? {};
  expect(second).toMatchObject({ type: 'chat/pendingMessageSet', kind: 'queued', message: { text: carrying('stop that') } });
  expect(second['id']).not.toBe(first);

  one.wake.finished(BACK, 'the first answer');
  expect(said.replies).toEqual([]);
  expect(one.wake.main(BACK)).toMatchObject({ turnId: 't1', handle: said.handle });

  one.wake.taken(BACK, 'r2', String(second['id']));
  one.wake.finished(BACK, 'the second answer');
  expect(said.replies).toEqual(['the second answer']);
  expect(said.notices).toEqual([]);
});

it('steers the Back turn with a message steered into the Front turn', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'count to 30'), said.handle);
  one.wake.taken(BACK, 'r1', String(one.sent[0]?.action['id']));

  await one.wake.woken({ ...message('t1', 'stop at 10'), steering: 's1' }, said.handle);
  expect(one.sent[1]?.action).toMatchObject({
    type: 'chat/pendingMessageSet',
    kind: 'steering',
    message: {
      text: carrying('stop at 10'),
      origin: { kind: 'agent' },
      _meta: { 'vscode.chat.delegation': { sourceSession: CHAT, sourceChat: MAIN } },
    },
  });
  expect(said.steering.sent).toEqual(['s1']);
  expect(said.steering.consumed).toEqual(['s1']);

  one.wake.finished(BACK, 'stopped at 10');
  expect(said.replies).toEqual(['stopped at 10']);
  expect(said.notices).toEqual([]);
});

it('sends nothing of a steer whose Front turn ended on its way', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  said.steering.ended = true;

  await one.wake.woken({ ...message('t1', 'stop that'), steering: 's1' }, said.handle);
  expect(one.sent).toHaveLength(1);
  expect(said.steering.consumed).toEqual([]);
  expect(one.wake.main(BACK)?.waiting.size).toBe(1);
});

/*
 * A steer the Back refuses is dropped, and the Front turn goes on waiting on
 * the work it already waited on, as VS Code's agents clear a steer whose
 * sending failed and its host leaves the turn alone (codexAgent.ts
 * L6817-L6837, queueDrainContribution.ts L218-L228 at 6b68d3fe).
 */
it('drops a steer the Back refuses, and the Front turn goes on', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  one.wake.taken(BACK, 'r1', String(one.sent[0]?.action['id']));
  one.refuseSend('The chat is archived');

  await one.wake.woken({ ...message('t1', 'stop that'), steering: 's1' }, said.handle);
  expect(said.failures).toEqual([]);
  expect(said.steering.consumed).toEqual(['s1']);
  expect(one.problems).toEqual([`a steer of t1 in ${CHAT} was dropped: Backer was not woken: The chat is archived`]);
  expect(one.wake.main(BACK)).toMatchObject({ turnId: 't1', handle: said.handle });

  one.wake.finished(BACK, 'the first answer');
  expect(said.replies).toEqual(['the first answer']);
});

it('ends the Front turn as its Back turn ended, where a steer on its way meanwhile is refused', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  one.wake.taken(BACK, 'r1', String(one.sent[0]?.action['id']));
  const release = one.holdSend();
  one.refuseSend('The chat is archived');

  const steered = one.wake.woken({ ...message('t1', 'stop that'), steering: 's1' }, said.handle);
  await new Promise((done) => { setTimeout(done, 5); });
  expect(one.sent).toHaveLength(2);
  one.wake.finished(BACK, 'the first answer');
  expect(said.replies).toEqual([]);

  release();
  await steered;
  expect(said.replies).toEqual(['the first answer']);
  expect(said.failures).toEqual([]);
  expect(said.steering.consumed).toEqual(['s1']);
  expect(one.wake.main(BACK)).toBeUndefined();
});

it('takes back a message still waiting in the Back when its Front turn is stopped', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  const first = String(one.sent[0]?.action['id']);

  await one.wake.stopped(CHAT, 't1');

  expect(one.sent.at(-1)).toMatchObject({
    channel: BACK,
    action: { type: 'chat/pendingMessageRemoved', kind: 'queued', id: first },
  });
  expect(one.wake.main(BACK)).toMatchObject({ session: CHAT, turnId: 't1' });
});

/*
 * A stopped Front turn stops the work behind it: the reference host cancels
 * the running turn of each subagent of a chat whose turn is stopped, with the
 * time it ran, and keeps their registrations (agentSideEffects.ts L1942,
 * L1470-L1486 at a4e689ae).
 */
it('stops the Back turn a Front turn waits on, with the time it ran, and keeps its link', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  one.wake.taken(BACK, 'back-t1', String(one.sent[0]?.action['id']));
  one.running.set(BACK, 'back-t1');
  // A turn that ends where it began is one no time is measured for.
  await new Promise((rest) => setTimeout(rest, 5));

  await one.wake.stopped(CHAT, 't1');

  expect(one.sent.at(-1)).toMatchObject({
    channel: BACK,
    action: { type: 'chat/turnCancelled', turnId: 'back-t1' },
  });
  expect(Number(one.sent.at(-1)?.action['duration'])).toBeGreaterThan(0);
  expect(one.wake.main(BACK)).toMatchObject({ session: CHAT, turnId: 't1' });
});

it('sends no message a stop finds still on its way to a starting Back', async () => {
  const one = await sitting();
  const said = turn();
  const release = one.holdStart();
  const woke = one.wake.woken(message('t1', 'hello'), said.handle);
  await new Promise((done) => { setTimeout(done, 5); });

  await one.wake.stopped(CHAT, 't1');
  release();
  await woke;

  expect(one.starts).toHaveLength(1);
  expect(one.sent).toEqual([]);
  expect(one.wake.main(BACK)).toBeUndefined();
  expect(one.wake.posted(BACK, 'late')).toBe(false);
  expect(said.posts).toEqual([]);
  expect(said.replies).toEqual([]);
});

it('ends the Front turn failed, with why, when the host refuses the start', async () => {
  const one = await sitting();
  one.refuseStart('user:ana may not chat:create here');
  const said = turn();

  await one.wake.woken(message('t1', 'hello'), said.handle);

  // Nothing was said, so nothing is coming: the turn ends failed with why,
  // as VS Code ends a turn whose send failed, rather than one that never ends.
  expect(one.sent).toEqual([]);
  expect(said.failures).toEqual(['Backer was not woken: user:ana may not chat:create here']);
});

it('ends the Front turn with the host\'s own words when it refuses the message', async () => {
  const one = await sitting();
  one.refuseSend('plugin:bot may not send a turn to this chat');
  const said = turn();

  await one.wake.woken(message('t1', 'hello'), said.handle);

  expect(said.failures).toEqual(['Backer was not woken: plugin:bot may not send a turn to this chat']);
  expect(one.wake.main(BACK)).toBeUndefined();
});

/*
 * Whose a session is is the host's to say, as it recorded the session's owner
 * at its create, and which bot is the chat's config's. A session this host
 * does not hold, and one whose bot has gone, have nothing behind them.
 */
it('ends a turn in a session the host does not hold, or whose bot has gone', async () => {
  const one = await sitting();
  const stray = turn();
  await one.wake.woken(message('t1', 'hello', 'bot-chat:/stray'), stray.handle);
  expect(stray.failures).toEqual(['bot-chat:/stray is a session this host does not hold']);

  const gone = turn();
  await one.wake.woken({ ...message('t2', 'hello'), bot: 'nobody' }, gone.handle);
  expect(gone.failures).toEqual(['There is no bot nobody.']);
  expect([...stray.endings, ...stray.notices, ...gone.endings, ...gone.notices]).toEqual([]);
  expect(one.sent).toEqual([]);
});

it('answers the bot\'s connectors for the session while its Back is still starting', async () => {
  const one = await sitting(bot({ connectors: { work: 'connectors://ap-resend/account-123' } }));

  await one.wake.woken(message('t1', 'hello'), turn().handle);

  // The host asks the reader at the Back's first tool list, which is built
  // while the chat is still being started.
  expect(one.during).toEqual([{ work: 'connectors://ap-resend/account-123' }]);
});

it('answers a talk\'s session with the bot\'s connectors, as the bot is now', async () => {
  const one = await sitting(bot({ connectors: { work: 'connectors://ap-resend/account-123' } }));
  // The host asks about every session it has, and this one is no bot's.
  expect(one.wake.bindings('ahp-session:/nobody')).toBeUndefined();

  await one.wake.woken(message('t1', 'hello'), turn().handle);
  expect(one.wake.bindings(CHAT)).toEqual({ work: 'connectors://ap-resend/account-123' });

  await one.store.put(bot({ connectors: { personal: 'connectors://ap-resend/account-456' } }));
  expect(one.wake.bindings(CHAT)).toEqual({ personal: 'connectors://ap-resend/account-456' });

  await one.store.put(bot());
  expect(one.wake.bindings(CHAT)).toBeUndefined();
});

it('answers nothing for a session whose bot is gone', async () => {
  const one = await sitting(bot({ connectors: { work: 'connectors://ap-resend/account-123' } }));
  await one.wake.woken(message('t1', 'hello'), turn().handle);
  expect(one.wake.bindings(CHAT)).toBeDefined();

  await one.store.remove('backer');
  expect(one.wake.bindings(CHAT)).toBeUndefined();
});

it('answers the sessions an earlier daemon left from the bot\'s rows, a talk\'s and an older Back\'s', async () => {
  const one = await sitting(
    bot({ connectors: { work: 'connectors://ap-resend/account-123' } }),
    undefined,
    { fronts: ['bot-chat:/before'], backs: ['ahp-session:/back-before'] },
  );
  // `woken` waits for the rows to be read once, when the wake is built.
  await one.wake.woken(message('t1', 'hello'), turn().handle);

  expect(one.wake.bindings('bot-chat:/before')).toEqual({ work: 'connectors://ap-resend/account-123' });
  expect(one.wake.bindings('ahp-session:/back-before')).toEqual({ work: 'connectors://ap-resend/account-123' });
});

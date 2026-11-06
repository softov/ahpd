import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { backSessions, chatsOf, rowId, sessionsOf } from '../src/names.js';
import { apply, defaults } from '../src/plugin.js';
import { postMessage } from '../src/post.js';
import { botStore } from '../src/store.js';
import { botWake } from '../src/wake.js';
import manifest from '../package.json' with { type: 'json' };
import type { MainTurnAbsence } from '../src/wake.js';
import type { ChatMessage, TurnHandle } from '../src/chat.js';
import type { BotSessions } from '../src/provider.js';
import type { BotRecord } from '../src/record.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { ToolCall } from '../../sdk/src/types/host.js';
import type { LoaderContext, SessionRequest } from '../../sdk/src/types/plugin.js';
import type { Owner } from '../../sdk/src/types/usage.js';

/*
 * The tool a back session answers its main chat with.
 *
 * A message said to a bot leaves a main turn open while a back session works,
 * and something has to answer and end it. `post_message` adds the text the
 * session posts to it, as often as the session posts, and the end of the
 * session's own turn ends it: with no more text after a post, and otherwise as
 * `mainTurnPostMessageAbsent` says - the session's last words by default, or
 * the notice, or nothing. What is checked is that the chat
 * answered is the session's own - the tool reads `at.session` and no input -
 * and that a turn ends once, whichever road gets there first.
 *
 * The host's own halves are stubs, as they are in `bot-wake.test.ts`: what
 * starts a session and what carries an action are the plugin's. The wake and
 * the rows are real, because the turn a post ends is the turn a message woke.
 */

/** The schema the manifest declares, which a listing reads without importing. */
const optionsSchema = manifest.ahpd.optionsSchema;

/** The main chat every case below says something in, as this host holds it. */
const CHAT = 'bot-chat:/one';

/** The person of that chat, who is whose the back session is. */
const PERSON: Owner = 'user:ana';

/** Where the bot works, which the wake writes the bot's files into. */
const WORKSPACE = mkdtempSync(join(tmpdir(), 'ahpd-bot-post-'));

/** One bot, as the store holds it. */
const bot = (over: Partial<BotRecord> = {}): BotRecord => ({
  id: 'backer',
  name: 'Backer',
  labels: [],
  body: 'robot',
  color: 'red',
  provider: 'base',
  session: 'work',
  workspace: WORKSPACE,
  owner: 'user:soft',
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  ...over,
});

/** One message in a main chat, as `chat.ts` hands the plugin one. */
const message = (turnId: string, text: string): ChatMessage => ({ session: CHAT, chat: 'ahp-chat:/main', turnId, text });

/** A handle over a main turn, and what was said through it. */
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
}

const turn = (): Recorded => {
  const replies: string[] = [];
  const posts: string[] = [];
  const notices: string[] = [];
  const endings: string[] = [];
  const failures: string[] = [];
  const handle: TurnHandle = {
    // The turn this handle is over is the open one: nothing begins a second.
    begin: () => undefined,
    reply: (text) => { replies.push(text); },
    say: (text) => { posts.push(text); },
    notice: (text) => { notices.push(text); },
    end: () => { endings.push('ended'); },
    fail: (message) => { failures.push(message); },
  };
  return { handle, replies, posts, notices, endings, failures };
};

/**
 * Where a call was made from, as much of it as this tool reads.
 *
 * `post_message` finds the main chat from the calling session and from nothing
 * else, so the rest of a `ToolCall` is not there to be stubbed.
 */
const called = (session: string): ToolCall => ({ session } as unknown as ToolCall);

/**
 * A wake over one host, with everything the host owns stubbed.
 *
 * The collections and the store are real, because the row a start writes is
 * what a later message finds. The sessions are a map that mints a URI per
 * start, `look` reads a chat off the same map, and `send` records what it was
 * asked to carry rather than carrying it.
 */
async function sitting(record: BotRecord = bot(), absent: MainTurnAbsence = 'post') {
  const records = memoryRecords();
  const store = botStore(
    await records.collection('bots', { body: 'instructions' }),
    await records.collection('bots-gone'),
    () => {},
  );
  await store.put(record);
  const chats = await records.collection(chatsOf(record.id));
  await chats.put({ id: rowId([record.id, PERSON]), bot: record.id, owner: PERSON, chat: CHAT });
  const backsRows = await records.collection(sessionsOf(record.id));
  const backs = backSessions(() => backsRows);

  /** The default chat of each back session, by the session's URI. */
  const at = new Map<string, string>();
  /** Whose each session is: a URI absent here is one this host no longer has. */
  const owners = new Map<string, Owner>();
  /** What the wake sent the back sessions. */
  const sent: Bag[] = [];
  let minted = 0;

  const sessions: BotSessions = {
    owner: async (uri) => owners.get(uri),
    start: async (wanted: SessionRequest) => {
      minted += 1;
      const uri = `ahp-session:/${minted}`;
      owners.set(uri, wanted.owner);
      at.set(uri, `ahp-chat:/${minted}`);
      return uri;
    },
  };

  const wake = botWake({
    store,
    chats: () => chats,
    backs,
    sessions,
    // What a first wake writes into the folder: the real plugin fills the
    // template, and these cases are about the post rather than the file.
    agents: async (one) => `# ${one.name}\n`,
    look: async (session) => {
      const chat = at.get(session);
      if (chat === undefined) throw new Error(`${session} names no chat to say a message in`);
      return { chat };
    },
    // What the message becomes in the back session is task 03's, and what it
    // carries is not what a post answers: nothing here is refused.
    send: async (_channel, action) => {
      sent.push(action);
      return undefined;
    },
    problem: () => {},
  }, absent);

  return { wake, post: postMessage(wake), sent };
}

/**
 * A message that wakes the one back session, and the turn it leaves open. The
 * back session takes the message up as its turn, as its host does at once
 * when the session is idle.
 */
async function woken(one: Awaited<ReturnType<typeof sitting>>): Promise<Recorded> {
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  one.wake.taken('ahp-session:/1', 'r1', String(one.sent.at(-1)?.['id']));
  return said;
}

it('adds the text the back session posts to the main turn, and keeps it open', async () => {
  const one = await sitting();
  const said = await woken(one);

  expect(await one.post.run({ text: 'the answer' }, called('ahp-session:/1'))).toBe('Posted to the main chat.');

  // The text goes into the turn the person is waiting on, and the turn stays
  // open while the back session's turn runs.
  expect(said.posts).toEqual(['the answer']);
  expect(said.replies).toEqual([]);
  expect(said.endings).toEqual([]);
  expect(one.wake.main('ahp-session:/1')).toMatchObject({ turnId: 't1' });
});

it('posts every call of one back turn, and ends the main turn once with that turn', async () => {
  const one = await sitting();
  const said = await woken(one);

  expect(await one.post.run({ text: 'working on it' }, called('ahp-session:/1'))).toBe('Posted to the main chat.');
  expect(await one.post.run({ text: 'the answer' }, called('ahp-session:/1'))).toBe('Posted to the main chat.');
  expect(said.posts).toEqual(['working on it', 'the answer']);

  one.wake.finished('ahp-session:/1', 'the answer');

  // The posts are the answer: the end adds no last words and no notice.
  expect(said.endings).toEqual(['ended']);
  expect(said.replies).toEqual([]);
  expect(said.notices).toEqual([]);
  expect(one.wake.main('ahp-session:/1')).toBeUndefined();

  // A post after the turn ended has nothing to post to.
  expect(await one.post.run({ text: 'and again' }, called('ahp-session:/1')))
    .toBe('There is no main chat waiting on this session, so there is nothing to post to.');
  expect(said.posts).toEqual(['working on it', 'the answer']);
});

it('keeps a post through a steer into the same main turn', async () => {
  const one = await sitting();
  const said = await woken(one);

  await one.post.run({ text: 'the answer' }, called('ahp-session:/1'));
  // The person says more while the back turn runs, and it goes into the same
  // main turn. It waits in the back session behind the turn that posted.
  await one.wake.woken(message('t1', 'and one more thing'), said.handle);
  const more = String(one.sent.at(-1)?.['id']);
  one.wake.finished('ahp-session:/1', 'the first words');
  expect(said.endings).toEqual([]);

  // The turn that message becomes ends the main turn the post went into.
  one.wake.taken('ahp-session:/1', 'r2', more);
  one.wake.finished('ahp-session:/1', 'the last words');

  expect(said.posts).toEqual(['the answer']);
  expect(said.replies).toEqual([]);
  expect(said.endings).toEqual(['ended']);
});

it('refuses a session that is not a back session', async () => {
  const one = await sitting();
  const said = await woken(one);

  // A session this wake never woke has no main chat behind it, and the tool
  // says so rather than throwing: the model can go on with its own turn.
  expect(await one.post.run({ text: 'the answer' }, called('ahp-session:/stray')))
    .toBe('There is no main chat waiting on this session, so there is nothing to post to.');
  expect(said.replies).toEqual([]);
  expect(one.wake.main('ahp-session:/1')).toMatchObject({ turnId: 't1' });
});

it('posts into the chat that woke the session, never one an input names', async () => {
  const one = await sitting();
  const said = await woken(one);

  // The only input is the text, and anything else a caller sends is ignored:
  // the chat answered is the one the calling session was woken by.
  await one.post.run({ text: 'the answer', session: 'bot-chat:/another' }, called('ahp-session:/1'));

  expect(said.posts).toEqual(['the answer']);
});

/**
 * The main turn one back session answered, after its turn ends with `text` and
 * no post.
 */
async function ended(absent: MainTurnAbsence | undefined, text: string) {
  const one = await sitting(bot(), absent);
  const said = await woken(one);
  one.wake.finished('ahp-session:/1', text);
  return { one, said };
}

it('posts the last words of a turn that ended with no post, by default', async () => {
  const { one, said } = await ended(undefined, 'The answer is 42.');

  // The default: the person asked a question, so the session's last words are
  // the reply rather than a notice that nothing was posted.
  expect(said.replies).toEqual(['The answer is 42.']);
  expect(said.notices).toEqual([]);
  expect(said.endings).toEqual([]);
  expect(one.wake.main('ahp-session:/1')).toBeUndefined();
});

it('ends with nothing on post when the turn said nothing', async () => {
  const { said } = await ended('post', '');

  // Nothing to post is not an empty reply: the turn is ended outright.
  expect(said.replies).toEqual([]);
  expect(said.notices).toEqual([]);
  expect(said.endings).toEqual(['ended']);
});

it('ends with the notice on notice, whatever the turn said', async () => {
  const withText = await ended('notice', 'The answer is 42.');
  expect(withText.said.replies).toEqual([]);
  expect(withText.said.notices).toEqual(['Backer finished without a reply']);
  expect(withText.said.endings).toEqual([]);

  // A notice even when the turn had words: this is what the option did before
  // it could post, and a host that chose it keeps that.
  const silent = await ended('notice', '');
  expect(silent.said.notices).toEqual(['Backer finished without a reply']);
  expect(silent.said.endings).toEqual([]);
});

it('ends with nothing on silence, whatever the turn said', async () => {
  const withText = await ended('silence', 'The answer is 42.');
  expect(withText.said.replies).toEqual([]);
  expect(withText.said.notices).toEqual([]);
  expect(withText.said.endings).toEqual(['ended']);

  const silent = await ended('silence', '');
  expect(silent.said.replies).toEqual([]);
  expect(silent.said.notices).toEqual([]);
  expect(silent.said.endings).toEqual(['ended']);
});

it('posts the last words on postNotice, and the notice when there are none', async () => {
  const withText = await ended('postNotice', 'The answer is 42.');
  expect(withText.said.replies).toEqual(['The answer is 42.']);
  expect(withText.said.notices).toEqual([]);

  // The difference from post is exactly this: a turn with no words is still
  // told to the person rather than ended in silence.
  const silent = await ended('postNotice', '');
  expect(silent.said.replies).toEqual([]);
  expect(silent.said.notices).toEqual(['Backer finished without a reply']);
  expect(silent.said.endings).toEqual([]);
});

/*
 * A back session's turn that failed fails the main turn, in its words, as the
 * reference host ends a failed send with `chat/error` (agentSideEffects.ts
 * L1854-L1860 at a4e689ae).
 */
it('fails the main turn with the words the back session\'s failed turn ended with', async () => {
  const one = await sitting();
  const said = await woken(one);

  one.wake.finished('ahp-session:/1', 'half an answer', 'the model call failed');

  expect(said.failures).toEqual(['the model call failed']);
  expect(said.replies).toEqual([]);
  expect(said.notices).toEqual([]);
  expect(said.endings).toEqual([]);
});

it('ends the main turn once, whichever road got there first', async () => {
  const one = await sitting();
  const said = await woken(one);

  one.wake.finished('ahp-session:/1', 'the answer');
  // A second ending would be a turn of its own, and a session this wake never
  // woke ends nothing at all.
  one.wake.finished('ahp-session:/1', 'and again');
  one.wake.finished('ahp-session:/stray', 'nobody');

  expect(said.replies).toEqual(['the answer']);
  expect(said.notices).toEqual([]);
  expect(said.endings).toEqual([]);
  expect(one.wake.main('ahp-session:/1')).toBeUndefined();
});

it('ends the main turn with no more text when the session\'s own turn ends after a post', async () => {
  for (const absent of ['post', 'notice', 'silence', 'postNotice'] as const) {
    const one = await sitting(bot(), absent);
    const said = await woken(one);

    await one.post.run({ text: 'the answer' }, called('ahp-session:/1'));
    // The answer is not followed by the last words as well, and neither is it
    // followed by a notice saying it was not given, whatever the option says.
    one.wake.finished('ahp-session:/1', 'the last words');

    expect(said.posts).toEqual(['the answer']);
    expect(said.replies).toEqual([]);
    expect(said.notices).toEqual([]);
    expect(said.endings).toEqual(['ended']);
  }
});

it('fails the main turn when the back turn fails after a post', async () => {
  const one = await sitting();
  const said = await woken(one);

  await one.post.run({ text: 'half an answer' }, called('ahp-session:/1'));
  one.wake.finished('ahp-session:/1', 'half an answer', 'the model call failed');

  expect(said.posts).toEqual(['half an answer']);
  expect(said.failures).toEqual(['the model call failed']);
  expect(said.endings).toEqual([]);
});

it('is offered only to a session that names it, with the rule that it is the reply', () => {
  const tool = postMessage(botWake({} as never));

  // The rule rides on the tool, so a session is told it exactly when it has the
  // tool, a restart included: the names are kept with the session, a request's
  // instructions are not.
  expect(tool.optIn).toBe(true);
  // The reply is the back session's own work, so no person is asked to approve
  // the answer they are waiting on.
  expect(tool.confirm).toBe(false);
  expect(tool.instruction).toContain('main chat');
  expect(tool.instruction).toMatch(/send_message starts a turn in another session and does not reply/);
});

it('asks with the question tool, and in the post when there is none', () => {
  const tool = postMessage(botWake({} as never));
  const instruction = String(tool.instruction ?? '');

  // The rule is about asking, not about any one harness's tool: a session that
  // has a question tool asks with it, and the question - and the answer - stay
  // in the main chat, where task 06 shows it. A harness with no such tool says
  // its question in the reply it posts.
  expect(instruction).toMatch(/ask with your question tool/);
  expect(instruction).toMatch(/no question tool asks in the text it posts/);
  // Each harness names its own, so naming one here would be wrong for every
  // other, and the rule would be read as being about that tool alone.
  expect(instruction).not.toMatch(/AskUserQuestion/);
});

it('gives mainTurnPostMessageAbsent a default of post, and declares it', () => {
  expect(defaults.mainTurnPostMessageAbsent).toBe('post');
  expect(optionsSchema.properties).toHaveProperty('mainTurnPostMessageAbsent');
});

it('declares the options something reads, and those alone', async () => {
  // A chat runs no model, so nothing opens a chat with a template: the count of
  // chats a first turn listed is an option nothing reads, gone with the builder.
  expect(Object.keys(optionsSchema.properties)).toEqual(['root', 'mainTurnPostMessageAbsent']);
  expect(Object.keys(defaults)).toEqual(['root', 'mainTurnPostMessageAbsent']);
  const exported = await import('../src/index.js');
  expect(exported).not.toHaveProperty('firstTurn');
  expect(exported).not.toHaveProperty('chatLines');
});

it('reports a value outside the table, and loads anyway', () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-post-option-'));
  const context: LoaderContext = {
    path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: join(root, 'config'), log: () => {}, say: () => {},
  };
  const problems: string[] = [];
  const { host } = pluginHost('bot', context, {
    sessions: () => memorySessions(),
    records: () => memoryRecords(),
    alert: (alert) => problems.push(alert.text),
  });

  apply(host, { root: join(root, 'bots'), mainTurnPostMessageAbsent: 'shout' });

  // A value the table does not name is reported rather than thrown: the plugin
  // still loads, and the main turn is answered as post, which is the default.
  expect(problems).toEqual([expect.stringContaining('mainTurnPostMessageAbsent is "shout"')]);
});

import { loggerOf } from '@ahpd/sdk';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { pluginHost } from '../../sdk/src/plugins/plugins.js';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { memorySessions } from '../../sdk/src/sessions/sessions.js';
import { sdkVersion } from '../../sdk/src/version.js';
import { backSessions, frontSessions, frontsOf, sessionsOf } from '../src/names.js';
import { apply, defaults } from '../src/plugin.js';
import { postMessage } from '../src/post.js';
import { botStore } from '../src/store.js';
import { botWake } from '../src/wake.js';
import manifest from '../package.json' with { type: 'json' };
import type { MainTurnAbsence } from '../src/wake.js';
import type { ChatMessage, TurnHandle } from '../src/chat.js';
import type { BotSessions } from '../src/wake.js';
import type { BotRecord } from '../src/record.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { ToolCall } from '../../sdk/src/types/host.js';
import type { LoaderContext } from '../../sdk/src/types/plugin.js';
import type { Owner } from '../../sdk/src/types/usage.js';
import { botAsk } from '../src/ask.js';

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
  workspace: WORKSPACE,
  owner: 'user:soft',
  createdAt: '2026-10-16T00:00:00.000Z',
  updatedAt: '2026-10-16T00:00:00.000Z',
  ...over,
});

/** One message in a main chat, as `chat.ts` hands the plugin one. */
const message = (turnId: string, text: string): ChatMessage => ({ session: CHAT, chat: 'ahp-chat:/main', bot: 'backer', turnId, text });

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
  /** The turns the bot opened in this chat with `speak`, by id. */
  spoken: string[];
  /** The requests copied into the turn, by id. */
  asked: string[];
}

const turn = (): Recorded => {
  const replies: string[] = [];
  const posts: string[] = [];
  const notices: string[] = [];
  const endings: string[] = [];
  const failures: string[] = [];
  const spoken: string[] = [];
  const asked: string[] = [];
  const handle: TurnHandle = {
    asking: (entry) => { asked.push(String(entry['id'])); },
    speak: () => {
      const id = `bot-${spoken.length + 1}`;
      spoken.push(id);
      return id;
    },
    complete: (text) => {
      if (text === undefined) endings.push('ended');
      else replies.push(text);
    },
    responsePart: (text) => { posts.push(text); },
    notice: (text) => { notices.push(text); },
    fail: (message) => { failures.push(message); },
  };
  return { handle, replies, posts, notices, endings, failures, spoken, asked };
};

/**
 * Where a call was made from, as much of it as this tool reads.
 *
 * `post_message` finds the main chat from the calling session and from nothing
 * else, so the rest of a `ToolCall` is not there to be stubbed.
 */
/** The Back chat the first wake starts, which these cases post from. */
const BACK = 'ahp-chat:/back-1';

/** The Front every message here is said in. */
const FRONT = 'ahp-chat:/main';

/** A subagent's worker chat under the Back, which a call in the Back made. */
const WORKER = 'ahp-chat:/worker';

/** A call of the tool from one chat of the talk's session. */
const called = (chat: string): ToolCall => ({ session: CHAT, chat } as unknown as ToolCall);

async function sitting(record: BotRecord = bot(), absent: MainTurnAbsence = 'post') {
  const records = memoryRecords();
  const store = botStore(
    await records.collection('bots', { body: 'instructions' }),
    await records.collection('bots-gone'),
    () => {},
  );
  await store.put(record);
  const backsRows = await records.collection(sessionsOf(record.id));
  const frontsRows = await records.collection(frontsOf(record.id));

  /** Whose each session is: a URI absent here is one this host no longer has. */
  const owners = new Map<string, Owner>([[CHAT, PERSON]]);
  /** The Back chats started, by the Front each was started for. */
  const backs = new Map<string, string>();
  /** What the wake sent the Back chats. */
  const sent: Bag[] = [];
  let minted = 0;

  const sessions: BotSessions = { owner: async (uri) => owners.get(uri), hasUsers: true };
  /** The Front's handle, which a post reaches when no message of the person's waits. */
  const front = turn();
  /** The Back chats with a turn running, which hold a turn the bot opened. */
  const running = new Set<string>();

  const wake = botWake({
    store,
    fronts: frontSessions(() => frontsRows),
    backs: backSessions(() => backsRows),
    sessions,
    // What a first wake writes into the folder: the real plugin fills the
    // template, and these cases are about the post rather than the file.
    agents: async (one) => `# ${one.name}\n`,
    backChat: async (_session, front) => backs.get(front),
    startChat: async (_session, wanted) => {
      minted += 1;
      const uri = `ahp-chat:/back-${minted}`;
      const origin = wanted.origin as { chat: string };
      backs.set(origin.chat, uri);
      return uri;
    },
    look: async (chat) => ({ chat, ...(running.has(chat) ? { turn: 'r-running' } : {}) }),
    parentOf: async (_session, chat) => (chat === WORKER ? BACK : [...backs].find(([, back]) => back === chat)?.[0]),
    front: async (_session, chat) => (chat === FRONT ? front.handle : undefined),
    // What the message becomes in the Back is the wake's, and what it carries
    // is not what a post answers: nothing here is refused.
    send: async (_channel, action) => {
      sent.push(action);
      return undefined;
    },
    problem: () => {},
  }, absent);

  return { wake, post: postMessage(wake), sent, front, running };
}

/**
 * A message that wakes the one Back chat, and the turn it leaves open. The
 * Back takes the message up as its turn, as its host does at once
 * when the chat is idle.
 */
async function woken(one: Awaited<ReturnType<typeof sitting>>): Promise<Recorded> {
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);
  one.wake.taken(BACK, 'r1', String(one.sent.at(-1)?.['id']));
  return said;
}

it('adds the text the back session posts to the main turn, and keeps it open', async () => {
  const one = await sitting();
  const said = await woken(one);

  expect(await one.post.run({ text: 'the answer' }, called(BACK))).toBe('Posted to the main chat.');

  // The text goes into the turn the person is waiting on, and the turn stays
  // open while the back session's turn runs.
  expect(said.posts).toEqual(['the answer']);
  expect(said.replies).toEqual([]);
  expect(said.endings).toEqual([]);
  expect(one.wake.main(BACK)).toMatchObject({ turnId: 't1' });
});

it('posts every call of one back turn, and ends the main turn once with that turn', async () => {
  const one = await sitting();
  const said = await woken(one);

  expect(await one.post.run({ text: 'working on it' }, called(BACK))).toBe('Posted to the main chat.');
  expect(await one.post.run({ text: 'the answer' }, called(BACK))).toBe('Posted to the main chat.');
  expect(said.posts).toEqual(['working on it', 'the answer']);

  one.wake.finished(BACK, 'the answer');

  // The posts are the answer: the end adds no last words and no notice.
  expect(said.endings).toEqual(['ended']);
  expect(said.replies).toEqual([]);
  expect(said.notices).toEqual([]);
  expect(one.wake.main(BACK)).toBeUndefined();

  // A post after the turn ended goes into a turn the bot opens in the Front,
  // which ends at once, as the Back runs no turn that would end it.
  expect(await one.post.run({ text: 'and again' }, called(BACK))).toBe('Posted to the main chat.');
  expect(said.posts).toEqual(['working on it', 'the answer']);
  expect(one.front.spoken).toEqual(['bot-1']);
  expect(one.front.posts).toEqual(['and again']);
  expect(one.front.endings).toEqual(['ended']);
  expect(one.wake.main(BACK)).toBeUndefined();
});

it('posts a subagent\'s text from its worker chat into a turn the bot opens, while the Back runs no turn', async () => {
  const one = await sitting();
  const said = await woken(one);
  one.wake.finished(BACK, 'started the timer');
  expect(said.replies).toEqual(['started the timer']);

  expect(await one.post.run({ text: 'tick 1' }, called(WORKER))).toBe('Posted to the main chat.');
  expect(await one.post.run({ text: 'tick 2' }, called(WORKER))).toBe('Posted to the main chat.');

  // Each tick is a turn of the bot's own, ended as soon as it is said.
  expect(one.front.spoken).toEqual(['bot-1', 'bot-2']);
  expect(one.front.posts).toEqual(['tick 1', 'tick 2']);
  expect(one.front.endings).toEqual(['ended', 'ended']);
});

it('keeps the turn the bot opened while the Back runs a turn, and ends it with that turn', async () => {
  const one = await sitting();
  const said = await woken(one);
  one.wake.finished(BACK, 'done');
  expect(said.replies).toEqual(['done']);

  one.running.add(BACK);
  expect(await one.post.run({ text: 'the subagent finished' }, called(BACK))).toBe('Posted to the main chat.');
  expect(one.front.endings).toEqual([]);
  expect(one.wake.main(BACK)).toMatchObject({ turnId: 'bot-1', own: true });

  one.running.delete(BACK);
  one.wake.finished(BACK, 'the last words');
  // It posted, so the end adds no last words.
  expect(one.front.posts).toEqual(['the subagent finished']);
  expect(one.front.replies).toEqual([]);
  expect(one.front.endings).toEqual(['ended']);
});

it('says the last words of a turn the Back ran on its own in a turn the bot opens, and nothing of a worker\'s', async () => {
  const one = await sitting();
  const said = await woken(one);
  one.wake.finished(BACK, 'started');
  expect(said.replies).toEqual(['started']);

  await one.wake.spoke(CHAT, WORKER, 'a worker said this');
  expect(one.front.spoken).toEqual([]);

  await one.wake.spoke(CHAT, BACK, '');
  expect(one.front.spoken).toEqual([]);

  await one.wake.spoke(CHAT, BACK, 'the timer is done: 4 ticks');
  expect(one.front.spoken).toEqual(['bot-1']);
  expect(one.front.replies).toEqual(['the timer is done: 4 ticks']);
});

it('keeps a Back\'s own turn out of the Front where mainTurnPostMessageAbsent is silence', async () => {
  const one = await sitting(bot(), 'silence');
  await woken(one);
  one.wake.finished(BACK, 'started');

  await one.wake.spoke(CHAT, BACK, 'the timer is done');
  expect(one.front.spoken).toEqual([]);
});

it('keeps a post through a steer into the same main turn', async () => {
  const one = await sitting();
  const said = await woken(one);

  await one.post.run({ text: 'the answer' }, called(BACK));
  // The person says more while the back turn runs, and it goes into the same
  // main turn. It waits in the back session behind the turn that posted.
  await one.wake.woken(message('t1', 'and one more thing'), said.handle);
  const more = String(one.sent.at(-1)?.['id']);
  one.wake.finished(BACK, 'the first words');
  expect(said.endings).toEqual([]);

  // The turn that message becomes ends the main turn the post went into.
  one.wake.taken(BACK, 'r2', more);
  one.wake.finished(BACK, 'the last words');

  expect(said.posts).toEqual(['the answer']);
  expect(said.replies).toEqual([]);
  expect(said.endings).toEqual(['ended']);
});

it('refuses a chat that is not a Back', async () => {
  const one = await sitting();
  const said = await woken(one);

  // A chat under no Front has nothing to post to, and the tool says so rather
  // than throwing: the model can go on with its own turn.
  expect(await one.post.run({ text: 'the answer' }, called('ahp-chat:/stray')))
    .toBe('This chat is not under a main chat, so there is nothing to post to.');
  expect(said.replies).toEqual([]);
  expect(one.wake.main(BACK)).toMatchObject({ turnId: 't1' });
});

it('posts into the chat that woke the session, never one an input names', async () => {
  const one = await sitting();
  const said = await woken(one);

  // The only input is the text, and anything else a caller sends is ignored:
  // the chat answered is the one the calling session was woken by.
  await one.post.run({ text: 'the answer', session: 'bot-chat:/another' }, called(BACK));

  expect(said.posts).toEqual(['the answer']);
});

/**
 * The main turn one back session answered, after its turn ends with `text` and
 * no post.
 */
async function ended(absent: MainTurnAbsence | undefined, text: string) {
  const one = await sitting(bot(), absent);
  const said = await woken(one);
  one.wake.finished(BACK, text);
  return { one, said };
}

it('posts the last words of a turn that ended with no post, by default', async () => {
  const { one, said } = await ended(undefined, 'The answer is 42.');

  // The default: the person asked a question, so the session's last words are
  // the reply rather than a notice that nothing was posted.
  expect(said.replies).toEqual(['The answer is 42.']);
  expect(said.notices).toEqual([]);
  expect(said.endings).toEqual([]);
  expect(one.wake.main(BACK)).toBeUndefined();
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

  one.wake.finished(BACK, 'half an answer', 'the model call failed');

  expect(said.failures).toEqual(['the model call failed']);
  expect(said.replies).toEqual([]);
  expect(said.notices).toEqual([]);
  expect(said.endings).toEqual([]);
});

it('ends the main turn once, whichever road got there first', async () => {
  const one = await sitting();
  const said = await woken(one);

  one.wake.finished(BACK, 'the answer');
  // A second ending would be a turn of its own, and a session this wake never
  // woke ends nothing at all.
  one.wake.finished(BACK, 'and again');
  one.wake.finished('ahp-chat:/stray', 'nobody');

  expect(said.replies).toEqual(['the answer']);
  expect(said.notices).toEqual([]);
  expect(said.endings).toEqual([]);
  expect(one.wake.main(BACK)).toBeUndefined();
});

it('ends the main turn with no more text when the session\'s own turn ends after a post', async () => {
  for (const absent of ['post', 'notice', 'silence', 'postNotice'] as const) {
    const one = await sitting(bot(), absent);
    const said = await woken(one);

    await one.post.run({ text: 'the answer' }, called(BACK));
    // The answer is not followed by the last words as well, and neither is it
    // followed by a notice saying it was not given, whatever the option says.
    one.wake.finished(BACK, 'the last words');

    expect(said.posts).toEqual(['the answer']);
    expect(said.replies).toEqual([]);
    expect(said.notices).toEqual([]);
    expect(said.endings).toEqual(['ended']);
  }
});

it('fails the main turn when the back turn fails after a post', async () => {
  const one = await sitting();
  const said = await woken(one);

  await one.post.run({ text: 'half an answer' }, called(BACK));
  one.wake.finished(BACK, 'half an answer', 'the model call failed');

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
  expect(tool.instruction).toMatch(/send_message starts a turn in another chat and does not reach the person/);
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
  expect(Object.keys(optionsSchema.properties)).toEqual(['root', 'mainTurnPostMessageAbsent', 'instructionsIn', 'contextIn', 'askIn', 'secondSession']);
  expect(Object.keys(defaults)).toEqual(['root', 'mainTurnPostMessageAbsent', 'instructionsIn', 'contextIn', 'askIn', 'secondSession']);
  const exported = await import('../src/index.js');
  expect(exported).not.toHaveProperty('firstTurn');
  expect(exported).not.toHaveProperty('chatLines');
});

it('reports a value outside the table, and loads anyway', () => {
  const root = mkdtempSync(join(tmpdir(), 'ahpd-bot-post-option-'));
  const context: LoaderContext = {
    path: root, paths: [root], version: sdkVersion(), hostName: 'test', configDir: join(root, 'config'), log: loggerOf(() => {}), say: () => {},
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

it('copies a subagent\'s question asked while no turn waits into a turn the bot opens, and ends it once answered', async () => {
  const one = await sitting();
  const said = await woken(one);
  one.wake.finished(BACK, 'started');
  expect(said.replies).toEqual(['started']);
  const toBack: Bag[] = [];
  const entry: Bag = {
    id: 'toolu_run', chat: WORKER, kind: 'toolConfirmation', turnId: 'w1',
    toolCall: { toolCallId: 'toolu_run', toolName: 'Bash', displayName: 'Bash', status: 'pending-confirmation', confirmationTitle: 'Run in terminal?', invocationMessage: 'Run it' },
  };
  const ask = botAsk({
    main: (chat) => one.wake.main(chat),
    request: async () => entry,
    send: async (chat, action) => { toBack.push({ chat, action }); return undefined; },
    reach: (session, chat) => one.wake.reach(session, chat),
    settle: (backChat) => one.wake.settle(backChat),
    problem: () => {},
  });

  await ask.asked(CHAT, WORKER, 'toolu_run');
  expect(one.front.spoken).toEqual(['bot-1']);
  expect(one.front.asked).toEqual(['toolu_run']);
  // The turn stays open while the question is.
  expect(one.front.endings).toEqual([]);

  one.front.handle.onConfirm?.('toolu_run', true, 'allow-once');
  await new Promise((done) => { setTimeout(done, 5); });
  expect(toBack).toMatchObject([{ chat: WORKER, action: { type: 'chat/toolCallConfirmed', toolCallId: 'toolu_run', approved: true } }]);
  expect(one.front.endings).toEqual(['ended']);
});

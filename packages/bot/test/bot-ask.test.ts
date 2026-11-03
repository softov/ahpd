import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { botAsk } from '../src/ask.js';
import { botChatAgent, turns } from '../src/chat.js';
import { botStore } from '../src/store.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { Start } from '../../sdk/src/types/agent.js';
import type { RecordStore } from '../../sdk/src/types/records.js';
import type { Session } from '../../sdk/src/types/session.js';
import type { Answering } from '../src/wake.js';

/*
 * A back session's question is asked where the person is talking.
 *
 * A harness asks in the chat it runs in, which for a bot is the back session
 * and not the main chat. What is checked here is the road between the two: the
 * request is copied into the open main turn - an approval as a tool call
 * waiting on confirmation, a question as an input request part - an answer
 * given in the main chat is sent to the back session's chat, and a request the
 * back session withdraws leaves the main turn.
 */

/** A temporary directory removed after the test that made it. */
let loose: string[] = [];
beforeEach(() => { loose = []; });
afterEach(() => {
  for (const dir of loose) rmSync(dir, { recursive: true, force: true });
  loose = [];
});

/** The back session's chat, as the request names it. */
const BACK_CHAT = 'ahp-chat:/back';

/** The main chat's session, as this backend knows it. */
const MAIN = 'bot-chat:/solo';

/** Let the send that an answer starts settle before it is read. */
const settle = async (times = 8): Promise<void> => {
  for (let i = 0; i < times; i++) await new Promise((r) => { setTimeout(r, 0); });
};

/** A chat backend over a store holding one bot. */
async function backend(configDir: string, records: RecordStore) {
  const store = botStore(
    await records.collection('bots', { body: 'instructions' }),
    await records.collection('bots-gone'),
    () => {},
  );
  await store.ready();
  return botChatAgent(configDir, store);
}

/** A main chat with a turn open, and what it is told. */
interface Sitting {
  session: Session;
  /** The actions the backend emitted on the main chat, in order. */
  sent: Bag[];
}

/**
 * One main chat, one bot, and one open turn.
 *
 * Nothing is started through a host: the turn is the main chat's own, and the
 * handle a wake would hold is the one `turns` answers with. The person hears
 * from it as `onMessage`, which is what a plugin sets.
 */
async function sitting(): Promise<Sitting> {
  const configDir = mkdtempSync(join(tmpdir(), 'ahpd-bot-ask-'));
  loose.push(configDir);
  const records = memoryRecords();
  const bots = await records.collection('bots', { body: 'instructions' });
  // A bot as the store reads one: every field `kept` checks, and no more. What
  // this test needs of it is its name and that a chat can be started for it.
  const now = new Date().toISOString();
  await bots.put({
    id: 'backer',
    name: 'Backer',
    workspace: join(configDir, 'bots', 'backer'),
    owner: 'user:ana',
    createdAt: now,
    updatedAt: now,
    color: 'blue',
    labels: [],
  });
  const agent = await backend(configDir, records);
  const sent: Bag[] = [];
  const start: Start = {
    uri: MAIN,
    chatUri: 'ahp-chat:/main',
    settings: { bot: 'backer' },
    schema: () => ({}),
    emit: (_channel: string, action: Bag) => { sent.push(action); },
    clientToolTimeoutMs: 0,
  };
  const session = agent.create(start);
  turns(MAIN).onMessage = () => {};
  session.begin('t1', 'hello');
  return { session, sent };
}

/** The asking over one main turn, with the back session's chat recording what it is sent. */
function asking(session: Session, entries: Map<string, Bag>, toBack: Bag[]): ReturnType<typeof botAsk> {
  const held: Answering = { session: MAIN, turnId: 't1', handle: turns(MAIN), bot: 'Backer', waiting: new Set() };
  return botAsk({
    main: (back) => (back === 'bot:/backer/ana/work' ? held : undefined),
    request: async (back, id) => (back === 'bot:/backer/ana/work' ? entries.get(id) : undefined),
    send: async (chat, action) => { toBack.push({ chat, action }); return undefined; },
    problem: () => {},
  });
}

/** The entry a back session raises for a tool call waiting on an approval. */
const approval = (): Bag => ({
  id: 'toolu_run',
  chat: BACK_CHAT,
  kind: 'toolConfirmation',
  turnId: 'back-t1',
  toolCall: {
    toolCallId: 'toolu_run',
    toolName: 'Bash',
    displayName: 'Bash',
    status: 'pending-confirmation',
    confirmationTitle: 'Run in terminal',
    invocationMessage: 'Run `ls` in the bot folder',
    toolInput: { command: 'ls' },
  },
});

/** The entry a back session raises for a question. */
const question = (): Bag => ({
  id: 'ask-1',
  chat: BACK_CHAT,
  kind: 'chatInput',
  request: {
    id: 'ask-1',
    message: 'The bot has a question',
    questions: [{
      id: 'q1',
      kind: 'single-select',
      message: 'Which folder?',
      options: [{ id: 'here', label: 'Here' }, { id: 'there', label: 'There' }],
    }],
  },
});

it('sends an approval from the main chat to the back session', async () => {
  const { session, sent } = await sitting();
  const toBack: Bag[] = [];
  const ask = asking(session, new Map([['toolu_run', approval()]]), toBack);
  await ask.asked('bot:/backer/ana/work', 'toolu_run');

  // The open main turn shows the back session's approval, with its own title.
  const active = session.chatState().activeTurn as Bag;
  expect(active['responseParts']).toMatchObject([{
    kind: 'toolCall',
    toolCall: {
      toolCallId: 'toolu_run',
      status: 'pending-confirmation',
      confirmationTitle: 'Run in terminal',
    },
  }]);

  /*
   * The person approves it in the main chat, which is what the host does with
   * a client's `chat/toolCallConfirmed`: the session's own `confirm`, not the
   * back session's. The approval travels to the chat that asked.
   */
  session.confirm('toolu_run', true, 'allow-once');
  await settle();
  expect(toBack).toEqual([{
    chat: BACK_CHAT,
    action: {
      type: 'chat/toolCallConfirmed',
      turnId: 'back-t1',
      toolCallId: 'toolu_run',
      approved: true,
      confirmed: 'user-action',
      selectedOptionId: 'allow-once',
    },
  }]);
  // The host does not echo a tool confirmation, so the backend draws it.
  expect(sent.filter((one) => one['type'] === 'chat/toolCallConfirmed')).toMatchObject([{
    turnId: 't1', toolCallId: 'toolu_run', approved: true, confirmed: 'user-action', selectedOptionId: 'allow-once',
  }]);
});

it('sends a question answered in the main chat to the back session', async () => {
  const { session, sent } = await sitting();
  const toBack: Bag[] = [];
  const ask = asking(session, new Map([['ask-1', question()]]), toBack);
  await ask.asked('bot:/backer/ana/work', 'ask-1');

  // The question is a part of the open turn, with the back session's fields.
  const active = session.chatState().activeTurn as Bag;
  expect(active['responseParts']).toMatchObject([{
    kind: 'inputRequest',
    request: { id: 'ask-1', message: 'The bot has a question' },
  }]);
  expect(sent.filter((one) => one['type'] === 'chat/inputRequested')).toHaveLength(1);

  const answers = { q1: { kind: 'selected', value: 'here' } };
  const taken = session.answer('ask-1', true, answers, 'accept');
  // True, which is what makes the host echo the answer to the main chat.
  expect(taken).toBe(true);
  await settle();
  expect(toBack).toEqual([{
    chat: BACK_CHAT,
    action: { type: 'chat/inputCompleted', requestId: 'ask-1', response: 'accept', answers },
  }]);
});

/*
 * A question the back session withdrew clears in the main chat at once.
 *
 * The protocol has no action that removes a response part, so the copy leaves
 * the open turn and the chat is told the request is over: a person left drawing
 * it would be answering a question nobody is asking any more.
 */
it('takes the copy out of the main chat when the back session withdraws its question', async () => {
  const { session, sent } = await sitting();
  const toBack: Bag[] = [];
  const entries = new Map([['ask-1', question()]]);
  const ask = asking(session, entries, toBack);
  await ask.asked('bot:/backer/ana/work', 'ask-1');

  // The back session settled the request some other way and no longer asks.
  ask.withdrawn('bot:/backer/ana/work', 'ask-1');

  const active = session.chatState().activeTurn as Bag;
  expect(active['responseParts']).toEqual([]);
  expect(sent.filter((one) => one['type'] === 'chat/inputCompleted')).toEqual([
    { type: 'chat/inputCompleted', requestId: 'ask-1', response: 'cancel' },
  ]);
  // An answer after the withdrawal is no longer this turn's to take.
  expect(session.answer('ask-1', true, {}, 'accept')).toBe(false);
  expect(toBack).toEqual([]);
});

import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { memoryRecords } from '../../sdk/src/resources/records.js';
import { botChatAgent } from '../src/chat.js';
import { contextBlock, timeWithOffset } from '../src/context.js';
import { backSessions, chatsOf, rowId, sessionsOf } from '../src/names.js';
import { botStore } from '../src/store.js';
import { botWake } from '../src/wake.js';
import type { ChatMessage, TurnHandle } from '../src/chat.js';
import type { BotSessions } from '../src/provider.js';
import type { BotRecord } from '../src/record.js';
import type { Bag } from '../../sdk/src/types/common.js';
import type { Start } from '../../sdk/src/types/agent.js';
import type { SessionRequest } from '../../sdk/src/types/plugin.js';
import type { Owner } from '../../sdk/src/types/usage.js';

/*
 * What a woken message carries in front of the person's words.
 *
 * The bot's rules are the same for every message and belong in its system
 * prompt or its `AGENTS.md`. The chat a message came from, who said it and when
 * are not: they are put in a block in front of the text the back session is
 * given, and the main chat keeps the person's own words with no block in them.
 *
 * The host's own halves are stubs, as in `bot-wake.test.ts`: what starts a
 * session and what carries an action are the plugin's. The chat in the last
 * case is the real `bot-chat` agent, because whether a person sees the block
 * is a question about what that chat keeps.
 */

/** The main chat every case below says something in, as this host holds it. */
const CHAT = 'bot-chat:/one';

/** The person of that chat, who is whose the back session is. */
const PERSON: Owner = 'user:ana';

/** Where the bots work in these cases, which the wake writes the bot's files into. */
const WORKSPACE = mkdtempSync(join(tmpdir(), 'ahpd-bot-context-'));

/** One bot, as the store holds it. */
const bot = (over: Partial<BotRecord> = {}): BotRecord => ({
  id: 'backer',
  name: 'Backer',
  labels: [],
  body: 'robot',
  color: 'red',
  harness: 'base',
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
  /** What the turn was ended with instead of an answer. */
  notices: string[];
  /** One entry per ending, which is the only way a handle says it was used. */
  endings: string[];
}

const turn = (): Recorded => {
  const replies: string[] = [];
  const notices: string[] = [];
  const endings: string[] = [];
  const handle: TurnHandle = {
    // The turn this handle is over is the open one: nothing begins a second.
    begin: () => undefined,
    reply: (text) => { replies.push(text); },
    say: () => {},
    notice: (text) => { notices.push(text); },
    end: () => { endings.push('ended'); },
  };
  return { handle, replies, notices, endings };
};

/** The text one action carried, whichever kind of chat action it is. */
const textOf = (action: Bag): string => {
  const text = (action['message'] as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' ? text : '';
};

/**
 * A wake over one host, with everything the host owns stubbed.
 *
 * The collections and the store are real, because a row that was not written is
 * exactly what a second message would start a second session over. The sessions
 * are a map that mints a URI per start, `look` reads a chat off the same map,
 * and `send` records what it was asked to carry rather than carrying it.
 */
async function sitting(record: BotRecord = bot()) {
  const configDir = mkdtempSync(join(tmpdir(), 'ahpd-bot-context-chat-'));
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
  const sent: { channel: string; action: Bag }[] = [];
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
    // template, and these cases are about the message rather than the file.
    agents: async (one) => `# ${one.name}\n`,
    look: async (session) => {
      const chat = at.get(session);
      if (chat === undefined) throw new Error(`${session} names no chat to say a message in`);
      return { chat };
    },
    send: async (channel, action) => {
      sent.push({ channel, action });
      return undefined;
    },
    problem: () => {},
  });

  return { wake, store, configDir, sent };
}

it('writes one line for each field, between its tags', () => {
  expect(contextBlock([
    ['main chat', 'bot:/backer/ana'],
    ['from', 'ana'],
    ['time', '2026-10-17T12:00:00.000-03:00'],
  ])).toBe([
    '<context>',
    'main chat: bot:/backer/ana',
    'from: ana',
    'time: 2026-10-17T12:00:00.000-03:00',
    '</context>',
  ].join('\n'));
});

it('leaves out a field whose value is empty', () => {
  // A line with nothing after it says nothing, so it is not written at all.
  expect(contextBlock([
    ['main chat', 'bot:/backer/ana'],
    ['from', ''],
    ['time', '2026-10-17T12:00:00.000-03:00'],
  ])).toBe([
    '<context>',
    'main chat: bot:/backer/ana',
    'time: 2026-10-17T12:00:00.000-03:00',
    '</context>',
  ].join('\n'));
  // No fields is a block with no lines, rather than no block: the shape is
  // what a later plan adds a line to.
  expect(contextBlock([])).toBe('<context>\n</context>');
});

it('writes a time as an ISO stamp in the host\'s own offset', () => {
  const at = new Date('2026-10-17T12:34:56.789Z');
  const written = timeWithOffset(at);

  expect(written).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/);
  // The same instant, read back: the offset says where it was local time, and
  // does not move the moment it names.
  expect(new Date(written).getTime()).toBe(at.getTime());
  const offset = -at.getTimezoneOffset();
  const pad = (value: number): string => String(value).padStart(2, '0');
  expect(written.slice(-6)).toBe(`${offset < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(offset) / 60))}:${pad(Math.abs(offset) % 60)}`);
});

it('puts the context block in front of a turn that wakes a session', async () => {
  const one = await sitting();
  await one.wake.woken(message('t1', 'hello'), turn().handle);

  const text = textOf(one.sent[0]?.action ?? {});
  const [block, words, ...rest] = text.split('\n\n');
  // One blank line between the block and the person's words, and the block is
  // the three lines the wake knows about the message.
  expect(rest).toEqual([]);
  expect(words).toBe('hello');
  expect(block).toMatch(/^<context>\nmain chat: bot:\/backer\/ana\nfrom: ana\ntime: [^\n]+\n<\/context>$/);
  expect(block).toMatch(/time: \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/m);
});

it('puts the context block in front of a message the main chat steers into its open turn', async () => {
  const one = await sitting();
  const said = turn();
  await one.wake.woken(message('t1', 'hello'), said.handle);

  await one.wake.woken(message('t1', 'stop that'), said.handle);

  const action = one.sent[1]?.action ?? {};
  expect(action).toMatchObject({ type: 'chat/pendingMessageSet', kind: 'queued' });
  const text = textOf(action);
  expect(text).toMatch(/^<context>\nmain chat: bot:\/backer\/ana\nfrom: ana\ntime: [^\n]+\n<\/context>\n\nstop that$/);
});

it('keeps the block out of the text the main chat shows', async () => {
  const one = await sitting();
  let woken: Promise<void> | undefined;
  const chat = botChatAgent(one.configDir, one.store, (said, handle) => {
    woken = one.wake.woken(said, handle);
  });
  const session = chat.create({
    uri: CHAT,
    chatUri: 'ahp-chat:/one',
    settings: { bot: 'backer' },
    schema: () => ({}),
    emit: () => {},
    clientToolTimeoutMs: 0,
  } as Start);

  session.sendMessage('t1', 'hello');
  await woken;

  // What the person sees is what they typed: the chat's open turn holds the
  // plain words, which are the turn a restarted chat reads back as well.
  expect(session.chatState()['activeTurn']).toMatchObject({ message: { text: 'hello' } });
  // The block is the back session's, in front of the same words.
  expect(textOf(one.sent[0]?.action ?? {})).toMatch(/^<context>\n[\s\S]*\n<\/context>\n\nhello$/);
});

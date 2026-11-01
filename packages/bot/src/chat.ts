import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Status, idOf, uriOf } from '@ahpd/sdk';
import type { Agent, Bag, Listed, MessageFrom, Session, Start } from '@ahpd/sdk';
import { BOTS_DIR, logsOf } from './names.js';
import type { BotRecord } from './record.js';
import type { BotStore } from './store.js';

/**
 * A chat with a bot: a session of its own that runs no model.
 *
 * A bot is a record on `bot://` and the work it does runs in a session of its
 * own, so what a person says *to* it needs a place to be said. That place is a
 * chat: one session of this provider per bot and person, started by a read of
 * the bot (see `provider.ts`), titled with the bot's name, working in the bot's
 * folder.
 *
 * No model runs here either, but something answers: a turn this chat begins
 * stays open until whoever started the chat ends it, through the handle
 * `turns` answers with. The answer is the bot's own - a markdown part when its
 * session posts one, a notice when there is nothing to say, and a cancelled
 * turn when somebody stops it - and until then the turn is the chat's
 * `activeTurn`. A chat nobody is listening to is a chat with no bot behind it,
 * and its turn ends the moment it begins, which is what this backend did before
 * there was a handle.
 *
 * One turn at a time, then. A message that arrives while a turn is open waits
 * behind it, in this chat's own queue, and becomes the next turn when that one
 * ends.
 *
 * What this backend is for is the *log*: one JSON line per moment under
 * `<configDir>/bots/<slug>/logs/`, in the folder of the bot the chat is with -
 * a line when a turn begins, and a line when it ends with its response. A
 * message steered into a running turn is a turn of its own, written down the
 * same two ways. Nothing about a chat is kept in memory past the process that
 * made it, so `list`, `find` and `transcript` read the folders and there is no
 * index that could fall out of step with them.
 */

/**
 * One turn, as `Agent.transcript` answers with it.
 *
 * Named by query rather than imported from the protocol package: an agent
 * backend states its protocol shapes through `@ahpd/sdk`, and taking a second
 * dependency to repeat the same type would be a boundary this package does not
 * declare.
 */
type Transcript = NonNullable<Awaited<ReturnType<NonNullable<Agent['transcript']>>>>;
type ChatTurn = Transcript[number];

/** How a turn can end, in the protocol's spelling. */
type Ending = ChatTurn['state'];

/**
 * One turn a chat has open, before it is a turn at all.
 *
 * `ActiveTurn` in the protocol's spelling, and without the two fields a turn
 * has only once it has ended: a state and a duration. Being open is exactly the
 * absence of those.
 */
interface OpenTurn {
  id: string;
  startedAt: string;
  message: ChatTurn['message'];
  responseParts: Bag[];
  /** The calls this turn shows while it waits on another session's chat. */
  calls: WorkingCall[];
  /** The questions and approvals it shows while another session waits on a person. */
  asked: AskedCopy[];
}

/**
 * One call an open turn shows: the chat it waits on, and the part it is drawn by.
 *
 * A call is a part the turn's `responseParts` holds while it runs - the
 * protocol's `chat/toolCallStart` *appends* one - and the part is what the
 * completion updates. Holding it here is what lets the completion name the same
 * part rather than add a second one.
 */
interface WorkingCall {
  /** The chat of another session this turn is waiting on. */
  chat: string;
  /** The `toolCall` part, as the turn holds it and as a client drew it. */
  part: Bag;
}

/**
 * One request another session is waiting on, as this turn shows it.
 *
 * The copy is the back session's own request, drawn here so the person answers
 * it where they are talking. It is kept by the entry's id, because that is what
 * the back session's removal names, while the answer names the request inside a
 * chat input or the call inside a tool confirmation.
 */
interface AskedCopy {
  /** The id of the `session/inputNeeded` entry the back session raised. */
  id: string;
  /** The part this turn shows: an `inputRequest` for a question, a `toolCall` for an approval. */
  part: Bag;
}

/**
 * One message waiting for the turn in front of it.
 *
 * What a client queued, and what a `begin` found a turn already running: the
 * same thing either way, because both are a message that has to wait and the
 * only difference between them is who chose the id - and a turn id is chosen
 * for a queued message when it is held rather than when it starts.
 */
interface Waiting {
  /** The turn it becomes, fixed when it was held. */
  turnId: string;
  /** The entry a client holds it in its queue as, which is the turn id a `begin` named. */
  id: string;
  text: string;
  /** Who said it, where anybody was named. */
  from: MessageFrom | undefined;
}

/**
 * One message in a chat: what was said, and the turn it belongs to.
 *
 * What the handle's `onMessage` is told. A turn this chat begins and a message
 * steered into the open one are told the same way, because the difference is
 * not in the telling: whoever answers is told what somebody said, and answers
 * the turn either way.
 */
export interface ChatMessage {
  /** The URI of the session the chat is in. */
  session: string;
  /** The turn that began, or the open turn the message was steered into. */
  turnId: string;
  /** What was said. */
  text: string;
}

/**
 * The handle over one chat's open turn: what ends it, and what hears about it.
 *
 * Held by whoever started the chat, which is the plugin: nothing in this
 * package knows what a bot's answer is, and nothing here would ever end a turn
 * by itself. `reply` is that answer, `notice` is something that happened
 * instead of one, and `end` is a turn that gets neither - each ends the turn it
 * finds open, and does nothing at all when there is none.
 *
 * `onMessage` is the other direction: each turn this chat begins, and each
 * message steered into the open one, is handed to it. That is how what a person
 * says to a bot reaches the session that does the work.
 */
export interface TurnHandle {
  /** End the open turn with this as its answer. */
  reply(text: string): void;
  /** End the open turn with a notice rather than an answer. */
  notice(text: string): void;
  /** End the open turn with no response at all. */
  end(): void;
  /**
   * Say the open turn is waiting on a chat of another session, and link it.
   *
   * The turn shows one tool call of kind `subagent` whose content names that
   * chat, which is how a client opens it: the back session is not a worker
   * this chat's backend opened, so nothing else would draw it. Optional
   * because a handle over a chat with nothing behind it has nothing to show.
   */
  working?(chat: string, title: string): void;
  /**
   * Show a request another session is waiting on, in the open turn.
   *
   * The entry is the back session's `session/inputNeeded` entry, whole: an
   * approval is drawn as a tool call in `pending-confirmation` with the back
   * session's own title, and a question as an `inputRequest` part with its
   * fields. Optional for the same reason `working` is.
   */
  asking?(entry: Bag): void;
  /** Take a request's copy out of the open turn, because the back session no longer waits on it. */
  withdrawn?(id: string): void;
  /** What a client of this chat confirmed, for the plugin to send back to the back session. */
  onConfirm?: (toolCallId: string, approved: boolean, optionId?: string) => void;
  /**
   * What a client of this chat answered, for the plugin to send back.
   *
   * True where the request is one this turn shows: the host echoes a taken
   * `chat/inputCompleted` to the chat on that answer, as it does for a session
   * that asks by itself.
   */
  onAnswer?: (requestId: string, accepted: boolean, answers: Bag, response?: 'accept' | 'decline' | 'cancel') => boolean;
  /** Who hears about each turn that begins and each message steered into one. */
  onMessage?: (message: ChatMessage) => void;
}

/** The provider id a chat is registered and named under. */
export const CHAT_PROVIDER = 'bot-chat';

/** What a chat's log file is named with. */
const LOG = '.jsonl';

/** The file one chat's log is in. */
const fileOf = (dir: string, id: string): string => join(dir, `${encodeURIComponent(id)}${LOG}`);

/**
 * Every bot's logs folder under this daemon's configuration, to be read.
 *
 * One folder per bot, because one bot's chats are part of what its own folder
 * holds. A bot whose folder has no `logs/` is simply not found in: a bot nobody
 * has talked to has no log, which is not an error.
 */
const logDirs = (configDir: string): string[] => {
  try {
    return readdirSync(join(configDir, BOTS_DIR), { withFileTypes: true })
      .filter((one) => one.isDirectory())
      .map((one) => logsOf(configDir, one.name));
  }
  catch { return []; }
};

/**
 * The id a log file's name holds, or nothing when the name is not one.
 *
 * A log is named by a session id, which is a client's to choose, so the name is
 * escaped on the way out and read back here. A file a person put in the folder
 * by hand, and one whose name is not readable text, are both left out.
 */
const idOfFile = (name: string): string | undefined => {
  if (!name.endsWith(LOG)) return undefined;
  try {
    const id = decodeURIComponent(name.slice(0, -LOG.length));
    return id === '' ? undefined : id;
  }
  catch { return undefined; }
};

/**
 * The bot's mark, as the `_meta` of a chat and of its session.
 *
 * What says which bot a chat is for. `kind` is `direct` because that is what
 * this is: one person, one bot, nobody else in it.
 */
const markOf = (bot: BotRecord): Bag => ({
  bot: bot.id,
  name: bot.name,
  color: bot.color,
  labels: bot.labels,
  body: bot.body,
  kind: 'direct',
});

/** The `_meta` one log line or one chat state carries, where it carries one. */
const markIn = (said: Bag): Bag | undefined => {
  const meta = said['_meta'];
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? meta as Bag : undefined;
};

/** The message a turn carries: what was said, and who said it. */
const messageOf = (text: string, from?: MessageFrom): ChatTurn['message'] => ({
  text,
  origin: from?.origin ?? { kind: 'user' },
  ...(from?._meta === undefined ? {} : { _meta: from._meta }),
});

/**
 * The ending a line's `state` names, or `complete` where it names none.
 *
 * A line a turn *began* with carries no state, and neither does one a person
 * wrote by hand. A state is what an ending is, so anything that is not one of
 * the endings reads back as a turn that finished - which is what such a turn
 * is, as far as a chat that answers again after a restart can say.
 */
const endingIn = (said: unknown): Ending => (
  said === 'cancelled' || said === 'error' ? said : 'complete'
);

/**
 * One turn read back off a log line, or nothing when the line is not one.
 *
 * A log a person has edited by hand can say anything, so what comes back is
 * built here rather than trusted: a line with no turn id and no text is left
 * out, and the rest is read for the fields the protocol requires. The mark the
 * line carries stays behind - it is there for `list` and `find`, and a turn
 * served to a client is the turn alone.
 */
const turnOf = (said: Bag): ChatTurn | undefined => {
  const id = said['id'];
  const message = said['message'];
  if (typeof id !== 'string' || id === '') return undefined;
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return undefined;
  const held = message as Bag;
  if (typeof held['text'] !== 'string') return undefined;
  const origin = held['origin'];
  return {
    id,
    ...(typeof said['startedAt'] === 'string' ? { startedAt: said['startedAt'] } : {}),
    ...(typeof said['duration'] === 'number' ? { duration: said['duration'] } : {}),
    message: {
      text: held['text'],
      // The protocol requires an origin, and a line with none was written by a
      // person: every turn in a chat here is.
      origin: (typeof origin === 'object' && origin !== null ? origin : { kind: 'user' }) as ChatTurn['message']['origin'],
      ...(typeof held['_meta'] === 'object' && held['_meta'] !== null ? { _meta: held['_meta'] as Bag } : {}),
    },
    responseParts: Array.isArray(said['responseParts']) ? said['responseParts'] as Bag[] : [],
    state: endingIn(said['state']),
    usage: undefined,
  };
};

/**
 * What one chat's log holds: its turns, and the mark its lines carry.
 *
 * Nothing when there is no log for the id, which is a chat this host does not
 * have - a different answer from a log with no turns in it, which is one
 * nothing has been said to yet.
 *
 * Every line carries the mark, and not only the first: a line is a turn, two
 * turns are two lines, and a file whose first line is unreadable still says
 * which chat it is. It is what tells a listing which bot a chat is for, since
 * the file is named by a session id and says nothing else.
 *
 * A turn is two lines - the one it began with and the one it ended with - and
 * what comes back is one turn: the line an ending was written on replaces the
 * line the turn opened on, because it is the same turn said again, as it
 * finished. A chat whose daemon died mid-turn has only the first of the two,
 * and that reads as the turn it was.
 */
const logAt = (path: string): { turns: ChatTurn[]; mark: Bag | undefined } | undefined => {
  let text: string;
  try { text = readFileSync(path, 'utf8'); }
  catch { return undefined; }
  const turns: ChatTurn[] = [];
  /** Where each turn read so far sits, so the line that ends it can replace it. */
  const at = new Map<string, number>();
  let mark: Bag | undefined;
  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let said: unknown;
    // A line nobody can read is left out, as a bot the store cannot read is.
    try { said = JSON.parse(line); }
    catch { continue; }
    if (typeof said !== 'object' || said === null || Array.isArray(said)) continue;
    const held = said as Bag;
    /*
     * A message somebody said into a turn that was already running, in a log
     * written before a steer became a turn of its own.
     *
     * It is read as what it now would be written as: a turn of its own,
     * finished, with the steered message and no reply. The line's id is the id
     * of the turn it went into, so a turn of its own takes one derived from it:
     * folding the two together would lose the steer the person watched happen.
     * A log written since has no such line - a steer writes a turn instead.
     */
    if (held['steering'] === true) {
      mark ??= markIn(held);
      const one = turnOf(held);
      if (one === undefined) continue;
      let steered = `${one.id}:steer`;
      for (let n = 2; at.has(steered); n += 1) steered = `${one.id}:steer${n}`;
      one.id = steered;
      at.set(steered, turns.length);
      turns.push(one);
      continue;
    }
    const one = turnOf(held);
    if (one === undefined) continue;
    mark ??= markIn(held);
    const known = at.get(one.id);
    if (known === undefined) {
      at.set(one.id, turns.length);
      turns.push(one);
    }
    else turns[known] = one;
  }
  return { turns, mark };
};

/** Add one turn to a chat's log, making the folder the first time. */
const append = (dir: string, id: string, said: Bag): void => {
  mkdirSync(dir, { recursive: true });
  appendFileSync(fileOf(dir, id), `${JSON.stringify(said)}\n`, 'utf8');
};

/**
 * One chat's row, read off its log, or nothing when there is no log.
 *
 * The name and the folder are the bot's as it is now, read from the store; the
 * mark says which bot a chat is for, and it goes on the row so a client draws
 * a chat nothing runs as a bot chat. Sent from the store while the bot is
 * there, and from the log when it is gone - the log is the whole answer for a
 * chat whose bot has since been deleted.
 */
const rowOf = (dir: string, id: string, store: BotStore): Listed | undefined => {
  const path = fileOf(dir, id);
  let born: Date;
  let touched: Date;
  try {
    const stat = statSync(path);
    born = stat.birthtime;
    touched = stat.mtime;
  }
  catch { return undefined; }
  const log = logAt(path);
  if (log === undefined) return undefined;
  const slug = typeof log.mark?.['bot'] === 'string' ? log.mark['bot'] : '';
  const bot = store.get(slug);
  const named = log.mark?.['name'];
  const meta = bot === undefined ? log.mark : markOf(bot);
  return {
    id,
    title: bot?.name ?? (typeof named === 'string' && named !== '' ? named : id),
    createdAt: born.toISOString(),
    modifiedAt: touched.toISOString(),
    workingDirectories: bot === undefined ? [] : [uriOf(bot.workspace)],
    ...(meta === undefined ? {} : { _meta: meta }),
  };
};

/**
 * The handles of the chats this process has open, by the URI of their session.
 *
 * A chat is started by the host, which answers with a session URI and nothing
 * else - a `Session` never leaves this package - so a URI is all the plugin
 * that started a chat has to reach the turn in it by. The URI is the one the
 * *host* made for the session, which is the one a backend is started with:
 * a client names an id and the host names the scheme, so the URI a client
 * sent is an alias of this one and not this one.
 */
const handles = new Map<string, TurnHandle>();

/**
 * The handle over one chat's open turn, by the URI of the session it is in.
 *
 * Throws for a session that is not a chat of this provider's: a URI nothing
 * here answers to names something else, which is a different thing from a chat
 * with no turn open in it.
 */
export function turns(session: string): TurnHandle {
  const held = handles.get(session);
  if (held === undefined) throw new Error(`${session} is not a chat this host is running`);
  return held;
}

/**
 * The `bot-chat` agent, over one daemon's configuration folder and its bots.
 *
 * `store` is read rather than a file of its own, because a chat is a chat
 * *with a bot*: which bot it is for is checked at `create`, and a slug no bot
 * has is refused there rather than opening a session nothing can answer.
 *
 * `heard` is set as the `onMessage` of every chat's handle, a new chat and a
 * resumed one alike.
 */
export function botChatAgent(configDir: string, store: BotStore, heard?: (message: ChatMessage, handle: TurnHandle) => void): Agent {
  /**
   * One chat: the turns it holds and the bot it is a chat with.
   *
   * The turns are read off the log whole, so a chat the host starts again -
   * after a restart, or because a client opened a row it was not holding -
   * opens on what was said in it rather than on an empty conversation.
   */
  function chat(start: Start, bot: BotRecord, id: string, mark: Bag, dir: string): Session {
    const turns: ChatTurn[] = logAt(fileOf(dir, id))?.turns ?? [];
    let modified = new Date().toISOString();
    let draft: Bag | undefined;
    /**
     * The turn this chat has open, until the handle ends it.
     *
     * Not in `turns`: a turn is one of those once it has ended, and what a
     * client reading the chat is told about while it runs is `activeTurn`. A
     * chat starts with none open, even one whose log has a line a turn began
     * with and none it ended with - nothing here knows who was going to answer
     * it, and the plugin that started the chat is where that is known.
     */
    let open: OpenTurn | undefined;
    /**
     * Messages waiting for the open turn to end, in the order they will start.
     *
     * The queue is the session's rather than a client's, because nothing in a
     * client watches for a turn to end: a message held there would be one
     * nothing could ever send. A chat that is closed with messages still in it
     * loses them, as a backend gone between two turns loses everything it was
     * holding.
     */
    const waiting: Waiting[] = [];

    const touch = (): void => { modified = new Date().toISOString(); };

    /**
     * Say the open turn is waiting on another session's chat, as a subagent is drawn.
     *
     * The call starts, runs, and its content names the chat, which is the link
     * a client opens. One call per chat in a turn: a message steered into an
     * open turn wakes the same back session again, and a second row for it
     * would be a second worker nobody started.
     *
     * `subagentChatUri` is in the `_meta` because the host stamps a spawning
     * call with a worker chat of *this* session when nothing is named, and a
     * worker chat derived here is a chat that does not exist. The chat is the
     * back session's own, which only this side knows.
     */
    const showWorking = (held: OpenTurn, chat: string, title: string): void => {
      if (held.calls.some((one) => one.chat === chat)) return;
      const toolCallId = `call-${crypto.randomUUID()}`;
      const meta: Bag = { toolKind: 'subagent', subagentChatUri: chat };
      const part: Bag = {
        kind: 'toolCall',
        toolCall: { toolCallId, toolName: 'subagent', displayName: title, status: 'streaming', _meta: meta },
      };
      held.responseParts.push(part);
      held.calls.push({ chat, part });
      start.emit('chat', {
        type: 'chat/toolCallStart',
        turnId: held.id,
        toolCallId,
        toolName: 'subagent',
        displayName: title,
        _meta: meta,
      });
      // Running, not a question: nothing is being asked, and a call left
      // streaming is one the reducer will not take content for.
      const toolCall = part.toolCall as Bag;
      toolCall.status = 'running';
      toolCall.confirmed = 'not-needed';
      toolCall.invocationMessage = title;
      start.emit('chat', {
        type: 'chat/toolCallReady',
        turnId: held.id,
        toolCallId,
        invocationMessage: title,
        confirmed: 'not-needed',
        _meta: meta,
      });
      const content = [{ type: 'subagent', resource: chat, title }];
      toolCall.content = content;
      start.emit('chat', {
        type: 'chat/toolCallContentChanged',
        turnId: held.id,
        toolCallId,
        content,
        _meta: meta,
      });
    };

    /**
     * Show one of another session's requests in the open turn.
     *
     * An approval starts a tool call of its own here - the back session's call
     * is in the back chat and a client of this chat cannot see it - and the
     * copy is `pending-confirmation` with the same title, so the person
     * approves it where they are talking. A question appends the back
     * session's `inputRequest` part with its request whole, which is what a
     * harness's own question looks like.
     *
     * The call's `_meta` is not copied: a spawning call of the back session
     * says `toolKind: 'subagent'`, and a copy saying it here would be stamped
     * with a worker chat of *this* session - a chat nobody opened.
     *
     * An entry the turn already shows is replaced rather than added, which is
     * the protocol's upsert by request id: a question re-raised with its
     * answers is the same part, and a confirmation re-raised is the same call.
     */
    const showAsked = (held: OpenTurn, entry: Bag): void => {
      const id = typeof entry['id'] === 'string' ? entry['id'] : '';
      if (id === '') return;
      const known = held.asked.find((one) => one.id === id);
      const kind = entry['kind'];
      if (kind === 'chatInput') {
        const request = entry['request'];
        if (typeof request !== 'object' || request === null || Array.isArray(request)) return;
        const copy = { ...request as Bag };
        const requestId = typeof copy['id'] === 'string' ? copy['id'] : id;
        copy['id'] = requestId;
        const part: Bag = { kind: 'inputRequest', request: copy };
        if (known === undefined) {
          held.responseParts.push(part);
          held.asked.push({ id, part });
        }
        else known.part = part;
        start.emit('chat', { type: 'chat/inputRequested', request: copy });
        return;
      }
      if (kind !== 'toolConfirmation') return;
      const found = entry['toolCall'];
      if (typeof found !== 'object' || found === null || Array.isArray(found)) return;
      const original = found as Bag;
      const toolCallId = typeof original['toolCallId'] === 'string' && original['toolCallId'] !== ''
        ? original['toolCallId'] as string
        : id;
      const toolName = typeof original['toolName'] === 'string' ? original['toolName'] as string : 'tool';
      const displayName = typeof original['displayName'] === 'string' ? original['displayName'] as string : toolName;
      const confirmationTitle = original['confirmationTitle'] ?? `Run ${displayName}?`;
      const invocationMessage = original['invocationMessage'] ?? confirmationTitle;
      const toolCall: Bag = {
        toolCallId,
        toolName,
        displayName,
        status: 'pending-confirmation',
        confirmationTitle,
        invocationMessage,
        ...(original['toolInput'] === undefined ? {} : { toolInput: original['toolInput'] }),
        ...(original['options'] === undefined ? {} : { options: original['options'] }),
        ...(original['edits'] === undefined ? {} : { edits: original['edits'] }),
        ...(original['riskAssessment'] === undefined ? {} : { riskAssessment: original['riskAssessment'] }),
        ...(original['editable'] === undefined ? {} : { editable: original['editable'] }),
      };
      const part: Bag = { kind: 'toolCall', toolCall };
      if (known === undefined) {
        held.responseParts.push(part);
        held.asked.push({ id, part });
        start.emit('chat', {
          type: 'chat/toolCallStart',
          turnId: held.id,
          toolCallId,
          toolName,
          displayName,
        });
      }
      else known.part = part;
      start.emit('chat', {
        type: 'chat/toolCallReady',
        turnId: held.id,
        toolCallId,
        invocationMessage,
        confirmationTitle,
        ...(original['toolInput'] === undefined ? {} : { toolInput: original['toolInput'] }),
        ...(original['options'] === undefined ? {} : { options: original['options'] }),
        ...(original['edits'] === undefined ? {} : { edits: original['edits'] }),
      });
    };

    /**
     * Take a request's copy out of the open turn.
     *
     * The protocol has no action that removes a response part, so the copy is
     * spliced out of the state a client subscribes to and a live client is told
     * the part is resolved: a question is cancelled and a call is skipped. The
     * back session asked and no longer asks, and a person left drawing it would
     * be answering a question that is over.
     */
    const withdrawAsked = (held: OpenTurn, id: string): void => {
      const at = held.asked.findIndex((one) => one.id === id);
      if (at < 0) return;
      const [copy] = held.asked.splice(at, 1);
      const part = copy?.part;
      if (part === undefined) return;
      const inTurn = held.responseParts.indexOf(part);
      if (inTurn >= 0) held.responseParts.splice(inTurn, 1);
      if (part['kind'] === 'inputRequest') {
        const request = part['request'] as Bag;
        start.emit('chat', {
          type: 'chat/inputCompleted',
          requestId: String(request['id'] ?? id),
          response: 'cancel',
        });
        return;
      }
      const toolCall = part['toolCall'] as Bag;
      start.emit('chat', {
        type: 'chat/toolCallConfirmed',
        toolCallId: String(toolCall['toolCallId'] ?? id),
        approved: false,
        reason: 'skipped',
      });
    };

    /**
     * End the open turn, and keep the turn it was.
     *
     * The calls the turn showed end with it, and each ending updates the part
     * its start appended rather than adding another: `chat/toolCallStart` is
     * what put the part in a client's turn, and a `chat/responsePart` for the
     * same call would draw it twice.
     *
     * The state and the duration are written down here rather than at the
     * beginning, which is the whole difference between a turn that is open and
     * one that is over. The line goes down before the turn is announced, as the
     * line it began with did: a turn a client watched end is a turn a restart
     * can read back.
     *
     * `next` says whether what was waiting starts now. A steer ends a turn
     * without it: the steered message is a turn in front of the queue, and the
     * message behind it starts when that turn ends.
     */
    const finish = (held: OpenTurn, state: Ending, parts: Bag[], next = true): void => {
      open = undefined;
      const duration = Date.now() - Date.parse(held.startedAt);
      for (const call of held.calls) {
        const toolCall = call.part.toolCall as Bag;
        const result = {
          success: true,
          pastTenseMessage: 'Worked',
          content: [{ type: 'subagent', resource: call.chat, title: String(toolCall.displayName ?? '') }],
        };
        Object.assign(toolCall, result, { status: 'completed', confirmed: 'not-needed' });
        start.emit('chat', {
          type: 'chat/toolCallComplete',
          turnId: held.id,
          toolCallId: toolCall.toolCallId,
          result,
          _meta: toolCall._meta,
        });
      }
      // The calls came first in the turn, and the answer after them.
      const responseParts = [...held.responseParts, ...parts];
      const turn: ChatTurn = {
        id: held.id,
        startedAt: held.startedAt,
        duration,
        message: held.message,
        responseParts,
        state,
        usage: undefined,
      };
      // The same turn said again, as it ended: one turn, two lines, and the
      // second of them is the one a reader takes.
      append(dir, id, { ...turn, _meta: mark });
      turns.push(turn);
      touch();
      // Whatever it answered with, before the turn is said to be over: a part
      // that arrived after the end is a part of a turn nobody is holding. The
      // calls are not here: their starts already appended them.
      for (const part of parts) start.emit('chat', { type: 'chat/responsePart', turnId: held.id, part });
      start.emit('chat', state === 'cancelled'
        ? { type: 'chat/turnCancelled', turnId: held.id, duration }
        : { type: 'chat/turnComplete', turnId: held.id, duration });
      // Whatever was waiting behind it, now that there is nothing in front of
      // it. After the turn is said to be over, so a client reads one ending and
      // then the next beginning rather than the other way round.
      if (next) startNext();
    };

    /**
     * The handle over this chat's open turn, which the plugin that started the
     * chat holds.
     *
     * A method here that finds no open turn does nothing: the turn it was meant
     * to answer has ended, and a second ending would be a second turn.
     */
    const handle: TurnHandle = {
      reply: (text) => {
        const held = open;
        if (held === undefined) return;
        /*
         * One part, whole. Nothing streams into a chat that runs no model, so
         * there are no `chat/delta`s after it - and the id is the turn's, which
         * is what a delta would have appended to.
         */
        finish(held, 'complete', [{ id: `${held.id}:reply`, kind: 'markdown', content: text }]);
      },
      notice: (text) => {
        const held = open;
        if (held === undefined) return;
        // No id: `SystemNotificationResponsePart` has none, which is what the
        // reference harness writes for a notice of its own.
        finish(held, 'complete', [{ kind: 'systemNotification', content: text }]);
      },
      end: () => {
        const held = open;
        if (held === undefined) return;
        finish(held, 'complete', []);
      },
      working: (chat, title) => {
        const held = open;
        if (held === undefined) return;
        showWorking(held, chat, title);
      },
      asking: (entry) => {
        const held = open;
        if (held === undefined) return;
        showAsked(held, entry);
      },
      withdrawn: (id) => {
        const held = open;
        if (held === undefined) return;
        withdrawAsked(held, id);
      },
    };
    if (heard !== undefined) handle.onMessage = (message) => { heard(message, handle); };
    handles.set(start.uri, handle);

    /**
     * Say one turn, and keep the beginning of it.
     *
     * The line goes down before the turn is announced, so a log that could not
     * be written is a turn that did not happen rather than one a client watched
     * and a restart cannot read back.
     *
     * `queuedMessageId` names what a queued message was waiting as. A client's
     * reducer takes that entry out of its queue on the turn naming it, which is
     * how the queue empties as its turns start.
     */
    const beginTurn = (turnId: string, text: string, from?: MessageFrom, queuedMessageId?: string): void => {
      const startedAt = new Date().toISOString();
      const message = messageOf(text, from);
      const held: OpenTurn = { id: turnId, startedAt, message, responseParts: [], calls: [], asked: [] };
      open = held;
      // No state and no duration: this is the turn as it began, and the line
      // that ends it is the one that says how it went.
      append(dir, id, { id: turnId, startedAt, message, responseParts: [], _meta: mark });
      touch();
      start.emit('chat', {
        type: 'chat/turnStarted',
        turnId,
        startedAt,
        message,
        ...(queuedMessageId === undefined ? {} : { queuedMessageId }),
      });
      /*
       * The turn is open before anybody is told about it, because what is told
       * is what answers it - and it is over at once when nobody is. That is a
       * chat with no bot behind it: one a person opened to read, or one this
       * host has just restarted and not answered again.
       */
      if (handle.onMessage === undefined) finish(held, 'complete', []);
      else handle.onMessage({ session: start.uri, turnId, text });
    };

    /**
     * Hold one message for the turn in front of it.
     *
     * Announced first, because a client draws the queue it was put in, and held
     * under the entry's own id: the same id twice edits what is waiting rather
     * than adding a second message behind the first.
     */
    const enqueue = (entry: Waiting): void => {
      const at = waiting.findIndex((held) => held.id === entry.id);
      if (at < 0) waiting.push(entry);
      else waiting[at] = entry;
      start.emit('chat', {
        type: 'chat/pendingMessageSet',
        kind: 'queued',
        id: entry.id,
        message: messageOf(entry.text, entry.from),
      });
      touch();
    };

    /**
     * Whatever was waiting, once the turn in front of it is done.
     *
     * The entry leaves the client's queue with the turn, two ways: the turn
     * names the entry it was, which is the word a client's reducer takes it out
     * on, and the entry is removed outright - because a client holding an entry
     * the turn does not name has nothing else to take it out with.
     */
    const startNext = (): void => {
      if (open !== undefined) return;
      const next = waiting.shift();
      if (next === undefined) return;
      start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id: next.id });
      beginTurn(next.turnId, next.text, next.from, next.id);
    };

    return {
      uri: start.uri,
      chatUri: start.chatUri,

      // No model runs here, and there is nothing of this backend's own to show
      // beside the host's. Empty lists are real answers.
      models: () => [],
      agentId: () => id,
      customizations: () => start.seedCustomizations ?? [],

      // The turns that are over. One still open is not here: it is what
      // `chatState().activeTurn` is for, as it is for every other backend.
      allTurns: () => turns,
      /*
       * `SessionStatus`: an open turn is `InProgress`, because the chat is
       * waiting - on the bot's session, which is where the answer is being
       * worked out. Nothing is being waited *for* from the person, so it is not
       * `InputNeeded`.
       */
      status: () => (open === undefined ? Status.Idle : Status.InProgress),
      activity: () => undefined,
      title: () => bot.name,
      modifiedAt: () => modified,
      workingDirectories: () => [uriOf(bot.workspace)],

      sessionState: () => ({
        // No `resource`: it is declared on `SessionSummary` and not on
        // `SessionState`, and a client subscribed to this channel named it.
        provider: CHAT_PROVIDER,
        title: bot.name,
        status: open === undefined ? Status.Idle : Status.InProgress,
        lifecycle: 'ready',
        defaultChat: start.chatUri,
        chats: [{ resource: start.chatUri, title: bot.name }],
        workingDirectories: [uriOf(bot.workspace)],
        customizations: start.seedCustomizations ?? [],
        // The schema *and* what is in force: a client reads
        // `config.schema.properties` to know which controls to draw and
        // `config.values` to know where each one sits.
        config: { schema: start.schema(), values: { ...start.settings } },
        _meta: mark,
      }),

      chatState: () => ({
        resource: start.chatUri,
        title: bot.name,
        status: open === undefined ? Status.Idle : Status.InProgress,
        modifiedAt: modified,
        turns,
        // What is waiting for the open turn to end, in the order it will start.
        // Read here rather than left to the client's own queue, so a client
        // that opens this chat while a message waits is told about it.
        queuedMessages: waiting.map((held) => ({ id: held.id, message: messageOf(held.text, held.from) })),
        // The turn that is running, in the protocol's own spelling for one:
        // no state and no duration, because it has neither until it ends. The
        // parts array is the live one, so a client that reads the state while
        // an answer is being written sees what is in it.
        ...(open === undefined ? {} : {
          activeTurn: {
            id: open.id,
            startedAt: open.startedAt,
            message: open.message,
            responseParts: open.responseParts,
            usage: undefined,
          },
        }),
        ...(draft === undefined ? {} : { draft }),
        _meta: mark,
      }),

      /**
       * The client says a turn has begun; making it true - and writing it down -
       * is this method.
       *
       * Except while one is already open: a chat runs one turn at a time, and
       * the second message is one that has to wait rather than one that takes
       * the open turn's place. The host refuses such a message before it
       * reaches here, so this is the guard behind that refusal rather than the
       * one a client meets - and it is the difference between a lost turn and a
       * queued one if the two ever disagree.
       */
      begin: (turnId, text, _model, from) => {
        if (open === undefined) {
          beginTurn(turnId, text, from);
          return;
        }
        enqueue({ turnId, id: turnId, text, from });
      },

      /**
       * A message a client held for later.
       *
       * Said at once when nothing is running, and otherwise held until the turn
       * in front of it ends. Its turn id is chosen here rather than when it
       * starts, so that the turn it becomes is the same one either way.
       */
      queue: (id, text, _model, from) => {
        enqueue({ turnId: crypto.randomUUID(), id, text, from });
        startNext();
      },

      /** Take one back, while it is still waiting. */
      unqueue: (id) => {
        const at = waiting.findIndex((held) => held.id === id);
        if (at < 0) return;
        waiting.splice(at, 1);
        start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'queued', id });
        touch();
      },

      /** Reorder what is waiting. Anything the order does not name keeps its place behind what it does. */
      reorder: (order) => {
        const byId = new Map(waiting.map((held) => [held.id, held]));
        const named = new Set<string>();
        const moved: Waiting[] = [];
        for (const id of order) {
          const held = byId.get(id);
          if (held === undefined || named.has(id)) continue;
          named.add(id);
          moved.push(held);
        }
        for (const held of waiting) if (!named.has(held.id)) moved.push(held);
        waiting.length = 0;
        waiting.push(...moved);
        start.emit('chat', { type: 'chat/queuedMessagesReordered', order: moved.map((held) => held.id) });
        touch();
      },

      /**
       * A message said while a turn is running.
       *
       * Nothing here can take one: a correction halfway is read by a model, and
       * this chat runs none. The message is a turn of its own instead - the open
       * turn ends complete with what it holds so far, and the steered text
       * begins the next one, which is what a person watching the chat sees.
       *
       * It wakes whoever answers the chat again, and the wake steers the back
       * session rather than starting it, so the answer after the steer lands in
       * the steered turn rather than under the turn it interrupted.
       *
       * The id the host names is the client's steering message. It is said
       * back first, as the chat's steering message, so the client that sent it
       * is answered inside its dispatch, and the new turn names it as its
       * `queuedMessageId`, which takes it out of every client's state; the turn
       * takes an id of its own. A message that was already waiting stays
       * waiting: a steer is in front of it, and it starts when the steered turn
       * ends.
       *
       * The new turn carries who sent the steered message, so a correction an
       * agent sent shows as that agent's turn rather than as the person's.
       *
       * False where there is no open turn to steer, which is a message the host
       * refuses rather than one it quietly turns into a turn of its own.
       */
      steer: (pendingId, text, _attachments, from) => {
        const held = open;
        if (held === undefined) return false;
        start.emit('chat', { type: 'chat/pendingMessageSet', kind: 'steering', id: pendingId, message: messageOf(text, from) });
        // Ended without the queue: the steered turn is in front of it.
        finish(held, 'complete', [], false);
        beginTurn(crypto.randomUUID(), text, from, pendingId);
        return true;
      },

      /**
       * Stop the turn that is running.
       *
       * There is nothing here to stop - the work is the bot's session, and
       * whether that hears the stop is the plugin's business - so the turn is
       * ended as a cancelled one, and a client watching the chat is told
       * exactly that. The host names the open turn by its id.
       */
      cancel: (turnId) => {
        const held = open;
        if (held === undefined || held.id !== turnId) return;
        finish(held, 'cancelled', []);
      },

      // Held by the session, so two people on one chat see each other's - which
      // is the whole of what a draft is for.
      setDraft: (next) => {
        if (JSON.stringify(next) === JSON.stringify(draft)) return;
        draft = next;
        // The key is left off to clear it, which is what the action's
        // `undefined` means and the only way JSON can say it.
        start.emit('chat', { type: 'chat/draftChanged', ...(next !== undefined ? { draft: next } : {}) });
      },

      /*
       * The answer a person gave in this chat, on its way to the session that
       * asked.
       *
       * Only a request this turn shows is taken: a confirmation or a question
       * the back session raised, drawn here by `asking`. The copy is resolved
       * in place, as a backend's own confirmation is, and then handed to the
       * plugin, which knows the back session's chat. Nothing is sent from here:
       * this package is the chat, and the door onto another session is the
       * plugin's connection.
       *
       * A tool confirmation is not echoed by the host, so the approval or the
       * denial is emitted here; a question's is, on the true this returns.
       */
      confirm: (toolCallId, approved, optionId) => {
        const held = open;
        if (held === undefined) return false;
        const asked = held.asked.find((one) => {
          const call = one.part['toolCall'] as Bag | undefined;
          return one.part['kind'] === 'toolCall' && call?.['toolCallId'] === toolCallId
            && call['status'] === 'pending-confirmation';
        });
        if (asked === undefined) return false;
        const toolCall = asked.part['toolCall'] as Bag;
        if (approved) {
          Object.assign(toolCall, {
            status: 'running',
            confirmed: 'user-action',
            ...(optionId === undefined ? {} : { selectedOptionId: optionId }),
          });
          start.emit('chat', {
            type: 'chat/toolCallConfirmed',
            turnId: held.id,
            toolCallId,
            approved: true,
            confirmed: 'user-action',
            ...(optionId === undefined ? {} : { selectedOptionId: optionId }),
          });
        }
        else {
          Object.assign(toolCall, { status: 'cancelled', reason: 'denied' });
          start.emit('chat', {
            type: 'chat/toolCallConfirmed',
            turnId: held.id,
            toolCallId,
            approved: false,
            reason: 'denied',
            ...(optionId === undefined ? {} : { selectedOptionId: optionId }),
          });
        }
        handle.onConfirm?.(toolCallId, approved, optionId);
        return true;
      },
      answer: (requestId, accepted, answers, response) => {
        const held = open;
        if (held === undefined) return false;
        const asked = held.asked.find((one) => {
          const request = one.part['request'] as Bag | undefined;
          return one.part['kind'] === 'inputRequest' && request?.['id'] === requestId;
        });
        if (asked === undefined) return false;
        const verdict = response ?? (accepted ? 'accept' : 'decline');
        asked.part['response'] = verdict;
        // The answers the request was given travel with it, so the state a
        // client reads while the back session settles says what was answered.
        const request = asked.part['request'] as Bag;
        if (verdict === 'accept' && Object.keys(answers).length > 0) {
          const known = typeof request['answers'] === 'object' && request['answers'] !== null
            ? request['answers'] as Bag
            : {};
          request['answers'] = { ...known, ...answers };
        }
        handle.onAnswer?.(requestId, accepted, answers, verdict);
        return true;
      },

      // No runtime switch and no MCP servers, so all three refuse. False is a
      // real answer: a control that reported success and changed nothing would
      // be worse than one that says no.
      setCustomizationEnabled: async () => false,
      startMcpServer: async () => false,
      stopMcpServer: async () => false,

      settings: () => ({ ...start.settings }),

      /*
       * Nothing runs between turns: no process to stop and no timer to clear.
       * What there is to let go of is the handle, which is nobody's once this
       * chat is one this host no longer runs - and a chat started again, under
       * the same URI, registers a handle of its own.
       */
      close: () => {
        if (handles.get(start.uri) === handle) handles.delete(start.uri);
      },
    };
  }

  return {
    provider: CHAT_PROVIDER,
    displayName: 'Bot chat',
    description: 'A chat with a bot. What you say is kept here; the bot answers through the work it is doing.',

    // The one key is the bot, and it cannot move: a chat is with the bot it was
    // started for, which is also the bot whose folder it works in.
    schema: () => ({
      properties: {
        bot: {
          type: 'string',
          title: 'Bot',
          description: 'The bot this chat is with.',
          sessionMutable: false,
        },
      },
    }),
    defaults: () => ({}),

    /*
     * The bots, as the answers to the chat's one setting.
     *
     * Without this the key reached every client as a text box: a property with
     * no `enum` is a fact somebody types, so a person had to know a bot's slug
     * and spell it. The store is the only thing that knows which bots there
     * are, and answering here means every client gets the picker rather than
     * the one that wrote code for the key by name.
     *
     * Waited for rather than read now: the first read of both collections is
     * what fills the store, and a picker opened before it would offer nothing.
     */
    completions: {
      bot: async (ask) => {
        await store.ready();
        const query = ask.query.toLowerCase();
        return store.all()
          .map((one) => ({ value: one.id, label: one.name }))
          .filter((one) => one.value.toLowerCase().includes(query) || one.label.toLowerCase().includes(query));
      },
    },

    /** Every chat this daemon has a log for, read off each bot's `logs/` folder. */
    list: async (): Promise<Listed[]> => {
      // The records first, as a read of `bot://` does: a row's name and folder
      // are the bot's, and the cache holding them is filled by this.
      await store.ready();
      const found: { dir: string; name: string }[] = [];
      for (const dir of logDirs(configDir)) {
        let names: string[];
        try { names = readdirSync(dir); }
        catch { continue; }
        for (const name of names) found.push({ dir, name });
      }
      found.sort((one, other) => (one.name < other.name ? -1 : one.name > other.name ? 1 : 0));
      const rows: Listed[] = [];
      for (const { dir, name } of found) {
        const id = idOfFile(name);
        if (id === undefined) continue;
        const row = rowOf(dir, id, store);
        if (row !== undefined) rows.push(row);
      }
      return rows;
    },

    find: async (id) => {
      await store.ready();
      for (const dir of logDirs(configDir)) {
        const row = rowOf(dir, id, store);
        if (row !== undefined) return row;
      }
      return undefined;
    },

    /**
     * A chat's turns, read without starting anything.
     *
     * What makes a row openable. Undefined is a real answer: it is a chat this
     * host has no log for.
     */
    transcript: async (id) => {
      for (const dir of logDirs(configDir)) {
        const turns = logAt(fileOf(dir, id))?.turns;
        if (turns !== undefined) return turns;
      }
      return undefined;
    },

    create: (start) => {
      const asked = start.settings['bot'];
      const slug = typeof asked === 'string' ? asked.trim() : '';
      // The store's cache, which is what a read of `bot://` answers from too.
      // A chat is started by one of those reads, so the bot is here by then.
      const bot = slug === '' ? undefined : store.get(slug);
      // A plain sentence rather than a coded refusal: the host answers whatever
      // a backend throws out of `create` as its own `INVALID_PARAMS`, keeping
      // the words and dropping the code, so a code here would be one no client
      // could ever see.
      if (bot === undefined) throw new Error(`There is no bot ${slug}.`);
      // The id the conversation is kept under: the one this chat was resumed
      // by, which is how a chat opens on its own log again.
      return chat(start, bot, start.resume ?? idOf(start.uri), markOf(bot), logsOf(configDir, bot.id));
    },
  };
}

import { appendFileSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { Status, idOf, uriOf } from '@ahpd/sdk';
import type { Agent, Bag, Chosen, Listed, MessageAttachment, MessageFrom, Session, Start } from '@ahpd/sdk';
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
 * One turn at a time, then. A turn sent while one is open is said at once and
 * handed on when that one ends; a message a client queues is the host's, which
 * sends it as a turn once the chat's turn ends well.
 *
 * What this backend is for is the *log*: one JSON line per moment under
 * `<configDir>/bots/<slug>/logs/`, in the folder of the bot the chat is with -
 * a line when a turn begins, and a line when it ends with its response. A
 * message steered into a running turn is a line of its own against that turn.
 * Nothing about a chat is kept in memory past the process that
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
  /** How many answers `responsePart` and `complete` have given it, which numbers the next one's id. */
  answers: number;
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
  /** The URI of the chat it was said in. */
  chat: string;
  /** The turn that began, or the open turn the message was steered into. */
  turnId: string;
  /** What was said. */
  text: string;
  /**
   * The id of the client's steering message this is, where it is one. Whoever
   * answers says with `steeringSent` that it is sending the message on, and
   * with `steeringConsumed` that the work behind the turn took it in or never
   * will; the chat holds it pending until then.
   */
  steering?: string;
}

/**
 * The handle over one chat's open turn: what ends it, and what hears about it.
 *
 * Held by whoever started the chat, which is the plugin: nothing in this
 * package knows what a bot's answer is, and nothing here would ever end a turn
 * by itself. The verbs are the protocol's words for what each says:
 * `complete` ends the turn, with that answer where it is given one, `notice`
 * ends it with something that happened instead of an answer, and `fail` ends
 * it in an error - each ends the turn it finds open, and does nothing at all
 * when there is none. `responsePart` adds an answer and leaves the turn open,
 * `subagent` shows the chat of another session it waits on, and `onCancel`
 * hears a client's `chat/turnCancelled`. `steeringSent` and `steeringConsumed`
 * are the two answers VS Code's agents give a steering message: its hand-off,
 * and `steering_consumed`.
 *
 * `onMessage` is the other direction: each turn this chat begins, and each
 * message steered into the open one, is handed to it. That is how what a person
 * says to a bot reaches the session that does the work.
 */
export interface TurnHandle {
  /**
   * Begin a turn nobody in this chat said, and answer with the turn's id.
   *
   * What a turn somebody began in a back session is shown as here: the person
   * typed there, and this chat shows a turn of its own waiting on that work.
   * Nobody is told about it the way `onMessage` is told - nothing here woke a
   * session, and the work the turn waits on is already running.
   *
   * Nothing where a turn is open: a chat runs one turn at a time, and a back
   * turn with no turn to be shown in is one this chat does not show.
   */
  begin(text: string, from?: MessageFrom): string | undefined;
  /**
   * Complete the open turn, the protocol's `chat/turnComplete`: with this as its
   * answer where one is given, and with what `responsePart` gave it otherwise.
   */
  complete(text?: string): void;
  /**
   * Add this answer to the open turn, the protocol's `chat/responsePart`, and
   * keep the turn open.
   *
   * What a back session posts while its own turn runs: the main turn waits on
   * that turn as on a subagent, and ends when it ends. `complete` after it
   * completes the turn as answered.
   */
  responsePart(text: string): void;
  /** End the open turn with a notice rather than an answer. */
  notice(text: string): void;
  /** End the open turn as failed, in the words of what failed. */
  fail?(message: string): void;
  /**
   * Say the open turn is waiting on a chat of another session, and link it.
   *
   * The turn shows one tool call of kind `subagent`, VS Code's word for a call
   * running another chat, whose content names that chat, which is how a
   * client opens it: the back session is not a worker this chat's backend
   * opened, so nothing else would draw it. Optional because a handle over a
   * chat with nothing behind it has nothing to show.
   */
  subagent?(chat: string, title: string): void;
  /**
   * Show a request another session is waiting on, in the open turn.
   *
   * The entry is the back session's `session/inputNeeded` entry, whole: an
   * approval is drawn as a tool call in `pending-confirmation` with the back
   * session's own title, and a question as an `inputRequest` part with its
   * fields. Optional for the same reason `subagent` is.
   */
  asking?(entry: Bag): void;
  /** Take a request's copy out of the open turn, because the back session no longer waits on it. */
  withdrawn?(id: string): void;
  /**
   * Say a steering message is being sent on to the work behind its turn, and
   * answer whether it may be.
   *
   * True where the turn it was steered into is still open: the message is that
   * turn's from here, written down against it, and its hand-off is answered
   * `true`. False where that turn ended while the message was on its way: the
   * hand-off is answered `false`, which hands the message back unsent, for the
   * host to steer the turn that runs then with it or run it next, as VS Code's
   * agents hand back a steer whose turn ended first. False too for a message
   * the chat no longer holds, which a stop took out. Nothing is sent on a
   * false.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1948
   */
  steeringSent?(id: string): boolean;
  /**
   * Take a steering message out of the chat's pending state, because the work
   * behind the turn took it in, or dropped it because sending it failed: the
   * protocol's `chat/pendingMessageRemoved`, as VS Code's host says one once
   * its agent reports the steer consumed. A hand-off not yet answered is
   * answered `true`, the message being done with.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L775-L782
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L218-L228
   */
  steeringConsumed?(id: string): void;
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
  /** Who hears that a client cancelled the open turn, to stop the work behind it. */
  onCancel?: (session: string, turnId: string) => void;
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

/** The key of `_meta` the bot's mark is under, namespaced as VS Code's host namespaces the keys it puts there. */
const MARK = 'ahpd.bot';

/**
 * The bot's mark, as the `_meta` of a chat and of its session.
 *
 * What says which bot a chat is for. `kind` is `direct` because that is what
 * this is: one person, one bot, nobody else in it.
 */
const markOf = (bot: BotRecord): Bag => ({
  [MARK]: {
    id: bot.id,
    name: bot.name,
    color: bot.color,
    labels: bot.labels,
    body: bot.body,
    kind: 'direct',
  },
});

/** The `_meta` one log line or one chat state carries, where it carries one. */
const markIn = (said: Bag): Bag | undefined => {
  const meta = said['_meta'];
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? meta as Bag : undefined;
};

/** The message a turn carries: what was said, who said it, and the model, agent and attachments it named. */
const messageOf = (text: string, from?: MessageFrom, model?: Chosen, attachments?: MessageAttachment[]): ChatTurn['message'] => ({
  text,
  origin: from?.origin ?? { kind: 'user' },
  ...(from?._meta === undefined ? {} : { _meta: from._meta }),
  ...(from?.agent === undefined ? {} : { agent: from.agent }),
  ...(model === undefined ? {} : { model }),
  ...(attachments === undefined || attachments.length === 0 ? {} : { attachments }),
});

/** The error part a turn that began and never ended reads back with, VS Code's words for an interrupted request. */
const INTERRUPTED: Bag = {
  kind: 'error',
  error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
};

/**
 * The ending a line's `state` names: `cancelled` or `error`, and `complete` for
 * any other.
 *
 * A line with no state is the one a turn began with, and a turn whose last line
 * is that one is read back interrupted, in `logAt`.
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
 * finished. A turn whose daemon died before it ended has only the first of the
 * two, and reads back interrupted, as VS Code's Copilot reads back a turn its
 * record shows started and never ended: an error, with the error part last.
 * The part is not marked resumable, because nothing runs a bot chat's turn
 * again.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/copilotAgentSession.ts#L6962-L6967
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1152-L1155
 */
const logAt = (path: string): { turns: ChatTurn[]; mark: Bag | undefined } | undefined => {
  let text: string;
  try { text = readFileSync(path, 'utf8'); }
  catch { return undefined; }
  const turns: ChatTurn[] = [];
  /** Where each turn read so far sits, so the line that ends it can replace it. */
  const at = new Map<string, number>();
  /** The turns whose last line so far is the one they began with. */
  const unended = new Set<string>();
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
     * A message somebody said into a turn that was already running, which the
     * line names: the turn it went into, whose answer is its answer.
     *
     * The line is the record that it was said, and the chat read back shows
     * the turn it steered, as the live chat does once the message is handed on
     * and as the Claude backend reads a steering prompt back inside its turn.
     * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L171-L208
     */
    if (held['steering'] === true) {
      mark ??= markIn(held);
      continue;
    }
    const one = turnOf(held);
    if (one === undefined) continue;
    mark ??= markIn(held);
    if (held['state'] === undefined) unended.add(one.id);
    else unended.delete(one.id);
    const known = at.get(one.id);
    if (known === undefined) {
      at.set(one.id, turns.length);
      turns.push(one);
    }
    else turns[known] = one;
  }
  return {
    turns: turns.map((turn) => (unended.has(turn.id)
      ? { ...turn, state: 'error' as const, responseParts: [...turn.responseParts, INTERRUPTED] }
      : turn)),
    mark,
  };
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
  let createdAt: Date;
  let modifiedAt: Date;
  try {
    const stat = statSync(path);
    createdAt = stat.birthtime;
    modifiedAt = stat.mtime;
  }
  catch { return undefined; }
  const log = logAt(path);
  if (log === undefined) return undefined;
  const marked = log.mark?.[MARK];
  const held = typeof marked === 'object' && marked !== null && !Array.isArray(marked) ? marked as Bag : {};
  const slug = typeof held['id'] === 'string' ? held['id'] : '';
  const bot = store.get(slug);
  const named = held['name'];
  const meta = bot === undefined ? log.mark : markOf(bot);
  return {
    id,
    title: bot?.name ?? (typeof named === 'string' && named !== '' ? named : id),
    createdAt: createdAt.toISOString(),
    modifiedAt: modifiedAt.toISOString(),
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
 * resumed one alike, and `cancelled` as its `onCancel`.
 */
export function botChatAgent(
  configDir: string,
  store: BotStore,
  heard?: (message: ChatMessage, handle: TurnHandle) => void,
  cancelled?: (session: string, turnId: string) => void,
): Agent {
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
     * The turns sent while another was open, in the order they came, each
     * handed on once the turn in front of it has ended: the chat answers one
     * turn at a time, as the reference agent runs each send after the one
     * before it. The host said each start, so each took the place of the one
     * before it in every client's state, as the protocol's reducer replaces
     * the active turn; the turn it replaced is answered on, and is in no
     * history.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1810-L1814
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L358-L387
     */
    const handed: { turn: OpenTurn; text: string; from: MessageFrom | undefined; model: Chosen | undefined; attachments: MessageAttachment[] | undefined }[] = [];
    /** The turns a later one took the place of. */
    const replaced = new Set<string>();
    /**
     * The steering messages handed on that the chat still holds pending, by
     * the client's id: the turn each was steered into, the message as the log
     * keeps it, and the answer to its hand-off until `steeringSent` gives it.
     */
    const steers = new Map<string, { turn: string; message: ChatTurn['message']; answer?: (sent: boolean) => void }>();

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
     *
     * It clears at once rather than with the turn it is in, which is the choice
     * Softov made on 2026-11-02: a copy nobody can answer is not worth drawing
     * until the turn ends.
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
        turnId: held.id,
        toolCallId: String(toolCall['toolCallId'] ?? id),
        approved: false,
        reason: 'skipped',
      });
    };

    /**
     * One answer of the open turn, as a markdown part.
     *
     * The first is `<turn>:reply` and each after it `<turn>:reply2` and on, as
     * a second steer is `:steer2`: one turn may hold several answers, and a
     * part's id names one.
     */
    const answerPart = (held: OpenTurn, text: string): Bag => {
      held.answers += 1;
      const id = held.answers === 1 ? `${held.id}:reply` : `${held.id}:reply${held.answers}`;
      return { id, kind: 'markdown', content: text };
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
     * A turn that completes completes its subagent calls with it, as VS Code
     * completes a subagent's call when the subagent's work completes, whether
     * or not the back session posted an answer. A turn that is stopped or
     * fails leaves them unfinished, and the turn's end forces each to
     * cancelled, `skipped`, in every reducer, this chat's own record included,
     * as the reference host's chat draws a call its turn left behind.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1051
     * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211
     */
    const finish = (held: OpenTurn, state: Ending, parts: Bag[]): void => {
      open = undefined;
      /*
       * A steer the work behind the turn holds and never took in is over with
       * the turn, and is taken out before the turn's end is said, as VS Code's
       * agents clear a steer's pending state when its turn ends. A stop lets go
       * of every steer of the turn, one still on its way to the work included,
       * and the host takes them out of the chat at a stop. One still on its way
       * at any other ending is left for `steeringSent` to hand back.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L3409-L3412
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L6852-L6854
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L55-L65
       */
      for (const [steering, one] of steers) {
        if (one.turn !== held.id || (one.answer !== undefined && state !== 'cancelled')) continue;
        steers.delete(steering);
        if (state !== 'cancelled') start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'steering', id: steering });
        one.answer?.(true);
      }
      const duration = Date.now() - Date.parse(held.startedAt);
      for (const call of held.calls) {
        const toolCall = call.part.toolCall as Bag;
        if (state !== 'complete') {
          // What the reducer keeps of a call it forces to cancelled.
          const kept = ['toolCallId', 'toolName', 'displayName', 'intention', 'contributor', '_meta', 'invocationMessage', 'toolInput']
            .filter((key) => toolCall[key] !== undefined);
          call.part.toolCall = { ...Object.fromEntries(kept.map((key) => [key, toolCall[key]])), status: 'cancelled', reason: 'skipped' };
          continue;
        }
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
      // A turn a later one took the place of is in no history, as the reducer keeps none of it.
      if (!replaced.delete(held.id)) turns.push(turn);
      touch();
      // Whatever it answered with, before the turn is said to be over: a part
      // that arrived after the end is a part of a turn nobody is holding. The
      // calls are not here: their starts already appended them.
      // A failed turn's one part is its error, which `chat/error` carries.
      if (state === 'error') start.emit('chat', { type: 'chat/error', turnId: held.id, duration, part: parts[0] });
      else {
        for (const part of parts) start.emit('chat', { type: 'chat/responsePart', turnId: held.id, part });
        start.emit('chat', state === 'cancelled'
          ? { type: 'chat/turnCancelled', turnId: held.id, duration }
          : { type: 'chat/turnComplete', turnId: held.id, duration });
      }
      // A turn sent while this one was open goes on whatever the ending, once
      // this one is said to be over: each send is its own.
      sendNext();
    };

    /**
     * The handle over this chat's open turn, which the plugin that started the
     * chat holds.
     *
     * A method here that finds no open turn does nothing: the turn it was meant
     * to answer has ended, and a second ending would be a second turn.
     */
    const handle: TurnHandle = {
      begin: (text, from) => {
        if (open !== undefined || handed.length > 0) return undefined;
        const turnId = crypto.randomUUID();
        const held = beginTurn(turnId, text, from);
        // A turn of the chat's own, which no client sent, so its start is said here.
        start.emit('chat', { type: 'chat/turnStarted', turnId, startedAt: held.startedAt, message: held.message });
        return turnId;
      },
      complete: (text) => {
        const held = open;
        if (held === undefined) return;
        /*
         * With an answer, one part, whole. Nothing streams into a chat that runs
         * no model, so there are no `chat/delta`s after it - and the id is the
         * turn's, which is what a delta would have appended to.
         */
        finish(held, 'complete', text === undefined ? [] : [answerPart(held, text)]);
      },
      responsePart: (text) => {
        const held = open;
        if (held === undefined) return;
        const part = answerPart(held, text);
        held.responseParts.push(part);
        start.emit('chat', { type: 'chat/responsePart', turnId: held.id, part });
      },
      notice: (text) => {
        const held = open;
        if (held === undefined) return;
        // No id: `SystemNotificationResponsePart` has none, which is what the
        // reference harness writes for a notice of its own.
        finish(held, 'complete', [{ kind: 'systemNotification', content: text }]);
      },
      /*
       * A turn whose work failed ends as failed, with an error part, as the
       * reference host ends a failed send with `chat/error`, and the part's
       * type is the one it gives a failed send.
       * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/agentSideEffects.ts#L1854-L1860
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2573
       */
      fail: (message) => {
        const held = open;
        if (held === undefined) return;
        finish(held, 'error', [{ kind: 'error', error: { errorType: 'sendFailed', message } }]);
      },
      subagent: (chat, title) => {
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
      steeringSent: (steering) => {
        const one = steers.get(steering);
        const answer = one?.answer;
        if (one === undefined || answer === undefined) return false;
        delete one.answer;
        if (open?.id !== one.turn) {
          steers.delete(steering);
          answer(false);
          return false;
        }
        // Kept, as everything said in a chat is, on a line of its own against
        // the turn it went into, so a chat read back after a restart shows it.
        append(dir, id, { id: one.turn, steering: true, message: one.message, _meta: mark });
        answer(true);
        return true;
      },
      steeringConsumed: (steering) => {
        const one = steers.get(steering);
        if (one === undefined) return;
        steers.delete(steering);
        start.emit('chat', { type: 'chat/pendingMessageRemoved', kind: 'steering', id: steering });
        one.answer?.(true);
      },
    };
    if (heard !== undefined) handle.onMessage = (message) => { heard(message, handle); };
    if (cancelled !== undefined) handle.onCancel = cancelled;
    handles.set(start.uri, handle);

    /**
     * Open a turn in this chat with what it began with, and write it down.
     *
     * The line goes down before the turn is handed on, so a log that could not
     * be written fails the send, and every turn the chat answers is one a
     * restart reads back.
     *
     * Nobody is told who answers it: `beginMessage` is a turn somebody's
     * message starts, and `begin` on the handle is a turn another session's
     * work is the answer to.
     */
    const beginTurn = (
      turnId: string,
      text: string,
      from?: MessageFrom,
      model?: Chosen,
      attachments?: MessageAttachment[],
      opening = true,
    ): OpenTurn => {
      const startedAt = new Date().toISOString();
      const message = messageOf(text, from, model, attachments);
      const held: OpenTurn = { id: turnId, startedAt, message, responseParts: [], calls: [], asked: [], answers: 0 };
      if (opening) open = held;
      // No state and no duration: this is the turn as it began, and the line
      // that ends it is the one that says how it went.
      append(dir, id, { id: turnId, startedAt, message, responseParts: [], _meta: mark });
      touch();
      return held;
    };

    /** The model a client picked, taken by the next send. */
    let chosen: Chosen | undefined;

    /**
     * A turn sent while another is open, handed on once the turn in front of
     * it has ended. The turn it took the place of, the open one or one sent
     * before it, is answered on and ends in no history.
     */
    const hand = (
      turnId: string,
      text: string,
      from: MessageFrom | undefined,
      model: Chosen | undefined,
      attachments: MessageAttachment[] | undefined,
    ): void => {
      const shown = handed.at(-1)?.turn ?? open;
      if (shown !== undefined) replaced.add(shown.id);
      handed.push({ turn: beginTurn(turnId, text, from, model, attachments, false), text, from, model, attachments });
    };

    /**
     * Open one turn, and hand it to whoever answers this chat.
     *
     * The turn is open before anybody is told about it, because what is told
     * is what answers it. A chat nothing answers ends the turn at once in
     * `chat/error`, as VS Code's host ends a turn it has no agent for, in its
     * words.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostTurnStarter.ts#L119-L136
     */
    const beginMessage = (
      turnId: string,
      text: string,
      from?: MessageFrom,
      model?: Chosen,
      attachments?: MessageAttachment[],
      said?: OpenTurn,
    ): void => {
      // A turn sent while another was open is handed on as it was written down.
      if (said !== undefined) open = said;
      const held = said ?? beginTurn(turnId, text, from, model, attachments);
      if (handle.onMessage === undefined) {
        finish(held, 'error', [{ kind: 'error', error: { errorType: 'noAgent', message: 'No agent found for session' } }]);
        return;
      }
      handle.onMessage({ session: start.uri, chat: start.chatUri, turnId, text });
    };

    /** The next turn sent while another was open, handed on once none is. */
    const sendNext = (): void => {
      if (open !== undefined) return;
      const first = handed.shift();
      if (first !== undefined) beginMessage(first.turn.id, first.text, first.from, first.model, first.attachments, first.turn);
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
       * The host said a turn has begun; making it true - and writing it down -
       * is this method.
       *
       * One sent while another is open is handed on once the open turn has
       * ended: the chat answers one turn at a time.
       */
      sendMessage: (turnId, text, from, attachments) => {
        const model = chosen;
        chosen = undefined;
        if (open === undefined && handed.length === 0) {
          beginMessage(turnId, text, from, model, attachments);
          return;
        }
        hand(turnId, text, from, model, attachments);
      },

      changeModel: (model) => { chosen = model; },
      // A bot answers as itself, so an agent picked is kept by nothing.
      changeAgent: () => {},

      /**
       * A message into the turn that is running.
       *
       * The turn goes on: the message is handed to whoever answers the chat as
       * a message into the open turn, and the wake sends it to the back
       * session, whose answer to it lands in that turn. The reference host
       * hands steering into a running turn through its provider, and the turn
       * goes on.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/queueDrain/queueDrainContribution.ts#L175-L203
       *
       * The id the host names is the client's steering message, which the host
       * said as the chat's steering message. The hand-off is answered as VS
       * Code's agents answer one they send on: `true` once whoever answers is
       * sending it on into the turn it was steered into, and `false` where that
       * turn ended first, handing it back unsent (`steeringSent`). It stays
       * pending until the work behind the turn takes it in, or drops it because
       * sending it failed (`steeringConsumed`), as VS Code's host takes a steer
       * out once its agent reports it consumed. The message carries who sent
       * it, so a correction an agent sent shows as that agent's.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L6817-L6837
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L775-L782
       *
       * False where there is no open turn to steer, or nobody to hand it to:
       * the host keeps it pending, hands it again on the turn's next action,
       * and runs it next once the turn ends well.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L1943-L1948
       */
      sendSteeringMessage: ({ id: pendingId, text, attachments, from }) => {
        const held = open;
        if (held === undefined || handle.onMessage === undefined) return false;
        const message = messageOf(text, from, undefined, attachments);
        // The modified time stays, as the protocol's reducer moves it only at
        // a turn's end and its start.
        // https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L227-L232
        // https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L369-L373
        return new Promise<boolean>((answer) => {
          steers.set(pendingId, { turn: held.id, message, answer });
          handle.onMessage?.({ session: start.uri, chat: start.chatUri, turnId: held.id, text, steering: pendingId });
        });
      },

      /**
       * Stop the turn that is running.
       *
       * There is nothing here to stop - the work is the bot's session, and
       * whether that hears the stop is the plugin's business - so the turn
       * ends as a cancelled one in the chat's log, as it has in every client's
       * state.
       *
       * A stop starts nothing behind the turn: the turns sent while it was open
       * end with it, unanswered, as the reference stop aborts the work in
       * flight and drops what waits behind it. The work behind the turn stops
       * too: the reference host cancels the running turns of a stopped chat's
       * subagent sessions.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1946-L1954
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1942
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1470-L1483
       */
      abort: () => {
        const held = open;
        for (const one of handed.splice(0)) finish(one.turn, 'cancelled', []);
        if (held === undefined) return;
        finish(held, 'cancelled', []);
        handle.onCancel?.(start.uri, held.id);
      },

      // The draft the host said, held for the chat's state.
      setDraft: (next) => { draft = next; },

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
       * The host says the client's decision on a call, and a question's answer
       * on the true this returns, as VS Code's host echoes a client's
       * confirmation once and hands it to its agent
       * (src/vs/platform/agentHost/node/agentSideEffects.ts L1878-L1904 at
       * 6b68d3fe); so nothing is said again here.
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
        }
        else {
          Object.assign(toolCall, { status: 'cancelled', reason: 'denied' });
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

      // No runtime switch and no MCP servers, so all three answer false, and
      // the host says no in the session's own state as VS Code's does: a toggle
      // stands as the client's decision, a listed server it could not start is
      // in error, and the rest are logged
      // (src/vs/platform/agentHost/node/agentSideEffects.ts L416-L428,
      // L2026-L2065 at 6b68d3fe).
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

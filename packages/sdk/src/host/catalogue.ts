import { ROOT, chatUriFor, subagentChatUri } from './channels.js';
import { accountKey } from './root.js';
import { Status, idFor, idOf, titleFrom, uriFor } from '../sessions/catalog.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { isDeepStrictEqual } from 'node:util';
import type { Summary, SummaryChat } from '../types/catalog.js';
import type { ChangesSummary } from '../types/changes.js';
import type { Agent, Listed } from '../types/agent.js';
import type { Account } from '../types/probe.js';
import type { Bag } from '../types/common.js';
import type { Session } from '../types/session.js';
import type { WireTurn } from '../types/wire.js';
import type { Held, LiveSubagent } from './state.js';
import type { HostContext } from './context.js';
import type { Turn } from '@microsoft/agent-host-protocol';

/**
 * A worker chat read back from a backend's own record, and the URI this host
 * gives its channel.
 *
 * The pair travels together because neither half survives the other: the
 * record says what the worker was and the URI is the only way to open it, and
 * a list built from one without the other is a chat nobody can subscribe to.
 */
export interface RestoredWorker {
  uri: string;
  one: Bag;
}

/** The session list and each row of it. */
export interface Catalogue {
  statusOf(uri: string): number;
  startedBy(chat?: string): Bag;
  chatSummary(session: string, uri: string, chat: Session): Bag;
  /** Whether a chat, or a worker inside one of its calls, has a turn in progress. */
  running(uri: string): boolean;
  /** Whether a chat may be moved: not the default, resumable, and running nothing. */
  movable(uri: string): boolean;
  /** Publish whether a chat may be moved, where that changed, on the chat and on its session. */
  updateChatMovability(uri: string): void;
  /** Say a session's chats are in a new order, naming every one of them. */
  chatsReordered(uri: string): Promise<void>;
  subagentSummary(uri: string, ref: LiveSubagent): Bag;
  /**
   * Every chat of one running session, in the order both answers list them.
   *
   * `restored` is what the backend said about the workers it ran before this
   * process held the session, which the caller has already read.
   */
  chatCatalogOf(session: string, held: Held, restored: RestoredWorker[]): Bag[];
  restoredSubagentSummary(session: string, uri: string, parentChat: string, ref: { toolCallId: string; title: string; turns: Bag[] }, modifiedAt: string): Bag;
  /**
   * A chat's summary mirrored onto the session holding it after the chat's
   * action: the chat's row, the session's activity and its catalogue row.
   */
  onChatSummaryChanged(chat: string): void;
  /** The session's entries for what a chat's running turn waits on a person for, raised and taken down from the chat's state. */
  syncSessionInputNeeded(chat: string): void;
  /** The entries a chat's running turn holds open, under VS Code's ids. */
  inputNeededOf(chat: string, state: Record<string, unknown> | undefined): Record<string, unknown>[];
  /** A running session's changesets and `_meta`, read from its folder and its backend, said by their actions where they changed. */
  changesetsAndMetaChanged(uri: string): void;
  activityOf(held: Held): string | undefined;
  /** A session this host is making, provisional until `sessionAdded` announces it. */
  markSessionProvisional(uri: string): void;
  sessionAdded(uri: string): void;
  /** Whether a session is made and not yet announced: a fresh one before its first message. */
  provisional(uri: string): boolean;
  /** A turn handed to its backend: a provisional session announced, and one not ready said ready. */
  materialized(uri: string): void;
  /** A turn that ended in an error before its backend had it, which fails a provisional session's creation. */
  failSessionCreationIfStillCreating(uri: string, error: Bag): void;
  /** A session's summary changed: marked dirty and said with the rest on the 100 ms debounce. */
  markSummaryDirty(uri: string): void;
  /** Every dirty summary, said now, as the debounce would. */
  flushPendingSessionSummaries(): void;
  /**
   * Read the session's changes summary, keep it, and mark its summary dirty.
   *
   * Called where the session's tree is checkpointed - the start of a session
   * and the end of each of its turns - and at each finished tool call. The
   * calls are coalesced per session, so a burst runs at most two reads: one
   * running and one waiting behind it. `running` says a turn is in flight, so
   * the session kind counts the baseline against the working tree, the turn's
   * own checkpoint being still to come.
   */
  refreshSessionChangesSummary(uri: string, running?: boolean): Promise<void>;
  /** A session whose row is gone: its last notified summary, its pending change and its provisional mark dropped. */
  removeNotifiedSummary(uri: string): void;
  /** How many sessions are running a turn in any of their chats. */
  activeCount(): number;
  /** Say how many sessions are running a turn, where the root's clients hold another number. */
  activeSessionsChanged(): void;
  /** Set the models a running session's CLI answered for its provider, and publish the agent list where it changed. */
  setAgentModels(uri: string): void;
  /** Publish the root's agent list where it changed. */
  publishAgentInfos(): void;
  /**
   * Record one backend's account and publish it as a root config value under
   * `accountKey`.
   */
  publishAccountInfo(provider: string, account: Account): void;
  /** Every backend's rows, with what a refusing backend had last time carried over. */
  listing(before?: Summary[]): Promise<Summary[]>;
  /**
   * Register one listed session and project its row, as a listing does for
   * every row it finds. `stored` says this host keeps a record for the row,
   * which is what names an old row in its provider's scheme.
   */
  registerListedSession(agent: Agent, row: Listed, waiting?: string, stored?: boolean): Summary;
  /** Announce to every client a listed session this host did not have. */
  announceSurfacedSession(summary: Summary): void;
  /**
   * The rows of the sessions this host is running, built now.
   *
   * The half of the answer that is never held, and rebuilt on every
   * `listSessions` because a live row moves on its own and holding it would
   * make it a second behind.
   */
  liveRows(): Summary[];
  /** The whole catalogue as a client is handed it: the live rows and the held ones. */
  allRows(): Promise<Summary[]>;
  /** Tell every client what a refresh changed among the listed sessions: announced, updated, or retracted. */
  publishSurfacedSessions(before: Summary[], after: Summary[]): void;
  /** The provider a stored session recorded, where this host does not serve it. */
  unavailableProvider(id: string): string | undefined;
  readStored(): Promise<void>;
}

export function createCatalogue(ctx: HostContext): Catalogue {
  const {
    options, agents, sessions, subagents, owners, kept, names, wheres, births, moves, listedMeta,
    madeFrom, origins, leadOf, about, browsable, recordedChats, chatBackends, sessionHolding,
    resumedSessions, restoredSubagents,
  } = ctx;

  /**
   * How a chat came to exist.
   *
   * `ChatOrigin` has four kinds - `user`, `fork`, `sideChat` and `tool`. A
   * chat made out of another says which, from `madeFrom`; every other chat
   * here, a session's default chat among them whoever started the session, is
   * `user`, as VS Code's host marks a session's default chat. Workers say
   * `tool` in their own rows.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L678-L692
   */
  const startedBy = (chat?: string): Bag => {
    const made = chat === undefined ? undefined : madeFrom.get(chat);
    return { origin: made ?? { kind: 'user' } };
  };
  /**
   * One chat, as its session's catalogue lists it: the summary fields of the
   * state the chat holds.
   *
   * A whole `ChatSummary`: `status` and `modifiedAt` are required of one, and
   * a client reducing its list against a partial row gets one it cannot sort
   * or draw a state for. Read off the chat's own state,
   * because the protocol has the catalogue kept consistent with the fields
   * that state inlines; a chat whose state is not held yet is read from its
   * backend, which is what its state opens with.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L24
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3265
   */
  const chatSummary = (session: string, uri: string, chat: Session): Bag => {
    const state = ctx.stateOf(uri);
    if (state !== undefined) return summaryIn(state, uri);
    return {
      resource: uri,
      ...startedBy(uri),
      // The title its state opens with: a default chat's own, or none.
      title: sessions.get(session)?.defaultChat === uri ? ctx.titleOf(session, uri) ?? '' : chat.title(),
      // What the backend is doing, with the client's own bits laid over it. A
      // chat marked read is read whatever the backend says next, and the flags
      // are this host's to remember - no backend has heard of them.
      status: chat.status() | kept.chatFlags(idOf(session), uri),
      modifiedAt: chat.modifiedAt(),
      ...(chat.activity() !== undefined ? { activity: chat.activity() } : {}),
      // The same answer the chat's own state gives. A summary that left it out
      // while the state carried it would be two answers to one question.
      interactivity: 'full',
      /*
       * Absent when it cannot move, which is what the protocol says absence
       * means. A row with the key left off is one a client draws no move control
       * for, and writing `false` would say the same thing in a longer way.
       */
      ...(movable(uri) ? { movable: true } : {}),
    };
  };
  /** The fields of a chat's state its catalogue row carries. */
  const summaryIn = (state: Bag, uri: string): Bag => ({
    resource: uri,
    ...(state.origin !== undefined ? { origin: state.origin } : {}),
    title: String(state.title ?? ''),
    status: Number(state.status ?? Status.Idle),
    modifiedAt: String(state.modifiedAt ?? ''),
    ...(state.activity !== undefined ? { activity: state.activity } : {}),
    interactivity: state.interactivity ?? 'full',
    ...(state.movable === true ? { movable: true } : {}),
  });

  /**
   * Whether a chat may be moved, which is what a client offers a control for.
   *
   * Four things, and all of them ask one question - would a move work. The chat
   * must be one this host is running as a chat of a session, so a worker is
   * never movable on its own and neither is a conversation read back from a
   * transcript. It must not be the chat its session hands a client that names
   * none: the protocol says that one MUST NOT move, and a session whose default
   * left would have to answer a client naming no chat with a question. Its
   * backend must be able to take the conversation back by the id it kept it
   * under, because a move starts the backend again with `resume` set to that
   * id. And nothing may be running: a move closes a process and starts another,
   * and the one moment that costs nothing is between turns.
   *
   * A chat of another backend than the session's is not movable at all: a move
   * starts it again on the destination's backend, which is a harness that has
   * never seen its transcript.
   *
   * And moving chats has to be on, `chatMoves.enabled` in root config, as VS
   * Code's host offers a move only while a window has turned it on.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L62-L67
   */
  const movable = (uri: string): boolean => {
    if (ctx.rootConfig['chatMoves.enabled'] !== true) return false;
    const held = sessions.get(sessionHolding(uri) ?? '');
    const chat = held === undefined ? undefined : held.chats.get(uri);
    if (held === undefined || chat === undefined) return false;
    if (held.backends.has(uri)) return false;
    if (held.defaultChat === uri) return false;
    const own = chat.agentId();
    if (own === undefined || own === '') return false;
    if (chat.resumable?.() === false) return false;
    return !running(uri);
  };

  /**
   * Whether a chat, or any worker chat beneath it, is running a turn.
   *
   * Asked of a chat's backend, which is the one doing the work, and of a
   * worker's held state, which is the whole of what a worker is. Walked to the
   * bottom because a worker's own call can open another one, and a move
   * carries all of them: a chat whose worker is mid-turn is a chat with
   * something in flight.
   */
  const running = (uri: string): boolean => {
    const lead = sessions.get(sessionHolding(uri) ?? '')?.chats.get(uri);
    // The chat's own turn from its start as every client holds it, and the
    // backend's while it works.
    const active = ctx.stateOf(uri)?.activeTurn;
    if (lead !== undefined && (active !== undefined && active !== null || (lead.status() & Status.InProgress) !== 0)) return true;
    const seen = new Set([uri]);
    const queue = [uri];
    while (queue.length > 0) {
      const at = queue.shift() as string;
      for (const [one, ref] of subagents) {
        if (ref.parentChat !== at || seen.has(one)) continue;
        seen.add(one);
        if ((Number(ctx.stateOf(one)?.status ?? Status.Idle) & Status.InProgress) !== 0) return true;
        queue.push(one);
      }
    }
    return false;
  };

  /**
   * Each chat's `movable` as last published, so only a change is sent.
   *
   * Per chat and for as long as this host holds it, which is the same span the
   * answer covers: a chat the host does not run is one nothing can move, and
   * its entry goes when this is next asked about it.
   */
  const publishedMovable = new Map<string, boolean>();
  /**
   * Publish a chat's current eligibility to move, where it changed, as VS
   * Code's movability update publishes it through `setChatMovable`, which
   * says nothing for an unchanged value.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatMovability.ts#L251-L258
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2147-L2160
   *
   * Called at the moments the answer can change - a turn starting or ending, a
   * worker's starting or ending, the default chat moving to another - and
   * silent for every one of them that changed nothing.
   *
   * `chat/movableChanged` is the answer to whoever is watching the chat, and
   * the row in its session's catalogue follows the chat's state as every row
   * does, so a client watching only the list is told by the session's own
   * `session/chatUpdated`.
   *
   * The first call for a chat is its birth, which says nothing. Every road to a
   * running backend goes through `spawn`, which asks once as the chat is set
   * up, so the answer a chat was born with is recorded before anything can
   * change it - and a chat that can move from the day it is opened is not one
   * that has to be told so twice.
   */
  const updateChatMovability = (uri: string): void => {
    const session = sessionHolding(uri);
    const held = session === undefined ? undefined : sessions.get(session);
    const chat = held === undefined ? undefined : held.chats.get(uri);
    if (session === undefined || held === undefined || chat === undefined) {
      // Gone, so nothing is holding an answer for it any more.
      publishedMovable.delete(uri);
      return;
    }
    const now = movable(uri);
    const was = publishedMovable.get(uri);
    if (was === now) return;
    publishedMovable.set(uri, now);
    if (was === undefined) return;
    ctx.dispatch(uri, { type: 'chat/movableChanged', movable: now });
  };

  /**
   * Say a session's chats are in a new order.
   *
   * The action carries the whole catalogue, every chat in its new place, and
   * the reducer ignores a list that is not exactly the one the session
   * already holds - so every chat has to be named, once. The peers go
   * in their new order, which is what `held.chats` holds, and the workers
   * after them, which is where the state puts them: a reorder moves a chat and
   * not the calls that ran inside it, so a worker keeps its place.
   *
   * The restored workers are the same read the session's state makes, and the
   * same gate: a session this host resumed is the only one with workers it did
   * not open itself. A worker that is also live is named once, as the live one.
   */
  const chatsReordered = async (uri: string): Promise<void> => {
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    if (!held || !lead) return;
    const read = held.agent.subagents === undefined || !resumedSessions.has(uri)
      ? []
      : await restoredSubagents(idOf(uri), held.agent, lead.allTurns() as unknown as WireTurn<Turn>[]);
    ctx.dispatch(uri, {
      type: 'session/chatsReordered',
      chats: [
        ...held.chats.keys(),
        ...[...subagents].filter(([, one]) => one.session === uri).map(([one]) => one),
        ...read.map((one) => subagentChatUri(uri, String(one.toolCallId ?? '')))
          .filter((one) => !subagents.has(one)),
      ],
    });
  };

  /**
   * A worker chat's catalogue row: read-only, spawned by a tool call, and the
   * summary fields of the state its chat holds.
   */
  const subagentSummary = (uri: string, ref: LiveSubagent): Bag => {
    const state = ctx.stateOf(uri) ?? {};
    return {
      resource: uri,
      title: ref.title,
      // A worker is a chat of its session, so it carries the same bits: a
      // person reads a worker's conversation, or files it away, without the
      // lead chat. Both are in its state, moved by its own actions.
      status: Number(state.status ?? Status.Idle),
      modifiedAt: String(state.modifiedAt ?? ''),
      origin: { kind: 'tool', chat: ref.parentChat, toolCallId: ref.toolCallId },
      interactivity: 'read-only',
      ...(state.activity !== undefined ? { activity: state.activity } : {}),
    };
  };

  /**
   * The same, for a worker read back from a backend's own record, as of
   * `modifiedAt`: the moment the record says its session last moved.
   */
  const restoredSubagentSummary = (
    session: string,
    uri: string,
    parentChat: string,
    ref: { toolCallId: string; title: string; turns: Bag[] },
    modifiedAt: string,
  ): Bag => ({
    resource: uri,
    title: ref.title,
    status: Status.Idle | kept.chatFlags(idOf(session), uri),
    modifiedAt,
    origin: { kind: 'tool', chat: parentChat, toolCallId: ref.toolCallId },
    interactivity: 'read-only',
  });
  /**
   * One session's chats, in the one order both answers use.
   *
   * A session's state and its catalogue row are two answers to one question
   * and a client reads both, so a row listing two chats where the state lists
   * three is a client drawing a chat it cannot open. The list is built here
   * once and both call it.
   *
   * The session's own chats first, then the workers: a worker is a chat of the
   * session even though no `Session` holds it, and a client that subscribes
   * after one opened finds the conversation in the list.
   */
  const chatCatalogOf = (session: string, held: Held, restored: RestoredWorker[]): Bag[] => [
    ...[...held.chats].map(([uri, chat]) => chatSummary(session, uri, chat)),
    ...[...subagents].filter(([, one]) => one.session === session)
      .map(([uri, one]) => subagentSummary(uri, one)),
    ...restored.map(({ uri, one }) => restoredSubagentSummary(
      session,
      uri,
      // Read off `ctx` at the call: this area is built before the one that
      // owns the answer.
      ctx.restoredParentChat(session, held.defaultChat, one),
      one as unknown as { toolCallId: string; title: string; turns: Bag[] },
      // A worker that ran before this process held the session last moved no
      // later than the session's own last move the record names.
      moves.get(session) ?? held.createdAt,
    )),
  ];
  /**
   * The workers a running session read back, as they were last read.
   *
   * `summaryOf` answers in the same tick as the row it builds, and a backend's
   * record is not read in one, so the row reads the cache the session's own
   * snapshot fills: both list the same workers, and the row asks the disk
   * nothing behind the state's back. Until something has looked
   * for them the row carries the chats this host is holding and no more, and
   * the next move of it carries them - a session nobody has subscribed to has
   * workers nobody has asked about.
   */
  const restoredOf = (session: string): RestoredWorker[] =>
    (ctx.subHistory.get(idOf(session)) ?? [])
      .map((one) => ({ one, uri: subagentChatUri(session, String(one.toolCallId ?? '')) }))
      .filter(({ uri }) => !subagents.has(uri));
  /**
   * One session's chats, cut to the fields a catalogue row carries.
   *
   * `SessionChatSummary` is the protocol's compact chat - what a client draws
   * a session's chats from without subscribing to any of them - and it
   * carries neither of a `ChatSummary`'s `activity` and `modifiedAt`, either
   * of which would make the row change on its own: a worker read back from a
   * record is stamped with the moment it was built, so a list carrying that
   * would differ on every read.
   */
  const compactChats = (chats: Bag[]): SummaryChat[] => chats.map((chat) => ({
    resource: String(chat.resource),
    title: String(chat.title),
    ...(chat.origin !== undefined ? { origin: chat.origin as Record<string, unknown> } : {}),
    ...(chat.interactivity !== undefined ? { interactivity: String(chat.interactivity) } : {}),
    ...(chat.status !== undefined ? { status: Number(chat.status) } : {}),
  }));

  /**
   * A session's status as its catalogue row says it: the activity bits its
   * chats decide, with the session's own `IsRead` and `IsArchived`.
   *
   * Every answer carrying a status has to carry both halves or a row goes
   * back to unread the moment anything else about it changes.
   */
  const statusOf = (uri: string): number => {
    const held = sessions.get(uri);
    if (!held)
      return Status.Idle | kept.flags(idOf(uri));
    return drivingOf(held).status | kept.flags(idOf(uri));
  };
  /** The activity bits of a status, without the session's own two flags. */
  const activityBits = (status: number): number => status & (Status.IsRead - 1);
  /**
   * Every chat of a running session, worker chats included, each with what
   * its state says: its status, activity and last change. A chat whose state
   * is not held yet answers through its backend, which is what that state
   * opens with.
   */
  const chatsOf = (held: Held): { uri: string; status: number; activity: string | undefined; modifiedAt: string }[] => [
    ...[...held.chats].map(([uri, chat]) => {
      const state = ctx.stateOf(uri);
      return state === undefined
        ? { uri, status: chat.status(), activity: chat.activity(), modifiedAt: chat.modifiedAt() }
        : {
          uri,
          status: Number(state.status ?? Status.Idle),
          activity: typeof state.activity === 'string' ? state.activity : undefined,
          modifiedAt: String(state.modifiedAt ?? ''),
        };
    }),
    ...[...subagents].filter(([, ref]) => sessions.get(ref.session) === held).map(([uri]) => {
      const state = ctx.stateOf(uri) ?? {};
      return {
        uri,
        status: Number(state.status ?? Status.Idle),
        activity: typeof state.activity === 'string' ? state.activity : undefined,
        modifiedAt: String(state.modifiedAt ?? ''),
      };
    }),
  ];
  /**
   * The chat that decides a session's status and activity, as the reference
   * host aggregates a session made of chats.
   *
   * A chat that needs input makes the session need input; else a chat that
   * runs makes it run; else the activity bits are the default chat's, or the
   * most recently modified chat's when it has none, and a failed chat stays on
   * its own row. `InputNeeded` carries `InProgress`, so a chat that runs is one
   * whose bits under `InputNeeded` are `InProgress` alone. The activity is the
   * deciding chat's. A worker chat is a chat of the session and counts.
   * https://github.com/microsoft/vscode/blob/37eba0937fdca3097d4bb88e870abf3fc70dbde0/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3339-L3367
   */
  const drivingOf = (held: Held): { status: number; activity: string | undefined } => {
    const chats = chatsOf(held);
    const base = chats.find((one) => one.uri === held.defaultChat)
      ?? [...chats].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))[0];
    const asking = chats.find((one) => (one.status & Status.InputNeeded) === Status.InputNeeded);
    const running = chats.find((one) => (one.status & Status.InputNeeded) === Status.InProgress);
    if (asking !== undefined) return { status: Status.InputNeeded, activity: asking.activity };
    if (running !== undefined) return { status: Status.InProgress, activity: running.activity };
    return base === undefined
      ? { status: Status.Idle, activity: undefined }
      : { status: activityBits(base.status), activity: base.activity };
  };
  /** The most recent change across every chat of a session, as the protocol aggregates `modifiedAt`. */
  const modifiedOf = (held: Held): string => chatsOf(held)
    .map((one) => one.modifiedAt)
    .filter((one) => one !== '')
    .sort()
    .at(-1) ?? held.createdAt;
  /** What a session is doing: the activity of the chat that decides its status. */
  const activityOf = (held: Held): string | undefined => drivingOf(held).activity;

  /**
   * How many sessions are running a turn, as VS Code's host counts its active
   * sessions: a session counts while any of its chats, a worker's included,
   * has an active turn in the state the chat's reducer made. A session asleep,
   * at rest or listed from a transcript counts nothing. VS Code's Sessions
   * window reads the number as a host's running sessions, and starts a new
   * session on the host with the fewest.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3250-L3263
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionService.ts#L128
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/sessions/contrib/remoteSessions/browser/remoteSessionService.ts#L252
   */
  const activeCount = (): number => [...sessions.values()].filter((held) => [
    ...held.chats.keys(),
    ...[...subagents].filter(([, one]) => sessions.get(one.session) === held).map(([one]) => one),
  ].some((chat) => typeof ctx.stateOf(chat)?.activeTurn === 'object' && ctx.stateOf(chat)?.activeTurn !== null)).length;
  /**
   * Say how many sessions are running a turn, when the root's clients hold
   * another number: the one the root's state holds, or the last said while no
   * client has the root's state.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3162-L3188
   */
  let announced = -1;
  const activeSessionsChanged = (): void => {
    const now = activeCount();
    const held = ctx.stateOf(ROOT)?.activeSessions;
    if (now === (typeof held === 'number' ? held : announced)) return;
    announced = now;
    ctx.dispatch(ROOT, { type: 'root/activeSessionsChanged', activeSessions: now });
  };

  /** The diff stat of a folder with nothing changed. */
  const NO_CHANGES = { files: 0, additions: 0, deletions: 0 };
  /**
   * Which of the two counts a session's row carries.
   *
   * The reference host's `getSummaryChangesetKind`: a session that works in a
   * tree of its own is counted by its branch, and one in a folder somebody
   * chose is counted by its own checkpoints. Read from the worktree record,
   * the value that outlives a restart: the record is written where the tree
   * is made, and the config that asked for one is said to a session while it
   * runs.
   */
  const summaryKindOf = (uri: string): 'branch' | 'session' =>
    (ctx.worktreeOf(uri) === undefined ? 'session' : 'branch');
  /**
   * The diff stat a catalogue row carries, which a session's own state does not.
   *
   * The session's own counts where the host has read them, and the directory's
   * where it has not: a row is built synchronously and reading the session's
   * own takes git, so what goes in a row is what was read the last time the
   * counts moved.
   *
   * A session nothing has been read for is a session this host is not running
   * - one listed from a backend's own record - and the directory's counts are
   * the whole of what is known about it. Those two answers are not the same
   * thing said twice: a session whose tree was committed in has counts of
   * nothing, and the directory it committed in has counts of nothing for
   * nobody in particular.
   */
  const changesOf = (uri: string): Bag => {
    const read = kept.changes(idOf(uri));
    if (read !== undefined) return read.files ? { changes: read } : {};
    const dir = ctx.dirOf(uri);
    const summary = dir === undefined ? undefined : options.changes?.summary(dir);
    return summary?.files ? { changes: summary } : {};
  };
  /**
   * A running session's catalogue row: the summary fields of the state the
   * session holds, with the ones only a row carries.
   *
   * The session's state is what its row mirrors, so a row and the session it
   * opens are one answer. `status`, `activity` and `modifiedAt` are what the
   * session's chats decide, by the protocol's rules for a session made of
   * chats; `createdAt` and `changes` are the row's own.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L660-L680
   *
   * Undefined for a session this host is not running, which is not an error: a
   * row read from a transcript is in the catalogue and has no `Held`.
   */
  const summaryOf = (uri: string): Bag | undefined => {
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    if (!held || !lead) return undefined;
    // The state the session holds, or the one it would open with now: a
    // session opens at its first action or its first subscribe, and reading
    // its row opens nothing.
    const state = ctx.stateOf(uri) ?? ctx.sessionSeed(uri);
    const activity = activityOf(held);
    return {
      resource: uri,
      provider: held.agent.provider,
      title: String(state.title ?? ''),
      status: statusOf(uri),
      ...(activity !== undefined ? { activity } : {}),
      createdAt: held.createdAt,
      modifiedAt: modifiedOf(held),
      // The folders as recorded, one that has gone among them, as the
      // reference host's listing carries a session's recorded folders.
      // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L14736
      workingDirectories: Array.isArray(state.workingDirectories) ? state.workingDirectories as string[] : [],
      /*
       * What the session's chats are, and which of them a client gets when it
       * names none.
       *
       * The catalogue is what a client draws a session list from, and a client
       * listing twenty sessions reads their chats from the rows, subscribed to
       * none of them. Both fields are optional in the protocol, and both are
       * read off the session's state.
       */
      chats: compactChats(Array.isArray(state.chats) ? state.chats as Bag[] : []),
      ...(state.defaultChat !== undefined ? { defaultChat: state.defaultChat } : {}),
      // A row's own field, and a row's alone: `SessionState` does not declare
      // it, so it is added here, to the row.
      ...changesOf(uri),
      ...(state.project !== undefined ? { project: state.project } : {}),
      ...(state._meta !== undefined ? { _meta: state._meta } : {}),
    };
  };
  /**
   * The sessions this host is making and has not announced, each held from
   * before its backend starts until `root/sessionAdded` says it. A session
   * made fresh is provisional until its first message, as VS Code's host keeps
   * one unannounced until it materializes: listed to nobody, counted nowhere,
   * and removed without a word.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1004-L1056
   *
   * A change to a row is a change to one a client holds, so a session's row
   * moves on the wire only once it has been added; what moved while it was
   * being made goes out in the row `root/sessionAdded` carries.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/root-channel.md#L146
   *
   * Named as VS Code's agent service names the set it keeps them in.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1058
   */
  const provisionalSessionKeys = new Set<string>();
  const markSessionProvisional = (uri: string): void => { provisionalSessionKeys.add(uri); };
  /** A session appeared. Carries the whole row, because no client has one yet. */
  const sessionAdded = (uri: string): void => {
    provisionalSessionKeys.delete(uri);
    const summary = summaryOf(uri);
    if (!summary) return;
    // The row every client now holds, which the next move is a change from.
    const { resource: _resource, provider: _provider, createdAt: _createdAt, ...mutable } = summary;
    lastNotified.set(uri, mutable);
    ctx.broadcast(ROOT, 'root/sessionAdded', { channel: ROOT, summary });
  };
  /**
   * A turn handed to its backend, which is what brings a provisional session
   * up: announced, then said ready where its state is not, as VS Code's host
   * persists a session its first send materialized and says it ready unless
   * it is. A session whose creation a first message failed is said ready by
   * the next one that reaches its backend.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10835-L10841
   */
  const materialized = (uri: string): void => {
    if (!sessions.has(uri)) return;
    if (provisionalSessionKeys.has(uri)) sessionAdded(uri);
    const lifecycle = ctx.stateOf(uri)?.lifecycle;
    if (lifecycle === 'creating' || lifecycle === 'failed') ctx.dispatch(uri, { type: 'session/ready' });
  };
  /**
   * A provisional session whose first message ended in an error before its
   * backend had it: its creation failed, said after the turn's error, and the
   * session announced so every client lists it as failed, as VS Code's host
   * fails a session its first send could not bring up. A message sent again
   * brings it up.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2446-L2480
   */
  const failSessionCreationIfStillCreating = (uri: string, error: Bag): void => {
    if (!provisionalSessionKeys.has(uri)) return;
    ctx.dispatch(uri, { type: 'session/creationFailed', error });
    sessionAdded(uri);
  };
  /**
   * The summary last announced to clients for each session, as its mutable
   * fields, as VS Code's summary notifier keeps the last one notified.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L214-L215
   *
   * What a change is measured against, and it is bounded by the sessions this
   * host is serving: a row is compared against what went out for it while it
   * was being served. A row with no entry is one this host has said nothing
   * about since it was added or listed, and its first change carries every
   * mutable field.
   */
  const lastNotified = new Map<string, Bag>();
  /**
   * The sessions whose summary changed since the last flush, said together
   * once the changes have been quiet for 100 ms, as the reference host marks a
   * session dirty and flushes on that debounce: a burst of changes is one
   * notification.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L212-L330
   */
  const dirty = new Set<string>();
  /** Each row as it was when it was last marked, which a change is measured against. */
  const marked = new Map<string, string>();
  let flushing: ReturnType<typeof setTimeout> | undefined;
  /**
   * A session's row is gone: its notification bookkeeping dropped, as VS Code's
   * summary notifier removes a session, so nothing it was sent is compared to
   * and nothing of it is pending.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L287-L291
   */
  const removeNotifiedSummary = (uri: string): void => {
    lastNotified.delete(uri);
    provisionalSessionKeys.delete(uri);
    dirty.delete(uri);
    marked.delete(uri);
  };
  /**
   * A session already in the catalogue changed: its summary marked dirty, as
   * VS Code's summary notifier marks a session, and said on the debounce.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L272-L276
   *
   * `session` and `changes`, which are the names the protocol gives these.
   * `changes` carries the fields that changed and no other, and never the three
   * identity fields - `resource`, `provider`, `createdAt` - as the protocol has
   * it. A field compared and found equal is not sent: the callers of this are
   * reached on every turn, every tool call and every re-read of a directory,
   * and for most of those nothing about the row changed.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/root-channel.md#L146
   *
   * A session with no agent running still has a status - read and archived are
   * this host's bits and belong to the row, whatever process runs it - so its
   * row is that one field and its counts. Marking a row read is something
   * somebody does from the catalogue, to a session nobody has opened. Its diff
   * stat goes with it, which costs no process to read: it is the session's own
   * where `refreshSessionChangesSummary` has read one, and the directory's
   * otherwise.
   */
  const markSummaryDirty = (uri: string): void => {
    changesetsAndMetaChanged(uri);
    // A session nothing runs has its change said at once, as the reference
    // host applies a change to the summary it announced for a session with no
    // live state and emits it then.
    // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L234-L250
    if (!sessions.has(uri)) {
      flushSessionSummary(uri, rowOf(uri));
      return;
    }
    // Marked, and the flush put back, where the row changed since it was last
    // marked, as the reference host marks a session dirty where its summary's
    // fields changed.
    const row = JSON.stringify(rowOf(uri));
    if (marked.get(uri) === row) return;
    marked.set(uri, row);
    dirty.add(uri);
    if (flushing !== undefined) clearTimeout(flushing);
    flushing = setTimeout(flushPendingSessionSummaries, 100);
    flushing.unref?.();
  };
  /**
   * A row's mutable fields as a client holds them.
   *
   * Zero counts when there are none: a row whose counts went to nothing after
   * everything was committed says so, and a client then draws no counts.
   */
  const rowOf = (uri: string): Bag => {
    const summary = summaryOf(uri);
    const counts = { changes: NO_CHANGES, ...changesOf(uri) };
    if (summary === undefined) return { status: statusOf(uri), ...counts };
    const { resource: _resource, provider: _provider, createdAt: _createdAt, ...mutable } = summary;
    return { ...mutable, ...counts };
  };
  /** Every row that moved, said now, as the debounce would. */
  const flushPendingSessionSummaries = (): void => {
    if (flushing !== undefined) clearTimeout(flushing);
    flushing = undefined;
    const due = [...dirty];
    dirty.clear();
    for (const uri of due) flushSessionSummary(uri, rowOf(uri));
  };
  /**
   * What a running session's state holds of its folder and its backend, said
   * by `session/changesetsChanged` and `session/metaChanged` where they
   * changed, as VS Code's `setSessionChangesets` and `setSessionMeta` say a
   * value that differs from the state's.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2583-L2608
   *
   * The changesets a session offers are read off its folder's last read, and
   * its `_meta` off its backend, its folder, its plugins and its owner: each
   * read moves on its own clock, and the protocol has the producer say a
   * field as it changes. Asked where the session's row is, which is every
   * change of the session or its chats. A session whose backend serves its
   * own changesets, as the proxy of a session in a machine does, has them
   * said by that backend.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/guide/actions.md#L3
   */
  const changesetsAndMetaChanged = (uri: string): void => {
    const state = ctx.stateOf(uri);
    if (state === undefined || !sessions.has(uri)) return;
    const { changesets } = ctx.changesetsOf(uri) as { changesets?: unknown[] };
    if (!ctx.relaysChangesets(uri) && JSON.stringify(changesets ?? []) !== JSON.stringify(state.changesets ?? [])) {
      ctx.dispatch(uri, { type: 'session/changesetsChanged', ...(changesets === undefined ? {} : { changesets }) });
    }
    const { _meta: meta } = ctx.describes(uri) as { _meta?: Bag };
    if (JSON.stringify(meta ?? {}) !== JSON.stringify(state._meta ?? {})) {
      ctx.dispatch(uri, { type: 'session/metaChanged', ...(meta === undefined ? {} : { _meta: meta }) });
    }
  };
  /**
   * Say what changed on a row against the summary last notified, and advance
   * it, as VS Code's summary notifier flushes a session.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L307-L339
   *
   * The one place a `root/sessionSummaryChanged` leaves from, so that "does
   * this say anything new" is decided once, here. A live row and a listed row
   * arrive here by different roads and are judged the same way, which is what
   * lets a client keep one list against both.
   *
   * `activity` that went away is said as `null`, as the reference host says
   * it: a change is applied by spreading it over the row a client holds, and a
   * field left out is a field that did not change, so a session gone idle would
   * keep saying what its last tool was doing.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L319-L331
   */
  const flushSessionSummary = (uri: string, row: Bag): void => {
    if (provisionalSessionKeys.has(uri)) return;
    const before = lastNotified.get(uri);
    const changes: Bag = {};
    for (const [key, value] of Object.entries(row)) {
      if (before === undefined || JSON.stringify(before[key]) !== JSON.stringify(value)) changes[key] = value;
    }
    if (before?.activity !== undefined && row.activity === undefined) changes.activity = null;
    lastNotified.set(uri, { ...before, ...row, ...(row.activity === undefined ? { activity: undefined } : {}) });
    if (Object.keys(changes).length === 0) return;
    ctx.broadcast(ROOT, 'root/sessionSummaryChanged', { channel: ROOT, session: uri, changes });
  };
  /**
   * A session's changes summary, the counts `changesOf` reads, computed again
   * and kept where it can have changed, as VS Code refreshes a chat's changes
   * summary.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L1713-L1722
   *
   * Called where the checkpoint is taken, because reading it is a `git diff`
   * and a catalogue of a hundred rows is asked a hundred times per listing.
   * The session's own id, which names its checkpoints: they are commits under
   * `refs/agents/<id>`.
   *
   * A source that cannot answer for a session leaves the counts as they were,
   * so a row nobody could read for keeps whatever it had. That is every source
   * with no `sessionSummary`, and every directory that is not a repository.
   *
   * The calls are coalesced per session, as VS Code queues each computation
   * per key and coalesces the requests that arrive before the queued run
   * starts: one read running and one queued behind it. A turn of many tool
   * calls asks on every one of them, and each is a `git diff`, so the later
   * asks only record whether a turn is still running, and a burst of ten costs
   * two reads.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L1765-L1776
   *
   * A count is written only for a session this host is still running, the
   * sessions a respawn holds among them. A read takes a `git diff`'s time, and a
   * session disposed while it ran has had its row forgotten: a count written
   * after would make a row, and a file, of counts alone, which the next daemon
   * lists as a session nobody can open.
   */
  const computingChangesSummaries = new Set<string>();
  const queuedChangesSummaries = new Map<string, boolean>();
  const refreshSessionChangesSummary = async (uri: string, running = false): Promise<void> => {
    const dir = ctx.dirOf(uri);
    if (dir === undefined) return;
    if (computingChangesSummaries.has(uri)) {
      queuedChangesSummaries.set(uri, running);
      return;
    }
    computingChangesSummaries.add(uri);
    let whileRunning = running;
    try {
      for (;;) {
        queuedChangesSummaries.delete(uri);
        const source = options.changes;
        let read: ChangesSummary | undefined;
        try {
          const tree = ctx.worktreeOf(uri);
          read = summaryKindOf(uri) === 'branch'
            ? await source?.branchSummary?.(dir, tree?.commit ?? tree?.base)
            : await source?.sessionSummary?.(dir, idOf(uri), whileRunning);
        }
        catch { /* a count that could not be read is the count that was there */ }
        if (read !== undefined && (sessions.has(uri) || ctx.respawning.has(uri))) {
          kept.setChanges(idOf(uri), read);
          markSummaryDirty(uri);
        }
        if (!queuedChangesSummaries.has(uri)) return;
        whileRunning = queuedChangesSummaries.get(uri) ?? false;
      }
    }
    finally { computingChangesSummaries.delete(uri); }
  };
  /**
   * Set the models a CLI answered at its handshake as its provider's, an empty
   * list among them, and publish the agent list when it differs whole from
   * the one last published, as VS Code's agents set their models and its host
   * publishes its agent infos: a model renamed or given other limits under
   * its id is a change, and the same list published again is none, so a
   * handshake does not have every client read it again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L575-L606
   */
  const setAgentModels = (uri: string): void => {
    const session = sessions.get(uri);
    const lead = session && leadOf(session);
    const owner = owners.get(uri);
    if (!lead || !owner)
      return;
    const found = lead.models();
    about(owner.provider).models = found;
    const agents = ctx.descriptors();
    if (isDeepStrictEqual(agents, ctx.stateOf(ROOT)?.agents))
      return;
    ctx.log(`${owner.provider}: ${found.length} model(s): ${found.map((m) => m.id).join(', ')}`);
    ctx.dispatch(ROOT, { type: 'root/agentsChanged', agents });
  };

  /*
   * The root's agent list, published where it changed, as VS Code's host
   * publishes its agent infos when they differ from the ones it published last.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L575-L606
   */
  const publishAgentInfos = (): void => {
    const agents = ctx.descriptors();
    if (isDeepStrictEqual(agents, ctx.stateOf(ROOT)?.agents)) return;
    ctx.dispatch(ROOT, { type: 'root/agentsChanged', agents });
  };

  /**
   * Record the account one backend's harness is signed in as, and publish it,
   * as VS Code's Codex agent publishes its account info.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/codex/codexAgent.ts#L1489-L1491
   *
   * The value is published as a root config value, under the key that
   * backend's account belongs at, because that is where a client reads it -
   * `vscode.codexAccount` for Codex, which is where VS Code's own window
   * looks, and `ahpd.<provider>Account` for the rest. So a client watching the
   * root is told the same way whether the account came from a probe at boot
   * or from a session that has since signed in.
   *
   * A partial `root/configChanged`, which merges: one key changes and the rest
   * of the config is left alone. The filter that decides which connections may
   * see it is per connection, in `seenBy`.
   */
  const publishAccountInfo = (provider: string, account: Account): void => {
    about(provider).account = account;
    ctx.dispatch(ROOT, { type: 'root/configChanged', config: { [accountKey(provider)]: account } });
  };

  /**
   * Every id a session this host is serving answers to: the session's own, as
   * VS Code's registry holds a session, and its chats' backings, the backend's
   * own id for each of its chats, which VS Code keeps out of its list.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L262
   *
   * The two can differ, and a row listed under either is a session this host
   * runs. Asked by a listing, so a running session is listed once, and by a
   * refresh, so the row this host built for it stays. A session a restart is
   * bringing back is one this host serves too: until its backend starts, no
   * listing offers it.
   */
  const registeredAndBackingIds = (): Set<string> => {
    const claimed = new Set<string>();
    for (const [uri, held] of [...sessions, ...ctx.respawning]) {
      claimed.add(idFor(uri));
      for (const chat of held.chats.values()) {
        const own = chat.agentId();
        if (own)
          claimed.add(own);
      }
    }
    return claimed;
  };
  const listing = async (before: Summary[] = []): Promise<Summary[]> => {
    /*
     * The ids this host is serving, and the backend ids the chats it recorded
     * answer to.
     *
     * Read once the backends have answered, because the second half is what
     * the store says about the sessions *they* offered -
     * and a peer chat's backend id is a conversation, not a session. A
     * listing that offered one would offer a session of its own for it, and
     * the row would open onto the chat's own transcript as though it were a
     * conversation somebody started.
     */
    const claimed = registeredAndBackingIds();
    /**
     * Whether this listing can say what is gone, and where it looked.
     *
     * A backend that refused lists nothing, and every row it would have offered
     * would look the same as a transcript deleted outside this host. So a
     * listing only prunes when every backend answered and at least one of them
     * was asked - a listing from no backend at all is not a listing. What a
     * refusing backend's rows were last time is carried forward here, and is
     * not this listing's to prune or to forget.
     *
     * What each answered backend read is kept beside that, since a listing only
     * speaks for the directories it read. Claude's catalogue is its configured
     * paths and nothing else, so a session opened in a git worktree is one no
     * listing has ever offered, and a row for it is not a session that is gone.
     */
    let answered = 0;
    /** The providers that refused, whose rows this listing says nothing about. */
    const silent = new Set<string>();
    /** The providers that answered, and every directory they read. */
    const spoken = new Set<string>();
    const read = new Set<string>();
    /** Every agent's row for an id, in the order the agents were loaded. */
    const offered = new Map<string, { agent: Agent; row: Listed }[]>();
    /*
     * Every backend at once, and folded in the order they were loaded.
     *
     * Asked in turn this listing costs the sum of every store on the machine:
     * a host serving Claude and two variants of it read the same projects
     * directory three times, and on dev-01 that was fifty seconds of it.
     *
     * `Promise.all` answers in the order it was given its work, whatever order
     * that work finished in, so the fold below is still the load order - and
     * that order is what decides whose row an id two backends both list is, so
     * it cannot be left to whichever store happened to be quicker.
     */
    const answers = await Promise.all([...agents.values()].map(async (agent) => {
      if (!agent.list)
        return undefined;
      // One backend refusing is not the catalogue refusing. The others still
      // have rows, and a list that failed because a second harness is not
      // signed in is a client that can open nothing.
      answered += 1;
      const rows = await agent.list().catch(() => { silent.add(agent.provider); return undefined; });
      return { agent, rows };
    }));
    for (const one of answers) {
      if (one === undefined || one.rows === undefined)
        continue;
      const { agent, rows } = one;
      spoken.add(agent.provider);
      for (const dir_ of agent.directories?.() ?? []) read.add(dir_);
      for (const row of rows) {
        const both = offered.get(row.id);
        if (both === undefined) offered.set(row.id, [{ agent, row }]);
        else both.push({ agent, row });
      }
    }
    /*
     * What the store records about every row just offered, read before any of
     * them is filtered.
     *
     * Two answers at once. A backend id on one of those lists was a chat's
     * conversation, so the row a listing has for it is not a session. And a
     * session recorded since this host started is one the map built at startup
     * never saw, so reading the store here is also what keeps that map current.
     */
    for (const id of offered.keys()) recordedChats(id);
    for (const own of chatBackends()) claimed.add(own);
    for (const id of [...offered.keys()]) {
      if (claimed.has(id)) offered.delete(id);
    }
    /*
     * The ids this host has a row for, read once for the whole listing.
     *
     * A row is what makes a listed session the host's own: it is where the
     * name the session was made with lives, and a session with no row is one
     * that only a backend knows. The store is asked once per listing, so a
     * listing over a hundred transcripts asks it one question.
     */
    const stored = new Set(kept.sessions());
    const found: Summary[] = [];
    for (const [id, both] of offered) {
      /*
       * Whose this row is, which two harnesses reading one directory cannot
       * say between them: a transcript names the CLI that wrote it and not the
       * plugin that started it. The host recorded the answer when the session
       * ran, and that is the one loaded agent it names.
       *
       * An agent this host recorded but is not serving is not the first one to
       * read the transcript, and the row keeps its own provider: listed under
       * the reader's id it would be opened by whichever agent answered, and a
       * conversation would move to another endpoint on a daemon that merely
       * failed to load one plugin. It waits for its agent, and no owner is
       * recorded, so nothing can open it here. A session recorded before anything was has no agent to wait
       * for and still goes to the first one that listed it.
       */
      const recorded = kept.provider(id);
      const waiting = recorded !== undefined && !agents.has(recorded) ? recorded : undefined;
      const one = waiting === undefined ? both.find((it) => it.agent.provider === recorded) ?? both[0] : both[0];
      // Never empty: an id is in the map only because an agent listed it.
      if (one === undefined) continue;
      found.push(registerListedSession(one.agent, one.row, waiting, stored.has(id)));
    }
    /*
     * The nested sessions, from what this host recorded of them.
     *
     * Their transcripts are in the machines they ran in, so no backend lists
     * them, and the machine is not asked: a row is what was recorded, and
     * opening one is what reaches the machine. One whose agent is not loaded
     * waits for it, as a listed row does.
     */
    for (const [id, record] of kept.nestedSessions?.() ?? []) {
      if (claimed.has(id) || offered.has(id)) continue;
      const agent = agents.get(record.provider);
      const reader = agent ?? [...agents.values()][0];
      if (reader === undefined) continue;
      const { title, createdAt, modifiedAt, workingDirectories } = record;
      found.push(registerListedSession(reader, { id, title, createdAt, modifiedAt, workingDirectories }, agent === undefined ? record.provider : undefined, stored.has(id)));
    }
    /*
     * The sessions the store recorded in a folder no backend read.
     *
     * A backend lists the paths it serves and nothing else, so a session that
     * ran elsewhere - a bot's own folder, a git worktree - is one no listing
     * has ever offered. Its record is what says it happened, and `find` is how
     * a backend answers about one session by id, told the folder it ran in.
     * Asked after the backends have answered, because `read` is only known
     * then, and all at once: each lookup is one backend reading one file.
     *
     * A session this host is running or a backend already offered is not
     * asked again, and a nested one is listed above. A lookup that throws or
     * finds nothing adds no row, and the record stays - the same rule `gone`
     * keeps.
     */
    const unread = (kept.recordedFolders?.() ?? []).filter(([id, folder]) =>
      !claimed.has(id) && !offered.has(id) && !read.has(folder)
      && kept.nested?.(id) === undefined && !found.some((one) => idFor(one.resource) === id));
    // Read as the offered ids are, so a chat recorded under one of these ids
    // claims its backend id before that id is looked up as a session.
    for (const [id] of unread) recordedChats(id);
    for (const own of chatBackends()) claimed.add(own);
    const strays = unread.filter(([id]) => !claimed.has(id));
    const looked = await Promise.all(strays.map(async ([id, folder]) => {
      const recorded = kept.provider(id);
      const asked = [...agents.values()].filter((agent) => agent.find !== undefined);
      const order = recorded === undefined
        ? asked
        : [...asked.filter((agent) => agent.provider === recorded), ...asked.filter((agent) => agent.provider !== recorded)];
      for (const agent of order) {
        const row = await agent.find?.(id, { workingDirectory: folder }).catch(() => undefined);
        if (row !== undefined) return { agent, row };
      }
      return undefined;
    }));
    for (const one of looked) {
      if (one === undefined) continue;
      const recorded = kept.provider(one.row.id);
      found.push(registerListedSession(one.agent, one.row, recorded !== undefined && !agents.has(recorded) ? recorded : undefined, stored.has(one.row.id)));
    }
    /*
     * The sessions whose turns are all this host's own: `!` commands, kept in
     * the session's folder.
     *
     * No agent wrote anything, so no listing offers one and no lookup finds
     * it, and this host lists it from what it kept, as it lists a nested
     * session. One whose agent is not loaded waits for it, as a listed row
     * does.
     */
    for (const [id, folder] of kept.recordedFolders?.() ?? []) {
      if (claimed.has(id) || offered.has(id) || kept.nested?.(id) !== undefined) continue;
      if (found.some((one) => idFor(one.resource) === id)) continue;
      const turns = ctx.loadSessionLocalTurns(id);
      if (turns.length === 0) continue;
      const recorded = kept.provider(id);
      const agent = recorded === undefined ? undefined : agents.get(recorded);
      const reader = agent ?? [...agents.values()][0];
      if (reader === undefined) continue;
      found.push(registerListedSession(reader, keptRow(id, folder, turns), agent === undefined ? recorded : undefined, stored.has(id)));
    }
    /*
     * What a refusing backend had last time, kept as it was.
     *
     * A backend that did not answer said nothing about its sessions, and this
     * host reads that as what it is: silence, its store as full as it was at
     * the last pass. So its rows carry over: they are still what
     * that store offered, a client is answered with them, and nothing is said
     * about them - which is the part that matters, since a client told a session
     * is gone closes it, and this one never stopped being there.
     *
     * A row another backend answered for is that backend's own, and a row a
     * session this host runs now claims is not a listed row at all.
     */
    for (const held of before) {
      if (!silent.has(held.provider) || claimed.has(idFor(held.resource)))
        continue;
      if (offered.has(idFor(held.resource)) || found.some((one) => one.resource === held.resource))
        continue;
      found.push(held);
    }
    // The protocol says a server SHOULD order them most-recently-modified
    // first, and a client that has to sort a list it was handed is a client
    // doing the server's job.
    found.sort((a_, b_) => b_.modifiedAt.localeCompare(a_.modifiedAt));
    /*
     * What no backend lists any more is gone - a transcript deleted outside
     * this host - and what is kept for it is for a row nothing can open again.
     *
     * A listing only speaks for what it read, and a backend reads the paths it
     * was configured with: a row in a directory none of them serves - a session
     * opened in a git worktree - is one no listing could have offered, and this
     * host cannot say it is gone. Nor can it say so of a row whose directory or
     * whose provider nothing has ever named. Both are kept: what is kept for
     * them is the owner, the title and the senders of a session somebody opened.
     * A row whose turns this host keeps itself is kept as well, because it opens
     * from them whatever a backend lists.
     */
    const forgotten: Array<[string, Record<string, unknown> | undefined]> = [];
    const gone = (id: string): boolean => {
      if (claimed.has(id) || offered.has(id) || kept.nested?.(id) !== undefined)
        return false;
      const provider = kept.provider(id);
      if (provider === undefined || !spoken.has(provider))
        return false;
      const named = names.get(id);
      const dir_ = named === undefined ? undefined : ctx.dirOf(named);
      if (named === undefined || dir_ === undefined || !read.has(dir_)) return false;
      // A session whose turns this host keeps is one it can open from them.
      if (ctx.loadSessionLocalTurns(id).length > 0) return false;
      /*
       * A session about to be forgotten, and the config it is being forgotten
       * with, kept for after the prune.
       *
       * The prune deletes the row, so the machine its config names can only be
       * read before it. A session nobody resumed never entered its machine in
       * this process, so nothing else here would ever let it go.
       */
      forgotten.push([named, kept.config(id)]);
      return true;
    };
    if (answered > 0 && silent.size === 0) kept.prune?.(gone);
    for (const [uri, config] of forgotten) ctx.leaveForgotten(uri, config);
    return found;
  };

  /**
   * One listed row, recorded as it is listed.
   *
   * Remembered because opening a row asks its backend for the transcript, and
   * the URI says neither whose it is nor where it ran: the owner, the title and
   * the dates are all this map. A listing and an opening that finds a row are
   * the same thing told twice, so both build it here, the same way.
   *
   * `waiting` is a provider the host recorded for this session and is not
   * serving, so the row keeps its own provider and no owner: nothing here can
   * open it, and the session waits for the agent it actually ran on.
   *
   * `stored` says whether this host has a row for the id. A row's `uri` is the
   * name the session was made with, so a listed session with one is named that
   * way and a session that already exists keeps its `<provider>:/<id>` name. A
   * row with no `uri` is named from its provider, as before, and that name is
   * stored. A row this host has none for is a transcript nobody here made, and
   * it is `ahp-session:/<id>` until something makes the session this host's own.
   *
   * The row's folder goes into the session's record when the record has none,
   * so a backend is told where to look for it after a restart. Only into a
   * record the host already keeps, which is one with a provider: a listing
   * names every session on the machine, and a file for each is a file for
   * sessions this host never ran.
   */
  /**
   * A row for a session listed from the turns this host keeps for it.
   *
   * Its title is the one the session was given, kept as its default chat's in
   * a record that keeps none of the session's, and else its first turn's, as
   * a backend titles a session after its first prompt. Its
   * dates are its first turn's start and its last turn's end, which is where
   * the protocol's reducer moves a chat when a turn completes. A turn that
   * names no start adds nothing to them, and a row with no start at all dates
   * from the epoch, as a transcript entry with no time does.
   */
  const keptRow = (id: string, folder: string, turns: readonly Bag[]): Listed => {
    const startOf = (turn: Bag): number => (typeof turn.startedAt === 'string' ? Date.parse(turn.startedAt) : Number.NaN);
    const dated = turns.filter((turn) => Number.isFinite(startOf(turn))).sort((a, b) => startOf(a) - startOf(b));
    const first = dated[0];
    const last = dated.at(-1);
    const name = kept.uri?.(id);
    const given = kept.customTitle?.(id);
    const named = given !== undefined
      ? given === '' ? undefined : given
      : name === undefined ? undefined : kept.chatTitle(id, chatUriFor(name));
    const message = (first ?? turns[0])?.message;
    const said = typeof message === 'object' && message !== null ? (message as { text?: unknown }).text : undefined;
    const epoch = new Date(0).toISOString();
    return {
      id,
      title: named ?? titleFrom(typeof said === 'string' ? said : '', 'New session'),
      createdAt: first === undefined ? epoch : new Date(startOf(first)).toISOString(),
      modifiedAt: last === undefined
        ? epoch
        : new Date(startOf(last) + (typeof last.duration === 'number' ? last.duration : 0)).toISOString(),
      workingDirectories: [uriOf(folder)],
    };
  };

  /**
   * Register one listed session, its name, owner, folders, dates and `_meta`
   * recorded, and project its row, as VS Code's registry registers a session
   * its listing found and the listing projects its entry.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSessionRegistry.ts#L92-L99
   */
  const registerListedSession = (agent: Agent, row: Listed, waiting?: string, stored = false): Summary => {
    const provider = waiting ?? agent.provider;
    const keptName = kept.uri?.(row.id);
    const resource = keptName ?? (stored ? `${provider}:/${row.id}` : uriFor(row.id));
    // An old row keeps the name its clients already hold, and stores it so the
    // next listing does not derive it again. A row this host has none for is
    // named but not remembered: a listing must not write a file per session it
    // finds on the machine.
    if (keptName === undefined && stored) kept.setUri?.(row.id, resource);
    names.set(row.id, resource);
    if (waiting === undefined) owners.set(resource, agent);
    wheres.set(resource, row.workingDirectories);
    const folder = row.workingDirectories[0];
    if (folder !== undefined && kept.provider(row.id) !== undefined && kept.workingDirectory?.(row.id) === undefined) {
      const path = localPath(folder);
      if (path !== '') kept.setWorkingDirectory?.(row.id, path);
    }
    births.set(resource, row.createdAt);
    moves.set(resource, row.modifiedAt);
    // Kept whole, as the row said it: the row that is answered later is built
    // here and `describes` reads this map. Removed when the row has none, so a
    // backend that dropped its keys stops being answered with them.
    if (row._meta === undefined) listedMeta.delete(resource);
    else listedMeta.set(resource, row._meta);
    return {
      resource,
      provider,
      title: row.title,
      // Nothing this host started is running yet, so activity is idle and the
      // only bits set are the client's own.
      status: Status.Idle | kept.flags(row.id),
      createdAt: row.createdAt,
      modifiedAt: row.modifiedAt,
      workingDirectories: row.workingDirectories,
      ...changesOf(resource),
      ...ctx.describes(resource),
    };
  };
  /**
   * A listed row this host did not have, announced whole, as VS Code announces
   * a session its listing surfaced.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6053
   *
   * `sessionAdded` speaks for a session this host is running and builds the row
   * from it; this one is a row a backend answered for a session nobody runs,
   * which is what a client opening a link from another machine finds. The row
   * every client now holds is the one the next change is measured from, as it
   * is for that one.
   */
  const announceSurfacedSession = (summary: Summary): void => {
    const { resource, provider: _provider, createdAt: _createdAt, ...mutable } = summary as unknown as Bag;
    lastNotified.set(String(resource), mutable);
    ctx.broadcast(ROOT, 'root/sessionAdded', { channel: ROOT, summary });
  };

  /**
   * The rows of the sessions this host is running, built now, on each answer.
   *
   * A live row changes every second and building one reads a handful of
   * in-memory objects, while a backend row costs a pass over every transcript
   * on the machine. The held catalogue keeps the expensive half and this is
   * built for each answer, so a session somebody is looking at is current.
   */
  const liveRows = (): Summary[] => {
    // Sessions this host started are real and are not listed by a backend yet,
    // and the one being looked at is among them. One not yet announced is
    // nobody's row, as VS Code's host lists no idle provisional session.
    const live: Summary[] = [];
    for (const [uri, held] of sessions) {
      const lead = leadOf(held);
      if (!lead || provisionalSessionKeys.has(uri))
        continue;
      const started = origins.get(uri);
      live.unshift({
        resource: uri,
        provider: held.agent.provider,
        title: lead.title(),
        status: statusOf(uri),
        // What it is doing, so a list of twenty sessions says which one is
        // busy and with what.
        ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
        createdAt: held.createdAt,
        modifiedAt: modifiedOf(held),
        workingDirectories: lead.workingDirectories(),
        // The chats and the default one, as `summaryOf` carries them: a client
        // that lists without subscribing reads a row's chats from here, and
        // the row agrees with the session it names.
        chats: compactChats(chatCatalogOf(uri, held, restoredOf(uri))),
        defaultChat: held.defaultChat,
        ...(started !== undefined ? { origin: started } : {}),
        ...changesOf(uri),
        ...ctx.describes(uri),
      });
    }
    return live;
  };

  /**
   * Every row a client is handed, as one list: the running sessions now, the
   * held rows behind them, most recently modified first.
   *
   * One place for the two halves to be put together, because they are one
   * answer: `listSessions` pages over this and so does the `list_sessions`
   * tool. A session this host is running is dropped out of the held rows by
   * its id, since it is in the first half and a row twice is a row a client
   * has to reconcile, and so is one not yet announced.
   */
  const allRows = async (): Promise<Summary[]> => {
    const running = liveRows();
    const claimed = new Set([...running.map((row) => idFor(row.resource)), ...[...provisionalSessionKeys].map(idFor)]);
    const listed = await ctx.listedSessions();
    // The protocol says a server SHOULD order them most-recently-modified
    // first, and a client that has to sort a list it was handed is a client
    // doing the server's job.
    return [...running, ...listed.filter((row) => !claimed.has(idFor(row.resource))).map(hereNow)]
      .sort((a_, b_) => b_.modifiedAt.localeCompare(a_.modifiedAt));
  };
  /**
   * A held row with what this host knows about it read again.
   *
   * What a backend said about a session is held, because learning it cost a
   * pass over every transcript on the machine. What this host knows about it is
   * not held and not asked for either: a row a client marked read, and the
   * counts and facts of a directory read since, move on their own and cost
   * nothing to read.
   *
   * Read here, as the answer is made, so a client that marked a row and
   * listed again is handed the flag it has just set, and the list it holds
   * agrees with the notification that told it about the change.
   */
  const hereNow = (row: Summary): Summary => ({
    resource: row.resource,
    provider: row.provider,
    title: row.title,
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
    workingDirectories: row.workingDirectories,
    // Nothing this host started is running yet, so activity is idle and the
    // only bits set are this host's own and the client's.
    status: Status.Idle | kept.flags(idFor(row.resource)),
    ...changesOf(row.resource),
    ...ctx.describes(row.resource),
  });

  /**
   * What a refresh found, told to every client, as VS Code announces, updates
   * and retracts the sessions its listing surfaced.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1345-L1390
   *
   * The catalogue is held, so nobody has to ask for it to learn that a session
   * appeared or is gone: what changed since the last listing goes out as the
   * three protocol notifications a client already reduces its list against.
   *
   * A row this host is running is left out entirely. `markSummaryDirty` speaks for
   * it, every second or so, and a row listed here is built from a listing that
   * is already behind by the time it is answered.
   */
  const publishSurfacedSessions = (before: Summary[], after: Summary[]): void => {
    /*
     * Nothing is said on the first fill.
     *
     * A host that has answered nobody has told nobody, so a listing's whole
     * contents are not an addition to an empty catalogue - and every client
     * connected while this was read gets its catalogue from the answer to its
     * own `listSessions`.
     */
    if (before.length === 0) return;
    const was = new Map(before.map((row) => [row.resource, row]));
    for (const row of after) {
      const had = was.get(row.resource);
      was.delete(row.resource);
      if (sessions.has(row.resource))
        continue;
      if (had === undefined) {
        announceSurfacedSession(row);
        continue;
      }
      if (!surfacedSessionChanged(had, row)) continue;
      // Measured against the row the clients hold: what this listing read
      // before, when nothing was said about it since.
      const { resource: _resource, provider: _provider, createdAt: _createdAt, ...mutable } = row;
      if (!lastNotified.has(row.resource)) {
        const { resource: _was, provider: _p, createdAt: _c, ...held } = had;
        lastNotified.set(row.resource, held);
      }
      flushSessionSummary(row.resource, mutable);
    }
    const claimed = registeredAndBackingIds();
    for (const [resource] of was) {
      /*
       * A session this host is running is not one that went away.
       *
       * A listing leaves out what a session claims - its row is in the live
       * half of the answer - so a refresh finds
       * it missing, and a row that was held and is not listed any more is
       * exactly what a session deleted outside this host looks like. It is
       * still here, its summary is the session's own, and what was last sent
       * for it is kept so the next move of it is still compared against it.
       */
      if (sessions.has(resource) || claimed.has(idFor(resource)))
        continue;
      removeNotifiedSummary(resource);
      ctx.broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, session: resource });
    }
  };
  /**
   * Whether a listed row says anything a client does not already hold.
   *
   * The fields a listing can change and nothing else: `resource`, `provider`
   * and `createdAt` say who the row is, and `_meta` has the session's own
   * channel to change it on. Everything else on a row is read off the
   * transcript, so it is one of these or it stays as it is.
   */
  const surfacedSessionChanged = (was: Summary, now: Summary): boolean => {
    // `changes` is a row's own field and not on `Summary`, the way `_meta` is
    // not either: both are spread onto the row by the module that owns them.
    const before = was as unknown as Bag;
    const after = now as unknown as Bag;
    return was.title !== now.title
      || was.modifiedAt !== now.modifiedAt
      || was.status !== now.status
      || JSON.stringify(was.workingDirectories ?? []) !== JSON.stringify(now.workingDirectories ?? [])
      || JSON.stringify(before.changes ?? null) !== JSON.stringify(after.changes ?? null);
  };

  /**
   * The provider a stored session recorded, where this host does not serve it,
   * or nothing: the session's provider is unavailable, as VS Code calls it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/AGENTS.md#L248
   *
   * Set when the host recorded a provider and is not serving it, which is not
   * the same as a session with no record: the first agent to read the
   * transcript is a different harness, and continuing the conversation there
   * would both read it with the wrong backend and rewrite the record that says
   * which one it belongs to. The record is left exactly as it was, so the
   * session is the same conversation again once its agent loads. A session
   * recorded before anything was has no agent to wait for, and opens on the
   * first one that listed it.
   */
  const unavailableProvider = (id: string): string | undefined => {
    const recorded = kept.provider(id);
    return recorded !== undefined && !agents.has(recorded) ? recorded : undefined;
  };
  /**
   * Every stored session's directory that `browsable()` leaves out, read once.
   *
   * The catalogue draws a row's counts from what was last read of its
   * directory, and only `browsable()` is read at startup, so a session kept
   * in any other directory would list with none until a turn of it ended.
   * One directory at a time, since a host with many stored sessions would
   * otherwise start by running every one's `git` at once; a directory that
   * fails to read is skipped. A row whose counts moved is announced: a live
   * session by `readFacts` itself, a listed one here.
   */
  const readStored = async (): Promise<void> => {
    const served = new Set(browsable());
    /*
     * The first refresh, and the same one a `listSessions` would have started:
     * a listing of its own here would leave the two disagreeing, and whichever
     * finished last would decide what the catalogue holds.
     */
    const rows = await ctx.refresh().catch(() => [] as Summary[]);
    const dirs = new Set<string>();
    for (const row of rows) {
      // A live session's directory is read by what that session does.
      if (sessions.has(row.resource)) continue;
      const dir_ = ctx.dirOf(row.resource);
      if (dir_ !== undefined && !served.has(dir_)) dirs.add(dir_);
    }
    for (const dir_ of dirs) {
      if (!await ctx.readFacts(dir_)) continue;
      for (const row of rows) {
        if (!sessions.has(row.resource) && ctx.dirOf(row.resource) === dir_) markSummaryDirty(row.resource);
      }
    }
  };

  /**
   * A chat's summary mirrored onto its session after the chat's action, as VS
   * Code's state manager mirrors a chat's summary onto its session's catalogue
   * and derived summary.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3268-L3269
   *
   * The chat's row in the session's `chats` takes the fields of the chat's
   * state that changed, as `session/chatUpdated` - only those, its activity
   * with a status change, and never its `resource`. The session's held
   * `activity` takes the activity of the chat
   * that now decides it, in place, as the reference host folds its chats into
   * the session's state with no action of its own. And the catalogue row
   * changes with both. Each is done only when the session's state is held: a
   * session nothing holds opens with what its chats say then. The root's count
   * of sessions running a turn is read again too, since a turn's start and end
   * are chat actions.
   *
   * A row's `activity` the chat cleared stays as it was: the action merges what
   * it carries, and the protocol's summary has no value that clears it. The
   * chat's own state and the session's `activity` say it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3280-L3334
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/session-channel.md#L91-L99
   */
  const onChatSummaryChanged = (chat: string): void => {
    const session = sessionHolding(chat);
    const held = session === undefined ? undefined : sessions.get(session);
    if (session === undefined || held === undefined) return;
    const state = ctx.stateOf(session);
    const own = ctx.stateOf(chat);
    if (state !== undefined && own !== undefined) {
      const row = (Array.isArray(state.chats) ? state.chats as Bag[] : []).find((one) => one.resource === chat);
      /*
       * A chat whose backend serves its row says the row itself, all but the
       * read and archived bits of its status, which this host lays on as it
       * keeps them.
       */
      const relayed = !subagents.has(chat) && held.chats.get(chat)?.channel !== undefined;
      if (row !== undefined && relayed) {
        const flags = (status: unknown): number => Number(status ?? 0) & ~(Status.IsRead - 1);
        const now = flags(own.status);
        if (now !== flags(row.status)) {
          const status = (Number(row.status ?? Status.Idle) & (Status.IsRead - 1)) | now;
          ctx.dispatch(session, { type: 'session/chatUpdated', chat, changes: { status } });
        }
      }
      else if (row !== undefined) {
        const now = subagents.has(chat) ? subagentSummary(chat, subagents.get(chat) as LiveSubagent) : summaryIn(own, chat);
        const changes: Bag = {};
        for (const key of ['title', 'status', 'modifiedAt', 'interactivity', 'origin']) {
          if (now[key] === undefined) continue;
          if (JSON.stringify(now[key]) !== JSON.stringify(row[key])) changes[key] = now[key];
        }
        // The chat's activity rides its status change, as the reference host
        // forwards it, and is said with nothing else.
        if (changes.status !== undefined && now.activity !== undefined) changes.activity = now.activity;
        if ((now.movable === true) !== (row.movable === true)) changes.movable = now.movable === true;
        if (Object.keys(changes).length > 0) ctx.dispatch(session, { type: 'session/chatUpdated', chat, changes });
      }
      /*
       * The session's state holds its chats' aggregate, its status and the
       * activity of the chat that drives it, beside its own read and archived
       * bits, as VS Code's state manager keeps a session's derived fields in
       * its state; no action of the protocol's says them, so a snapshot is
       * where a client reads them.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3301-L3325
       */
      const activity = activityOf(held);
      const open = ctx.heldStates.get(session);
      if (open !== undefined) {
        const status = (statusOf(session) & (Status.IsRead - 1)) | (Number(open.state.status ?? 0) & ~(Status.IsRead - 1));
        if (activity !== open.state.activity || status !== open.state.status) {
          const { activity: _was, ...rest } = open.state;
          open.state = activity === undefined ? { ...rest, status } : { ...rest, status, activity };
        }
      }
    }
    markSummaryDirty(session);
    activeSessionsChanged();
  };

  /**
   * What a chat's running turn waits on a person for, as the session's
   * `inputNeeded` entries under the reference host's ids: a question with no
   * response (`chatInput:<chat>:<request>`, the request as the chat holds it,
   * answers and all), a call at a confirmation (`toolConfirmation:<chat>:
   * <turn>:<call>`, less one a session setting approved), a call a client runs
   * (`toolClientExecution:...`, with that client) and a call awaiting a sign-in
   * (`toolAuthentication:...`). Read from the chat's state, whoever asked: a
   * backend, a host tool or this host itself, as VS Code's host mirrors every
   * chat's blockers and no agent raises an entry.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L85-L157
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L207-L221
   */
  const inputNeededOf = (chat: string, state: Bag | undefined): Bag[] => {
    const turn = state?.activeTurn as Bag | undefined;
    if (turn === undefined) return [];
    return (Array.isArray(turn.responseParts) ? turn.responseParts as Bag[] : []).flatMap((part): Bag[] => {
      const request = part.request as Bag | undefined;
      if (part.kind === 'inputRequest' && part.response === undefined && request !== undefined)
        return [{ id: `chatInput:${chat}:${String(request.id)}`, kind: 'chatInput', chat, request }];
      const toolCall = part.toolCall as Bag | undefined;
      if (toolCall === undefined) return [];
      const ids = `${chat}:${String(turn.id)}:${String(toolCall.toolCallId)}`;
      const status = String(toolCall.status ?? '');
      const contributor = toolCall.contributor as Bag | undefined;
      const approved = status === 'pending-confirmation' && (toolCall._meta as Bag | undefined)?.autoApproveBySetting === true;
      if ((status === 'pending-confirmation' || status === 'pending-result-confirmation') && !approved)
        return [{ id: `toolConfirmation:${ids}`, kind: 'toolConfirmation', chat, turnId: turn.id, toolCall }];
      if (status === 'running' && contributor?.kind === 'client')
        return [{ id: `toolClientExecution:${ids}`, kind: 'toolClientExecution', chat, turnId: turn.id, clientId: contributor.clientId, toolCall }];
      if (status === 'auth-required')
        return [{ id: `toolAuthentication:${ids}`, kind: 'toolAuthentication', chat, turnId: turn.id, toolCall }];
      return [];
    });
  };

  /** What each chat has in its session's list, as this host last said it. */
  const raised = new Map<string, Bag[]>();
  /**
   * The session's entries for one chat, kept to what its running turn waits
   * on: each raised with `session/inputNeededSet` where it is new or changed,
   * and each one the chat has closed taken down with
   * `session/inputNeededRemoved`, after every action of the chat, so an entry
   * goes once its request resolves and every entry of the chat goes with its
   * turn, as the reference host keeps the session's entries.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/sessionInputNeeded/sessionInputNeededContribution.ts#L51-L83
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-session/state.ts#L243-L245
   */
  const syncSessionInputNeeded = (chat: string): void => {
    const session = sessionHolding(chat);
    const was = raised.get(chat) ?? [];
    const now = session === undefined ? [] : inputNeededOf(chat, ctx.stateOf(chat));
    if (now.length === 0) raised.delete(chat);
    else raised.set(chat, now);
    if (session === undefined) return;
    for (const request of now) {
      const before = was.find((one) => one.id === request.id);
      if (before === undefined || !isDeepStrictEqual(before, request)) ctx.dispatch(session, { type: 'session/inputNeededSet', request });
    }
    for (const entry of was) {
      if (!now.some((one) => one.id === entry.id)) ctx.dispatch(session, { type: 'session/inputNeededRemoved', id: entry.id });
    }
  };

  return {
    statusOf, startedBy, chatSummary, movable, running, updateChatMovability, chatsReordered, subagentSummary, restoredSubagentSummary,
    chatCatalogOf, onChatSummaryChanged, syncSessionInputNeeded, inputNeededOf, changesetsAndMetaChanged, activeCount,
    activityOf, markSessionProvisional, sessionAdded, provisional: (uri: string) => provisionalSessionKeys.has(uri), materialized, failSessionCreationIfStillCreating,
    markSummaryDirty, flushPendingSessionSummaries, refreshSessionChangesSummary, removeNotifiedSummary, activeSessionsChanged, setAgentModels, publishAgentInfos, publishAccountInfo,
    listing, registerListedSession, announceSurfacedSession, liveRows, allRows, publishSurfacedSessions, unavailableProvider, readStored,
  };
}
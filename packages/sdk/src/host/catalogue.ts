import { ROOT, chatUriFor } from './channels.js';
import { accountKey } from './root.js';
import { SESSION_META_EXTERNAL_KEY, Status, idFor, idOf, normalizeTitle, uriFor } from '../sessions/catalog.js';
import { localPath, uriOf } from '../resources/fileuri.js';
import { isDeepStrictEqual } from 'node:util';
import { isWorkspaceless } from './lifecycle.js';
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

/** Why a move is refused: VS Code's reason, from its fixed set, and its words. */
export interface MoveRefusal {
  reason: string;
  message: string;
}

/**
 * The root's `showExternalSessions` values, `ChatExternalSessionsMode`'s five,
 * and the bounds each reads, VS Code's agent service's.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L204-L206
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L241
 */
const EXTERNAL_SESSIONS_MODES = ['none', 'recent', 'last24Hours', 'last7Days', 'last30Days'] as const;
type ExternalSessionsMode = typeof EXTERNAL_SESSIONS_MODES[number];
const DAY_MS = 24 * 60 * 60 * 1000;
const EXTERNAL_SESSION_MAX_AGE_MS = 30 * DAY_MS;
const RECENT_EXTERNAL_SESSION_LIMIT = 2;
const RECENT_LOCAL_SESSION_UPDATE_LIMIT = 2;

/** The session list and each row of it. */
export interface Catalogue {
  statusOf(uri: string): number;
  /** A chat's `ChatOrigin`: what it was made from, else `user`. */
  getChatOrigin(chat?: string): Bag;
  chatSummary(session: string, uri: string, chat: Session): Bag;
  /** Whether a chat, or a worker inside one of its calls, has a turn in progress. */
  hasActiveTurn(uri: string): boolean;
  /** Whether a chat is one a move is ever made of: moves on, a chat of its session's backend, not its default, resumable. */
  isStructurallyMovable(uri: string): boolean;
  /** Why a session refuses a move out of it or into it now: archived, or changing its workspace. */
  sessionMoveRefusal(session: string): MoveRefusal | undefined;
  /** Why a chat refuses its move now for its own state: no folder, or no turn yet. */
  chatMoveRefusal(uri: string, ownSession?: boolean): MoveRefusal | undefined;
  /** Whether a chat may be moved now: one a move is made of, refused by nothing, and running nothing. */
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
   * The summaries of the sessions this host is running, built now.
   *
   * The half of the answer that is never held, and rebuilt on every
   * `listSessions` because a live summary moves on its own and holding it
   * would make it a second behind.
   */
  getOverlaySessionSummaries(): Summary[];
  /** The whole catalogue as a client is handed it: the live summaries and the held ones. */
  listSessions(): Promise<Summary[]>;
  /** Tell every client what a refresh changed among the listed sessions: announced, updated, or retracted. */
  publishSurfacedSessions(before: Summary[], after: Summary[]): void;
  /** Whether a session is external: a backend's session made outside this host that no person's turn has adopted. */
  isExternal(uri: string): boolean;
  /** An external session made this host's own by a person's turn going out in it. */
  adoptExternalSession(uri: string): void;
  /** The external sessions the mode shows announced where no client holds them, and the ones it hides retracted. */
  reconcileExternalSessions(): Promise<void>;
  /** The provider a stored session recorded, where this host does not serve it. */
  unavailableProvider(id: string): string | undefined;
  readStored(): Promise<void>;
}

export function createCatalogue(ctx: HostContext): Catalogue {
  const {
    options, agents, sessions, subagents, owners, kept, names, wheres, births, moves, listedMeta,
    madeFrom, origins, leadOf, about, browsable, recordedChats, chatBackings, sessionHolding,
    restoredSessions, restoredSubagents,
  } = ctx;

  /**
   * What started a session, from the map this host reads or, for one it is not
   * holding, from the store that outlives it.
   *
   * A session a run made keeps its origin with the rest of its record, so a
   * recap after a restart answers as it did before one. What the store says is
   * put back into `origins`, so every later read here - a row, a chat's origin -
   * answers the same.
   */
  const originOf = (session: string): { kind: 'automation'; automation: string; run: string } | undefined => {
    const held = origins.get(session);
    if (held !== undefined) return held;
    const stored = kept.automationOrigin?.(idFor(session));
    if (stored !== undefined) origins.set(session, stored);
    return stored;
  };
  /**
   * The sessions external to this host, by URI: a backend's session made
   * outside it, listed or opened here, that no person's turn has adopted, as
   * VS Code's registry keeps a discovered session external.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostCatalogListReader.ts#L148
   */
  const externalSessions = new Set<string>();
  /**
   * The external sessions a client holds a row of, answered by a listing or
   * announced and not retracted since, as VS Code keeps the external sessions
   * it has broadcast: what a change of mode is measured against.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5825
   */
  const exposedExternalSessions = new Set<string>();
  /**
   * The `modifiedAt` each live external session was last reconciled at, so a
   * row that moved for anything else reconciles nothing, as VS Code keeps it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1541-L1548
   */
  const externalReconciliationModifiedAt = new Map<string, string>();
  /**
   * When the two most recently updated sessions of this host's own were
   * updated, newest first, as the first listing found them: what `recent` hides
   * an older external session behind, as VS Code reads the local updates it
   * kept when it starts.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1271-L1272
   */
  let recentLocalSessionUpdateSnapshot: number[] | undefined;
  /** What the last listing that hid a session logged, so a listing that hides the same says nothing again. */
  let lastHiddenSessionsLog: string | undefined;

  /**
   * How a chat came to exist: its `ChatOrigin`, as VS Code's host reads a
   * chat's origin.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L866
   *
   * `ChatOrigin` has four kinds - `user`, `fork`, `sideChat` and `tool`. A
   * chat made out of another says which, from `madeFrom`; every other chat
   * here, a session's default chat among them whoever started the session, is
   * `user`, as VS Code's host marks a session's default chat. Workers say
   * `tool` in their own rows.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L678-L692
   */
  const getChatOrigin = (chat?: string): Bag => (chat === undefined ? undefined : madeFrom.get(chat)) ?? { kind: 'user' };
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
    // The counts kept for the chat's own work, which its entry carries
    // whether or not its state is held, as VS Code's host keeps them on it.
    const changes = kept.chatChanges?.(idOf(session), uri);
    const counted = changes === undefined ? {} : { changes };
    const state = ctx.stateOf(uri);
    if (state !== undefined) return { ...summaryIn(state, uri), ...counted };
    const foreign = sessions.get(session)?.backends.get(uri);
    return {
      ...counted,
      resource: uri,
      origin: getChatOrigin(uri),
      // Its agent, where it is not its session's, as its state says it.
      ...(foreign === undefined ? {} : { provider: foreign.agent.provider }),
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
    ...(state.provider !== undefined ? { provider: state.provider } : {}),
    title: String(state.title ?? ''),
    status: Number(state.status ?? Status.Idle),
    modifiedAt: String(state.modifiedAt ?? ''),
    ...(state.activity !== undefined ? { activity: state.activity } : {}),
    interactivity: state.interactivity ?? 'full',
    ...(state.movable === true ? { movable: true } : {}),
  });

  /**
   * Whether a chat is one a move is ever made of, whatever its state.
   *
   * Moving chats has to be on, `chatMoves.enabled` in root config, as VS Code's
   * host offers a move only while a window has turned it on. The chat must be
   * one this host is running as a chat of a session, so a worker is never
   * movable on its own and neither is a conversation read back from a
   * transcript. It must not be the chat its session hands a client that names
   * none: the protocol says that one MUST NOT move, and a session whose default
   * left would have to answer a client naming no chat with a question.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L58-L67
   *
   * A move here starts the chat's backend again with `resume` set to the id
   * the backend kept the conversation under, so that backend must be able to
   * take it back by that id. A chat of another backend than the session's is
   * never one: a move starts it again on the destination's backend, which is a
   * harness that has never seen its transcript.
   */
  const isStructurallyMovable = (uri: string): boolean => {
    if (ctx.rootConfig['chatMoves.enabled'] !== true) return false;
    const held = sessions.get(sessionHolding(uri) ?? '');
    const chat = held === undefined ? undefined : held.chats.get(uri);
    if (held === undefined || chat === undefined) return false;
    if (held.backends.has(uri)) return false;
    if (held.defaultChat === uri) return false;
    const own = chat.agentId();
    if (own === undefined || own === '') return false;
    return chat.resumable?.() !== false;
  };

  /**
   * Why a session refuses a chat's move out of it or into it now, in VS Code's
   * reason and words, or nothing: it is archived, or its workspace is changing
   * (a move of its folders, asked for by its agent and made when the turn that
   * asked ends).
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9505-L9519
   */
  const sessionMoveRefusal = (session: string): MoveRefusal | undefined => {
    if ((kept.flags(idOf(session)) & Status.IsArchived) !== 0) return { reason: 'sessionArchived', message: `Session ${session} is archived.` };
    if (ctx.moving.has(session)) return { reason: 'sessionQuarantined', message: `Session ${session} is changing its workspace or can't run turns.` };
    return undefined;
  };

  /**
   * Why a chat refuses its move now for its own state, in VS Code's reason and
   * words, or nothing: it works in no folder or in a scratch folder a staying
   * chat shares, or it has no turn yet, so nothing of it exists beyond its
   * composer. Its turns are read off its held state and
   * off its backend, which holds the turns of a chat read back from its record
   * whether or not anybody holds the chat's state.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L8150-L8176
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9523-L9525
   */
  const chatMoveRefusal = (uri: string, ownSession = false): MoveRefusal | undefined => {
    const session = sessionHolding(uri);
    const held = sessions.get(session ?? '');
    const lead = held && leadOf(held);
    if ((lead?.workingDirectories() ?? []).length === 0) return { reason: 'workspaceless', message: `Chat ${uri} has no folder.` };
    /*
     * A chat of a workspace-less session works in the session's scratch
     * folder, which the session's default chat, staying where it is, works in
     * too, as VS Code refuses a chat whose scratch folder a staying chat uses.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L9526-L9528
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatMovability.ts#L314
     */
    if (session !== undefined && isWorkspaceless(session, ctx.dirOf(session))) {
      return { reason: 'workspaceless', message: `Chat ${uri} works in a scratch folder that another chat of ${session} also uses.` };
    }
    const state = ctx.stateOf(uri);
    const active = state?.activeTurn;
    const chat = held?.chats.get(uri);
    const started = (Array.isArray(state?.turns) && state.turns.length > 0) || (active !== undefined && active !== null)
      || (chat !== undefined && (chat.allTurns().length > 0 || (chat.status() & Status.InProgress) !== 0));
    if (!started) {
      return { reason: 'notStarted', message: `Chat ${uri} has no turns yet; send a message before moving it${ownSession ? ' to its own session' : ''}.` };
    }
    return undefined;
  };

  /**
   * Whether a chat may be moved now, which is what a client offers a control
   * for: it is one a move is made of, and nothing about it or its own session
   * would refuse its move, as VS Code's host decides `movable`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agentHostChatMove.ts#L69-L83
   *
   * And nothing may be running in it: a move here closes a process and starts
   * another, and the one moment that costs nothing is between turns, as plan
   * host/47-p1 decided (Softov, 2026-10-03: "Not during a turn").
   */
  const movable = (uri: string): boolean => {
    const session = sessionHolding(uri);
    return session !== undefined && isStructurallyMovable(uri) && sessionMoveRefusal(session) === undefined
      && chatMoveRefusal(uri) === undefined && !hasActiveTurn(uri);
  };

  /**
   * Whether a chat, or any worker chat beneath it, has an active turn, as VS
   * Code's host names a turn in progress.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L575-L583
   *
   * Asked of a chat's backend, which is the one doing the work, of the chat's
   * held state, which holds a turn from its start, and of a worker's held
   * state, which is the whole of what a worker is. Walked to the bottom
   * because a worker's own call can open another one, and a move carries all
   * of them: a chat whose worker is mid-turn is a chat with something in
   * flight.
   */
  const hasActiveTurn = (uri: string): boolean => {
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
   * Publish a chat's current eligibility to move, where it differs from what
   * the chat's held state says, else what its row in its session's held state
   * says, absent read as `false`, as VS Code's movability update publishes it
   * through `setChatMovable`: `chat/movableChanged` on the chat where its state
   * is held, and `session/chatUpdated` on the session for its row. A chat whose
   * answer neither holds has its rows built from the answer as they are read.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChatMovability.ts#L251-L258
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2147-L2160
   *
   * Called at the moments the answer can change: a turn starting or ending, a
   * worker's starting or ending, the default chat moving to another, its
   * session archived or unarchived, and its session's workspace move asked for
   * or made.
   */
  const updateChatMovability = (uri: string): void => {
    const session = sessionHolding(uri);
    const held = session === undefined ? undefined : sessions.get(session);
    if (session === undefined || held === undefined || !held.chats.has(uri)) return;
    const now = movable(uri);
    const listed = (): Bag | undefined => (Array.isArray(ctx.stateOf(session)?.chats) ? ctx.stateOf(session)?.chats as Bag[] : [])
      .find((one) => one.resource === uri);
    const state = ctx.stateOf(uri);
    if (((state?.movable ?? listed()?.movable ?? false) === true) === now) return;
    if (state !== undefined) ctx.dispatch(uri, { type: 'chat/movableChanged', movable: now });
    // The row, which the chat's own action may have moved already.
    const row = listed();
    if (row !== undefined && (row.movable === true) !== now) ctx.dispatch(session, { type: 'session/chatUpdated', chat: uri, changes: { movable: now } });
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
    const read = held.agent.subagents === undefined || !restoredSessions.has(uri)
      ? []
      : await restoredSubagents(idOf(uri), held.agent, lead.allTurns() as unknown as WireTurn<Turn>[]);
    ctx.dispatch(uri, {
      type: 'session/chatsReordered',
      chats: [
        ...held.chats.keys(),
        ...[...subagents].filter(([, one]) => one.session === uri).map(([one]) => one),
        ...read.map((one) => ctx.mintSubagentChatUri(uri, held.defaultChat, String(one.toolCallId ?? '')))
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
   * `modifiedAt`: the moment the record says its session last moved. Read
   * unless this host kept its bits, as VS Code's host restores a worker read
   * where nothing says otherwise.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1824-L1828
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
    status: Status.Idle | (kept.chatFlags(idOf(session), uri) || Status.IsRead),
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
   * One session's chats as its summary carries them, as VS Code's host
   * projects a session's chats into its summary: every chat but a worker,
   * which a tool call spawned and a client draws under that call, each with
   * its title, origin, agent, interactivity, status, the `archived` an AHP 0.9
   * client reads off an archived chat, and its changes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L682-L700
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L2077-L2080
   *
   * `SessionChatSummary` is the protocol's compact chat, what a client draws a
   * session's chats from without subscribing to any of them, and it carries
   * neither of a `ChatSummary`'s `activity` and `modifiedAt`.
   */
  const toSessionSummaryChats = (chats: Bag[]): SummaryChat[] => chats
    .filter((chat) => (chat.origin as Bag | undefined)?.kind !== 'tool')
    .map((chat) => ({
      resource: String(chat.resource),
      title: String(chat.title),
      ...(chat.origin !== undefined ? { origin: chat.origin as Record<string, unknown> } : {}),
      ...(chat.provider !== undefined ? { provider: String(chat.provider) } : {}),
      ...(chat.interactivity !== undefined ? { interactivity: String(chat.interactivity) } : {}),
      ...(chat.status !== undefined ? { status: Number(chat.status) } : {}),
      ...((Number(chat.status ?? 0) & Status.IsArchived) !== 0 ? { archived: true } : {}),
      ...(chat.changes !== undefined ? { changes: chat.changes as ChangesSummary } : {}),
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
    return (aggregateChatSummaries(held).status ?? Status.Idle) | kept.flags(idOf(uri));
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
   * A session's chats aggregated into its own summary fields, as VS Code's
   * host aggregates a session's chat catalog: the status and the activity of
   * the chat that drives the session, and the latest change across its chats.
   *
   * A chat that needs input makes the session need input; else a chat that
   * runs makes it run; else the activity bits are the default chat's, or the
   * most recently modified chat's when it has none, and a failed chat stays on
   * its own row. `InputNeeded` carries `InProgress`, so a chat that runs is one
   * whose bits under `InputNeeded` are `InProgress` alone. The activity is the
   * driving chat's. A worker chat is a chat of the session and counts. A
   * session with no chat aggregates to nothing, and a chat whose state names
   * no change adds none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3339-L3367
   */
  const aggregateChatSummaries = (held: Held): { status?: number; activity?: string; modifiedAt?: number } => {
    const chats = chatsOf(held);
    const base = chats.find((one) => one.uri === held.defaultChat)
      ?? [...chats].sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt))[0];
    if (base === undefined) return {};
    const inputChat = chats.find((one) => (one.status & Status.InputNeeded) === Status.InputNeeded);
    const inProgressChat = chats.find((one) => (one.status & Status.InputNeeded) === Status.InProgress);
    const driver = inputChat ?? inProgressChat ?? base;
    const status = inputChat !== undefined ? Status.InputNeeded : inProgressChat !== undefined ? Status.InProgress : activityBits(base.status);
    const times = chats.map((one) => Date.parse(one.modifiedAt)).filter(Number.isFinite);
    return {
      status,
      ...(driver.activity !== undefined ? { activity: driver.activity } : {}),
      ...(times.length > 0 ? { modifiedAt: Math.max(...times) } : {}),
    };
  };
  /**
   * A session's last change: its chats' latest, rolled into the session's own
   * where it is later, as VS Code's host rolls the aggregate's `modifiedAt`
   * into the session's catalogue timestamp. A row's `modifiedAt` moves
   * forward only, so a chat that goes takes nothing back with it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3325-L3332
   */
  const modifiedOf = (held: Held): string => {
    const latest = aggregateChatSummaries(held).modifiedAt;
    const current = Date.parse(held.modifiedAt);
    if (latest !== undefined && (!Number.isFinite(current) || latest > current)) held.modifiedAt = new Date(latest).toISOString();
    return held.modifiedAt;
  };
  /** What a session is doing: the activity of the chat that drives it. */
  const activityOf = (held: Held): string | undefined => aggregateChatSummaries(held).activity;

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
   * Which of the two counts a session's row carries, as VS Code's host decides
   * its summary changeset kind: a session that works in a tree of its own is
   * counted by its branch, and one in a folder somebody chose is counted by
   * its own checkpoints.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetSummary.ts#L11-L15
   *
   * Read from the worktree record, the value that outlives a restart: the
   * record is written where the tree is made, and the config that asked for
   * one is said to a session while it runs.
   */
  const getSummaryChangesetKind = (uri: string): 'branch' | 'session' =>
    (ctx.worktreeOf(uri) === undefined ? 'session' : 'branch');
  /**
   * The diff stat a catalogue row carries, which a session's own state does
   * not: the session's own counts, as this host last read and kept them, and
   * none for a session it has read none for, as VS Code's host sets a row's
   * changes from the session's own changesets and its recorded summary alone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L480-L493
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1269-L1272
   *
   * A row is built synchronously and reading the session's own takes git, so
   * what goes in a row is what was read the last time the counts moved.
   */
  const changesOf = (uri: string): Bag => {
    const read = kept.changes(idOf(uri));
    return read?.files ? { changes: read } : {};
  };
  /**
   * A running session's catalogue row: the summary fields of the state the
   * session holds, with the ones only a row carries, as VS Code's host
   * projects a session's summary for its addition, its changes and a listing
   * alike.
   *
   * The session's state is what its row mirrors, so a row and the session it
   * opens are one answer. `status`, `activity` and `modifiedAt` are what the
   * session's chats decide, by the protocol's rules for a session made of
   * chats; `createdAt` and `changes` are the row's own.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L660-L680
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
      chats: toSessionSummaryChats(Array.isArray(state.chats) ? state.chats as Bag[] : []),
      ...(state.defaultChat !== undefined ? { defaultChat: state.defaultChat } : {}),
      // The automation run that started it, which a client groups the session
      // under from the row it is added with.
      ...(originOf(uri) !== undefined ? { origin: originOf(uri) } : {}),
      ...(state.annotations !== undefined ? { annotations: state.annotations } : {}),
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
    externalSessions.delete(uri);
    exposedExternalSessions.delete(uri);
    externalReconciliationModifiedAt.delete(uri);
  };
  /**
   * A row the mode no longer shows, taken back from every client while its
   * session stays, as VS Code retracts a surfaced session: what was sent for
   * it is dropped, so it is announced whole if the mode shows it again.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1442-L1455
   */
  const retractSurfacedSession = (uri: string): void => {
    lastNotified.delete(uri);
    dirty.delete(uri);
    marked.delete(uri);
    exposedExternalSessions.delete(uri);
    ctx.broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, session: uri });
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
   * stat goes with it, which costs no process to read: the session's own, as
   * `refreshSessionChangesSummary` last read it.
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
    const fields = rowOf(uri);
    /*
     * A live external session that moved under `recent` reconciles what the
     * mode shows, since the two it shows are the two updated last, as VS Code
     * reconciles on an external session's `modifiedAt`.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1541-L1548
     */
    const modifiedAt = typeof fields.modifiedAt === 'string' ? fields.modifiedAt : undefined;
    if (externalSessions.has(uri) && modifiedAt !== undefined && getExternalSessionsMode() === 'recent'
      && externalReconciliationModifiedAt.get(uri) !== modifiedAt) {
      externalReconciliationModifiedAt.set(uri, modifiedAt);
      void reconcileExternalSessions();
    }
    const row = JSON.stringify(fields);
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
    // An external session no client holds a row of has nothing to change, as
    // VS Code emits nothing for a summary it has not published.
    if (externalSessions.has(uri) && !exposedExternalSessions.has(uri)) return;
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
   * A chat's counts, kept and said, as VS Code's changeset service sets a
   * listed chat's aggregate: a chat with none yet whose work changed nothing
   * is told nothing, and the same counts are not said twice. Said by
   * `session/chatUpdated` where the session's state is held, and on the
   * session's summary, whose chats carry them, for the list.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L1810-L1828
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L2564-L2578
   */
  const setChatChangesSummary = (session: string, chat: string, changes: ChangesSummary): void => {
    // A store that keeps no chat's counts leaves every chat's entry with none.
    if (kept.setChatChanges === undefined) return;
    const id = idOf(session);
    const current = kept.chatChanges?.(id, chat);
    if (current === undefined && (changes.files ?? 0) === 0) return;
    if (isDeepStrictEqual(current, changes)) return;
    kept.setChatChanges(id, chat, changes);
    if (ctx.stateOf(session) !== undefined) ctx.dispatch(session, { type: 'session/chatUpdated', chat, changes: { changes } });
    markSummaryDirty(session);
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
   *
   * Each of its chats' counts are read in the same pass, as VS Code's changeset
   * service sets each listed chat's aggregate where the session's moves: the
   * default chat's the session's own work, read again here where the row
   * carries its branch's, and any other chat's the edits tracked in its own
   * turns. A worker carries none.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L1724-L1808
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostChangesetService.ts#L2194-L2200
   */
  const computingChangesSummaries = new Set<string>();
  const queuedChangesSummaries = new Map<string, boolean>();
  const refreshSessionChangesSummary = async (uri: string, running = false): Promise<void> => {
    if (ctx.dirOf(uri) === undefined) return;
    if (computingChangesSummaries.has(uri)) {
      queuedChangesSummaries.set(uri, running);
      return;
    }
    computingChangesSummaries.add(uri);
    let whileRunning = running;
    try {
      for (;;) {
        queuedChangesSummaries.delete(uri);
        /*
         * The folder as it is now, read again on every pass: a session moves
         * into its worktree while its first read may still be running, and a
         * pass queued behind that read is the one asked for the new folder. A
         * folder read once on entry counted the old one on every pass after.
         */
        const dir = ctx.dirOf(uri);
        if (dir === undefined) return;
        const source = options.changes;
        const branch = getSummaryChangesetKind(uri) === 'branch';
        let read: ChangesSummary | undefined;
        try {
          const tree = ctx.worktreeOf(uri);
          read = branch
            ? await source?.branchSummary?.(dir, tree?.commit ?? tree?.base)
            : await source?.sessionSummary?.(dir, idOf(uri), whileRunning);
        }
        catch { /* a count that could not be read is the count that was there */ }
        if (read !== undefined && (sessions.has(uri) || ctx.respawning.has(uri))) {
          kept.setChanges(idOf(uri), read);
          markSummaryDirty(uri);
        }
        const held = sessions.get(uri);
        for (const chat of held?.chats.keys() ?? []) {
          let own: ChangesSummary | undefined;
          if (chat === held?.defaultChat) {
            own = branch ? undefined : read;
            if (branch) {
              try { own = await source?.sessionSummary?.(dir, idOf(uri), whileRunning); }
              catch { /* a count that could not be read is the count that was there */ }
            }
          }
          else {
            // The chat's turns as its state holds them, the one running last.
            const state = ctx.stateOf(chat);
            const active = state?.activeTurn;
            const turns = [...(Array.isArray(state?.turns) ? state.turns as Bag[] : []), ...(typeof active === 'object' && active !== null ? [active as Bag] : [])];
            own = source?.chatSummary?.(uri, turns.map((turn) => String(turn.id ?? '')));
          }
          if (own !== undefined && sessions.has(uri)) setChatChangesSummary(uri, chat, own);
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
    ctx.log.debug(`${owner.provider}: ${found.length} model(s): ${found.map((m) => m.id).join(', ')}`);
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
   * see it is per connection, in `projectActionForClient`.
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
    const stored = new Set(kept.sessions());
    for (const id of stored) {
      const backendId = ctx.sessionBackendId(id);
      if (backendId === id || offered.has(id) || claimed.has(id)) continue;
      const both = offered.get(backendId);
      if (both !== undefined) offered.set(id, both.map(({ agent, row }) => ({ agent, row: { ...row, id } })));
    }
    for (const id of offered.keys()) recordedChats(id);
    for (const own of chatBackings()) claimed.add(own);
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
    for (const own of chatBackings()) claimed.add(own);
    const strays = unread.filter(([id]) => !claimed.has(id));
    const looked = await Promise.all(strays.map(async ([id, folder]) => {
      const recorded = kept.provider(id);
      const asked = [...agents.values()].filter((agent) => agent.find !== undefined);
      const order = recorded === undefined
        ? asked
        : [...asked.filter((agent) => agent.provider === recorded), ...asked.filter((agent) => agent.provider !== recorded)];
      for (const agent of order) {
        const row = await agent.find?.(ctx.sessionBackendId(id), { workingDirectory: folder }).catch(() => undefined);
        if (row !== undefined) return { agent, row: { ...row, id } };
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
    // Read again now: a session made while the backends were listing was
    // recorded after `claimed` was read, and is running.
    const servedNow = registeredAndBackingIds();
    const gone = (id: string): boolean => {
      if (claimed.has(id) || servedNow.has(id) || offered.has(id) || kept.nested?.(id) !== undefined)
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
   * a record that keeps none of the session's, and else its first turn's
   * message, normalized as VS Code's host seeds a title from a first message:
   * empty where that turn says nothing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionTitleController.ts#L189-L199
   *
   * Its dates are its first turn's start and its last turn's end, which is
   * where the protocol's reducer moves a chat when a turn completes. A turn
   * that names no start adds nothing to them, and a row with no start at all
   * dates from the epoch, as a transcript entry with no time does.
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
      : name === undefined ? undefined : kept.chatTitle(id, ctx.defaultChatFor(name));
    const message = (first ?? turns[0])?.message;
    const said = typeof message === 'object' && message !== null ? (message as { text?: unknown }).text : undefined;
    const epoch = new Date(0).toISOString();
    return {
      id,
      title: named ?? normalizeTitle(typeof said === 'string' ? said : ''),
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
    /*
     * External where this host never ran the session, which is a session with
     * no provider recorded, since running one is what records it, and where the
     * store says it opened one that nobody adopted, as VS Code registers a
     * discovered session external and a session it made not.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L10687
     */
    if (kept.external?.(row.id) ?? kept.provider(row.id) === undefined) externalSessions.add(resource);
    else externalSessions.delete(resource);
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
      ...storedChatsOf(row.id, row.title),
      ...changesOf(resource),
      ...ctx.describes(resource),
    };
  };
  /**
   * The chats a session nothing runs lists, from its record, as a running
   * session's row lists them.
   *
   * A stopped session has its nested chats in its record alone, and its row is
   * where a client finds a chat's link without starting the session. Read on
   * each answer, so an archive or a rename shows on the next listing. A chat
   * with no state is idle with its own bits, read where it has none, as a
   * running session's chat with no state reads. The default chat carries the
   * session's title, as it does on a running row.
   */
  const storedChatsOf = (id: string, title: string): { chats?: SummaryChat[]; defaultChat?: string } => {
    const recorded = recordedChats(id);
    const defaultChat = recorded.find((chat) => chat.default === true)?.uri;
    const chats = toSessionSummaryChats(recorded.map((chat) => ({
      resource: chat.uri,
      title: chat.uri === defaultChat ? title : chat.title ?? kept.chatTitle(id, chat.uri) ?? '',
      ...(chat.origin !== undefined ? { origin: chat.origin } : {}),
      ...(chat.provider !== undefined ? { provider: chat.provider } : {}),
      status: Status.Idle | (kept.chatFlags(id, chat.uri) || Status.IsRead),
    })));
    return {
      ...(chats.length > 0 ? { chats } : {}),
      ...(defaultChat !== undefined ? { defaultChat } : {}),
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
   *
   * An external row the mode does not show is announced to nobody, and one it
   * shows is one a client now holds, as VS Code asks its mode before it
   * announces a surfaced session and keeps the external ones it broadcast.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6053-L6086
   */
  const announceSurfacedSession = (summary: Summary): void => {
    if (readSessionExternal(summary)) {
      if (!shouldIncludeSession(summary, getExternalSessionsMode(), Date.now())) return;
      exposedExternalSessions.add(summary.resource);
    }
    const { resource, provider: _provider, createdAt: _createdAt, ...mutable } = summary as unknown as Bag;
    lastNotified.set(String(resource), mutable);
    ctx.broadcast(ROOT, 'root/sessionAdded', { channel: ROOT, summary });
  };

  /**
   * The summaries of the sessions this host is running, built now, on each
   * answer, each the one `summaryOf` projects, as VS Code's host overlays its
   * live sessions' summaries on a listing.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1004-L1026
   *
   * A live summary changes every second and building one reads a handful of
   * in-memory objects, while a listed one costs a pass over every transcript
   * on the machine. The held catalogue keeps the expensive half and this is
   * built for each answer, so a session somebody is looking at is current. A
   * session not yet announced is listed to nobody, as VS Code's host lists no
   * idle provisional session.
   */
  const getOverlaySessionSummaries = (): Summary[] => [...sessions.keys()]
    .filter((uri) => !provisionalSessionKeys.has(uri))
    .flatMap((uri) => {
      const summary = summaryOf(uri);
      return summary === undefined ? [] : [summary as unknown as Summary];
    });

  /**
   * Every session summary, as one list: the running sessions' now and the held
   * ones behind them, as VS Code's host computes its sessions with the live
   * ones overlaid.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5137
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5487-L5538
   *
   * A session this host is running is dropped out of the held summaries by its
   * id, since it is in the first half and a session listed twice is one a
   * client has to reconcile, and so is one not yet announced.
   */
  const computeSessions = async (): Promise<Summary[]> => {
    const running = getOverlaySessionSummaries();
    const claimed = new Set([...running.map((summary) => idFor(summary.resource)), ...[...provisionalSessionKeys].map(idFor)]);
    const listed = await ctx.listedSessions();
    return [...running, ...listed.filter((summary) => !claimed.has(idFor(summary.resource))).map(getSurfacedSessionSummary)];
  };
  /**
   * Every session summary a client is handed: the sessions the mode shows, most
   * recently modified first, as VS Code's host lists its sessions, which are
   * the rows the client then holds.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5539-L5555
   *
   * One answer for the `listSessions` command, which pages over it, and the
   * `list_sessions` tool.
   */
  const listSessions = async (): Promise<Summary[]> => {
    const combined = await computeSessions();
    const mode = getExternalSessionsMode();
    const now = Date.now();
    const recentSessionKeys = mode === 'recent' ? getRecentSessionKeys(combined, now) : undefined;
    const visible = combined.filter((row) => shouldIncludeSession(row, mode, now, recentSessionKeys));
    logHiddenSessions(combined.length - visible.length, combined.length, mode);
    for (const row of visible) if (readSessionExternal(row)) exposedExternalSessions.add(row.resource);
    // The protocol says a server SHOULD order them most-recently-modified
    // first, and a client that has to sort a list it was handed is a client
    // doing the server's job.
    return visible.sort((a_, b_) => b_.modifiedAt.localeCompare(a_.modifiedAt));
  };
  /**
   * Which external sessions a listing shows, by the root's
   * `showExternalSessions`: one of its five values, and `none`, its default,
   * for anything else, as VS Code's agent service reads it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5656-L5662
   */
  const getExternalSessionsMode = (): ExternalSessionsMode =>
    EXTERNAL_SESSIONS_MODES.find((mode) => mode === ctx.rootConfig.showExternalSessions) ?? 'none';
  /** Whether a row is an external session's, read off its `_meta`, as VS Code reads one. */
  const readSessionExternal = (row: Summary): boolean =>
    ((row as unknown as Bag)._meta as Bag | undefined)?.[SESSION_META_EXTERNAL_KEY] === true;
  /**
   * Whether a listing shows a row: every session this host made, and an
   * external one by the mode and the time it was last updated, as VS Code's
   * agent service decides.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5764-L5791
   */
  const shouldIncludeSession = (row: Summary, mode: ExternalSessionsMode, now: number, recentSessionKeys?: ReadonlySet<string>): boolean => {
    if (!readSessionExternal(row)) return true;
    const modifiedTime = Date.parse(row.modifiedAt);
    switch (mode) {
      case 'recent':
        return modifiedTime >= now - 7 * DAY_MS && (recentSessionKeys === undefined || recentSessionKeys.has(row.resource));
      case 'last24Hours':
        return modifiedTime >= now - DAY_MS;
      case 'last7Days':
        return modifiedTime >= now - 7 * DAY_MS;
      case 'last30Days':
        return modifiedTime >= now - EXTERNAL_SESSION_MAX_AGE_MS;
      case 'none':
        return false;
    }
  };
  /**
   * The external sessions `recent` shows: the two updated most recently, in
   * the last seven days and no earlier than the second most recent update of
   * a session of this host's own, as VS Code's agent service picks them.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5681-L5703
   */
  const getRecentSessionKeys = (rows: readonly Summary[], now: number): ReadonlySet<string> => {
    const supersededBefore = recentLocalSessionUpdateSnapshot?.[RECENT_LOCAL_SESSION_UPDATE_LIMIT - 1] ?? now - 7 * DAY_MS;
    return new Set(rows
      .filter((row) => readSessionExternal(row)
        && Date.parse(row.modifiedAt) >= now - 7 * DAY_MS
        && Date.parse(row.modifiedAt) >= supersededBefore)
      .sort((a, b) => Date.parse(b.modifiedAt) - Date.parse(a.modifiedAt) || (a.resource < b.resource ? -1 : a.resource > b.resource ? 1 : 0))
      .slice(0, RECENT_EXTERNAL_SESSION_LIMIT)
      .map((row) => row.resource));
  };
  /**
   * A line in the log where a listing hid sessions, and once for each count
   * and mode, as VS Code's agent service says it, so a session the mode keeps
   * out reads differently from one nothing found.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5645-L5654
   */
  const logHiddenSessions = (hidden: number, total: number, mode: ExternalSessionsMode): void => {
    const signature = `${hidden}/${total}/${mode}`;
    if (signature === lastHiddenSessionsLog) return;
    lastHiddenSessionsLog = signature;
    if (hidden > 0) ctx.log.debug(`listSessions hid ${hidden} of ${total} session(s) (showExternalSessions: '${mode}')`);
  };
  /**
   * The external sessions the mode shows announced where no client holds them,
   * and the ones it hides retracted where one does, as VS Code reconciles its
   * listing after a change of mode or an adoption.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5946-L6019
   */
  const reconcileExternalSessions = async (): Promise<void> => {
    const combined = await computeSessions();
    const mode = getExternalSessionsMode();
    const now = Date.now();
    const recentSessionKeys = mode === 'recent' ? getRecentSessionKeys(combined, now) : undefined;
    for (const row of combined) {
      if (!readSessionExternal(row)) continue;
      const shown = shouldIncludeSession(row, mode, now, recentSessionKeys);
      const exposed = exposedExternalSessions.has(row.resource);
      if (shown && !exposed) announceSurfacedSession(row);
      else if (!shown && exposed) retractSurfacedSession(row.resource);
    }
  };
  /**
   * An external session made this host's own by a person's turn going out in
   * it, as VS Code's host adopts one on its first outgoing user turn: no
   * longer external, so every mode shows it, its state and its row said
   * without the mark, the row announced where no client held it, and what the
   * mode shows reconciled, since `recent` counts the external sessions left.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/externalSessionAdoption/externalSessionAdoptionContribution.ts#L25-L30
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L1471-L1481
   */
  const adoptExternalSession = (uri: string): void => {
    if (!externalSessions.delete(uri)) return;
    kept.setExternal?.(idFor(uri), false);
    externalReconciliationModifiedAt.delete(uri);
    const exposed = exposedExternalSessions.delete(uri);
    if (sessions.has(uri)) {
      changesetsAndMetaChanged(uri);
      if (exposed) markSummaryDirty(uri);
      else sessionAdded(uri);
    }
    void reconcileExternalSessions();
  };
  /**
   * A held listed session's summary with what this host knows about it read
   * again, as VS Code's host keeps a surfaced session's summary current with
   * its flags and its metadata.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L650-L653
   *
   * What a backend said about a session is held, because learning it cost a
   * pass over every transcript on the machine. What this host knows about it is
   * not held and not asked for either: a session a client marked read, and the
   * counts and facts of a directory read since, move on their own and cost
   * nothing to read.
   *
   * Read here, as the answer is made, so a client that marked a session and
   * listed again is handed the flag it has just set, and the list it holds
   * agrees with the notification that told it about the change.
   */
  const getSurfacedSessionSummary = (row: Summary): Summary => {
    const started = originOf(row.resource);
    return {
      resource: row.resource,
      provider: row.provider,
      title: row.title,
      createdAt: row.createdAt,
      modifiedAt: row.modifiedAt,
      workingDirectories: row.workingDirectories,
      // Nothing this host started is running yet, so activity is idle and the
      // only bits set are this host's own and the client's.
      status: Status.Idle | kept.flags(idFor(row.resource)),
      ...(started === undefined ? {} : { origin: started }),
      ...storedChatsOf(idFor(row.resource), row.title),
      ...changesOf(row.resource),
      ...ctx.describes(row.resource),
    };
  };

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
   *
   * An external session is said only while the mode shows it: announced as it
   * comes into view, retracted as it leaves, and nothing said of one no client
   * was shown, as VS Code announces the external sessions its mode includes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L6053-L6086
   */
  const publishSurfacedSessions = (before: Summary[], after: Summary[]): void => {
    // The updates `recent` cuts at, as the first listing finds them.
    recentLocalSessionUpdateSnapshot ??= after
      .filter((row) => !readSessionExternal(row))
      .map((row) => Date.parse(row.modifiedAt))
      .filter(Number.isFinite)
      .sort((a, b) => b - a)
      .slice(0, RECENT_LOCAL_SESSION_UPDATE_LIMIT);
    /*
     * Nothing is said on the first fill.
     *
     * A host that has answered nobody has told nobody, so a listing's whole
     * contents are not an addition to an empty catalogue - and every client
     * connected while this was read gets its catalogue from the answer to its
     * own `listSessions`.
     */
    if (before.length === 0) return;
    const mode = getExternalSessionsMode();
    const now = Date.now();
    const recentSessionKeys = mode === 'recent' ? getRecentSessionKeys([...getOverlaySessionSummaries(), ...after], now) : undefined;
    const was = new Map(before.map((row) => [row.resource, row]));
    for (const row of after) {
      const had = was.get(row.resource);
      was.delete(row.resource);
      if (sessions.has(row.resource))
        continue;
      if (readSessionExternal(row)) {
        const exposed = exposedExternalSessions.has(row.resource);
        if (!shouldIncludeSession(row, mode, now, recentSessionKeys)) {
          if (exposed) retractSurfacedSession(row.resource);
          continue;
        }
        if (!exposed) {
          announceSurfacedSession(row);
          continue;
        }
      }
      else if (had === undefined) {
        announceSurfacedSession(row);
        continue;
      }
      if (had === undefined || !surfacedSessionChanged(had, row)) continue;
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
    for (const [resource, row] of was) {
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
      // An external session no client was shown goes without a word.
      const told = !readSessionExternal(row) || exposedExternalSessions.has(resource);
      removeNotifiedSummary(resource);
      if (told) ctx.broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, session: resource });
    }
  };
  /**
   * Whether a listed row says anything a client does not already hold: its
   * title, its last change, its project, its folders, its `_meta` or its
   * origin, the fields VS Code's host compares before it says a surfaced
   * session's metadata moved. `resource`, `provider` and `createdAt` say who
   * the row is, and its status and its counts are said where they move.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1346-L1364
   */
  const surfacedSessionChanged = (was: Summary, now: Summary): boolean => {
    // `project` and `_meta` are spread onto a row by the module that owns
    // them, and `Summary` declares neither.
    const before = was as unknown as Bag;
    const after = now as unknown as Bag;
    return was.title !== now.title
      || was.modifiedAt !== now.modifiedAt
      || !isDeepStrictEqual(before.project, after.project)
      || !isDeepStrictEqual(was.workingDirectories ?? [], now.workingDirectories ?? [])
      || !isDeepStrictEqual(before._meta, after._meta)
      || !isDeepStrictEqual(was.origin, now.origin);
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
   * Every stored session's directory that `browsable()` leaves out, read once,
   * so a listed row's `_meta` carries its folder's git and GitHub facts as a
   * row in a served folder does: only `browsable()` is read at startup, and a
   * session kept in any other directory would list with none until a turn of
   * it ended. One directory at a time, since a host with many stored sessions
   * would otherwise start by running every one's `git` at once; a directory
   * that fails to read is skipped.
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
    for (const dir_ of dirs) await ctx.readFacts(dir_);
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
        // The read and archived bits, which VS Code's host calls a status's meta flags.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostStateManager.ts#L3374-L3377
        const metaFlags = (status: unknown): number => Number(status ?? 0) & ~(Status.IsRead - 1);
        const now = metaFlags(own.status);
        if (now !== metaFlags(row.status)) {
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
    statusOf, getChatOrigin, chatSummary, isStructurallyMovable, sessionMoveRefusal, chatMoveRefusal, movable, hasActiveTurn, updateChatMovability,
    chatsReordered, subagentSummary, restoredSubagentSummary,
    chatCatalogOf, onChatSummaryChanged, syncSessionInputNeeded, inputNeededOf, changesetsAndMetaChanged, activeCount,
    activityOf, markSessionProvisional, sessionAdded, provisional: (uri: string) => provisionalSessionKeys.has(uri), materialized, failSessionCreationIfStillCreating,
    markSummaryDirty, flushPendingSessionSummaries, refreshSessionChangesSummary, removeNotifiedSummary, activeSessionsChanged, setAgentModels, publishAgentInfos, publishAccountInfo,
    listing, registerListedSession, announceSurfacedSession, getOverlaySessionSummaries, listSessions, publishSurfacedSessions, unavailableProvider, readStored,
    isExternal: (uri: string) => externalSessions.has(uri), adoptExternalSession, reconcileExternalSessions,
  };
}
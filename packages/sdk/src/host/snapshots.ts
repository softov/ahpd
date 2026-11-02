import { Status, idOf } from '../sessions/catalog.js';
import { windowOf } from '../sessions/paging.js';
import { RpcError } from '../rpc.js';
import { uriOf } from '../resources/fileuri.js';
import { runState } from './automations.js';
import { ROOT, isRootChannel, isAutomations, automationOwner, queryOf, MARKS, chatUriFor, servedIn, schemeOf, spaceOf, subagentChatUri, toolCallOfSubagentChat } from './channels.js';
import { ownerFilter } from '../utils/values.js';
import { need } from './common.js';
import type { Bag } from '../types/common.js';
import type { Connection } from '../types/host.js';
import type { WireTurn } from '../types/wire.js';
import type { HostContext } from './context.js';
import type { HeldState } from './state.js';
import type { SubscribeView, Turn } from '@microsoft/agent-host-protocol';

/** What a subscribe is answered with, and the state a session or chat channel opens with. */
export interface Snapshots {
  value(snapshot: Record<string, unknown>): Record<string, unknown>;
  snapshotOf(channel: string, mine?: Record<string, unknown>, connection?: Connection, view?: SubscribeView): Promise<Record<string, unknown>>;
  /**
   * The state a running session's channel opens with: what its default chat's
   * backend says, with what this host keeps beside it. Read once, when the
   * channel opens; every change after it is an action.
   */
  sessionSeed(uri: string): Bag;
  /**
   * The state a running chat's channel opens with: what its backend holds,
   * with what this host keeps beside it. Read once, when the backend starts
   * the chat; every change after it is an action.
   */
  chatSeed(session: string, chatUri: string): Bag;
  /**
   * A running session's held state, opened from `sessionSeed` the first time
   * anything reads it, or nothing for a session this host is not running.
   */
  sessionStateOf(uri: string): Bag | undefined;
}

export function createSnapshots(ctx: HostContext): Snapshots {
  const {
    options, sessions, subagents, byChat, owners, decided, wheres, moves, drafts, terminals,
    kept, watches, marksOf, resumedSessions, activeClientsOf,
    about, leadOf,
    LOGS, TRACES, METRICS,
    heldAs, nameOf, sessionOfChat, sessionChannel, sessionFor,
    relayed,
    changesetAt, operationsOf, shown, changesetsOf,
    readFacts, startWatchingDir, describes,
    mergedConfig, sessionSchema, storedConfig,
    waitingFor, startedBy, chatCatalogOf, movable, restoredSubagentSummary, activityOf,
    past, restoredSubagents, restoredParentChat, linkedTurns, titles,
    recordedChats, recordedChat, homeId,
  } = ctx;

  /**
   * A snapshot is a value, not a view of one.
   *
   * The state a snapshot carries is built out of the host's own live objects
   * and the response carrying it is serialised after this function returns,
   * not inside it. Handed back by reference it is a promise about the present
   * kept in the future: the client receives whatever those objects had become
   * by the time the socket got to them, under a `fromSeq` naming the moment
   * they were read.
   *
   * `structuredClone` rather than a JSON round-trip, because a key that is
   * present and undefined is not the same as an absent one here - `usage` is
   * required and means "not measured" - and JSON cannot tell those apart.
   *
   * The delta window is emptied first and `fromSeq` read after it, for a
   * channel this host serves from its own reads: a delta held while the read
   * was out is already in what the backend answered, so it has to sit at or
   * below `fromSeq`.
   */
  const value = (snapshot: Record<string, unknown>): Record<string, unknown> => {
    ctx.flushDeltas();
    return structuredClone('fromSeq' in snapshot
      ? { ...snapshot, fromSeq: ctx.serverSeq }
      : snapshot);
  };

  /**
   * A channel's held state, opened from `seed` when nothing holds it yet.
   *
   * The delta window is emptied before anything is read. A held delta reduces
   * into a state that is held, and a seed built after the window emptied
   * already carries every delta that went out, so a word is never in the seed
   * and then reduced into it a second time. `fromSeq` is read after both, in
   * the same tick, so every action at or below it is in the state.
   */
  const heldOf = (channel: string, kind: HeldState['kind'], seed: () => Bag): Bag => {
    ctx.flushDeltas();
    return ctx.stateOf(channel) ?? ctx.openState(channel, kind, seed());
  };
  /** A held state, as one subscribe is answered with it. */
  const served = (channel: string, state: Bag): Record<string, unknown> =>
    structuredClone({ resource: channel, state, fromSeq: ctx.serverSeq });
  /**
   * A chat's state with its turns cut to the window a subscribe asked for.
   *
   * The state holds every turn the chat retains, and the cut is the host's to
   * make per subscription: a snapshot with no view carries all of them and no
   * cursor, and one with a view carries the newest ones and a cursor for the
   * rest, which `fetchTurns` pages from.
   */
  const windowed = (state: Bag, view: SubscribeView | undefined): Bag => {
    if (!Array.isArray(state.turns)) return state;
    const window = windowOf(state.turns as Bag[], view);
    const { turnsNextCursor: _cursor, ...rest } = state;
    return { ...rest, turns: window.turns, ...(window.turnsNextCursor === undefined ? {} : { turnsNextCursor: window.turnsNextCursor }) };
  };

  /**
   * A session's status as its own reducer keeps it, from the flags this host
   * keeps and the input it waits on.
   *
   * The protocol's session reducer moves `status` through `IsRead`,
   * `IsArchived` and the input-needed list, and through nothing else, so the
   * activity a seed starts from is idle, raised to input-needed while the list
   * holds an entry a person answers. What the session's chats are doing is
   * their own status, carried on each row of `chats`; the catalogue row is
   * where the session-wide answer is drawn.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/types/channels-session/reducer.ts#L44-L62
   */
  const seedStatus = (uri: string, inputNeeded: unknown): number => {
    const waiting = Array.isArray(inputNeeded)
      && inputNeeded.some((one) => (one as Bag | undefined)?.kind !== 'toolClientExecution');
    return (waiting ? Status.InputNeeded : Status.Idle) | kept.flags(idOf(uri));
  };

  const sessionSeed = (channel: string): Bag => {
    const held = sessions.get(channel);
    const lead = held === undefined ? undefined : leadOf(held);
    if (held === undefined || lead === undefined) return {};
    /*
     * The workers the session ran before this process held it, as the record
     * was last read, beside the ones opened live. One opened live under the
     * same URI is listed once, as the live one. A session resumed here has its
     * record read before its backend starts, so the read is in hand.
     */
    const restored = (ctx.subHistory.get(idOf(channel)) ?? [])
      .map((one) => ({ one, uri: subagentChatUri(channel, String(one.toolCallId ?? '')) }))
      .filter(({ uri }) => !subagents.has(uri));
    /*
     * The backend's answer with `resource` taken off it.
     *
     * `SessionState` declares no such key: the channel the client asked
     * about is the resource, and this host says so in the answer it wraps
     * around this. A backend that echoes its own URI is echoing a field the
     * protocol has no place for, which a strict client calls a defect. Its
     * activity is its own chat's, and the session's is the chat that decides
     * it, which this host reads across all of them.
     */
    const { resource: _resource, activity: _activity, customizations: reported, ...theirs } = lead.sessionState();
    const mine = decided.get(channel);
    const activity = activityOf(held);
    const customizations = ctx.laidCustomizations(channel, reported);
    return {
      ...theirs,
      ...(customizations === undefined ? {} : { customizations }),
      // What this host answered, beside what the backend did. Its own keys
      // never reached the backend, so this is the only place they can be
      // read back from.
      ...(mine === undefined ? {} : { config: mergedConfig(channel, theirs.config, mine) }),
      ...describes(channel),
      ...changesetsOf(channel),
      // Required by the protocol and empty until somebody announces
      // themselves, which is a real answer: a session nobody has opened has
      // nobody in it.
      activeClients: activeClientsOf(channel),
      // What this host contributes, which is nothing unless it was given
      // any - and then the field is absent rather than an empty list.
      ...(ctx.contributing.length > 0 ? { serverTools: ctx.toolDefinitions(channel) } : {}),
      status: seedStatus(channel, theirs.inputNeeded),
      // No `modifiedAt`: `SessionSummary` declares it and `SessionState`
      // does not, and the catalogue row is where a client reads it.
      defaultChat: held.defaultChat,
      // The same list the session's catalogue row carries, built by the one
      // function both answers call, from the state each chat holds.
      chats: chatCatalogOf(channel, held, restored),
      ...(activity === undefined ? {} : { activity }),
    };
  };

  const chatSeed = (session: string, chatUri: string): Bag => {
    const talking = byChat.get(chatUri);
    if (talking === undefined) return {};
    const owner = sessions.get(session);
    /*
     * The lead chat links the workers read back for its session, as the
     * restored transcript did before the session went live.
     */
    const restored = owner !== undefined && owner.defaultChat === chatUri && owner.agent.subagents !== undefined
      && resumedSessions.has(session)
      ? (ctx.subHistory.get(idOf(session)) ?? [])
        .filter((one) => one.parentToolCallId === undefined || String(one.parentToolCallId) === '')
      : [];
    const background = ctx.background.rows(chatUri);
    const canvases = ctx.canvases.listOf(chatUri);
    const state: Bag = {
      ...talking.chat.chatState(),
      ...startedBy(session, chatUri),
      // The chat's own status with the read and archived bits laid over it,
      // which is what its catalogue row says too: a chat's state and its row
      // are two answers to one question.
      status: talking.chat.status() | kept.chatFlags(idOf(session), chatUri),
      // The tasks the backend reported, absent rather than empty when there
      // are none: the protocol's absence-means-none, so a chat that never
      // had work and one that finished all of it read the same way.
      ...(background === undefined ? {} : { backgroundWork: background }),
      // Whether a client may offer a move for this chat, which is the
      // session's answer and not the backend's - so it is read here and left
      // off when it cannot move, as the protocol's absence-means-false has it.
      ...(movable(chatUri) ? { movable: true } : {}),
      // The canvases this chat shows, which are this host's and no
      // backend's, laid over its state the way `movable` is - and absent
      // rather than empty when there are none.
      ...(canvases === undefined ? {} : { canvases }),
    };
    /*
     * The backend that serves this chat, where it is not the session's own.
     *
     * A chat opened on another harness is still a chat of this session - its
     * channel, its row and its place among the session's chats - so what it
     * runs on is said in `_meta` and not in `provider`: `ChatState` declares
     * no provider, and the session must go on answering the provider it was
     * started on. Laid over whatever the backend put there itself, which is
     * where a harness speaks its own keys, and left off for the session's own
     * chats, whose backend is the one the session already names.
     */
    const foreign = owner?.backends.get(talking.chat.chatUri);
    if (foreign !== undefined) {
      const meta = (typeof state._meta === 'object' && state._meta !== null ? state._meta : {}) as Bag;
      state._meta = { ...meta, 'ahpd.provider': foreign.agent.provider };
    }
    // Every turn the backend holds, with each worker linked from its call and
    // the sender on each message; the window a subscribe asks for is cut
    // from these when it is served.
    if (Array.isArray(state.turns)) {
      state.turns = ctx.withSender(session, ctx.stampedCalls(session, linkedTurns(session, state.turns as Bag[], restored)));
    }
    delete state.turnsNextCursor;
    if (typeof state.activeTurn === 'object' && state.activeTurn !== null) {
      state.activeTurn = ctx.withSender(session, ctx.stampedCalls(session, [state.activeTurn as Bag]))[0];
    }
    // The attachments the clients sent, back on the messages that carry them:
    // a `chat` attachment reaches a backend as a pointer, and the reference
    // it was sent as is what a client reads.
    return ctx.asSentChat(state);
  };

  const sessionStateOf = (uri: string): Bag | undefined => {
    const held = ctx.stateOf(uri);
    if (held !== undefined) return held;
    const live = sessions.get(uri);
    if (live === undefined || leadOf(live) === undefined) return undefined;
    return ctx.openState(uri, 'session', sessionSeed(uri));
  };

  const snapshotOf = async (channel: string, mine: Record<string, unknown> = {}, connection?: Connection, view?: SubscribeView): Promise<Record<string, unknown>> => {
    if (isRootChannel(channel)) {
      /*
       * The root's held state, as this connection may read it.
       *
       * The daemon's own values are asked of their port before anything is
       * held, and the seed is built and held after the answer, in one tick,
       * so no root action falls between what the seed read and the state.
       */
      const daemon = ctx.stateOf(ROOT) === undefined ? await ctx.daemonValues() : {};
      const root = heldOf(ROOT, 'root', () => ctx.rootSeed(daemon));
      return served(ROOT, ctx.rootFor(root, mine, connection));
    }
    /*
     * A plugin channel, answered by its plugin and by nothing else here: an
     * `x-` URI no plugin serves is refused rather than read for a session.
     *
     * `fromSeq` is read before the plugin is asked. A publish made while it
     * answers is then replayed after the snapshot rather than lost, and a
     * catalogue keyed by id takes the same record twice without harm.
     */
    if (spaceOf(channel) === 'plugin') {
      const served = servedIn(options.channels, channel);
      if (served === undefined) throw new RpcError(-32001, `No channel at ${channel}`);
      ctx.flushDeltas();
      const fromSeq = ctx.serverSeq;
      const state = await served.channel.snapshot(channel, connection?.principal, connection?.clientId ?? '');
      return structuredClone({ resource: channel, state, fromSeq });
    }
    /*
     * A canvas, answered from the store the chat's list came from.
     *
     * A channel this host does not hold is refused here rather than read for a
     * session: the canvas is gone, and a client that subscribed to one the
     * chat no longer lists is told so rather than handed an empty state.
     * https://github.com/microsoft/vscode/blob/e646868227c/src/vs/platform/agentHost/node/agentService.ts#L9191-L9206
     */
    if (schemeOf(channel) === 'ahp-canvas') {
      const state = ctx.canvases.snapshot(channel);
      if (state === undefined) throw new RpcError(-32008, 'Canvas is no longer available');
      return value({ resource: channel, state, fromSeq: ctx.serverSeq });
    }
    const terminal = terminals.get(channel);
    if (terminal)
      return value({ resource: channel, state: terminal.state(), fromSeq: ctx.serverSeq });
    /*
     * A terminal a tool result names, after the live one is gone: rebuilt from
     * what the host kept, as the reference host answers a subscribe that no
     * live terminal does. A name it cannot rebuild goes on to be refused
     * below, as any terminal this host has not got is.
     * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentService.ts#L10785-L10803
     */
    const rebuilding = ctx.retainedState(channel);
    const retained = rebuilding === undefined ? undefined : await rebuilding;
    if (retained !== undefined)
      return value({ resource: channel, state: retained, fromSeq: ctx.serverSeq });
    /*
     * A changeset, which lives under the session it belongs to.
     *
     * `<sessionUri>/changeset/<scope>`. Nested on purpose: disposing a session
     * tears down every changeset it had by string-prefix scan, and the reverse
     * lookup - which session is this - is the same scan.
     */
    if (channel === LOGS || channel.startsWith(`${LOGS}/`) || channel === TRACES || channel === METRICS) {
      // Nothing to snapshot: the channel is a stream, and the protocol says a
      // subscriber receives only what was emitted after it arrived. Answering
      // with an empty state is how a client is told it is subscribed rather
      // than refused.
      return value({ resource: channel, state: {}, fromSeq: ctx.serverSeq });
    }
    if (isAutomations(channel)) {
      /*
       * The catalogue, whole or narrowed to the caller's own.
       *
       * The query is read here rather than at the door, because this is where
       * the entries are: `owner=me` keeps the ones whose `_meta` names the
       * caller, a connection with no principal answers nothing, and any other
       * value is refused as a wrong param. The plain channel carries no query
       * and is answered exactly as before.
       */
      const owner = ownerFilter(queryOf(channel), connection?.principal);
      const entries = need(options.automations, 'the automations channel').list();
      return value({
        resource: channel,
        state: { entries: owner === undefined ? entries : entries.filter((entry) => automationOwner(entry) === owner) },
        fromSeq: ctx.serverSeq,
      });
    }
    if (channel.startsWith('ahp-automation-run:/')) {
      const found = options.automations?.runOf(channel);
      if (!found) throw new RpcError(-32001, `No automation run at ${channel}`);
      return value({ resource: channel, state: runState(found), fromSeq: ctx.serverSeq });
    }
    /*
     * A session's annotations, nested under the session the way a changeset
     * is: `<sessionUri>/annotations`, one per session.
     *
     * Held rather than produced. Nothing here makes a mark - they arrive
     * through the `addComment` server tool, which no backend here advertises -
     * and what this host contributes is that a mark one client made is one
     * every other client in the session can see. The channel is served rather
     * than refused even when it is empty, because a client subscribes to it as
     * part of opening a session, alongside the session and its chat: a refusal
     * there is a failed open, and a client that treats the three as one
     * hydration renders nothing at all.
     */
    if (channel.endsWith(MARKS) && sessionChannel(channel)) {
      const owning = channel.slice(0, -MARKS.length);
      const id = idOf(owning);
      // The same sentence as the roads that open the session itself, since a
      // client hydrates the marks on the way in and a row waiting for its
      // harness has none to read.
      const missing = waitingFor(id);
      if (missing !== undefined) throw new RpcError(-32002, `${missing} is not loaded on this host`);
      // Asked of `past`, which consults the catalogue itself, rather than of
      // the maps a listing fills: a client sends the three subscriptions that
      // open a session in one breath, before its own `listSessions` has come
      // back, and a test against those maps refuses on the race.
      if (sessions.has(heldAs(owning)) || (await past(id)) !== undefined)
        return value({ resource: channel, state: marksOf(id), fromSeq: ctx.serverSeq });
    }
    /*
     * A watch another client is keeping, which this host only relays.
     *
     * Its state is the params it was made with, the same as one of this
     * host's own - and a snapshot has to be served here or the client that
     * asked for the watch cannot subscribe to what it was given.
     */
    const away = relayed.get(channel);
    if (away) return value({ resource: channel, state: away.state, fromSeq: ctx.serverSeq });
    const watching = watches.get(channel);
    if (watching) {
      // The state is what the watch *is*, not what it has seen. The protocol's
      // reducer keeps no history: `resourceWatch/changed` exists to deliver
      // events to whoever is subscribed, and a client that arrives later has
      // missed them the way it misses anything it was not there for.
      return value({ resource: channel, state: watching.state, fromSeq: ctx.serverSeq });
    }
    const at = changesetAt(channel);
    if (at) {
      /*
       * Asked again, here, because this is the moment somebody reads one.
       *
       * `git status` is cached per directory - a catalogue of a hundred rows
       * must not be a hundred `git` runs - and it used to be refreshed only
       * when a turn ended. That is right for what the *agent* did and wrong
       * for everything else: a person editing in an editor, a build writing
       * artefacts, a `git checkout` in a terminal this same host is serving.
       * All of it was invisible until the next turn finished, so a client that
       * opened a changeset in between was shown a working tree that had moved.
       *
       * Deliberately not a watcher for this. `fs.watch` recursive costs an
       * inotify handle per directory, and a host told to serve a home
       * directory would spend thousands of them before answering anything. A
       * client that wants to be *told* asks for `createResourceWatch` on a
       * path it names, which is what the protocol has for it; this is only
       * about the host's own cache being true at the moment it is read.
       *
       * The git facts and the pull requests with the files, because the verbs
       * answered below are drawn from them, and a directory outside
       * `browsable()` may have had nothing read them yet. What moved is
       * announced, so the session's row carries what this read found.
       */
      await readFacts(at.dir);
      // Somebody reads this directory's changesets now, so the source watches
      // what only git writes: staging, committing and checking out elsewhere.
      startWatchingDir(at.dir);
      const state = await options.changes?.state(at.dir, at.owner, at.scope, at.base);
      if (!state) throw new RpcError(-32001, `No changeset at ${channel}`);
      // The verbs, alongside the files. Omitted when there are none, which
      // the protocol asks for and which is what a changeset with nothing to
      // do to it says.
      const operations = operationsOf(channel);
      /*
       * What this subscriber now holds, which is what the next change is
       * against.
       *
       * Without this the first change after anybody subscribed had nothing to
       * diff from and went out as the whole set - so the incremental actions
       * only ever applied from the second change onwards, which is not what
       * "the diff is smaller" means.
       */
      shown.set(channel, { files: state.files, status: state.status });
      return value({
        resource: channel,
        state: { ...state, ...(operations.length > 0 ? { operations } : {}) },
        fromSeq: ctx.serverSeq,
      });
    }
    const held = sessions.get(channel);
    if (held !== undefined && leadOf(held) !== undefined) {
      /*
       * A running session's held state.
       *
       * The workers it ran before this process held it are read first, for a
       * session whose state is not held yet: the seed lists them, and the read
       * goes before the seed so no action dispatched while it is out falls
       * between the state and `fromSeq`.
       */
      if (ctx.stateOf(channel) === undefined && held.agent.subagents !== undefined && resumedSessions.has(channel)) {
        const lead = leadOf(held);
        if (lead !== undefined) await restoredSubagents(idOf(channel), held.agent, lead.allTurns() as unknown as WireTurn<Turn>[]);
      }
      ctx.flushDeltas();
      const state = sessionStateOf(channel);
      // What it holds of its folder and backend, read now, since this is the
      // moment somebody reads it, and said by action where it moved.
      ctx.factsMoved(channel);
      if (state !== undefined) return served(channel, ctx.stateOf(channel) ?? state);
    }
    /*
     * A worker chat of a running session, which is its own conversation: what
     * it says is what the backend emitted on this channel, held from the
     * moment the worker opened.
     */
    if (subagents.has(channel)) {
      ctx.flushDeltas();
      const state = ctx.stateOf(channel);
      if (state !== undefined) return served(channel, windowed(state, view));
    }
    const talking = byChat.get(channel);
    if (talking) {
      // Held from the moment its backend started, which is where its seed is read.
      const state = heldOf(channel, 'chat', () => chatSeed(talking.uri, channel));
      return served(channel, windowed(state, view));
    }
    /*
     * A session or chat channel this host is not running, held from the first
     * subscribe: its seed is the record the session's backend wrote and what
     * this host keeps beside it, read once, and every action after it moves
     * the held state the way it moves a running one.
     */
    if (ctx.stateOf(channel) !== undefined) {
      /*
       * A chat whose record answered nothing when it opened is read again: a
       * read that failed, or a transcript written since, is not an empty
       * conversation for as long as somebody watches it. What the record holds
       * now is said as `chat/turnsLoaded`, the action the reference host
       * refreshes a chat's persisted history with, so a client that watched
       * holds it too.
       * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L759-L767
       */
      const open = ctx.heldStates.get(channel);
      const empty = (state: Bag | undefined): boolean => state !== undefined && state.activeTurn === undefined
        && (!Array.isArray(state.turns) || state.turns.length === 0);
      if (open?.kind === 'chat' && empty(open.state)) {
        const read = await recordSeed(channel).catch(() => undefined);
        const turns = read?.kind === 'chat' && Array.isArray(read.state.turns) ? read.state.turns as Bag[] : [];
        if (turns.length > 0 && empty(ctx.stateOf(channel))) ctx.dispatch(channel, { type: 'chat/turnsLoaded', turns });
      }
      /*
       * A session whose workers could not be read when it opened has them read
       * again, for the same reason: a read that failed is not a session that
       * ran no workers. Each worker the read finds joins the session's chats
       * by `session/chatAdded`, the action the reference host registers a chat
       * in a held session with, so a client that watched lists it too.
       * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/agentHostStateManager.ts#L1698-L1767
       */
      const id = idOf(channel);
      if (open?.kind === 'session' && (owners.get(nameOf(id)) ?? ctx.first)?.subagents !== undefined
        && !ctx.subHistory.has(id)) {
        const read = await recordSeed(channel).catch(() => undefined);
        const listed = new Set(((ctx.stateOf(channel)?.chats ?? []) as Bag[]).map((one) => String(one.resource)));
        const rows = read?.kind === 'session' && Array.isArray(read.state.chats) ? read.state.chats as Bag[] : [];
        for (const row of rows.filter((one) => !listed.has(String(one.resource))))
          ctx.dispatch(channel, { type: 'session/chatAdded', summary: row });
      }
      ctx.flushDeltas();
      const state = ctx.stateOf(channel) as Bag;
      return served(channel, windowed(state, view));
    }
    const recorded = await recordSeed(channel);
    const state = heldOf(channel, recorded.kind, () => recorded.state);
    return served(channel, windowed(state, view));
  };

  /**
   * The state a session or chat this host is not running opens with, read from
   * the record.
   *
   * Served read-only from its transcript. No agent process is started until
   * somebody sends a turn to it.
   */
  const recordSeed = async (channel: string): Promise<{ kind: 'session' | 'chat'; state: Bag }> => {
    /*
     * A chat URI carries its session; a session URI is one. Either way the
     * transcript is the session's, and the id is what reads it.
     *
     * A recorded peer chat is the exception, and the reason this is not one
     * expression: its URI carries a uuid rather than a session, so the uuid
     * read as an id looks for a session nobody has. What the store recorded
     * says which session the chat was opened in, and that is what is read for
     * one.
     *
     * Every other channel keeps the spelling the client wrote, holding
     * nothing but the base64 it arrived with. A session renamed to this host's
     * own name for it would be a second name for one session, and the snapshot
     * is respelled back into the asked name on the way out - so the chats and
     * worker links in it would be built from the wrong one.
     */
    const owning = homeId(channel) === undefined ? sessionOfChat(channel) ?? channel : sessionFor(channel);
    // Never a session's id read out of a file, a terminal or a watch.
    if (!sessionChannel(owning)) throw new RpcError(-32001, `No agent for session ${channel}`);
    const id = idOf(owning);
    const missing = waitingFor(id);
    if (missing !== undefined) throw new RpcError(-32002, `${missing} is not loaded on this host`);
    const turns = await past(id);
    const owner = owners.get(nameOf(id)) ?? ctx.first;
    // Not running and not in the catalogue. Refusing is the honest answer and
    // the one a client already knows how to render - it is what a real host
    // says about a session whose agent has gone.
    if (owner === undefined || !turns) throw new RpcError(-32001, `No agent for session ${channel}`);
    const title = titles.get(id) ?? 'Session';
    /*
     * A chat of this session, answered from its own conversation.
     *
     * A peer chat is a conversation of its own, and the record says which
     * backend conversation it was opened as - so the backend is asked for
     * that one rather than for the session's, which is somebody else's
     * history. Nothing is started: this record is what answers, and the
     * process comes up when a turn is sent to the chat.
     *
     * Not the chat that is the session, whose turns are the ones already
     * read above, with the worker chats linked into them. Judged by the
     * chat's URI and not by which of them is the default: the default chat
     * is the session's only until the session's first chat is closed, and
     * the chat that took over from it is a conversation of its own.
     *
     * Read only of a session this host is not running inside a machine, as
     * its default chat is not resumed: a chat there is the inner host's, and
     * one listed here would be a row that opens onto nothing.
     */
    const opened = sessionOfChat(channel) === undefined || kept.nested?.(id) !== undefined
      ? undefined
      : recordedChat(id, channel);
    const stamp = moves.get(owning) ?? new Date().toISOString();
    if (opened !== undefined && opened.uri !== chatUriFor(nameOf(id))) {
      const own = await ctx.transcriptOf(owner, opened.backendId, ctx.sessionAt(id), nameOf(id), opened.uri);
      return {
        kind: 'chat',
        state: {
          resource: channel,
          title: opened.title ?? title,
          status: Status.Idle | kept.chatFlags(id, channel),
          modifiedAt: stamp,
          turns: ctx.withSender(owning, ctx.stampedCalls(owning, (own ?? []) as unknown as Bag[])),
          queuedMessages: [],
          ...(drafts.get(channel) !== undefined ? { draft: drafts.get(channel) } : {}),
        },
      };
    }
    const workers = await restoredSubagents(id, owner, turns as unknown as WireTurn<Turn>[]);
    /*
     * A worker chat read back out of the backend's own record.
     *
     * Its call id is in the URI, which is how a subscribe to a worker's
     * channel finds the conversation it names rather than the session's.
     */
    const wanted = toolCallOfSubagentChat(channel);
    if (wanted !== undefined) {
      const one = workers.find((held) => String(held.toolCallId ?? '') === wanted);
      if (one === undefined) throw new RpcError(-32001, `No worker chat at ${channel}`);
      const parentChat = restoredParentChat(nameOf(id), chatUriFor(nameOf(id)), one);
      return {
        kind: 'chat',
        state: {
          resource: channel,
          title: String(one.title ?? 'Subagent'),
          status: Status.Idle | kept.chatFlags(id, channel),
          modifiedAt: stamp,
          origin: { kind: 'tool', chat: parentChat, toolCallId: wanted },
          interactivity: 'read-only',
          // With each worker it spawned linked from the call that ran it.
          turns: ctx.withSender(owning, ctx.stampedCalls(owning, linkedTurns(
            owning,
            (one.turns ?? []) as Bag[],
            workers.filter((held) => String(held.parentToolCallId ?? '') === wanted),
          ))),
          queuedMessages: [],
        },
      };
    }
    if (sessionOfChat(channel) !== undefined) {
      return {
        kind: 'chat',
        state: {
          resource: channel,
          title,
          status: Status.Idle | kept.chatFlags(id, channel),
          modifiedAt: stamp,
          ...startedBy(nameOf(id)),
          turns: ctx.withSender(owning, ctx.stampedCalls(owning, linkedTurns(owning, turns, workers))),
          queuedMessages: [],
          // Held here rather than by a chat, because there is no chat. A
          // client that typed into this row and came back finds what it
          // typed, which is what a draft is for.
          ...(drafts.get(channel) !== undefined ? { draft: drafts.get(channel) } : {}),
        },
      };
    }
    /*
     * The chats the store recorded for it, closed ones left out, and which of
     * them the session would come back as. None for a session inside a
     * machine, whose chats are the inner host's.
     */
    const recorded = kept.nested?.(id) !== undefined ? [] : recordedChats(id);
    const lead = recorded.find((one) => one.default === true);
    const listedAt = moves.get(nameOf(id)) ?? stamp;
    const offered = ctx.laidCustomizations(nameOf(id), about(owner.provider).seeds);
    return {
      kind: 'session',
      state: {
        provider: owner.provider,
        title,
        status: Status.Idle | kept.flags(id),
        lifecycle: 'ready',
        /*
         * The chat the session would come back as: the recorded default where
         * the store has one, the session's own chat otherwise - a row listed
         * from the backend's disk has one by construction, and a session
         * whose first chat was closed has another chat as its default.
         */
        defaultChat: lead?.uri ?? chatUriFor(nameOf(id)),
        // A whole `ChatSummary`, and not a name and a URI: a client reads a
        // chat row's `status` and `modifiedAt` by name, and a live session
        // answers with both.
        chats: [
          {
            resource: lead?.uri ?? chatUriFor(nameOf(id)),
            title: lead?.title ?? title,
            status: Status.Idle | kept.chatFlags(id, lead?.uri ?? chatUriFor(nameOf(id))),
            modifiedAt: listedAt,
            ...startedBy(nameOf(id), lead?.uri),
          },
          /*
           * And every other chat the store recorded for it.
           *
           * A session's second chat is a conversation of its own that
           * outlives the process, so a client that opens the session after a
           * restart reads the chats it had rather than only the first. Each
           * is idle here: nothing is running, and its turns are read when
           * somebody opens it.
           */
          ...recorded
            .filter((one) => one.default !== true)
            .map((one) => ({
              resource: one.uri,
              title: one.title ?? title,
              status: Status.Idle | kept.chatFlags(id, one.uri),
              modifiedAt: listedAt,
              ...startedBy(nameOf(id), one.uri),
            })),
          // And the workers this session ran, each read-only and linked from
          // the call that spawned it - which is what makes a restored
          // session's subagents openable rather than lost.
          ...workers.map((one) => restoredSubagentSummary(
            nameOf(id),
            subagentChatUri(nameOf(id), String(one.toolCallId ?? '')),
            restoredParentChat(nameOf(id), chatUriFor(nameOf(id)), one),
            one as unknown as { toolCallId: string; title: string; turns: Bag[] },
            listedAt,
          )),
        ],
        workingDirectories: wheres.get(nameOf(id)) ?? [uriOf(options.path)],
        activeClients: activeClientsOf(nameOf(id)),
        ...(ctx.contributing.length > 0 ? { serverTools: ctx.toolDefinitions(nameOf(id)) } : {}),
        ...describes(nameOf(id)),
        ...changesetsOf(nameOf(id)),
        // What its backend offers, since nothing is running to say what this
        // session in particular was given, with what its clients handed it.
        ...(offered === undefined ? {} : { customizations: offered }),
        // The same schema a live session reports. Leaving it out drew no
        // controls at all on a browsed row - no permission mode, no effort -
        // which are the settings somebody wants *before* continuing one.
        config: {
          schema: sessionSchema(owner),
          values: { ...owner.defaults(), ...storedConfig(owner, id) },
        },
      },
    };
  };

  return { value, snapshotOf, sessionSeed, chatSeed, sessionStateOf };
}

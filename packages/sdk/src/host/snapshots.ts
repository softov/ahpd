import { Status, idOf } from '../catalog.js';
import { tail } from '../paging.js';
import { RpcError } from '../rpc.js';
import { uriOf } from '../fileuri.js';
import { runState } from './automations.js';
import { ROOT, isRootChannel, AUTOMATIONS, MARKS, chatUriFor, subagentChatUri, toolCallOfSubagentChat } from './channels.js';
import { need } from './common.js';
import type { Bag } from '../types/common.js';
import type { Connection } from '../types/host.js';
import type { WireTurn } from '../types/wire.js';
import type { StoredChat } from '../types/sessions.js';
import type { HostContext } from './context.js';
import type { Turn } from '@microsoft/agent-host-protocol';

/** What a subscribe is answered with. */
export interface Snapshots {
  value(snapshot: Record<string, unknown>): Record<string, unknown>;
  snapshotOf(channel: string, mine?: Record<string, unknown>, connection?: Connection): Promise<Record<string, unknown>>;
}

export function createSnapshots(ctx: HostContext): Snapshots {
  const {
    options, first, sessions, subagents, byChat, owners, decided, wheres, moves, drafts, terminals,
    kept, watches, marksOf, resumedSessions, activeClientsOf,
    about, leadOf,
    LOGS, TRACES, METRICS,
    heldAs, nameOf, sessionOfChat, sessionChannel, sessionFor,
    relayed,
    changesetAt, operationsOf, shown, changesetsOf,
    readFacts, startWatchingDir, describes,
    mergedConfig, sessionSchema, storedConfig,
    rootState, waitingFor, statusOf, startedBy, chatSummary, subagentSummary, restoredSubagentSummary, activityOf,
    past, restoredSubagents, restoredParentChat, linkedTurns, titles,
    recordedChats, recordedChat, homeId,
  } = ctx;

  /**
   * A snapshot is a value, not a view of one.
   *
   * The state assembled below is built out of the host's own live objects -
   * the turn being written into, the array a delta appends to - and the
   * response carrying it is serialised after this function returns, not
   * inside it. Handed back by reference it is therefore a promise about the
   * present that is kept in the future: the client receives whatever those
   * objects had become by the time the socket got to them, under a `fromSeq`
   * naming the moment they were read. That number is the whole basis on which
   * a client decides what it has already seen, so a snapshot newer than its
   * own sequence is one that gets a turn applied to it twice - once from the
   * state, once from the action that produced it.
   *
   * `structuredClone` rather than a JSON round-trip, because a key that is
   * present and undefined is not the same as an absent one here - `usage` is
   * required and means "not measured" - and JSON cannot tell those apart.
   *
   * The window is emptied here, in the same tick as the read, and `fromSeq` is
   * read after it.
   *
   * An assembly that awaited - a transcript, a backend's worker list - can
   * have had a delta arrive while it was out, and that delta is held. It is
   * already in the state above, because a backend writes a delta's text into
   * the part before it emits the action - so it has to sit at or below
   * `fromSeq` or it is replayed on top of the words it wrote. Flushed and
   * numbered here, it does.
   */
  const value = (snapshot: Record<string, unknown>): Record<string, unknown> => {
    ctx.flushDeltas();
    return structuredClone('fromSeq' in snapshot
      ? { ...snapshot, fromSeq: ctx.serverSeq }
      : snapshot);
  };

  const snapshotOf = async (channel: string, mine: Record<string, unknown> = {}, connection?: Connection): Promise<Record<string, unknown>> => {
    if (isRootChannel(channel)) {
      return value({ resource: ROOT, state: await rootState(mine, connection), fromSeq: ctx.serverSeq });
    }
    const terminal = terminals.get(channel);
    if (terminal)
      return value({ resource: channel, state: terminal.state(), fromSeq: ctx.serverSeq });
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
    if (channel === AUTOMATIONS) {
      return value({
        resource: channel,
        state: { entries: need(options.automations, 'the automations channel').list() },
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
      const state = await options.changes?.state(at.dir, at.owner, at.scope);
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
    const lead = held && leadOf(held);
    if (held && lead) {
      /*
       * The session's state, assembled here rather than asked of one chat.
       *
       * A session is a container: its title, config and customizations come
       * from the default chat, its status and activity from whichever chat is
       * driving them, its `modifiedAt` from the latest of all - and `chats` is
       * the list, which no single chat knows. `IsRead` and `IsArchived` are
       * this host's, and no chat has heard of them.
       */
      /*
       * The workers the session ran before this process held it, read back
       * from the backend's record, beside the ones opened live. One opened
       * live under the same URI is listed once, as the live one. Read before
       * anything else here, so no action dispatched during the read falls
       * between the state and `fromSeq`.
       */
      const read = held.agent.subagents === undefined || !resumedSessions.has(channel)
        ? []
        : await restoredSubagents(idOf(channel), held.agent, lead.allTurns() as unknown as WireTurn<Turn>[]);
      const restored = read
        .map((one) => ({ one, uri: subagentChatUri(channel, String(one.toolCallId ?? '')) }))
        .filter(({ uri }) => !subagents.has(uri));
      /*
       * The backend's answer with `resource` taken off it.
       *
       * `SessionState` declares no such key: the channel the client asked
       * about is the resource, and this host says so in the answer it wraps
       * around this. A backend that echoes its own URI is echoing a field the
       * protocol has no place for, which a strict client calls a defect.
       */
      const { resource: _resource, ...theirs } = lead.sessionState();
      const mine = decided.get(channel);
      const state = {
        ...theirs,
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
        status: statusOf(channel),
        // No `modifiedAt`: `SessionSummary` declares it and `SessionState`
        // does not, and the catalogue row is where a client reads it.
        defaultChat: held.defaultChat,
        chats: [
          ...[...held.chats].map(([uri_, chat_]) => chatSummary(channel, uri_, chat_)),
          /*
           * And the workers, which are chats of this session even though no
           * `Session` holds them. A client that subscribes after they opened
           * reads the list, so a worker missing from it is a conversation
           * nobody can find.
           */
          ...[...subagents].filter(([, one]) => one.session === channel)
            .map(([uri_, one]) => subagentSummary(uri_, one)),
          ...restored.map(({ one, uri: uri_ }) => restoredSubagentSummary(
            uri_,
            restoredParentChat(channel, held.defaultChat, one),
            one as unknown as { toolCallId: string; title: string; turns: Bag[] },
          )),
        ],
        ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
      };
      return value({ resource: channel, state, fromSeq: ctx.serverSeq });
    }
    /*
     * A worker chat of a running session, which is its own conversation.
     *
     * Held as reduced state rather than asked of a `Session`, because a worker
     * has none: what it says is what the backend emitted on this channel.
     */
    const worker = subagents.get(channel);
    if (worker)
      return value({
        resource: channel,
        state: { ...(worker.state as Bag), resource: channel },
        fromSeq: ctx.serverSeq,
      });
    const talking = byChat.get(channel);
    if (talking) {
      /*
       * The lead chat links the workers read back for its session, as the
       * restored transcript did before the session went live. Read before the
       * chat's state, so no action dispatched during the read falls between
       * the state and `fromSeq`.
       */
      const owner = sessions.get(talking.uri);
      const restored = owner !== undefined && owner.defaultChat === channel && owner.agent.subagents !== undefined
        && resumedSessions.has(talking.uri)
        ? (await restoredSubagents(idOf(talking.uri), owner.agent, talking.chat.allTurns() as unknown as WireTurn<Turn>[]))
          .filter((one) => one.parentToolCallId === undefined || String(one.parentToolCallId) === '')
        : [];
      const state: Bag = { ...talking.chat.chatState(), ...startedBy(talking.uri, channel) };
      if (Array.isArray(state.turns)) {
        const turns = linkedTurns(talking.uri, state.turns as Bag[], restored);
        state.turns = ctx.withSender(talking.uri, ctx.stampedCalls(talking.uri, turns));
      }
      if (typeof state.activeTurn === 'object' && state.activeTurn !== null) {
        state.activeTurn = ctx.withSender(talking.uri, ctx.stampedCalls(talking.uri, [state.activeTurn as Bag]))[0];
      }
      return value({ resource: channel, state, fromSeq: ctx.serverSeq });
    }
    /*
     * A session in the catalogue that this host is not running.
     *
     * Served read-only from its transcript. No agent process is started until
     * somebody sends a turn to it.
     */
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
    const owner = owners.get(nameOf(id)) ?? first;
    if (turns) {
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
      if (opened !== undefined && opened.uri !== chatUriFor(nameOf(id))) {
        const own = await owner.transcript?.(opened.backendId);
        return value({
          resource: channel,
          state: {
            resource: channel,
            title: opened.title ?? title,
            status: Status.Idle,
            modifiedAt: moves.get(owning) ?? new Date().toISOString(),
            ...tail(ctx.withSender(owning, ctx.stampedCalls(owning, (own ?? []) as unknown as Bag[]))),
            queuedMessages: [],
            ...(drafts.get(channel) !== undefined ? { draft: drafts.get(channel) } : {}),
          },
          fromSeq: ctx.serverSeq,
        });
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
        return value({
          resource: channel,
          state: {
            resource: channel,
            title: String(one.title ?? 'Subagent'),
            status: Status.Idle,
            modifiedAt: moves.get(owning) ?? new Date().toISOString(),
            origin: { kind: 'tool', chat: parentChat, toolCallId: wanted },
            interactivity: 'read-only',
            // With each worker it spawned linked from the call that ran it.
            ...tail(ctx.withSender(owning, ctx.stampedCalls(owning, linkedTurns(
              owning,
              (one.turns ?? []) as Bag[],
              workers.filter((held) => String(held.parentToolCallId ?? '') === wanted),
            )))),
            queuedMessages: [],
          },
          fromSeq: ctx.serverSeq,
        });
      }
      if (sessionOfChat(channel) !== undefined) {
        return value({
          resource: channel,
          state: {
            resource: channel,
            title,
            status: Status.Idle,
            modifiedAt: moves.get(owning) ?? new Date().toISOString(),
            ...startedBy(nameOf(id)),
            ...tail(ctx.withSender(owning, ctx.stampedCalls(owning, linkedTurns(owning, turns, workers)))),
            queuedMessages: [],
            // Held here rather than by a chat, because there is no chat. A
            // client that typed into this row and came back finds what it
            // typed, which is what a draft is for.
            ...(drafts.get(channel) !== undefined ? { draft: drafts.get(channel) } : {}),
          },
          fromSeq: ctx.serverSeq,
        });
      }
      /*
       * The chats the store recorded for it, closed ones left out, and which of
       * them the session would come back as. None for a session inside a
       * machine, whose chats are the inner host's.
       */
      const recorded = kept.nested?.(id) !== undefined ? [] : recordedChats(id);
      const lead = recorded.find((one) => one.default === true);
      const stamp = moves.get(nameOf(id)) ?? new Date().toISOString();
      return value({
        resource: channel,
        state: {
          resource: channel,
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
              status: Status.Idle,
              modifiedAt: stamp,
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
                status: Status.Idle,
                modifiedAt: stamp,
                ...startedBy(nameOf(id), one.uri),
              })),
            // And the workers this session ran, each read-only and linked from
            // the call that spawned it - which is what makes a restored
            // session's subagents openable rather than lost.
            ...workers.map((one) => restoredSubagentSummary(
              subagentChatUri(nameOf(id), String(one.toolCallId ?? '')),
              restoredParentChat(nameOf(id), chatUriFor(nameOf(id)), one),
              one as unknown as { toolCallId: string; title: string; turns: Bag[] },
            )),
          ],
          workingDirectories: wheres.get(nameOf(id)) ?? [uriOf(options.path)],
          activeClients: activeClientsOf(nameOf(id)),
          ...(ctx.contributing.length > 0 ? { serverTools: ctx.toolDefinitions(nameOf(id)) } : {}),
          ...describes(nameOf(id)),
          ...changesetsOf(nameOf(id)),
          // What its backend offers, since nothing is running to say what this
          // session in particular was given.
          customizations: about(owner.provider).seeds,
          // The same schema a live session reports. Leaving it out drew no
          // controls at all on a browsed row - no permission mode, no effort -
          // which are the settings somebody wants *before* continuing one.
          config: {
            schema: sessionSchema(owner),
            values: { ...owner.defaults(), ...storedConfig(owner, id) },
          },
        },
        fromSeq: ctx.serverSeq,
      });
    }
    // Not running and not in the catalogue. Refusing is the honest answer and
    // the one a client already knows how to render - it is what a real host
    // says about a session whose agent has gone.
    throw new RpcError(-32001, `No agent for session ${channel}`);
  };

  return { value, snapshotOf };
}

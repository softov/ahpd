import { ROOT } from './channels.js';
import { Status, idFor, idOf } from '../catalog.js';
import type { Summary } from '../types/catalog.js';
import type { Agent, Listed } from '../types/agent.js';
import type { Bag } from '../types/common.js';
import type { Session } from '../types/session.js';
import type { Held, LiveSubagent } from './state.js';
import type { HostContext } from './context.js';

/** The session list and each row of it. */
export interface Catalogue {
  statusOf(uri: string): number;
  startedBy(session: string, chat?: string): Bag;
  chatSummary(session: string, uri: string, chat: Session): Bag;
  subagentSummary(uri: string, ref: LiveSubagent): Bag;
  restoredSubagentSummary(uri: string, parentChat: string, ref: { toolCallId: string; title: string; turns: Bag[] }): Bag;
  activityOf(held: Held): string | undefined;
  sessionAdded(uri: string): void;
  summaryMoved(uri: string): void;
  forgetSent(uri: string): void;
  activeSessionsMoved(): void;
  learnModels(uri: string): void;
  /** Every backend's rows, with what a refusing backend had last time carried over. */
  listing(before?: Summary[]): Promise<Summary[]>;
  /** Record one listed row and build it, as a listing does for every row it finds. */
  adopt(agent: Agent, row: Listed, waiting?: string): Summary;
  /** Tell every client about a listed row this host did not have. */
  rowAdded(summary: Summary): void;
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
  /** Tell every client what a refresh changed: added, removed, or moved. */
  rowsMoved(before: Summary[], after: Summary[]): void;
  waitingFor(id: string): string | undefined;
  readStored(): Promise<void>;
}

export function createCatalogue(ctx: HostContext): Catalogue {
  const {
    options, agents, sessions, subagents, owners, kept, names, wheres, births, moves,
    madeFrom, origins, leadOf, about, browsable,
  } = ctx;

  /**
   * How a chat came to exist.
   *
   * `ChatOrigin` has four kinds - `user`, `fork`, `sideChat` and `tool`. A
   * chat made out of another says which, from `madeFrom`; any other chat here
   * is one somebody opened, or one read back from a transcript somebody typed.
   * Workers say `tool` in their own rows. There is no kind for a session an
   * automation started, so that one gets none rather than a wrong one, and
   * absent is what the protocol says when a host has nothing to say.
   */
  const startedBy = (session: string, chat?: string): Bag => {
    const made = chat === undefined ? undefined : madeFrom.get(chat);
    if (made !== undefined) return { origin: made };
    return origins.has(session) ? {} : { origin: { kind: 'user' } };
  };
  /**
   * One chat, as its session's catalogue lists it.
   *
   * A `ChatSummary` and not a name and a URI: `status` and `modifiedAt` are
   * required of one, and a client reducing its list against a partial row
   * gets one it cannot sort or draw a state for.
   */
  const chatSummary = (session: string, uri: string, chat: Session) => ({
    resource: uri,
    ...startedBy(session, uri),
    title: chat.title(),
    status: chat.status(),
    modifiedAt: chat.modifiedAt(),
    ...(chat.activity() !== undefined ? { activity: chat.activity() } : {}),
    // The same answer the chat's own state gives. A summary that left it out
    // while the state carried it would be two answers to one question.
    interactivity: 'full',
  });

  /** A worker chat's catalogue row: read-only, and spawned by a tool call. */
  const subagentSummary = (uri: string, ref: LiveSubagent) => ({
    resource: uri,
    title: ref.title,
    status: Number(ref.state.status ?? Status.Idle),
    modifiedAt: String(ref.state.modifiedAt ?? new Date().toISOString()),
    origin: { kind: 'tool', chat: ref.parentChat, toolCallId: ref.toolCallId },
    interactivity: 'read-only',
    ...(ref.state.activity !== undefined ? { activity: ref.state.activity } : {}),
  });

  /** The same, for a worker read back from a backend's own record. */
  const restoredSubagentSummary = (uri: string, parentChat: string, ref: { toolCallId: string; title: string; turns: Bag[] }): Bag => ({
    resource: uri,
    title: ref.title,
    status: Status.Idle,
    modifiedAt: new Date().toISOString(),
    origin: { kind: 'tool', chat: parentChat, toolCallId: ref.toolCallId },
    interactivity: 'read-only',
  });

  /**
   * A session's status, with the client flags folded in.
   *
   * Activity is the session's own; `IsRead` and `IsArchived` are this host's,
   * and every answer carrying a status has to carry both halves or a row goes
   * back to unread the moment anything else about it changes.
   */
  const statusOf = (uri: string): number => {
    const held = sessions.get(ctx.heldAs(uri));
    if (!held)
      return Status.Idle | kept.flags(idOf(uri));
    return drivingOf(held).status | kept.flags(idOf(uri));
  };
  /** How far a chat's status outranks idle when a session's status is decided. */
  const urgency = (status: number): number => {
    const activity = status & (Status.IsRead - 1);
    return activity === Status.InputNeeded ? 3 : activity === Status.Error ? 2 : activity === Status.InProgress ? 1 : 0;
  };
  /**
   * The chat that decides a session's status and activity.
   *
   * The default chat's, promoted by any other chat of the session, a worker
   * chat included, that is waiting on a person, failed or running, in that
   * order: a session is waiting whichever of its chats is doing the waiting,
   * and is running while any of them runs. The activity is the deciding
   * chat's, so a row says what the busy chat is doing.
   */
  const drivingOf = (held: Held): { status: number; activity: string | undefined } => {
    const lead = leadOf(held);
    let driving = { status: lead?.status() ?? Status.Idle, activity: lead?.activity() };
    const others = [
      ...[...held.chats.values()].map((chat) => ({ status: chat.status(), activity: chat.activity() })),
      ...[...subagents.values()]
        .filter((ref) => sessions.get(ref.session) === held)
        .map((ref) => ({
          status: Number(ref.state.status ?? Status.Idle),
          activity: typeof ref.state.activity === 'string' ? ref.state.activity : undefined,
        })),
    ];
    for (const other of others) {
      if (urgency(other.status) > urgency(driving.status))
        driving = { status: other.status & (Status.IsRead - 1), activity: other.activity };
    }
    return driving;
  };
  /** The most recent change across a session's chats. */
  const modifiedOf = (held: Held): string => [...held.chats.values()]
    .map((chat) => chat.modifiedAt())
    .sort()
    .at(-1) ?? new Date().toISOString();
  /** What a session is doing: the activity of the chat that decides its status. */
  const activityOf = (held: Held): string | undefined => drivingOf(held).activity;

  /**
   * How many sessions this host is running, said when it changes.
   *
   * `sessions.size` and not the catalogue: the protocol asks for the active,
   * non-disposed sessions *on the server*, and a transcript on disk is a row
   * somebody can open rather than a session the host is holding. Reporting the
   * catalogue meant a host running nothing claimed a hundred.
   */
  let announced = -1;
  const activeSessionsMoved = (): void => {
    if (sessions.size === announced) return;
    announced = sessions.size;
    ctx.dispatch(ROOT, { type: 'root/activeSessionsChanged', activeSessions: sessions.size });
  };

  /** The diff stat a catalogue row carries, which a session's own state does not. */
  const changesOf = (uri: string): Bag => {
    const dir = ctx.dirOf(uri);
    const summary = dir === undefined ? undefined : options.changes?.summary(dir);
    return summary?.files ? { changes: summary } : {};
  };
  /**
   * What a session says about itself beyond the protocol's own fields.
   *
   * One helper for all four places a session is described - the live snapshot,
   * the browsed one, the catalogue row and the notification that moves it -
   * because a row and the session it opens disagreeing is the bug this is
   * meant to avoid.
   *
   * Undefined for a session this host is not running, which is not an error: a
   * row read from a transcript is in the catalogue and has no `Held`.
   */
  const summaryOf = (uri: string): Bag | undefined => {
    const held = sessions.get(uri);
    const lead = held && leadOf(held);
    if (!held || !lead) return undefined;
    return {
      resource: uri,
      provider: held.agent.provider,
      title: lead.title(),
      status: statusOf(uri),
      ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
      createdAt: held.createdAt,
      modifiedAt: modifiedOf(held),
      workingDirectories: lead.workingDirectories(),
      // A row's own field, and a row's alone: `SessionState` does not declare
      // it, so it is added here rather than in `describes`.
      ...changesOf(uri),
      ...ctx.describes(uri),
    };
  };
  /** A session appeared. Carries the whole row, because no client has one yet. */
  const sessionAdded = (uri: string): void => {
    const summary = summaryOf(uri);
    if (!summary) return;
    /*
     * Forgetting what was last sent, because the row that goes with it is one
     * no client has: the added row is a whole row and the next move is a
     * partial, so nothing the client already holds can be what the partial is
     * compared against.
     */
    lastSent.delete(uri);
    ctx.broadcast(ROOT, 'root/sessionAdded', { channel: ROOT, summary });
  };
  /**
   * What each session's last sent `changes` serialised to.
   *
   * The memory that makes the check below possible, and it is bounded by the
   * sessions this host is serving rather than by the catalogue: a row is only
   * compared against what went out for it while it was being served.
   */
  const lastSent = new Map<string, string>();
  /** A session's row is gone, so nothing it was sent can be compared to. */
  const forgetSent = (uri: string): void => {
    lastSent.delete(uri);
  };
  /**
   * A session already in the catalogue moved.
   *
   * `session` and `changes`, which are the names the protocol gives these. This
   * carried `resource` and a whole `summary` under names of its own, so a
   * client read `undefined` for both and its cached list never moved.
   *
   * `changes` is a *partial*: only fields that can change belong in it, and the
   * three identity fields - `resource`, `provider`, `createdAt` - MUST be left
   * out. Every mutable field goes rather than a computed diff, because they are
   * all read off live objects in one pass anyway and a client applying a field
   * to the value it already had is a no-op.
   *
   * A session with no agent running still has a status - read and archived are
   * this host's bits and belong to the row rather than to any process - so the
   * fallback is that one field rather than silence. Silence is what this did
   * before, and it was exactly the case that needed saying: marking a row read
   * is something somebody does from the catalogue, to a session nobody has
   * opened. Its diff stat goes with it, which is the directory's and is known
   * without any process: a listed row's counts are read after it was listed.
   *
   * And nothing at all is sent when the row is the row that went out last,
   * because the five callers of this are reached on every turn, every tool
   * call and every re-read of a directory - and for most of those the row is
   * byte for byte the one every client is already holding. One build session
   * sent about 28 of these a second, of which 210 of 225 in a row were
   * identical to the one before.
   */
  const summaryMoved = (uri: string): void => {
    const summary = summaryOf(uri);
    let changes: Bag = { status: statusOf(uri), ...changesOf(uri) };
    if (summary !== undefined) {
      const { resource: _resource, provider: _provider, createdAt: _createdAt, ...mutable } = summary;
      /*
       * `activity: null` when there is none, rather than no key.
       *
       * A partial is applied by spreading it over the row a client holds,
       * so a key that is not there is a field that did not change - and a
       * session that has gone idle has no activity to carry, which left
       * every row in the reference client saying what its last tool was
       * doing until something else about it moved. That client reads
       * `null` as "cleared" and its host sends it; the type says `string`,
       * and this is the one place the wire carries what the type does not,
       * because a row that never goes quiet is worse than a field that is
       * off-schema by one value.
       */
      changes = { ...mutable, activity: mutable.activity ?? null };
    }
    sayMoved(uri, changes);
  };
  /**
   * Say a row moved, unless it is the row every client already holds.
   *
   * The one place a `root/sessionSummaryChanged` leaves from, so that "does this
   * say anything new" is decided once rather than by each caller remembering to
   * ask. A live row and a listed row arrive here by different roads and are
   * judged the same way, which is what lets a client keep one list against both.
   */
  const sayMoved = (uri: string, changes: Bag): void => {
    const said = JSON.stringify(changes);
    if (lastSent.get(uri) === said) return;
    lastSent.set(uri, said);
    ctx.broadcast(ROOT, 'root/sessionSummaryChanged', { channel: ROOT, session: uri, changes });
  };
  /**
   * Fill in the models, once there is a CLI to ask.
   *
   * Only when they actually change: `root/agentsChanged` on every handshake
   * would have every client re-reading the same list once per session created.
   */
  const learnModels = (uri: string): void => {
    const session = sessions.get(uri);
    const lead = session && leadOf(session);
    const owner = owners.get(uri);
    if (!lead || !owner)
      return;
    const found = lead.models();
    if (found.length === 0)
      return;
    const learnt = about(owner.provider);
    const same = found.length === learnt.models.length
      && found.every((model, index) => model.id === learnt.models[index]?.id);
    if (same)
      return;
    learnt.models = found;
    ctx.log(`${owner.provider}: ${found.length} model(s): ${found.map((m) => m.id).join(', ')}`);
    ctx.dispatch(ROOT, { type: 'root/agentsChanged', agents: ctx.descriptors() });
  };

  const listing = async (before: Summary[] = []): Promise<Summary[]> => {
    const claimed = new Set<string>();
    for (const [uri, held] of sessions) {
      claimed.add(idFor(uri));
      for (const chat of held.chats.values()) {
        const own = chat.agentId();
        if (own)
          claimed.add(own);
      }
    }
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
     * `Promise.all` answers in the order it was given its work rather than the
     * order that work finished, so the fold below is still the load order - and
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
        if (claimed.has(row.id))
          continue;
        const both = offered.get(row.id);
        if (both === undefined) offered.set(row.id, [{ agent, row }]);
        else both.push({ agent, row });
      }
    }
    const found: Summary[] = [];
    for (const [id, both] of offered) {
      /*
       * Whose this row is, which two harnesses reading one directory cannot
       * say between them: a transcript names the CLI that wrote it and not the
       * plugin that started it. The host recorded the answer when the session
       * ran, and that is the one loaded agent it names.
       *
       * An agent this host recorded but is not serving is not the first one to
       * read the transcript, and the row keeps its own provider rather than the
       * reader's: listed under somebody else's id it would be opened by
       * whichever agent answered, and a conversation would move to another
       * endpoint on a daemon that merely failed to load one plugin. It waits
       * for its agent instead, and no owner is recorded, so nothing can open
       * it here. A session recorded before anything was has no agent to wait
       * for and still goes to the first one that listed it.
       */
      const recorded = kept.provider(id);
      const waiting = recorded !== undefined && !agents.has(recorded) ? recorded : undefined;
      const one = waiting === undefined ? both.find((it) => it.agent.provider === recorded) ?? both[0] : both[0];
      // Never empty: an id is in the map only because an agent listed it.
      if (one === undefined) continue;
      found.push(adopt(one.agent, one.row, waiting));
    }
    /*
     * What a refusing backend had last time, kept as it was.
     *
     * A backend that did not answer said nothing about its sessions, and this
     * host reads that as what it is rather than as a store that was emptied
     * between one pass and the next. So its rows carry over: they are still what
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
     */
    const forgotten: Array<[string, Record<string, unknown> | undefined]> = [];
    const gone = (id: string): boolean => {
      if (claimed.has(id) || offered.has(id))
        return false;
      const provider = kept.provider(id);
      if (provider === undefined || !spoken.has(provider))
        return false;
      const named = names.get(id);
      const dir_ = named === undefined ? undefined : ctx.dirOf(named);
      if (named === undefined || dir_ === undefined || !read.has(dir_)) return false;
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
   * the same thing told twice, so they build it the same way here rather than
   * in each.
   *
   * `waiting` is a provider the host recorded for this session and is not
   * serving, so the row keeps its own provider and no owner: nothing here can
   * open it, and the session waits for the agent it actually ran on.
   */
  const adopt = (agent: Agent, row: Listed, waiting?: string): Summary => {
    const provider = waiting ?? agent.provider;
    const resource = `${provider}:/${row.id}`;
    names.set(row.id, resource);
    if (waiting === undefined) owners.set(resource, agent);
    wheres.set(resource, row.workingDirectories);
    births.set(resource, row.createdAt);
    moves.set(resource, row.modifiedAt);
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
   * A listed row this host did not have, said whole.
   *
   * `sessionAdded` speaks for a session this host is running and builds the row
   * from it; this one is a row a backend answered for a session that is not
   * being run, which is what a client opening a link from another machine finds.
   *
   * Forgetting what was last sent, as that one does: the row that goes with it
   * is one no client has, so nothing a client holds can be what the next move is
   * compared against.
   */
  const rowAdded = (summary: Summary): void => {
    lastSent.delete(summary.resource);
    ctx.broadcast(ROOT, 'root/sessionAdded', { channel: ROOT, summary });
  };

  /**
   * The rows of the sessions this host is running, built now.
   *
   * Not held, and that is the whole of the decision behind it: a live row
   * moves every second and building one reads a handful of in-memory objects,
   * while a backend row costs a pass over every transcript on the machine. The
   * held catalogue keeps the expensive half and this is rebuilt on each answer,
   * so a session somebody is looking at is never a second behind.
   */
  const liveRows = (): Summary[] => {
    // Sessions this host started are real and are not listed by a backend yet.
    // A catalogue that dropped them would lose the one being looked at.
    const live: Summary[] = [];
    for (const [uri, held] of sessions) {
      const lead = leadOf(held);
      if (!lead)
        continue;
      const started = origins.get(uri);
      live.unshift({
        resource: uri,
        provider: held.agent.provider,
        title: lead.title(),
        status: statusOf(uri),
        // What it is doing, so a list of twenty sessions says which one is
        // busy with what rather than only which one is busy.
        ...(activityOf(held) !== undefined ? { activity: activityOf(held) } : {}),
        createdAt: held.createdAt,
        modifiedAt: modifiedOf(held),
        workingDirectories: lead.workingDirectories(),
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
   * has to reconcile.
   */
  const allRows = async (): Promise<Summary[]> => {
    const running = liveRows();
    const claimed = new Set(running.map((row) => idFor(row.resource)));
    const listed = await ctx.held();
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
   * Read here rather than at listing time, or a client that marked a row and
   * listed again would be handed the flag it had just set one refresh late, and
   * the list it was holding would disagree with the notification that told it
   * about the change.
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
   * What a refresh found, told to every client.
   *
   * The catalogue is held, so nobody has to ask for it to learn that a session
   * appeared or is gone: what changed since the last listing goes out as the
   * three protocol notifications a client already reduces its list against.
   *
   * A row this host is running is left out entirely. `summaryMoved` speaks for
   * it, every second or so, and a row listed here is built from a listing that
   * is already behind by the time it is answered.
   */
  const rowsMoved = (before: Summary[], after: Summary[]): void => {
    /*
     * Nothing is said on the first fill.
     *
     * A host that has answered nobody has told nobody, so a listing's whole
     * contents are not an addition to an empty catalogue - and every client
     * connected while this was read gets its catalogue from the answer to its
     * own `listSessions` rather than from a flood of additions.
     */
    if (before.length === 0) return;
    const was = new Map(before.map((row) => [row.resource, row]));
    for (const row of after) {
      const had = was.get(row.resource);
      was.delete(row.resource);
      if (sessions.has(row.resource))
        continue;
      if (had === undefined) {
        lastSent.delete(row.resource);
        ctx.broadcast(ROOT, 'root/sessionAdded', { channel: ROOT, summary: row });
        continue;
      }
      if (!movedSince(had, row)) continue;
      /*
       * A whole mutable row rather than the fields that differ, because a
       * client applies a partial by spreading it over what it holds and
       * setting a field to the value it already has costs nothing.
       */
      const { resource: _resource, provider: _provider, createdAt: _createdAt, ...mutable } = row;
      sayMoved(row.resource, mutable);
    }
    for (const [resource] of was) {
      forgetSent(resource);
      ctx.broadcast(ROOT, 'root/sessionRemoved', { channel: ROOT, session: resource });
    }
  };
  /**
   * Whether a listed row says anything a client does not already hold.
   *
   * The fields a listing can change and nothing else: `resource`, `provider`
   * and `createdAt` are who the row is rather than what it says, and `_meta` is
   * the session's own channel to change them on. Everything else on a row is
   * read off the transcript, so it is one of these or it does not move.
   */
  const movedSince = (was: Summary, now: Summary): boolean => {
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
   * The agent a stored session is waiting for, or nothing.
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
  const waitingFor = (id: string): string | undefined => {
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
        if (!sessions.has(row.resource) && ctx.dirOf(row.resource) === dir_) summaryMoved(row.resource);
      }
    }
  };

  return {
    statusOf, startedBy, chatSummary, subagentSummary, restoredSubagentSummary,
    activityOf, sessionAdded, summaryMoved, forgetSent, activeSessionsMoved, learnModels,
    listing, adopt, rowAdded, liveRows, allRows, rowsMoved, waitingFor, readStored,
  };
}
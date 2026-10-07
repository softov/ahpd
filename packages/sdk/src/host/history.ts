import { idFor } from '../catalog.js';
import { subagentChatUri } from './channels.js';
import type { Agent, Listed } from '../types/agent.js';
import type { Bag } from '../types/common.js';
import type { Summary } from '../types/catalog.js';
import type { WireTurn } from '../types/wire.js';
import type { HostContext } from './context.js';
import type { Turn } from '@microsoft/agent-host-protocol';

/** What a session that already happened offers the rest of the host. */
export interface History {
  history: Map<string, Bag[]>;
  subHistory: Map<string, Bag[]>;
  titles: Map<string, string>;
  restoredSubagents(id: string, owner: Agent, turns?: WireTurn<Turn>[]): Promise<Bag[]>;
  restoredParentChat(session: string, lead: string, one: Bag): string;
  linkedTurns(session: string, turns: Bag[], workers: Bag[]): Bag[];
  /**
   * A new listing of the backends, shared with every other caller that asks
   * while it runs, and told to the clients as it lands.
   */
  refresh(): Promise<Summary[]>;
  /** The rows as last listed: held when there are any, and the first listing when there are not. */
  held(): Promise<Summary[]>;
  past(id: string): Promise<Bag[] | undefined>;
  /** A session deleted here, out of the rows this host is holding, by id. */
  drop(resource: string): void;
}

export function createHistory(ctx: HostContext): History {
  const { owners, nameOf, listing } = ctx;

  /**
   * A session that already happened, read from its transcript.
   *
   * Cached, because a client subscribes to the session channel and then to the
   * chat channel and both want the same turns - reading the file twice per
   * open would be this host doing the same work to answer the same question.
   */
  const history = new Map<string, Bag[]>();
  /**
   * Transcripts being read right now, so two callers share one read.
   *
   * Not a second cache: an entry lives only for the length of the read and is
   * dropped whether it answered or threw. `history` is what remembers.
   */
  const reading = new Map<string, Promise<Bag[] | undefined>>();
  /**
   * The worker chats a past session holds, read once per session.
   *
   * The counterpart of `history` for the conversations that ran inside the
   * session's calls. Their own files are small, so this is the array and not a
   * promise: the read is one directory listing and one file per worker.
   */
  const subHistory = new Map<string, Bag[]>();
  /** A session's restored workers; an answer is kept only when the read succeeded. */
  const restoredSubagents = async (id: string, owner: Agent, turns?: WireTurn<Turn>[]): Promise<Bag[]> => {
    const held = subHistory.get(id);
    if (held !== undefined) return held;
    if (owner.subagents === undefined) return [];
    let found: Awaited<ReturnType<NonNullable<Agent['subagents']>>>;
    try { found = await owner.subagents(id, turns); }
    catch { return []; }
    const built = (found ?? []).map((one) => ({ ...one } as unknown as Bag));
    subHistory.set(id, built);
    return built;
  };
  /** The chat a restored worker's call is in: its parent worker's, or the session's lead chat. */
  const restoredParentChat = (session: string, lead: string, one: Bag): string =>
    (one.parentToolCallId !== undefined && String(one.parentToolCallId) !== ''
      ? subagentChatUri(session, String(one.parentToolCallId))
      : lead);
  /**
   * A past session's turns, with each worker linked from the call that ran it.
   *
   * The forward half of the pair the protocol requires: the worker's chat says
   * which call spawned it, and the call says which worker it spawned. A copy,
   * because the turn arrays are the cached transcript itself.
   */
  const linkedTurns = (session: string, turns: Bag[], workers: Bag[]): Bag[] => {
    if (workers.length === 0) return turns;
    return turns.map((turn) => {
      const parts = Array.isArray(turn.responseParts) ? turn.responseParts as Bag[] : undefined;
      if (parts === undefined) return turn;
      let touched = false;
      const next = parts.map((part) => {
        const call = (part.toolCall ?? {}) as Bag;
        const callId = typeof call.toolCallId === 'string' ? call.toolCallId : undefined;
        if (callId === undefined) return part;
        const one = workers.find((held) => String(held.toolCallId ?? '') === callId);
        if (one === undefined) return part;
        touched = true;
        const resource = subagentChatUri(session, callId);
        const held = (Array.isArray(call.content) ? call.content as Bag[] : [])
          .filter((block) => !(block.type === 'subagent' && block.resource === resource));
        const content = {
          type: 'subagent',
          resource,
          title: String(one.title ?? 'Subagent'),
          ...(one.agentName !== undefined ? { agentName: one.agentName } : {}),
          ...(one.description !== undefined ? { description: one.description } : {}),
        };
        return { ...part, toolCall: { ...call, content: [...held, content] } };
      });
      return touched ? { ...turn, responseParts: next } : turn;
    });
  };
  /**
   * The catalogue's own title, kept when a row is opened.
   *
   * Deriving one from the first message looks right and is not: a first
   * message routinely opens with editor context the person never typed, so
   * every row would be titled `<ide_opened_file>…`. The catalogue already
   * carries a real summary - the row and the session it opens should not
   * disagree about what the conversation is called.
   */
  const titles = new Map<string, string>();
  /**
   * The backend rows as last listed, and what holds them up to date.
   *
   * The catalogue used to be listed for every `listSessions` and every
   * subscribe to a session this host is not running, and each of those is a
   * pass over every transcript on the machine. It is listed here once, held
   * while clients come and go, and brought up to date by a refresh a
   * `listSessions` starts behind its own answer - so a client that asks
   * twice pays for one listing and sees what changed either way.
   */
  let rows: Summary[] = [];
  /** The listing in flight, so a second ask joins it rather than starting one. */
  let refreshing: Promise<Summary[]> | undefined;
  /**
   * How many listings have been started.
   *
   * What a delete is dated by, and what tells a caller whether the pass running
   * now began before it asked: the number only moves when a pass begins, so one
   * above the count a caller read is a pass that read the store after that
   * caller's question was asked.
   */
  let passes = 0;
  /**
   * The sessions deleted here, against the pass each delete happened in.
   *
   * A pass that was already out read the store before the delete, so what it
   * finds still has a row for a session this host has said is gone. Dated, so
   * a pass knows whether it is one of those - and kept until a pass that
   * started after the delete lands, since that is the first one that read the
   * store knowing about it.
   */
  const droppedIn = new Map<string, number>();
  /**
   * List the backends again, and tell every client what moved.
   *
   * One at a time: two callers inside the same listing get the same rows, and
   * the second does not have a catalogue of its own to diff against the
   * first. What went out for each row is compared here, once, rather than by
   * each caller working out what its own answer changed.
   *
   * A listing that throws leaves the held rows as they were, and a backend that
   * refuses inside a listing that answered keeps the rows it had last time: a
   * backend that is not answering is a backend with nothing to say, not one whose
   * sessions have been deleted. Either way a failed pass costs a client a
   * catalogue it already had rather than an empty one - and, for the second,
   * does not tell it to close the sessions it has open.
   */
  const refresh = (): Promise<Summary[]> => {
    const already = refreshing;
    if (already !== undefined) return already;
    /*
     * The pass this is, and what it is allowed to bring back.
     *
     * A delete dates itself with the pass it happened in, and that pass is the
     * one that can still be carrying the row: what it read, and the rows it is
     * diffed against, are both filtered by it. `rows` is taken here rather
     * than read again when the listing lands, because a delete during the
     * listing replaces it - and a delete's own rows are the ones this pass has
     * to be judged against.
     */
    const startedAt = ++passes;
    const goneWhileOut = (row: Summary): boolean => {
      const dropped = droppedIn.get(idFor(row.resource));
      return dropped !== undefined && dropped >= startedAt;
    };
    const asked = (async (): Promise<Summary[]> => {
      const before = rows;
      const listed = await listing(before);
      const found = listed.filter((row) => !goneWhileOut(row));
      ctx.rowsMoved(before.filter((row) => !goneWhileOut(row)), found);
      rows = found;
      // A pass that started after a delete read the store knowing about it, so
      // a delete older than this pass has nothing left to hold back.
      for (const [id, dropped] of droppedIn) if (dropped < startedAt) droppedIn.delete(id);
      return found;
    })();
    refreshing = asked;
    const clear = (): void => { if (refreshing === asked) refreshing = undefined; };
    asked.then(clear, clear);
    return asked;
  };
  /**
   * A session deleted here, out of the rows this host is holding.
   *
   * A delete lists nothing, so a row the backend's store has lost is still the
   * row a `listSessions` answers with - and a client is offered the session it
   * was just told is gone. Removed here, and dated, so the pass behind that
   * answer cannot put it back either.
   *
   * By id, because the two names a session answers to are one session: a
   * delete under either spelling drops the row under both.
   */
  const drop = (resource: string): void => {
    const id = idFor(resource);
    rows = rows.filter((row) => idFor(row.resource) !== id);
    droppedIn.set(id, passes);
  };
  /**
   * The catalogue as `listSessions` and `past` read it: the held rows, or the
   * first listing when there has not been one.
   *
   * Empty rather than waiting is the case that decides the shape: a host that
   * has not listed yet has nothing to answer with, and the first client to ask
   * is the one who pays for the listing. Everyone after it is answered from
   * what that one left behind.
   */
  const held = (): Promise<Summary[]> => (rows.length === 0 ? refresh() : Promise.resolve(rows));
  /**
   * A listing of its own, for an id the held rows do not have.
   *
   * `asked` is the pass count its caller read before it asked anybody anything.
   * A pass running now that is numbered above it began after that question, and
   * so read the store knowing the session might be there - it is joined, and
   * whoever else is asking is answered by the same listing. A pass numbered at
   * or below it began before the caller knew it wanted the row: a session
   * written to disk while a pass was in flight is exactly the case this is here
   * for, and joining that pass would answer the same way it always does. So it
   * is waited out and followed by a pass of this caller's own.
   */
  const relist = async (asked: number): Promise<Summary[]> => {
    const running = refreshing;
    if (running !== undefined) {
      if (passes > asked) return await running;
      await running.catch(() => {});
    }
    return await refresh();
  };
  /**
   * One backend's row for an id, from the backends that can answer by id.
   *
   * The recorded provider first, then the rest in load order. A transcript does
   * not say which harness wrote it, so the record is what the host wrote when
   * the session ran - but a row is opened on this host and not on the machine
   * that wrote it, so a backend that did not record anything is asked too.
   *
   * A backend that refuses is a backend with nothing to say, the same as one
   * that answers nothing: the others are still asked.
   */
  const findOf = async (id: string): Promise<{ agent: Agent; row: Listed } | undefined> => {
    const asked = [...ctx.agents.values()].filter((agent) => agent.find !== undefined);
    const recorded = ctx.kept.provider(id);
    const order = recorded === undefined
      ? asked
      : [...asked.filter((agent) => agent.provider === recorded), ...asked.filter((agent) => agent.provider !== recorded)];
    for (const agent of order) {
      const row = await agent.find?.(id).catch(() => undefined);
      if (row !== undefined) return { agent, row };
    }
    return undefined;
  };
  /**
   * Whether any backend here lists without being able to answer about one session.
   *
   * What decides whether a missing id costs a listing. A backend with `find` is
   * asked about the id instead, and one with neither `list` nor `find` has its
   * own sessions nowhere the host could find them - a listing would turn up
   * nothing, having nothing to list with.
   */
  const someCannotSay = (): boolean =>
    [...ctx.agents.values()].some((agent) => agent.list !== undefined && agent.find === undefined);
  const past = async (id: string): Promise<Bag[] | undefined> => {
    // Read before anything is asked of anybody, so a listing this open goes on
    // to start cannot be mistaken for one that was already out.
    const askedPass = passes;
    const cached = history.get(id);
    if (cached)
      return cached;
    /*
     * One read per transcript, however many callers arrive together.
     *
     * A client opens a session by subscribing to three channels in one breath
     * - the session, its chat and its annotations - and all three ask for the
     * same turns. Without this each of them missed the cache, because none had
     * finished filling it, and the file was read three times *concurrently*.
     * The turns that come out are small; the read is not. A 35MB transcript
     * costs about 120MB of resident memory while it is being parsed, so a
     * session opened this way cost 360MB of it at once, and several sessions
     * opened together multiplied that again.
     */
    const already = reading.get(id);
    if (already) return await already;
    const asked = (async (): Promise<Bag[] | undefined> => {
      // The held rows are what says whose session this is, so they are read
      // first, and nothing is listed to find a row that is in them.
      let row = rows.find((item) => idFor(item.resource) === id);
      /*
       * A nested session, opened from what this host recorded of it.
       *
       * Its transcript is the inner host's, in the machine, so there are no
       * turns to read here: it opens empty, and the first turn resumes it
       * inside, where the earlier turns are.
       */
      const record = ctx.kept.nested?.(id);
      const runs = record === undefined ? undefined : ctx.agents.get(record.provider);
      if (record !== undefined && runs !== undefined) {
        if (!row) {
          const { title, createdAt, modifiedAt, workingDirectories } = record;
          const found = ctx.adopt(runs, { id, title, createdAt, modifiedAt, workingDirectories });
          ctx.rowAdded(found);
          rows.push(found);
          row = found;
        }
        titles.set(id, row.title);
        return [];
      }
      if (!row) {
        const one = await findOf(id);
        if (one !== undefined) {
          /*
           * Recorded and held, rather than remembered for this caller only.
           *
           * What the host knows about a row is what a client is sent for the
           * next move of it, and this row is in the catalogue as surely as one
           * a listing found - so it goes in with the rest, is said to every
           * client, and the next opening of it asks nobody anything.
           */
          const found = ctx.adopt(one.agent, one.row);
          ctx.rowAdded(found);
          if (!rows.some((heldRow) => heldRow.resource === found.resource)) rows.push(found);
          row = found;
        }
      }
      if (!row && someCannotSay()) {
        /*
         * One more listing for an id the held rows do not have.
         *
         * Only for a backend that cannot be asked about one session, which is
         * the store this worked before it could be: a listing is all it has.
         * One per missing id, shared with whoever else is asking while it runs -
         * `relist` is what decides which pass answers - and nothing else bounds
         * how often that is, because a client opening sessions nobody has is
         * asking the only question such a backend can be asked.
         */
        row = (await relist(askedPass)).find((item) => idFor(item.resource) === id);
      }
      const owner = owners.get(nameOf(id));
      if (!row || !owner?.transcript)
        return undefined;
      titles.set(id, row.title);
      const built = await owner.transcript(id);
      if (!built)
        return undefined;
      /*
       * Kept only when it has turns.
       *
       * An empty answer is what a read that failed and a session with nothing
       * in it both look like from this port, and keeping it turns one bad read
       * into a session that draws nothing for the life of this process. The
       * answer is served either way, so a row the catalogue vouches for still
       * opens; what it is not is remembered. A read that did have turns is the
       * large one this cache exists for, and is kept.
       */
      if (built.length > 0)
        history.set(id, built);
      return built;
    })();
    reading.set(id, asked);
    try { return await asked; }
    finally { reading.delete(id); }
  };

  return {
    history, subHistory, titles, restoredSubagents, restoredParentChat, linkedTurns, refresh, held, past,
    drop,
  };
}

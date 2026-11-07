import { idFor } from '../sessions/catalog.js';
import { chatUriFor, subagentChatUri } from './channels.js';
import type { Agent, Listed, SessionAt } from '../types/agent.js';
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
  /**
   * The folder a session's record says it ran in, which a backend is handed
   * to find or read the session in, or nothing where the record names none:
   * its launch working directory, as VS Code calls the folders it hands a
   * provider for a chat whose own storage records none.
   */
  launchWorkingDirectory(id: string): SessionAt | undefined;
  restoredParentChat(session: string, lead: string, one: Bag): string;
  linkedTurns(session: string, turns: Bag[], workers: Bag[]): Bag[];
  /**
   * A new listing of the backends, shared with every other caller that asks
   * while it runs, and told to the clients as it lands.
   */
  refresh(): Promise<Summary[]>;
  /** The listed sessions' summaries as last listed, and the first listing where there are none yet. */
  listedSessions(): Promise<Summary[]>;
  /** A stored session restored: its row found, and its turns read, or nothing for a session nobody has. */
  restoreSession(id: string): Promise<Bag[] | undefined>;
  /** A session deleted here, removed from the listed sessions this host holds, by id. */
  removeListedSession(resource: string): void;
  /**
   * A session this host stopped running, its state evicted and its summary
   * listed from here.
   *
   * Its turns are read again when it is next opened, since the backend has
   * written more of them than any held answer carries.
   */
  evictSessionState(row: Summary): void;
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
   * An entry lives for the length of the read and is dropped whether it
   * answered or threw. `history` is what remembers.
   */
  const reading = new Map<string, Promise<Bag[] | undefined>>();
  /**
   * The worker chats a stored session holds, read once per session.
   *
   * The counterpart of `history` for the conversations that ran inside the
   * session's calls. Their own files are small, so this holds the read arrays
   * themselves: the read is one directory listing and one file per worker.
   */
  const subHistory = new Map<string, Bag[]>();
  /*
   * As VS Code hands a provider a chat's launch working directories.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/agent.ts#L840
   */
  const launchWorkingDirectory = (id: string): SessionAt | undefined => {
    const workingDirectory = ctx.kept.workingDirectory?.(id);
    return workingDirectory === undefined ? undefined : { workingDirectory };
  };
  /** A session's restored workers; an answer is kept only when the read succeeded. */
  const restoredSubagents = async (id: string, owner: Agent, turns?: WireTurn<Turn>[]): Promise<Bag[]> => {
    const held = subHistory.get(id);
    if (held !== undefined) return held;
    if (owner.subagents === undefined) return [];
    let found: Awaited<ReturnType<NonNullable<Agent['subagents']>>>;
    try { found = await owner.subagents(id, turns, launchWorkingDirectory(id)); }
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
        // The link rides the call's content, which a call that never finished
        // does not carry; its worker's chat names the call from its origin.
        if (one === undefined || call.status === 'cancelled') return part;
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
   * The catalogue carries a real summary, and the row and the session it
   * opens agree about what the conversation is called. A first message
   * routinely opens with editor context the person never typed, so a title
   * drawn from it would read `<ide_opened_file>…`.
   */
  const titles = new Map<string, string>();
  /**
   * The listed sessions' summaries as the backends last listed them, and what
   * holds them up to date.
   *
   * A listing is a pass over every transcript on the machine. It runs here
   * once, its summaries held while clients come and go and brought up to date
   * by a refresh a `listSessions` starts behind its own answer, so a client
   * that asks twice pays for one listing and sees what changed either way.
   */
  let listedSummaries: Summary[] = [];
  /**
   * The listing in flight, which a second ask joins, as VS Code coalesces
   * concurrent session listings.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5125
   */
  let inFlightListSessions: Promise<Summary[]> | undefined;
  /**
   * The epoch of the listings: how many have been started, as VS Code dates its
   * session listings by an epoch.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L5127-L5131
   *
   * What a delete is dated by, and what tells a caller whether the pass running
   * now began before it asked: the number moves when a pass begins, so one
   * above the count a caller read is a pass that read the store after that
   * caller's question was asked.
   */
  let listingEpoch = 0;
  /**
   * The sessions deleted here, against the epoch each delete happened in.
   *
   * A pass that was already out read the store before the delete, so what it
   * finds still has a row for a session this host has said is gone. Dated, so
   * a pass knows whether it is one of those, and kept until a pass that
   * started after the delete lands, since that is the first one that read the
   * store knowing about it.
   */
  const removedInEpoch = new Map<string, number>();
  /**
   * List the backends again, and tell every client what changed.
   *
   * One at a time: two callers inside the same listing get the same rows, and
   * the second has no catalogue of its own to diff against the first. What
   * went out for each row is compared here, once, for every caller.
   *
   * A listing that throws leaves the held rows as they were, and a backend that
   * refuses inside a listing that answered keeps the rows it had last time: a
   * backend that is not answering is a backend with nothing to say, its
   * sessions all still there. Either way a failed pass leaves a client the
   * catalogue it already had, with the sessions it has open.
   */
  const refresh = (): Promise<Summary[]> => {
    const already = inFlightListSessions;
    if (already !== undefined) return already;
    /*
     * The pass this is, and what it is allowed to bring back.
     *
     * A delete dates itself with the epoch it happened in, and the pass of that
     * epoch is the one that can still be carrying the row: what it read, and
     * the rows it is diffed against, are both filtered by it. The held
     * summaries are taken here, when the pass starts, because a delete during
     * the listing replaces them, and a delete's own rows are the ones this pass
     * has to be judged against.
     */
    const startedAt = ++listingEpoch;
    const goneWhileOut = (row: Summary): boolean => {
      const removed = removedInEpoch.get(idFor(row.resource));
      return removed !== undefined && removed >= startedAt;
    };
    const asked = (async (): Promise<Summary[]> => {
      const before = listedSummaries;
      const listed = await listing(before);
      const found = listed.filter((row) => !goneWhileOut(row));
      ctx.publishSurfacedSessions(before.filter((row) => !goneWhileOut(row)), found);
      listedSummaries = found;
      // A pass that started after a delete read the store knowing about it, so
      // a delete older than this pass has nothing left to hold back.
      for (const [id, removed] of removedInEpoch) if (removed < startedAt) removedInEpoch.delete(id);
      return found;
    })();
    inFlightListSessions = asked;
    const clear = (): void => { if (inFlightListSessions === asked) inFlightListSessions = undefined; };
    asked.then(clear, clear);
    return asked;
  };
  /**
   * A session deleted here, removed from the listed sessions this host holds,
   * as VS Code removes a deleted session so that no listing brings it back.
   *
   * A delete lists nothing, so a row the backend's store has lost is still the
   * row a `listSessions` answers with, and a client is offered the session it
   * was just told is gone. Removed here, and dated, so the pass behind that
   * answer cannot put it back either.
   *
   * By id, the key a row and the store's record share: one id is one session
   * here, whatever scheme its URI is in.
   */
  const removeListedSession = (resource: string): void => {
    const id = idFor(resource);
    listedSummaries = listedSummaries.filter((row) => idFor(row.resource) !== id);
    removedInEpoch.set(id, listingEpoch);
  };
  /**
   * The catalogue as `listSessions` and `restoreSession` read it: the held
   * summaries, or the first listing when there has not been one.
   *
   * A host that has not listed yet has nothing to answer with, so the first
   * client to ask is the one who pays for the listing, and everyone after it
   * is answered from what that one left behind.
   */
  const listedSessions = (): Promise<Summary[]> =>
    (listedSummaries.length === 0 ? refresh() : Promise.resolve(listedSummaries));
  /**
   * A listing of its own, for an id the held rows do not have.
   *
   * `asked` is the epoch its caller read before it asked anybody anything. A
   * pass running now that is numbered above it began after that question, and
   * so read the store knowing the session might be there: it is joined, and
   * whoever else is asking is answered by the same listing. A pass numbered at
   * or below it began before the caller knew it wanted the row: a session
   * written to disk while a pass was in flight is exactly the case this is here
   * for, and that pass answers without it. So it is waited out and followed by
   * a pass of this caller's own.
   */
  const relist = async (asked: number): Promise<Summary[]> => {
    const running = inFlightListSessions;
    if (running !== undefined) {
      if (listingEpoch > asked) return await running;
      await running.catch(() => {});
    }
    return await refresh();
  };
  /**
   * A recorded session's row, asked by id of the backend its record names,
   * as VS Code's host routes a session by its registry's association alone.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostProviderService.ts#L141-L152
   *
   * Told the folder the record names, so a session that ran outside the paths
   * the backend serves is looked for where it ran. A backend that refuses has
   * nothing to say about it.
   */
  const findOf = async (id: string): Promise<{ agent: Agent; row: Listed } | undefined> => {
    const recorded = ctx.kept.provider(id);
    const agent = recorded === undefined ? undefined : ctx.agents.get(recorded);
    if (agent?.find === undefined) return undefined;
    const row = await agent.find(id, launchWorkingDirectory(id)).catch(() => undefined);
    return row === undefined ? undefined : { agent, row };
  };
  /**
   * Whether a missing id costs a listing: a session with no record is found
   * through a backend's own listing alone, as VS Code's host discovers one
   * through its registry's listing, and so is a recorded one whose backend
   * can be asked by id about none.
   */
  const listedOnly = (id: string): boolean => {
    const recorded = ctx.kept.provider(id);
    return recorded === undefined || ctx.agents.get(recorded)?.find === undefined;
  };
  /**
   * A stored session restored, as VS Code restores a session and its turns:
   * its row from the held summaries, else asked of the backends by id and
   * announced, else from one more listing; then its turns, or nothing for a
   * session nobody has.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostSessionLifecycle.ts#L28
   */
  const restoreSession = async (id: string): Promise<Bag[] | undefined> => {
    // Read before anything is asked of anybody, so a listing this open goes on
    // to start cannot be mistaken for one that was already out.
    const askedEpoch = listingEpoch;
    const cached = history.get(id);
    if (cached)
      return cached;
    /*
     * One read per transcript, however many callers arrive together.
     *
     * A client opens a session by subscribing to three channels in one breath
     * - the session, its chat and its annotations - and all three ask for the
     * same turns, each before any has finished filling the cache, so they
     * share the one read in flight. The turns that come out are small; the
     * read is not. A 35MB transcript costs about 120MB of resident memory while
     * it is being parsed, so three concurrent reads of one session would cost
     * 360MB of it at once, and several sessions opened together multiplied
     * that again.
     */
    const already = reading.get(id);
    if (already) return await already;
    const asked = (async (): Promise<Bag[] | undefined> => {
      // The held rows are what says whose session this is, so they are read
      // first, and nothing is listed to find a row that is in them.
      let row = listedSummaries.find((item) => idFor(item.resource) === id);
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
          // Named as a listing names it, which is one name for the row
          // whichever road reached it first.
          const found = ctx.registerListedSession(runs, { id, title, createdAt, modifiedAt, workingDirectories }, undefined, ctx.kept.sessions().includes(id));
          ctx.announceSurfacedSession(found);
          listedSummaries.push(found);
          row = found;
        }
        titles.set(id, row.title);
        return [];
      }
      if (!row) {
        const one = await findOf(id);
        if (one !== undefined) {
          /*
           * Registered and held for every caller.
           *
           * What the host knows about a row is what a client is sent for the
           * next change of it, and this row is in the catalogue as surely as
           * one a listing found, so it goes in with the rest, is announced to
           * every client, and the next opening of it asks nobody anything. It
           * is named as a listing names it: a row this host keeps a record for
           * keeps the name its clients hold.
           */
          const found = ctx.registerListedSession(one.agent, one.row, undefined, ctx.kept.sessions().includes(id));
          ctx.announceSurfacedSession(found);
          if (!listedSummaries.some((heldRow) => heldRow.resource === found.resource)) listedSummaries.push(found);
          row = found;
        }
      }
      if (!row && listedOnly(id)) {
        /*
         * One more listing for an id the held rows do not have.
         *
         * For a session no record names a backend for, or whose backend cannot
         * be asked about one session: a listing is all there is. One per
         * missing id, shared with whoever else is asking while it runs
         * (`relist` decides which pass answers), and nothing else bounds how
         * often that is, because a client opening sessions nobody has is asking
         * the one question a listing answers.
         */
        row = (await relist(askedEpoch)).find((item) => idFor(item.resource) === id);
      }
      const owner = owners.get(nameOf(id));
      if (!row || !owner?.transcript)
        return undefined;
      titles.set(id, row.title);
      // The session's own transcript is its first chat's, the chat its record
      // keeps under the session's id, and the outputs handed with it and the
      // local turns put back in it are that chat's.
      const own = (ctx.kept.nested?.(id) === undefined ? ctx.heldChats(id).find((one) => ctx.ownChat(nameOf(id), one.uri))?.uri : undefined)
        ?? chatUriFor(nameOf(id));
      const built = await ctx.transcriptOf(owner, id, launchWorkingDirectory(id), nameOf(id), own);
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

  /**
   * A session this host stopped running, its cached turns evicted and its
   * summary held in the listing, as VS Code evicts an idle session's state
   * while its listing goes on carrying it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentService.ts#L11906
   */
  const evictSessionState = (row: Summary): void => {
    const id = idFor(row.resource);
    history.delete(id);
    subHistory.delete(id);
    // Before the first listing there is nothing held to add it to: that
    // listing reads the backend, which lists it.
    if (listingEpoch === 0) return;
    listedSummaries = [...listedSummaries.filter((one) => idFor(one.resource) !== id), row];
  };

  return {
    history, subHistory, titles, restoredSubagents, launchWorkingDirectory, restoredParentChat, linkedTurns, refresh,
    listedSessions, restoreSession, removeListedSession, evictSessionState,
  };
}

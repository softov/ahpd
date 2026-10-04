import { idFor } from '../catalog.js';
import { subagentChatUri } from './channels.js';
import type { Agent } from '../types/agent.js';
import type { Bag } from '../types/common.js';
import type { Summary } from '../types/catalog.js';
import type { WireTurn } from '../types/wire.js';
import type { HostContext } from './context.js';
import type { Turn } from '@microsoft/agent-host-protocol';

/**
 * How long a listing of the catalogue answers `past` for, in milliseconds.
 *
 * A subscribe to a session this host is not running reads the catalogue to
 * find its row, and whoever subscribes decides how often that is: an id that
 * names nothing is answered from the last listing rather than a new one.
 * An id missing from a listing `past` did not start itself is listed for
 * once more, at most once in this long, since a backend can write a session
 * to disk after the listing it was not in.
 */
const LISTING_FRESH = 2_000;

/** What a session that already happened offers the rest of the host. */
export interface History {
  history: Map<string, Bag[]>;
  subHistory: Map<string, Bag[]>;
  titles: Map<string, string>;
  restoredSubagents(id: string, owner: Agent, turns?: WireTurn<Turn>[]): Promise<Bag[]>;
  restoredParentChat(session: string, lead: string, one: Bag): string;
  linkedTurns(session: string, turns: Bag[], workers: Bag[]): Bag[];
  listNow(): Promise<Summary[]>;
  catalogue(): Promise<Summary[]>;
  past(id: string): Promise<Bag[] | undefined>;
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
  /** The last listing started, by `past` or by `listSessions`, and when. */
  let listed: { at: number; rows: Promise<Summary[]> } | undefined;
  /** When `past` last started a listing of its own. */
  let pastAt = -Infinity;
  /** A new listing, recorded as the one `catalogue` answers with. */
  const listNow = (): Promise<Summary[]> => {
    const rows = listing();
    listed = { at: Date.now(), rows };
    rows.catch(() => { if (listed?.rows === rows) listed = undefined; });
    return rows;
  };
  /**
   * The catalogue as `past` reads it: a listing started within
   * `LISTING_FRESH`, running or finished, or else a new one.
   */
  const catalogue = (): Promise<Summary[]> => {
    if (listed === undefined || Date.now() - listed.at >= LISTING_FRESH) {
      pastAt = Date.now();
      return listNow();
    }
    return listed.rows;
  };
  const past = async (id: string): Promise<Bag[] | undefined> => {
    const held = history.get(id);
    if (held)
      return held;
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
      // The listing is what says whose session this is, so it is asked first.
      const before = pastAt;
      let found = await catalogue();
      let row = found.find((item) => idFor(item.resource) === id);
      if (!row && pastAt === before && Date.now() - pastAt >= LISTING_FRESH) {
        pastAt = Date.now();
        found = await listNow();
        row = found.find((item) => idFor(item.resource) === id);
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
    history, subHistory, titles, restoredSubagents, restoredParentChat, linkedTurns, listNow, catalogue, past,
  };
}

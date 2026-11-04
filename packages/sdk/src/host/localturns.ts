import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import type { Turn } from '@microsoft/agent-host-protocol';
import { idOf } from '../sessions/catalog.js';
import { steerPart } from '../sessions/steer.js';
import { readJsonObject, writeJsonAtomic } from '../utils/jsonfile.js';
import { bag, isRecord, reason, str } from '../utils/values.js';
import type { Agent, SessionAt } from '../types/agent.js';
import type { Bag } from '../types/common.js';
import type { WireTurn } from '../types/wire.js';
import type { HostContext } from './context.js';

/**
 * A turn this host answered itself, kept for its chat.
 *
 * A `!` command's turn is the host's: the host ran the shell, and no agent saw
 * the turn, so no agent's transcript holds it. A chat read back from its
 * transcript after a restart would come back without it. The reference host
 * keeps such a turn as a local turn, anchored to the turn it followed, and
 * puts it back after that turn on every read of the chat.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentHostLocalTurns.ts
 *
 * The anchor is written as the id the backend's transcript gives that turn,
 * which is the id a read after a restart holds. A backend whose transcript
 * names turns its own way says so through `onTurnRecorded`.
 *
 * The same folder records the turns a chat began, by the id its transcript
 * holds each under, which is what a read needs to show a turn as it ran: a
 * backend may write one turn as several of its own, as Claude's CLI writes a
 * steering message it runs after the turn's last answer as a prompt of its
 * own, while the reference keeps that message's answer in the turn it steered.
 * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/claude/CONTEXT.md#L1595-L1609
 */
export interface LocalTurns {
  /**
   * That a chat's turn began, or was written down again, under a transcript id:
   * its own id as it starts, and what `onTurnRecorded` says.
   *
   * `origin` is the message's, where it is not a person's: a turn an
   * automation began reads back as one after a restart, as it ran.
   *
   * Kept for as long as the chat is held, for the anchors of the turns it
   * holds, and in the session's folder for a read after a restart.
   */
  turnRecordedAs(session: string, chat: string, turnId: string, transcriptId: string, origin?: Bag): void;
  /**
   * The message origin a chat's turn began with, where it began with one that
   * is not a person's.
   *
   * Held for the turn still running: a backend that writes the turn under an id
   * of its own says so when it ends, and the record written then carries the
   * same origin as the one written as the turn started.
   */
  turnOriginOf(chat: string, turnId: string): Bag | undefined;
  /**
   * Keep a command's turn that has ended, as the chat holds it in `turns`.
   *
   * Nothing for a turn `turns` does not hold, and nothing where the store keeps
   * no session folder.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L227-L245
   */
  keepLocalTurn(session: string, chat: string, turns: readonly Bag[], turnId: string): void;
  /**
   * One chat's transcript, read with the outputs it is handed, with each turn
   * it holds no beginning for read back inside the turn before it, and with its
   * local turns put back, or the local turns alone for a chat whose backend
   * holds no transcript.
   */
  transcriptOf(
    agent: Agent,
    id: string,
    at: SessionAt | undefined,
    session: string,
    chat: string,
  ): Promise<WireTurn<Turn>[] | undefined>;
  /**
   * A transcript's turns with the chat's local turns put back after their
   * anchors. `joined` names the turn each transcript id a read put inside
   * another was put in, which is where a local turn anchored to it goes.
   */
  withLocalTurns<T>(session: string, chat: string, turns: readonly T[], joined?: ReadonlyMap<string, string>): T[];
  /**
   * The id a backend cuts or forks at for the turn at `at`: that turn's, or the
   * nearest earlier one's that is not a local turn. Nothing when every turn up
   * to `at` is a local turn.
   */
  concreteTurnOf(session: string, chat: string, turns: readonly Bag[], at: number): string | undefined;
  /** Forget the local turns among some dropped turns of a chat, and the transcript ids recorded for them. */
  forgetLocalTurns(session: string, chat: string, turns: readonly Bag[]): void;
  /** Keep a fork's copied local turns, and the transcript ids of its copied turns, for the new chat. */
  copyLocalTurns(session: string, from: string, to: string, turns: readonly Bag[]): void;
  /** Forget every local turn and transcript id a chat kept. */
  forgetChatLocalTurns(session: string, chat: string): void;
  /**
   * Every turn a session's chats keep, by the session's id, in no order.
   *
   * What a session whose turns are all the host's own holds: no backend lists
   * it or holds a conversation for it, so the catalogue keeps and lists it from
   * these, and a read of it answers them.
   */
  keptTurnsOf(id: string): Bag[];
  /** Take a chat's local turns, and the transcript ids it recorded, to the session it moved to. */
  moveChatLocalTurns(from: string, to: string, chat: string): void;
}

/** One file: a local turn, its anchor and where it sorts among the anchor's others. */
interface Kept {
  turnId: string;
  /** The transcript id of the turn it followed, or nothing for one before every other turn. */
  anchor?: string;
  seq: number;
  turn: Bag;
}

/** The folder under a session's own where its chats' local turns are. */
const TURNS = 'turns';

/** A name as a file name: its SHA-256 in hex, as `outputs.ts` names one. */
const hashOf = (name: string): string => createHash('sha256').update(name, 'utf8').digest('hex');

/**
 * Whether a file holds a turn a client can read: the reference's own check of a
 * persisted turn, with the turn's id the one the file was kept under.
 * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L171-L200
 */
const keptOf = (value: Bag): Kept | undefined => {
  const { version, turnId, anchor, seq, turn } = value;
  if (version !== 1 || typeof turnId !== 'string' || typeof seq !== 'number') return undefined;
  if (anchor !== undefined && typeof anchor !== 'string') return undefined;
  if (!isRecord(turn) || turn.id !== turnId || typeof turn.state !== 'string' || !Array.isArray(turn.responseParts)) return undefined;
  const message = bag(turn.message);
  if (typeof message.text !== 'string' || typeof bag(message.origin).kind !== 'string') return undefined;
  return { turnId, ...(anchor === undefined ? {} : { anchor }), seq, turn };
};

/** One file of a chat's record: a transcript id, and the turn that began, or was written again, under it. */
interface Recorded {
  transcriptId: string;
  turnId: string;
  /** The message's origin, where it is not a person's. */
  origin?: Bag;
}

/** The folder under a session's own where its chats record the transcript ids their turns began under. */
const RECORDED = 'recorded';

/** Whether a file holds a record this version wrote. */
const recordedOf = (value: Bag): Recorded | undefined => {
  const { version, transcriptId, turnId, origin } = value;
  if (version !== 1 || typeof transcriptId !== 'string' || typeof turnId !== 'string') return undefined;
  // A kind is the whole of an origin the protocol defines, and a value without
  // one says nothing a client can draw from.
  const held = bag(origin);
  return { transcriptId, turnId, ...(typeof held.kind === 'string' ? { origin: held } : {}) };
};

/** Two numbers added, or the one there is; absent where neither is. */
const added = (a: unknown, b: unknown): number | undefined => {
  const one = typeof a === 'number' ? a : undefined;
  const two = typeof b === 'number' ? b : undefined;
  return one === undefined && two === undefined ? undefined : (one ?? 0) + (two ?? 0);
};

/**
 * What a turn and one read back inside it spent, as one turn's usage: token
 * counts and costs added and the rest as the later one left it, the model that
 * answered last and the context as it ended, as agent-pi adds one call's usage
 * to its turn's.
 */
const spentBoth = (first: Bag | undefined, then: Bag | undefined): Bag | undefined => {
  if (first === undefined || then === undefined) return then ?? first;
  const was = bag(first._meta);
  const now = bag(then._meta);
  const meta: Bag = { ...was, ...now };
  for (const key of ['ahpd.cacheWriteTokens', 'ahpd.reasoningTokens']) {
    const sum = added(was[key], now[key]);
    if (sum !== undefined) meta[key] = sum;
  }
  const paid = bag(was['ahpd.cost']);
  const paying = bag(now['ahpd.cost']);
  if (typeof paid.amount === 'number' && typeof paying.amount === 'number') {
    const cost: Bag = { ...paid, ...paying, amount: paid.amount + paying.amount };
    for (const side of ['input', 'output']) {
      const sum = added(paid[side], paying[side]);
      if (sum !== undefined) cost[side] = sum;
    }
    meta['ahpd.cost'] = cost;
  }
  const out: Bag = { ...first, ...then };
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens']) {
    const sum = added(first[key], then[key]);
    if (sum !== undefined) out[key] = sum;
  }
  if (Object.keys(meta).length > 0) out._meta = meta;
  return out;
};

/**
 * A turn with another read back inside it, as one turn: the first's id, start
 * and message, both answers in the order they came, and the later one's end.
 */
const joinedTurn = (first: WireTurn<Turn>, then: WireTurn<Turn>, steered = false): WireTurn<Turn> => {
  const usage = spentBoth(first.usage as Bag | undefined, then.usage as Bag | undefined);
  const began = first.startedAt === undefined ? Number.NaN : Date.parse(first.startedAt);
  const ended = then.startedAt === undefined || then.duration === undefined
    ? Number.NaN
    : Date.parse(then.startedAt) + then.duration;
  return {
    ...first,
    /*
     * A steer the backend wrote as a turn of its own keeps its words in the turn
     * it steered, as its steer part before its answer, the part the live turn
     * showed for the same steering message.
     */
    responseParts: [
      ...first.responseParts,
      ...(steered ? [steerPart(String(then.id), String(then.message.text ?? '')) as WireTurn<Turn>['responseParts'][number]] : []),
      ...then.responseParts,
    ],
    state: then.state,
    usage: usage as WireTurn<Turn>['usage'],
    ...(Number.isNaN(began) || Number.isNaN(ended) ? {} : { duration: ended - began }),
  };
};

export function createLocalTurns(ctx: HostContext): LocalTurns {
  /** Each held chat's transcript ids, by the id its turns go by while they run. */
  const recordedAs = new Map<string, Map<string, string>>();

  /** Each held chat's message origins, by the id its turns go by while they run. */
  const originsAs = new Map<string, Map<string, Bag>>();

  /** A chat's folder in a session's own, or nothing where the store keeps none. */
  const folderOf = (session: string, chat: string): string | undefined => {
    const dir = ctx.kept.attachmentsDir?.(idOf(session));
    return dir === undefined ? undefined : join(dir, TURNS, hashOf(chat));
  };
  const fileOf = (session: string, chat: string, turnId: string): string | undefined => {
    const folder = folderOf(session, chat);
    return folder === undefined ? undefined : join(folder, `${hashOf(turnId)}.json`);
  };
  const isLocal = (session: string, chat: string, turnId: string): boolean => {
    const file = fileOf(session, chat, turnId);
    return file !== undefined && existsSync(file);
  };

  /** A chat's record in a session's own, or nothing where the store keeps none. */
  const recordOf = (session: string, chat: string): string | undefined => {
    const dir = ctx.kept.attachmentsDir?.(idOf(session));
    return dir === undefined ? undefined : join(dir, RECORDED, hashOf(chat));
  };
  /** Every transcript id a chat recorded, with the turn it began, in no order. */
  const recordedIn = (session: string, chat: string): Recorded[] => {
    const folder = recordOf(session, chat);
    if (folder === undefined || !existsSync(folder)) return [];
    let names: string[];
    try { names = readdirSync(folder); }
    catch (error) {
      ctx.log(`could not read ${folder}: ${reason(error)}`);
      return [];
    }
    return names.flatMap((name) => {
      if (!name.endsWith('.json')) return [];
      const outcome = readJsonObject(join(folder, name));
      const recorded = outcome.ok ? recordedOf(outcome.value) : undefined;
      return recorded === undefined ? [] : [recorded];
    });
  };
  /** Write one record of a chat's, under the transcript id it names. */
  const record = (session: string, chat: string, recorded: Recorded): void => {
    const folder = recordOf(session, chat);
    if (folder === undefined) return;
    try {
      writeJsonAtomic(join(folder, `${hashOf(recorded.transcriptId)}.json`), { version: 1, ...recorded }, { dirMode: 0o700 });
    }
    catch (error) {
      ctx.log(`could not record the turn ${recorded.turnId} of ${chat}: ${reason(error)}`);
    }
  };
  /** The records of a chat that name one of `turns`, by the transcript's id for it or the client's. */
  const recordedFor = (session: string, chat: string, turns: readonly Bag[]): Recorded[] => {
    const named = new Set(turns.flatMap((turn) => str(turn.id) ?? []));
    return recordedIn(session, chat).filter((one) => named.has(one.transcriptId) || named.has(one.turnId));
  };

  /** Every file a chat kept that this version wrote and that holds a turn, in no order. */
  const keptIn = (session: string, chat: string): Kept[] => {
    const folder = folderOf(session, chat);
    return folder === undefined ? [] : keptInFolder(folder);
  };
  /** The same, read from one chat's folder. */
  const keptInFolder = (folder: string): Kept[] => {
    if (!existsSync(folder)) return [];
    let names: string[];
    try { names = readdirSync(folder); }
    catch (error) {
      ctx.log(`could not read ${folder}: ${reason(error)}`);
      return [];
    }
    return names.flatMap((name) => {
      if (!name.endsWith('.json')) return [];
      const outcome = readJsonObject(join(folder, name));
      const kept = outcome.ok ? keptOf(outcome.value) : undefined;
      return kept === undefined ? [] : [kept];
    });
  };

  const turnRecordedAs = (session: string, chat: string, turnId: string, transcriptId: string, origin?: Bag): void => {
    const names = recordedAs.get(chat) ?? new Map<string, string>();
    names.set(turnId, transcriptId);
    recordedAs.set(chat, names);
    if (origin !== undefined) {
      const held = originsAs.get(chat) ?? new Map<string, Bag>();
      held.set(turnId, origin);
      originsAs.set(chat, held);
    }
    record(session, chat, { transcriptId, turnId, ...(origin === undefined ? {} : { origin }) });
  };

  const turnOriginOf = (chat: string, turnId: string): Bag | undefined => originsAs.get(chat)?.get(turnId);

  const keepLocalTurn = (session: string, chat: string, turns: readonly Bag[], turnId: string): void => {
    const at = turns.findIndex((turn) => str(turn.id) === turnId);
    const file = fileOf(session, chat, turnId);
    if (at < 0 || file === undefined) return;
    /*
     * The turn it followed: the nearest earlier one that is no local turn of
     * its own, by the id the transcript holds it under.
     * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L100-L109
     */
    let anchor: string | undefined;
    for (let before = at - 1; before >= 0; before -= 1) {
      const id = str(turns[before]?.id);
      if (id === undefined || isLocal(session, chat, id)) continue;
      anchor = recordedAs.get(chat)?.get(id) ?? id;
      break;
    }
    const seq = keptIn(session, chat).reduce((most, kept) => Math.max(most, kept.seq), 0) + 1;
    try {
      // The store's own writer: 0600 under a 0700 folder, renamed into place,
      // so a process killed mid-write leaves no half of one.
      writeJsonAtomic(file, {
        version: 1,
        turnId,
        ...(anchor === undefined ? {} : { anchor }),
        seq,
        turn: turns[at],
      }, { dirMode: 0o700 });
    }
    catch (error) {
      ctx.log(`could not keep the turn ${turnId} of ${chat}: ${reason(error)}`);
    }
  };

  /*
   * The reference's interleave: the local turns with no anchor first, then each
   * after the turn it followed, in the order they were kept, and one whose
   * anchor the transcript does not hold is dropped.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L202-L234
   *
   * A transcript can hold some local turns already: an ACP record keeps the
   * seed it was resumed with, and the seed carries the chat's local turns. Each
   * of those stays where the transcript has it, the others of its anchor go in
   * around it by `seq`, and none goes in a second time.
   */
  const withLocalTurns = <T>(session: string, chat: string, turns: readonly T[], joined?: ReadonlyMap<string, string>): T[] => {
    const kept = keptIn(session, chat);
    if (kept.length === 0) return [...turns];
    const seqOf = new Map(kept.map((one) => [one.turnId, one.seq]));
    const held = new Set(turns.map((turn) => str(bag(turn).id)));
    // The local turns to put in, by anchor, each anchor's in `seq` order.
    const waiting = new Map<string | undefined, Kept[]>();
    for (const one of kept.filter((each) => !held.has(each.turnId)).sort((a, b) => a.seq - b.seq)) {
      const anchor = one.anchor === undefined ? undefined : joined?.get(one.anchor) ?? one.anchor;
      waiting.set(anchor, [...(waiting.get(anchor) ?? []), one]);
    }
    const merged: T[] = [];
    // The turns before the first of the backend's own are the ones with no anchor.
    let anchor: string | undefined;
    const putIn = (before?: number): void => {
      const group = waiting.get(anchor) ?? [];
      while (group.length > 0 && (before === undefined || (group[0] as Kept).seq < before)) {
        merged.push((group.shift() as Kept).turn as unknown as T);
      }
    };
    for (const turn of turns) {
      const id = str(bag(turn).id);
      const seq = id === undefined ? undefined : seqOf.get(id);
      if (seq !== undefined) putIn(seq);
      else {
        putIn();
        anchor = id;
      }
      merged.push(turn);
    }
    putIn();
    return merged;
  };

  /**
   * A transcript's turns as the chat began them, and the turn each one read
   * back inside another went into.
   *
   * A turn the chat's record holds no beginning for is one the backend wrote of
   * its own inside a turn that began before it, so it is read back inside that
   * turn, as the reference keeps a steering message's answer in the turn it
   * steered. So is a turn recorded as the same turn as the one before it, which
   * is that turn written down again. A local turn is the host's own and stays
   * a turn of its own, and so does every turn before the first one the record
   * holds: a chat from before its record reads as its transcript gives it.
   * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/claude/CONTEXT.md#L1597-L1606
   */
  const asBegun = (session: string, chat: string, turns: readonly WireTurn<Turn>[], records: readonly Recorded[] = recordedIn(session, chat)): { turns: WireTurn<Turn>[]; joined: Map<string, string> } => {
    const joined = new Map<string, string>();
    const began = new Map(records.map((one) => [one.transcriptId, one.turnId]));
    if (began.size === 0) return { turns: [...turns], joined };
    const out: WireTurn<Turn>[] = [];
    let recorded = false;
    // The turn the one last kept began as.
    let last: string | undefined;
    for (const turn of turns) {
      const id = String(turn.id);
      const as = began.get(id);
      recorded ||= as !== undefined;
      const into = out.at(-1);
      if (into !== undefined && recorded && (as === undefined || as === last) && !isLocal(session, chat, id)) {
        // One the chat never began is a steer; one recorded again is the same turn.
        out[out.length - 1] = joinedTurn(into, turn, as === undefined);
        joined.set(id, String(into.id));
        continue;
      }
      out.push(turn);
      last = as;
    }
    return { turns: out, joined };
  };

  /**
   * A transcript's turns with the message origin the chat recorded for each.
   *
   * Applied before `asBegun`, because a turn that folds into the one before it
   * keeps the earlier turn's message: an origin set after the fold would land
   * on a turn the chat no longer holds.
   */
  const begunWithOrigins = (turns: readonly WireTurn<Turn>[], records: readonly Recorded[]): WireTurn<Turn>[] => {
    const origins = new Map(records.flatMap((one) =>
      one.origin === undefined ? [] : [[one.transcriptId, one.origin] as const]));
    if (origins.size === 0) return [...turns];
    return turns.map((turn) => {
      const origin = origins.get(String(turn.id));
      if (origin === undefined) return turn;
      return { ...turn, message: { ...bag(turn.message), origin } } as unknown as WireTurn<Turn>;
    });
  };

  const transcriptOf = async (
    agent: Agent,
    id: string,
    at: SessionAt | undefined,
    session: string,
    chat: string,
  ): Promise<WireTurn<Turn>[] | undefined> => {
    const turns = await agent.transcript?.(id, at, ctx.outputsFor(session, chat));
    // A chat whose turns are all this host's own has no transcript, and reads
    // as the turns it keeps, as a nested session opens from its record.
    if (turns === undefined) return keptIn(session, chat).length > 0 ? withLocalTurns(session, chat, []) : undefined;
    const records = recordedIn(session, chat);
    const begun = asBegun(session, chat, begunWithOrigins(turns, records), records);
    return withLocalTurns(session, chat, begun.turns, begun.joined);
  };

  const concreteTurnOf = (session: string, chat: string, turns: readonly Bag[], at: number): string | undefined => {
    for (let before = at; before >= 0; before -= 1) {
      const id = str(turns[before]?.id);
      if (id !== undefined && !isLocal(session, chat, id)) return id;
    }
    return undefined;
  };

  const forgetLocalTurns = (session: string, chat: string, turns: readonly Bag[]): void => {
    const files = [
      ...turns.flatMap((turn) => {
        const id = str(turn.id);
        return id === undefined ? [] : [fileOf(session, chat, id)];
      }),
      ...recordedFor(session, chat, turns).map((one) => {
        const folder = recordOf(session, chat);
        return folder === undefined ? undefined : join(folder, `${hashOf(one.transcriptId)}.json`);
      }),
    ];
    for (const file of files) {
      if (file === undefined) continue;
      try { rmSync(file, { force: true }); }
      catch (error) { ctx.log(`could not remove ${file}: ${reason(error)}`); }
    }
  };

  const copyLocalTurns = (session: string, from: string, to: string, turns: readonly Bag[]): void => {
    const names = recordedAs.get(from);
    const copied = recordedAs.get(to) ?? new Map<string, string>();
    const folder = folderOf(session, to);
    for (const turn of turns) {
      const id = str(turn.id);
      if (id === undefined) continue;
      const said = names?.get(id);
      if (said !== undefined) copied.set(id, said);
      const was = fileOf(session, from, id);
      if (folder === undefined || was === undefined || !existsSync(was)) continue;
      const now = join(folder, `${hashOf(id)}.json`);
      try {
        mkdirSync(folder, { recursive: true, mode: 0o700 });
        copyFileSync(was, now);
      }
      catch (error) { ctx.log(`could not copy ${was} to ${now}: ${reason(error)}`); }
    }
    if (copied.size > 0) recordedAs.set(to, copied);
    for (const one of recordedFor(session, from, turns)) record(session, to, one);
  };

  const forgetChatLocalTurns = (session: string, chat: string): void => {
    recordedAs.delete(chat);
    originsAs.delete(chat);
    for (const folder of [folderOf(session, chat), recordOf(session, chat)]) {
      if (folder === undefined) continue;
      try { rmSync(folder, { recursive: true, force: true }); }
      catch (error) { ctx.log(`could not remove ${folder}: ${reason(error)}`); }
    }
  };

  /**
   * One folder's files into another, file by file, as a chat's outputs move,
   * so a folder the chat left there before keeps what this move does not
   * replace.
   */
  const moveFolder = (was: string | undefined, now: string | undefined): void => {
    if (was === undefined || now === undefined || was === now || !existsSync(was)) return;
    try {
      mkdirSync(now, { recursive: true, mode: 0o700 });
      for (const name of readdirSync(was)) renameSync(join(was, name), join(now, name));
      rmSync(was, { recursive: true, force: true });
    }
    catch (error) { ctx.log(`could not move ${was} to ${now}: ${reason(error)}`); }
  };

  const moveChatLocalTurns = (from: string, to: string, chat: string): void => {
    moveFolder(folderOf(from, chat), folderOf(to, chat));
    moveFolder(recordOf(from, chat), recordOf(to, chat));
  };

  const keptTurnsOf = (id: string): Bag[] => {
    const dir = ctx.kept.attachmentsDir?.(id);
    const turns = dir === undefined ? undefined : join(dir, TURNS);
    if (turns === undefined || !existsSync(turns)) return [];
    let chats: string[];
    try { chats = readdirSync(turns); }
    catch (error) {
      ctx.log(`could not read ${turns}: ${reason(error)}`);
      return [];
    }
    return chats.flatMap((chat) => keptInFolder(join(turns, chat)).map((kept) => kept.turn));
  };

  return {
    turnRecordedAs, turnOriginOf, keepLocalTurn, transcriptOf, withLocalTurns, concreteTurnOf,
    forgetLocalTurns, copyLocalTurns, forgetChatLocalTurns, moveChatLocalTurns, keptTurnsOf,
  };
}

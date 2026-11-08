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
 * holds each under: a live chat finds the turn an anchor names by it, a read
 * finds the failed turn a transcript holds a copy of by it, and a turn its
 * backend ran again and wrote down under a second id reads back by it as the
 * one turn it is, as VS Code's host keeps a resumed turn.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L966-L974
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
   * Record a command's turn that has ended, as the chat holds it in `turns`,
   * as VS Code's local turn store records one beside its anchor.
   *
   * Nothing for a turn `turns` does not hold, and nothing where the store keeps
   * no session folder.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/localCommands/localChatCommand.ts#L227-L245
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L86
   */
  recordLocalTurn(session: string, chat: string, turns: readonly Bag[], turnId: string): void;
  /**
   * Record a turn that ended in an error it cannot be resumed from, as the chat
   * holds it in `turns`, anchored as a command's turn is: a read puts it back
   * where the backend's transcript holds no copy of it, and drops it where it
   * holds one, as the reference host keeps a turn that failed before its
   * provider recorded it. A command's turn kept already stays as it is.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/persistedFailedTurns/persistedFailedTurnsContribution.ts#L40-L84
   */
  recordFailedTurn(session: string, chat: string, turns: readonly Bag[], turnId: string): void;
  /**
   * One chat's transcript, read with the outputs it is handed, each turn it
   * holds a turn of its own and a turn run twice the one turn it is, with its
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
   * A transcript's turns with the chat's local turns interleaved after their
   * anchors, as VS Code interleaves them. `joined` names the turn each
   * transcript id a read put inside another was put in, which is where a local
   * turn anchored to it goes.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L202
   */
  interleaveLocalTurns<T>(session: string, chat: string, turns: readonly T[], joined?: ReadonlyMap<string, string>): T[];
  /**
   * A live chat's turns, as its backend holds them under the ids the chat began
   * them by, with the chat's local turns put back after their anchors: an
   * anchor kept under a transcript's own id for a turn is read as the id the
   * chat began that turn by, as the reference reads a chat's turns with its
   * local ones among them.
   * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L202-L234
   */
  liveTurnsOf<T>(session: string, chat: string, turns: readonly T[]): T[];
  /**
   * The id a backend cuts or forks at for the turn at `at`: that turn's, or the
   * nearest earlier one's that is not a local turn, as VS Code resolves a
   * concrete turn id. Nothing when every turn up to `at` is a local turn.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L76
   */
  resolveConcreteTurnId(session: string, chat: string, turns: readonly Bag[], at: number): string | undefined;
  /**
   * Delete the local turns among some dropped turns of a chat, and the
   * transcript ids recorded for them, as VS Code deletes a truncation's locals.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L125
   */
  deleteLocalTurns(session: string, chat: string, turns: readonly Bag[]): void;
  /** Persist a fork's copied local turns, and the transcript ids of its copied turns, for the new chat, as VS Code persists a fork's. */
  persistForkedLocalTurns(session: string, from: string, to: string, turns: readonly Bag[]): void;
  /**
   * Forget every local turn and transcript id a chat kept, as VS Code's local
   * turn store forgets a chat.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L139
   */
  forgetChatLocalTurns(session: string, chat: string): void;
  /**
   * Every turn a session's chats keep, by the session's id, in no order: each
   * chat's records loaded, as VS Code loads a chat's local turns.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentHostLocalTurns.ts#L115
   *
   * What a session whose turns are all the host's own holds: no backend lists
   * it or holds a conversation for it, so the catalogue keeps and lists it from
   * these, and a read of it answers them.
   */
  loadSessionLocalTurns(id: string): Bag[];
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
  /**
   * A turn that ended in an error it cannot be resumed from, which its
   * backend's transcript may hold after all: read back only where it does not.
   */
  failed?: true;
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
  const { version, turnId, anchor, seq, turn, failed } = value;
  if (version !== 1 || typeof turnId !== 'string' || typeof seq !== 'number') return undefined;
  if (anchor !== undefined && typeof anchor !== 'string') return undefined;
  if (!isRecord(turn) || turn.id !== turnId || typeof turn.state !== 'string' || !Array.isArray(turn.responseParts)) return undefined;
  const message = bag(turn.message);
  if (typeof message.text !== 'string' || typeof bag(message.origin).kind !== 'string') return undefined;
  return { turnId, ...(anchor === undefined ? {} : { anchor }), seq, turn, ...(failed === true ? { failed: true as const } : {}) };
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
 * What one turn run twice spent, as VS Code merges a resumed turn's usage: the
 * later run's counts and model over the earlier run's, and the cost of both
 * added.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/sessionState.ts#L137-L174
 */
const mergeLogicalTurnUsage = (previous: Bag | undefined, current: Bag | undefined): Bag | undefined => {
  if (previous === undefined || current === undefined) return current ?? previous;
  const paid = bag(bag(previous._meta)['ahpd.cost']);
  const paying = bag(bag(current._meta)['ahpd.cost']);
  let cost: Bag | undefined;
  if (typeof paid.amount === 'number' && typeof paying.amount === 'number') {
    cost = { ...paid, ...paying, amount: paid.amount + paying.amount };
    for (const side of ['input', 'output']) {
      const sum = added(paid[side], paying[side]);
      if (sum !== undefined) cost[side] = sum;
    }
  }
  const meta = previous._meta === undefined && current._meta === undefined
    ? undefined
    : { ...bag(previous._meta), ...bag(current._meta), ...(cost === undefined ? {} : { 'ahpd.cost': cost }) };
  const model = current.model ?? previous.model;
  return { ...previous, ...current, ...(model === undefined ? {} : { model }), ...(meta === undefined ? {} : { _meta: meta }) };
};

/**
 * What two turns spent, added, for a steer read back inside the turn it
 * steered: its counts and its cost are that turn's as well.
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
 * One turn run twice, read back as the one turn it is, as VS Code's host keeps
 * a resumed turn: the first run's id, start and message, the parts of both in
 * the order they came, the later run's end, both runs' durations added and
 * their usage merged.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/common/state/protocol/channels-chat/reducer.ts#L402-L428
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L966-L974
 */
const joinedTurn = (first: WireTurn<Turn>, then: WireTurn<Turn>, steered = false): WireTurn<Turn> => {
  const usage = (steered ? spentBoth : mergeLogicalTurnUsage)(first.usage as Bag | undefined, then.usage as Bag | undefined);
  // A steer is part of the turn it steered, which ran from its start to the
  // steer's end; a turn run twice took the time of both runs.
  const began = first.startedAt === undefined ? Number.NaN : Date.parse(first.startedAt);
  const ended = then.startedAt === undefined || then.duration === undefined
    ? Number.NaN
    : Date.parse(then.startedAt) + then.duration;
  const duration = !steered
    ? added(first.duration, then.duration)
    : Number.isNaN(began) || Number.isNaN(ended) ? undefined : ended - began;
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
    ...(usage === undefined ? {} : { usage: usage as WireTurn<Turn>['usage'] }),
    ...(duration === undefined ? {} : { duration }),
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

  const keep = (session: string, chat: string, turns: readonly Bag[], turnId: string, failed: boolean): void => {
    const at = turns.findIndex((turn) => str(turn.id) === turnId);
    const file = fileOf(session, chat, turnId);
    if (at < 0 || file === undefined) return;
    if (failed && isLocal(session, chat, turnId)) return;
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
        ...(failed ? { failed: true } : {}),
      }, { dirMode: 0o700 });
    }
    catch (error) {
      ctx.log(`could not keep the turn ${turnId} of ${chat}: ${reason(error)}`);
    }
  };
  const recordLocalTurn = (session: string, chat: string, turns: readonly Bag[], turnId: string): void => {
    keep(session, chat, turns, turnId, false);
  };
  const recordFailedTurn = (session: string, chat: string, turns: readonly Bag[], turnId: string): void => {
    keep(session, chat, turns, turnId, true);
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
  const interleaveLocalTurns = <T>(session: string, chat: string, turns: readonly T[], joined?: ReadonlyMap<string, string>): T[] => {
    const all = keptIn(session, chat);
    if (all.length === 0) return [...turns];
    const held = new Set(turns.map((turn) => str(bag(turn).id)));
    /*
     * A failed turn the transcript holds after all, under its own id or one
     * the chat recorded for it, is the transcript's: its kept copy goes, as
     * the reference host deletes a failed turn its provider has a copy of.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/chatContributions/persistedFailedTurns/persistedFailedTurnsContribution.ts#L68-L84
     */
    const copied = new Set(recordedIn(session, chat).filter((one) => held.has(one.transcriptId)).map((one) => one.turnId));
    const kept = all.filter((one) => {
      if (one.failed !== true || (!held.has(one.turnId) && !copied.has(one.turnId))) return true;
      const file = fileOf(session, chat, one.turnId);
      if (file !== undefined) {
        try { rmSync(file, { force: true }); }
        catch (error) { ctx.log(`could not remove ${file}: ${reason(error)}`); }
      }
      return false;
    });
    if (kept.length === 0) return [...turns];
    const named = joined ?? new Map([...recordedAs.get(chat) ?? []].map(([turnId, recorded]) => [recorded, turnId]));
    const seqOf = new Map(kept.map((one) => [one.turnId, one.seq]));
    // The local turns to put in, by anchor, each anchor's in `seq` order.
    const waiting = new Map<string | undefined, Kept[]>();
    for (const one of kept.filter((each) => !held.has(each.turnId)).sort((a, b) => a.seq - b.seq)) {
      const anchor = one.anchor === undefined ? undefined : named.get(one.anchor) ?? one.anchor;
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
   * Each turn the transcript holds is a turn of its own, except where the
   * host's `steerReadBack` keeps a steer in its turn, which is the default.
   *
   * At `inTurn`, a turn the chat's record holds no beginning for is one the
   * backend wrote of its own inside a turn that began before it, so it is read
   * back inside that turn, as the live turn showed the steering message. A
   * local turn is the host's own and stays a turn of its own, and so does
   * every turn before the first one the record holds: a chat from before its
   * record reads as its transcript gives it. So does a notice turn, whose
   * message says the system made it: it answers no one.
   * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/claude/CONTEXT.md#L1597-L1606
   *
   * At `ownTurn`, every prompt the transcript holds starts a turn, as VS
   * Code's replay starts one, a steering message the backend ran as a prompt
   * of its own included.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L282-L292
   *
   * Either way, a turn recorded as the same turn as the one before it is that
   * turn run again and written down under a second id, so the two read back
   * as the one turn it is.
   */
  const asBegun = (session: string, chat: string, turns: readonly WireTurn<Turn>[], records: readonly Recorded[] = recordedIn(session, chat), restoreIds = false): { turns: WireTurn<Turn>[]; joined: Map<string, string> } => {
    const joined = new Map<string, string>();
    const began = new Map(records.map((one) => [one.transcriptId, one.turnId]));
    if (began.size === 0) return { turns: [...turns], joined };
    const out: WireTurn<Turn>[] = [];
    const steersInTurn = ctx.steerReadBack !== 'ownTurn';
    let recorded = false;
    // The turn the one last kept began as.
    let last: string | undefined;
    for (const turn of turns) {
      const id = String(turn.id);
      const as = began.get(id);
      recorded ||= as !== undefined;
      const into = out.at(-1);
      // A notice is the system's own and stays a turn of its own, however
      // little the record says of it.
      const notice = str(bag(bag(turn.message).origin).kind) === 'systemNotification';
      const grouped = as === undefined ? steersInTurn && !restoreIds : as === last;
      if (into !== undefined && recorded && grouped && !isLocal(session, chat, id) && !notice) {
        // One the chat never began is a steer; one recorded again is the same turn.
        out[out.length - 1] = joinedTurn(into, turn, as === undefined);
        joined.set(id, String(into.id));
        continue;
      }
      const restored = restoreIds && as !== undefined ? { ...turn, id: as } : turn;
      out.push(restored);
      if (restoreIds && as !== undefined) joined.set(id, as);
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
    if (turns === undefined) return keptIn(session, chat).length > 0 ? interleaveLocalTurns(session, chat, []) : undefined;
    const records = recordedIn(session, chat);
    const begun = asBegun(session, chat, begunWithOrigins(turns, records), records, agent.transcriptTurnIds === 'recorded');
    return interleaveLocalTurns(session, chat, begun.turns, begun.joined);
  };

  const liveTurnsOf = <T>(session: string, chat: string, turns: readonly T[]): T[] => {
    const joined = new Map(recordedIn(session, chat).map((one) => [one.transcriptId, one.turnId]));
    for (const [turnId, transcriptId] of recordedAs.get(chat) ?? []) joined.set(transcriptId, turnId);
    return interleaveLocalTurns(session, chat, turns, joined);
  };

  const resolveConcreteTurnId = (session: string, chat: string, turns: readonly Bag[], at: number): string | undefined => {
    for (let before = at; before >= 0; before -= 1) {
      const id = str(turns[before]?.id);
      if (id !== undefined && !isLocal(session, chat, id)) return id;
    }
    return undefined;
  };

  const deleteLocalTurns = (session: string, chat: string, turns: readonly Bag[]): void => {
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

  const persistForkedLocalTurns = (session: string, from: string, to: string, turns: readonly Bag[]): void => {
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

  const loadSessionLocalTurns = (id: string): Bag[] => {
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
    turnRecordedAs, turnOriginOf, recordLocalTurn, recordFailedTurn, transcriptOf, interleaveLocalTurns, liveTurnsOf, resolveConcreteTurnId,
    deleteLocalTurns, persistForkedLocalTurns, forgetChatLocalTurns, moveChatLocalTurns, loadSessionLocalTurns,
  };
}

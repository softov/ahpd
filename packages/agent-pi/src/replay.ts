/**
 * A pi session this process did not watch, rebuilt from pi's own file.
 *
 * The entries on the file's current branch are raised as the events pi raises
 * live, in pi's live order, and fed through `mapEvent`: so a rebuilt turn has
 * the parts a watched one has, and a change in what an event means is made in
 * `mapping.ts` for both. A change in what pi stores is met here.
 *
 * Each rebuilt turn keeps the id of the entry it ended at, which is what a
 * watched turn's end is too, so a truncation can cut at a turn from disk.
 */

import type { AgentSessionEvent, SessionEntry } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { Bag } from '@ahpd/sdk';
import { mapEvent, readyRow, usageOf } from './mapping.js';
import { loadPi } from './pi.js';
import type { PiOptions, PiTurn, WatchedTurn } from './types.js';

/** A session rebuilt from its file. */
export interface Replayed {
  /** The turns, in the order they ran, sealed as a watched turn is. */
  turns: WatchedTurn[];
  /** The entry each turn ended at, by the turn's id. */
  ends: Map<string, string>;
}

/**
 * How a session's file is found and rebuilt, by pi's id and the directory it
 * ran in.
 *
 * The default reads pi's own session store; a caller may pass its own, as a
 * session may pass its own `open`.
 */
export type ReplayPi = (id: string, directory: string) => Promise<Replayed | undefined>;

/** The words of a message's content, which pi keeps as a string or as parts. */
const textOf = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .filter((one): one is { type: 'text'; text: string } =>
      typeof one === 'object' && one !== null && (one as Bag).type === 'text' && typeof (one as Bag).text === 'string')
    .map((one) => one.text)
    .join('\n');
};

/** One turn while its entries are read. */
interface Reading {
  mapping: PiTurn;
  watched: WatchedTurn;
  /** The last assistant message, which is how the turn ended, as live. */
  answered?: AssistantMessage;
  /** The model in force when the turn ran, as `provider/modelId`. */
  model?: string;
  /** The last entry that belongs to the turn. */
  end: string;
  endedAt: string;
}

/**
 * An event, as the mapping reads it.
 *
 * `at` is the time of the entry that carried it, so a rebuilt call carries the
 * time it ran rather than the time this process read the file.
 */
const raise = (turn: PiTurn, event: Bag, at?: number): void => {
  mapEvent(turn, event as unknown as AgentSessionEvent, at);
};

/**
 * The entries of one branch, root first, as turns.
 *
 * A user message opens a turn. An assistant message is raised as its start,
 * then each block by its index: a thinking or text block as its start and one
 * delta, and a tool call as the model's start of it, pi's start of running it,
 * the ready the `tool_call` hook gives a call that runs without asking, and
 * its end with the tool result that follows. The turn ends as the last
 * assistant message in it ended, as a live turn does when pi retried: `error`
 * for an error, `cancelled` for an answer that was aborted, and `complete`
 * otherwise.
 *
 * Entries with no turn meaning are skipped: pi's leading system message, the
 * model and thinking level changes, context edits, labels, session info and
 * an extension's own entries. A model change still names the model the turns
 * after it ran on, for a turn whose answer does not say.
 */
export function replayEntries(entries: readonly SessionEntry[]): Replayed {
  const turns: WatchedTurn[] = [];
  const ends = new Map<string, string>();
  let model: string | undefined;
  let open: Reading | undefined;

  const seal = (): void => {
    if (open === undefined) return;
    const { watched, answered } = open;
    const failed = answered?.stopReason === 'error';
    if (failed) {
      const message = answered?.errorMessage === undefined || answered.errorMessage === ''
        ? 'pi did not answer'
        : answered.errorMessage;
      // The part `chat/error` carries, which a client that watched the turn
      // end holds on it.
      watched.parts.push({ kind: 'error', error: { errorType: 'turnFailed', message } });
    }
    watched.state = failed ? 'error' : answered?.stopReason === 'aborted' ? 'cancelled' : 'complete';
    const duration = Date.parse(open.endedAt) - Date.parse(watched.startedAt);
    watched.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const used = usageOf(answered);
    const ran = open.model;
    if (used !== undefined) watched.usage = used.model === undefined && ran !== undefined ? { ...used, model: ran } : used;
    else if (ran !== undefined) watched.usage = { model: ran };
    ends.set(watched.turnId, open.end);
    turns.push(watched);
    open = undefined;
  };

  for (const entry of entries) {
    if (entry.type === 'model_change') {
      model = `${entry.provider}/${entry.modelId}`;
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = entry.message as unknown as Bag;

    if (message.role === 'user') {
      seal();
      const turnId = entry.id;
      const parts: Bag[] = [];
      open = {
        mapping: { turnId, messages: 0, blocks: new Map(), waiting: new Map(), parts, calls: new Map() },
        watched: {
          turnId,
          startedAt: entry.timestamp,
          message: { text: textOf(message.content), origin: { kind: 'user' } },
          parts,
          state: 'complete',
        },
        ...(model !== undefined ? { model } : {}),
        end: entry.id,
        endedAt: entry.timestamp,
      };
      continue;
    }

    // Anything before the first prompt, and anything that is not a turn's.
    if (open === undefined) continue;

    if (message.role === 'assistant') {
      const answer = message as unknown as AssistantMessage;
      const turn = open.mapping;
      const at = Date.parse(entry.timestamp);
      raise(turn, { type: 'message_start', message: answer });
      (answer.content ?? []).forEach((block, contentIndex) => {
        const update = (inner: Bag): void => {
          raise(turn, { type: 'message_update', message: answer, assistantMessageEvent: { contentIndex, partial: answer, ...inner } });
        };
        if (block.type === 'thinking') {
          update({ type: 'thinking_start' });
          update({ type: 'thinking_delta', delta: block.thinking });
        }
        else if (block.type === 'text') {
          update({ type: 'text_start' });
          update({ type: 'text_delta', delta: block.text });
        }
        else if (block.type === 'toolCall') {
          const input = (block.arguments ?? {}) as Bag;
          update({ type: 'toolcall_start' });
          raise(turn, { type: 'tool_execution_start', toolCallId: block.id, toolName: block.name, args: input }, at);
          const row = turn.parts.find((one) => one.id === block.id)?.toolCall as Bag | undefined;
          if (row !== undefined) readyRow(row, block.name, input, { confirmed: 'not-needed' });
        }
      });
      open.answered = answer;
      open.end = entry.id;
      open.endedAt = entry.timestamp;
      continue;
    }

    if (message.role === 'toolResult') {
      raise(open.mapping, {
        type: 'tool_execution_end',
        toolCallId: String(message.toolCallId),
        toolName: String(message.toolName),
        result: { content: message.content, details: message.details },
        isError: message.isError === true,
      }, Date.parse(entry.timestamp));
      open.end = entry.id;
      open.endedAt = entry.timestamp;
    }
  }
  seal();
  return { turns, ends };
}

/**
 * One session of pi's, rebuilt from its file, or nothing.
 *
 * Looked for in each directory in turn, since pi keeps a session under the
 * directory it ran in. Nothing for an id no directory has, and nothing for a
 * file pi cannot open, which the host reads as a failed read rather than as an
 * empty session.
 */
export async function replayed(
  options: PiOptions,
  id: string,
  directories: readonly string[],
): Promise<Replayed | undefined> {
  const { SessionManager } = await loadPi();
  for (const directory of directories) {
    let file: string | undefined;
    try { file = SessionManager.findById(directory, id, options.sessionDir); }
    catch { continue; }
    if (file === undefined) continue;
    try { return replayEntries(SessionManager.open(file).getBranch()); }
    catch { return undefined; }
  }
  return undefined;
}

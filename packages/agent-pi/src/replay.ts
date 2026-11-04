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
import { bag } from '@ahpd/sdk';
import type { Bag, SessionAt } from '@ahpd/sdk';
import { lookupDirectories } from './catalog.js';
import { addUsage, callPartOf, mapEvent, readyRow } from './mapping.js';
import { loadPi } from './pi.js';
import { MESSAGE_ENTRY } from './types.js';
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
  /** What every answer in the turn used, summed as a live turn sums it. */
  spent?: Bag;
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
 * for an error, `cancelled` for an answer that was aborted or a call no
 * result followed, and `complete` otherwise. What it used is every answer's
 * usage summed, as a live turn says it.
 *
 * The last turn of a file that ends while the turn's request still ran, its
 * last answer asking for tools or no answer at all, ends in error after its
 * parts with VS Code's `executionInterrupted` part, as VS Code's reader ends a
 * turn whose request is still active at the end of its events.
 * https://github.com/microsoft/vscode/blob/a4e689ae13ef7a1fe9b515656b51c9be7c274294/src/vs/platform/agentHost/node/copilot/copilotAgent.ts#L7987-L7990
 * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L1128-L1130
 *
 * A turn's message is the one this host kept as the prompt's parent entry
 * (`MESSAGE_ENTRY`), as the turn had it: the person's words, the attachments
 * and the model. A prompt with none, one typed into pi itself, is its text with
 * the model in force, as VS Code's reader puts the model in force on a restored
 * message.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/copilot/mapSessionEvents.ts#L890
 *
 * Entries with no turn meaning are skipped: pi's leading system message, the
 * model and thinking level changes, context edits, labels, session info and
 * every other extension entry. A model change still names the model the turns
 * after it ran on, for a turn whose answer does not say.
 */
export function replayEntries(entries: readonly SessionEntry[]): Replayed {
  const turns: WatchedTurn[] = [];
  const ends = new Map<string, string>();
  let model: string | undefined;
  let open: Reading | undefined;
  /** The message this host kept last, by the entry it is kept under. */
  let kept: { id: string; message: Bag } | undefined;

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
    /*
     * A call the file holds no result for never finished: the turn ended
     * around it. It reads back cancelled as skipped, which is how the
     * protocol's reducer holds a call still open when its turn ends, and the
     * turn that held it reads back cancelled, as the reference reads a Claude
     * transcript back.
     * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514
     */
    let unfinished = false;
    for (const part of watched.parts) {
      const row = part.kind === 'toolCall' ? part.toolCall as Bag : undefined;
      if (row === undefined || row.status === 'completed' || row.status === 'cancelled') continue;
      unfinished = true;
      part.toolCall = {
        status: 'cancelled',
        toolCallId: row.toolCallId,
        toolName: row.toolName,
        displayName: row.displayName,
        invocationMessage: row.invocationMessage ?? row.displayName,
        ...(row.toolInput === undefined ? {} : { toolInput: row.toolInput }),
        reason: 'skipped',
        ...(row._meta === undefined ? {} : { _meta: row._meta }),
      };
    }
    if (unfinished && watched.state === 'complete') watched.state = 'cancelled';
    const duration = Date.parse(open.endedAt) - Date.parse(watched.startedAt);
    watched.duration = Number.isFinite(duration) && duration > 0 ? duration : 0;
    const used = open.spent;
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
    if (entry.type === 'custom' && entry.customType === MESSAGE_ENTRY) {
      const message = bag(bag(entry.data).message);
      if (typeof message.text === 'string') kept = { id: entry.id, message };
      continue;
    }
    if (entry.type !== 'message') continue;
    const message = entry.message as unknown as Bag;

    if (message.role === 'user') {
      seal();
      const turnId = entry.id;
      const parts: Bag[] = [];
      open = {
        mapping: { turnId, messages: 0, blocks: new Map(), parts, calls: new Map() },
        watched: {
          turnId,
          startedAt: entry.timestamp,
          message: kept !== undefined && entry.parentId === kept.id
            ? { ...kept.message }
            : { text: textOf(message.content), origin: { kind: 'user' }, ...(model !== undefined ? { model: { id: model } } : {}) },
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
          const row = callPartOf(turn, String(block.id))?.toolCall as Bag | undefined;
          if (row !== undefined) readyRow(row, block.name, input, { confirmed: 'not-needed' });
        }
      });
      open.answered = answer;
      const spent = addUsage(open.spent, answer);
      if (spent !== undefined) open.spent = spent;
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
  const running = open !== undefined && (open.answered === undefined || open.answered.stopReason === 'toolUse');
  seal();
  if (running) {
    const cut = turns.at(-1) as WatchedTurn;
    cut.parts.push({
      kind: 'error',
      error: { errorType: 'executionInterrupted', message: 'The agent was interrupted before this request finished.' },
    });
    cut.state = 'error';
  }
  /*
   * The last turn, when it failed or was cut off, is the one a client may
   * resume: its failed reply or its cut-off request is the file's last word,
   * which a resume takes up again, as `resumePoint` reads it. An earlier
   * failed turn has turns after it, and the protocol resumes only the latest.
   */
  const last = turns.at(-1);
  const part = last?.state === 'error' ? last.parts.at(-1) : undefined;
  if (part?.kind === 'error') part.resumable = true;
  return { turns, ends };
}

/**
 * One session of pi's, rebuilt from its file, or nothing.
 *
 * Looked for in the folder the host recorded for it, then in each directory in
 * turn, since pi keeps a session under the directory it ran in. Nothing for an
 * id no directory has, and nothing for a file pi cannot open, which the host
 * reads as a failed read rather than as an empty session.
 */
export async function replayed(
  options: PiOptions,
  id: string,
  directories: readonly string[],
  at?: SessionAt,
): Promise<Replayed | undefined> {
  const { SessionManager } = await loadPi();
  for (const directory of lookupDirectories(directories, at)) {
    let file: string | undefined;
    try { file = SessionManager.findById(directory, id, options.sessionDir); }
    catch { continue; }
    if (file === undefined) continue;
    try { return replayEntries(SessionManager.open(file).getBranch()); }
    catch { return undefined; }
  }
  return undefined;
}

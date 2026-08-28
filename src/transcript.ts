import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { Bag } from './types/common.js';
import type { Page } from './types/transcript.js';

/**
 * Reads a session that already happened, as turns.
 *
 * Used for sessions in the catalogue that this host is not running. Opening
 * one costs a file read; no agent process is started until somebody sends a
 * turn to it.
 *
 * Also holds the paging helpers, since a snapshot carries only the newest
 * page and `fetchTurns` walks backwards from there.
 */

const bag = (value: unknown): Bag => (typeof value === 'object' && value !== null ? value as Bag : {});
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

function summarize(name: string, input: Bag): string | undefined {
  if (name === 'Bash') return str(input.command);
  if (name === 'Read' || name === 'Write' || name === 'Edit') return str(input.file_path);
  if (name === 'Glob' || name === 'Grep') return str(input.pattern);
  if (name === 'Task' || name === 'Agent') return str(input.description);
  return Object.keys(input).length > 0 ? JSON.stringify(input).slice(0, 400) : undefined;
}

function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  const parts = list(content).map((b) => str(bag(b).text)).filter((t): t is string => t !== undefined);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Read one session's history, best effort.
 *
 * A transcript that will not parse is an empty session, not a refusal: the
 * catalogue said the session exists and the catalogue is right. Refusing to
 * open a row because its file is odd would be the host arguing with itself.
 */
export async function turnsOf(sessionId: string, dir: string): Promise<Bag[]> {
  let messages: unknown[];
  try {
    messages = await getSessionMessages(sessionId, { dir });
  } catch {
    return [];
  }

  const built: Bag[] = [];
  const calls = new Map<string, Bag>();

  for (const entry of messages) {
    const frame = bag(entry);
    const role = str(frame.type);
    const message = bag(frame.message);
    const at = str(frame.timestamp) ?? new Date(0).toISOString();

    if (role === 'user') {
      const said = typeof message.content === 'string'
        ? message.content
        : list(message.content).map((b) => str(bag(b).text)).filter(Boolean).join('\n');

      // A user frame carrying only tool results is the SDK reporting calls
      // finishing, not somebody saying something. Turning it into a turn puts
      // the agent's own tool output in the person's voice.
      for (const raw of list(message.content)) {
        const block = bag(raw);
        if (str(block.type) !== 'tool_result') continue;
        const call = calls.get(str(block.tool_use_id) ?? '');
        if (!call) continue;
        call.status = block.is_error === true ? 'failed' : 'completed';
        const text = resultText(block.content);
        if (text !== undefined) call.content = [{ text }];
      }
      if (!said) continue;

      built.push({
        id: str(frame.uuid) ?? `u${built.length}`,
        startedAt: at,
        message: { text: said },
        responseParts: [],
      });
      continue;
    }

    if (role !== 'assistant') continue;

    const parts: Bag[] = [];
    const blocks = list(message.content);
    for (let index = 0; index < blocks.length; index++) {
      const block = bag(blocks[index]);
      const kind = str(block.type);
      const id = str(block.id) ?? `${str(frame.uuid) ?? 'a'}:${index}`;

      if (kind === 'text') {
        parts.push({ id, kind: 'markdown', content: str(block.text) ?? '' });
      } else if (kind === 'thinking') {
        parts.push({ id, kind: 'reasoning', content: str(block.thinking) ?? '' });
      } else if (kind === 'tool_use') {
        const name = str(block.name) ?? 'tool';
        const command = summarize(name, bag(block.input));
        const call: Bag = {
          toolCallId: id,
          toolName: name,
          displayName: name,
          // Completed unless a result says otherwise: the session is over, so
          // a call still reading `running` would be a spinner that never stops.
          status: 'completed',
          ...(command ? { toolInput: command } : {}),
          ...(command ? { invocationMessage: command } : {}),
        };
        calls.set(id, call);
        parts.push({ id, kind: 'toolCall', toolCall: call });
      }
    }
    if (parts.length === 0) continue;

    // The agent answering the message just above it, if that is what this is.
    // A history where every reply is its own turn reads as a monologue with
    // the questions removed.
    const previous = built[built.length - 1];
    if (previous && (previous.responseParts as Bag[]).length === 0) {
      previous.responseParts = parts;
      continue;
    }
    built.push({
      id: str(frame.uuid) ?? `a${built.length}`,
      startedAt: at,
      message: { text: '' },
      responseParts: parts,
    });
  }

  return built;
}

/**
 * How many turns a snapshot carries.
 *
 * A session in this directory has eight hundred and fifty turns. Sending them
 * all works and will not keep working: a snapshot is what a client waits for
 * before it can draw anything, and the oldest turns are the ones nobody is
 * looking at.
 */
export const PAGE = 50;

/**
 * The newest page, and where the rest begins.
 *
 * The cursor is the index of the oldest turn served - opaque to a client, and
 * deliberately so, but it has to mean something here or `fetchTurns` cannot
 * answer twice in a row.
 */
export function tail(turns: Bag[], size = PAGE): Page {
  const start = Math.max(0, turns.length - size);
  return {
    turns: turns.slice(start),
    ...(start > 0 ? { turnsNextCursor: String(start) } : {}),
  };
}

/**
 * The page before a cursor, or nothing when the cursor is not one of ours.
 *
 * The protocol requires an unrecognised cursor to be rejected rather than
 * guessed at: a host that quietly returned its newest page for a cursor it
 * did not issue would answer a question about old turns with new ones, and
 * the client would page forever without noticing.
 */
export function older(turns: Bag[], cursor: string, size = PAGE): Page | undefined {
  if (!/^\d+$/.test(cursor)) return undefined;
  const at = Number(cursor);
  if (at <= 0 || at > turns.length) return undefined;
  const start = Math.max(0, at - size);
  return {
    turns: turns.slice(start, at),
    ...(start > 0 ? { turnsNextCursor: String(start) } : {}),
  };
}

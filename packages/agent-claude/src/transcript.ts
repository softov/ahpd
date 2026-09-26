import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { ResponsePart, ToolCallCompletedState, ToolResultContent, Turn } from '@microsoft/agent-host-protocol';
import type { Bag, OnWire, RestoredSubagent, WireTurn } from '@ahpd/sdk';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { toolMetaOf } from './kinds.js';

/**
 * Reads a session that already happened, as turns.
 *
 * Used for sessions in the catalogue that this host is not running. Opening
 * one costs a file read; no agent process is started until somebody sends a
 * turn to it.
 *
 * The frames are the Claude harness's own, which is what makes this the
 * backend's rather than the host's: a transcript is written by whatever ran
 * the session, and only the thing that ran it knows the shape. Paging over
 * the result is not - that is `paging.ts`, and the host does it to any
 * backend's turns.
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
 *
 * A read that threw is tried once more before it is, though. A transcript
 * being written as it is read and a transient filesystem error are both
 * failures this cannot tell from a session with nothing in it, and empty is
 * the answer a client draws nothing for - so it is worth one more attempt
 * rather than being shown as a session that has no turns.
 */
export async function turnsOf(sessionId: string, dir: string): Promise<WireTurn<Turn>[]> {
  let messages: unknown[];
  try {
    messages = await getSessionMessages(sessionId, { dir });
  } catch {
    try {
      messages = await getSessionMessages(sessionId, { dir });
    } catch {
      return [];
    }
  }

  return buildTurns(messages);
}

/**
 * Where a session's own files are, by the CLI's layout.
 *
 * `<config>/projects/<directory>/<id>.jsonl` for the session, and
 * `<config>/projects/<directory>/<id>/subagents/agent-<id>.jsonl` for the
 * conversations that ran inside its calls - with a `.meta.json` beside each
 * naming the tool call that spawned it. The directory is spelled the way the
 * CLI spells it, and a session resumed elsewhere may have been written under
 * the directory it started in, so the other projects are looked through.
 */
function sessionFiles(sessionId: string, dir: string): { project: string; session: string } | undefined {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
  const own = join(projects, dir.replace(/[^A-Za-z0-9]/g, '-'));
  if (existsSync(join(own, `${sessionId}.jsonl`))) return { project: own, session: sessionId };
  let names: string[];
  try { names = readdirSync(projects); }
  catch { return undefined; }
  for (const name of names) {
    const project = join(projects, name);
    if (existsSync(join(project, `${sessionId}.jsonl`))) return { project, session: sessionId };
  }
  return undefined;
}

/** One JSON object per line, which is what the CLI writes. */
function readJsonl(path: string): unknown[] {
  try {
    return readFileSync(path, 'utf8').split('\n').filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as unknown);
  }
  catch { return []; }
}

/**
 * The `agentId` a spawning call's result ends with, when it says one.
 *
 * Some harness versions append a synthetic `agentId: <id>` line to the
 * `Task`/`Agent` result instead of writing it where the host can read it
 * exactly. Tolerant of spacing and case, because it is the CLI's text and not
 * a field, and anchored to a line so a mention in the body is not a match.
 */
export function agentIdIn(turns: WireTurn<Turn>[], agentId: string): string | undefined {
  const wanted = new RegExp(`^\\s*agentId:\\s*${agentId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'im');
  for (const turn of turns as unknown as Bag[]) {
    for (const part of list(turn.responseParts)) {
      const call = bag(bag(part).toolCall);
      const id = str(call.toolCallId);
      if (id === undefined) continue;
      for (const content of list(call.content)) {
        const text = str(bag(content).text);
        if (text !== undefined && wanted.test(text)) return id;
      }
    }
  }
  return undefined;
}

/**
 * The worker chats a session ran, read from the CLI's own files.
 *
 * The meta file is the exact link - `toolUseId` names the call that spawned
 * the worker and nothing has to be inferred - and the `agentId:` suffix in the
 * spawning call's result is the fallback for a harness that writes no meta or
 * leaves the id out of it. A worker with neither is skipped rather than
 * guessed at: a chat linked to the wrong call is worse than one that is not
 * there, and a session with an orphaned file on disk still opens.
 */
export function subagentsOf(sessionId: string, dir: string, mainTurns: WireTurn<Turn>[]): RestoredSubagent[] {
  const files = sessionFiles(sessionId, dir);
  if (files === undefined) return [];
  const folder = join(files.project, files.session, 'subagents');
  if (!existsSync(folder)) return [];
  let names: string[];
  try { names = readdirSync(folder); }
  catch { return []; }

  const out: RestoredSubagent[] = [];
  for (const name of names) {
    if (!name.endsWith('.jsonl') || name.startsWith('.')) continue;
    const agentId = name.slice(0, -'.jsonl'.length);
    const meta = join(folder, `${agentId}.meta.json`);
    let about: Bag = {};
    if (existsSync(meta)) {
      try { about = bag(JSON.parse(readFileSync(meta, 'utf8'))); }
      catch { about = {}; }
    }
    const fromMeta = str(about.toolUseId);
    const toolCallId = fromMeta ?? agentIdIn(mainTurns, agentId.replace(/^agent-/, ''));
    // Nothing names the call that ran it, so there is no link to draw.
    if (toolCallId === undefined) continue;
    const agentType = str(about.agentType);
    const description = str(about.description);
    out.push({
      toolCallId,
      title: agentType ?? 'Subagent',
      ...(agentType !== undefined ? { agentName: agentType } : {}),
      ...(description !== undefined ? { description } : {}),
      turns: buildTurns(readJsonl(join(folder, name))) as unknown as Bag[],
    });
  }
  return out;
}

/** One session's history, from the frames a reader already parsed. */
function buildTurns(messages: unknown[]): WireTurn<Turn>[] {
  const built: WireTurn<Turn>[] = [];
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
        /*
         * A tool that failed is `completed`, and says so in its result.
         *
         * `ToolCallStatus` has no `failed`: the seven are `streaming`,
         * `pending-confirmation`, `running`, `auth-required`,
         * `pending-result-confirmation`, `completed` and `cancelled`. What
         * went wrong is `success` and `error`, which is the only place a
         * client looks for it. This builder said `failed` and matched no
         * variant at all.
         */
        const ok = block.is_error !== true;
        call.status = 'completed';
        call.success = ok;
        call.pastTenseMessage = str(call.invocationMessage) ?? str(call.displayName) ?? 'the tool';
        const text = resultText(block.content);
        // `type` on every block: these are MCP's content blocks and it is what
        // tells them apart. Checked, because this is an assignment onto a
        // `Bag` and so outside the literal the call was built as.
        if (text !== undefined)
          call.content = [{ type: 'text', text }] satisfies OnWire<ToolResultContent>[];
        if (!ok) call.error = { message: text ?? 'The tool failed' };
      }
      if (!said) continue;

      built.push({
        id: str(frame.uuid) ?? `u${built.length}`,
        startedAt: at,
        // Who produced it, which `Message` requires and this never sent.
        message: { text: said, origin: { kind: 'user' } },
        responseParts: [],
        // A turn out of a transcript is one that already happened, so it is
        // complete by definition. `Turn.state` is required and used to be
        // left off, which put every past turn on the wire without one.
        state: 'complete',
        // Required too, and meaning "not measured" rather than "none": the
        // transcript does not record token counts.
        usage: undefined,
      });
      continue;
    }

    if (role !== 'assistant') continue;

    /*
     * What the turn cost and which model answered it, off the transcript
     * rather than left out.
     *
     * `Turn.usage` is required, and a rebuilt turn used to carry none at all -
     * so a client could not name the model on a past turn or size the context
     * window that turn used. The transcript records both on every assistant
     * frame; this is the same mapping a live turn does, from the same fields.
     */
    const counted = bag(message.usage);
    const count = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const spent: Bag = {
      ...(count(counted.input_tokens) !== undefined ? { inputTokens: count(counted.input_tokens) } : {}),
      ...(count(counted.output_tokens) !== undefined ? { outputTokens: count(counted.output_tokens) } : {}),
      ...(count(counted.cache_read_input_tokens) !== undefined
        ? { cacheReadTokens: count(counted.cache_read_input_tokens) }
        : {}),
      ...(str(message.model) !== undefined ? { model: str(message.model) as string } : {}),
    };
    const used = Object.keys(spent).length > 0 ? spent : undefined;

    const parts: Bag[] = [];
    const blocks = list(message.content);
    for (let index = 0; index < blocks.length; index++) {
      const block = bag(blocks[index]);
      const kind = str(block.type);
      const id = str(block.id) ?? `${str(frame.uuid) ?? 'a'}:${index}`;

      if (kind === 'text') {
        parts.push({ id, kind: 'markdown', content: str(block.text) ?? '' } satisfies OnWire<ResponsePart>);
      } else if (kind === 'thinking') {
        parts.push({ id, kind: 'reasoning', content: str(block.thinking) ?? '' } satisfies OnWire<ResponsePart>);
      } else if (kind === 'tool_use') {
        const name = str(block.name) ?? 'tool';
        const command = summarize(name, bag(block.input));
        const meta = toolMetaOf(name);
        /*
         * Checked against the state it claims to be in, at the moment it is
         * built.
         *
         * This is the gap `WireTurn` was named for. Everything inside
         * `responseParts` was a `Bag`, and it is where this builder wrote a
         * `status` that is not one of the seven, left off three fields the
         * completed state requires, and gave its content blocks no `type` -
         * four defects in one object, none of them a compile error.
         */
        const call: Bag = {
          toolCallId: id,
          toolName: name,
          displayName: name,
          // Completed unless a result says otherwise: the session is over, so
          // a call still reading `running` would be a spinner that never stops.
          status: 'completed',
          ...(command ? { toolInput: command } : {}),
          // The same hint a live call carries, so a transcript read back off
          // disk draws its shell commands as shell commands.
          ...(meta ? { _meta: meta } : {}),
          /*
           * Required on a completed call, all four of them, and this builder
           * sent one of them sometimes.
           *
           * `invocationMessage` is the sentence the row draws; without it
           * there is nothing to draw. `confirmed` says nothing is being asked,
           * and without it a client reads every call in the transcript as a
           * question waiting on somebody. `success` and `pastTenseMessage`
           * stand until a result says otherwise - a call with no result
           * recorded is one that finished with nothing to report, not one
           * that failed.
           */
          invocationMessage: command ?? name,
          confirmed: 'not-needed',
          success: true,
          pastTenseMessage: command ?? name,
        } satisfies OnWire<ToolCallCompletedState>;
        calls.set(id, call);
        // The part is not re-checked: `call` is a `Bag` from here on, because
        // a tool result arriving later mutates it. The literal above is what
        // the protocol changes under, and the literal is what is checked.
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
      previous.usage = used as WireTurn<Turn>['usage'];
      continue;
    }
    built.push({
      id: str(frame.uuid) ?? `a${built.length}`,
      startedAt: at,
      // The agent's own turn: there is no user message in front of it.
      message: { text: '', origin: { kind: 'agent' } },
      responseParts: parts,
      state: 'complete',
      usage: used as WireTurn<Turn>['usage'],
    });
  }

  return built;
}

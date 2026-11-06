import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';
import type { ResponsePart, ToolCallCompletedState, ToolResultContent, Turn } from '@microsoft/agent-host-protocol';
import type { Bag, OnWire, RestoredSubagent, WireTurn } from '@ahpd/sdk';
import { bag, str, toolCallDurationMs, withToolCallDuration } from '@ahpd/sdk';
import { createReadStream, existsSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { lineOf, pastLineOf, questionAnswers, questionRequest, titleOf, toolInputOf } from './input.js';
import { claudeToolDenialCode, getClaudeToolDisplayName, resultContent, toolMetaOf } from './kinds.js';
import { ranOn } from './models.js';

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

const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

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
 * The SDK is asked once, by the session's id alone, which searches every
 * project, and for the system entries as well, as VS Code's Claude agent
 * reads a transcript back: a session is read wherever it ran, and its
 * compaction boundaries and notifications are drawn on their turns.
 * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSavedChatReader.ts#L67-L68
 *
 * `ends`, when given, is filled with where each turn ended, by turn id: the
 * entry a fork of that turn copies through and a rewind to it keeps.
 */
export async function turnsOf(sessionId: string, ends?: Map<string, string>): Promise<WireTurn<Turn>[]> {
  let messages: unknown[];
  try {
    messages = await getSessionMessages(sessionId, { includeSystemMessages: true });
  } catch {
    return [];
  }

  const asked = askedIn(messages);
  const answered = asked.size === 0 ? new Map<string, unknown>() : await answeredIn(sessionId, asked);
  return buildTurns(answered.size === 0 ? messages : messages.map((message) => {
    const result = answered.get(str(bag(message).uuid) ?? '');
    return result === undefined ? message : { ...bag(message), toolUseResult: result };
  }), ends);
}

/** The uuids of the entries that hold the result of an `AskUserQuestion` call. */
function askedIn(messages: unknown[]): Set<string> {
  const questions = new Set<string>();
  const holding = new Set<string>();
  for (const message of messages) {
    const frame = bag(message);
    for (const block of list(bag(frame.message).content).map(bag)) {
      const type = str(block.type);
      if (type === 'tool_use' && str(block.name) === 'AskUserQuestion') questions.add(str(block.id) ?? '');
      const uuid = str(frame.uuid);
      if (type === 'tool_result' && uuid !== undefined && questions.has(str(block.tool_use_id) ?? '')) holding.add(uuid);
    }
  }
  return holding;
}

/**
 * What each answered question ran with, by the uuid of the entry that holds
 * its result.
 *
 * The CLI writes a tool's result object on that entry as `toolUseResult`, and
 * the SDK's `getSessionMessages` leaves the field out, so the session's own
 * file is read for it, as far as the last of the entries asked for. Line by
 * line, because the file of a long session can be longer than one string can
 * be; and a line is parsed only when it names `answers`, because most lines
 * are tool output.
 *
 * https://nodejs.org/api/readline.html#example-read-file-stream-line-by-line
 */
async function answeredIn(sessionId: string, wanted: Set<string>): Promise<Map<string, unknown>> {
  const answered = new Map<string, unknown>();
  const files = sessionFiles(sessionId);
  if (files === undefined) return answered;
  const input = createReadStream(join(files.project, `${files.session}.jsonl`));
  const lines = createInterface({ input, crlfDelay: Infinity });
  const seen = new Set<string>();
  try {
    for await (const line of lines) {
      if (!line.includes('"answers"')) continue;
      let entry: Bag;
      try { entry = bag(JSON.parse(line)); }
      catch { continue; }
      const uuid = str(entry.uuid);
      if (uuid === undefined || !wanted.has(uuid)) continue;
      seen.add(uuid);
      if (Object.keys(bag(bag(entry.toolUseResult).answers)).length > 0) answered.set(uuid, entry.toolUseResult);
      if (seen.size === wanted.size) break;
    }
  }
  catch {
    // A file that cannot be read restores the turns the SDK read, without answers.
  }
  finally {
    input.destroy();
  }
  return answered;
}

/**
 * Where a session's own files are, by the CLI's layout.
 *
 * `<config>/projects/<directory>/<id>.jsonl` for the session, and
 * `<config>/projects/<directory>/<id>/subagents/agent-<id>.jsonl` for the
 * conversations that ran inside its calls - with a `.meta.json` beside each
 * naming the tool call that spawned it. They are in whichever project holds
 * the session's transcript, found by its id alone wherever the session ran,
 * as the SDK finds a session asked for by its id.
 */
function sessionFiles(sessionId: string): { project: string; session: string } | undefined {
  const projects = join(process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude'), 'projects');
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
export function subagentsOf(sessionId: string, mainTurns: WireTurn<Turn>[]): RestoredSubagent[] {
  const files = sessionFiles(sessionId);
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
      /*
       * By the same rule as a chat opened live, from the same two fields the
       * live one reads. A worker that reads `Explore` while it is running and
       * `Explore` for ever after is consistent but useless - six workers from
       * one turn are six tabs saying the same thing - and the task the call
       * described is in the meta file either way.
       */
      title: titleOf(description, agentType),
      ...(agentType !== undefined ? { agentName: agentType } : {}),
      ...(description !== undefined ? { description } : {}),
      turns: buildTurns(readJsonl(join(folder, name))) as unknown as Bag[],
    });
  }
  /*
   * A worker spawned from inside another worker: its call is in that worker's
   * turns and not in the session's own, and that worker's call is its parent.
   */
  const inMain = callsIn(mainTurns as unknown as Bag[]);
  for (const one of out) {
    if (inMain.has(one.toolCallId)) continue;
    const parent = out.find((other) => other !== one && callsIn(other.turns).has(one.toolCallId));
    if (parent !== undefined) one.parentToolCallId = parent.toolCallId;
  }
  return out;
}

/** The ids of every tool call in some turns. */
function callsIn(turns: Bag[]): Set<string> {
  const ids = new Set<string>();
  for (const turn of turns) {
    for (const part of list(turn.responseParts)) {
      const id = str(bag(bag(part).toolCall).toolCallId);
      if (id !== undefined) ids.add(id);
    }
  }
  return ids;
}

/**
 * The tags the CLI opens a user frame with when it records a slash command
 * (`<command-name>`, `<command-message>`, `<command-args>`), its local
 * handler's output (`<local-command-stdout>`, `<local-command-stderr>`) or
 * the caveat it puts before such output (`<local-command-caveat>`). These
 * frames do not reliably carry `isMeta`, so the content is what tells them.
 */
const CLI_ECHO = /^<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat)>/;

/** A user frame's content is a CLI echo when its first text starts with one of its tags. */
function isCliEcho(content: unknown): boolean {
  if (typeof content === 'string') return CLI_ECHO.test(content);
  const first = list(content).map(bag).find((block) => str(block.type) === 'text');
  return first !== undefined && CLI_ECHO.test(str(first.text) ?? '');
}

/**
 * How the text the CLI writes where a turn was stopped starts:
 * `[Request interrupted by user]`, or `[Request interrupted by user for tool
 * use]` when a tool call was running. The CLI reads a user text that starts so
 * as no prompt of anybody's.
 */
const INTERRUPTED = '[Request interrupted by user';

/** One session's history, from the frames a reader already parsed, and where each turn ended when `ends` is given. */
function buildTurns(messages: unknown[], ends?: Map<string, string>): WireTurn<Turn>[] {
  const built: WireTurn<Turn>[] = [];
  const calls = new Map<string, Bag>();
  /** When each call started, by id, as its own `tool_use` frame says: what its duration is measured from. */
  const startedAt = new Map<string, string>();
  /** The calls a result was written for, by id. */
  const resulted = new Set<string>();
  /*
   * Each call's input as it was sent, which its `tool_input` on the call is the
   * string of. Kept as the object because a question's result says what it was
   * answered *with*, and that is the input it ran with, not a line drawn from
   * it.
   */
  const inputs = new Map<string, Bag>();
  /*
   * Each turn's usage by API message. The CLI writes one message as a frame
   * per content block, each repeating that message's usage, so a message is
   * counted once however many frames carry it.
   */
  const spentBy = new Map<WireTurn<Turn>, Map<string, Bag>>();
  /*
   * The last frame each turn was built from, so a restored turn can say how
   * long it took: the frames carry a time each and the turn does not.
   */
  const lastAt = new Map<WireTurn<Turn>, number>();
  /*
   * Where a fork or a rewind of a turn cuts, in the CLI's own names: its last
   * assistant message, as VS Code's resolveForkAnchorUuid reads it, and as a
   * live session records it from the frames its CLI sends.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L72-L112
   */
  const ended = (turn: WireTurn<Turn> | undefined, frame: Bag): void => {
    const entry = str(frame.uuid);
    if (ends !== undefined && turn !== undefined && entry !== undefined) ends.set(String(turn.id), entry);
  };

  for (const entry of messages) {
    const frame = bag(entry);
    const role = str(frame.type);
    const message = bag(frame.message);
    const at = str(frame.timestamp) ?? new Date(0).toISOString();

    if (role === 'user') {
      const said = typeof message.content === 'string'
        ? message.content
        : list(message.content).map((b) => str(bag(b).text)).filter(Boolean).join('\n');

      // The turn the results below belong to, which is the one the prompt
      // before them opened.
      const open = built[built.length - 1];
      // A user frame carrying only tool results is the SDK reporting calls
      // finishing, not somebody saying something. Turning it into a turn puts
      // the agent's own tool output in the person's voice.
      for (const raw of list(message.content)) {
        const block = bag(raw);
        if (str(block.type) !== 'tool_result') continue;
        const callId = str(block.tool_use_id) ?? '';
        const call = calls.get(callId);
        if (!call) continue;
        resulted.add(callId);
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
        const text = resultText(block.content);
        // A failed call's line and its `error`, as the live call words them.
        if (!ok) call.pastTenseMessage = pastLineOf(str(call.toolName) ?? '', {}, str(call.displayName) ?? str(call.toolName) ?? 'the tool', false);
        const denial = ok || text === undefined ? undefined : claudeToolDenialCode(text);
        // `type` on every block: these are MCP's content blocks and it is what
        // tells them apart. Checked, because this is an assignment onto a
        // `Bag` and so outside the literal the call was built as.
        const content = resultContent(block.content) satisfies OnWire<ToolResultContent>[];
        if (content.length > 0) call.content = content;
        if (denial !== undefined && text !== undefined) call.error = { message: text, code: denial };
        /*
         * What an answered question ran with, for a result that says so.
         *
         * The CLI records the `updatedInput` it was handed as the
         * `toolUseResult` of the entry that holds the result, so a question
         * anybody answered carries the answers keyed by each question's own
         * text, and a result whose entry has no `toolUseResult` was never
         * answered.
         */
        const ran = inputs.get(callId);
        const answers = bag(bag(frame.toolUseResult).answers);
        if (ran !== undefined && Object.keys(answers).length > 0) {
          /*
           * The question as it was answered, after the call it was asked in.
           *
           * A client hides a completed AskUserQuestion row and draws the turn's
           * `inputRequest` part instead, which a live turn has because the
           * protocol's reducer records the ask and the completion. Rebuilt from
           * the transcript it had nothing, so a session lost its questions and
           * answers the moment the daemon restarted; built here, by the same
           * code the live question is, it reads after a restart as it read
           * before one. A question with no answers was never asked by anybody,
           * denied or cancelled, and gets no part.
           */
          if (open !== undefined) {
            const request = questionRequest(ran, callId).request;
            const part: Bag = {
              kind: 'inputRequest',
              request: { ...request, answers: questionAnswers(request, answers) },
              response: 'accept',
            };
            open.responseParts = [...(open.responseParts as Bag[]), part];
          }
        }
        // How long it ran, to the frame that carries its result, on its `_meta`
        // as VS Code's restored history carries it.
        const meta = withToolCallDuration(call._meta === undefined ? undefined : bag(call._meta), toolCallDurationMs(startedAt.get(callId), at));
        if (meta !== undefined) call._meta = meta;
      }
      // A frame of tool results is part of the turn the prompt opened, so the
      // turn ends when the last of them was written.
      if (open !== undefined) lastAt.set(open, Date.parse(at));
      if (!said) continue;
      // Written by the CLI rather than said by anybody: it neither shows as a
      // prompt nor ends the exchange it sits in.
      if (frame.isCompactSummary === true || isCliEcho(message.content)) continue;
      // A stop, which ends the turn in front of it as cancelled, as it ended live.
      if (said.startsWith(INTERRUPTED)) {
        if (open !== undefined) open.state = 'cancelled';
        continue;
      }
      /*
       * A steering message the CLI took in at a tool call, which comes back
       * marked `isQueuedCommand` and is no turn of its own: its answer is the
       * turn's it steered, as it was live. One the CLI ran after the turn's last
       * answer is a prompt of its own here, and the host's record of the turns
       * a chat began puts it back in the turn it steered.
       * https://github.com/microsoft/vscode/blob/3a2421399905c0c044dade3048a797d1e9ba33d4/src/vs/platform/agentHost/node/claude/CONTEXT.md#L1597-L1606
       */
      if (open !== undefined && frame.isQueuedCommand === true) continue;

      const opened: WireTurn<Turn> = {
        id: str(frame.uuid) ?? `u${built.length}`,
        startedAt: at,
        // Who produced it, which `Message` requires and this never sent.
        message: { text: said, origin: { kind: 'user' } },
        responseParts: [],
        // A turn out of a transcript is one that already happened, so it is
        // complete by definition. `Turn.state` is required and used to be
        // left off, which put every past turn on the wire without one.
        state: 'complete',
        // Required too, and meaning "not measured" rather than "none" until
        // an assistant frame answering it records what it cost.
        usage: undefined,
      };
      built.push(opened);
      lastAt.set(opened, Date.parse(at));
      continue;
    }

    /*
     * A compaction boundary or a notification the CLI recorded, drawn on the
     * turn it came in as its own notification part, with its text or its
     * subtype in brackets; any other system entry, and one before any turn,
     * is dropped, as VS Code's replay keeps them.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L186-L208
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L306-L319
     */
    if (role === 'system') {
      const subtype = str(message.subtype);
      const turn = built[built.length - 1];
      if (turn === undefined || (subtype !== 'compact_boundary' && subtype !== 'notification')) continue;
      const content = str(message.text) ?? str(message.message) ?? `[${subtype}]`;
      turn.responseParts = [...(turn.responseParts as Bag[]), { kind: 'systemNotification', content }];
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
      ...(ranOn(message.model) !== undefined ? { model: ranOn(message.model) as string } : {}),
    };
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
        const given = bag(block.input);
        const input = toolInputOf(name, given);
        const meta = toolMetaOf(name);
        // From Claude's display table, as VS Code's replay names a call.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L393
        const displayName = getClaudeToolDisplayName(name);
        startedAt.set(id, at);
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
          displayName,
          // Completed as its result says, once one is read; a call no result
          // was written for is read back cancelled at the end.
          status: 'completed',
          ...(input !== undefined ? { toolInput: input } : {}),
          // The kind a live call carries, so a transcript read back off
          // disk draws its shell commands as shell commands.
          ...(meta ? { _meta: meta } : {}),
          /*
           * Required on a completed call, all four of them.
           *
           * `invocationMessage` is the sentence the row draws; without it
           * there is nothing to draw. `confirmed` says nothing is being asked,
           * and without it a client reads every call in the transcript as a
           * question waiting on somebody. `success` and `pastTenseMessage`
           * stand until the call's result says otherwise.
           */
          invocationMessage: lineOf(name, given, displayName),
          confirmed: 'not-needed',
          success: true,
          pastTenseMessage: pastLineOf(name, given, displayName),
        } satisfies OnWire<ToolCallCompletedState>;
        calls.set(id, call);
        inputs.set(id, given);
        // The part is not re-checked: `call` is a `Bag` from here on, because
        // a tool result arriving later mutates it. The literal above is what
        // the protocol changes under, and the literal is what is checked.
        parts.push({ kind: 'toolCall', toolCall: call });
      }
    }
    /*
     * Every frame up to the next prompt is part of the turn that prompt
     * opened, as it was live: a round after a tool result answers the same
     * prompt. Only a transcript that starts with the agent, as a worker's
     * does, has no turn to join, and opens one in the agent's voice.
     */
    let turn = built[built.length - 1];
    if (turn === undefined) {
      if (parts.length === 0) continue;
      turn = {
        id: str(frame.uuid) ?? `a${built.length}`,
        startedAt: at,
        message: { text: '', origin: { kind: 'agent' } },
        responseParts: [],
        state: 'complete',
        usage: undefined,
      };
      built.push(turn);
    }
    turn.responseParts = [...(turn.responseParts as Bag[]), ...parts];
    lastAt.set(turn, Date.parse(at));
    ended(turn, frame);

    if (Object.keys(spent).length > 0) {
      const byMessage = spentBy.get(turn) ?? new Map<string, Bag>();
      spentBy.set(turn, byMessage);
      // The last frame of a message wins; a frame naming no message is its own.
      byMessage.set(str(message.id) ?? `frame:${byMessage.size}:${str(frame.uuid) ?? ''}`, spent);
      turn.usage = summed([...byMessage.values()]) as WireTurn<Turn>['usage'];
    }
  }

  /*
   * A call the transcript holds no result for never finished: its turn ended
   * around it. It reads back cancelled as skipped, which is how the protocol's
   * reducer holds a call still open when its turn ends, and the turn that held
   * it reads back cancelled. The reference reads a Claude transcript back so.
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L389-L417
   * https://github.com/microsoft/vscode/blob/1306698e328e5e531f5e632301d30020aa994eff/src/vs/platform/agentHost/node/claude/claudeReplayMapper.ts#L492-L514
   */
  for (const turn of built) {
    let unfinished = false;
    turn.responseParts = (turn.responseParts as Bag[]).map((part) => {
      const call = part.kind === 'toolCall' ? bag(part.toolCall) : undefined;
      const id = str(call?.toolCallId);
      if (call === undefined || id === undefined || resulted.has(id)) return part;
      unfinished = true;
      const { toolCallId, toolName, displayName, invocationMessage, toolInput, _meta } = call;
      return {
        kind: 'toolCall',
        toolCall: {
          status: 'cancelled',
          toolCallId,
          toolName,
          displayName,
          invocationMessage,
          ...(toolInput === undefined ? {} : { toolInput }),
          reason: 'skipped',
          ...(_meta === undefined ? {} : { _meta }),
        },
      };
    }) as WireTurn<Turn>['responseParts'];
    if (unfinished) turn.state = 'cancelled';
  }

  /*
   * How long each restored turn took, from its own frames: the last one it was
   * built from, less the one that opened it. A turn a single frame opened and
   * answered took no time at all, and says so.
   */
  for (const turn of built) {
    const ended = lastAt.get(turn);
    if (ended !== undefined) turn.duration = ended - Date.parse(turn.startedAt as string);
  }

  return built;
}

/** The usage of several API messages as one: token counts added, the last model named. */
function summed(messages: Bag[]): Bag {
  const out: Bag = {};
  for (const one of messages) {
    for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens']) {
      if (typeof one[key] === 'number') out[key] = ((out[key] as number | undefined) ?? 0) + (one[key] as number);
    }
    if (typeof one.model === 'string') out.model = one.model;
  }
  return out;
}

import type { ToolCallCompletedState, ToolCallRunningState, ToolResultContent } from '@microsoft/agent-host-protocol';
import type { StringOrMarkdown } from '@microsoft/agent-host-protocol';
import type { Bag, OnWire } from '@ahpd/sdk';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';
import { lineOf, pastLineOf, titleOf, toolInputOf } from '../input.js';
import { toolMetaOf } from '../kinds.js';
import { ranOn } from '../models.js';

/**
 * Which half of one API call's usage each streaming event reports.
 *
 * `message_start` carries the input side; `message_delta` carries the final
 * output and repeats the input counts the start already gave, to the same
 * numbers. A sum that read both whole would bill every prompt twice, so each
 * half is taken from the one event that completes it.
 */
const INPUT_SIDE = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens'];
const OUTPUT_SIDE = ['output_tokens'];

function resultText(content: unknown): string | undefined {
  if (typeof content === 'string') return content;
  const parts = list(content).map((block) => str(bag(block).text)).filter((t): t is string => t !== undefined);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/** What this area offers the rest of the session. */
export interface Stream {
  /** One SDK `stream_event`, turned into the chat actions it means. */
  streamed: (event: Bag, parent?: string) => void;
  /** The canonical assistant message, after its deltas have been drawn. */
  assistant: (message: Bag, parent?: string) => void;
  /** One `result`: what the call cost and how the run ended. */
  results: (message: Bag, parent?: string) => void;
  /** What each model round being streamed has said so far, by scope. */
  rounds: Map<string, { answered: boolean; stopped?: string }>;
  /** The line each call's row draws once it has ended, by its call id, made from its input. */
  pastLines: Map<string, StringOrMarkdown>;
}

export function createStream(ctx: SessionContext): Stream {
  /**
   * The MCP server a tool belongs to, out of its name.
   *
   * `mcp__<server>__<tool>` is the CLI's own naming, and it is the only thing
   * that says a call is somebody else's server's rather than the harness's -
   * which is what `ToolCallMcpContributor` records and what makes a call
   * blocked on a sign-in tellable from one blocked on its own work.
   */
  const serverOf = (toolName: string): string | undefined => /^mcp__(.+?)__/.exec(toolName)?.[1];

  /**
   * What each model round being streamed has said so far, by scope.
   *
   * A *model round* is one API message: `message_start` to `message_stop`.
   * A round that ends having produced neither text nor a tool call is one the
   * reference announces as `responseRoundEnded`, which is what tells a client
   * to settle whatever thinking section is open instead of drawing the next
   * round's thinking as the same one. Thinking does not count as an answer -
   * that is the whole case this exists for.
   *
   * Keyed by the stream event's `parent_tool_use_id`, empty for the session's
   * own agent, so a subagent's rounds cannot reset or satisfy the main one.
   * `stopped` is why the round stopped, from `message_delta`: `end_turn` is
   * the only reason that means the model chose to finish.
   */
  const rounds = new Map<string, { answered: boolean; stopped?: string }>();

  /** Which file each running edit tool is changing, by its call id. */
  const editing = new Map<string, string>();

  /** The line each call's row draws once it has ended, by its call id, made from its input. */
  const pastLines = new Map<string, StringOrMarkdown>();

  /** One line for a tool that is running. The name alone says too little. */
  /**
   * The file a tool is about to change, if it is one of the tools that do.
   *
   * Named tools rather than a guess at the input: a tool called `Bash` may
   * write a file too, and there is nothing in `rm -rf` that says which. What
   * this misses is honest - a changeset that claimed a file it could not name
   * would be worse than one that says nothing about it.
   */
  const edits = (name: string, input: Bag): string | undefined => {
    const known = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
    if (!known.includes(name)) return undefined;
    const path = str(input.file_path) ?? str(input.notebook_path);
    return path === '' ? undefined : path;
  };

  const streamed = (event: Bag, parent = ''): void => {
    const type = str(event.type);
    /*
     * The conversation this frame belongs to. Opened here rather than at the
     * first `assistant` frame, because a delta can arrive before the canonical
     * message that completes it.
     */
    const scope = ctx.scopeFor(parent);
    // The worker has not been named yet: held whole, and delivered once the
    // chat is open and the turn its frames belong to exists.
    if (scope.waiting !== undefined) {
      scope.waiting.push(() => { streamed(event, parent); });
      return;
    }

    if (type === 'message_start') {
      scope.streaming = str(bag(event.message).id) ?? 'm';
      // A new round: whatever the last one said, this one has said nothing.
      ctx.rounds.set(parent, { answered: false });
      ctx.openTurn(scope);
      // This call's input side, the half only this event reports.
      ctx.count(bag(event.message).usage, INPUT_SIDE);
      return;
    }

    /*
     * The end of a model round, and the one place a round can be seen to have
     * ended empty.
     *
     * The SDK has no event for "the round produced nothing" - the message's
     * own `message_start`/`message_stop` boundary is that event, and the
     * stream is the only thing that reports it. The reason is read here so
     * `message_stop` can tell a round the model finished from one it quit.
     */
    if (type === 'message_delta') {
      const round = ctx.rounds.get(parent);
      const reason = str(bag(event.delta).stop_reason);
      if (round !== undefined && reason !== undefined) round.stopped = reason;
      // The call's output is final here, and this is its one chance to be
      // counted into the turn: a subagent's rounds end their own way, and the
      // lead's last delta arrives long before its `result`.
      ctx.count(event.usage, OUTPUT_SIDE);
      ctx.sayUsage();
      return;
    }
    if (type === 'message_stop') {
      const round = ctx.rounds.get(parent);
      ctx.rounds.delete(parent);
      /*
       * A round nobody answered, announced where it happened.
       *
       * The session's own rounds go on the session's chat, and a subagent's on
       * the chat it was given. Without the host's seam a subagent has no chat,
       * so its round stays unannounced rather than settling the main agent's
       * thinking for a round it did not end.
       */
      if ((parent === '' || scope.chat !== undefined)
        && round !== undefined && !round.answered && round.stopped === 'end_turn' && scope.turn) {
        /*
         * The reference's part, keyed the way its client reads it.
         *
         * `content` is empty because there is nothing to draw; the `_meta`
         * says why, and a client settles an open thinking section and renders
         * nothing. No id: `SystemNotificationResponsePart` has none, and the
         * reference's own carries none either.
         */
        ctx.addPart(scope, {
          kind: 'systemNotification',
          content: '',
          _meta: { kind: 'responseRoundEnded' },
        });
      }
      return;
    }

    const of = scope.streaming ?? 'm';
    const key = `#${of}:${String(event.index)}`;

    if (type === 'content_block_start') {
      const turn = ctx.openTurn(scope);
      const block = bag(event.content_block);
      const kind = str(block.type);
      // Prose or a tool call is an answer; thinking is not, which is the whole
      // point of the round-ends-empty signal.
      if (kind === 'text' || kind === 'tool_use') {
        const round = ctx.rounds.get(parent);
        if (round !== undefined) round.answered = true;
      }
      /*
       * A tool call, opened while its arguments are still arriving.
       *
       * `streaming` is the status the protocol has for exactly this, and
       * `partialInput` is where the half-written json goes - a client draws
       * the row as soon as the name is known and fills the arguments in as
       * they come, rather than waiting for the complete block. The permission
       * callback and the completed assistant message both find this call
       * under the same id and carry it on from here.
       */
      if (kind === 'tool_use') {
        const id = str(block.id) ?? `${of}:${String(event.index)}`;
        scope.calling.set(key, id);
        if (scope.parts.has(id)) return;
        const name = str(block.name) ?? 'tool';
        // Whose tool it is, when it is an MCP server's. The reducer refuses
        // `chat/toolCallAuthRequired` on a call with no MCP contributor, so
        // this is also what makes a sign-in mid-call sayable at all.
        const from = serverOf(name);
        const contributor = from === undefined
          ? undefined
          : { kind: 'mcp' as const, customizationId: `mcp:${from}` };
        // What kind of row to draw, from the name and from the first frame:
        // a client that waited for the arguments to know it was a shell
        // command would draw a generic box and then redraw it.
        const meta = toolMetaOf(name);
        const call: Bag = {
          toolCallId: id,
          toolName: name,
          displayName: name,
          status: 'streaming',
          ...(contributor ? { contributor } : {}),
          ...(meta ? { _meta: meta } : {}),
        };
        const part: Bag = { id, kind: 'toolCall', toolCall: call };
        scope.parts.set(id, part);
        ctx.holdPart(turn, part);
        ctx.emitOn(scope, {
          type: 'chat/toolCallStart',
          turnId: turn.id,
          toolCallId: id,
          toolName: name,
          displayName: name,
          ...(contributor ? { contributor } : {}),
          ...(meta ? { _meta: meta } : {}),
        });
        return;
      }
      // Everything else that is not prose has no part to open.
      if (kind !== 'text' && kind !== 'thinking') return;
      if (scope.parts.has(key)) return;
      const part: Bag = {
        id: `${of}:${String(event.index)}`,
        kind: kind === 'text' ? 'markdown' : 'reasoning',
        content: '',
      };
      scope.parts.set(key, part);
      // The part first, always. A delta naming a part nobody opened is text
      // the client has nowhere to put.
      ctx.addPart(scope, part);
      return;
    }

    if (type === 'content_block_delta') {
      const toolCallId = scope.calling.get(key);
      if (toolCallId !== undefined) {
        const json = str(bag(event.delta).partial_json);
        const call = bag(scope.parts.get(toolCallId)?.toolCall);
        // Only while it is streaming: once the arguments are complete the
        // call carries `toolInput`, and appending to `partialInput` after
        // that is writing into a field the reducer has stopped reading.
        if (json === undefined || str(call.status) !== 'streaming') return;
        call.partialInput = `${String(call.partialInput ?? '')}${json}`;
        ctx.emitOn(scope, { type: 'chat/toolCallDelta', turnId: scope.turn?.id, toolCallId, content: json });
        return;
      }
      const part = scope.parts.get(key);
      if (!part) return;
      const text = str(bag(event.delta).text) ?? str(bag(event.delta).thinking);
      if (text === undefined) return;
      part.content = `${String(part.content ?? '')}${text}`;
      /*
       * The append action follows the part it appends to.
       *
       * `chat/delta` is defined against a *markdown* part and `chat/reasoning`
       * against a *reasoning* one, and the canonical reducer enforces the
       * pairing rather than being lenient about it - a delta naming a
       * reasoning part is returned unchanged. Sending thinking as a delta
       * therefore opens the part and never fills it, which draws a thinking
       * header with nothing under it for as long as the model thinks.
       */
      const append = part.kind === 'reasoning' ? 'chat/reasoning' : 'chat/delta';
      ctx.emitOn(scope, { type: append, turnId: scope.turn?.id, partId: part.id, content: text });
    }
  };

  const assistant = (message: Bag, parent = ''): void => {
    const scope = ctx.scopeFor(parent);
    if (scope.waiting !== undefined) {
      scope.waiting.push(() => { assistant(message, parent); });
      return;
    }
    const turn = ctx.openTurn(scope);
    const of = str(message.id) ?? 'm';
    // The model a turn ran on is the session's own answer; a worker's may be
    // a different one and is not what the session reports.
    if (scope === ctx.mainScope) ctx.ran = ranOn(message.model) ?? ctx.ran;
    const blocks = list(message.content);

    for (let index = 0; index < blocks.length; index++) {
      const block = bag(blocks[index]);
      const kind = str(block.type);

      if (kind === 'text' || kind === 'thinking') {
        // Already opened and already filled by the deltas. Writing the complete
        // block on top of it prints the whole answer twice.
        if (scope.parts.has(`#${of}:${index}`)) continue;
        const part: Bag = {
          id: `${of}:${index}`,
          kind: kind === 'text' ? 'markdown' : 'reasoning',
          content: str(block.text) ?? str(block.thinking) ?? '',
        };
        scope.parts.set(`#${of}:${index}`, part);
        ctx.addPart(scope, part);
        continue;
      }

      if (kind === 'tool_use') {
        const id = str(block.id) ?? `${of}:${index}`;
        /*
         * The call as it stands, if something opened it already.
         *
         * Two things do. The arguments streaming in open it `streaming`, with
         * the name and nothing else, and leave the input to be filled in here
         * - which is what `chat/toolCallReady` is for. The permission callback
         * opens it `pending-confirmation` and has already asked, so that one
         * is left alone: completing it here would answer a question nobody
         * put. The same assistant message can also arrive more than once while
         * it streams, and a second part for it is the same row drawn twice.
         */
        const open = scope.parts.get(id);
        if (open !== undefined && str(bag(open.toolCall).status) !== 'streaming') continue;
        const name = str(block.name) ?? 'tool';
        const line = lineOf(name, bag(block.input));
        ctx.pastLines.set(id, pastLineOf(name, bag(block.input)));
        const input = toolInputOf(name, bag(block.input));
        const from = serverOf(name);
        /*
         * A spawning call, whose input is the only place the harness says what
         * the worker is for. Recorded here rather than where the block streams
         * in, because the input is complete only in the canonical message -
         * and a worker's first frame can arrive before this one does, which is
         * what the scope waits for. Recorded there too, from the permission
         * callback, which is handed the whole input and can be first.
         */
        if (name === 'Task' || name === 'Agent') ctx.recordSpawn(id, bag(block.input), scope, str(turn.id));
        /*
         * Whose tool this is, which decides who has to run it.
         *
         * A client's own beats the server it is offered through: the tools a
         * client provides are carried to the model on this host's in-process
         * server, so by name they all look like `mcp__ahp__*` - and reporting
         * one as this host's contribution would tell every client that the
         * call is nobody's to answer, including the one whose call it is.
         */
        const own = ctx.providedBy(name);
        if (own !== undefined) ctx.opening(name, id, bag(block.input));
        const contributor = own !== undefined
          ? { kind: 'client' as const, clientId: own }
          : from === undefined
            ? undefined
            : { kind: 'mcp' as const, customizationId: `mcp:${from}` };
        // Running against somebody else's server, and so a call that can end
        // up waiting on a sign-in rather than on its own work.
        if (from !== undefined) ctx.onServer.set(id, { server: from, turnId: str(turn.id) ?? '', blocked: false });
        /*
         * A spawning call's `_meta` also says what the worker is for, under the
         * reference's keys: `subagentDescription` from the call's `description`
         * and `subagentAgentName` from its `subagent_type`. The host adds the
         * worker chat's URI.
         */
        const spawned = ctx.spawning.get(id);
        const described = spawned === undefined ? {} : {
          ...(spawned.description !== undefined ? { subagentDescription: spawned.description } : {}),
          ...(spawned.subagentType !== undefined ? { subagentAgentName: spawned.subagentType } : {}),
        };
        const kindOf = toolMetaOf(name);
        const meta = kindOf === undefined && Object.keys(described).length === 0 ? undefined : { ...kindOf, ...described };
        const call: Bag = open !== undefined ? bag(open.toolCall) : {
          toolCallId: id,
          toolName: name,
          displayName: name,
          status: 'running',
          ...(contributor ? { contributor } : {}),
          ...(meta ? { _meta: meta } : {}),
          /*
           * On the call, and not only on the action that announces it.
           *
           * A client driven by actions builds its own state and gets these
           * from `chat/toolCallReady` below. A client that *subscribes* reads
           * the snapshot instead, and `ToolCallState` requires both - so every
           * tool call in a transcript was a row with no sentence to draw and
           * no answer to whether anybody had approved it. The two have to say
           * the same thing, and this is the half that was not being said.
           */
          invocationMessage: line,
          confirmed: 'not-needed',
          ...(input !== undefined ? { toolInput: input } : {}),
        } satisfies OnWire<ToolCallRunningState>;
        if (open === undefined) {
          const part: Bag = { id, kind: 'toolCall', toolCall: call };
          scope.parts.set(id, part);
          ctx.holdPart(turn, part);
        }
        else {
          // The half-written json is what `toolInput` now says properly, and
          // a client that kept both would draw the arguments twice.
          call.status = 'running';
          call.invocationMessage = line;
          call.confirmed = 'not-needed';
          delete call.partialInput;
          if (input !== undefined) call.toolInput = input;
          if (spawned !== undefined) call._meta = { ...bag(call._meta), ...described };
        }
        if (scope === ctx.mainScope) ctx.doing(ctx.busyWith(name, bag(block.input)));
        /*
         * The file as it is *now*, before the tool has run.
         *
         * Announced and executed are concurrent - the SDK yields this block
         * and runs the tool - so this is a race the tool's own disk I/O
         * usually loses. Best effort, and the reference host relies on the
         * same headroom.
         */
        const changing = edits(name, bag(block.input));
        if (changing !== undefined) {
          editing.set(id, changing);
          ctx.options.onFileEdit?.(str(turn.id) ?? '', changing, 'before');
        }
        if (open === undefined) {
          ctx.emitOn(scope, {
            type: 'chat/toolCallStart',
            turnId: turn.id,
            toolCallId: id,
            toolName: name,
            displayName: name,
            ...(contributor ? { contributor } : {}),
            ...(meta ? { _meta: meta } : {}),
          });
        }
        /*
         * When it starts running, on this plugin's clock, which is the ready
         * for a call nobody is asked about. A call `canUseTool` asks about is
         * stamped again when it is approved, so the wait is not counted.
         */
        ctx.stampStart(call);
        ctx.emitOn(scope, {
          type: 'chat/toolCallReady',
          turnId: turn.id,
          toolCallId: id,
          ...(contributor ? { contributor } : {}),
          // What the call does, as the same call read back from its
          // transcript is drawn.
          invocationMessage: line,
          // Nothing is being asked here - `canUseTool` is what asks. Without
          // this the reducer moves every tool call in the transcript into
          // `pending-confirmation` and draws it as a question nobody put.
          confirmed: 'not-needed',
          ...(input !== undefined ? { toolInput: input } : {}),
          // The whole bag, because an action's `_meta` replaces the call's.
          _meta: bag(call._meta),
        });
      }
    }
  };

  const results = (message: Bag, parent = ''): void => {
    const scope = ctx.scopeFor(parent);
    if (scope.waiting !== undefined) {
      scope.waiting.push(() => { results(message, parent); });
      return;
    }
    for (const raw of list(message.content)) {
      const block = bag(raw);
      if (str(block.type) !== 'tool_result') continue;
      const id = str(block.tool_use_id);
      /*
       * A worker that spoke before the call that spawned it was recorded.
       *
       * The call's own result is the last thing there is to wait for: its
       * spawn was either going to be recorded by now or it never will be, and
       * a worker whose call has ended has a chat either way. Before the part is
       * looked up, because a call whose `tool_use` never arrived is exactly the
       * one with a result and nothing else - and before `workerBlock` below, so
       * a result for a call that does have a record still links what it opens.
       */
      if (id !== undefined) ctx.releaseHeld(id);
      const part = id ? scope.parts.get(id) : undefined;
      if (!part) continue;
      const call = bag(part.toolCall);
      /*
       * A tool that failed is `completed`, and says so in its result.
       *
       * `ToolCallStatus` has no `failed`: the seven are `streaming`,
       * `pending-confirmation`, `running`, `auth-required`,
       * `pending-result-confirmation`, `completed` and `cancelled`. A tool that
       * ran and went wrong ran - what went wrong is `result.success` and
       * `result.error`, which is also the only place a client looks for it.
       */
      const ok = block.is_error !== true;
      // A call a person declined is already `cancelled`, and it never ran, so
      // its completion carries no times.
      const ran = call.status !== 'cancelled';
      call.status = 'completed';
      // Finished, so it is no longer waiting on anything - including a
      // sign-in nobody ever did.
      if (id !== undefined) ctx.onServer.delete(id);
      // Back to thinking. Leaving the last tool's name up makes a session look
      // busy with something that finished.
      if (scope === ctx.mainScope) ctx.doing('Thinking');
      const text = resultText(block.content);
      /*
       * The result, as one object, because that is the only part of the action
       * a client reads.
       *
       * `ToolCallCompletedState` extends `ToolCallResult`, and the reducer
       * builds it by spreading `action.result` over the call - so `status` and
       * `content` sent beside the action rather than inside it are dropped
       * without a word, and every tool's output stopped at this host. `success`
       * and `pastTenseMessage` are required; `content` blocks are MCP's, and
       * carry a `type`.
       *
       * The past-tense line is made from the call's input when it was known,
       * the same line whether the call succeeded or failed: a failure is
       * `success`. The row line is read back only as plain text, for a call
       * whose input never arrived.
       */
      const said = (id === undefined ? undefined : ctx.pastLines.get(id)) ?? str(call.invocationMessage) ?? str(call.displayName) ?? str(call.toolName) ?? 'the tool';
      if (id !== undefined) ctx.pastLines.delete(id);
      // The input a question ran with, for a call that was answered. A denied or
      // cancelled one was never answered and settles with no input recorded.
      const answered = id === undefined ? undefined : ctx.answeredInputs.get(id);
      if (id !== undefined) ctx.answeredInputs.delete(id);
      /*
       * The link survives the result.
       *
       * The worker's chat points at this call, and the protocol requires the
       * call to point back. The completion action replaces the call's whole
       * content, so the block the host put there when the chat opened has to
       * be carried into the completion or the link is gone the moment the
       * worker finishes. A call that asked for the background completes before
       * its worker says anything, with a result that only says it was
       * launched, so its worker is opened here and the completion names it.
       */
      if (id !== undefined && ctx.spawning.get(id)?.foreground === false) ctx.scopeFor(id);
      const workerContent = id === undefined ? undefined : ctx.workerBlock(id);
      const result = {
        success: ok,
        pastTenseMessage: said,
        ...(text !== undefined || workerContent !== undefined
          ? { content: [...(workerContent !== undefined ? [workerContent] : []), ...(text !== undefined ? [{ type: 'text', text }] : [])] as OnWire<ToolResultContent>[] }
          : {}),
        ...(ok ? {} : { error: { message: text ?? 'The tool failed' } }),
        ...(answered !== undefined ? { structuredContent: answered } : {}),
      } satisfies Partial<OnWire<ToolCallCompletedState>>;
      /*
       * Onto the call *and* into the action, from one object.
       *
       * `ToolCallCompletedState` extends `ToolCallResult`, and the reducer
       * builds the state by spreading the action's `result` over the call - so
       * the two have to say the same thing. Written out twice they drifted,
       * which is how a transcript's tool calls came to be missing fields the
       * action had been carrying all along. One literal cannot drift from
       * itself, and it is checked against the state it completes.
       */
      Object.assign(call, result);
      /*
       * The progress line goes with the running state it described.
       *
       * Meaningful only while the call runs, and a completed row that still
       * carries "Running Grep" is a row that says two things.
       */
      const meta = bag(call._meta);
      const progressed = meta.progressMessage !== undefined;
      if (progressed) {
        const { progressMessage: _gone, ...rest } = meta;
        call._meta = rest;
      }
      // When it ended, measured from the start the call holds. A call a person
      // declined never ran, so it keeps none.
      if (ran) ctx.stampEnd(call);
      // And as it is now the tool has run. Paired with the `before` above by
      // the call's own id, which is the only thing that survives the gap.
      const changed = id === undefined ? undefined : editing.get(id);
      if (id !== undefined && changed !== undefined) {
        editing.delete(id);
        ctx.options.onFileEdit?.(str(scope.turn?.id) ?? '', changed, 'after');
      }
      ctx.emitOn(scope, {
        type: 'chat/toolCallComplete',
        turnId: scope.turn?.id,
        toolCallId: id,
        result,
        // The whole bag: an action's `_meta` replaces the call's, so the
        // times and the kind have to be said again here or they are gone.
        ...(call._meta === undefined ? {} : { _meta: call._meta }),
      });
      /*
       * A spawning call's result ends the worker it ran when the call did not
       * ask for the background. A call that did gets a result saying only that
       * the worker was launched, and its worker ends on its notification.
       */
      const info = id === undefined ? undefined : ctx.spawning.get(id);
      if (id !== undefined && info !== undefined) {
        info.completed = true;
        if (info.foreground) ctx.endWorker(id, ok ? 'complete' : 'error', ok ? undefined : text);
        // Ended, or never opened and not running on in the background.
        if (ctx.ended.has(id) || (!ctx.scopes.has(id) && info.foreground)) ctx.spawning.delete(id);
      }
    }
  };

  return { streamed, assistant, results, rounds, pastLines };
}

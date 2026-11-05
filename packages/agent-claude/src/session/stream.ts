import type { ToolCallCompletedState, ToolCallRunningState, ToolResultContent } from '@microsoft/agent-host-protocol';
import type { StringOrMarkdown } from '@microsoft/agent-host-protocol';
import type { Bag, OnWire } from '@ahpd/sdk';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';
import { createTasks } from './tasks.js';
import { lineOf, pastLineOf, titleOf, toolInputOf, writeOf } from '../input.js';
import { claudeToolDenialCode, getClaudeToolDisplayName, toolMetaOf } from '../kinds.js';
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
  results: (message: Bag, parent?: string, structured?: unknown) => void;
  /** What each model round being streamed has said so far, by scope. */
  rounds: Map<string, { answered: boolean; stopped?: string }>;
  /** The line each call's row draws once it has ended, by its call id, made from its input. */
  pastLines: Map<string, StringOrMarkdown>;
  /** Whose tool a call runs, as its start says it: a client's, an MCP server's, or nobody's. */
  contributorOf: (toolName: string) => Contributor | undefined;
  /** The name a call's row is drawn under. */
  displayNameOf: (toolName: string) => string;
  /** Every file an edit call began changing, recorded as it is now: a stop closes the CLI that would have ended the call. */
  editsStopped: () => void;
}

/** A call's contributor, in the protocol's two kinds. */
export type Contributor = { kind: 'client'; clientId: string } | { kind: 'mcp'; customizationId: string };

export function createStream(ctx: SessionContext): Stream {
  const tasks = createTasks(ctx);
  /**
   * The MCP server a tool belongs to, out of its name.
   *
   * `mcp__<server>__<tool>` is the CLI's own naming, and it is the only thing
   * that says a call is somebody else's server's rather than the harness's,
   * which is what makes a call blocked on a sign-in tellable from one blocked
   * on its own work. The server is the name's second segment, as VS Code's
   * Claude session reads it.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L432-L435
   */
  const serverOf = (toolName: string): string | undefined =>
    (toolName.startsWith('mcp__') ? toolName.split('__')[1] || undefined : undefined);

  /**
   * Whose tool a call runs, as the call's start says it: the client whose own
   * tool it is, or else the MCP server of this session's customizations whose
   * it is, by the customization's id, as VS Code's Claude session stamps it.
   * A call of a server the session lists no customization for names none.
   *
   * A client's own beats the server it is offered through: the tools a client
   * provides reach the model on this host's in-process `client` server, so by
   * name they look like `mcp__client__*`. And it is said at the start, because the start
   * is where the protocol establishes who runs a call; a later contributor may
   * refine an MCP server's but never make a call a client's.
   * https://github.com/microsoft/agent-host-protocol/blob/5f16d81bb7045b66d7bc768d244feab75002d943/docs/specification/chat-channel.md#L306-L318
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeAgentSession.ts#L427-L441
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/shared/mcpCustomizationController.ts#L692-L710
   */
  const contributorOf = (toolName: string): Contributor | undefined => {
    const own = ctx.clientToolOf(toolName);
    if (own !== undefined) return { kind: 'client', clientId: own.owner };
    const from = serverOf(toolName);
    if (from === undefined) return undefined;
    const server = [...ctx.customizations, ...ctx.customizations.flatMap((one) => list(one.children).map(bag))]
      .find((one) => str(one.type) === 'mcpServer' && str(one.name) === from);
    const customizationId = str(server?.id);
    return customizationId === undefined ? undefined : { kind: 'mcp', customizationId };
  };

  /**
   * The name a call's row is drawn under, as VS Code's Claude agent draws it:
   * a client's tool by the name its client announced, the host's own tool by
   * its title, and the CLI's tools from Claude's display table.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L672
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeToolDisplay.ts#L142-L146
   */
  const displayNameOf = (toolName: string): string =>
    ctx.clientToolOf(toolName)?.name ?? ctx.hostToolOf(toolName)?.definition.title ?? getClaudeToolDisplayName(toolName);

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

  /** Which file each running edit tool is changing, and in which turn, by its call id. */
  const editing = new Map<string, { path: string; turn: string; name: string; input: Bag }>();

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
      if (ctx.openTurn(scope) === undefined) return;
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
      if (turn === undefined) return;
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
        const name = str(block.name) ?? 'tool';
        /*
         * The host draws the turn's Plan call from its own list, so Claude's
         * own list is not a row of its own. The call still runs and its result
         * is still read; only the row a client would draw is left out.
         */
        if (ctx.options.plan === true && name === 'TodoWrite') return;
        scope.activeToolBlocks.set(key, id);
        if (scope.parts.has(id)) return;
        // A spawning call's spawn, recorded at its block's start as VS Code's
        // mapper records it, so its worker's chat opens on the worker's first
        // frame with what the record holds by then.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L646-L653
        if (name === 'Task' || name === 'Agent') ctx.recordSpawn(id, {}, scope);
        // Whose tool it is. The reducer refuses `chat/toolCallAuthRequired` on
        // a call with no MCP contributor, so an MCP server's is also what makes
        // a sign-in mid-call sayable at all.
        const contributor = contributorOf(name);
        // What kind of row to draw, from the name and from the first frame:
        // a client that waited for the arguments to know it was a shell
        // command would draw a generic box and then redraw it.
        const meta = toolMetaOf(name);
        // A client's own tool by the name it announced, as VS Code's Claude
        // takes the client server's prefix off; the CLI keeps its own name.
        // https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L637-L638
        const shown = ctx.clientToolOf(name)?.name ?? name;
        const displayName = displayNameOf(name);
        const call: Bag = {
          toolCallId: id,
          toolName: shown,
          displayName,
          status: 'streaming',
          ...(contributor ? { contributor } : {}),
          ...(meta ? { _meta: meta } : {}),
        };
        const part: Bag = { kind: 'toolCall', toolCall: call };
        scope.parts.set(id, part);
        ctx.holdPart(turn, part);
        ctx.emitOn(scope, {
          type: 'chat/toolCallStart',
          turnId: turn.id,
          toolCallId: id,
          toolName: shown,
          displayName,
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
      const toolCallId = scope.activeToolBlocks.get(key);
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
    if (turn === undefined) return;
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
        // Claude's own task tools, as the session's plan. After the guard
        // above, so a message that arrives more than once writes once.
        tasks.called(str(turn.id) ?? '', id, name, bag(block.input));
        /*
         * The host draws the turn's Plan call from its own list, so Claude's
         * own list is not a row of its own. The call still runs and its result
         * is still read; only the row a client would draw is left out.
         */
        if (ctx.options.plan === true && name === 'TodoWrite') continue;
        const displayName = displayNameOf(name);
        const line = lineOf(name, bag(block.input), displayName);
        ctx.pastLines.set(id, pastLineOf(name, bag(block.input), displayName));
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
        if (name === 'Task' || name === 'Agent') ctx.recordSpawn(id, bag(block.input), scope);
        // Whose tool this is, which decides who has to run it, as its start
        // said it.
        const contributor = contributorOf(name);
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
        // A client's own tool by the name it announced.
        const shown = ctx.clientToolOf(name)?.name ?? name;
        const call: Bag = open !== undefined ? bag(open.toolCall) : {
          toolCallId: id,
          toolName: shown,
          displayName,
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
          const part: Bag = { kind: 'toolCall', toolCall: call };
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
          editing.set(id, { path: changing, turn: str(turn.id) ?? '', name, input: bag(block.input) });
          ctx.options.onFileEdit?.(str(turn.id) ?? '', changing, 'before');
        }
        if (open === undefined) {
          ctx.emitOn(scope, {
            type: 'chat/toolCallStart',
            turnId: turn.id,
            toolCallId: id,
            toolName: shown,
            displayName,
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
        /*
         * A client's call, raised on the session and held for its owner.
         *
         * Here, and not where the call is first announced: a call
         * `canUseTool` asks about is not running until the person approves it,
         * and an entry raised then would tell a client to run a tool nobody
         * has allowed. This is the same moment the ready goes out, so the
         * entry and the chat agree about the call being under way.
         */
        ctx.openCall(name, str(turn.id) ?? '', id, line, input);
      }
    }
  };

  /**
   * The file an edit tool changed, as it is now the tool has run.
   *
   * Paired with the `before` by the call's own id, which is the only thing
   * that survives the gap, and recorded against the turn the `before` was:
   * the turn the call was made in, whichever turn is running when it ends.
   */
  const edited = (id: string): void => {
    const changed = editing.get(id);
    if (changed === undefined) return;
    editing.delete(id);
    ctx.options.onFileEdit?.(changed.turn, changed.path, 'after');
  };

  /**
   * A spawning call's result ends the worker it ran when the worker runs in
   * the foreground, its chat's turn complete however the call ended, as VS
   * Code completes a subagent's chat. A background worker's call gets a
   * result saying only that the worker was launched, and its worker ends on
   * its notification.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L1503-L1520
   */
  const settleSpawn = (id: string): void => {
    const info = ctx.spawning.get(id);
    if (info === undefined) return;
    info.completed = true;
    if (info.foreground) ctx.endSubagent(id, 'complete');
    // Ended, or never opened and not running on in the background.
    if (ctx.completed.has(id) || (!ctx.scopes.has(id) && info.foreground)) ctx.spawning.delete(id);
  };

  const results = (message: Bag, parent = '', structured?: unknown): void => {
    const scope = ctx.scopeFor(parent);
    if (scope.waiting !== undefined) {
      scope.waiting.push(() => { results(message, parent, structured); });
      return;
    }
    for (const raw of list(message.content)) {
      const block = bag(raw);
      if (str(block.type) !== 'tool_result') continue;
      const id = str(block.tool_use_id);
      // Where a `TaskCreate` learns the id the harness gave the task, from the
      // structured output beside its result. Before the part is looked up: a
      // create whose call never reached this stream still made a task.
      if (id !== undefined) tasks.ended(id, structured);
      const part = id ? scope.parts.get(id) : undefined;
      if (id === undefined || !part) continue;
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
      const text = resultText(block.content);
      // Finished, so it is no longer waiting on anything - including a
      // sign-in nobody ever did.
      ctx.onServer.delete(id);
      /*
       * A result for a call whose turn has already ended.
       *
       * The CLI writes one for the call a stopped turn was in, after the
       * stop. The protocol's reducer completes a call in the active turn and
       * in no other, so every client that watched keeps this call as the stop
       * left it. The record a client reads afterwards says the same, and
       * nothing is announced. What the call holds outside its turn still
       * ends here, as it does for any other result.
       */
      if (!list(scope.turn?.responseParts).includes(part)) {
        ctx.pastLines.delete(id);
        edited(id);
        settleSpawn(id);
        continue;
      }
      // A call a person declined is already `cancelled`, and it never ran, so
      // its completion carries no times.
      const ran = call.status !== 'cancelled';
      call.status = 'completed';
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
       * The past-tense line as VS Code's Claude mapper words it: a client's
       * tool its name, a failed call `"<display name>" failed`, and one that
       * ran the line made from its input when it was known, the row line read
       * back as plain text for a call whose input never arrived. `error` only
       * for a call refused, classified as VS Code classifies the refusal.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L393-L422
       */
      const displayName = str(call.displayName) ?? str(call.toolName) ?? 'the tool';
      const said = bag(call.contributor).kind === 'client' ? displayName
        : !ok ? pastLineOf(str(call.toolName) ?? '', {}, displayName, false)
          : ctx.pastLines.get(id) ?? str(call.invocationMessage) ?? displayName;
      ctx.pastLines.delete(id);
      const denial = ok || text === undefined ? undefined : claudeToolDenialCode(text);
      /*
       * The link survives the result.
       *
       * The worker's chat points at this call, and the protocol requires the
       * call to point back. The completion action replaces the call's whole
       * content, so the block the host put there when the chat opened has to
       * be carried into the completion or the link is gone the moment the
       * worker finishes. A background worker's call completes before its
       * worker says anything, with a result that only says it was launched,
       * so its worker is opened here and the completion names it.
       */
      if (ctx.spawning.get(id)?.foreground === false) ctx.scopeFor(id);
      const workerContent = ctx.subagentBlock(id);
      /*
       * The terminal that shows a `Bash` output too large to send, after the
       * notice that stands in for that output in the text, which is where the
       * reference adds it.
       * https://github.com/microsoft/vscode/blob/41c37d126aa93bece57534a18f0750e4dcb6b38c/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L383-L391
       */
      const retained = id === undefined ? undefined : ctx.retainedTerminalOutputs.get(id);
      if (id !== undefined) ctx.retainedTerminalOutputs.delete(id);
      /*
       * The file an edit tool changed, its two sides held by the host for a
       * client to draw the call's diff from, after the text, as VS Code's
       * Claude observer attaches the edit to the completion. The sides are the
       * SDK's own report of the edit: the file as it was, and the edit applied
       * to it, or the whole of a write; a report that lacks the file as it was,
       * which the SDK leaves out of a file too large to diff, has none.
       * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L385-L388
       */
      const editOf = (): Bag | undefined => {
        const held = editing.get(id);
        const reported = bag(structured);
        if (!ok || held === undefined) return undefined;
        const created = held.name === 'Write' && str(reported.type) === 'create';
        const before = str(reported.originalFile);
        if (before === undefined && !created) return undefined;
        const after = writeOf(held.name, held.input)?.apply(before);
        if (after === undefined) return undefined;
        const edit = ctx.options.onEditCompleted?.(id, held.path, before, after);
        return edit === undefined ? undefined : { type: 'fileEdit', ...edit };
      };
      const fileEdit = editOf();
      const shown = [
        ...(workerContent !== undefined ? [workerContent] : []),
        ...(text !== undefined ? [{ type: 'text', text }] : []),
        ...(fileEdit !== undefined ? [fileEdit] : []),
        ...(retained !== undefined ? [retained] : []),
      ] as OnWire<ToolResultContent>[];
      const result = {
        success: ok,
        pastTenseMessage: said,
        ...(shown.length > 0 ? { content: shown } : {}),
        ...(denial === undefined || text === undefined ? {} : { error: { message: text, code: denial } }),
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
      edited(id);
      ctx.emitOn(scope, {
        type: 'chat/toolCallComplete',
        turnId: scope.turn?.id,
        toolCallId: id,
        result,
        // The whole bag: an action's `_meta` replaces the call's, so the
        // times and the kind have to be said again here or they are gone.
        ...(call._meta === undefined ? {} : { _meta: call._meta }),
      });
      settleSpawn(id);
    }
  };

  const editsStopped = (): void => {
    for (const id of [...editing.keys()]) edited(id);
  };

  return { streamed, assistant, results, rounds, pastLines, contributorOf, displayNameOf, editsStopped };
}

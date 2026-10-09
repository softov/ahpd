import { PERMISSION_MODES, createAgent, createAskUserTool, policyOf } from '@cofold/agents';
import type { Agent as CofoldAgent, PermissionMode, Tool } from '@cofold/agents';
import { resolveWithin } from '@cofold/tools';
import { workspaceSlug } from '@cofold/store-file';
import { createClientCalls } from '@ahpd/sdk';
import type { Bag, ClientCallAnswer, Session } from '@ahpd/sdk';
import { join } from 'node:path';
import { DEFAULT_TOOLS, capabilitiesOf } from './capabilities.js';
import { defaultStoreRoot, modelOf, modelReferenceOf } from './agent.js';
import type { CofoldOptions, Held } from './agent.js';
import { cofoldTools, describe } from './tools.js';
import type { ClientToolCall, ClientToolRelay } from './tools.js';
import type { HarnessConfig } from './config.js';
import type { SessionContext } from './context.js';

/**
 * Whether a path a tool names stays inside the directory the session works in.
 *
 * `resolveWithin` is `@cofold/tools`' own resolver, which its file tools resolve
 * every path with and refuse nothing by, so this host judges a path where they
 * will touch it: a symlink out of the workspace is outside, and a link whose
 * target does not exist yet is judged by the target it names, not the link.
 *
 * The workspace boundary is a host fact, which is why the harness takes it as
 * a predicate rather than a directory: this host's tools are the daemon's and
 * a client's, and a path is either under the directory the session was opened
 * in or it is not.
 */
const insideDirectory = (workspace: string, path: string): boolean =>
  resolveWithin(workspace, path).inside;

/**
 * Where a session's memory files live, or nothing for a store kept in memory.
 *
 * cofold keeps memory under a folder its caller names, one folder per
 * workspace. This host names the store's own root, so memory goes under
 * `<store>/memory/<workspace slug>`, beside the sessions, and the store and
 * its memory are one thing to back up. A store deliberately in memory has no
 * directory at all, and the memory capability is left out rather than given
 * one under somebody's home.
 */
const memoryDirOf = (options: CofoldOptions, workspace: string): string | undefined =>
  options.memory === true
    ? undefined
    : join(options.store ?? defaultStoreRoot(), 'memory', workspaceSlug({ workspace }));

/**
 * The file a call is about to change, or nothing for a call that changes none.
 *
 * The tool's own `writes` is where a call names the file it changes, resolved
 * against the directory that tool works in (cofold decision 117), so this host
 * keeps no list of tool names: a capability's tool and a host tool that
 * declares one are both read the same way. Only a file inside the workspace is
 * an edit - a changeset is about the files a session can read, and a shell or
 * a memory file is not one of them.
 */
const editPathOf = (workspace: string, tool: Tool<any, any>, input: unknown): string | undefined => {
  const written = tool.writes?.(input);
  return written !== undefined && insideDirectory(workspace, written) ? written : undefined;
};

/**
 * The share of a model's window a session folds its history at.
 *
 * The same 80% papo keeps. A summary is written by asking the model, so the
 * step that writes it needs room of its own, and a point at the window itself
 * would fold a history the summary step could not fit either.
 */
export const AUTO_COMPACT_AT = 0.8;

/**
 * The window a model cofold was told no number for is sized by.
 *
 * This is cofold's own default `ContextOptions.maxTokens`, repeated so a
 * session with nothing to read a window from - no catalogue, or an adapter a
 * caller passed - is built against the same number cofold would have used.
 */
export const DEFAULT_CONTEXT_TOKENS = 32000;

/**
 * The window the model in force was listed with, or cofold's own default.
 *
 * `modelReferenceOf` is the same reference `modelOf` resolves, so a model
 * chosen from the catalogue is sized by the row it was chosen from. A
 * caller-passed adapter names no endpoint to ask, and a model the list said
 * nothing about has no window to read, so both take the default.
 */
const windowOf = (
  options: CofoldOptions,
  values: Record<string, unknown>,
  harness: HarnessConfig,
  held: Held | undefined,
): number => {
  if (options.adapter !== undefined) return DEFAULT_CONTEXT_TOKENS;
  const listed = held?.infoOf(modelReferenceOf(options, values, harness))?.contextTokens;
  return typeof listed === 'number' && listed > 0 ? listed : DEFAULT_CONTEXT_TOKENS;
};

/** The mode a session's settings name, or this backend's own default when they name none. */
const modeOf = (values: Record<string, unknown>): PermissionMode => {
  const named = values.permissionMode;
  return typeof named === 'string' && (PERMISSION_MODES as readonly string[]).includes(named)
    ? named as PermissionMode
    : 'auto';
};

/**
 * The cofold agent id.
 *
 * A constant rather than the AHP provider: cofold requires an id matching its
 * own pattern, and the provider is a registration name a host is free to
 * spell with characters cofold would refuse. One backend serves one store, so
 * two sessions of it are two conversations rather than two agents.
 */
export const AGENT_ID = 'cofold';

/** What the model is told when neither the package nor the session named a prompt. */
const DEFAULT_INSTRUCTIONS = 'You are a helpful assistant.';

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

/** The tool's own name, off the `<clientId>__<name>` the model was offered. */
const bareName = (name: string, owner: string): string =>
  (name.startsWith(`${owner}__`) ? name.slice(owner.length + 2) : name);

/**
 * What the model reads of a client's answer.
 *
 * A cofold tool answers text - its `ToolOutput` is a string - so everything
 * the client sent has to travel as text: its own words, then a line for each
 * block that is not text, naming what it is and how big it is. A block dropped
 * silently would be an answer that lied about what the client sent.
 */
const readOf = (answer: ClientCallAnswer): string => {
  const lines = answer.content
    .filter((block) => block.type !== 'text')
    .map((block) => (block.type === 'embeddedResource'
      ? `[${block.contentType}, ${Buffer.byteLength(block.data, 'base64')} bytes]`
      : JSON.stringify(block)));
  return [answer.text, ...lines].filter((one) => one !== '').join('\n');
};

/** What the agent a turn runs on offers the other areas. */
export interface TurnAgent {
  agentOf: (values: Record<string, unknown>) => CofoldAgent;
  settleEdit: (callId: string) => void;
  releaseCalls: (why: string) => void;
  /** The requests a client can still answer: the person's, and the clients'. */
  needed: () => Bag[];
}

export const createTurnAgent = (
  ctx: SessionContext,
): TurnAgent & { methods: Pick<Session, 'toolCallOwner' | 'completeToolCall' | 'clientGone'> } => {
  const { options, start, harness, where, store } = ctx;

  /** A writing call is about to run: report the file as it is now. */
  const announceEdit = (callId: string, path: string): void => {
    ctx.editing.set(callId, path);
    start.onFileEdit?.(String(ctx.active?.id ?? ''), path, 'before');
  };

  /**
   * The `after` a call owes, once.
   *
   * Sent from the tool's own result and, for a call that will never have one,
   * from the refusal or the end of the run - so a client never holds a file as
   * changing for a turn that is over.
   */
  const settleEdit = (callId: string): void => {
    const path = ctx.editing.get(callId);
    if (path === undefined) return;
    ctx.editing.delete(callId);
    start.onFileEdit?.(String(ctx.active?.id ?? ''), path, 'after');
  };

  /**
   * The calls a connected client is running, held in one place.
   *
   * Nothing on this host executes an owner-bound tool, so this is the whole of
   * its execution: a call is held here from the moment cofold reports it
   * running until the owning client settles it through `completeToolCall`, or
   * goes away and `clientGone` fails it. Every path that ends a call settles
   * its promise, because a run waiting on one nothing can settle is a turn
   * that hangs for ever. It also raises the session entry a client reads and
   * times a call out, which is what the map this replaces did neither of - see
   * `packages/sdk/src/tools/clientcalls.ts`.
   */
  const calls = createClientCalls({
    chat: start.chatUri,
    emit: start.emit,
    ...(start.clientToolTimeoutMs === undefined ? {} : { timeoutMs: start.clientToolTimeoutMs }),
    providers: (name) => ctx.offered
      .filter((one) => one.owner !== undefined && one.definition.name.endsWith(`__${name}`))
      .map((one) => String(one.owner)),
  });

  /** Fail every held call, and forget each one's promise. */
  const releaseCalls = (why: string): void => { calls.release(why); };

  /** The requests a client can still answer: the person's, and the clients'. */
  const needed = (): Bag[] => [...ctx.pending.values()].map((one) => one.entry).concat(calls.entries());

  /**
   * Ask the client that provides a tool to run a call.
   *
   * The tool is named as the client announced it - `openFile`, not the
   * `probe__openFile` the model was offered - because that is the name its
   * failure is reported under. Its row is titled by that name: a subject is
   * the run's own tool declaring what it acts on, and a client's tool is
   * announced to this host without one.
   */
  const openedCall = (call: ClientToolCall): void => {
    calls.open({
      turnId: String(ctx.active?.id ?? ''),
      owner: call.owner,
      toolCall: {
        toolCallId: call.callId,
        toolName: bareName(call.name, call.owner),
        displayName: call.name,
        invocationMessage: describe(call.name),
        confirmed: 'not-needed',
        toolInput: JSON.stringify(call.input),
      },
    });
  };

  /**
   * The session side of a client-run call, used by `cofoldTool`.
   *
   * The ask and the wait are one step, and they have to be: cofold emits
   * `tool.started` and runs the tool without waiting for this host to have read
   * that event, so a call opened from the event that says it is running is
   * opened after the tool has already asked for it. Here the call is raised and
   * waited on in the same turn of the loop, which is the only order in which
   * the wait finds its call.
   */
  const relay: ClientToolRelay = {
    call: async (call) => {
      openedCall(call);
      const answer = await calls.wait(call.callId);
      // A failure is thrown rather than returned: that is what cofold records
      // as a failed `tool.completed` and what makes the model read the reason.
      if (!answer.ok) throw new Error(answer.text === '' ? 'The tool failed' : answer.text);
      return readOf(answer);
    },
  };

  /**
   * The system prompt for a turn.
   *
   * The session's own prompt, then what the host wants the model told beside
   * it: the instruction behind each host tool, which is what makes a tool
   * nothing asks for worth calling.
   */
  const instructionsOf = (values: Record<string, unknown>): string => {
    const own = str(values.instructions) ?? options.instructions ?? harness.instructions ?? DEFAULT_INSTRUCTIONS;
    const fromHost = (start.instructions ?? []).filter((one) => one.trim() !== '');
    return [own, ...fromHost].join('\n\n');
  };

  /**
   * The cofold agent a turn runs on, built fresh so the config in force is
   * the config that runs. `createAgent` is a value, not an actor, so building
   * it per turn costs nothing the store does not already hold.
   *
   * The policy is the mode's, unless the plugin configured one of its own: an
   * embedder's policy is the run-level authority, and the mode is not offered
   * as a control when it is there. What counts as an edit is a tool that says
   * it writes - this host's tools are the daemon's and a client's, so their
   * names are not a list this backend can keep.
   */
  const agentOf = (values: Record<string, unknown>): CofoldAgent => {
    /*
     * The names the host's own tools answer to.
     *
     * One name has to map to one tool, so this is what decides the two
     * collisions: a capability's tool of a taken name is dropped, and so is
     * cofold's ask tool when a host or client tool is already called
     * `ask_user`. A host tool is the more specific contribution - it was named
     * for this deployment - so it wins the name.
     */
    const taken = new Set(ctx.offered.map((one) => one.definition.name));
    /*
     * cofold's own question primitive, which every session offers the model.
     *
     * It is what a model reaches for when it needs a person rather than a
     * file: the run pauses, `mapping.ts` turns the pause into the same
     * `chatInput` entry a host tool's pause becomes, and the answer goes back
     * into the run the same way. The name is read off the tool rather than
     * repeated, because that is the name the collision above is about.
     */
    const ask = createAskUserTool();
    /*
     * How much a step may carry, and when cofold folds the history instead.
     *
     * The window is what the endpoint published for the model in force. The
     * point is the configured one, never above `AUTO_COMPACT_AT` of that
     * window: a session that folded at the window itself would write a summary
     * whose own step no longer fits. Unset, the point is that share, so a
     * session nobody configured still folds its history rather than running
     * into the model's ceiling part-way through a turn.
     */
    const maxTokens = windowOf(options, values, harness, ctx.held);
    const cap = Math.floor(maxTokens * AUTO_COMPACT_AT);
    const autoCompactTokens = options.autoCompactTokens === undefined
      ? cap
      : Math.min(options.autoCompactTokens, cap);
    const memoryDir = memoryDirOf(options, where);
    return createAgent({
      id: AGENT_ID,
      instructions: instructionsOf(values),
      model: modelOf(options, values, start.credentials ?? {}, harness, ctx.held),
      context: { maxTokens, autoCompactTokens },
      tools: [
        ...(taken.has(ask.name) ? [] : [ask]),
        ...cofoldTools(ctx.offered, relay),
      ],
      /*
       * The four capabilities cofold runs itself, in cofold's own process.
       *
       * The `tools` section is cofold's shape, built by cofold's
       * `standardCapabilities`; what this host adds is where the run is.
       * Memory goes under the store root, beside the sessions; a session whose
       * store is deliberately in memory has no directory to keep memory files
       * in, so it gets the other three rather than files under somebody's home.
       * A tool the host already offers keeps its name, because cofold refuses a
       * run two contributors give one name to.
       */
      capabilities: capabilitiesOf(options.tools ?? DEFAULT_TOOLS, {
        workspace: where,
        ...(memoryDir === undefined ? {} : { memoryDir }),
      }, taken),
      /*
       * The edits a cofold tool makes, on their way to the changeset.
       *
       * The hooks are where a call is known before and after it runs, which is
       * what the `before`/`after` pair needs: the tool names the file it writes
       * and the call carries the input, so the two halves name one file even
       * when the model wrote a relative path. The pair also lands in the right
       * order, because cofold runs this hook before it announces the call.
       */
      hooks: {
        beforeTool: ({ call, tool }) => {
          const path = editPathOf(where, tool, call.input);
          if (path !== undefined) announceEdit(call.callId, path);
          return { decision: 'allow' };
        },
        afterTool: ({ call, output }) => {
          settleEdit(call.callId);
          return { output };
        },
      },
      store,
      policy: options.policy ?? {
        decide: policyOf(modeOf(values), {
          inside: (path) => insideDirectory(where, path),
          isEdit: (tool) => tool.effects.writes === true,
        }),
      },
    });
  };

  return {
    agentOf,
    settleEdit,
    releaseCalls,
    needed,
    methods: {
      /**
       * The client running a tool call, for a call that is one client's to run.
       *
       * Nothing for a call this host is running itself, which is what the host
       * checks before letting a client stream into one.
       */
      toolCallOwner: (toolCallId) => calls.owner(toolCallId),

      /**
       * What a client says one of its own tool calls did.
       *
       * Only the client the call was reported against may settle it: the
       * protocol makes that one responsible for the call, and a result from
       * anybody else is a client answering for work it did not do. False either
       * way - for a call nobody is waiting on and for a client that does not
       * own it - because both are a client out of step and the host says which.
       *
       * Nothing is emitted here. The result goes back into cofold, which writes
       * the tool result, and the run's own `tool.completed` reports the
       * completion to every client from that - the same path every other tool
       * call takes. A completion emitted here as well would be the same row
       * finished twice.
       */
      completeToolCall: (toolCallId, clientId, result) => calls.complete(toolCallId, clientId, result),

      /**
       * A client that was running tool calls here has gone.
       *
       * Its outstanding calls are failed rather than left open: the run is
       * awaiting a promise that nothing can settle any more, and a turn that
       * hangs for ever is worse than a tool that says the client went. The
       * message is the tool result the model reads, which is why it names the
       * tool as well as the client.
       */
      clientGone: (clientId) => { calls.gone(clientId); },
    },
  };
};
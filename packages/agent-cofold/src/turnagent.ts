import { resolve } from 'node:path';
import { createAgent, policyOf } from '@cofold/agents';
import type { Agent as CofoldAgent, PermissionMode, Tool } from '@cofold/agents';
import { resolveWithin } from '@cofold/tools';
import type { Bag, Session } from '@ahpd/sdk';
import { DEFAULT_TOOLS, capabilitiesOf } from './capabilities.js';
import { PERMISSION_MODES, defaultStoreRoot, modelOf } from './agent.js';
import { cofoldTools } from './tools.js';
import type { ClientToolRelay } from './tools.js';
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
 * The tools whose calls change a file, by the names `@cofold/tools` gives them.
 *
 * The two file-writing tools of the files capability. Nothing else reports an
 * edit: a shell writes without naming a file and a memory file lives outside
 * the workspace, so a changeset is only told about the files it can read.
 */
const EDITS = new Set(['write_file', 'edit_file']);

/**
 * The file a call is about to change, resolved the way the files capability
 * resolves it, or nothing for a tool that does not write a named file.
 */
const editPathOf = (workspace: string, tool: Tool<any, any>, input: unknown): string | undefined => {
  if (tool.effects.writes !== true || !EDITS.has(tool.name)) return undefined;
  const path = (input as { path?: unknown } | undefined)?.path;
  return typeof path === 'string' && path !== '' ? resolve(workspace, path) : undefined;
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

/**
 * A tool call a connected client is running, as the session holds it.
 *
 * The owner is what `completeToolCall` checks a result against and what
 * `clientGone` matches on; the name is what a call failed by a lost client
 * says it was. `resolve` and `reject` are the two halves of the promise the
 * owner-bound tool's `execute` awaits, and exactly one of them must run for
 * every entry, or the turn waits on a promise nothing can settle.
 */
interface WaitingCall {
  owner: string;
  name: string;
  input: unknown;
  resolve(text: string): void;
  reject(reason: Error): void;
}

/** What the agent a turn runs on offers the other areas. */
export interface TurnAgent {
  agentOf: (values: Record<string, unknown>) => CofoldAgent;
  settleEdit: (callId: string) => void;
  releaseCalls: (why: string, whose?: string) => void;
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
   * The calls a connected client is running, by the id of the model's call.
   *
   * Nothing on this host executes an owner-bound tool, so this map is the
   * whole of its execution: a call is held here from the moment cofold tries
   * to run the tool until the owning client settles it through
   * `completeToolCall`, or goes away and `clientGone` fails it. Every path
   * that takes an entry out also settles its promise, because a run waiting
   * on one nothing can settle is a turn that hangs for ever.
   */
  const waiting = new Map<string, WaitingCall>();

  /** Fail every held call, or one client's, and forget each one's promise. */
  const releaseCalls = (why: string, whose?: string): void => {
    for (const [callId, held] of [...waiting.entries()]) {
      if (whose !== undefined && held.owner !== whose) continue;
      waiting.delete(callId);
      held.reject(new Error(why));
    }
  };

  /**
   * The session side of a client-run call, used by `cofoldTool`.
   *
   * The entry is registered synchronously, in the promise executor, so a
   * client's answer that arrives on a later turn of the loop always finds
   * something to settle even though the model's step was only opened a
   * moment before.
   */
  const relay: ClientToolRelay = {
    call: (call) => new Promise<string>((resolve, reject) => {
      waiting.set(call.callId, { owner: call.owner, name: call.name, input: call.input, resolve, reject });
    }),
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
  const agentOf = (values: Record<string, unknown>): CofoldAgent => createAgent({
    id: AGENT_ID,
    instructions: instructionsOf(values),
    model: modelOf(options, values, start.credentials ?? {}, harness),
    tools: cofoldTools(ctx.offered, relay),
    /*
     * The four capabilities cofold runs itself, in cofold's own process.
     *
     * Memory goes under the store root, beside the sessions; a session whose
     * store is deliberately in memory has no directory to keep memory files
     * in, so it gets the other three rather than files under somebody's home.
     * A tool the host already offers keeps its name, because cofold refuses a
     * run two contributors give one name to.
     */
    capabilities: capabilitiesOf(options.tools ?? DEFAULT_TOOLS, {
      storeRoot: options.memory === true ? undefined : options.store ?? defaultStoreRoot(),
      workspace: where,
    }, ctx.offered.map((one) => one.definition.name)),
    /*
     * The edits a cofold tool makes, on their way to the changeset.
     *
     * The hooks are where a call is known before and after it runs, which is
     * what the `before`/`after` pair needs: the path is resolved against the
     * run's workspace the way the files capability resolves it, so the two
     * halves name one file even when the model wrote a relative path.
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

  return {
    agentOf,
    settleEdit,
    releaseCalls,
    methods: {
      /**
       * The client running a tool call, for a call that is one client's to run.
       *
       * Nothing for a call this host is running itself, which is what the host
       * checks before letting a client stream into one.
       */
      toolCallOwner: (toolCallId) => waiting.get(toolCallId)?.owner,

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
      completeToolCall: (toolCallId, clientId, result) => {
        const held = waiting.get(toolCallId);
        if (held === undefined || held.owner !== clientId) return false;
        waiting.delete(toolCallId);
        /*
         * The client's word is the tool's result: its text when it worked and
         * its message when it did not. A failure is thrown rather than
         * returned, which is what cofold records as a failed `tool.completed`
         * and what makes the model read the message as the reason.
         */
        if (result.ok) held.resolve(result.text);
        else held.reject(new Error(result.text === '' ? 'The tool failed' : result.text));
        return true;
      },

      /**
       * A client that was running tool calls here has gone.
       *
       * Its outstanding calls are failed rather than left open: the run is
       * awaiting a promise that nothing can settle any more, and a turn that
       * hangs for ever is worse than a tool that says the client went. The
       * message is the tool result the model reads, which is why it names the
       * tool as well as the client.
       */
      clientGone: (clientId) => {
        for (const [callId, held] of [...waiting.entries()]) {
          if (held.owner !== clientId) continue;
          waiting.delete(callId);
          held.reject(new Error(`The client ${clientId} that was running ${held.name} is no longer here`));
        }
      },
    },
  };
};
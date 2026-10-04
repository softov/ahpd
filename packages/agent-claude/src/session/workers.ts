import type { Bag, SubagentChat } from '@ahpd/sdk';
import type { ClaudeSessionOptions, Scope, SessionContext } from './context.js';
import { bag, list, str } from './common.js';
import { titleOf } from '../input.js';

export type { Scope } from './context.js';

/**
 * What each spawning call said, by its own id.
 *
 * `Task` and `Agent` both spawn, and the call's input is the only place the
 * harness says what the worker is for: its kind, its one-line description
 * and the prompt it is run with. `parent` is the scope the call is in, which
 * is how a worker spawned from inside another worker's chat is linked from
 * that chat rather than from the session's. A record lives until the worker
 * has ended and the call's own result has been emitted, whichever is later.
 */
export interface Spawning {
  subagentType?: string;
  description?: string;
  prompt?: string;
  parent: string;
  /**
   * The lead turn the call was made in, which is the turn whose cancel ends
   * the worker. For a nested call, the turn its spawning worker was made in.
   */
  turn?: string;
  /** The worker chat's URI, once the host has opened it. */
  chat?: string;
  /** Whether the call's own result has been emitted. */
  completed?: boolean;
  /**
   * Whether the call did not ask for the background: its input said
   * `run_in_background: false` or said nothing. Its result ends the worker.
   */
  foreground: boolean;
}

/** What this area offers the rest of the session, and its `Session` methods. */
export interface Workers {
  /** Open parts, keyed by message and index; tool calls by their own id. */
  parts: Map<string, Bag>;
  /** Which tool call a streaming content block belongs to, by content block index. */
  calling: Map<string, string>;
  /** The session's own agent, which is the scope a frame without a parent is in. */
  mainScope: Scope;
  /** Every conversation in the stream, by the call that spawned it. */
  scopes: Map<string, Scope>;
  /** What each spawning call said, by its own id. */
  spawning: Map<string, Spawning>;
  /** The calls `task_started` named, whose terminal `task_notification` ends them. */
  background: Set<string>;
  /** The task id `task_started` named for each call, which is what `stopTask` stops. */
  tasks: Map<string, string>;
  /** The agent ids a permission ask was seen with, so the next one lands in the same chat. */
  byAgent: Map<string, Scope>;
  /** The spawning calls whose worker has ended, one id each. */
  ended: Set<string>;
  /**
   * The scope for a `parent_tool_use_id`, opening a worker's chat on first sight.
   */
  scopeFor: (parent: string) => Scope;
  /**
   * Open a held worker chat and deliver what it was holding.
   */
  releaseHeld: (parent: string, info?: Spawning) => void;
  /** Record what a spawning call said, and open its worker's chat if one waits. */
  recordSpawn: (id: string, given: Bag, scope: Scope, turnId?: string) => void;
  /** The scope a tool call was opened in, whichever conversation that is. */
  scopeOfCall: (toolCallId: string) => Scope | undefined;
  /** One action on the chat a scope writes to. */
  emitOn: (scope: Scope, action: Bag) => void;
  /**
   * A turn's tool calls that never reached an end, ended the way the protocol's
   * reducer ends them when the turn ends.
   */
  settleOpen: (turn: Bag | undefined) => void;
  /**
   * End a worker's turn, once, whichever signal got here first.
   */
  endWorker: (callId: string, state: 'complete' | 'error' | 'cancelled', why?: string) => void;
  /**
   * The `subagent` content for a worker, as the spawning call's result shows it.
   */
  workerBlock: (callId: string) => Bag | undefined;
  methods: {
    stopWorker: (toolCallId: string) => void;
  };
}

export function createWorkers(ctx: SessionContext): Workers {
  /** Open parts, keyed by message and index; tool calls by their own id. */
  const parts = new Map<string, Bag>();
  /**
   * Which tool call a streaming content block belongs to.
   *
   * A `content_block_delta` names the block by its index and nothing else, so
   * the id the block opened with has to be kept beside it. Tool calls only:
   * prose parts are already keyed by the same index.
   */
  const calling = new Map<string, string>();

  /** The session's own agent, which is the scope a frame without a parent is in. */
  const mainScope: Scope = {
    parent: '',
    chat: undefined,
    get turn() { return ctx.active; },
    set turn(next) { ctx.active = next; },
    parts,
    calling,
    get streaming() { return ctx.streaming; },
    set streaming(next) { ctx.streaming = next; },
  };
  const scopes = new Map<string, Scope>([['', mainScope]]);

  const spawning = new Map<string, Spawning>();
  const background = new Set<string>();
  const tasks = new Map<string, string>();
  const byAgent = new Map<string, Scope>();
  /**
   * The spawning calls whose worker has ended, one id each.
   *
   * Kept for the life of the session: a frame the harness sends for a worker
   * after it ended is dropped by this, and without it that frame would open
   * the worker a second time.
   */
  const ended = new Set<string>();

  /** The chat a frame for an ended worker is written to, which is nowhere. */
  const dropped: SubagentChat = { uri: '', turnId: '', emit: () => {}, end: () => {} };

  /**
   * How long a worker whose spawn has not been recorded keeps its frames before
   * they are let through anyway.
   *
   * A live capture puts the spawning call's `tool_use` 8-18 ms before its
   * worker's first frame, so this bounds a gap that is normally nothing at all.
   * It is here so a worker the harness never says anything more about still has
   * a chat to read, not because a well-behaved run waits for it.
   */
  const SPAWN_GRACE = 5000;

  /**
   * The scope for a `parent_tool_use_id`, opening a worker's chat on first sight.
   *
   * The host mints the chat, announces it, opens its turn with the prompt and
   * links the call to it; what is left here is the scope the frames land in.
   * Without the host's seam there is nowhere to put a worker, so its frames
   * stay in the turn that spawned them. A worker that has ended gets a scope
   * whose chat writes nowhere, so a late frame is dropped and never opens it
   * again.
   */
  const scopeFor = (parent: string): Scope => {
    if (parent === '') return mainScope;
    const known = scopes.get(parent);
    if (known !== undefined) return known;
    if (ctx.options.subagent === undefined) return mainScope;
    if (ended.has(parent)) {
      return {
        parent, chat: dropped, turn: { id: '', responseParts: [] }, parts: new Map(), calling: new Map(), streaming: undefined,
      };
    }
    const info = spawning.get(parent);
    /*
     * Nothing has said what this worker is for.
     *
     * Its title and the prompt its chat opens with are both in the spawning
     * call's input, and a worker can speak before that call arrives - which is
     * what it does, every time, a few milliseconds ahead. So the scope holds
     * rather than opens, and `recordSpawn` opens it from the record when that
     * lands. Until then every frame is held whole rather than applied here: a
     * turn built before the host minted the chat is the wrong turn, with the
     * wrong id and no prompt in it.
     */
    if (info === undefined) {
      const held: Scope = {
        parent,
        chat: undefined,
        turn: undefined,
        parts: new Map(),
        calling: new Map(),
        streaming: undefined,
        waiting: [],
      };
      scopes.set(parent, held);
      held.release = setTimeout(() => { releaseHeld(parent); }, SPAWN_GRACE);
      held.release.unref?.();
      return held;
    }
    const scope = openWorker(parent, info, ctx.options.subagent);
    scopes.set(parent, scope);
    return scope;
  };

  /**
   * A worker's chat, opened from the record of the call that spawned it.
   *
   * Named by the call's task and opened on its prompt, which is the worker's
   * own first message - what VS Code's `taskDescription` and `taskPrompt` are
   * for. The seam is passed in because `scopeFor` has already refused a session
   * that has none.
   */
  const openWorker = (parent: string, info: Spawning | undefined, open: NonNullable<ClaudeSessionOptions['subagent']>): Scope => {
    const subagentType = info?.subagentType;
    const chat = open(parent, {
      title: titleOf(info?.description, subagentType),
      ...(subagentType !== undefined ? { agentName: subagentType } : {}),
      ...(info?.description !== undefined ? { description: info.description } : {}),
      ...(info?.prompt !== undefined ? { prompt: info.prompt } : {}),
      ...(info?.parent !== undefined && info.parent !== '' ? { parentToolCallId: info.parent } : {}),
    });
    if (info !== undefined) info.chat = chat.uri;
    return {
      parent,
      chat,
      turn: {
        id: chat.turnId,
        startedAt: new Date().toISOString(),
        message: { text: info?.prompt ?? '', origin: { kind: 'tool' } },
        responseParts: [],
        usage: undefined,
      },
      parts: new Map(),
      calling: new Map(),
      streaming: undefined,
    };
  };

  /**
   * Open a held worker chat and deliver what it was holding.
   *
   * With the record, when there is one: named by the task, opened on the
   * prompt. Without one, from the call's own result or after `SPAWN_GRACE`,
   * which is the last thing there is to wait for - a worker whose call has
   * ended has a chat whether the harness said what it was for or not, and a
   * worker the harness is simply slow about gets one five seconds from now.
   */
  const releaseHeld = (parent: string, info?: Spawning): void => {
    const open = ctx.options.subagent;
    const held = scopes.get(parent);
    if (open === undefined || held?.waiting === undefined) return;
    const frames = held.waiting;
    held.waiting = undefined;
    if (held.release !== undefined) {
      clearTimeout(held.release);
      held.release = undefined;
    }
    const opened = openWorker(parent, info ?? spawning.get(parent), open);
    /*
     * The scope keeps its own identity - `byAgent` holds scopes by reference,
     * and a frame that arrives during the replay below has to find this one -
     * and takes the chat and the turn the worker really has, neither of which
     * has been said to anybody yet.
     */
    held.chat = opened.chat;
    held.turn = opened.turn;
    for (const frame of frames) frame();
  };

  /**
   * Record what a spawning call said, and open its worker's chat if one waits.
   *
   * The call's input is the only place the harness says what a worker is for:
   * its kind, its one-line task and the prompt it runs on. It is handed over
   * twice - in the canonical assistant message, and in whole through the
   * permission callback, which the SDK runs as soon as that input is complete -
   * and the callback can be first, for a call approved while it was still
   * streaming, which is the case where the canonical message then skips the
   * call altogether. A record that already names a chat is kept: that chat was
   * opened from it, and a second record is the same information said twice.
   */
  const recordSpawn = (id: string, given: Bag, scope: Scope, turnId?: string): void => {
    if (spawning.get(id)?.chat !== undefined) return;
    const kind = str(given.subagent_type);
    const about = str(given.description);
    const prompt = str(given.prompt);
    const made = scope === mainScope ? turnId : spawning.get(scope.parent)?.turn;
    spawning.set(id, {
      ...(kind !== undefined ? { subagentType: kind } : {}),
      ...(about !== undefined ? { description: about } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      parent: scope.parent,
      foreground: given.run_in_background !== true,
      ...(made !== undefined ? { turn: made } : {}),
    });
    releaseHeld(id, spawning.get(id));
  };

  /** The scope a tool call was opened in, whichever conversation that is. */
  const scopeOfCall = (toolCallId: string): Scope | undefined => {
    for (const scope of scopes.values()) {
      if (scope.parts.has(toolCallId)) return scope;
    }
    return undefined;
  };

  /** One action on the chat a scope writes to. */
  const emitOn = (scope: Scope, action: Bag): void => {
    if (scope.chat !== undefined) scope.chat.emit(action);
    /*
     * A worker whose chat is not open yet says nothing, because the only chat
     * there is to say it on is the lead's - and a worker's words drawn as the
     * parent's are worse than a worker's words a few milliseconds late.
     */
    else if (scope.waiting !== undefined) return;
    else ctx.emit('chat', action);
  };

  /**
   * A turn's tool calls that never reached an end, ended the way the
   * protocol's reducer ends them when the turn ends: `cancelled`, with reason
   * `skipped`, and only the fields a cancelled call keeps.
   *
   * No action is sent for them, because a client watching already applied
   * that on the turn's own ending; this is the record a client that
   * subscribes afterwards reads. An ask still waiting on one of them is
   * declined, since nothing will run the call it is about.
   */
  const settleOpen = (turn: Bag | undefined): void => {
    for (const part of list(turn?.responseParts) as Bag[]) {
      if (part.kind !== 'toolCall') continue;
      const call = bag(part.toolCall);
      const was = str(call.status);
      if (was === 'completed' || was === 'cancelled') continue;
      const id = str(call.toolCallId);
      for (const one of [...ctx.pending.values()]) {
        if (one.entry.kind !== 'toolConfirmation' || str(bag(one.entry.toolCall).toolCallId) !== id) continue;
        ctx.pending.delete(one.id);
        one.settle({ behavior: 'deny', message: 'The turn ended before this ran' });
        ctx.inputNeededRemoved(one.id);
      }
      if (id !== undefined) ctx.pastLines.delete(id);
      const streamingCall = was === 'streaming';
      part.toolCall = {
        status: 'cancelled',
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        displayName: call.displayName,
        ...(call.intention !== undefined ? { intention: call.intention } : {}),
        ...(call.contributor !== undefined ? { contributor: call.contributor } : {}),
        ...(call._meta !== undefined ? { _meta: call._meta } : {}),
        invocationMessage: streamingCall ? (call.invocationMessage ?? '') : call.invocationMessage,
        ...(!streamingCall && call.toolInput !== undefined ? { toolInput: call.toolInput } : {}),
        reason: 'skipped',
      };
    }
  };

  /**
   * End a worker's turn, once, whichever signal got here first.
   *
   * A foreground worker ends on the `tool_result` of the call that spawned it
   * and a background one on its terminal `task_notification`; both can also
   * arrive - the harness sends a notification for a foreground worker too -
   * and a second ending would be a second turn on a chat that has none open.
   * Anything the worker was still asking is declined rather than left on a
   * promise nothing will settle.
   */
  const endWorker = (callId: string, state: 'complete' | 'error' | 'cancelled', why?: string): void => {
    if (ended.has(callId)) return;
    const scope = scopes.get(callId);
    if (scope?.chat === undefined) return;
    ended.add(callId);
    for (const one of [...ctx.pending.values()]) {
      if (one.entry.chat !== scope.chat.uri) continue;
      ctx.pending.delete(one.id);
      one.settle({ behavior: 'deny', message: 'The subagent finished' });
      ctx.inputNeededRemoved(one.id);
    }
    settleOpen(scope.turn);
    scope.chat.end(state, why);
    scopes.delete(callId);
    ctx.rounds.delete(callId);
    background.delete(callId);
    tasks.delete(callId);
    if (spawning.get(callId)?.completed === true) spawning.delete(callId);
    byAgent.forEach((held, key) => { if (held === scope) byAgent.delete(key); });
  };

  /**
   * The `subagent` content for a worker, as the spawning call's result shows it.
   *
   * Read off the call's record, which keeps the worker chat's URI after the
   * worker has ended. A call whose worker was never opened carries nothing -
   * the chat does not exist and a link to it would be a link to nowhere.
   */
  const workerBlock = (callId: string): Bag | undefined => {
    const info = spawning.get(callId);
    if (info?.chat === undefined) return undefined;
    const title = titleOf(info.description, info.subagentType);
    return {
      type: 'subagent',
      resource: info.chat,
      title,
      ...(info?.subagentType !== undefined ? { agentName: info.subagentType } : {}),
      ...(info?.description !== undefined ? { description: info.description } : {}),
    };
  };

  /**
   * Stop one worker, and leave the turn that runs it going.
   *
   * By the task id its `task_started` named, through the SDK's own
   * per-task stop, which answers with a `stopped` notification that ends
   * the worker's chat. Configured with `workerStop: 'session'`, or for a
   * worker the harness has not named a task for yet, it stops the lead
   * turn instead, which is the only stop there is then.
   */
  const stopWorker = (toolCallId: string): void => {
    const task = tasks.get(toolCallId);
    if (ctx.options.workerStop === 'session' || task === undefined) {
      ctx.self.cancel('');
      return;
    }
    void ctx.handle.stopTask(task).catch(() => {});
  };

  return {
    parts, calling, mainScope, scopes, spawning, background, tasks, byAgent, ended,
    scopeFor, releaseHeld, recordSpawn, scopeOfCall, emitOn, settleOpen, endWorker,
    workerBlock,
    methods: { stopWorker },
  };
}
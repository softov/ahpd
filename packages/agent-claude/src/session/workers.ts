import { subagentChatUri } from '@ahpd/sdk';
import type { BackgroundTask, Bag, OutputTerminal, SubagentChat } from '@ahpd/sdk';
import type { ClaudeSessionOptions, Scope, SessionContext } from './context.js';
import { bag, list, str } from './common.js';
import { pollTaskOutput } from './taskoutput.js';
import type { TaskOutputPoll, TaskOutputReader } from './taskoutput.js';
import { titleOf } from '../input.js';

/**
 * How long a worker's frames are held for its spawn, VS Code's host's
 * `SUBAGENT_START_TIMEOUT`, unless the record's `subagentStartTimeoutMs` says
 * otherwise.
 */
const SUBAGENT_START_TIMEOUT_MS = 30_000;

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
   * The lead turn the call was made in, which is the turn whose stop ends the
   * worker. For a nested call, the turn its spawning worker was made in.
   */
  turn?: string;
  /** The worker chat's URI, once the host has opened it. */
  chat?: string;
  /** Whether the call's own result has been emitted. */
  completed?: boolean;
  /**
   * Whether the worker runs in the foreground, the spawning call blocking on
   * it: the SDK's own report of its task, `task_started`'s `is_backgrounded`
   * and `task_updated`'s patch, until which it is. Its result ends the worker.
   */
  foreground: boolean;
}

/**
 * What one `task_started` said about a task, by the task id.
 *
 * The harness's `background_tasks_changed` names a task by id alone, so the
 * kind, the call that runs it and the sentence describing it are only ever here. `startedAt` is
 * when this frame was read, because nothing else in the stream dates a task.
 */
export interface TaskInfo {
  type?: string;
  toolUseId?: string;
  description?: string;
  startedAt: string;
}

/** What this area offers the rest of the session, and its `Session` methods. */
export interface Workers {
  /** Open parts, keyed by message and index; tool calls by their own id. */
  parts: Map<string, Bag>;
  /** Which tool call a streaming content block belongs to, by content block index: VS Code's mapper's active tool blocks. */
  activeToolBlocks: Map<string, string>;
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
  /** The spawning calls whose worker has completed, one id each, as VS Code's registry marks a spawn completed. */
  completed: Set<string>;
  /** What each `task_started` said about a task, by the task id. */
  taskInfo: Map<string, TaskInfo>;
  /** The tasks the SDK's last `background_tasks_changed` named, which is every task running now. */
  backgroundTasks: Set<string>;
  /** What each chat has been told it is running, by chat URI. */
  told: Map<string, BackgroundTask[]>;
  /** Record what one `task_started` said, and publish whatever that changes. */
  noteTask: (message: Bag) => void;
  /** Take one `background_tasks_changed` as the whole set of tasks running now. */
  noteBackgroundTasks: (message: Bag) => void;
  /** Whether a background task is running now: VS Code's active work. */
  hasActiveWork: () => boolean;
  /** Forget one task the harness said has ended. */
  dropTask: (taskId: string) => void;
  /**
   * End every output terminal this session made, and the polls behind them.
   *
   * A session closing is not a task ending: there is no last read and no
   * finalize, because the channels go with the session.
   */
  closeOutputs: () => void;
  /**
   * The scope for a `parent_tool_use_id`, opening a worker's chat on first sight.
   */
  scopeFor: (parent: string) => Scope;
  /** Record what a spawning call said, and open its worker's chat if one waits. */
  recordSpawn: (id: string, given: Bag, scope: Scope) => void;
  /** The scope a tool call was opened in, whichever conversation that is. */
  scopeOfCall: (toolCallId: string) => Scope | undefined;
  /** One action on the chat a scope writes to. */
  emitOn: (scope: Scope, action: Bag) => void;
  /**
   * A turn's tool calls that never reached an end, ended the way the protocol's
   * reducer ends them when the turn ends: VS Code's mapper's
   * `clearPendingToolCalls`.
   */
  clearPendingToolCalls: (turn: Bag | undefined) => void;
  /**
   * End a subagent's turn, once, whichever signal got here first.
   */
  endSubagent: (callId: string, state: 'complete' | 'cancelled') => void;
  /**
   * The `subagent` content for a subagent, as the spawning call's result shows it.
   */
  subagentBlock: (callId: string) => Bag | undefined;
  methods: {
    stopWorker: (toolCallId: string) => void;
  };
}

export function createWorkers(ctx: SessionContext): Workers {
  /** Open parts, keyed by message and index; tool calls by their own id. */
  const parts = new Map<string, Bag>();
  /**
   * Which tool call a streaming content block belongs to: VS Code's mapper's
   * active tool blocks.
   *
   * A `content_block_delta` names the block by its index and nothing else, so
   * the id the block opened with is kept beside it. Tool calls only: prose
   * parts are keyed by the same index.
   */
  const activeToolBlocks = new Map<string, string>();

  /** The session's own agent, which is the scope a frame without a parent is in. */
  const mainScope: Scope = {
    parent: '',
    chat: undefined,
    get turn() { return ctx.active; },
    set turn(next) { ctx.active = next; },
    parts,
    activeToolBlocks,
    get streaming() { return ctx.streaming; },
    set streaming(next) { ctx.streaming = next; },
  };
  const scopes = new Map<string, Scope>([['', mainScope]]);

  const spawning = new Map<string, Spawning>();
  const background = new Set<string>();
  const tasks = new Map<string, string>();
  const byAgent = new Map<string, Scope>();
  /**
   * The spawning calls whose worker has completed, one id each, as VS Code's
   * subagent registry marks a spawn completed.
   *
   * Kept for the life of the session: a frame the harness sends for a worker
   * after it completed is dropped by this, so the worker opens once.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSubagentRegistry.ts#L91
   */
  const completed = new Set<string>();

  /** What each `task_started` said about a task, by the task id. */
  const taskInfo = new Map<string, TaskInfo>();

  /**
   * The tasks the SDK's last `background_tasks_changed` named, one id each.
   *
   * The harness sends the frame with the whole set of tasks running after a
   * change, so the set is replaced whole, and an id that leaves it has stopped
   * running.
   */
  const backgroundTasks = new Set<string>();

  /**
   * What each chat has been told it is running, by chat URI.
   *
   * Kept so that only a difference is reported: a `background_tasks_changed`
   * that changed nothing says nothing. A client that subscribes afterwards reads the same list
   * from the host's own records, so this is only what has already been said.
   */
  const told = new Map<string, BackgroundTask[]>();

  /**
   * The stop each shell task carries, by the harness's task id.
   *
   * Kept rather than made again on each listing: the host compares one report
   * to the last by value, so a new function every time would be a row said
   * again on every level that changed nothing.
   */
  const stops = new Map<string, () => Promise<boolean>>();

  /**
   * The output terminal each shell task has, by the row's own id.
   *
   * One per task, made when the task is first listed and ended when it stops
   * being live. Kept past the row itself: the terminal stays a channel a
   * transcript may point at until the session closes.
   */
  const outputs = new Map<string, { terminal: OutputTerminal; poll: TaskOutputPoll }>();

  /** The chat a frame for an ended worker is written to, which is nowhere. */
  const dropped: SubagentChat = { uri: '', turnId: '', emit: () => {}, end: () => {} };

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
    if (completed.has(parent)) {
      return {
        parent, chat: dropped, turn: { id: '', responseParts: [] }, parts: new Map(), activeToolBlocks: new Map(), streaming: undefined,
      };
    }
    const info = spawning.get(parent);
    /*
     * No spawn recorded for this worker yet.
     *
     * Its chat is announced with what the spawn holds once one is recorded,
     * and until then every frame is held whole rather than applied here, as
     * VS Code's host holds a subagent's signals for a chat not yet announced:
     * a turn built before the host minted the chat is the wrong turn, with the
     * wrong id. The hold is bounded as VS Code's host bounds it: a spawn that
     * has not come within 30 s fails the worker, its held frames dropped and
     * what it says after dropped too, so it is never announced.
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSubagentSignals.ts#L60-L66
     * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L144-L175
     */
    if (info === undefined) {
      const held: Scope = {
        parent,
        chat: undefined,
        turn: undefined,
        parts: new Map(),
        activeToolBlocks: new Map(),
        streaming: undefined,
        waiting: [],
      };
      setTimeout(() => {
        if (held.chat !== undefined || held.waiting === undefined) return;
        held.waiting.length = 0;
        held.failed = true;
      }, typeof ctx.values['subagentStartTimeoutMs'] === 'number' ? ctx.values['subagentStartTimeoutMs'] : SUBAGENT_START_TIMEOUT_MS).unref?.();
      scopes.set(parent, held);
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
      title: titleOf(info?.description, subagentType, ctx.values['subagentTitleMax']),
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
      activeToolBlocks: new Map(),
      streaming: undefined,
    };
  };

  /**
   * Record what a spawning call said, and open its worker's chat if one waits.
   *
   * The call's input is the only place the harness says what a worker is for:
   * its kind, its one-line task and the prompt it runs on. The spawn is
   * recorded at the call's block start, before its input exists, and the input
   * fills it in as it is handed over - in the canonical assistant message, and
   * in whole through the permission callback, which the SDK runs as soon as
   * that input is complete - each field taken the first time it is said, as
   * VS Code's registry records a spawn. A worker's chat is announced with what
   * the record holds when it opens.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSubagentRegistry.ts#L144-L160
   */
  const recordSpawn = (id: string, given: Bag, scope: Scope): void => {
    const was = spawning.get(id);
    const kind = was?.subagentType ?? str(given.subagent_type);
    const about = was?.description ?? str(given.description);
    const prompt = was?.prompt ?? str(given.prompt);
    const made = was?.turn ?? (scope === mainScope ? str(ctx.active?.id) : spawning.get(scope.parent)?.turn);
    spawning.set(id, {
      ...was,
      ...(kind !== undefined ? { subagentType: kind } : {}),
      ...(about !== undefined ? { description: about } : {}),
      ...(prompt !== undefined ? { prompt } : {}),
      parent: was?.parent ?? scope.parent,
      foreground: was?.foreground ?? true,
      ...(made !== undefined ? { turn: made } : {}),
    });
    // A worker that spoke before its spawn was recorded: its chat opens now,
    // and what it held is delivered to it.
    const open = ctx.options.subagent;
    const held = scopes.get(id);
    if (open === undefined || held?.waiting === undefined || held.failed === true) return;
    const frames = held.waiting;
    held.waiting = undefined;
    const opened = openWorker(id, spawning.get(id), open);
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
   * The chat one scope's background work is listed on, or nothing meanwhile.
   *
   * The session's own chat is named by the options, because a frame with no
   * parent is in the lead scope and `emitOn` writes it to the lead chat. A
   * worker's is its own chat, which does not exist yet while the scope holds.
   */
  const workChatOf = (scope: Scope): string | undefined => {
    if (scope === mainScope) return ctx.options.chatUri;
    const chat = scope.chat?.uri;
    return chat === undefined || chat === '' ? undefined : chat;
  };

  /**
   * The stop one shell task carries, which is the harness's own `stopTask`.
   *
   * The answer is whether there was live work to stop: a task the harness has
   * already ended is a button pressed a moment too late, and saying it stopped
   * would be a client told its work was cut short when it had finished.
   */
  const stopOf = (id: string): (() => Promise<boolean>) => {
    const known = stops.get(id);
    if (known !== undefined) return known;
    const stop = async (): Promise<boolean> => {
      const to = ctx.query;
      if (!backgroundTasks.has(id) || to === undefined) return false;
      try {
        await to.stopTask(id);
        return true;
      }
      catch {
        return false;
      }
    };
    stops.set(id, stop);
    return stop;
  };

  /**
   * The terminal one shell task's output is written into, made on first sight.
   *
   * Absent when the host offers no output terminals, which is a host built by
   * hand rather than a daemon: the row is then listed without one, and a
   * client draws the task without its output.
   */
  const outputOf = (taskId: string, rowId: string, chat: string, title: string): string | undefined => {
    const held = outputs.get(rowId);
    if (held !== undefined) return held.terminal.uri;
    const terminals = ctx.options.outputTerminals;
    if (terminals === undefined) return undefined;
    const terminal = terminals.create({ title, chat });
    outputs.set(rowId, {
      terminal,
      poll: pollTaskOutput({
        taskId,
        terminal,
        read: (id) => (ctx.query as unknown as TaskOutputReader).getTaskOutput(id),
        ...(typeof ctx.values['taskOutputFirstWaitMs'] === 'number' ? { firstWaitMs: ctx.values['taskOutputFirstWaitMs'] } : {}),
        ...(typeof ctx.values['taskOutputLongestWaitMs'] === 'number' ? { longestWaitMs: ctx.values['taskOutputLongestWaitMs'] } : {}),
        ...(typeof ctx.values['taskOutputQuietReads'] === 'number' ? { quietReads: ctx.values['taskOutputQuietReads'] } : {}),
      }),
    });
    return terminal.uri;
  };

  /**
   * One background shell, as a task the host draws a row from.
   *
   * The command is what the call asked the shell to run, which is the only
   * place it is written down: the harness describes a task in prose and never
   * repeats the line. A call whose input is not a command falls back to the
   * description, so the field is always a sentence a client can draw.
   */
  const shellWork = (id: string, info: TaskInfo, scope: Scope, chat: string): BackgroundTask => {
    const call = info.toolUseId === undefined ? undefined : scope.parts.get(info.toolUseId)?.toolCall;
    const command = call === undefined ? undefined : str(bag(call).toolInput);
    const rowId = `shell:${id}`;
    const label = info.description ?? '';
    const terminal = outputOf(id, rowId, chat, label);
    return {
      kind: 'shell',
      id: rowId,
      label,
      startedAt: info.startedAt,
      command: command ?? label,
      ...(terminal === undefined ? {} : { terminal }),
      stop: stopOf(id),
    };
  };

  /**
   * The chat one spawning call's worker has, whether or not it is open yet.
   *
   * The host names a worker chat from the session and the call id alone, so the
   * name is known before the chat is. The harness reports a background task and
   * the worker it runs speaks later, or its call's result arrives first, so a
   * chat that is waited for before the task is listed is a task listed late.
   *
   * A host with no seam to open one has no worker chat at all, and a call it
   * spawned is not listed: an entry whose `chat` pointed nowhere would be a row
   * a client draws and cannot open.
   */
  const workerChatOf = (toolCallId: string): string | undefined => {
    const opened = spawning.get(toolCallId)?.chat;
    if (opened !== undefined) return opened;
    return ctx.options.subagent === undefined ? undefined : subagentChatUri(ctx.options.uri, toolCallId);
  };

  /**
   * One running subagent, as a task the host draws a row from.
   *
   * No stop: a subagent is stopped from its own chat, which is a cancel of the
   * turn that runs it, and the protocol's row for one carries no flag.
   */
  const subagentWork = (id: string, info: TaskInfo): BackgroundTask | undefined => {
    const chat = info.toolUseId === undefined ? undefined : workerChatOf(info.toolUseId);
    if (chat === undefined) return undefined;
    return {
      kind: 'subagent',
      id: `subagent:${id}`,
      label: info.description ?? '',
      startedAt: info.startedAt,
      chat,
    };
  };

  /** One task as a background task, or nothing for a kind not listed. */
  const workEntry = (id: string, info: TaskInfo, scope: Scope, chat: string): BackgroundTask | undefined => {
    if (info.type === 'local_bash') return shellWork(id, info, scope, chat);
    if (info.type === 'local_agent') return subagentWork(id, info);
    return undefined;
  };

  /**
   * Report the difference between what each chat is running and what it was told.
   *
   * The `background_tasks_changed` frames and the per-task frames arrive in
   * no fixed order, so what a chat has is a function of both: the first say
   * which tasks are running and `task_started` says what each one is.
   * A task is reported once, when it appears or changes, and taken back once,
   * when it stops being live. Removals go first, so a client applying them in
   * order never holds a removed row beside the one that replaced it.
   *
   * The reports go through the host's seam, which draws the row: a session
   * with no seam - one built by hand rather than by a host - reports nothing,
   * because there is nowhere to report it to.
   */
  const reconcileWork = (): void => {
    const tasks = ctx.options.backgroundTasks;
    if (tasks === undefined) return;
    const wanted = new Map<string, BackgroundTask[]>();
    for (const id of backgroundTasks) {
      const info = taskInfo.get(id);
      const call = info?.toolUseId;
      const scope = call === undefined ? undefined : scopeOfCall(call);
      if (info === undefined || scope === undefined) continue;
      const chat = workChatOf(scope);
      if (chat === undefined) continue;
      const entry = workEntry(id, info, scope, chat);
      if (entry === undefined) continue;
      wanted.set(chat, [...(wanted.get(chat) ?? []), entry]);
    }
    for (const chat of new Set([...told.keys(), ...wanted.keys()])) {
      const before = told.get(chat) ?? [];
      const next = wanted.get(chat) ?? [];
      for (const one of before) {
        if (next.some((two) => two.id === one.id)) continue;
        tasks.remove(chat, one.id);
        // The task ended: one more read, then the output is finished. The
        // terminal itself stays, because a transcript may still point at it,
        // and the session's close is what takes it down.
        outputs.get(one.id)?.poll.finish();
      }
      for (const one of next) {
        const was = before.find((two) => two.id === one.id);
        if (was === undefined || JSON.stringify(was) !== JSON.stringify(one)) tasks.set(chat, one);
      }
      if (next.length === 0) told.delete(chat);
      else told.set(chat, next);
    }
  };

  /**
   * Record what one `task_started` said, and publish whatever that changes.
   *
   * The record is replaced when the harness names the same task again, because
   * the frame is the only account of it and a later one is the better account.
   */
  const noteTask = (message: Bag): void => {
    const id = str(message.task_id);
    if (id === undefined) return;
    const type = str(message.task_type);
    const call = str(message.tool_use_id);
    const description = str(message.description);
    taskInfo.set(id, {
      ...(type !== undefined ? { type } : {}),
      ...(call !== undefined ? { toolUseId: call } : {}),
      ...(description !== undefined ? { description } : {}),
      startedAt: new Date().toISOString(),
    });
    reconcileWork();
  };

  /**
   * Take one `background_tasks_changed` as the whole set of tasks running now.
   *
   * Replace semantics, as the harness asks for: the frame is the whole set, so
   * a missed edge of it costs nothing. An `ambient` task is something the
   * harness runs for itself, so it is not listed.
   */
  const noteBackgroundTasks = (message: Bag): void => {
    backgroundTasks.clear();
    for (const one of list(message.tasks) as Bag[]) {
      const id = str(one.task_id);
      if (id !== undefined && one.ambient !== true) backgroundTasks.add(id);
    }
    reconcileWork();
  };

  /**
   * Forget one task the harness said has ended.
   *
   * The terminal notification is an edge of the same set, read on its own
   * because it can arrive with no `background_tasks_changed` after it. The
   * record goes with the id: a task that has ended has no description worth
   * keeping.
   */
  const dropTask = (taskId: string): void => {
    backgroundTasks.delete(taskId);
    taskInfo.delete(taskId);
    reconcileWork();
  };

  /**
   * A turn's tool calls that never reached an end, ended the way the
   * protocol's reducer ends them when the turn ends: `cancelled`, with reason
   * `skipped`, and only the fields a cancelled call keeps.
   *
   * No action is sent for them, because a client watching already applied
   * that on the turn's own ending; this is the record a client that
   * subscribes afterwards reads. An ask still waiting on one of them is
   * declined, since nothing will run the call it is about. VS Code's mapper's
   * `clearPendingToolCalls`.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L553
   */
  const clearPendingToolCalls = (turn: Bag | undefined): void => {
    for (const part of list(turn?.responseParts) as Bag[]) {
      if (part.kind !== 'toolCall') continue;
      const call = bag(part.toolCall);
      const was = str(call.status);
      if (was === 'completed' || was === 'cancelled') continue;
      const id = str(call.toolCallId);
      for (const one of [...ctx.pending.values()]) {
        if (one.request.kind !== 'toolConfirmation' || str(bag(one.request.toolCall).toolCallId) !== id) continue;
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
   * End a subagent's turn, once, whichever signal got here first.
   *
   * A foreground subagent ends on the `tool_result` of the call that spawned it
   * and a background one on its terminal `task_notification`; both can also
   * arrive - the harness sends a notification for a foreground subagent too -
   * so it ends at the first, its chat holding one turn. Anything the subagent
   * was still asking is declined, so no promise is left that nothing settles.
   */
  const endSubagent = (callId: string, state: 'complete' | 'cancelled'): void => {
    if (completed.has(callId)) return;
    const scope = scopes.get(callId);
    if (scope?.chat === undefined) return;
    completed.add(callId);
    for (const one of [...ctx.pending.values()]) {
      if (one.request.chat !== scope.chat.uri) continue;
      ctx.pending.delete(one.id);
      one.settle({ behavior: 'deny', message: 'The subagent finished' });
      ctx.inputNeededRemoved(one.id);
    }
    clearPendingToolCalls(scope.turn);
    scope.chat.end(state);
    scopes.delete(callId);
    ctx.rounds.delete(callId);
    background.delete(callId);
    tasks.delete(callId);
    if (spawning.get(callId)?.completed === true) spawning.delete(callId);
    byAgent.forEach((held, key) => { if (held === scope) byAgent.delete(key); });
  };

  /**
   * The `subagent` content for a subagent, as the spawning call's result shows it.
   *
   * Read off the call's record, which keeps the chat's URI after the subagent
   * has ended. A call whose subagent's chat was never opened carries nothing:
   * a link names a chat that exists.
   */
  const subagentBlock = (callId: string): Bag | undefined => {
    const info = spawning.get(callId);
    if (info?.chat === undefined) return undefined;
    const title = titleOf(info.description, info.subagentType, ctx.values['subagentTitleMax']);
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
   * the worker's chat. A worker the harness has not named a task for has
   * nothing to stop it by, and nothing else is stopped: VS Code's Claude
   * agent, asked to stop a subagent's chat, leaves the lead turn running.
   */
  const stopWorker = (toolCallId: string): void => {
    const task = tasks.get(toolCallId);
    if (task === undefined) return;
    void ctx.query?.stopTask(task).catch(() => {});
  };

  /** End every output terminal this session made, and the polls behind them. */
  const closeOutputs = (): void => {
    for (const held of outputs.values()) {
      held.poll.cancel();
      held.terminal.dispose();
    }
    outputs.clear();
  };

  return {
    parts, activeToolBlocks, mainScope, scopes, spawning, background, tasks, byAgent, completed,
    taskInfo, backgroundTasks, told,
    scopeFor, recordSpawn, scopeOfCall, emitOn, clearPendingToolCalls, endSubagent,
    subagentBlock, noteTask, noteBackgroundTasks, dropTask, closeOutputs, hasActiveWork: () => backgroundTasks.size > 0,
    methods: { stopWorker },
  };
}
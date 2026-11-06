import type { ActiveTurn } from '@microsoft/agent-host-protocol';
import { mergeLogicalTurnUsage, statusOf, toolCallDurationMs, withToolCallDuration } from '@ahpd/sdk';
import type { Bag, WireTurn } from '@ahpd/sdk';
import { bag, str } from './common.js';
import type { Scope, SessionContext } from './context.js';

/** What this area offers the rest of the session. */
export interface Parts {
  /**
   * Set the chat's `modifiedAt`, where the protocol's reducer sets it and
   * nowhere else: to a turn's start as it starts, and to its start plus its
   * duration as it ends.
   */
  setModifiedAt: (at: string) => void;
  /** Set the chat's `modifiedAt` to where an ended turn leaves it, its start plus its duration. */
  endedAt: (turn: Bag) => void;
  /** Rename the session, and say so. */
  retitle: (said: string) => void;
  /** The SDK's token counts, in the protocol's spelling. */
  usageOf: (raw: unknown, model?: string) => Bag | undefined;
  /** Forget what the last turn counted. */
  newTurn: () => void;
  /** Add one API call's half to the running turn's sum. */
  count: (raw: unknown, half: readonly string[]) => void;
  /** The running turn's sum so far, in the protocol's spelling. */
  sum: () => Bag | undefined;
  /** Tell everybody the running turn what it has cost so far. */
  sayUsage: () => void;
  /** What one `result` cost, as the change in `modelUsage` since the last. */
  costOf: (message: Bag) => Bag | undefined;
  /** Forget the cost baseline: the CLI's running total starts again. */
  newConversation: () => void;
  /** The session's status, read into the snapshot and into `status`. */
  status: () => number;
  /** Say the session is waiting on one request. */
  inputNeededSet: (entry: Bag) => void;
  /** Say the session is no longer waiting on one request. */
  inputNeededRemoved: (id: string) => void;
  /** The turn a frame of a conversation belongs to: the lead's running turn, or a worker's, opened if it has none. */
  openTurn: (scope?: Scope) => Bag | undefined;
  /** Announce a prose part. */
  addPart: (scope: Scope, part: Bag) => void;
  /** Hold a tool call for the snapshot, without announcing it. */
  holdPart: (turn: Bag, part: Bag) => void;
  /** Hold when a call started running, and hand back its bag. */
  stampStart: (call: Bag, at?: number) => Bag;
  /** Put how long a call ran on its bag, and hand the bag back. */
  stampEnd: (call: Bag, at?: number) => Bag;
  /** Forget a call's start, for a call that never ran, and hand back its bag. */
  untimed: (call: Bag) => Bag;
  /** Record a failure as a part of a turn, and hand the part back. `resumable` says a client may ask for the turn again. */
  addFailure: (turn: Bag, errorType: string, why: string, resumable?: boolean) => Bag;
}

export function createParts(ctx: SessionContext): Parts {
  /*
   * The chat's `modifiedAt`, held as the protocol's reducer moves it, so a
   * client that subscribes reads what one that followed the actions holds.
   * https://github.com/microsoft/agent-host-protocol/blob/v1.0.0/types/channels-chat/reducer.ts#L172-L211
   */
  const setModifiedAt = (at: string): void => { ctx.modified = at; };
  const endedAt = (turn: Bag): void => {
    setModifiedAt(new Date(Date.parse(String(turn.startedAt)) + Number(turn.duration ?? 0)).toISOString());
  };

  /** Retitle, and say so: a client that opened the session holds the old one. */
  const retitle = (said: string): void => {
    if (said === '' || said === ctx.title)
      return;
    ctx.title = said;
    ctx.emit('session', { type: 'session/titleChanged', title: ctx.title });
  };

  /**
   * The SDK's token counts, in the protocol's spelling.
   *
   * Every field is optional on both sides, so anything missing is left out
   * rather than reported as zero - a nought is a measurement and an absence
   * is not. Cache writes are no different: a measurement the protocol names no
   * field for, so it rides `_meta` the way cofold's does.
   *
   * An input of zero with no cache read or write and an output above zero is a
   * prompt the provider did not count, so it is left out as well.
   */
  const usageOf = (raw: unknown, model?: string): Bag | undefined => {
    const found = bag(raw);
    const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const input = num(found.input_tokens);
    const output = num(found.output_tokens);
    const read = num(found.cache_read_input_tokens);
    const writes = num(found.cache_creation_input_tokens);
    const uncounted = input === 0 && output !== undefined && output > 0
      && (read === undefined || read === 0) && (writes === undefined || writes === 0);
    const info: Bag = {
      ...(input !== undefined && !uncounted ? { inputTokens: input } : {}),
      ...(output !== undefined ? { outputTokens: output } : {}),
      ...(read !== undefined ? { cacheReadTokens: read } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(writes !== undefined ? { _meta: { 'ahpd.cacheWriteTokens': writes } } : {}),
    };
    return Object.keys(info).length > 0 ? info : undefined;
  };

  /**
   * The running turn's token counts so far, in the SDK's spelling.
   *
   * One sum for the whole turn: every API call it made, the session's own
   * agent and every subagent it delegated to. A turn pays for the work it
   * delegated as much as for its own, and `result.usage` is the main agent
   * loop alone, so no single frame of the stream reports what the turn cost.
   * Keyed by the SDK's own field names, which `usageOf` reads.
   */
  const spent: Record<string, number> = {};
  /** A new turn counts nothing yet. */
  const newTurn = (): void => {
    for (const key of Object.keys(spent)) delete spent[key];
  };

  /** One API call's half, added to the turn's sum; anything absent is left out. */
  const count = (raw: unknown, half: readonly string[]): void => {
    const found = bag(raw);
    for (const key of half) {
      const value = found[key];
      if (typeof value === 'number') spent[key] = (spent[key] ?? 0) + value;
    }
  };

  /** The sum so far, in the protocol's spelling, or nothing if no call reported. */
  const sum = (): Bag | undefined => (Object.keys(spent).length === 0 ? undefined : usageOf({ ...spent }, ctx.ran));

  /**
   * The turn's total, sent on the session's own chat after every call.
   *
   * For the turn that is running rather than the one the call was made in: a
   * worker's chat has its own turn and its own history, and the work a turn
   * delegated is that turn's own cost. The protocol *replaces* the active
   * turn's usage on each `chat/usage`, so this is a total that grows rather
   * than a delta a client would have to add up itself - and the turn is held
   * to it, so a client reading the snapshot mid-turn reads the same number. A
   * resumed turn says this run's total, which the host merges over the run
   * before's, and is held to the two merged.
   */
  const sayUsage = (): void => {
    const turn = ctx.active;
    const used = sum();
    if (turn === undefined || used === undefined) return;
    turn.usage = mergeLogicalTurnUsage(ctx.resumedFrom?.usage, used);
    ctx.emit('chat', { type: 'chat/usage', turnId: turn.id, usage: used });
  };

  /**
   * What `modelUsage` had cost each model at the last `result`.
   *
   * `modelUsage` and `total_cost_usd` are cumulative per `query()` call, not
   * per turn, and each result carries the running total so far. A turn's cost
   * is therefore the change since the last one. Keyed by model because a turn
   * can cross models: a worker on another one adds to its own entry and not to
   * the lead agent's.
   */
  const paid = new Map<string, number>();

  /**
   * Forget the baseline, because the CLI's own total starts again.
   *
   * `/clear`, a plan-mode exit and a fresh session all reset the running total
   * `modelUsage` is cumulative against, so the figure on the next `result` is
   * a spend from zero rather than a step from where the books were. A baseline
   * left where it was sits above the new total, and every turn after the reset
   * reads as a figure that did not go up - billed as nothing until the total
   * climbs back past the old one.
   */
  const newConversation = (): void => { paid.clear(); };

  /**
   * What this `result` cost, as the change in `modelUsage` since the last one.
   *
   * `costBasis` is `unknown` where the CLI had no price row for a model, and
   * `costUSD` is then a guess at the default model's rate rather than a price
   * anything can be held to. A guess is left out, and one model's guess
   * suppresses the whole total rather than its own share of it: a partial sum
   * of a price reads as the price.
   *
   * A figure that did not go up is not a spend. A crash or a startup error
   * comes back with every count zeroed, which read as a measurement is a
   * negative cost on the turn it ended and leaves a baseline the result behind
   * it bills the whole conversation's total against. A result that found the
   * books where the last one left them spent nothing, and a turn that spent
   * nothing sends no cost rather than a cost of nothing. The baseline moves
   * only for a model this result spent on, so the next one differences from the
   * last figure that was really a figure.
   */
  const costOf = (message: Bag): Bag | undefined => {
    const models = bag(message.modelUsage);
    if (Object.keys(models).length === 0) return undefined;
    let amount = 0;
    let spent = false;
    let guessed = false;
    for (const [model, value] of Object.entries(models)) {
      const entry = bag(value);
      const was = paid.get(model) ?? 0;
      const now = typeof entry.costUSD === 'number' ? entry.costUSD : was;
      if (now <= was) continue;
      // Cumulative per query, so a model priced by guess once stays in the
      // map; only one this result spent on can make the total a guess.
      paid.set(model, now);
      spent = true;
      if (entry.costBasis === 'unknown') guessed = true;
      else amount += now - was;
    }
    return spent && !guessed ? { amount, currency: 'USD' } : undefined;
  };

  /** The session-level summary of what is wanted. Set with the tool call, cleared with it. */
  /*
   * One request at a time, named by its id.
   *
   * `session/inputNeededSet` carries `request` and adds or updates the entry
   * with that id; `session/inputNeededRemoved` carries the `id` to drop. This
   * sent `inputNeeded: [entry]` and a bare removal, so a client reducing the
   * actions could neither add the second question nor tell which one had been
   * answered.
   */
  const inputNeededSet = (entry: Bag): void => {
    ctx.emit('session', { type: 'session/inputNeededSet', request: entry });
  };
  const inputNeededRemoved = (id: string): void => {
    ctx.emit('session', { type: 'session/inputNeededRemoved', id });
  };

  // ------------------------------------------------------------- translation

  /**
   * The turn a frame belongs to.
   *
   * A lead frame no prompt is pending for has none, and is dropped, as VS
   * Code's Claude router maps a frame only to the prompt it answers: a CLI that
   * runs on its own opens no turn a client did not start. The one exception is
   * the turn a background task's end wakes, which opens as that task's notice;
   * VS Code shows nothing there. A worker's chat whose turn ended opens one of
   * the agent's own.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeSdkMessageRouter.ts#L82-L84
   */
  const openTurn = (scope: Scope = ctx.mainScope): Bag | undefined => {
    if (scope.turn) return scope.turn;
    /*
     * The summary a background task's end left for the turn it wakes.
     *
     * The CLI starts a turn when a notification arrives while nothing runs,
     * and that turn answers the notification rather than the person: its
     * message is the task's summary, drawn as one muted line. A notification
     * that arrived inside a turn left none here, and a turn that opens with
     * something else - a person's prompt, a steering message answered late -
     * takes what was left with it.
     */
    const notice = scope === ctx.mainScope ? ctx.pendingSummary : undefined;
    if (scope === ctx.mainScope) ctx.pendingSummary = undefined;
    if (scope === ctx.mainScope && notice === undefined) return undefined;
    // `usage` is required on an `ActiveTurn` and means "not measured yet".
    const opened = {
      id: `turn-${Date.now()}`,
      startedAt: new Date().toISOString(),
      // A notice is the system's, and a turn nobody opened is the agent's own.
      // `Message.origin` is required.
      message: notice !== undefined
        ? { text: notice, origin: { kind: 'systemNotification' } }
        : { text: '', origin: { kind: 'agent' } },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    scope.turn = opened;
    ctx.emitOn(scope, {
      type: 'chat/turnStarted',
      turnId: opened.id,
      startedAt: opened.startedAt,
      message: opened.message,
    });
    return opened;
  };

  /** Prose: the part is announced, then filled by deltas. */
  const addPart = (scope: Scope, part: Bag): void => {
    const turn = scope.turn;
    if (turn === undefined) return;
    (turn.responseParts as Bag[]).push(part);
    ctx.emitOn(scope, { type: 'chat/responsePart', turnId: turn.id, part });
  };

  /**
   * A tool call: held for the snapshot, and announced by `chat/toolCallStart`.
   *
   * That action *creates* the response part on the client side, so sending
   * `chat/responsePart` for one as well puts the same call in the transcript
   * twice - once as this host's part and once as the reducer's own.
   */
  const holdPart = (turn: Bag, part: Bag): void => {
    (turn.responseParts as Bag[]).push(part);
  };

  /**
   * When each call began running, on this plugin's clock, by the call.
   *
   * What the duration said at the call's completion is measured from, on its
   * `_meta` as VS Code's host says it. A call asked about is started again at
   * its approval, so the wait for a person is not counted.
   */
  const started = new WeakMap<Bag, number>();

  const stampStart = (call: Bag, at = Date.now()): Bag => {
    started.set(call, at);
    return bag(call._meta);
  };

  const stampEnd = (call: Bag, at = Date.now()): Bag => {
    call._meta = withToolCallDuration(call._meta === undefined ? undefined : bag(call._meta), toolCallDurationMs(started.get(call), at));
    started.delete(call);
    return bag(call._meta);
  };

  const untimed = (call: Bag): Bag => {
    started.delete(call);
    return bag(call._meta);
  };

  /**
   * Why a turn stopped, as a part of it.
   *
   * 0.9.0 took `error` off `Turn` and gave the reason a response part instead,
   * which is the better home for it: what the agent said before it failed
   * still stands, and the failure belongs after those three things rather than
   * beside them. Without this the state says `error` and nothing anywhere says
   * what went wrong.
   *
   * `resumable` is only ever `true`, and says a client may ask for the turn
   * again. A model call the CLI failed is one, when the conversation has a
   * turn before this one to cut back to or this process started it from
   * nothing. A turn refused before the CLI, a CLI that is gone and a refused
   * login have nothing to run again on, and carry none.
   */
  /*
   * Why a turn stopped, held for the snapshot rather than announced.
   *
   * `chat/error` *carries* this part and appends it itself, so a
   * `chat/responsePart` for the same thing is the failure printed twice. The
   * part is `{ kind, error }` and nothing else: `ErrorResponsePart` has no id.
   *
   * `errorType` is what VS Code names the failure by: a failed result's
   * subtype, as its Claude mapper sets it, and the stage a failure before the
   * result happened at, as its host does for a send.
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/claude/claudeMapSessionEvents.ts#L541-L544
   * https://github.com/microsoft/vscode/blob/6b68d3fe7dd7db9a3aaa052efc1f3a1fd4432eb2/src/vs/platform/agentHost/node/agentSideEffects.ts#L2564-L2575
   */
  const addFailure = (turn: Bag, errorType: string, why: string, resumable = false): Bag => {
    const part: Bag = {
      kind: 'error',
      error: { errorType, message: why },
      ...(resumable ? { resumable: true } : {}),
    };
    (turn.responseParts as Bag[]).push(part);
    return part;
  };

  return {
    setModifiedAt, endedAt, retitle, usageOf, newTurn, count, sum, sayUsage, costOf,
    newConversation, inputNeededSet, inputNeededRemoved, openTurn, addPart, holdPart,
    stampStart, stampEnd, untimed, addFailure,
    /*
     * `pending` is a question a client or a person is being asked, and a turn is
     * `active` from the moment it begins.
     *
     * Both conditions are read as truthiness here, the way this backend always
     * read them: an empty `failed` is a turn that failed with nothing to say,
     * and this backend has always drawn that as no failure at all.
     */
    status: (): number => statusOf({
      waiting: ctx.pending.size > 0,
      active: Boolean(ctx.active),
      failed: Boolean(ctx.failed),
    }),
  };
}

/** What one model's results said it can hold and answer. */
export interface ModelLimit {
  /** The context window, in tokens. */
  contextWindow?: number;
  /** The most the model may answer in one call, in tokens. */
  maxOutputTokens?: number;
}

/**
 * What every result so far has said of each model, by every name it used.
 *
 * The CLI's model list names a model and a display name but no limit, and each
 * result's `modelUsage` names the window and the output cap of the model that
 * answered. A row is matched by its `resolvedModel` or the entry's
 * `canonicalModel`, so both are kept beside the raw key. This is process-wide
 * because a limit belongs to a model and not to a session, and a restart
 * starts over, which costs one turn.
 */
const limits = new Map<string, ModelLimit>();

/** Who to tell when a result teaches a limit nobody had yet. */
const limitListeners = new Set<() => void>();

/** What is known of one model's limits, by any name it has been seen under. */
export const limitOf = (model: string | undefined): ModelLimit | undefined =>
  model === undefined ? undefined : limits.get(model);

/** Listen for a learned limit, and answer the function that stops listening. */
export const onLimitLearned = (listen: () => void): (() => void) => {
  limitListeners.add(listen);
  return () => { limitListeners.delete(listen); };
};

/**
 * Keep each model's context window and output cap from one result.
 *
 * A result that names neither teaches nothing, and a result that names one
 * leaves the other as it was. The listeners hear only about a limit that
 * changed, so a probe refresh is one per model and not one per turn.
 *
 * @returns Whether this result taught a limit that was not known before.
 */
export const learnLimits = (message: Bag): boolean => {
  const models = bag(message.modelUsage);
  let learned = false;
  for (const [model, value] of Object.entries(models)) {
    const entry = bag(value);
    const contextWindow = typeof entry.contextWindow === 'number' ? entry.contextWindow : undefined;
    const maxOutputTokens = typeof entry.maxOutputTokens === 'number' ? entry.maxOutputTokens : undefined;
    if (contextWindow === undefined && maxOutputTokens === undefined) continue;
    const said: ModelLimit = {
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxOutputTokens === undefined ? {} : { maxOutputTokens }),
    };
    const names = new Set([model, str(entry.canonicalModel) ?? '']);
    for (const name of names) {
      if (name === '') continue;
      const was = limits.get(name);
      const merged: ModelLimit = { ...was, ...said };
      if (was !== undefined && was.contextWindow === merged.contextWindow && was.maxOutputTokens === merged.maxOutputTokens) continue;
      limits.set(name, merged);
      learned = true;
    }
  }
  if (learned) for (const listen of limitListeners) listen();
  return learned;
};
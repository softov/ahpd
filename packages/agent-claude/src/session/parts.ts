import type { ActiveTurn } from '@microsoft/agent-host-protocol';
import { Status, callTimes, startOf, withCallTimes } from '@ahpd/sdk';
import type { Bag, WireTurn } from '@ahpd/sdk';
import { bag } from './common.js';
import type { Scope, SessionContext } from './context.js';
import { summarize } from '../input.js';

/** What this area offers the rest of the session. */
export interface Parts {
  /** Record that something happened just now. */
  touch: () => void;
  /** Say what the session is doing, if that has changed. */
  doing: (said: string | undefined) => void;
  /** One line for a tool that is running. */
  busyWith: (name: string, input: Bag) => string;
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
  /** The session's status, read into the snapshot and into `status`. */
  status: () => number;
  /** Say the session is waiting on one request. */
  inputNeededSet: (entry: Bag) => void;
  /** Say the session is no longer waiting on one request. */
  inputNeededRemoved: (id: string) => void;
  /** The turn a conversation is on, opened if it has none. */
  openTurn: (scope?: Scope) => Bag;
  /** Announce a prose part. */
  addPart: (scope: Scope, part: Bag) => void;
  /** Hold a tool call for the snapshot, without announcing it. */
  holdPart: (turn: Bag, part: Bag) => void;
  /** A call's bag with its start stamped. */
  stampStart: (call: Bag, at?: number) => Bag;
  /** A call's bag with its end stamped. */
  stampEnd: (call: Bag, at?: number) => Bag;
  /** A call's bag with the times taken off. */
  untimed: (call: Bag) => Bag;
  /** Record a failure as a part of a turn, and hand the part back. */
  addFailure: (turn: Bag, why: string) => Bag;
}

export function createParts(ctx: SessionContext): Parts {
  const touch = (): void => { ctx.modified = new Date().toISOString(); };

  /**
   * Say what it is doing now, if that has changed.
   *
   * On both channels: the chat is where the work happens, and the protocol
   * says a session mirrors its default chat's activity - which is the one a
   * catalogue row and a detail pane read.
   */
  const doing = (said: string | undefined): void => {
    if (ctx.activity === said)
      return;
    ctx.activity = said;
    ctx.emit('chat', { type: 'chat/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
    ctx.emit('session', { type: 'session/activityChanged', ...(said !== undefined ? { activity: said } : {}) });
  };

  /** One line for a tool that is running. The name alone says too little. */
  const busyWith = (name: string, input: Bag): string => {
    const what = summarize(name, input);
    return (what ? `${name} ${what}` : name).replace(/\s+/g, ' ').slice(0, 80);
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
   */
  const usageOf = (raw: unknown, model?: string): Bag | undefined => {
    const found = bag(raw);
    const num = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);
    const writes = num(found.cache_creation_input_tokens);
    const info: Bag = {
      ...(num(found.input_tokens) !== undefined ? { inputTokens: num(found.input_tokens) } : {}),
      ...(num(found.output_tokens) !== undefined ? { outputTokens: num(found.output_tokens) } : {}),
      ...(num(found.cache_read_input_tokens) !== undefined ? { cacheReadTokens: num(found.cache_read_input_tokens) } : {}),
      ...(model !== undefined ? { model } : {}),
      ...(writes !== undefined ? { _meta: { cacheWriteTokens: writes } } : {}),
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
   * to it, so a client reading the snapshot mid-turn reads the same number.
   */
  const sayUsage = (): void => {
    const turn = ctx.active;
    const used = sum();
    if (turn === undefined || used === undefined) return;
    turn.usage = used;
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
   * What this `result` cost, as the change in `modelUsage` since the last one.
   *
   * `costBasis` is `unknown` where the CLI had no price row for a model, and
   * `costUSD` is then a guess at the default model's rate rather than a price
   * anything can be held to. A guess is left out, and one model's guess
   * suppresses the whole total rather than its own share of it: a partial sum
   * of a price reads as the price. Nothing at all is sent when no model is
   * priced, and the running baseline is advanced either way, so the next
   * `result` differences from where this one left the books.
   */
  const costOf = (message: Bag): Bag | undefined => {
    const models = bag(message.modelUsage);
    if (Object.keys(models).length === 0) return undefined;
    let amount = 0;
    let guessed = false;
    for (const [model, value] of Object.entries(models)) {
      const entry = bag(value);
      const was = paid.get(model) ?? 0;
      const now = typeof entry.costUSD === 'number' ? entry.costUSD : was;
      paid.set(model, now);
      // Cumulative per query, so a model priced by guess once stays in the
      // map; only one this result spent on can make the total a guess.
      if (now === was) continue;
      if (entry.costBasis === 'unknown') guessed = true;
      else amount += now - was;
    }
    return guessed ? undefined : { amount, currency: 'USD' };
  };

  const status = (): number => (ctx.pending.size > 0 ? Status.InputNeeded
    : ctx.active ? Status.InProgress
      : ctx.failed ? Status.Error
        : Status.Idle);

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

  const openTurn = (scope: Scope = ctx.mainScope): Bag => {
    if (scope.turn) return scope.turn;
    // A turn the client did not begin: the agent spoke first, which happens on
    // a resumed session. Better an id of our own than a turn with none.
    // `usage` is required on an `ActiveTurn` and means "not measured yet".
    // Leaving the key off put a turn on the wire that did not satisfy its own
    // type, which nothing here would have noticed.
    const opened = {
      id: `turn-${Date.now()}`,
      startedAt: new Date().toISOString(),
      // The agent spoke first, so the message in front of this turn is its
      // own. `Message.origin` is required and used to be left off entirely.
      message: { text: '', origin: { kind: 'agent' } },
      responseParts: [],
      usage: undefined,
    } satisfies WireTurn<ActiveTurn> as Bag;
    scope.turn = opened;
    // Only the session's own turn moves the session's clock and clears its
    // last failure; a worker's turn is not what the session is doing.
    if (scope === ctx.mainScope) {
      ctx.startedAt = Date.now();
      ctx.failed = undefined;
      newTurn();
    }
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
   * A call's bag with its start stamped, when it began running.
   *
   * The plugin's own clock, and stamped onto the call rather than onto the
   * action announcing it: an action carrying a `_meta` replaces the call's
   * whole bag, so a call that is asked about after this one is stamped again
   * at its approval and every later action has to carry the times again.
   */
  const stampStart = (call: Bag, at = Date.now()): Bag => {
    call._meta = withCallTimes(bag(call._meta), callTimes(at));
    return bag(call._meta);
  };

  /** A call's bag with its end stamped, measured from the start it holds. */
  const stampEnd = (call: Bag, at = Date.now()): Bag => {
    call._meta = withCallTimes(bag(call._meta), callTimes(startOf(call._meta) ?? at, at));
    return bag(call._meta);
  };

  /** A call's bag with the times taken off, for a call that never ran. */
  const untimed = (call: Bag): Bag => {
    const { 'ahpd.startedAt': _started, 'ahpd.endedAt': _ended, 'ahpd.durationMs': _duration, ...rest } = bag(call._meta);
    call._meta = Object.keys(rest).length > 0 ? rest : undefined;
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
   * No `resumable`. It is only ever `true` to offer a resume, and this host
   * cannot resume a turn - saying so with a `false` it never varies would be
   * answering a question nobody asked.
   */
  /*
   * Why a turn stopped, held for the snapshot rather than announced.
   *
   * `chat/error` *carries* this part and appends it itself, so a
   * `chat/responsePart` for the same thing is the failure printed twice. The
   * part is `{ kind, error }` and nothing else: `ErrorResponsePart` has no id.
   */
  const failurePart = (why: string): Bag => ({
    kind: 'error',
    error: { errorType: 'turnFailed', message: why },
  });
  const addFailure = (turn: Bag, why: string): Bag => {
    const part = failurePart(why);
    (turn.responseParts as Bag[]).push(part);
    return part;
  };

  return {
    touch, doing, busyWith, retitle, usageOf, newTurn, count, sum, sayUsage, costOf,
    status, inputNeededSet, inputNeededRemoved, openTurn, addPart, holdPart,
    stampStart, stampEnd, untimed, addFailure,
  };
}
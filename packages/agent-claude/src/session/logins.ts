import type { Bag } from '@ahpd/sdk';
import { forgetSession } from '../catalog.js';
import { BEFORE_TOKEN, FAILOVER, loginsOf, REFUSED } from '../logins.js';
import type { Login } from '../logins.js';
import { bag, list, str } from './common.js';
import type { SessionContext } from './context.js';
import { failureOf } from './failure.js';

/** What this area offers the rest of the session. */
export interface Logins {
  /**
   * The login the running CLI was started on, or nothing for a CLI on the
   * agent's own credential or on a key a client pushed.
   */
  login: Login | undefined;
  /**
   * Where a failed turn is cut back to, or nothing when it cannot be.
   *
   * The turn before's last chain entry, or a conversation this process started
   * from nothing, which starts over under its id.
   */
  cutOf: () => Cut | undefined;
  /** The login a turn that starts now runs on, from the values it starts with. */
  loginFor: (values: Bag) => Login | undefined;
  /** Why a turn that starts now cannot run: its record names logins, and none is ready. */
  unready: (values: Bag) => string | undefined;
  /** A `rate_limit_event` from the CLI, kept for the retry time the failure after it names. */
  limited: (info: Bag) => void;
  /**
   * Whether an assistant frame is a failure of the running turn's login that
   * the turn does not show: one the turn moves on from, or one it ends with
   * words of its own.
   */
  refused: (message: Bag) => boolean;
  /** The login a failed turn goes on on, read at its `result`, or nothing when the turn ends there. */
  nextLogin: () => Login | undefined;
  /** Run the failed turn again on `login`. */
  moveOn: (login: Login) => Promise<void>;
  /** The words the running turn ends with, for a failure of its login that it did not show. */
  failure: () => string | undefined;
  /**
   * The running turn's calls went through: kept on its login's connector, as
   * the proxy keeps a call of an entry that worked, so a row a failure marked
   * says the login works again.
   */
  answered: () => void;
  /**
   * Whether a query is the CLI a move closed and has not replaced yet.
   *
   * A start-over waits for that CLI to exit and deletes its conversation before
   * the next CLI exists, so the end of its frames is the move's own doing.
   */
  replacing: (handle: unknown) => boolean;
}

/** Whether a turn is a `!` command's, which ran on no CLI. */
const isCommand = (turn: Bag): boolean => list(turn.responseParts)
  .some((part) => str(bag(bag(part).toolCall).toolCallId) === `${String(turn.id)}:command`);

/**
 * Where a turn is put back to before it runs again.
 *
 * `at` is the last chain entry of the turn before it, where a cut is made.
 * `over` is a conversation whose first turn this is, which has no entry before
 * its prompt and starts over under its id instead.
 */
export type Cut = { at?: string; over?: true };

export function createLogins(ctx: SessionContext): Logins {
  /**
   * Whether a client pushed a key for this session.
   *
   * A pushed token is spent on the sessions its connection asks for, as
   * `docs/sdk/AUTHENTICATION.md` says of `authenticate`, so such a session runs
   * on the key and on no login.
   */
  const pushed = (): boolean => BEFORE_TOKEN.some((name) => {
    const value = ctx.options.env?.[name];
    return typeof value === 'string' && value !== '';
  });

  /** The connector ids a record's `logins` names, in its order, each once. */
  const named = (values: Bag): string[] => {
    if (ctx.options.logins === undefined || pushed()) return [];
    const ids: string[] = [];
    for (const one of list(values['logins'])) {
      const id = str(one);
      if (id !== undefined && id !== '' && !ids.includes(id)) ids.push(id);
    }
    return ids;
  };

  /** Each named login whose connector is open and belongs to the agent's owner or to the host, in the record's order. */
  const usable = (values: Bag): Login[] => (pushed() ? [] : loginsOf(values, ctx.options.logins));

  /** When a login comes back, or nothing for one that is not resting. */
  const restOf = (id: string): number | undefined => ctx.options.logins?.open.rests.until(id);

  /**
   * The logins a turn may run on, in the record's order: the usable ones that
   * are not resting.
   *
   * The model proxy's route, which sends a name to the first entry in the
   * file's order with a connector the caller may use, and keeps the rest in
   * order, as `docs/server/PROXY.md` says under *How a name is routed*. A record
   * that names no login runs on the agent's own credential.
   */
  const ready = (values: Bag): Login[] => usable(values).filter((one) => restOf(one.id) === undefined);

  const loginFor = (values: Bag): Login | undefined => ready(values)[0];

  /** The usable login that comes back first, and when, or nothing when none rests. */
  const soonest = (values: Bag): string | undefined => {
    let first: { id: string; at: number } | undefined;
    for (const one of usable(values)) {
      const at = restOf(one.id);
      if (at !== undefined && (first === undefined || at < first.at)) first = { id: one.id, at };
    }
    return first === undefined ? undefined : `${first.id} is back first, at ${new Date(first.at).toISOString()}`;
  };

  /**
   * The refusal of a turn whose record names logins, none of them ready.
   *
   * The proxy's answer to a call no open connector serves, which names each
   * provider it looked for, as *What a refusal means* in `docs/server/PROXY.md`
   * says. With every open login resting, it names the first back instead.
   */
  const unready = (values: Bag): string | undefined => {
    const ids = named(values);
    if (ids.length === 0 || ready(values).length > 0) return undefined;
    const back = soonest(values);
    return back === undefined
      ? `No login this agent names is open: ${ids.join(', ')}`
      : `No login this agent names is ready: ${back}`;
  };

  /** What the CLI's last `rate_limit_event` said, while it said `rejected`. */
  let rejected: Bag | undefined;
  const limited = (info: Bag): void => {
    rejected = str(info.status) === 'rejected' ? info : undefined;
  };

  /**
   * The retry time a `rejected` event names, in epoch milliseconds.
   *
   * Its `resetsAt` is in the epoch seconds the CLI reads the API's
   * `anthropic-ratelimit-unified-reset` in, the time the API's `retry-after`
   * counts down to.
   */
  const retryOf = (info: Bag | undefined): number | undefined => {
    const at = info?.resetsAt;
    return typeof at === 'number' && Number.isFinite(at) && at > 0 ? at * 1000 : undefined;
  };

  /** The logins the running turn has tried, by its id. */
  let tried: { turn: string; ids: Set<string> } | undefined;

  /**
   * The running turn's failure, while it moves to the next login or ends.
   *
   * `said` is what the turn ends with. `at` is the last chain entry of the turn
   * before it on the CLI, where a move cuts. `over` is a conversation whose
   * first turn this is, which has no entry before its prompt and starts over
   * instead: its conversation is deleted and a new one begins under its id, as
   * a chat truncated whole does. `end` is a failure that moves nowhere.
   */
  let move: { turn: string; said: string; at?: string; over?: true; end?: true } | undefined;

  /** The CLI a move closed, until the next one is in its place. */
  let closing: unknown;
  const replacing = (handle: unknown): boolean => closing !== undefined && handle === closing;

  /**
   * Where a failed turn is cut back to, or nothing when it cannot be.
   *
   * The last turn before it that ran on the CLI, skipping `!` commands, which
   * the CLI never saw. Its entry in `ends` is where a rewind cuts. A turn read
   * back after a restart has an entry only once the backend records one at the
   * transcript read, and a turn with none cannot be cut back to: the turn ends
   * with its failure rather than run again on a conversation that still holds
   * the failed prompt. With no turn before it at all, a conversation this
   * process started holds nothing but that prompt, and starts over; one it
   * resumed, or one in a machine whose files this host cannot delete, does not.
   */
  const cutOf = (): Cut | undefined => {
    for (let i = ctx.turns.length - 1; i >= 0; i--) {
      const turn = bag(ctx.turns[i]);
      if (isCommand(turn)) continue;
      const at = ctx.ends.get(String(turn.id));
      return at === undefined ? undefined : { at };
    }
    if (ctx.options.resume !== undefined || ctx.options.spawn !== undefined) return undefined;
    return { over: true };
  };

  /*
   * The model proxy's loop over its entries, in
   * `packages/server/src/proxy/listener.ts`, with a login for an entry: each
   * outcome is noted for the connector, a refused credential is told and sent
   * to no other entry, and no connection, a 429 or a 5xx goes to the next entry
   * while nothing has reached the caller. Once a byte has, nothing is run
   * again, as `docs/server/PROXY.md` says under *When a provider fails*.
   */
  const refused = (message: Bag): boolean => {
    const error = str(message.error);
    if (error === undefined) return false;
    const until = retryOf(rejected);
    rejected = undefined;
    const turn = ctx.active;
    const login = ctx.login;
    const agent = ctx.options.logins;
    if (turn === undefined || login === undefined || agent === undefined) return false;
    if (str(message.parent_tool_use_id) !== undefined && str(message.parent_tool_use_id) !== '') return false;
    if (!FAILOVER.has(error) && !REFUSED.has(error)) return false;
    const said = list(bag(message.message).content).map((block) => str(bag(block).text) ?? '').join('');
    if (until !== undefined) agent.open.rest(login.id, login.token, until);
    // The proxy's log takes the provider's words with the key cut out.
    const why = `${error}: ${said.split(login.token).join('<token>')}`;
    agent.open.failed(login.id, why);
    // And the connector's health keeps the call, with when the login is back
    // where the failure named it, so its row says why and until when.
    agent.open.called(login.id, login.token, {
      ok: false,
      error: until === undefined ? why : `${why}; back at ${new Date(until).toISOString()}`,
    });
    if (REFUSED.has(error)) {
      move = { turn: String(turn.id), said: `Claude refused login ${login.id} (${error})`, end: true };
      return true;
    }
    if (list(turn.responseParts).length > 0) return false;
    const cut = cutOf();
    if (cut === undefined) return false;
    move = { turn: String(turn.id), said, ...cut };
    return true;
  };

  const moving = (): boolean => move !== undefined && ctx.active !== undefined && move.turn === String(ctx.active.id);

  /**
   * The first ready login in the record's order that the failed turn has not
   * tried, as the proxy tries each entry once for a call.
   */
  const nextLogin = (): Login | undefined => {
    const held = move;
    if (held === undefined || held.end === true || !moving()) return undefined;
    if (tried?.turn !== held.turn) tried = { turn: held.turn, ids: new Set() };
    const done = tried.ids;
    if (ctx.login !== undefined) done.add(ctx.login.id);
    return ready(ctx.values).find((one) => !done.has(one.id));
  };

  /**
   * The words a turn ends with when its failure moves it nowhere.
   *
   * A refused credential's own sentence; otherwise the last failure's words,
   * with the first login back and when, as the proxy answers its caller with
   * the last entry's answer and its `retry-after`.
   */
  const failure = (): string | undefined => {
    const held = move;
    if (held === undefined || !moving()) return undefined;
    move = undefined;
    if (held.end === true) return held.said;
    const back = soonest(ctx.values);
    return back === undefined ? held.said : `${held.said}\nNo login this agent names is left to try: ${back}`;
  };

  /**
   * Put a new CLI on the turn's conversation, on `login`, and send the turn's
   * prompt to it again, with the steering messages the turn sent the CLI it
   * replaces behind it.
   *
   * Cut back to the end of the turn before it, as a rewind cuts, so the failed
   * prompt is not in the conversation the new CLI resumes; or, for a
   * conversation's first turn, started over under its id. The conversation's
   * entry for this turn goes with the cut or the delete, so it is taken out of
   * `ends`.
   *
   * A conversation whose delete fails still holds the failed prompt and its
   * reply. It comes back as it is, on the new login, and the turn ends with the
   * failure, as a turn with no cut point does; the reply stays its last entry.
   * A steering message the CLI took in is in it too; the others go to the new
   * CLI, and are answered in a turn of their own, as a failed turn's are.
   */
  const moveOn = async (login: Login): Promise<void> => {
    const held = move;
    const turn = ctx.active;
    if (held === undefined || turn === undefined || held.turn !== String(turn.id)) return;
    // The steering messages the CLI owes the turn an answer to, which it takes
    // with it when it is put away.
    const steers = [...ctx.owed.values()].filter((owed) => owed.steering && owed.turn === held.turn);
    const was = ctx.handle;
    let failed: string | undefined;
    closing = was;
    try {
      try { was.close(); }
      catch { /* A CLI already gone is the same ending. */ }
      ctx.login = login;
      if (held.over === true) {
        // Stopped before the delete, so nothing writes the conversation back.
        await (was as unknown as { [Symbol.asyncDispose]?: () => Promise<void> })[Symbol.asyncDispose]?.();
        if (ctx.agentId !== undefined) {
          failed = await forgetSession(ctx.agentId, ctx.options.cwd).then(() => undefined, failureOf);
        }
        // A session closed meanwhile starts no CLI that nothing would close.
        if (ctx.closed) return;
      }
      if (failed === undefined) ctx.ends.delete(held.turn);
      ctx.gone = undefined;
      ctx.handle = held.over !== true
        ? ctx.startQuery(ctx.running, false, held.at)
        : ctx.startQuery(ctx.running, failed === undefined);
      void ctx.consume();
    }
    finally {
      closing = undefined;
    }
    // A turn stopped while its conversation was deleted keeps the new CLI and
    // sends it nothing: the stop was for this turn.
    const still = moving();
    move = undefined;
    if (!still) return;
    if (failed === undefined) {
      await ctx.again(steers);
      return;
    }
    const why = `The conversation could not start over on another login: ${failed}`;
    ctx.failTurn(held.said === '' ? why : `${held.said}\n${why}`);
    await ctx.again(steers.filter((owed) => owed.cli !== 'started'));
    ctx.startNext();
  };

  const answered = (): void => {
    const login = ctx.login;
    if (login !== undefined) ctx.options.logins?.open.called(login.id, login.token, { ok: true });
  };

  return { login: undefined, cutOf, loginFor, unready, limited, refused, nextLogin, moveOn, failure, answered, replacing };
}
